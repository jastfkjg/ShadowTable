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
    { seat: 1, name: "玩家甲", required: true },
    { seat: 2, name: "玩家乙", required: true },
  ]);
  const pass = actionDetails(room, "b", "submit", { value: "pass" });
  assert.equal(pass.value, "pass");
  const swap = actionDetails(room, "b", "submit", { value: "swap:1:2" });
  assert.equal(swap.choice, "秘密换号 1号·玩家甲 ↔ 2号·玩家乙");
  room.players[1].name = "改名后";
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
