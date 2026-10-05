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

test("操作记录分页不计入独立发起组，保留发起时产生的结算和未提交阶段", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const insert = store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created,details) VALUES('player','123456','',1,?)",
  );
  for (let i = 0; i < 21; i++) {
    insert.run(JSON.stringify({ command: "beginActivity", phaseKey: "tools", phase: "等待房主发起操作", stage: `old-${i}`, outcomes: [] }));
    insert.run(JSON.stringify({ command: "submit", phaseKey: "quest", phase: "任务出牌", stage: `quest-${i}` }));
  }
  insert.run(JSON.stringify({ command: "beginActivity", phaseKey: "tools", stage: "conversion", outcomes: [{ kind: "conversion" }] }));
  insert.run(JSON.stringify({ command: "beginActivity", phaseKey: "quest", phase: "任务出牌", stage: "active-quest", outcomes: [] }));
  const first = auditGroups(store, "123456", 0);
  assert.equal(first.total, 23);
  assert.equal(first.groups.length, 20);
  assert.ok(first.groups.every((group) =>
    group.entries[0].details.phaseKey !== "tools" || group.entries[0].details.outcomes?.length,
  ));
  const next = auditGroups(store, "123456", 20);
  assert.equal(next.groups.length, 3);
  assert.equal(first.groups[0].entries[0].details.stage, "active-quest");
  assert.ok(first.groups.some((group) => group.entries[0].details.outcomes?.[0]?.kind === "conversion"));
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM admin_audit").get().n, 44);
});

test("入座和准备流水不占操作记录分页，建房与设置仍可查", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const insert = store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created,details) VALUES('player','123456','',1,?)",
  );
  insert.run(JSON.stringify({ command: "create", phaseKey: "lobby", stage: "lobby", label: "创建房间" }));
  for (let i = 0; i < 30; i++)
    insert.run(JSON.stringify({ command: i % 2 ? "ready" : "join", phaseKey: "lobby", stage: "lobby" }));
  insert.run(JSON.stringify({ phaseKey: "lobby", stage: "lobby", label: "加入房间" }));
  insert.run(JSON.stringify({ command: "configure", phaseKey: "lobby", stage: "lobby", label: "修改板子" }));
  for (let i = 0; i < 21; i++)
    insert.run(JSON.stringify({ command: "submit", phaseKey: "quest", stage: `quest-${i}` }));
  const first = auditGroups(store, "123456", 0);
  const second = auditGroups(store, "123456", 20);
  assert.equal(first.total, 22);
  assert.equal(first.groups.length, 20);
  assert.equal(second.groups.length, 2);
  assert.deepEqual(second.groups[1].entries.map((entry) => entry.details.command), ["configure", "create"]);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM admin_audit").get().n, 54);
});

test("猎人预选技能记录保存发起时间，整轮自动结算记录沿用同次时间", () => {
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
  const shot = actionDetails(room, "p2", "submit", { value: "passive:3" });
  assert.equal(shot.activityStartedAt, startedAt);
  assert.equal(shot.player.role, "红猎人");
  for (const p of room.players)
    run(p.uid, "submit", { value: {p1: "target:2", p2: "passive:3"}[p.uid] || "pass" });
  assert.equal(room.phase, "tools");
  assert.ok(room.history.filter((h) => h.kind === "skillResult" || h.kind === "skillDetail").every((h) => h.startedAt === startedAt));
});

function reviewRoom(board = "classic", capacity = 8, flexible = true) {
  const { enter, command } = require("../server/engine");
  const { completeActionDetails } = require("../server/audit");
  const room = newRoom("123456", "p1", "玩家1", board, capacity);
  for (let seat = 2; seat <= capacity; seat++)
    enter(room, `p${seat}`, `玩家${seat}`);
  const run = (uid, type, parameters = {}) => {
    const before = structuredClone(room);
    const input = { type, stage: room.stage, ...parameters };
    const details = actionDetails(room, uid, type, input);
    command(room, uid, input);
    return completeActionDetails(details, before, room);
  };
  for (const player of room.players) run(player.uid, "ready", { ready: true });
  run("p1", "start", { flexible });
  return { room, run };
}

test("发起与任务提交归入同阶段，自动结算记录票数门槛，重开后快照不变", (t) => {
  const { room, run } = reviewRoom();
  room.roles.p2 = "assassin";
  room.roles.p3 = "servant";
  const begin = run("p1", "beginActivity", {
    kind: "quest",
    team: [2, 3],
    threshold: 2,
  });
  const stage = room.stage;
  assert.equal(begin.stage, stage);
  assert.equal(begin.phaseKey, "quest");
  assert.deepEqual(begin.team, [2, 3]);
  assert.deepEqual(
    begin.participants
      .filter((player) => player.required)
      .map((player) => player.seat),
    [2, 3],
  );
  const fail = run("p2", "submit", { value: "fail" });
  assert.deepEqual(fail.outcomes, []);
  const complete = run("p3", "submit", { value: "success" });
  assert.equal(complete.outcomes[0].text, "任务成功");
  assert.equal(complete.outcomes[0].fails, 1);
  assert.equal(complete.outcomes[0].threshold, 2);
  assert.deepEqual(complete.outcomes[0].counts, { success: 1, fail: 1 });
  const saved = JSON.stringify(complete);
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.save(room);
  const insert = store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created,details) VALUES('player',?,'',?,?)",
  );
  [begin, fail, complete].forEach((details, index) =>
    insert.run(room.code, index + 1, JSON.stringify(details)),
  );
  const grouped = auditGroups(store, room.code, 0);
  assert.equal(grouped.total, 1);
  assert.equal(grouped.groups[0].entries.length, 3);
  assert.equal(grouped.groups[0].active, false);
  run("p1", "finishTools", { winner: "good" });
  run("p1", "rematch");
  assert.equal(JSON.stringify(complete), saved);
  assert.equal(
    auditGroups(store, room.code, 0).groups[0].entries[0].details.outcomes[0]
      .fails,
    1,
  );
});

test("混沌任务保存魔法反转与盗贼失败牌，不按普通任务猜测成功票", () => {
  const { room, run } = reviewRoom("chaos", 12);
  Object.assign(room.roles, { p1: "blueWarlock", p2: "oberon", p3: "servant" });
  run("p1", "beginActivity", { kind: "quest", team: [1, 2, 3], threshold: 1 });
  run("p1", "submit", { value: "magic" });
  run("p2", "submit", { value: "fail" });
  const result = run("p3", "submit", { value: "success" }).outcomes[0];
  assert.equal(result.success, true);
  assert.deepEqual(result.counts, {
    success: 1,
    fail: 1,
    thiefFail: 0,
    magic: 1,
  });
  assert.match(result.lines.join(" "), /奇数张魔法反转/);
  room.roles.p2 = "redThief";
  run("p1", "beginActivity", { kind: "quest", team: [1, 2], threshold: 1 });
  run("p1", "submit", { value: "magic" });
  const thief = run("p2", "submit", { value: "thiefFail" }).outcomes[0];
  assert.equal(thief.success, false);
  assert.match(thief.lines.join(" "), /盗贼失败优先生效/);
});

test("顺序流程只将上车者视为任务参与者，结算推进同样保存结果", () => {
  const { room, run } = reviewRoom("classic", 6, false);
  room.phase = "quest";
  room.team = [2, 3];
  room.roles.p2 = room.roles.p3 = "servant";
  room.submissions = {};
  const details = actionDetails(room, "p1", "submit", { value: "confirm" });
  assert.deepEqual(
    details.participants
      .filter((player) => player.required)
      .map((player) => player.seat),
    [2, 3],
  );
  for (const player of room.players)
    run(player.uid, "submit", {
      value: room.team.includes(player.seat) ? "success" : "confirm",
    });
  const result = run("p1", "advance").outcomes[0];
  assert.equal(result.text, "任务成功");
  assert.equal(result.counts.success, 2);
});

test("提前截止投票保留弃权数量，作废任务不产生任务成功结果", () => {
  const { run } = reviewRoom();
  run("p1", "beginActivity", { kind: "vote", team: [2, 3] });
  run("p2", "submit", { value: "approve" });
  const closed = run("p1", "closeWaiting", { confirm: true });
  assert.equal(closed.outcomes[0].text, "组队否决");
  assert.equal(closed.outcomes[0].abstain, 7);
  assert.equal(closed.outcomes[0].earlyClosed, true);
  assert.deepEqual(closed.skippedSeats, [1, 3, 4, 5, 6, 7, 8]);
  run("p1", "beginActivity", { kind: "quest", team: [2, 3], threshold: 1 });
  const cancelled = run("p1", "closeWaiting", { confirm: true });
  assert.deepEqual(
    cancelled.outcomes.map((outcome) => outcome.kind),
    ["cancel"],
  );
  assert.equal(cancelled.outcomes[0].text, "本次操作已作废");
});

test("湖仙查验保存实际结果与传递对象，后续查验不覆盖，玩家公开视图没有秘密结果", () => {
  const { room, run } = reviewRoom();
  room.fairy.fairy = 1;
  room.roles.p2 = "mordred";
  run("p1", "beginActivity", { kind: "fairy" });
  const result = run("p1", "submit", { value: "target:2" }).outcomes[0];
  assert.equal(result.kind, "fairy");
  assert.equal(result.actor.seat, 1);
  assert.equal(result.target.seat, 2);
  assert.equal(result.target.role, "莫德雷德");
  assert.match(result.result, /坏人/);
  const saved = JSON.stringify(result);
  run("p1", "beginActivity", { kind: "fairy" });
  run("p2", "submit", { value: "target:3" });
  assert.equal(JSON.stringify(result), saved);
  const publicData = require("../server/engine").publicView(room, "p3");
  assert.doesNotMatch(
    JSON.stringify(publicData),
    /fairyInfo|查验结果|outcomes/,
  );
  assert.ok(publicData.players.every((player) => !player.role));
});

test("技能结算同时保留行动前身份、攻击结果、复活后身份及提前跳过", () => {
  const { room, run } = reviewRoom("knights", 12);
  for (const player of room.players) {
    room.roles[player.uid] = "servant";
    Object.assign(room.knights.players[player.uid], {
      armor: false,
      used: false,
      b: false,
    });
  }
  Object.assign(room.roles, { p1: "blueAwakened", p2: "redHunter" });
  room.knights.deck = ["magician", "witch"];
  run("p1", "beginActivity", { kind: "skills" });
  const attack = run("p1", "submit", { value: "target:2" });
  run("p2", "submit", { value: "passive:3" });
  const closed = run("p1", "closeWaiting", { confirm: true });
  const result = closed.outcomes.find((outcome) => outcome.kind === "skills");
  assert.equal(attack.player.role, "觉醒蓝刀客");
  assert.deepEqual(result.eliminated, [2, 3]);
  assert.deepEqual(result.redrawn, [2, 3]);
  assert.deepEqual(result.out, []);
  assert.equal(
    result.changes.find((player) => player.seat === 2).beforeRole,
    "红猎人",
  );
  assert.equal(
    result.changes.find((player) => player.seat === 2).afterRole,
    "魔术师",
  );
  assert.match(result.lines.join(" "), /2号·玩家2开枪/);
  assert.equal(closed.skippedSeats.length, 10);
});

test("刀逆仆、刺梅林和结束本局记录实际结算结果，空刀保持明确", () => {
  const { room, run } = reviewRoom();
  Object.assign(room.roles, { p1: "assassin", p2: "reverse", p3: "merlin" });
  run("p1", "beginActivity", { kind: "reverseStrike" });
  run("p1", "submit", { value: 2 });
  let result;
  for (const player of room.players.slice(1))
    result = run(player.uid, "submit", { value: "confirm" });
  assert.equal(result.outcomes[0].hit, true);
  assert.match(result.outcomes[0].text, /阵营转为坏人/);
  run("p1", "beginActivity", { kind: "assassination" });
  run("p1", "submit", { value: 3 });
  for (const player of room.players.slice(1))
    result = run(player.uid, "submit", { value: "confirm" });
  assert.equal(result.outcomes[0].hit, true);
  const ended = run("p1", "finishTools", { winner: "evil" });
  assert.equal(ended.outcomes[0].text, "坏人获胜");
  assert.equal(ended.outcomes[0].winner, "evil");
});

test("确认回执在分组分页前过滤，等待阶段操作按具体事件分组", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const insert = store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created,details) VALUES('player','123456','',1,?)",
  );
  for (let index = 0; index < 25; index++)
    insert.run(
      JSON.stringify({
        stage: "same",
        command: "ackIdentity",
        phaseKey: "tools",
      }),
    );
  for (const command of ["updateSettings", "finishTools", "rematch"])
    insert.run(JSON.stringify({ stage: "same", command, phaseKey: "tools" }));
  assert.equal(auditGroups(store, "123456", 0).total, 3);
  assert.equal(auditGroups(store, "123456", 0).groups.length, 3);
});

test("技能审计保留守护挡刀与刀错身份的判定，而非只记录无人出局", () => {
  const { room, run } = reviewRoom("knights", 12);
  for (const player of room.players) {
    room.roles[player.uid] = "servant";
    Object.assign(room.knights.players[player.uid], {
      armor: false,
      used: false,
      b: false,
    });
  }
  Object.assign(room.roles, {
    p1: "blueAwakened",
    p2: "blueGuard",
    p4: "gareth",
  });
  run("p1", "beginActivity", { kind: "skills" });
  run("p1", "submit", { value: "target:3" });
  run("p2", "submit", { value: "target:3" });
  run("p4", "submit", { value: "target:5" });
  const result = run("p1", "closeWaiting", { confirm: true }).outcomes[0];
  assert.deepEqual(result.eliminated, []);
  assert.deepEqual(
    result.resolutions.map((entry) => entry.effect),
    ["guarded", "invalid_role"],
  );
  assert.match(result.lines.join(" "), /被守卫挡下/);
  assert.match(result.lines.join(" "), /目标身份不在技能作用范围/);
  assert.doesNotMatch(JSON.stringify(result), /p1|p2|p3/);
});

test("阵营转换审计记录两名兰斯洛特转换后的实际阵营", () => {
  const { room, run } = reviewRoom("knights", 12);
  for (const player of room.players) room.roles[player.uid] = "servant";
  Object.assign(room.roles, { p1: "redLancelot", p2: "blueLancelot" });
  room.knights.conversions = [true];
  const conversion = run("p1", "beginActivity", { kind: "conversion" });
  assert.equal(conversion.outcomes[0].text, "本轮阵营转换");
  assert.equal(room.knights.players.p1.faction, "good");
  assert.equal(room.knights.players.p2.faction, "evil");
  assert.equal(conversion.outcomes[0].lines.length, 2);
  assert.match(conversion.outcomes[0].lines[0], /1号·玩家1.*→ 好人$/);
  assert.match(conversion.outcomes[0].lines[1], /2号·玩家2.*→ 坏人$/);
});

test("空刀审计记录场上无梅林，不会记成命中梅林", () => {
  const { room, run } = reviewRoom("knights", 12);
  for (const player of room.players) room.roles[player.uid] = "servant";
  room.roles.p1 = "assassin";
  run("p1", "beginActivity", { kind: "assassination", actor: 1 });
  run("p1", "submit", { value: 0 });
  let result;
  for (const player of room.players.slice(1))
    result = run(player.uid, "submit", { value: "confirm" });
  assert.equal(result.outcomes[0].hit, true);
  assert.equal(result.outcomes[0].text, "空刀成立（场上无梅林）");
  assert.deepEqual(result.outcomes[0].lines, ["目标：空刀"]);
});
