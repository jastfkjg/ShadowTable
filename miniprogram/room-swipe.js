/* Shared gesture rules for the personal room list on both clients. */
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableRoomSwipe = value;
})(typeof window === "undefined" ? this : window, function () {
  function canDissolve(room) {
    return !!room && room.isHost === true && room.available !== false && ["lobby", "ended"].includes(room.status);
  }
  // Stacked actions share one rail, whether the room offers one or two buttons.
  function width() { return 124; }
  function start(room, point, opened) {
    return { code: room.code, x: point.x, y: point.y, width: width(room),
      initial: opened ? -width(room) : 0, offset: opened ? -width(room) : 0, axis: "" };
  }
  function move(gesture, point) {
    const dx = point.x - gesture.x, dy = point.y - gesture.y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
      if (Math.abs(dx) > Math.abs(dy) * 1.2) gesture.axis = "x";
      else if (Math.abs(dy) >= Math.abs(dx)) gesture.axis = "y";
    }
    if (gesture.axis === "x") gesture.offset = Math.max(-gesture.width, Math.min(0, gesture.initial + dx));
    return gesture;
  }
  function settle(gesture, cancelled = false) {
    if (cancelled || gesture.axis === "y") return 0;
    if (!gesture.axis) return gesture.initial;
    return gesture.offset <= -Math.min(48, gesture.width * 0.4) ? -gesture.width : 0;
  }
  return { canDissolve, width, start, move, settle };
});
