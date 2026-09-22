"use strict";
const $ = (id) => document.getElementById(id);
const labels = {
  "test-on": "开启陪测",
  "test-off": "关闭陪测",
  "clear-testers": "清理陪测座位",
  terminate: "终止对局",
  rematch: "同房重开",
  delete: "删除房间",
  login: "管理员登录",
  companion: "陪测玩家",
  player: "玩家",
};
let auditOffset = 0;
let auditCode = null;
let auditRooms = [];
let offset = 0,
  pending = null,
  loading = false;
async function api(path, data) {
  const response = await fetch("/api/admin/" + path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (response.status === 401) showSession(false);
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}
function showSession(on) {
  $("login").hidden = on;
  $("dashboard").hidden = !on;
  $("logout").hidden = !on;
  if (!on) {
    $("rooms").replaceChildren();
    $("audit").replaceChildren();
  }
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function feedback(error) {
  $("feedback").textContent = error.message || error;
}
async function currentRoomCodes(page) {
  const codes = page.rooms.map((room) => room.code);
  for (let start = 0; start < page.total; start += 50) {
    if (start === offset) continue;
    const next = await api("rooms?offset=" + start);
    codes.push(...next.rooms.map((room) => room.code));
  }
  return [...new Set(codes)].sort();
}
async function fetchAudit(code, start) {
  const path = "audit?grouped=1&code=" + encodeURIComponent(code || "");
  const result = await api(path + "&offset=" + start);
  if (result.filtered) return result;
  // Older running servers may still return account-creation events.
  // Filter before local pagination so counts and page boundaries stay correct.
  let groups = start === 0 ? [...result.groups] : [];
  for (let cursor = 0; cursor < result.total; cursor += result.pageSize) {
    if (cursor === start) {
      if (start !== 0) groups.push(...result.groups);
      continue;
    }
    const page = await api(path + "&offset=" + cursor);
    groups.push(...page.groups);
  }
  groups = groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => entry.action !== "actor"),
    }))
    .filter((group) => group.entries.length);
  return {
    groups: groups.slice(start, start + result.pageSize),
    total: groups.length,
    pageSize: result.pageSize,
  };
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  $("audit-room").disabled = true;
  try {
    let [roomPage, auditResult] = await Promise.all([
      api("rooms?offset=" + offset),
      fetchAudit(auditCode, auditOffset),
    ]);
    const { rooms, total } = roomPage;
    auditRooms = await currentRoomCodes(roomPage);
    showSession(true);
    $("count").textContent = `共 ${total} 个房间`;
    $("rooms").replaceChildren();
    if (!rooms.length)
      $("rooms").append(
        el("p", "暂无房间。可先在小程序创建牌桌，再刷新列表。"),
      );
    for (const room of rooms) {
      const row = el("div", "", "room"),
        details = el("div", ""),
        actions = el("div", "", "actions");
      details.append(
        el("strong", room.code),
        el("span", room.testRoom ? "陪测已开启" : "正式房间", "badge"),
        el(
          "p",
          `${room.boardName} · ${room.players}/${room.capacity} 人 · ${room.phaseName} · 第 ${room.game} 局`,
        ),
      );
      if (room.testRoom) {
        const link = el("a", "打开陪测台 →");
        link.href = "/admin/companion?room=" + encodeURIComponent(room.code);
        actions.append(link);
      }
      for (const action of [
        room.testRoom ? "test-off" : "test-on",
        "clear-testers",
        "terminate",
        "rematch",
        "delete",
      ]) {
        const button = el(
          "button",
          labels[action],
          action === "delete" ? "danger" : "",
        );
        button.disabled =
          action.startsWith("test-") || action === "clear-testers"
            ? room.phase !== "lobby"
            : action === "rematch"
              ? !["ended", "terminated"].includes(room.phase)
              : action === "terminate" &&
                ["lobby", "ended", "terminated"].includes(room.phase);
        button.addEventListener("click", () => openAction(room, action));
        actions.append(button);
      }
      row.append(details, actions);
      $("rooms").append(row);
    }
    $("prev").disabled = offset === 0;
    $("next").disabled = offset + 50 >= total;
    $("page").textContent = `第 ${offset / 50 + 1} 页`;
    if (auditCode === null || (auditCode && !auditRooms.includes(auditCode))) {
      auditCode = auditRooms[0] || "";
      auditOffset = 0;
      auditResult = await fetchAudit(auditCode, 0);
    }
    $("audit-room").textContent = auditCode
      ? "房间 " + auditCode
      : "平台操作（无房间）";
    renderAudit(auditResult);
    feedback("已更新 · " + new Date().toLocaleTimeString());
  } catch (error) {
    feedback(error);
  } finally {
    loading = false;
    $("refresh").disabled = false;
    $("audit-room").disabled = false;
  }
}
function renderAudit({ groups, total, pageSize }) {
  $("audit").replaceChildren();
  $("audit-count").textContent = `共 ${total} 组 · 每页 ${pageSize} 组`;
  $("audit-page").textContent = `第 ${auditOffset / pageSize + 1} 页`;
  $("audit-prev").disabled = auditOffset === 0;
  $("audit-next").disabled = auditOffset + pageSize >= total;
  if (!groups.length) $("audit").append(el("p", "暂无操作记录"));
  for (const group of groups) {
    const entries = group.entries;
    const d = entries[0].details;
    const block = el("div", "", "audit-stage");
    const header = el("div", "", "audit-stage-heading");
    const title = d.phase
      ? d.phaseKey === "skillPrepare"
        ? "放技能阶段"
        : d.phase
      : d.label || labels[entries[0].action] || "房间操作";
    const startedAt = entries.find((entry) => entry.details.activityStartedAt)
      ?.details.activityStartedAt;
    const timestamp =
      startedAt || Math.min(...entries.map((entry) => entry.created));
    header.append(
      el("h3", title),
      el(
        "time",
        `${startedAt ? "发起于" : "记录于"} ${new Date(timestamp).toLocaleString()}`,
      ),
    );
    block.append(header);
    const players = new Map();
    for (const entry of [...entries].reverse()) {
      for (const player of entry.details.participants || [])
        players.set(player.seat, player);
      if (entry.details.player && !players.has(entry.details.player.seat))
        players.set(entry.details.player.seat, entry.details.player);
    }
    const summary = el("div", "", "audit-players");
    for (const player of [...players.values()].sort(
      (a, b) => a.seat - b.seat,
    )) {
      const actions = [...entries]
        .reverse()
        .filter((entry) => entry.details.player?.seat === player.seat);
      const submissions = actions.filter(
        (entry) => entry.details.command === "submit",
      );
      const primary = submissions.length
        ? submissions
        : actions.filter(
            (entry) =>
              !["ackIdentity", "ackFairyResult"].includes(
                entry.details.command,
              ),
          );
      let text;
      if (player.required && !submissions.length)
        text = group.active ? "未提交" : "未提交（阶段已结束）";
      else if (primary.length)
        text = [
          ...new Set(
            primary.map((entry) => {
              const detail = entry.details;
              if (detail.value === "pass") return "未使用技能";
              if (detail.choice) return detail.choice;
              if (detail.command === "ready")
                return detail.parameters.ready ? "已准备" : "取消准备";
              if (detail.command === "seat")
                return `换到${detail.parameters.seat}号`;
              return detail.label;
            }),
          ),
        ].join("、");
      else if (player.required)
        text = group.active ? "未提交" : "未提交（阶段已结束）";
      else if (actions.length)
        text = [...new Set(actions.map((entry) => entry.details.label))].join(
          "、",
        );
      else text = player.required === false ? "无需操作" : "未记录操作";
      // Prefer the actor snapshot over later participant snapshots (e.g. after drawing B).
      const actor =
        primary.at(-1)?.details.player ||
        actions.at(-1)?.details.player ||
        player;
      const role =
        actor.role === undefined && d.game ? "身份未记录" : actor.role;
      const line = el("span", "", "audit-player");
      line.append(
        el("strong", `${actor.seat}号·${actor.name}${role ? "·" + role : ""}`),
        document.createTextNode(" " + text),
      );
      summary.append(line);
    }
    if (players.size) block.append(summary);
    if (!d.stage && d.phase)
      block.append(
        el("p", "旧记录按连续阶段归组，未提交情况无法追溯。", "audit-note"),
      );
    if (!players.size)
      block.append(
        el(
          "p",
          [
            ...new Set(
              entries.map((entry) =>
                [
                  entry.details.label || labels[entry.action] || entry.action,
                  entry.reason,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
            ),
          ].join("；"),
        ),
      );
    $("audit").append(block);
  }
}
function renderRoomOptions() {
  const query = $("room-search").value.trim();
  const codes = auditRooms.filter((code) => code.includes(query));
  $("room-picker-count").textContent = `共 ${auditRooms.length} 个现有房间`;
  $("room-options").replaceChildren();
  for (const code of [...(query ? [] : [""]), ...codes]) {
    const button = el("button", "", "room-option");
    button.setAttribute("aria-pressed", String(code === auditCode));
    button.append(
      el("span", code ? "房间 " + code : "平台操作", "room-option-title"),
      el(
        "span",
        code === auditCode ? "已选择" : code ? "查看记录" : "无房间",
        "room-option-hint",
      ),
    );
    button.addEventListener("click", () => {
      if (loading) return;
      auditCode = code;
      auditOffset = 0;
      $("room-picker").close();
      refresh();
    });
    $("room-options").append(button);
  }
  if (query && !codes.length)
    $("room-options").append(
      el("p", "没有匹配的现有房间", "room-picker-empty"),
    );
}
$("audit-room").addEventListener("click", () => {
  $("room-search").value = "";
  renderRoomOptions();
  $("room-picker").showModal();
  $("room-search").focus();
});
$("room-search").addEventListener("input", renderRoomOptions);
$("room-picker-close").addEventListener("click", () =>
  $("room-picker").close(),
);
$("audit-prev").addEventListener("click", () => {
  if (loading) return;
  auditOffset = Math.max(0, auditOffset - 20);
  refresh();
});
$("audit-next").addEventListener("click", () => {
  if (loading) return;
  auditOffset += 20;
  refresh();
});
function openAction(room, action) {
  pending = { room, action };
  $("action-title").textContent = `${labels[action]} · ${room.code}`;
  $("action-description").textContent = {
    "clear-testers":
      "仅清理本平台生成的陪测账号，真人玩家保留。旧陪测凭据立即失效；用于会话过期或浏览器关闭后的恢复。",
    delete: "房间和成员关系将删除，无法从平台撤销。",
    terminate: "当前对局将终止，不判胜负。",
    rematch: "清除上一局状态并回到准备阶段，保留房间与玩家座位。",
    "test-on": "允许管理员创建的陪测账号加入现有房间。所有玩家将看到测试标记。",
    "test-off": "关闭后陪测账号不能再访问该房间；需先清空陪测玩家。",
  }[action];
  $("action-form").reset();
  $("action-error").textContent = "";
  $("confirm-dialog").showModal();
  $("confirm-code").focus();
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("login", { key: $("key").value });
    $("key").value = "";
    await refresh();
  } catch (error) {
    feedback(error);
  } finally {
    button.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("logout", {});
    sessionStorage.removeItem("shadowtable-admin-companion-v1");
    showSession(false);
    feedback("已退出，陪测凭据已失效。");
  } catch (error) {
    feedback(error);
  }
});
$("action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pending || $("submit-action").disabled) return;
  if ($("confirm-code").value !== pending.room.code) {
    $("action-error").textContent = "房间号不匹配";
    return;
  }
  $("submit-action").disabled = true;
  try {
    await api("rooms/" + pending.room.code, {
      action: pending.action,
      stage: pending.room.stage,
      confirm: $("confirm-code").value,
      reason: $("reason").value,
    });
    $("confirm-dialog").close();
    pending = null;
    await refresh();
  } catch (error) {
    $("action-error").textContent =
      error.message + "；结果不确定时请取消并刷新列表确认。";
  } finally {
    $("submit-action").disabled = false;
  }
});
$("cancel").addEventListener("click", () => $("confirm-dialog").close());
$("refresh").addEventListener("click", refresh);
$("prev").addEventListener("click", () => {
  offset = Math.max(0, offset - 50);
  refresh();
});
$("next").addEventListener("click", () => {
  offset += 50;
  refresh();
});
api("session")
  .then((session) => {
    if (session.authenticated) return refresh();
    showSession(false);
  })
  .catch(feedback);
