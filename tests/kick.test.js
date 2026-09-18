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
function setup(start = false, board = "classic", n = 6) {
  const r = newRoom("123456", "p1", "房主", board, n);
  for (let i = 2; i <= n; i++) enter(r, `p${i}`, "同名玩家");
  if (start) {
    r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
    run(r, "p1", "start", { flexible: true });
  }
  return r;
}
const kickData = (r, seat = 2) => ({
  type: "kick",
  stage: r.stage,
  seat,
  confirm: true,
  targetId: publicView(r, "p1").players.find((p) => p.seat === seat)
    .managementId,
});

test("房主在准备阶段移出指定成员，保留其他座位和准备状态，移出者访问被撤销", () => {
  const r = setup();
  run(r, "p3", "ready", { ready: true });
  const others = structuredClone(r.players.filter((p) => p.uid !== "p2"));
  const stage = r.stage;
  assert.equal(publicView(r, "p1").canKick, true);
  assert.equal(publicView(r, "p2").canKick, false);
  assert.ok(
    publicView(r, "p2").players.every((p) => !p.managementId && !p.uid),
  );
  command(r, "p1", kickData(r));
  assert.deepEqual(r.players, others);
  assert.equal(r.phase, "lobby");
  assert.notEqual(r.stage, stage);
  assert.throws(() => publicView(r, "p2"), /被房主移出/);
  assert.throws(() => privateView(r, "p2"), /被房主移出/);
  assert.throws(() => run(r, "p2", "ready", { ready: true }), /被房主移出/);
  enter(r, "p2", "重新加入");
  assert.equal(publicView(r, "p2").me.ready, false);
  assert.equal(publicView(r, "p2").me.seat, 2);
  assert.ok(!r.removedPlayers.includes("p2"));
});

test("非房主、移出自己、无确认和不存在的成员均拒绝且不改变状态", () => {
  const r = setup();
  const before = structuredClone(r);
  assert.throws(() => command(r, "p2", kickData(r, 3)), /只有房主/);
  assert.throws(() => command(r, "p1", kickData(r, 1)), /不能移出房主/);
  assert.throws(
    () => command(r, "p1", { ...kickData(r), confirm: false }),
    /请确认/,
  );
  assert.throws(
    () => command(r, "p1", { ...kickData(r), seat: 99 }),
    /座位玩家已变化/,
  );
  assert.deepEqual(r, before);
});

test("对局进行中所有阶段都禁止踢人，不能通过请求强行终止游戏", () => {
  for (const [board, n, phases] of [
    [
      "classic",
      6,
      [
        "identity",
        "proposal",
        "tools",
        "teamVote",
        "quest",
        "assassination",
        "reverseStrike",
        "offlineFinal",
      ],
    ],
    ["knights", 12, ["skillPrepare", "hunterTurn", "fairy"]],
  ]) {
    for (const phase of phases) {
      const r = setup(true, board, n);
      if (["skillPrepare", "hunterTurn"].includes(phase)) {
        run(r, "p1", "beginActivity", { kind: "skills" });
        r.knights.hunters = ["p2"];
      }
      r.phase = phase;
      const before = structuredClone(r);
      assert.equal(publicView(r, "p1").canKick, false);
      assert.throws(
        () => command(r, "p1", kickData(r)),
        /仅准备阶段或对局结束/,
      );
      assert.deepEqual(r, before);
    }
  }
});

test("结束或终止后踢人保留结算记录，可补人后重新开局", () => {
  for (const finish of ["finishTools", "terminate"]) {
    const r = setup(true, "knights", 12);
    run(r, "p1", "beginActivity", { kind: "vote" });
    r.players.forEach((p) => run(r, p.uid, "submit", { value: "approve" }));
    run(r, "p1", finish);
    const history = structuredClone(r.history),
      result = structuredClone(r.result);
    assert.equal(publicView(r, "p1").canKick, true);
    command(r, "p1", kickData(r));
    assert.deepEqual(r.history, history);
    assert.deepEqual(r.result, result);
    assert.throws(() => privateView(r, "p2"), /被房主移出/);
    assert.ok(privateView(r, "p3").role);
    run(r, "p1", "rematch");
    enter(r, "new", "新玩家");
    r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
    run(r, "p1", "start", { flexible: true });
    assert.equal(r.players.length, 12);
    assert.equal(r.phase, "tools");
  }
});

test("确认绑定成员而非座位，离席换人或同账号重新入座均不能误踢", () => {
  for (const replacement of ["new", "p2"]) {
    const r = setup();
    const input = kickData(r);
    run(r, "p2", "leave");
    enter(r, replacement, "同名玩家");
    assert.equal(r.stage, input.stage);
    assert.throws(() => command(r, "p1", input), /座位玩家已变化/);
    assert.equal(r.players.length, 6);
  }
  const r = setup();
  const input = kickData(r);
  run(r, "p1", "transfer", { seat: 3 });
  assert.throws(() => command(r, "p1", input), /只有房主/);
});

test("旧存档缺少成员编号时仍支持安全移出，兼容编号不暴露用户ID", () => {
  const r = setup();
  r.players.forEach((p) => delete p.membershipId);
  const input = kickData(r);
  assert.equal(input.targetId.length, 64);
  assert.notEqual(input.targetId, "p2");
  command(r, "p1", input);
  assert.equal(r.players.length, 5);
});
