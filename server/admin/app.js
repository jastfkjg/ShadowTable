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
  actor: "创建陪测账号",
  companion: "陪测玩家",
  player: "玩家",
};
let auditOffset = 0;
let auditCode = null;
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
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  $("audit-room").disabled = true;
  try {
    let [{ rooms, total }, auditResult] = await Promise.all([
      api("rooms?offset=" + offset),
      api(
        "audit?code=" +
          encodeURIComponent(auditCode || "") +
          "&offset=" +
          auditOffset,
      ),
    ]);
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
    const codes = [
      ...new Set([...rooms.map((room) => room.code), ...auditResult.rooms]),
    ];
    if (auditCode === null && codes.length) {
      auditCode = codes[0];
      auditResult = await api("audit?code=" + auditCode);
    }
    $("audit-room").replaceChildren();
    for (const code of ["", ...codes]) {
      const option = el("option", code ? "房间 " + code : "平台操作（无房间）");
      option.value = code;
      $("audit-room").append(option);
    }
    $("audit-room").value = auditCode || "";
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
function renderAudit({ entries, total }) {
  $("audit").replaceChildren();
  $("audit").start = auditOffset + 1;
  $("audit-count").textContent = `共 ${total} 条 · 每页 100 条`;
  $("audit-page").textContent = `第 ${auditOffset / 100 + 1} 页`;
  $("audit-prev").disabled = auditOffset === 0;
  $("audit-next").disabled = auditOffset + 100 >= total;
  if (!entries.length) $("audit").append(el("p", "暂无操作记录"));
  const fields = {
    seat: "目标座位",
    team: "队伍座位",
    ready: "准备",
    board: "板子",
    capacity: "人数",
    visible: "展示技能过程",
    kind: "操作类型",
    actor: "行动座位",
    threshold: "失败票门槛",
    replace: "替换当前操作",
    flexible: "自由流程",
    keepPlaying: "继续对局",
    revision: "版本",
  };
  for (const entry of entries) {
    const item = el("li", "");
    const d = entry.details || {};
    item.append(el("time", new Date(entry.created).toLocaleString()));
    const actor = d.player
      ? `${d.player.seat}号 ${d.player.name}（${labels[entry.action]}）`
      : entry.action === "companion"
        ? "陪测玩家（旧记录）"
        : "管理员";
    item.append(
      el(
        "div",
        `${actor} · ${d.label || labels[entry.action] || entry.action}${d.choice ? "：" + d.choice : ""}${entry.reason ? " · " + entry.reason : ""}`,
      ),
    );
    if (d.game !== undefined)
      item.append(
        el(
          "div",
          `第 ${d.game} 局 · ${d.phase}${d.round ? " · 第 " + d.round + " 轮" : ""}`,
        ),
      );
    const parameters = Object.entries(d.parameters || {}).map(
      ([key, value]) =>
        `${fields[key] || key}：${typeof value === "boolean" ? (value ? "是" : "否") : Array.isArray(value) ? value.join("、") : value}`,
    );
    if (parameters.length) item.append(el("div", parameters.join(" · ")));
    $("audit").append(item);
  }
}
$("audit-room").addEventListener("change", () => {
  auditCode = $("audit-room").value;
  auditOffset = 0;
  refresh();
});
$("audit-prev").addEventListener("click", () => {
  if (loading) return;
  auditOffset = Math.max(0, auditOffset - 100);
  refresh();
});
$("audit-next").addEventListener("click", () => {
  if (loading) return;
  auditOffset += 100;
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
