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
  return {
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
