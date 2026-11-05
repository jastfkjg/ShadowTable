/* Shared personal-room presentation. History never changes room membership. */
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableRoomList = value;
})(typeof window === "undefined" ? this : window, function () {
  const HISTORY_AFTER = 3 * 86400000;
  function activity(room) {
    return room.lastActivityAt || room.updatedAt || room.createdAt || 0;
  }
  function byActivity(a, b) {
    return activity(b) - activity(a) || (b.lastEnteredAt || 0) - (a.lastEnteredAt || 0) || a.code.localeCompare(b.code);
  }
  function availableRooms(rooms) {
    return rooms.filter(r => r.available !== false && r.status !== "unavailable");
  }
  function present(rooms, filter = "all", now = Date.now()) {
    const available = availableRooms(rooms);
    const ended = available.filter(r => r.status === "ended").sort(byActivity);
    const recent = ended.filter(r => activity(r) > now - HISTORY_AFTER).slice(0, 3);
    const recentCodes = new Set(recent.map(r => r.code));
    const current = available.filter(r => r.status !== "ended" && (filter === "all" || r.status === filter));
    const showEnded = filter === "all" || filter === "ended";
    const visibleRecent = showEnded ? recent.map((r, i) => ({ ...r, sectionLabel: i === 0 ? "最近结束" : "" })) : [];
    return {
      visibleMemberRooms: [...current, ...visibleRecent],
      availableRoomCount: available.length,
      currentRoomCount: current.length + visibleRecent.length,
      recentRoomCount: visibleRecent.length,
      historyRooms: showEnded ? ended.filter(r => !recentCodes.has(r.code)) : [],
      showHistorySection: showEnded,
    };
  }
  function cleanupNotice(removed) {
    return removed ? "已移除 " + removed + " 个失效房间" : "牌桌状态已更新，暂无需要清理的失效房间";
  }
  function currentRoom(rooms) {
    const active = rooms.filter(row => /^\d{6}$/.test(row.code || "") && row.available !== false && row.isMember !== false && ["playing", "lobby"].includes(row.status));
    active.sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing") || Number(b.seat != null) - Number(a.seat != null) || (b.lastEnteredAt || b.updatedAt || 0) - (a.lastEnteredAt || a.updatedAt || 0));
    const room = active[0];
    return room ? { ...room, statusLabel: room.status === "playing" ? "进行中" : "待开局",
      boardLabel: (room.boardName || "阿瓦隆").replace(/^阿瓦隆\s*·\s*/, "").replace(/（\d+人）$/, ""),
      relationLabel: room.seat != null ? "我在 " + room.seat + " 号" : room.isHost ? "我是房主" : "旁观中" } : null;
  }
  return { activity, availableRooms, present, cleanupNotice, currentRoom, HISTORY_AFTER };
});
