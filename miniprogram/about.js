/* Shared About dialog content for the mini-program and web client. */
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableAbout = value;
})(typeof window === "undefined" ? this : window, function () {
  function present() {
    return {
      variant: "about",
      title: "关于桌边助手",
      subtitle: "为面对面的阿瓦隆聚会而做",
      content: "身份、投票与技能，交给助手。\n讨论、推理与故事，留给朋友。",
      emphasis: "留给朋友",
      contextIcon: "/assets/about-merlin.svg",
      showCancel: false,
      confirmText: "知道了",
    };
  }
  return { present };
});
