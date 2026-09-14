const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  newRoom,
  enter,
  command,
  privateView,
  publicView,
} = require("../server/engine");
const { chaosQuest, roles } = require("../server/variants");
const run = (r, uid, type, extra = {}) =>
  command(r, uid, { type, stage: r.stage, ...extra });
function setup(board = "knights") {
  const r = newRoom("123456", "p1", "房主", board, 12);
  for (let i = 2; i <= 12; i++) enter(r, `p${i}`, `玩家${i}`);
  r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
  run(r, "p1", "start", { flexible: true });
  r.leader = 1;
  return r;
}
const begin = (r, kind, extra = {}) =>
  run(r, "p1", "beginActivity", { kind, ...extra });
function submitAll(r, actions = {}) {
  for (const p of r.players) {
    const a = privateView(r, p.uid).action;
    if (a) run(r, p.uid, "submit", { value: actions[p.uid] ?? a.choices?.[0] });
  }
}
function configure(r, map) {
  for (const p of r.players) {
    r.roles[p.uid] = "servant";
    Object.assign(r.knights.players[p.uid], {
      armor: false,
      b: false,
      used: false,
    });
  }
  Object.assign(r.roles, map);
  for (const p of r.players)
    r.knights.players[p.uid].b =
      !!roles[r.roles[p.uid]] &&
      ![
        "gareth",
        "gaheris",
        "blueLancelot",
        "redLancelot",
        "redSwordsman",
      ].includes(r.roles[p.uid]);
}
function skills(r, actions = {}) {
  begin(r, "skills");
  submitAll(r, actions);
  run(r, "p1", "settleTool");
}
test("混沌契约票型权限、第三方身份与四类匿名汇总", () => {
  const r = setup("chaos");
  const expected = {
    blueWarlock: ["success", "magic"],
    redWarlock: ["success", "magic"],
    redThief: ["thiefFail"],
    blueThief: ["success"],
    oberon: ["fail"],
  };
  begin(r, "quest", { team: r.players.map((p) => p.seat), threshold: 1 });
  for (const p of r.players) {
    const a = privateView(r, p.uid).action;
    if (expected[r.roles[p.uid]])
      assert.deepEqual(a.choices, expected[r.roles[p.uid]]);
  }
  submitAll(r);
  run(r, "p1", "settleTool");
  assert.equal(r.history.at(-1).counts.thiefFail, 1);
  assert.equal(r.history.at(-1).success, false);
  assert.equal(
    Object.values(r.history.at(-1).counts).reduce((a, b) => a + b),
    12,
  );
  assert.deepEqual(chaosQuest(["magic", "thiefFail"], 1), {
    fails: 1,
    success: false,
    counts: { success: 0, fail: 0, thiefFail: 1, magic: 1 },
  });
  assert.equal(chaosQuest(["magic", "thiefFail"], 2).success, false);
  assert.equal(chaosQuest(["magic", "thiefFail", "fail"], 2).success, true);
  assert.equal(chaosQuest(["magic", "magic", "success"], 1).success, true);
});
test("十二骑士A/B牌配比、分层随机牌堆与公开视图不泄露B角色", () => {
  const r = setup();
  assert.equal(r.knights.deck.length, 12);
  for (const [start, end, evil] of [
    [0, 4, 2],
    [4, 9, 2],
    [9, 12, 1],
  ])
    assert.equal(
      r.knights.deck.slice(start, end).filter((k) => roles[k][1] === "evil")
        .length,
      evil,
    );
  const view = JSON.stringify(publicView(r, "p1"));
  assert.ok(!view.includes("initialRoles"));
  assert.ok(!view.includes("blueAwakened"));
  assert.equal(r.knights.conversions.filter(Boolean).length, 2);
});
test("所有角色同时提交，守护免死仅消耗触发的守卫；目标和角色不公开", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "redGuard", p3: "redKnight" });
  const before = publicView(r, "p4");
  begin(r, "skills");
  assert.ok(privateView(r, "p1").action.choices.includes("target:3"));
  assert.ok(privateView(r, "p2").action.choices.includes("target:3"));
  const hidden = publicView(r, "p4");
  run(r, "p1", "submit", { value: "target:3" });
  assert.deepEqual(publicView(r, "p4"), hidden);
  for (const p of r.players.filter((p) => p.uid !== "p1"))
    run(r, p.uid, "submit", { value: p.uid === "p2" ? "target:3" : "pass" });
  run(r, "p1", "settleTool");
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.deck.length, 12);
  assert.equal(r.knights.players.p1.used, true);
  assert.equal(r.knights.players.p2.used, true);
  assert.equal(r.knights.players.p3.used, false);
  assert.deepEqual(
    publicView(r, "p4").roleConfiguration,
    before.roleConfiguration,
  );
});
test("换号影响刀的目标，魔术师连带出局，按出局顺序复活且本轮禁用新技能", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "magician" });
  r.knights.deck = ["blueKnight", "redGuard"];
  skills(r, { p1: "target:3", p2: "swap:3:4" });
  assert.equal(r.roles.p4, "blueKnight");
  assert.equal(r.roles.p2, "redGuard");
  assert.equal(r.roles.p3, "servant");
  assert.equal(r.knights.players.p4.availableRound, 2);
  assert.equal(r.knights.deck.length, 0);
  begin(r, "quest", { team: [1], threshold: 1 });
  run(r, "p1", "cancelActivity");
  begin(r, "conversion");
  begin(r, "skills");
  assert.ok(privateView(r, "p4").action.choices.includes("target:3"));
});
test("女巫替死能被守护；替死猎人不触发开枪", () => {
  for (const guard of [true, false]) {
    const r = setup();
    configure(r, {
      p1: "blueAwakened",
      p2: "witch",
      p3: "blueHunter",
      ...(guard ? { p4: "blueGuard" } : {}),
    });
    r.knights.deck = [];
    skills(r, {
      p1: "target:2",
      p2: "target:3",
      ...(guard ? { p4: "target:3" } : {}),
    });
    assert.equal(r.phase, "tools");
    assert.equal(r.knights.players.p2.alive, true);
    assert.equal(r.knights.players.p3.alive, guard);
  }
});
test("猎人插入全员确认，恢复后继续结算；重复/旧阶段请求拒绝", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "redHunter", p3: "blueAwakened" });
  r.knights.deck = [];
  skills(r, { p1: "target:2", p3: "target:4" });
  assert.equal(r.phase, "hunterTurn");
  assert.equal(publicView(r, "p1").operationProgress.total, 12);
  const old = r.stage;
  submitAll(r, { p2: "target:3" });
  run(r, "p1", "settleTool");
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p3.alive, false);
  assert.equal(r.knights.players.p4.alive, true);
  assert.throws(
    () => command(r, "p2", { stage: old, type: "submit", value: "pass" }),
    /阶段已变化/,
  );
  begin(r, "vote");
  assert.equal(privateView(r, "p2").action, null);
  assert.equal(publicView(r, "p1").operationProgress.total, 10);
  run(r, "p1", "cancelActivity");
  assert.throws(
    () => begin(r, "quest", { team: [2], threshold: 1 }),
    /座位不合法/,
  );
});
test("技能中途作废恢复出局、角色和技能；复活甲耗B牌恢复原身份", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "redHunter" });
  const before = structuredClone(r.knights.players);
  skills(r, { p1: "target:2" });
  assert.equal(r.phase, "hunterTurn");
  run(r, "p1", "cancelActivity");
  assert.deepEqual(r.knights.players, before);
  configure(r, { p1: "blueAwakened", p2: "merlin" });
  r.knights.players.p2.armor = true;
  r.knights.deck = ["redKnight"];
  skills(r, { p1: "target:2" });
  assert.equal(r.roles.p2, "merlin");
  assert.equal(r.knights.players.p2.armor, false);
  assert.equal(r.knights.players.p2.used, true);
  assert.equal(r.knights.deck.length, 0);
});
test("圣骑士恢复原牌不重置技能；莫德雷德决斗视为好人", () => {
  const r = setup();
  configure(r, {
    p1: "blueAwakened",
    p2: "paladin",
    p3: "blueKnight",
    p4: "mordred",
  });
  r.knights.players.p3.used = true;
  skills(r, { p1: "target:3", p2: "revive" });
  assert.equal(r.roles.p3, "blueKnight");
  assert.equal(r.knights.players.p3.used, true);
  assert.equal(r.knights.deck.length, 12);
  for (const role of ["blueKnight", "redKnight"]) {
    const t = setup();
    configure(t, { p1: role, p2: "mordred" });
    t.knights.deck = [];
    skills(t, { p1: "target:2" });
    assert.equal(t.knights.players.p1.alive, role === "redKnight");
    assert.equal(t.knights.players.p2.alive, role === "blueKnight");
  }
});
test("转换只改阵营，当前红兰斯强制失败；仙女先知视野仅本人获取", () => {
  const r = setup();
  configure(r, {
    p1: "blueLancelot",
    p2: "redLancelot",
    p3: "prophet",
    p4: "redKnight",
  });
  r.knights.fairy = 1;
  skills(r);
  begin(r, "quest", { team: [1], threshold: 1 });
  run(r, "p1", "cancelActivity");
  r.knights.conversions = [true];
  begin(r, "conversion");
  assert.equal(r.roles.p1, "blueLancelot");
  assert.equal(privateView(r, "p1").faction, "坏人阵营");
  begin(r, "quest", { team: [1, 2], threshold: 1 });
  assert.deepEqual(privateView(r, "p1").action.choices, ["fail"]);
  assert.deepEqual(privateView(r, "p2").action.choices, ["success"]);
  run(r, "p1", "cancelActivity");
  skills(r);
  begin(r, "fairy");
  submitAll(r, { p1: "target:4" });
  run(r, "p1", "settleTool");
  assert.ok(privateView(r, "p1").information.includes("4号查验结果：坏人"));
  assert.ok(!privateView(r, "p2").information.includes("查验结果"));
  assert.equal(r.knights.nightRound, 2);
  assert.ok(privateView(r, "p3").information.includes("4号"));
  assert.ok(!JSON.stringify(publicView(r, "p1")).includes("nightInfo"));
});
test("最终盘刀由选定带刀人录入，支持空刀；重开清理全部技能状态", () => {
  const r = setup();
  configure(r, { p1: "assassin" });
  begin(r, "assassination", { actor: 1 });
  assert.ok(privateView(r, "p1").action.targets.some((t) => t.seat === 0));
  submitAll(r, { p1: 0 });
  run(r, "p1", "settleTool");
  assert.equal(r.history.at(-1).hit, true);
  run(r, "p1", "finishTools");
  run(r, "p1", "rematch");
  assert.equal(r.knights, undefined);
});

test("蓝兰斯转红不获得坏人身份列表，女巫自替死仍出局", () => {
  const r = setup();
  configure(r, { p1: "blueLancelot", p2: "mordred" });
  r.knights.players.p1.faction = "evil";
  assert.ok(!privateView(r, "p1").information.includes("莫德雷德"));
  configure(r, { p1: "blueAwakened", p2: "witch" });
  r.knights.deck = [];
  skills(r, { p1: "target:2", p2: "target:2" });
  assert.equal(r.knights.players.p2.alive, false);
});

test("房主选择盘刀人不能通过错误响应探测隐藏阵营", () => {
  const r = setup();
  configure(r, { p1: "servant", p2: "assassin" });
  begin(r, "assassination", { actor: 1 });
  assert.deepEqual(privateView(r, "p1").action.choices, ["confirm"]);
  assert.throws(() => run(r, "p1", "submit", { value: 0 }), /不合法/);
  submitAll(r);
  run(r, "p1", "settleTool");
  assert.equal(r.phase, "tools");
  assert.equal(r.history.at(-1).kind, "variant");
});

test("换号未产生技能效果不消耗魔术师；A刀刀错仍消耗刀", () => {
  const r = setup();
  configure(r, { p1: "gareth", p2: "magician", p3: "blueGuard" });
  skills(r, { p1: "target:4", p2: "swap:4:5", p3: "target:4" });
  assert.equal(r.knights.players.p1.used, true);
  assert.equal(r.knights.players.p2.used, false);
  assert.equal(r.knights.players.p3.used, false);
});

test("复活新牌只向本人发未确认提醒，确认不影响他人且拒绝过期版本", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "servant" });
  r.knights.deck = ["redGuard"];
  skills(r, { p1: "target:2" });
  assert.equal(privateView(r, "p2").role, "红守卫");
  assert.equal(publicView(r, "p2").me.identityChanged, true);
  assert.equal(publicView(r, "p1").me.identityChanged, false);
  const rev = privateView(r, "p2").identityRevision;
  assert.equal(publicView(structuredClone(r), "p2").me.identityChanged, true);
  assert.throws(
    () => run(r, "p2", "ackIdentity", { revision: rev - 1 }),
    /身份已变化/,
  );
  run(r, "p2", "ackIdentity", { revision: rev });
  assert.equal(publicView(r, "p2").me.identityChanged, false);
  assert.equal(privateView(r, "p2").role, "红守卫");
  assert.ok(!privateView(r, "p2").information.includes("存活"));
  assert.ok(!privateView(r, "p2").information.includes("技能可用"));
});

test("旧房间已抽取B牌但没有提醒版本时也能查看并确认", () => {
  const r = setup();
  r.roles.p2 = "blueGuard";
  Object.assign(r.knights.players.p2, { b: true, availableRound: 2 });
  assert.equal(publicView(r, "p2").me.identityChanged, true);
  assert.equal(privateView(r, "p2").identityRevision, 1);
  run(r, "p2", "ackIdentity", { revision: 1 });
  assert.equal(publicView(r, "p2").me.identityChanged, false);
});

test("任务自动推进轮次：非法请求不推进，投票不推进，取消重开不重复推进", () => {
  const r = setup();
  skills(r);
  const before = structuredClone(r);
  assert.throws(
    () => begin(r, "quest", { team: [], threshold: 1 }),
    /至少选择/,
  );
  assert.deepEqual(r, before);
  assert.throws(() => begin(r, "nextRound"), /操作类型无效/);
  assert.deepEqual(r, before);
  begin(r, "vote");
  run(r, "p1", "cancelActivity");
  assert.equal(r.knights.round, 1);
  const leader = r.leader;
  begin(r, "quest", { team: [1], threshold: 1 });
  assert.equal(r.knights.round, 2);
  assert.equal(r.leader, (leader % 12) + 1);
  const currentStage = r.stage;
  run(r, "p1", "cancelActivity");
  assert.throws(
    () =>
      command(r, "p1", {
        type: "beginActivity",
        kind: "quest",
        team: [1],
        threshold: 1,
        stage: currentStage,
      }),
    /阶段已变化/,
  );
  begin(r, "quest", { team: [1], threshold: 1 });
  assert.equal(r.knights.round, 2);
  assert.equal(r.history.filter((h) => h.text === "进入第2轮").length, 1);
});
test("第五轮技能后不能自动进入第六轮，失败请求不改变对局", () => {
  const r = setup();
  r.round = r.knights.round = 5;
  r.knights.skillRound = 5;
  const before = structuredClone(r);
  assert.throws(() => begin(r, "quest", { team: [1], threshold: 1 }), /第五轮/);
  assert.deepEqual(r, before);
});

test("连续发起技能自动换轮、转换并启用新B身份，取消重试不重复转换", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "servant" });
  r.knights.deck = ["redGuard"];
  r.knights.conversions = [true, false, false];
  skills(r, { p1: "target:2" });
  assert.equal(r.knights.players.p2.availableRound, 2);
  begin(r, "skills");
  assert.equal(r.knights.round, 2);
  assert.equal(r.knights.convertedRound, 2);
  assert.ok(privateView(r, "p2").action.choices.includes("target:1"));
  assert.equal(r.knights.conversions.length, 2);
  const old = r.stage;
  run(r, "p1", "cancelActivity");
  begin(r, "skills");
  assert.equal(r.knights.round, 2);
  assert.equal(r.knights.conversions.length, 2);
  assert.throws(
    () =>
      command(r, "p1", { type: "beginActivity", kind: "skills", stage: old }),
    /阶段已变化/,
  );
});
test("任务已换轮或手动转换后发起技能不重复推进或抽转换牌", () => {
  const r = setup();
  skills(r);
  begin(r, "quest", { team: [1], threshold: 1 });
  run(r, "p1", "cancelActivity");
  begin(r, "conversion");
  const count = r.knights.conversions.length;
  begin(r, "skills");
  assert.equal(r.knights.round, 2);
  assert.equal(r.knights.conversions.length, count);
});
test("第五轮技能完成后再次发起技能不修改状态", () => {
  const r = setup();
  r.round = r.knights.round = r.knights.skillRound = 5;
  const before = structuredClone(r);
  assert.throws(() => begin(r, "skills"), /第五轮/);
  assert.deepEqual(r, before);
});
