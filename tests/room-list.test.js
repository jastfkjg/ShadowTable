const { test } = require("node:test");
const assert = require("node:assert/strict");
const { present, activity, HISTORY_AFTER } = require("../miniprogram/room-list");
const now = Date.parse("2026-10-17T12:00:00+08:00");
const room = (code, status, ago = 0, extra = {}) => ({ code, status, available: true, updatedAt: now - ago, ...extra });

test("最近结束最多三桌，其余有效记录归入历史，失效记录自动隐藏", () => {
  const rooms = [room("111111", "playing", 30 * HISTORY_AFTER), room("222222", "lobby", 20 * HISTORY_AFTER),
    room("333333", "ended", 1000), room("444444", "ended", 4000), room("555555", "ended", 3000),
    room("666666", "ended", 2000), room("777777", "ended", HISTORY_AFTER), room("888888", "unavailable", 0, { available: false })];
  const result = present(rooms, "all", now);
  assert.deepEqual(result.visibleMemberRooms.map(r => r.code), ["111111", "222222", "333333", "666666", "555555"]);
  assert.equal(result.visibleMemberRooms.filter(r => r.sectionLabel === "最近结束").length, 1);
  assert.deepEqual(result.historyRooms.map(r => r.code), ["444444", "777777"]);
  assert.equal(result.availableRoomCount, 7);
  assert.equal(result.currentRoomCount, 5);
  assert.equal(result.recentRoomCount, 3);
  assert.deepEqual([...result.visibleMemberRooms, ...result.historyRooms].map(r => r.code).sort(), rooms.filter(r => r.available).map(r => r.code).sort());
  assert.equal(rooms.some(r => r.sectionLabel), false);
});
test("72小时边界按最后活动判定，其他成员访问可以让历史牌桌恢复最近结束", () => {
  const recent = room("111111", "ended", HISTORY_AFTER + 1, { lastActivityAt: now - 1 });
  assert.equal(activity(recent), now - 1);
  assert.equal(present([recent], "all", now).visibleMemberRooms.length, 1);
  assert.equal(present([recent], "all", now + HISTORY_AFTER - 1).historyRooms.length, 1);
  assert.equal(present([room("222222", "ended", HISTORY_AFTER - 1)], "all", now).visibleMemberRooms.length, 1);
});
test("筛选不打破最近三桌上限，统一历史只包含符合状态的记录", () => {
  const rooms = [room("111111", "playing"), room("222222", "lobby"),
    ...Array.from({ length: 5 }, (_, i) => room(String(333330 + i), "ended")), room("444444", "unavailable", 0, { available: false })];
  const ended = present(rooms, "ended", now);
  assert.equal(ended.visibleMemberRooms.length, 3); assert.equal(ended.historyRooms.length, 2);
  assert.ok(ended.historyRooms.every(r => r.status === "ended"));
  const playing = present(rooms, "playing", now);
  assert.deepEqual(playing.visibleMemberRooms.map(r => r.code), ["111111"]);
  assert.equal(playing.showHistorySection, false); assert.equal(playing.historyRooms.length, 0);
  assert.equal(playing.recentRoomCount, 0);
  assert.ok([...ended.visibleMemberRooms, ...ended.historyRooms].every(r => r.available !== false));
});
test("失效标记的任一形式都会被隐藏，仅有失效记录时按空列表展示且不改写原记录", () => {
  const rooms = [room("111111", "ended", 0, { available: false }), room("222222", "unavailable"), room("333333", "playing", 0, { available: false })];
  const original = structuredClone(rooms);
  const result = present(rooms, "all", now);
  assert.equal(result.availableRoomCount, 0);
  assert.deepEqual(result.visibleMemberRooms, []);
  assert.deepEqual(result.historyRooms, []);
  assert.deepEqual(rooms, original);
});
test("旧服务时间字段降级、空列表和无时间旧记录均保留可访问入口", () => {
  const legacy = { code: "111111", status: "ended", createdAt: now };
  assert.equal(present([legacy], "all", now).visibleMemberRooms.length, 1);
  delete legacy.createdAt;
  assert.equal(present([legacy], "all", now).historyRooms.length, 1);
  assert.equal(present([], "all", now).currentRoomCount, 0);
});
