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
  test(`${board}：开局后加入旁观不改变参赛名单，不获身份、不参与提交、不阻塞结算`, () => {
    const r = newRoom("123456", "host", "房主", board, capacity);
    run(r, "host", "stand");
    for (let i = 1; i <= capacity; i++) enter(r, `p${i}`, `玩家${i}`);
    enter(r, "watcher", "围观者");
    assert.equal(roomSummary(r, "watcher").isMember, true);
    for (const p of r.players) run(r, p.uid, "ready", { ready: true });
    run(r, "host", "start", { flexible: true });
    const participants = structuredClone(r.players), roles = structuredClone(r.roles), stage = r.stage;
    enter(r, "lateWatcher", "迟到者");
    enter(r, "lateWatcher", "重复加入");
    assert.deepEqual(r.players, participants);
    assert.deepEqual(r.roles, roles);
    assert.equal(r.stage, stage);
    assert.equal(r.spectators.filter(p => p.uid === "lateWatcher").length, 1);
    assert.equal(publicView(r, "lateWatcher").me.name, "迟到者");
    assert.equal(Object.keys(r.roles).length, capacity);
    for (const uid of ["host", "watcher", "lateWatcher"]) {
      assert.equal(r.roles[uid], undefined);
      assert.equal(publicView(r, uid).needsSubmission, false);
      assert.equal(publicView(r, uid).me.identityChanged, false);
      assert.equal(actionSpec(r, uid), null);
      assert.throws(() => privateView(r, uid), /没有身份/);
      assert.throws(() => run(r, uid, "seat", { seat: 1 }), /对局中/);
      assert.throws(() => run(r, uid, "stand"), /对局中/);
    }
    run(r, "host", "beginActivity", { kind: "vote", team: [1, 2] });
    enter(r, "duringVote", "投票期间加入");
    assert.equal(publicView(r, "duringVote").needsSubmission, false);
    assert.equal(publicView(r, "host").operationProgress.total, capacity);
    assert.throws(() => run(r, "watcher", "submit", { value: "approve" }), /没有秘密操作/);
    assert.throws(() => run(r, "duringVote", "submit", { value: "approve" }), /没有秘密操作/);
    for (const p of r.players) run(r, p.uid, "submit", { value: "approve" });
    assert.equal(r.phase, "tools");
    run(r, "host", "finishTools");
    assert.deepEqual(r.matchRecord.players.map(p => p.uid), participants.map(p => p.uid));
    run(r, "host", "rematch");
    assert.equal(publicView(r, "lateWatcher").me.seat, null);
    run(r, "p1", "stand");
    run(r, "watcher", "seat", { seat: 1 });
    assert.equal(publicView(r, "watcher").me.ready, false);
  });
}

for (const ending of ["finishTools", "terminate"]) {
  test(`${ending}：终局有空位时新成员仍旁观，重开不自动入座，手动入座才参与下一局`, () => {
    const r = newRoom("123456", "host", "房主");
    for (let i = 2; i <= r.capacity; i++) enter(r, `p${i}`, `玩家${i}`);
    r.players.forEach(p => run(r, p.uid, "ready", { ready: true }));
    run(r, "host", "start", { flexible: true });
    run(r, "host", ending, { winner: "good" });
    const record = structuredClone(r.matchRecord);
    const targetId = publicView(r, "host").players.find(p => p.seat === 2).managementId;
    run(r, "host", "kick", { seat: 2, targetId, confirm: true });
    enter(r, "late", "新朋友");
    enter(r, "p2", "重新加入");
    assert.deepEqual(r.matchRecord, record);
    assert.equal(r.players.length, r.capacity - 1);
    for (const uid of ["late", "p2"]) {
      assert.equal(publicView(r, uid).me.seat, null);
      assert.throws(() => privateView(r, uid), /没有身份/);
      assert.throws(() => run(r, uid, "seat", { seat: 2 }), /对局中/);
    }
    run(r, "host", "rematch");
    enter(r, "late", "再次进入");
    assert.equal(publicView(r, "late").me.seat, null);
    assert.equal(publicView(r, "late").me.ready, false);
    assert.equal(r.players.length, r.capacity - 1);
    run(r, "late", "seat", { seat: 2 });
    assert.equal(publicView(r, "late").me.seat, 2);
    r.players.forEach(p => run(r, p.uid, "ready", { ready: true }));
    run(r, "host", "start", { flexible: true });
    assert.ok(privateView(r, "late").role);
    assert.equal(publicView(r, "p2").me.seat, null);
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
