/* Shared confirmation copy and context for personal room actions. */
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableRoomConfirmation = value;
})(typeof window === "undefined" ? this : window, function () {
  function present(kind, room = {}) {
    const isHost = room.me ? room.me.isHost : room.isHost;
    const actions = {
      hide: { title: "移除房间记录？", content: "仅从你的列表中移除。\n房间、座位和战绩都会保留。", confirmText: "移除记录" },
      leave: { title: "离开房间？", content: "释放你的座位，房间继续保留。" + (isHost ? "\n房主离开后仍保留管理权。" : ""), confirmText: "离开房间" },
      delete: { title: "解散房间？", content: "所有玩家将退出，进行中的对局不判胜负，房间将被删除且无法恢复。", confirmText: "解散房间", danger: true, emphasis: "无法恢复" },
    };
    return {
      ...actions[kind], variant: "room-confirm", contextLabel: "房间", contextValue: String(room.code || ""),
      contextMeta: room.available === false ? "已失效" : room.statusLabel || ({ lobby: "待开局", playing: "进行中", ended: "已结束", unavailable: "已失效" })[room.status] || (room.phase === "lobby" ? "待开局" : room.phase === "ended" ? "已结束" : room.phase ? "进行中" : ""),
      contextIcon: "/assets/home-table-blue.svg",
    };
  }
  return { present };
});
