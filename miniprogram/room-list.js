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
  function present(rooms, filter = "all", now = Date.now()) {
    const unavailable = rooms.filter(r => r.available === false || r.status === "unavailable");
    const available = rooms.filter(r => r.available !== false && r.status !== "unavailable");
    const ended = available.filter(r => r.status === "ended").sort(byActivity);
    const recent = ended.filter(r => activity(r) > now - HISTORY_AFTER).slice(0, 3);
    const recentCodes = new Set(recent.map(r => r.code));
    const current = available.filter(r => r.status !== "ended" && (filter === "all" || r.status === filter));
    const showEnded = filter === "all" || filter === "ended";
    const showUnavailable = filter === "all" || filter === "unavailable";
    const visibleRecent = showEnded ? recent.map((r, i) => ({ ...r, sectionLabel: i === 0 ? "最近结束" : "" })) : [];
    return {
      visibleMemberRooms: [...current, ...visibleRecent],
      currentRoomCount: current.length + visibleRecent.length,
      recentRoomCount: visibleRecent.length,
      historyRooms: [
        ...(showEnded ? ended.filter(r => !recentCodes.has(r.code)) : []),
        ...(showUnavailable ? unavailable : []),
      ].sort(byActivity),
      unavailableRooms: unavailable,
      historyUnavailableCount: showUnavailable ? unavailable.length : 0,
      showHistorySection: showEnded || showUnavailable,
    };
  }
  function cleanupNotice(removed) {
    return removed ? "已移除 " + removed + " 个失效房间" : "牌桌状态已更新，暂无需要清理的失效房间";
  }
  return { activity, present, cleanupNotice, HISTORY_AFTER };
});
