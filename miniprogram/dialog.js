// All app-authored alerts use the current page's shared dialog host.
function show(options = {}) {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const host = pages[pages.length - 1]?.selectComponent?.("#app-dialog");
  if (host) return host.show(options);
  const result = { confirm: false, cancel: true, errMsg: "showDialog:cancel" };
  options.success?.(result);
  options.complete?.(result);
  return Promise.resolve(result);
}

function present(options = {}) {
  const emphasisAt = options.emphasis ? (options.content || "").indexOf(options.emphasis) : -1;
  return {
    ...(options.variant === "room-confirm" ? { variant: "room-confirm", emphasis: emphasisAt >= 0 ? options.emphasis : "", contentBefore: emphasisAt >= 0 ? options.content.slice(0, emphasisAt) : "", contentAfter: emphasisAt >= 0 ? options.content.slice(emphasisAt + options.emphasis.length) : "" } : {}),
    ...(options.variant === 'badge-awards' ? { variant: 'badge-awards', awards: options.awards } : {}),
    ...(options.variant === "avoidance-grant" ? { variant: "avoidance-grant", lead: typeof options.lead === "string" ? options.lead : "" } : {}),
    title: options.title || "操作提示",
    content: options.content || "",
    contextLabel: options.contextLabel || "",
    contextValue: options.contextValue || "",
    contextMeta: options.contextMeta || "",
    contextIcon: options.contextIcon || "/assets/dialog-room.svg",
    showCancel: options.showCancel !== false,
    cancelText: options.cancelText || "取消",
    confirmText: options.confirmText || (options.showCancel === false ? "知道了" : "确定"),
    danger: options.danger === true,
  };
}

module.exports = { show, present };
