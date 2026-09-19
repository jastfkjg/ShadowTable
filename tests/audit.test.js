"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Store } = require("../server/store");
const { newRoom } = require("../server/engine");
const { actionDetails, auditGroups } = require("../server/audit");

test("阶段快照记录完整座位和目标昵称，区分放弃技能与尚未提交", () => {
  const room = newRoom("123456", "a", "玩家甲");
  room.players.push({ uid: "b", name: "玩家乙", seat: 2 });
  room.phase = "skillPrepare";
  room.roles = { a: "assassin", b: "magician" };
  room.knights = {
    round: 1,
    players: {
      a: { alive: true, used: false, availableRound: 1 },
      b: { alive: true, used: false, availableRound: 1 },
    },
  };
  const strike = actionDetails(room, "a", "submit", { value: "target:2" });
  assert.equal(strike.choice, "对 2号·玩家乙开刀");
  assert.equal(strike.stage, room.stage);
  assert.deepEqual(strike.participants, [
    { seat: 1, name: "玩家甲", role: "刺客", required: true },
    { seat: 2, name: "玩家乙", role: "魔术师", required: true },
  ]);
  const pass = actionDetails(room, "b", "submit", { value: "pass" });
  assert.equal(pass.value, "pass");
  const swap = actionDetails(room, "b", "submit", { value: "swap:1:2" });
  assert.equal(swap.choice, "秘密换号 1号·玩家甲 ↔ 2号·玩家乙");
  assert.equal(swap.player.role, "魔术师");
  room.roles.b = "redHunter";
  room.players[1].name = "改名后";
  assert.equal(swap.player.role, "魔术师");
  assert.equal(strike.participants[1].role, "魔术师");
  assert.equal(strike.participants[1].name, "玩家乙");
});

test("按完整阶段分页，超过100条仍同组，同名新阶段分开且房间隔离", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const insert = store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created,details) VALUES('player',?,'',1,?)",
  );
  const room = newRoom("123456", "a", "玩家甲");
  room.stage = "stage-20";
  store.save(room);
  for (let stage = 0; stage < 21; stage++) {
    const count = stage === 20 ? 105 : 1;
    for (let i = 0; i < count; i++)
      insert.run(
        room.code,
        JSON.stringify({
          stage: `stage-${stage}`,
          game: 1,
          phase: "放技能",
          command: "submit",
        }),
      );
  }
  insert.run("654321", JSON.stringify({ stage: "stage-20", phase: "放技能" }));
  const first = auditGroups(store, room.code, 0);
  assert.equal(first.total, 21);
  assert.equal(first.groups.length, 20);
  assert.equal(first.groups[0].entries.length, 105);
  assert.equal(first.groups[0].active, true);
  assert.equal(first.groups[1].active, false);
  assert.ok(
    first.groups.every((group) =>
      group.entries.every((entry) => entry.code === room.code),
    ),
  );
  const second = auditGroups(store, room.code, 20);
  assert.equal(second.groups.length, 1);
  assert.equal(second.groups[0].entries[0].details.stage, "stage-0");
});

test("旧记录只合并连续同阶段，不将跨阶段的同名操作合并", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const insert = store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created,details) VALUES('player','123456','',1,?)",
  );
  for (const phase of ["放技能", "放技能", "投票", "放技能"])
    insert.run(JSON.stringify({ phase, game: 1, round: 1 }));
  insert.run("{}");
  const result = auditGroups(store, "123456", 0);
  assert.deepEqual(
    result.groups.map((group) => group.entries.length),
    [1, 1, 1, 2],
  );
  assert.ok(result.groups.every((group) => !group.active));
});

test("技能记录保存发起时间，猎人和圣骑士追加阶段沿用同次技能时间", () => {
  const { enter, command } = require("../server/engine");
  const room = newRoom("123456", "p1", "房主", "knights", 12);
  for (let i = 2; i <= 12; i++) enter(room, `p${i}`, `玩家${i}`);
  const run = (uid, type, extra = {}) =>
    command(room, uid, { type, stage: room.stage, ...extra });
  for (const p of room.players) run(p.uid, "ready", { ready: true });
  run("p1", "start", { flexible: true });
  for (const p of room.players) {
    room.roles[p.uid] = "servant";
    Object.assign(room.knights.players[p.uid], {
      armor: false,
      used: false,
      b: false,
    });
  }
  Object.assign(room.roles, {
    p1: "blueAwakened",
    p2: "redHunter",
    p3: "paladin",
  });
  const before = Date.now();
  run("p1", "beginActivity", { kind: "skills" });
  const startedAt = room.activity.startedAt;
  assert.ok(startedAt >= before && startedAt <= Date.now());
  assert.equal(
    actionDetails(room, "p1", "submit", { value: "target:2" })
      .activityStartedAt,
    startedAt,
  );
  for (const p of room.players)
    run(p.uid, "submit", { value: p.uid === "p1" ? "target:2" : "pass" });
  assert.equal(room.phase, "paladinTurn");
  assert.equal(
    actionDetails(room, "p3", "submit", { value: "pass" }).activityStartedAt,
    startedAt,
  );
  for (const p of room.players) run(p.uid, "submit", { value: "pass" });
  assert.equal(room.phase, "hunterTurn");
  const shot = actionDetails(room, "p2", "submit", { value: "target:4" });
  assert.equal(shot.activityStartedAt, startedAt);
  assert.equal(shot.player.role, "红猎人");
});
