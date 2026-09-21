"use strict";

// Keep saved knight rooms (including pending results) readable in place.
function state(room) {
  return room.knights || room.fairy;
}
function enabled(room) {
  return (
    room.capacity >= 7 &&
    (room.fairyEnabled ?? (room.roles ? !!state(room) : room.capacity >= 8))
  );
}
function init(room) {
  if (room.knights || room.fairy) return;
  room.fairy = {
    fairy: room.leader,
    fairyVisited: [],
    players: Object.fromEntries(room.players.map((p) => [p.uid, {}])),
  };
}
function holder(room) {
  return enabled(room) ? state(room)?.fairy || null : null;
}
function result(room, uid) {
  return state(room)?.players[uid];
}
function targets(room) {
  const s = state(room);
  return room.players.filter(
    (p) =>
      p.seat !== s.fairy &&
      !s.fairyVisited.includes(p.seat) &&
      (!room.knights || room.knights.players[p.uid].alive),
  );
}
function action(room, uid) {
  if (
    !enabled(room) ||
    room.players.find((p) => p.uid === uid)?.seat !== holder(room)
  )
    return null;
  const options = targets(room).map((p) => ({
    value: `target:${p.seat}`,
    label: `查验 ${p.seat}号并传递仙女`,
  }));
  return {
    kind: "choice",
    label: "选择查验目标并传递仙女",
    choices: options.map((o) => o.value),
    options,
  };
}
function settle(room, faction) {
  const s = state(room);
  const owner = room.players.find((p) => p.seat === s.fairy);
  const targetSeat = Number(room.submissions[owner.uid].split(":")[1]);
  const target = room.players.find((p) => p.seat === targetSeat);
  const player = s.players[owner.uid];
  player.fairyRevision =
    (player.fairyRevision || (player.fairyInfo ? 1 : 0)) + 1;
  const side = { good: "好人", evil: "坏人", third: "盗贼阵营" }[
    faction(room, target.uid)
  ];
  player.fairyInfo = `${targetSeat}号查验结果：${side}（第${room.round}轮）`;
  s.fairyVisited.push(s.fairy);
  s.fairy = targetSeat;
  s.fairyRound = room.round;
}
module.exports = {
  state,
  enabled,
  init,
  holder,
  result,
  targets,
  action,
  settle,
};
