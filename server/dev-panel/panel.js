"use strict";
// Independent normal player sessions; no omniscient server endpoint or rule bypass.
class Companion {
  constructor({ request, save = () => {}, state = { code: "", actors: [] } }) {
    this.request = request;
    this.saveState = save;
    this.code = state.code;
    this.actors = state.actors;
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
      throw new Error("请先让已有测试玩家离席，再切换房间");
    if (this.actors.some((a) => a.pending))
      throw new Error("请先重试未确认的操作");
    this.code = code;
    const { token } = await this.request("/api/dev-login", null, {});
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
    try {
      await this.request(pending.path, actor.token, pending.data, pending.id);
      actor.pending = null;
      actor.error = "";
      if (pending.after === "join") actor.joined = true;
      if (pending.after === "leave")
        this.actors = this.actors.filter((a) => a !== actor);
      this.save();
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 401 && e.status !== 429)
        actor.pending = null;
      actor.error = e.message;
      this.save();
      throw e;
    }
  }
  async refresh() {
    for (const actor of this.actors) {
      actor.secret = null;
      if (actor.pending) continue;
      if (!actor.joined) continue;
      try {
        const room = await this.request("/api/rooms/" + this.code, actor.token);
        const secret =
          room.phase === "lobby"
            ? null
            : await this.request(
                "/api/rooms/" + this.code + "/private",
                actor.token,
              );
        if (secret && secret.stage !== room.stage) {
          actor.room = null;
          continue;
        }
        actor.room = room;
        actor.secret = secret;
        actor.error = "";
      } catch (e) {
        actor.room = null;
        actor.error = e.message;
        if (e.status === 403 || e.status === 404) actor.joined = false;
      }
    }
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
  async batch(value) {
    let count = 0;
    // Frozen stage per actor: never turn a bulk action into a later phase's action.
    for (const actor of [...this.actors]) {
      if (!actor.room || actor.pending) continue;
      if (value === "ready") {
        if (actor.room.phase !== "lobby" || actor.room.me.ready) continue;
        await this.command(actor, "ready", { ready: true });
      } else {
        if (
          actor.room.me.submitted ||
          !actor.secret?.action?.choices?.includes(value)
        )
          continue;
        await this.command(actor, "submit", { value });
      }
      count++;
    }
    return count;
  }
}
if (typeof module !== "undefined") module.exports = { Companion };
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const key = "shadowtable-local-companion-v1";
  let state;
  try {
    state = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    state = null;
  }
  const companion = new Companion({
    state: state || undefined,
    save: (value) => sessionStorage.setItem(key, JSON.stringify(value)),
    request: async (path, token, data, id) => {
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
      if (!response.ok)
        throw Object.assign(new Error(result.error || "请求失败"), {
          status: response.status,
        });
      return result;
    },
  });
  let busy = false;
  const teams = {},
    targets = {};
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
  function render() {
    $("workspace").hidden = !companion.actors.length;
    const room = companion.actors.find((a) => a.room)?.room;
    $("phase").textContent = room ? room.phaseName : "等待玩家入座";
    $("summary").textContent = room
      ? `房间 ${companion.code} · ${room.boardName} · ${room.players.length}/${room.capacity}人 · 第${room.game}局${room.round ? " · 任务" + room.round : ""}${room.leader ? " · 队长" + room.leader + "号" : ""}`
      : "可重试入座或让失效的测试账号离席";
    $("code").value = companion.code || $("code").value;
    $("code").disabled = companion.actors.length > 0;
    $("connection").textContent = busy
      ? "正在确认操作…"
      : "每4秒更新 · 只控制陪测账号";
    $("players").innerHTML = companion.actors
      .map((actor) => {
        const r = actor.room,
          spec = actor.secret?.action;
        let actions = "";
        if (actor.pending) actions = button("retry", "重试未确认操作");
        else if (!actor.joined)
          actions =
            button("join", "重新入座") + button("forget", "移除失效账号");
        else if (r?.phase === "lobby")
          actions = button("ready", r.me.ready ? "取消准备" : "准备");
        else if (r?.me.submitted)
          actions = '<span class="submitted">已提交</span>';
        else if (spec?.choices)
          actions = spec.choices.map((v) => button(v, names[v] || v)).join("");
        else if (spec?.targets) {
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
          if (r.canAdvance)
            actions +=
              button("advance", "推进阶段") + button("terminate", "终止本局");
          if (["ended", "terminated"].includes(r.phase))
            actions += button("rematch", "同房重开");
          if (r.phase === "offlineFinal")
            actions += button("closeOffline", "结束线下结算");
        }
        const role =
          $("reveal").checked && actor.secret
            ? `<p class="role">${escape(actor.secret.role)} · ${escape(actor.secret.faction)}</p><p>${escape(actor.secret.information)}</p>`
            : "";
        return `<article class="player" data-actor="${actor.id}"><h3>${r ? r.me.seat + "号 · " : ""}${escape(actor.name)}</h3><p>${r?.me.isHost ? "房主 · " : ""}${escape(spec?.label || (r?.phase === "lobby" ? "等待准备" : "等待下一阶段"))}</p>${role}${actor.error ? `<p class="error">${escape(actor.error)}</p>` : ""}<div class="actions">${actions}</div></article>`;
      })
      .join("");
    document.querySelectorAll("button").forEach((b) => {
      if (busy) b.disabled = true;
    });
    if (!busy) {
      ["join", "refresh"].forEach((id) => ($(id).disabled = false));
      $("join").disabled =
        !!room &&
        (room.phase !== "lobby" || room.players.length >= room.capacity);
      $("leave").disabled = companion.actors.some(
        (a) => a.pending || (a.joined && a.room?.phase !== "lobby"),
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
  async function run(fn, message = "操作已确认") {
    if (busy) return;
    busy = true;
    $("feedback").textContent = "";
    render();
    try {
      const result = await fn();
      await companion.refresh();
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
      busy = false;
      render();
    }
  }
  $("connect").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("code").value.trim();
    run(() => companion.add(code), "测试玩家已加入");
  });
  $("fill").onclick = () =>
    run(() => companion.fill(), "测试玩家已补齐；请全员准备后在小程序开局");
  $("refresh").onclick = () => run(() => companion.refresh(), "状态已刷新");
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
    if (!action || !actor || busy) return;
    if (
      action === "target" &&
      (!targets[actor.id] ||
        !confirm(`确认以 ${targets[actor.id]} 号为最终目标？提交后不可更改。`))
    )
      return;
    if (
      ["start", "terminate", "rematch", "closeOffline"].includes(action) &&
      !confirm(`确认${names[action]}？`)
    )
      return;
    run(async () => {
      if (action === "retry") return companion.retry(actor);
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
      if (action === "ready")
        return companion.command(actor, "ready", {
          ready: !actor.room.me.ready,
        });
      if (action === "propose")
        return companion.command(actor, "propose", {
          team: teams[actor.id]?.seats || [],
        });
      if (action === "target")
        return companion.command(actor, "submit", {
          value: Number(targets[actor.id]),
        });
      if (["confirm", "approve", "reject", "success", "fail"].includes(action))
        return companion.command(actor, "submit", { value: action });
      return companion.command(actor, action);
    });
  });
  $("leave").onclick = () => {
    if (
      !confirm(
        "让本面板的测试玩家离席？真实玩家和牌桌不会被删除。仅准备阶段可执行。",
      )
    )
      return;
    run(async () => {
      for (const actor of [...companion.actors]) {
        if (!actor.joined && !actor.pending) {
          companion.actors = companion.actors.filter((a) => a !== actor);
          companion.save();
        } else await companion.command(actor, "leave");
      }
    }, "测试玩家已离席");
  };
  render();
  if (companion.actors.length)
    run(() => companion.refresh(), "已恢复本标签页的测试玩家");
  setInterval(async () => {
    if (
      busy ||
      document.hidden ||
      !companion.actors.length ||
      document.activeElement?.matches("input,select")
    )
      return;
    busy = true;
    try {
      await companion.refresh();
    } finally {
      busy = false;
      render();
    }
  }, 4000);
}
