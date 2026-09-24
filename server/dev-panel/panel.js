"use strict";
// Independent normal player sessions; no omniscient server endpoint or rule bypass.
async function pooled(items, task, limit = 4) {
  let next = 0;
  const errors = [];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !errors.length) {
        const item = items[next++];
        try {
          await task(item);
        } catch (error) {
          errors.push(error);
        }
      }
    }),
  );
  // Wait for every in-flight operation before reporting a failure.
  if (errors.length) throw errors[0];
}
class Companion {
  constructor({ request, save = () => {}, state = { code: "", actors: [] } }) {
    this.request = request;
    this.saveState = save;
    this.code = state.code;
    this.actors = state.actors;
    this.revision = 0;
  }
  save() {
    this.saveState({
      code: this.code,
      actors: this.actors.map(({ id, token, name, joined, pending }) => ({
        id,
        token,
        name,
        joined,
        pending,
      })),
    });
  }
  async add(code) {
    if (!/^\d{6}$/.test(code)) throw new Error("请输入6位房间号");
    if (this.code && this.code !== code && this.actors.length)
      throw new Error("请先点击“打开 / 切换房间”，原房间会话将保留");
    if (this.actors.some((a) => a.pending))
      throw new Error("请先重试未确认的操作");
    this.code = code;
    const { token } = await this.request("/api/dev-login", null, { code });
    const id = crypto.randomUUID();
    const actor = {
      id,
      token,
      name: "陪测" + (this.actors.length + 1),
      joined: false,
    };
    this.actors.push(actor);
    this.save();
    await this.send(
      actor,
      "/api/rooms/" + code + "/join",
      { name: actor.name },
      "join",
    );
    await this.refresh();
    return actor;
  }
  async send(actor, path, data, after) {
    if (actor.pending) throw new Error("该玩家仍有未确认操作，请重试原操作");
    actor.pending = { path, data, after, id: crypto.randomUUID() };
    this.save();
    return this.retry(actor);
  }
  async retry(actor) {
    const pending = actor.pending;
    if (!pending) return;
    this.revision++;
    try {
      await this.request(pending.path, actor.token, pending.data, pending.id);
      this.revision++;
      actor.pending = null;
      actor.error = "";
      actor.unavailable = false;
      // Apply only an acknowledged ready command, never an optimistic toggle.
      if (pending.data?.type === "ready" && actor.room?.phase === "lobby")
        actor.room.me.ready = pending.data.ready;
      if (pending.after === "join") actor.joined = true;
      if (pending.after === "leave")
        this.actors = this.actors.filter((a) => a !== actor);
      this.save();
    } catch (e) {
      this.revision++;
      if (e.status && e.status < 500 && e.status !== 401 && e.status !== 429)
        actor.pending = null;
      actor.error = e.message;
      if ([401, 403, 404].includes(e.status)) actor.unavailable = true;
      this.save();
      throw e;
    }
  }
  async refresh(actors = this.actors) {
    await pooled([...actors], async (actor) => {
      if (!actor.joined && !actor.pending) return;
      const revision = this.revision;
      const read = (actor.read = (actor.read || 0) + 1);
      const current = () =>
        revision === this.revision &&
        read === actor.read &&
        this.actors.includes(actor);
      const previousSecret = actor.secret;
      try {
        const room = await this.request("/api/rooms/" + this.code, actor.token);
        if (!current()) return;
        const secret =
          room.phase === "lobby"
            ? null
            : previousSecret?.stage === room.stage &&
                previousSecret?.game === room.game
              ? previousSecret
              : await this.request(
                  "/api/rooms/" + this.code + "/private",
                  actor.token,
                );
        if (!current()) return;
        if (secret && secret.stage !== room.stage) {
          actor.room = null;
          actor.secret = null;
          return;
        }
        actor.unavailable = false;
        actor.room = room;
        actor.secret = secret;
        actor.error = "";
      } catch (e) {
        if (!current()) return;
        actor.room = null;
        actor.secret = null;
        actor.error = e.message;
        actor.unavailable = [401, 403, 404].includes(e.status);
        if (actor.unavailable && !actor.pending) actor.joined = false;
      }
    });
    this.save();
  }
  async command(actor, type, extra = {}) {
    if (!actor.room) throw new Error("请刷新该玩家状态");
    return this.send(
      actor,
      "/api/rooms/" + this.code + "/commands",
      { type, stage: actor.room.stage, ...extra },
      type === "leave" ? "leave" : undefined,
    );
  }
  async fill() {
    await this.refresh();
    let room = this.actors.find((a) => a.room)?.room;
    if (!room) throw new Error("请先添加一位测试玩家并成功入座");
    if (room.phase !== "lobby") throw new Error("仅准备阶段可以补齐空位");
    while (room.players.length < room.capacity) {
      const actor = await this.add(this.code);
      room = actor.room;
      if (!room) throw new Error("未能确认入座，请刷新后继续");
    }
  }
  forgetUnavailable() {
    const unavailable = this.actors.filter((a) => a.unavailable);
    this.revision++;
    this.actors = this.actors.filter((a) => !a.unavailable);
    this.save();
    return unavailable.length;
  }
  async clearPlayers() {
    if (this.actors.some((a) => a.pending))
      throw new Error("请先重试未确认的操作，再清空陪测玩家");
    await this.refresh();
    const joined = this.actors.filter((a) => a.joined);
    if (joined.some((a) => !a.room))
      throw new Error("未能确认玩家状态，请刷新后再清空");
    const room = joined[0]?.room;
    const host = joined.find((a) => a.room.me.isHost);
    const seats = new Set(joined.map((a) => a.room.me.seat));
    const successor = room?.players.find((p) => !seats.has(p.seat));
    // Never discard the only credentials able to manage a retained table.
    if (host && !successor)
      throw new Error("请先让真人玩家入座接任房主，再清空陪测玩家");
    if (room && room.phase !== "lobby") {
      if (!host)
        throw new Error(
          "请先由房主在小程序结束本局并点击同房重开，回到准备阶段后再清空",
        );
      if (!["ended", "terminated"].includes(room.phase)) {
        await this.command(host, "terminate");
        await this.refresh();
      }
      await this.command(host, "rematch");
      await this.refresh();
    }
    if (host) await this.command(host, "transfer", { seat: successor.seat });
    for (const actor of [...this.actors]) {
      if (actor.joined) await this.command(actor, "leave");
      else {
        this.actors = this.actors.filter((a) => a !== actor);
        this.save();
      }
    }
  }
  async batch(value) {
    let count = 0;
    if (value === "ready") {
      const actors = this.actors.filter(
        (a) => a.room?.phase === "lobby" && !a.room.me.ready && !a.pending,
      );
      await pooled(actors, async (actor) => {
        await this.command(actor, "ready", { ready: true });
        count++;
      });
      return count;
    }
    // Frozen stage per actor: never turn a bulk action into a later phase's action.
    for (const actor of [...this.actors]) {
      if (!actor.room || actor.pending) continue;
      if (
        actor.room.me.submitted ||
        !actor.secret?.action?.choices?.includes(value)
      )
        continue;
      await this.command(actor, "submit", { value });
      count++;
    }
    return count;
  }
}
if (typeof module !== "undefined") module.exports = { Companion };
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const managed = location.pathname.startsWith("/admin/");
  const key = managed
    ? "shadowtable-admin-companion-v1"
    : "shadowtable-local-companion-v1";
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    state = null;
  }
  const rooms = state?.rooms || {};
  if (state?.code && state?.actors)
    rooms[state.code] = { code: state.code, actors: state.actors };
  const requestedCode = new URLSearchParams(location.search || "").get("room");
  if (/^\d{6}$/.test(requestedCode || ""))
    state = rooms[requestedCode] || { code: requestedCode, actors: [] };
  let retryAt = 0;
  const companion = new Companion({
    state: state || undefined,
    save: (value) => {
      if (value.code) rooms[value.code] = value;
      sessionStorage.setItem(key, JSON.stringify({ ...value, rooms }));
    },
    request: async (path, token, data, id) => {
      if (Date.now() < retryAt)
        throw Object.assign(new Error("请求冷却中，请稍后重试"), {
          status: 429,
        });
      if (managed && path === "/api/dev-login") path = "/api/admin/actors";
      const response = await fetch(path, {
        method: data ? "POST" : "GET",
        signal: AbortSignal.timeout(10000),
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(data
            ? {
                "Content-Type": "application/json",
                "Idempotency-Key": id || crypto.randomUUID(),
              }
            : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const result = await response.json();
      if (response.status === 429)
        retryAt =
          Date.now() +
          Math.min(
            60000,
            Math.max(
              1000,
              (Number(response.headers.get("Retry-After")) || 60) * 1000,
            ),
          );
      if (!response.ok)
        throw Object.assign(new Error(result.error || "请求失败"), {
          status: response.status,
        });
      return result;
    },
  });
  $("code").value = companion.code;
  let busy = false;
  let refreshing = false;
  const acting = new Set();
  const teams = {},
    targets = {},
    swaps = {},
    hunterModes = {},
    hostDrafts = {},
    transfers = {};
  const names = {
    confirm: "确认",
    approve: "赞成",
    reject: "反对",
    success: "成功牌",
    fail: "失败牌",
    start: "开始",
    advance: "推进阶段",
    rematch: "同房重开",
    terminate: "终止本局",
    closeOffline: "结束线下结算",
    offline: "转线下结算",
  };
  const escape = (text) =>
    String(text ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const button = (action, label, disabled = false) =>
    `<button data-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
  let changedActor = null;
  function showChangedIdentity() {
    const dialog = $("identity-change");
    if (busy || acting.size || document.hidden || dialog.open) return;
    const actor = companion.actors.find(
      (a) => a.room?.me.identityChanged && a.secret && !a.pending,
    );
    if (!actor) return;
    changedActor = { actor, revision: actor.secret.identityRevision };
    $("identity-change-title").textContent =
      `${actor.room.me.seat}号获得新身份`;
    $("identity-change-role").textContent =
      actor.secret.role + " · " + actor.secret.faction;
    $("identity-change-info").textContent = actor.secret.information;
    dialog.showModal();
  }
  $("identity-change-confirm").onclick = () => {
    const change = changedActor;
    const actor = change?.actor;
    $("identity-change").close();
    if (actor)
      run(
        () =>
          companion.command(actor, "ackIdentity", {
            revision: change.revision,
          }),
        "新身份已确认",
      );
  };
  $("identity-change").addEventListener("cancel", (e) => e.preventDefault());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      $("identity-change").close();
      $("identity-change-role").textContent = "";
      $("identity-change-info").textContent = "";
    } else showChangedIdentity();
  });
  let lastPlayersHtml, lastLocks;
  function render() {
    showChangedIdentity();
    $("identity-change-confirm").disabled = busy;
    $("workspace").hidden = !companion.actors.length;
    const room = companion.actors.find((a) => a.room)?.room;
    $("phase").textContent = room ? room.phaseName : "等待玩家入座";
    $("summary").textContent = room
      ? `房间 ${companion.code} · ${room.boardName} · ${room.players.length}/${room.capacity}人 · 第${room.game}局${room.round ? " · 任务" + room.round : ""}${room.leader ? " · 队长" + room.leader + "号" : ""}`
      : "可重试入座或让失效的测试账号离席";

    $("code").disabled = false;
    $("saved-rooms").innerHTML = Object.keys(rooms)
      .map((code) => `<option value="${escape(code)}">${escape(code)}</option>`)
      .join("");
    $("connection").textContent = busy
      ? "正在确认操作…"
      : "每4秒更新 · 只控制陪测账号";
    const playersHtml = companion.actors
      .map((actor) => {
        const r = actor.room,
          spec = actor.secret?.action;
        let actions = "";
        if (acting.has(actor.id))
          actions = button("waiting", "正在确认…", true);
        else if (actor.pending) actions = button("retry", "重试未确认操作");
        else if (!actor.joined)
          actions =
            button("join", "重新入座") + button("forget", "移除失效账号");
        else if (r?.phase === "lobby")
          actions = button("ready", r.me.ready ? "取消准备" : "准备");
        else if (r?.me.submitted)
          actions = '<span class="submitted">已提交</span>';
        else if (spec?.choices) {
          const swapChoices = spec.choices.filter((v) =>
            /^swap:\d+:\d+$/.test(v),
          );
          if (hunterModes[actor.id]?.stage !== r.stage) hunterModes[actor.id] = {stage: r.stage, mode: ""};
          const hunterMode = hunterModes[actor.id].mode;
          const choices = spec.hunterModes ? (hunterMode ? spec.choices.filter((v) => v.startsWith(hunterMode + ":")) : []) : spec.choices;
          actions = choices
            .filter((v) => !swapChoices.includes(v))
            .map((v) =>
              button(
                v,
                spec.options?.find((o) => o.value === v)?.label ||
                  {
                    magic: "魔法",
                    thiefFail: "盗贼失败",
                    pass: "不使用技能 / 确认",
                  }[v] ||
                  names[v] ||
                  v,
              ),
            )
            .join("");
          if (spec.hunterModes) {
            actions = hunterMode ? `<p>第 2 步：${hunterMode === "detonate" ? "选择相邻一人，自爆开枪" : "选择出局时开枪的目标"}</p>` + actions + button("hunterMode:", "返回选择技能方式") : '<p>第 1 步：选择技能方式</p>' + button("hunterMode:detonate", "主动技能") + button("hunterMode:passive", "被动技能") + button("pass", "不使用技能");
          }
          if (swapChoices.length) {
            if (swaps[actor.id]?.stage !== r.stage)
              swaps[actor.id] = { stage: r.stage, seats: [] };
            const selected = swaps[actor.id].seats;
            const seats = [
              ...new Set(
                swapChoices.flatMap((v) => v.split(":").slice(1).map(Number)),
              ),
            ].sort((a, b) => a - b);
            actions += `<div class="swap-picker"><p>选择两个号码 · 已选 ${selected.length} / 2；再次点击可取消</p><div class="swap-grid">${seats.map((seat) => `<button data-action="swapSeat:${seat}" aria-pressed="${selected.includes(seat)}" ${selected.length === 2 && !selected.includes(seat) ? "disabled" : ""}>${selected.includes(seat) ? "✓ " : ""}${seat}号</button>`).join("")}</div>${button("confirmSwap", "确认换号", selected.length !== 2)}</div>`;
          }
        } else if (spec?.targets) {
          actions =
            `<label>最终目标<select data-target><option value="">选择座位</option>${spec.targets.map((t) => `<option value="${t.seat}" ${String(targets[actor.id]) === String(t.seat) ? "selected" : ""}>${t.seat}号 · ${escape(t.name)}</option>`).join("")}</select></label>` +
            button("target", "确认目标");
        }
        if (
          r?.phase === "proposal" &&
          r.leader === r.me.seat &&
          !actor.pending
        ) {
          const team =
            teams[actor.id]?.stage === r.stage ? teams[actor.id].seats : [];
          actions += `<div><p>选择 ${r.teamSize} 名队员</p><div class="team">${r.players.map((p) => `<label><input type="checkbox" data-seat="${p.seat}" ${team.includes(p.seat) ? "checked" : ""}>${p.seat}号</label>`).join("")}</div>${button("propose", "提交队伍", team.length !== r.teamSize)}</div>`;
        }
        if (r?.me.isHost && !actor.pending) {
          if (r.phase === "lobby") actions += button("start", "开始游戏");
          actions +=
            `<label>转交房主<select data-transfer><option value="">选择接任玩家</option>${r.players
              .filter((p) => p.seat !== r.me.seat)
              .map(
                (p) =>
                  `<option value="${p.seat}" ${String(transfers[actor.id]) === String(p.seat) ? "selected" : ""}>${p.seat}号 · ${escape(p.name)}</option>`,
              )
              .join("")}</select></label>` + button("transfer", "确认转交");
          if (r.canAdvance && !r.flexible)
            actions += button("advance", "推进阶段");
          if (!["lobby", "ended", "terminated"].includes(r.phase))
            actions += button("terminate", "终止本局");
          if (["ended", "terminated"].includes(r.phase))
            actions += button("rematch", "同房重开");
          if (r.phase === "offlineFinal")
            actions += button("closeOffline", "结束线下结算");
          if (r.canUseTools) {
            if (hostDrafts[actor.id]?.stage !== r.stage)
              hostDrafts[actor.id] = {
                stage: r.stage,
                seats: [],
                threshold: 1,
              };
            const draft = hostDrafts[actor.id];
            if (!r.hasActiveOperation) {
              actions += `<fieldset><legend>房主操作台</legend><p>投票、任务选择队员；十二骑士刀人仅选一位带刀人。</p><div class="team">${r.players
                .filter((p) => p.alive !== false)
                .map(
                  (p) =>
                    `<label><input type="checkbox" data-host-seat="${p.seat}" ${draft.seats.includes(p.seat) ? "checked" : ""}>${p.seat}号</label>`,
                )
                .join(
                  "",
                )}</div><label>任务失败票门槛<select data-threshold><option value="1">1票</option><option value="2" ${draft.threshold === 2 ? "selected" : ""}>2票</option></select></label>`;
              const kinds = [
                ["vote", "发起投票"],
                ["quest", "发起任务"],
              ];
              if (r.knights)
                kinds.push(["skills", "发起技能"], ["conversion", "执行转化"]);
              if (r.fairyEnabled) kinds.push(["fairy", "发起仙女查验"]);
              if (!r.knifeOffline) kinds.push(["assassination", "发起刀人"]);
              if (r.hasReverse && !r.assisted)
                kinds.push(["reverseStrike", "发起逆仆反刺"]);
              if (r.knifeOffline || r.knights)
                kinds.push(["offline", "线下结算"]);
              actions +=
                kinds
                  .map(([kind, label]) => button("begin:" + kind, label))
                  .join("") + "</fieldset>";
            } else {
              if (r.phase !== "offlineFinal")
                actions += button("settleTool", "结算当前操作");
              if (r.closeWaiting) actions += button("closeWaiting", "结束等待");
              actions += button("cancelActivity", "作废当前操作");
            }
            actions += button("finishTools", "结束本局");
          }
        }
        const role =
          $("reveal").checked && actor.secret
            ? `<p class="role">${escape(actor.secret.role)} · ${escape(actor.secret.faction)}</p><p>${escape(actor.secret.information)}</p>`
            : "";
        return `<article class="player" data-actor="${actor.id}" aria-busy="${acting.has(actor.id)}"><h3>${r ? r.me.seat + "号 · " : ""}${escape(actor.name)}</h3><p>${r?.me.isHost ? "房主 · " : ""}${escape(spec?.label || (r?.phase === "lobby" ? (r.me.ready ? "已准备" : "等待准备") : "等待下一阶段"))}</p>${role}${actor.error ? `<p class="error">${escape(actor.error)}</p>` : ""}<div class="actions">${actions}</div></article>`;
      })
      .join("");
    const locks = `${busy}:${[...acting].join(",")}`;
    if (lastPlayersHtml !== playersHtml || lastLocks !== locks) {
      $("players").innerHTML = playersHtml;
      lastPlayersHtml = playersHtml;
      lastLocks = locks;
    }
    document.querySelectorAll("button").forEach((b) => {
      if (
        busy ||
        (acting.size &&
          (b.dataset.action !== "ready" ||
            acting.has(b.closest("[data-actor]")?.dataset.actor)))
      )
        b.disabled = true;
    });
    if (!busy && !acting.size) {
      ["join", "refresh"].forEach((id) => ($(id).disabled = false));
      $("join").disabled =
        $("code").value.trim() === companion.code &&
        !!room &&
        (room.phase !== "lobby" || room.players.length >= room.capacity);
      $("leave").disabled = companion.actors.some((a) => a.pending);
      $("switch-room").disabled = false;
      $("forget-unavailable").disabled = !companion.actors.some(
        (a) => a.unavailable,
      );
      $("fill").disabled =
        !room ||
        room.phase !== "lobby" ||
        companion.actors.some((a) => a.pending);
      document
        .querySelectorAll("[data-batch]")
        .forEach(
          (b) =>
            (b.disabled = !companion.actors.some(
              (a) =>
                a.room &&
                !a.pending &&
                (b.dataset.batch === "ready"
                  ? a.room.phase === "lobby" && !a.room.me.ready
                  : !a.room.me.submitted &&
                    a.secret?.action?.choices?.includes(b.dataset.batch)),
            )),
        );
    }
  }
  async function run(
    fn,
    message = "操作已确认",
    { actor, refresh = true } = {},
  ) {
    if (busy || (actor ? acting.has(actor.id) : acting.size)) return;
    if (actor) acting.add(actor.id);
    else busy = true;
    $("feedback").textContent = "";
    render();
    try {
      const result = await fn();
      if (refresh) await companion.refresh();
      $("feedback").className = "success";
      $("feedback").textContent =
        typeof result === "number"
          ? `已完成 ${result} 位测试玩家的操作`
          : message;
    } catch (e) {
      $("feedback").className = "error";
      $("feedback").textContent =
        e.message + "；请检查各玩家状态。未确认请求需使用原操作重试。";
    } finally {
      if (actor) acting.delete(actor.id);
      else busy = false;
      render();
    }
  }
  $("connect").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("code").value.trim();
    run(() => companion.add(code), "测试玩家已加入");
  });
  $("switch-room").onclick = () =>
    run(
      async () => {
        const code = $("code").value.trim();
        if (!/^\d{6}$/.test(code)) throw new Error("请输入6位房间号");
        companion.save();
        companion.revision++;
        const next = rooms[code] || { code, actors: [] };
        companion.code = code;
        if (typeof history !== "undefined")
          history.replaceState(null, "", location.pathname + "?room=" + code);
        companion.actors = next.actors.map((a) => ({ ...a }));
        companion.save();
        $("identity-change").close();
        changedActor = null;
        await companion.refresh();
      },
      "已切换房间，原房间陪测会话已保留",
      { refresh: false },
    );
  $("forget-unavailable").onclick = () => {
    if (
      !confirm(
        "仅移除无法访问的本地陪测记录，不会清理服务器座位。未确认操作可能已经生效；残留座位请在管理平台清理。确认继续？",
      )
    )
      return;
    run(() => companion.forgetUnavailable(), "已移除失效记录", {
      refresh: false,
    });
  };
  $("fill").onclick = () =>
    run(() => companion.fill(), "测试玩家已补齐；请全员准备后由房主开局");
  $("refresh").onclick = () =>
    run(() => companion.refresh(), "状态已刷新", { refresh: false });
  $("reveal").onchange = render;
  document
    .querySelectorAll("[data-batch]")
    .forEach(
      (b) => (b.onclick = () => run(() => companion.batch(b.dataset.batch))),
    );
  $("players").addEventListener("change", (e) => {
    const actor = companion.actors.find(
      (a) => a.id === e.target.closest("[data-actor]")?.dataset.actor,
    );
    if (!actor) return;
    if (e.target.hasAttribute("data-host-seat")) {
      const draft = hostDrafts[actor.id];
      if (!draft || draft.stage !== actor.room.stage) return;
      const seat = Number(e.target.dataset.hostSeat);
      draft.seats = e.target.checked
        ? [...draft.seats, seat]
        : draft.seats.filter((s) => s !== seat);
    }
    if (e.target.hasAttribute("data-threshold"))
      hostDrafts[actor.id].threshold = Number(e.target.value);
    if (e.target.hasAttribute("data-transfer"))
      transfers[actor.id] = Number(e.target.value);
    if (e.target.hasAttribute("data-target"))
      targets[actor.id] = e.target.value;
    if (e.target.hasAttribute("data-seat")) {
      if (teams[actor.id]?.stage !== actor.room.stage)
        teams[actor.id] = { stage: actor.room.stage, seats: [] };
      const seat = Number(e.target.dataset.seat);
      teams[actor.id].seats = e.target.checked
        ? [...teams[actor.id].seats, seat]
        : teams[actor.id].seats.filter((s) => s !== seat);
      render();
    }
  });
  $("players").addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const actor = companion.actors.find(
      (a) => a.id === e.target.closest("[data-actor]")?.dataset.actor,
    );
    if (!action || !actor || busy || acting.has(actor.id)) return;
    if (action === "ready") {
      run(
        () =>
          companion.command(actor, "ready", { ready: !actor.room.me.ready }),
        "准备状态已确认",
        { actor, refresh: false },
      );
      return;
    }
    if (action.startsWith("hunterMode:")) {
      if (!actor.secret?.action?.hunterModes) return;
      hunterModes[actor.id] = {stage: actor.room.stage, mode: action.split(":")[1]};
      render();
      return;
    }
    if (action.startsWith("swapSeat:")) {
      if (swaps[actor.id]?.stage !== actor.room.stage) return;
      const seat = Number(action.split(":")[1]);
      const selected = swaps[actor.id].seats;
      swaps[actor.id].seats = selected.includes(seat)
        ? selected.filter((s) => s !== seat)
        : selected.length < 2
          ? [...selected, seat]
          : selected;
      render();
      return;
    }
    // Test-player actions execute directly; a target must still be selected.
    if (action === "target" && !targets[actor.id]) return;
    run(async () => {
      if (action === "retry") return companion.retry(actor);
      if (action === "transfer") {
        const seat = transfers[actor.id];
        if (!seat) throw new Error("请选择接任玩家");
        if (!confirm(`确认将房主转交给 ${seat} 号？`)) return;
        return companion.command(actor, "transfer", { seat });
      }
      if (action.startsWith("begin:")) {
        const kind = action.slice(6),
          draft = hostDrafts[actor.id];
        if (!draft || draft.stage !== actor.room.stage)
          throw new Error("阶段已变化，请重新选择");
        if (
          kind === "quest" &&
          (!draft.seats.length || draft.threshold > draft.seats.length)
        )
          throw new Error("请选择任务队员，失败票门槛不能超过队员人数");
        if (
          kind === "assassination" &&
          actor.room.knights &&
          draft.seats.length !== 1
        )
          throw new Error("请选择一位带刀人");
        if (kind === "conversion" && !confirm("确认执行转化？")) return;
        return companion.command(actor, "beginActivity", {
          kind,
          team: draft.seats,
          threshold: draft.threshold,
          actor: draft.seats[0],
        });
      }
      if (
        [
          "terminate",
          "cancelActivity",
          "finishTools",
          "closeWaiting",
          "rematch",
        ].includes(action)
      ) {
        const detail =
          action === "closeWaiting"
            ? actor.room.closeWaiting?.description
            : "该操作将结束、重置本局或作废尚未结算的提交。";
        if (!confirm(detail + " 确认继续？")) return;
        return companion.command(actor, action, {
          confirm: true,
          ...(action === "finishTools"
            ? { replace: !!actor.room.hasActiveOperation }
            : {}),
        });
      }
      if (action === "confirmSwap") {
        const draft = swaps[actor.id];
        if (draft?.stage !== actor.room.stage || draft.seats.length !== 2)
          return;
        const seats = [...draft.seats].sort((a, b) => a - b);
        const value = actor.secret?.action?.choices?.find(
          (v) =>
            v.startsWith("swap:") &&
            v
              .split(":")
              .slice(1)
              .map(Number)
              .sort((a, b) => a - b)
              .join(":") === seats.join(":"),
        );
        if (
          !value ||
          !confirm(`确认交换 ${seats[0]} 号与 ${seats[1]} 号？提交后不可更改。`)
        )
          return;
        return companion.command(actor, "submit", { value });
      }
      if (action === "forget") {
        companion.actors = companion.actors.filter((a) => a !== actor);
        companion.save();
        return;
      }
      if (action === "join")
        return companion.send(
          actor,
          "/api/rooms/" + companion.code + "/join",
          { name: actor.name },
          "join",
        );
      if (action === "propose")
        return companion.command(actor, "propose", {
          team: teams[actor.id]?.seats || [],
        });
      if (action === "target")
        return companion.command(actor, "submit", {
          value: Number(targets[actor.id]),
        });
      if (actor.secret?.action?.choices?.includes(action))
        return companion.command(actor, "submit", { value: action });
      return companion.command(actor, action);
    });
  });
  $("leave").onclick = () => {
    if (
      !confirm(
        "清空本面板的陪测玩家？若陪测玩家是房主，将先结束本局、回到准备阶段并转交房主给真人玩家。保留真人玩家和牌桌，可重新添加陪测玩家。",
      )
    )
      return;
    run(() => companion.clearPlayers(), "陪测玩家已清空，可重新添加测试玩家");
  };
  render();
  if (companion.actors.length)
    run(() => companion.refresh(), "已恢复本标签页的测试玩家", {
      refresh: false,
    });
  setInterval(async () => {
    if (
      busy ||
      refreshing ||
      Date.now() < retryAt ||
      document.hidden ||
      !companion.actors.length ||
      document.activeElement?.matches("input,select")
    )
      return;
    refreshing = true;
    try {
      await companion.refresh();
    } finally {
      refreshing = false;
      render();
    }
  }, 4000);
}
