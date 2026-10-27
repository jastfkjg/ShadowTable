// Presentation follows the active request and its scheduled retry deadline.
const initial = { connectionPhase: "", connectionTitle: "", connectionDetail: "",
  connectionElapsedSeconds: 0, connectionRetrySeconds: 0, connectionCanRetry: true };
function retryDelay(attempts, random = Math.random()) {
  return Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(0, (attempts || 1) - 1))) * (0.8 + random * 0.2);
}
function pendingHint(pending, uncertain) {
  if (!uncertain && !pending) return "";
  if (pending?.after === "enter") return pending.path === "/api/rooms"
    ? "正在找回建房结果，请勿重复创建" : "正在找回入座结果，请勿重复加入";
  return ({ entryVisit: "正在恢复刚才的入桌，请稍候", entryHide: "正在确认移除记录，请勿重复操作",
    entryNote: "正在保存牌桌备注，请勿重复操作", delete: "正在确认解散房间，请勿重复操作",
    leave: "正在确认离开房间，请勿重复操作" })[pending?.after] || "上次操作还在确认，请勿重复操作";
}
function present(data, runtime = {}, now = Date.now()) {
  const active = !!runtime.active;
  const hint = pendingHint(runtime.pending, data.hasPendingRequest);
  const seconds = Math.max(0, Math.ceil(((runtime.retryAt || 0) - now) / 1000));
  const limited = now < (runtime.rateLimitUntil || 0);
  const phase = !data.network ? "offline" : active ? "connecting" : data.needsLogin ? "login"
    : data.reconnecting || data.hasPendingRequest ? "waiting" : "idle";
  const canRetry = ["waiting", "offline", "login"].includes(phase) && !active &&
    !data.loading && !data.busy && !data.roomsRefreshing && !limited;
  let title = "", detail = "";
  if (phase === "connecting") {
    title = data.reconnecting || hint || runtime.failure ? "正在重新连接" : runtime.context === "page" ? "正在连接服务" : "正在连接牌桌";
    detail = hint || (runtime.context === "page" ? "连上后会自动更新页面" : data.room || data.memberRooms?.length ? "连上后会自动更新牌桌" : "连接后即可创建或加入房间");
  } else if (phase === "waiting") {
    title = runtime.failure === "timeout" ? "连接超时" : runtime.failure === "rate" ? "连接繁忙，请稍候" : "暂时无法连接";
    detail = seconds ? seconds + "秒后自动重试" + (hint ? "，请勿重复操作" : canRetry ? "，也可手动连接" : "")
      : runtime.retryAt ? "即将自动重试" : hint || (runtime.context === "page" ? "可重新连接后重试原操作" : "可重新连接以更新牌桌");
  } else if (phase === "offline") {
    title = "网络已断开";
    detail = hint ? "请检查网络，请勿重复上次操作" : "请检查 Wi-Fi 或移动网络";
  } else if (phase === "login") {
    title = "登录已过期"; detail = runtime.context === "page" ? "重新登录后即可更新页面" : "重新登录后即可同步牌桌";
  }
  return { connectionPhase: phase, connectionTitle: title, connectionDetail: detail,
    connectionElapsedSeconds: active && Number.isFinite(runtime.startedAt) ? Math.max(0, Math.floor((now - runtime.startedAt) / 1000)) : 0,
    connectionRetrySeconds: seconds, connectionCanRetry: canRetry };
}
module.exports = { initial, present, retryDelay, pendingHint };
