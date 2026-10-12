const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { Store } = require("../server/store");
const { createApp } = require("../server/app");
const { publicView, privateView } = require("../server/engine");
const { presentReplay, trajectory } = require("../miniprogram/replay");
const { setup, completed, run, task, skills, submit } = require("./helpers/replay-fixtures");

test("完整复盘保留初始身份、当时阵营、同时互刀、抽牌顺序和最终计分，主流程结果不变", () => {
  const room = completed(), record = room.matchRecord;
  assert.equal(record.winner, "evil"); assert.equal(record.players[4].score.total, 1);
  assert.equal(record.replay.complete, true); assert.equal(record.replay.initialPlayers[5].roleId, "gaheris");
  const events = record.replay.events;
  assert.deepEqual(events.filter(e => e.kind === "quest").map(e => e.success), [true, false, true, true]);
  assert.equal(events.find(e => e.kind === "quest" && e.round === 2).cards.find(c => c.actor.seat === 9).value, "fail");
  const conversion = events.find(e => e.kind === "conversion");
  assert.equal(conversion.changes.find(c => c.seat === 7).after.faction, "evil");
  const mutual = events.find(e => e.kind === "skills" && e.round === 2);
  assert.deepEqual(mutual.actions.filter(a => a.kind === "knife").map(a => [a.actor.seat, a.actor.faction, a.effect]), [[6, "good", "eliminated"], [7, "evil", "eliminated"]]);
  assert.deepEqual(mutual.draws.map(d => [d.before.seat, d.after.roleId, d.order]), [[7, "magician", 1], [6, "redKnight", 2]]);
  assert.deepEqual(mutual.summary.out, []);
  assert.doesNotMatch(JSON.stringify(record.replay), /wx:replay-|"uid"|"deck"|"submissions"/);
  const frozen = JSON.stringify(record.replay); room.replay.events.length = 0;
  assert.equal(JSON.stringify(record.replay), frozen);
});

test("秘密提交、进行中的技能和已作废操作不会成为有效复盘结果，公开接口不泄漏事实", () => {
  const room = setup();
  run(room, "beginActivity", { kind: "skills" });
  run(room, "submit", { value: "target:8" }, "wx:replay-5");
  assert.equal(room.replay.events.length, 0);
  const publicState = publicView(room, room.host);
  assert.doesNotMatch(JSON.stringify(publicState), /"replay"|"initialPlayers"|"draws"|target:8/);
  assert.ok(publicState.players.every(p => !Object.hasOwn(p, "role")));
  assert.doesNotMatch(JSON.stringify(privateView(room, "wx:replay-2")), /"replay"|target:8/);
  run(room, "cancelActivity");
  assert.equal(room.replay.events.filter(e => e.kind === "skills").length, 0);
  assert.equal(room.replay.events[0].kind, "canceled");
  assert.equal(room.knights.players["wx:replay-5"].used, false);
  const snapshot = JSON.stringify(room);
  assert.throws(() => run(room, "beginActivity", { kind: "quest", team: [99], threshold: 1 }));
  assert.equal(JSON.stringify(room), snapshot);
  run(room, "finishTools", { winner: "good" });
  const store = new Store(":memory:");
  try { store.save(room); assert.throws(() => store.replayFor("spectator", room.matchRecord.id), { status: 404 }); }
  finally { store.close(); }
});

test("复盘准确解释换号、守护、替死、反伤和复活甲，不改变技能结算", () => {
  const room = setup();
  Object.assign(room.roles, { "wx:replay-5": "blueAwakened", "wx:replay-6": "magician", "wx:replay-7": "blueGuard", "wx:replay-8": "paladin" });
  for (const seat of [5, 6, 7, 8]) room.knights.players["wx:replay-" + seat].b = true;
  skills(room, { 5: "target:9", 6: "swap:8:9", 7: "target:8" });
  const attack = room.replay.events.find(e => e.kind === "skills").actions.find(a => a.actor.seat === 5);
  assert.equal(attack.targets[0].seat, 9); assert.equal(attack.resolvedTargets[0].seat, 8); assert.equal(attack.effect, "reflected");
  assert.equal(room.knights.players["wx:replay-8"].alive, true);
  assert.ok(room.replay.events[0].actions.some(a => a.kind === "guard" && a.status === "notTriggered"));
  const armor = setup(); armor.roles["wx:replay-5"] = "blueAwakened";
  skills(armor, { 5: "target:1" });
  const draw = armor.replay.events[0].draws[0];
  assert.equal(draw.armor, true); assert.equal(draw.after.roleId, "merlin");
  const protectedRoom = setup(); protectedRoom.roles["wx:replay-6"] = "blueGuard";
  skills(protectedRoom, { 5: "target:8", 6: "target:8" });
  assert.equal(protectedRoom.replay.events[0].actions.find(a => a.actor.seat === 5).effect, "guarded");
  const substitute = setup(); substitute.roles["wx:replay-5"] = "blueAwakened"; substitute.roles["wx:replay-8"] = "witch";
  skills(substitute, { 5: "target:8", 8: "target:9" });
  assert.equal(substitute.replay.events[0].actions.find(a => a.actor.seat === 5).recipient.seat, 9);
});

test("投票弃权、仙女查验、重复转换和未触发被动枪均按真实结果记录", () => {
  const room = setup();
  run(room, "beginActivity", { kind: "vote", team: [1, 2, 3] });
  run(room, "submit", { value: "approve" }, room.host); run(room, "closeWaiting", { confirm: true });
  assert.equal(room.replay.events[0].votes.filter(v => v.approve === null).length, 11);
  room.knights.fairy = 1; run(room, "beginActivity", { kind: "fairy" });
  run(room, "submit", { value: "target:10" }, room.host);
  assert.equal(room.replay.events[1].target.faction, "evil");
  run(room, "beginActivity", { kind: "conversion" }); run(room, "beginActivity", { kind: "conversion" });
  assert.deepEqual(room.replay.events.filter(e => e.kind === "conversion").map(e => e.converted), [true, false]);
  room.roles["wx:replay-8"] = "redHunter";
  skills(room, { 8: "passive:5" });
  assert.equal(room.replay.events.find(e => e.kind === "skills").actions.find(a => a.actor.seat === 8).status, "notTriggered");
  run(room, "beginActivity", { kind: "skills" });
  run(room, "closeWaiting", { confirm: true });
  assert.equal(room.replay.events.filter(e => e.kind === "skills").at(-1).earlyClosed, true);
});

test("归档复盘在重开、删房和重启后保留，仅参与者可读，旧局明确显示缺失过程", () => {
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-replay-")), file = join(directory, "state.sqlite");
  let store = new Store(file);
  try {
    const room = completed(), id = room.matchRecord.id; store.save(room);
    assert.equal(store.matchFor("wx:replay-5", id).replayAvailable, true);
    assert.doesNotMatch(JSON.stringify(store.matchesFor("wx:replay-5")), /"replay":|"cards":|"draws":/);
    assert.doesNotMatch(JSON.stringify(store.statsFor("wx:replay-5").recent), /"replay":|"cards":|"draws":|"actor":|"recipient":/);
    assert.throws(() => store.replayFor("outsider", id), { status: 404 });
    const original = store.replayFor("wx:replay-5", id);
    run(room, "rematch"); store.save(room); assert.equal(room.replay, undefined); store.remove(room.code);
    store.close(); store = new Store(file);
    assert.deepEqual(store.replayFor("wx:replay-5", id), original);
    const saved = JSON.parse(store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id).snapshot);
    delete saved.replay;
    store.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(saved), id);
    const legacy = store.replayFor("wx:replay-5", id);
    assert.equal(legacy.status, "legacy"); assert.match(legacy.message, /未保存完整/);
    assert.equal(legacy.initialPlayers[4].roleId, "gareth");
    assert.doesNotMatch(JSON.stringify(legacy), /wx:replay-|"uid"|"merlins"|"code"/);
    delete saved.funFacts; store.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(saved), id);
    assert.equal(store.replayFor("wx:replay-5", id).initialPlayers[4].role, null);
    store.db.prepare("INSERT INTO match_controls(match_id,state,previous_state,reason,updated) VALUES(?,'deleted','active','删除',0)").run(id);
    assert.throws(() => store.replayFor("wx:replay-5", id), { status: 404 });
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("已开局的旧房间只记录启用后的过程，终止局和管理员不计战绩状态照实展示", () => {
  const room = setup(); delete room.replay; task(room, [1, 2, 3]);
  assert.equal(room.replay.complete, false); run(room, "terminate");
  const store = new Store(":memory:");
  try {
    store.save(room); const data = store.replayFor(room.host, room.matchRecord.id);
    assert.equal(data.status, "partial"); assert.equal(data.winner, null); assert.equal(data.final.label, "对局终止");
    store.db.prepare("INSERT INTO match_controls(match_id,state,previous_state,reason,updated) VALUES(?,'excluded','active','核对',0)").run(room.matchRecord.id);
    const excluded = store.replayFor(room.host, room.matchRecord.id);
    assert.equal(excluded.self.outcome, "excluded"); assert.equal(excluded.self.score.status, "excluded");
  } finally { store.close(); }
});

test("管理员更正胜方、目标或积分后，复盘结算采用当前归档，过程事实保持原样", () => {
  const store = new Store(":memory:");
  try {
    const room = completed(); store.save(room); const id = room.matchRecord.id;
    const original = JSON.stringify(store.replayFor("wx:replay-5", id).events);
    store.transaction(() => store.correctMatch(id, { revision: 0, scoreReason: "assassination", scoreTarget: 2, funActor: 10 }));
    const corrected = store.replayFor("wx:replay-5", id);
    assert.equal(corrected.winner, "good"); assert.equal(corrected.self.outcome, "win");
    assert.equal(corrected.final.targetSeat, 2); assert.equal(corrected.final.hit, false); assert.equal(corrected.final.corrected, true);
    assert.equal(JSON.stringify(corrected.events), original);
    assert.equal(corrected.self.score.total, store.matchFor("wx:replay-5", id).score.total);
  } finally { store.close(); }
});

test("复盘界面按实际技能周期分组，个人视角筛选行动与影响，零分不丢失", () => {
  const store = new Store(":memory:");
  try {
    const room = completed(); store.save(room); const raw = store.replayFor("wx:replay-5", room.matchRecord.id);
    const global = presentReplay(raw); assert.equal(global.rounds.length, 4); assert.equal(global.initialPlayers.length, 12);
    assert.equal(global.questLabel, "3 成功 / 1 失败"); assert.equal(global.replay.scoreLabel, "+1");
    assert.equal(global.rounds[3].events.find(e => e.kind === "skills").summary, "本轮无人使用技能");
    assert.equal(global.replay.final.actor.seat, 10); assert.equal(global.replay.final.target.seat, 1);
    assert.equal(presentReplay(raw, "mine", ["round-1"]).rounds[0].expanded, true);
    const mine = presentReplay(raw, "mine"); assert.equal(mine.initialPlayers.length, 1);
    assert.equal(mine.rounds[1].events.length, 0);
    const history = trajectory(raw, 7); assert.ok(history.steps.some(s => /好人 → 坏人/.test(s.detail)));
    assert.ok(history.steps.some(s => /魔术师/.test(s.text))); assert.equal(trajectory(raw, 99), null);
    raw.self.score = { status: "scored", total: 0, breakdown: [] };
    assert.equal(presentReplay(raw).replay.scoreLabel, "+0");
    const impacted = presentReplay(store.replayFor("wx:replay-8", room.matchRecord.id), "mine");
    assert.ok(impacted.rounds[0].events[0].rows.some(r => r.actorSeat === 5));
    raw.events = [{ id: "empty", kind: "knife", round: 5, targetSeat: 0, hit: true }];
    const empty = presentReplay(raw).rounds[0].events[0];
    assert.equal(empty.badge, "空刀"); assert.equal(empty.footer, "场上没有梅林");
  } finally { store.close(); }
});

test("复盘 HTTP 接口要求认证和本局参与资格，进行中记录、旁观者和已移除记录不可读取", async () => {
  const app = createApp({ database: ":memory:", devAuth: true });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const room = setup(), token = randomBytes(32).toString("hex"), outsider = randomBytes(32).toString("hex");
    const hash = value => createHash("sha256").update(value).digest("hex");
    app.store.addSession(hash(token), "wx:replay-5"); app.store.addSession(hash(outsider), "outsider"); app.store.save(room);
    const url = `http://127.0.0.1:${app.server.address().port}/api/me/matches/${room.matchId}/replay`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: "Bearer " + token } })).status, 404);
    run(room, "finishTools", { winner: "good" }); app.store.save(room);
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200); assert.equal((await response.json()).replay.initialPlayers.length, 12);
    assert.equal((await fetch(url, { headers: { Authorization: "Bearer " + outsider } })).status, 404);
    assert.equal((await fetch(url + "?view=all", { headers: { Authorization: "Bearer " + token } })).status, 400);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
