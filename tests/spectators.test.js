const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newRoom, enter, command, publicView, privateView, actionSpec, roomSummary } = require("../server/engine");
const { Store } = require("../server/store");
const run = (room, uid, type, extra = {}) => command(room, uid, { stage: room.stage, type, ...extra });

test("满员通过站起、换座、坐下互换，昵称和成员身份保留，双方取消准备", () => {
  const r = newRoom("123456", "p1", "甲");
  for (let i = 2; i <= 6; i++) enter(r, `p${i}`, `玩家${i}`);
  for (const p of r.players) run(r, p.uid, "ready", { ready: true });
  const membershipId = r.players[0].membershipId;
  run(r, "p1", "stand");
  assert.equal(publicView(r, "p1").me.seat, null);
  assert.equal(publicView(r, "p1").me.isHost, true);
  assert.equal(publicView(r, "p1").me.ready, false);
  assert.throws(() => run(r, "p1", "ready", { ready: true }), /入座/);
  assert.throws(() => run(r, "p1", "start"), /全员准备/);
  enter(r, "p1", "不同昵称");
  assert.equal(r.spectators.length, 1);
  run(r, "p2", "seat", { seat: 1 });
  run(r, "p1", "seat", { seat: 2 });
  assert.equal(r.spectators.length, 0);
  assert.equal(publicView(r, "p1").me.name, "甲");
  assert.equal(r.players.find(p => p.uid === "p1").membershipId, membershipId);
  assert.equal(publicView(r, "p2").me.ready, false);
  assert.equal(publicView(r, "p3").me.ready, true);
  assert.throws(() => run(r, "p3", "seat", { seat: 2 }), /占用/);
});

for (const [board, capacity] of [["classic", 6], ["knights", 12], ["chaos", 12]]) {
  test(`${board}：围观房主发牌，旁观不获身份、不参与提交、不阻塞结算`, () => {
    const r = newRoom("123456", "host", "房主", board, capacity);
    run(r, "host", "stand");
    for (let i = 1; i <= capacity; i++) enter(r, `p${i}`, `玩家${i}`);
    enter(r, "watcher", "围观者");
    assert.equal(roomSummary(r, "watcher").isMember, true);
    for (const p of r.players) run(r, p.uid, "ready", { ready: true });
    run(r, "host", "start", { flexible: true });
    assert.equal(Object.keys(r.roles).length, capacity);
    for (const uid of ["host", "watcher"]) {
      assert.equal(r.roles[uid], undefined);
      assert.equal(publicView(r, uid).needsSubmission, false);
      assert.equal(publicView(r, uid).me.identityChanged, false);
      assert.equal(actionSpec(r, uid), null);
      assert.throws(() => privateView(r, uid), /没有身份/);
      assert.throws(() => run(r, uid, "seat", { seat: 1 }), /对局中/);
      assert.throws(() => run(r, uid, "stand"), /对局中/);
    }
    run(r, "host", "beginActivity", { kind: "vote", team: [1, 2] });
    assert.throws(() => run(r, "watcher", "submit", { value: "approve" }), /没有秘密操作/);
    for (const p of r.players) run(r, p.uid, "submit", { value: "approve" });
    assert.equal(r.phase, "tools");
    run(r, "host", "finishTools");
    run(r, "host", "rematch");
    run(r, "p1", "stand");
    run(r, "watcher", "seat", { seat: 1 });
    assert.equal(publicView(r, "watcher").me.ready, false);
  });
}

test("围观成员落库后仍可从我的牌桌恢复，离开后移除成员关系", () => {
  const store = new Store(":memory:");
  try {
    const r = newRoom("123456", "host", "房主");
    enter(r, "guest", "客人");
    run(r, "guest", "stand");
    store.save(r);
    const restored = store.roomsFor("guest")[0];
    assert.equal(publicView(restored, "guest").me.seat, null);
    run(restored, "guest", "leave");
    store.save(restored);
    assert.equal(store.roomsFor("guest").length, 0);
    assert.throws(() => publicView(restored, "guest"), /不在/);
  } finally { store.close(); }
});
