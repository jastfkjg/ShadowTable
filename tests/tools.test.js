const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  newRoom,
  enter,
  command,
  publicView,
  privateView,
} = require("../server/engine");
const run = (r, uid, type, extra = {}) =>
  command(r, uid, { type, stage: r.stage, ...extra });
function setup(n = 6, board = "classic", flexible = true) {
  const r = newRoom("123456", "p1", "房主", board, n);
  for (let i = 2; i <= n; i++) enter(r, "p" + i, "玩家" + i);
  r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
  run(r, "p1", "start", { flexible });
  return r;
}
const begin = (r, kind, extra = {}) =>
  run(r, "p1", "beginActivity", { kind, ...extra });

test("发牌后直接按需操作：任务无需先投票，非队员无需确认，连续任务不自动结束", () => {
  const r = setup();
  const roles = structuredClone(r.roles);
  assert.equal(r.phase, "tools");
  assert.equal(publicView(r, "p1").canUseTools, true);
  assert.equal(publicView(r, "p2").canUseTools, false);
  for (let i = 0; i < 6; i++) {
    begin(r, "quest", { team: [1, 2], threshold: 2 });
    assert.equal(privateView(r, "p3").action, null);
    assert.equal(publicView(r, "p3").needsSubmission, false);
    run(r, "p1", "submit", { value: "success" });
    assert.throws(() => run(r, "p1", "settleTool"), /尚未完成/);
    run(r, "p2", "submit", { value: "success" });
    run(r, "p1", "settleTool");
    assert.equal(r.phase, "tools");
    assert.equal(r.result, null);
    assert.equal(r.history.at(-1).kind, "toolQuest");
  }
  assert.deepEqual(r.roles, roles);
  assert.equal(r.history.length, 6);
});

test("独立投票不必选队伍，结算前保密，连续否决不会结束本局", () => {
  const r = setup();
  for (let i = 0; i < 5; i++) {
    begin(r, "vote");
    const view = publicView(r, "p3");
    run(r, "p2", "submit", { value: "reject" });
    assert.deepEqual(publicView(r, "p3"), view);
    for (const p of r.players.filter((p) => p.uid !== "p2"))
      run(r, p.uid, "submit", { value: "reject" });
    run(r, "p1", "settleTool");
    assert.equal(r.phase, "tools");
    assert.equal(r.result, null);
    assert.equal(r.history.at(-1).votes.length, 6);
  }
});

test("切换需确认作废，旧阶段提交和非房主管理被拒绝，身份保留", () => {
  const r = setup();
  const roles = structuredClone(r.roles);
  begin(r, "vote");
  run(r, "p2", "submit", { value: "approve" });
  const before = structuredClone(r),
    oldStage = r.stage;
  assert.throws(
    () => begin(r, "quest", { team: [1], threshold: 1 }),
    /尚未结算/,
  );
  assert.deepEqual(r, before);
  for (const type of [
    "beginActivity",
    "settleTool",
    "cancelActivity",
    "finishTools",
  ])
    assert.throws(
      () => run(r, "p2", type, { kind: "vote", replace: true }),
      /只有房主/,
    );
  begin(r, "quest", { team: [1], threshold: 1, replace: true });
  assert.deepEqual(r.submissions, {});
  assert.throws(
    () =>
      command(r, "p2", { type: "submit", stage: oldStage, value: "approve" }),
    /阶段已变化/,
  );
  run(r, "p1", "cancelActivity");
  assert.equal(r.phase, "tools");
  assert.deepEqual(r.roles, roles);
  assert.equal(r.history.filter((h) => h.kind === "toolCanceled").length, 2);
});

test("任务校验队员、失败门槛和角色出牌权限，失败只汇总不显示玩家票", () => {
  const r = setup();
  for (const extra of [
    { team: [], threshold: 1 },
    { team: [1, 1], threshold: 1 },
    { team: [99], threshold: 1 },
    { team: [1], threshold: 2 },
  ])
    assert.throws(() => begin(r, "quest", extra));
  const good = r.players.find((p) => r.roles[p.uid] === "servant"),
    evil = r.players.find((p) => r.roles[p.uid] === "assassin");
  begin(r, "quest", { team: [good.seat, evil.seat], threshold: 2 });
  assert.throws(() => run(r, good.uid, "submit", { value: "fail" }), /不合法/);
  run(r, good.uid, "submit", { value: "success" });
  run(r, evil.uid, "submit", { value: "fail" });
  run(r, "p1", "settleTool");
  assert.deepEqual(r.history.at(-1), {
    kind: "toolQuest",
    number: 1,
    team: [good.seat, evil.seat].sort((a, b) => a - b),
    fails: 1,
    threshold: 2,
    success: true,
  });
});

test("刀逆仆和刀梅林可独立发起，只有刺客操作，逆仆结果保持私密", () => {
  const r = setup(9),
    assassin = r.players.find((p) => r.roles[p.uid] === "assassin"),
    reverse = r.players.find((p) => r.roles[p.uid] === "reverse"),
    merlin = r.players.find((p) => r.roles[p.uid] === "merlin");
  begin(r, "reverseStrike");
  assert.equal(privateView(r, merlin.uid).action.kind, "confirm");
  run(r, assassin.uid, "submit", { value: reverse.seat });
  r.players
    .filter((p) => p.uid !== assassin.uid)
    .forEach((p) => run(r, p.uid, "submit", { value: "confirm" }));
  run(r, "p1", "settleTool");
  assert.equal(r.convertedReverse, reverse.uid);
  assert.deepEqual(r.history.at(-1), { kind: "toolReverse", number: 1 });
  begin(r, "assassination");
  run(r, assassin.uid, "submit", { value: merlin.seat });
  r.players
    .filter((p) => p.uid !== assassin.uid)
    .forEach((p) => run(r, p.uid, "submit", { value: "confirm" }));
  run(r, "p1", "settleTool");
  assert.equal(r.history.at(-1).hit, true);
  assert.equal(r.result, null);
  assert.equal(r.phase, "tools");
  begin(r, "vote");
});

test("8人及辅助板保留线下刀人；完成后可继续工具，结束后同房重发牌", () => {
  for (const [n, board] of [
    [8, "classic"],
    [12, "shadow-assist"],
  ]) {
    const r = setup(n, board);
    assert.throws(() => begin(r, "assassination"));
    begin(r, "offline");
    assert.equal(r.phase, "offlineFinal");
    run(r, "p1", "closeOffline");
    assert.equal(r.phase, "tools");
    assert.equal(r.history.at(-1).kind, "toolOffline");
    run(r, "p1", "finishTools");
    assert.equal(r.phase, "ended");
    assert.equal(r.result.winner, null);
    assert.throws(() => begin(r, "vote"), /重新开局/);
    run(r, "p1", "rematch");
    assert.equal(r.phase, "lobby");
    assert.equal(r.roles, undefined);
    assert.equal(r.activity, undefined);
  }
});

test("旧顺序房间可保留当前提交转入工具结算，未提交完的失败尝试不改状态", () => {
  const r = setup(6, "classic", false);
  r.players.forEach((p) => run(r, p.uid, "submit", { value: "confirm" }));
  run(r, "p1", "advance");
  run(r, r.players.find((p) => p.seat === r.leader).uid, "propose", {
    team: [1, 2],
  });
  run(r, "p1", "advance");
  const before = structuredClone(r);
  assert.throws(() => run(r, "p1", "settleTool"), /尚未完成/);
  assert.deepEqual(r, before);
  r.players.forEach((p) => run(r, p.uid, "submit", { value: "approve" }));
  run(r, "p1", "settleTool");
  assert.equal(r.phase, "tools");
  assert.equal(r.flexible, true);
  assert.equal(r.history.at(-1).kind, "toolVote");
});

test("房主只获得完成状态，任务非队员不计入进度，普通玩家无进度明细", () => {
  const r = setup();
  begin(r, "quest", { team: [1, 2], threshold: 1 });
  assert.equal(publicView(r, "p2").operationProgress, null);
  assert.equal(publicView(r, "p1").operationProgress.total, 2);
  assert.equal(
    publicView(r, "p1").operationProgress.players[2].required,
    false,
  );
  run(r, "p2", "submit", { value: "success" });
  const status = publicView(r, "p1").operationProgress;
  const sameStatusDifferentVote = structuredClone(r);
  sameStatusDifferentVote.submissions.p2 = "fail";
  assert.deepEqual(
    publicView(sameStatusDifferentVote, "p1"),
    publicView(r, "p1"),
  );
  assert.equal(status.completed, 1);
  assert.deepEqual(status.players[1], {
    seat: 2,
    name: "玩家2",
    required: true,
    completed: true,
  });
  assert.ok(
    status.players.every(
      (p) => Object.keys(p).sort().join() === "completed,name,required,seat",
    ),
  );
  run(r, "p1", "submit", { value: "success" });
  run(r, "p1", "settleTool");
  assert.equal(publicView(r, "p1").operationProgress, null);
});

test("刀人进度不暴露刺客、目标或选择，所有玩家都有完成状态", () => {
  const r = setup();
  begin(r, "assassination");
  const before = publicView(r, "p1").operationProgress;
  assert.equal(before.total, 6);
  assert.ok(before.players.every((p) => p.required && !p.completed));
  const assassin = r.players.find((p) => r.roles[p.uid] === "assassin");
  const target = r.players.find((p) => p.uid !== assassin.uid);
  run(r, assassin.uid, "submit", { value: target.seat });
  const progress = publicView(r, "p1").operationProgress;
  assert.equal(progress.completed, 1);
  assert.ok(progress.players.every((p) => p.required));
  assert.deepEqual(
    progress.players.find((p) => p.seat === assassin.seat),
    {
      seat: assassin.seat,
      name: assassin.name,
      required: true,
      completed: true,
    },
  );
  assert.equal(publicView(r, "p1").history.length, 0);
  assert.throws(() => run(r, "p1", "settleTool"), /尚未完成/);
});
