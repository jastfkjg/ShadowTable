const { test } = require("node:test");
const assert = require("node:assert/strict");
const { present, activity, HISTORY_AFTER } = require("../miniprogram/room-list");
const now = Date.parse("2026-10-17T12:00:00+08:00");
const room = (code, status, ago = 0, extra = {}) => ({ code, status, available: true, updatedAt: now - ago, ...extra });

test("已结束牌桌以全房活动排序，最近最多三桌，其余完整收进历史", () => {
  const rooms = [room("111111", "playing", 30 * HISTORY_AFTER), room("222222", "lobby", 20 * HISTORY_AFTER),
    room("333333", "ended", 1000), room("444444", "ended", 4000), room("555555", "ended", 3000),
    room("666666", "ended", 2000), room("777777", "ended", HISTORY_AFTER), room("888888", "unavailable", 0, { available: false })];
  const result = present(rooms, "all", now);
  assert.deepEqual(result.visibleMemberRooms.map(r => r.code), ["111111", "222222", "333333", "666666", "555555"]);
  assert.equal(result.visibleMemberRooms.filter(r => r.sectionLabel === "最近结束").length, 1);
  assert.deepEqual(result.historyRooms.map(r => r.code), ["444444", "777777"]);
  assert.deepEqual(result.unavailableRooms.map(r => r.code), ["888888"]);
  assert.equal(result.currentRoomCount, 5);
  assert.equal(result.recentRoomCount, 3);
  assert.equal(new Set([...result.visibleMemberRooms, ...result.historyRooms, ...result.unavailableRooms].map(r => r.code)).size, rooms.length);
  assert.equal(rooms.some(r => r.sectionLabel), false);
});
test("72小时边界按最后活动判定，其他成员访问可以让历史牌桌恢复最近结束", () => {
  const recent = room("111111", "ended", HISTORY_AFTER + 1, { lastActivityAt: now - 1 });
  assert.equal(activity(recent), now - 1);
  assert.equal(present([recent], "all", now).visibleMemberRooms.length, 1);
  assert.equal(present([recent], "all", now + HISTORY_AFTER - 1).historyRooms.length, 1);
  assert.equal(present([room("222222", "ended", HISTORY_AFTER - 1)], "all", now).visibleMemberRooms.length, 1);
});
test("筛选不打破最近三桌上限，历史和失效独立于当前牌桌", () => {
  const rooms = [room("111111", "playing"), room("222222", "lobby"),
    ...Array.from({ length: 5 }, (_, i) => room(String(333330 + i), "ended")), room("444444", "unavailable", 0, { available: false })];
  const ended = present(rooms, "ended", now);
  assert.equal(ended.visibleMemberRooms.length, 3); assert.equal(ended.historyRooms.length, 2);
  assert.equal(ended.showUnavailableSection, false);
  const playing = present(rooms, "playing", now);
  assert.deepEqual(playing.visibleMemberRooms.map(r => r.code), ["111111"]);
  assert.equal(playing.showHistorySection, false); assert.equal(playing.showUnavailableSection, false);
  assert.equal(playing.recentRoomCount, 0);
  const unavailable = present(rooms, "unavailable", now);
  assert.equal(unavailable.visibleMemberRooms.length, 0); assert.equal(unavailable.showHistorySection, false);
  assert.equal(unavailable.showUnavailableSection, true);
});
test("旧服务时间字段降级、空列表和无时间旧记录均保留可访问入口", () => {
  const legacy = { code: "111111", status: "ended", createdAt: now };
  assert.equal(present([legacy], "all", now).visibleMemberRooms.length, 1);
  delete legacy.createdAt;
  assert.equal(present([legacy], "all", now).historyRooms.length, 1);
  assert.equal(present([], "all", now).currentRoomCount, 0);
});
