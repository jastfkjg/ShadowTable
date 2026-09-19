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
test("互刀与456789循环刀全部生效，不受车长和玩家排列影响", () => {
  for (const seats of [[4, 5], [4, 5, 6, 7, 8, 9]]) {
    for (let leader = 1; leader <= 12; leader++) {
      const r = setup();
      configure(r, Object.fromEntries(seats.map((seat) => [`p${seat}`, "gareth"])));
      r.leader = leader;
      if (leader % 2 === 0) r.players.reverse();
      r.knights.deck = [];
      skills(r, Object.fromEntries(seats.map((seat, i) => [
        `p${seat}`, `target:${seats[(i + 1) % seats.length]}`,
      ])));
      assert.equal(r.phase, "tools");
      assert.deepEqual(r.knights.summary.eliminated, seats);
      for (const seat of seats) {
        assert.equal(r.knights.players[`p${seat}`].alive, false);
        assert.equal(r.knights.players[`p${seat}`].used, true);
      }
    }
  }
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
test("换号影响刀的目标，魔术师不连带出局，抽B后本轮禁用新技能", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "magician" });
  r.knights.deck = ["blueKnight", "redGuard"];
  skills(r, { p1: "target:3", p2: "swap:3:4" });
  assert.equal(r.roles.p4, "blueKnight");
  assert.equal(r.roles.p2, "magician");
  assert.equal(r.knights.players.p2.alive, true);
  assert.equal(r.knights.players.p2.used, true);
  assert.equal(r.roles.p3, "servant");
  assert.equal(r.knights.players.p4.availableRound, 2);
  assert.equal(r.knights.deck.length, 1);
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
test("主动刀先同时生效，再确认猎人开枪；重复/旧阶段请求拒绝", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "redHunter", p3: "blueAwakened" });
  r.knights.deck = [];
  skills(r, { p1: "target:2", p3: "target:4" });
  assert.equal(r.phase, "hunterTurn");
  assert.equal(publicView(r, "p1").operationProgress.total, 12);
  const old = r.stage;
  submitAll(r, { p2: "target:3" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p3.alive, false);
  assert.equal(r.knights.players.p4.alive, false);
  assert.throws(
    () => command(r, "p2", { stage: old, type: "submit", value: "pass" }),
    /阶段已变化/,
  );
  begin(r, "vote");
  assert.equal(privateView(r, "p2").action, null);
  assert.equal(publicView(r, "p1").operationProgress.total, 9);
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
  skills(r, { p1: "target:3" });
  assert.equal(r.phase, "paladinTurn");
  submitAll(r, { p2: "revive:3" });
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
test("仙女查验莫德雷德为坏人，不使用骑士决斗的好人特例", () => {
  const r = setup();
  configure(r, { p2: "mordred" });
  r.knights.fairy = 1;
  begin(r, "fairy");
  submitAll(r, { p1: "target:2" });
  const result = privateView(r, "p1").fairyResult;
  assert.equal(result.information, "2号查验结果：坏人（第1轮）");
  assert.equal(r.knights.fairy, 2);
  assert.equal(privateView(r, "p2").fairyResult, null);
  assert.ok(!JSON.stringify(publicView(r, "p1")).includes("查验结果：坏人"));
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
  assert.equal(r.phase, "tools");
  assert.equal(r.history.at(-1).kind, "variant");
});

test("换号参与刀错结算仍消耗魔术师和刀；未触发守卫不消耗", () => {
  const r = setup();
  configure(r, { p1: "gareth", p2: "magician", p3: "blueGuard" });
  skills(r, { p1: "target:4", p2: "swap:4:5", p3: "target:4" });
  assert.equal(r.knights.players.p1.used, true);
  assert.equal(r.knights.players.p2.used, true);
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
test("第五轮之后仍可发起任务", () => {
  const r = setup();
  r.round = r.knights.round = 5;
  r.knights.skillRound = 5;
  begin(r, "quest", { team: [1], threshold: 1 });
  assert.equal(r.knights.round, 6);
});

test("连续技能启用新B身份，但不自动抽取转换牌", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "servant" });
  r.knights.deck = ["redGuard"];
  r.knights.conversions = [true, false, false];
  skills(r, { p1: "target:2" });
  assert.equal(r.knights.players.p2.availableRound, 2);
  begin(r, "skills");
  assert.equal(r.knights.round, 2);
  assert.equal(r.knights.convertedRound, 0);
  assert.ok(privateView(r, "p2").action.choices.includes("target:1"));
  assert.equal(r.knights.conversions.length, 3);
  const old = r.stage;
  run(r, "p1", "cancelActivity");
  begin(r, "skills");
  assert.equal(r.knights.round, 2);
  assert.equal(r.knights.conversions.length, 3);
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
test("第五轮之后仍可发起技能", () => {
  const r = setup();
  r.round = r.knights.round = r.knights.skillRound = 5;
  begin(r, "skills");
  assert.equal(r.knights.round, 6);
});

test("技能过程默认服务端隐藏，最终出局复活始终公示，房主可切换", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "servant" });
  r.knights.deck = ["redGuard"];
  skills(r, { p1: "target:2" });
  for (const uid of ["p1", "p3"]) {
    const v = publicView(r, uid);
    assert.equal(v.showSkillDetails, false);
    assert.ok(!v.history.some((h) => h.kind === "skillDetail"));
    assert.ok(!JSON.stringify(v.history).includes("目标2号"));
    const result = v.history.find((h) => h.kind === "skillResult");
    assert.deepEqual(result.eliminated, [2]);
    assert.deepEqual(result.redrawn, [2]);
    assert.deepEqual(result.out, []);
    assert.ok(!JSON.stringify(result).includes("红守卫"));
  }
  assert.throws(
    () => run(r, "p3", "setSkillVisibility", { visible: true }),
    /只有房主/,
  );
  run(r, "p1", "setSkillVisibility", { visible: true });
  assert.ok(
    publicView(r, "p3").history.some(
      (h) => h.kind === "skillDetail" && h.text.includes("目标2号"),
    ),
  );
  run(r, "p1", "setSkillVisibility", { visible: false });
  assert.ok(!publicView(r, "p1").history.some((h) => h.kind === "skillDetail"));
});
test("守护、替死、换号与B牌耗尽合并后的结果不暴露秘密过程", () => {
  const r = setup();
  configure(r, {
    p1: "blueAwakened",
    p2: "blueGuard",
    p3: "redAwakened",
    p4: "servant",
    p5: "magician",
  });
  r.knights.deck = [];
  skills(r, { p1: "target:4", p2: "target:4", p3: "target:6", p5: "swap:6:7" });
  const result = publicView(r, "p2").history.find(
    (h) => h.kind === "skillResult",
  );
  assert.deepEqual(result.out, [7]);
  assert.deepEqual(result.eliminated, [7]);
  assert.deepEqual(result.redrawn, []);
  assert.ok(!JSON.stringify(publicView(r, "p2").history).includes("设置守护"));
  run(r, "p1", "setSkillVisibility", { visible: true });
  assert.ok(
    publicView(r, "p2").history.some((h) => h.text?.includes("设置守护")),
  );
});
test("旧过程记录默认隐藏，技能链未结束时不公示中途存活变化", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "redHunter" });
  r.knights.deck = [];
  r.history.push({ kind: "variant", text: "1号使用技能，目标2号：2号出局" });
  assert.ok(
    !publicView(r, "p3").history.some((h) => h.text?.includes("目标2号")),
  );
  skills(r, { p1: "target:2" });
  assert.equal(r.phase, "hunterTurn");
  assert.equal(
    publicView(r, "p3").players.find((p) => p.seat === 2).alive,
    true,
  );
  submitAll(r);
  assert.equal(
    publicView(r, "p3").players.find((p) => p.seat === 2).alive,
    false,
  );
  assert.deepEqual(
    publicView(r, "p3").history.find((h) => h.kind === "skillResult").out,
    [2],
  );
});

test("设置页保存校验管理员与配置阶段，非法组合不会部分更新", () => {
  const r = setup();
  const before = structuredClone(r);
  assert.throws(
    () =>
      run(r, "p2", "updateSettings", {
        board: "knights",
        capacity: 12,
        visible: true,
      }),
    /只有房主/,
  );
  assert.throws(
    () =>
      run(r, "p1", "updateSettings", {
        board: "classic",
        capacity: 6,
        visible: true,
      }),
    /准备阶段/,
  );
  assert.deepEqual(r, before);
  run(r, "p1", "updateSettings", {
    board: "knights",
    capacity: 12,
    visible: true,
  });
  assert.equal(r.showSkillDetails, true);
});

test("仙女可在首轮技能前连续查验，只由当前持有者提交", () => {
  const r = setup();
  r.knights.fairy = 1;
  for (const [holder, target] of [
    [1, 2],
    [2, 3],
  ]) {
    begin(r, "fairy");
    const before = structuredClone(r);
    assert.throws(() => begin(r, "conversion"), /进行中/);
    assert.deepEqual(r, before);
    assert.equal(publicView(r, "p1").operationProgress.total, 1);
    for (const p of r.players) {
      assert.equal(!!privateView(r, p.uid).action, p.seat === holder);
    }
    assert.throws(
      () => run(r, "p12", "submit", { value: "pass" }),
      /没有秘密操作/,
    );
    assert.throws(
      () => run(r, `p${holder}`, "submit", { value: `target:${holder}` }),
      /不合法/,
    );
    run(r, `p${holder}`, "submit", { value: `target:${target}` });
    assert.equal(r.knights.fairy, target);
  }
  assert.equal(r.knights.round, 1);
  assert.equal(r.knights.skillRound, 0);
});

test("转换可在首轮连续独立发起，牌堆耗尽时不修改状态", () => {
  const r = setup();
  configure(r, { p1: "blueLancelot", p2: "redLancelot" });
  r.knights.conversions = [true, false, true];
  begin(r, "conversion");
  assert.equal(r.knights.players.p1.faction, "evil");
  begin(r, "conversion");
  assert.equal(r.knights.players.p1.faction, "evil");
  begin(r, "conversion");
  assert.equal(r.knights.players.p1.faction, "good");
  const before = structuredClone(r);
  assert.throws(() => begin(r, "conversion"), /转换牌已用完/);
  assert.deepEqual(r, before);
  begin(r, "skills");
  assert.equal(r.phase, "skillPrepare");
});

test("各辅助板子任务只等待队员，非队员无法提交", () => {
  for (const board of ["knights", "chaos", "shadow-assist"]) {
    const r = setup(board);
    begin(r, "quest", { team: [2, 3], threshold: 1 });
    assert.equal(publicView(r, "p1").operationProgress.total, 2);
    assert.equal(privateView(r, "p1").action, null);
    assert.throws(
      () => run(r, "p1", "submit", { value: "confirm" }),
      /没有秘密操作/,
    );
    submitAll(r);
    assert.equal(r.phase, "tools");
  }
});

test("先知被动视野仅在技能结束后更新，可随时私密查看", () => {
  const r = setup();
  configure(r, {
    p2: "prophet",
    p3: "redGuard",
    p4: "redLancelot",
    p5: "redKnight",
  });
  r.knights.deck = [];
  r.knights.players.p5.alive = false;
  skills(r);
  assert.match(privateView(r, "p2").information, /B牌坏人：3号/);
  assert.ok(!privateView(r, "p1").information.includes("B牌坏人："));
  assert.ok(!JSON.stringify(publicView(r, "p1")).includes("B牌坏人："));
  const before = structuredClone(r);
  assert.throws(() => begin(r, "night"), /操作类型无效/);
  assert.deepEqual(r, before);
  begin(r, "skills");
  r.knights.players.p3.alive = false;
  assert.match(privateView(r, "p2").information, /B牌坏人：3号/);
  submitAll(r);
  assert.match(privateView(r, "p2").information, /B牌坏人：无/);
  assert.equal(r.knights.players.p2.used, false);
});

test("新抽先知在本次技能结束即获得被动视野，不等待下一轮", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "servant", p3: "redGuard" });
  r.knights.deck = ["prophet"];
  skills(r, { p1: "target:2" });
  const view = privateView(r, "p2");
  assert.equal(view.passiveVision, true);
  assert.match(view.information, /B牌坏人：3号/);
  assert.ok(!view.information.includes("下一轮生效"));
  assert.equal(r.knights.players.p2.availableRound, 2);
});

test("仙女结果只发给查验者，确认后重连不再提醒且不能确认他人结果", () => {
  const r = setup();
  r.knights.fairy = 1;
  begin(r, "fairy");
  run(r, "p1", "submit", { value: "target:2" });
  assert.equal(publicView(r, "p1").me.fairyResultPending, true);
  assert.equal(publicView(r, "p2").me.fairyResultPending, false);
  assert.equal(privateView(r, "p2").fairyResult, null);
  assert.ok(!JSON.stringify(publicView(r, "p1")).includes("号查验结果"));
  const result = privateView(r, "p1").fairyResult;
  assert.match(result.information, /2号查验结果/);
  assert.throws(
    () => run(r, "p2", "ackFairyResult", { revision: result.revision }),
    /结果已变化/,
  );
  assert.throws(
    () => run(r, "p1", "ackFairyResult", { revision: 0 }),
    /结果已变化/,
  );
  run(r, "p1", "ackFairyResult", { revision: result.revision });
  assert.equal(
    publicView(structuredClone(r), "p1").me.fairyResultPending,
    false,
  );
  assert.equal(
    privateView(r, "p1").fairyResult.information,
    result.information,
  );
});

test("两个拓展板子的初始视野逐角色校验，按板子区分身份与不可见座位", () => {
  const expectedByBoard = {
    "shadow-assist": {
      merlin: ["morgana", "assassin", "oberon", "redTraitor"],
      percival: ["merlin", "morgana"],
      mordred: ["morgana", "assassin"],
      morgana: ["mordred", "assassin"],
      assassin: ["mordred", "morgana"],
      redTraitor: ["morgana", "assassin", "oberon"],
    },
    chaos: {
      merlin: ["morgana", "redWarlock", "oberon", "redThief"],
      percival: ["merlin", "morgana"],
      mordred: ["morgana", "redWarlock"],
      morgana: ["mordred", "redWarlock"],
      redWarlock: ["mordred", "morgana"],
      gawain: ["blueWarlock", "redWarlock"],
      blueThief: ["redThief"],
      redThief: ["blueThief"],
    },
  };
  for (const [board, expected] of Object.entries(expectedByBoard)) {
    const r = setup(board);
    for (const p of r.players) {
      const view = privateView(r, p.uid);
      const visibleSeats = (view.information.match(/\d+/g) || [])
        .map(Number)
        .sort((a, b) => a - b);
      const targetSeats = r.players
        .filter((t) =>
          (expected[r.roles[p.uid]] || []).includes(r.roles[t.uid]),
        )
        .map((t) => t.seat)
        .sort((a, b) => a - b);
      assert.deepEqual(
        visibleSeats,
        targetSeats,
        `${board}: ${r.roles[p.uid]}`,
      );
      assert.ok(!view.information.includes("线下"));
      assert.ok(!view.information.includes("不提供"));
      assert.ok(
        !JSON.stringify(publicView(r, p.uid)).includes(view.information),
      );
      if (
        board === "chaos" &&
        ["mordred", "morgana", "redWarlock"].includes(r.roles[p.uid])
      ) {
        for (const t of r.players.filter((t) => targetSeats.includes(t.seat)))
          assert.ok(
            view.information.includes(
              `${t.seat}号（${privateView(r, t.uid).role}）`,
            ),
          );
        assert.ok(!view.information.includes("不区分"));
      } else if (
        [
          "mordred",
          "morgana",
          "assassin",
          "redWarlock",
          "redTraitor",
          "merlin",
        ].includes(r.roles[p.uid])
      ) {
        for (const name of [
          "刺客",
          "莫德雷德",
          "莫甘娜",
          "红术士",
          "红内奸",
          "奥伯伦",
          "红盗贼",
        ])
          assert.ok(
            !view.information.includes(name),
            `${r.roles[p.uid]}不应获知具体身份`,
          );
      }
    }
  }
});

test("十二骑士初始见面匪互知具体身份，刀客和新B身份仍保密", () => {
  const r = setup();
  const meetingRoles = ["assassin", "mordred", "morgana"];
  const meeting = r.players.filter((p) =>
    meetingRoles.includes(r.roles[p.uid]),
  );
  assert.equal(meeting.length, 3);
  for (const observer of meeting) {
    const info = privateView(r, observer.uid).information;
    assert.ok(info.startsWith("初始见面匪："));
    assert.ok(!info.includes("不区分"));
    for (const ally of meeting.filter((p) => p.uid !== observer.uid))
      assert.ok(
        info.includes(`${ally.seat}号（${privateView(r, ally.uid).role}）`),
      );
    assert.deepEqual(
      (info.match(/\d+号/g) || []).sort(),
      meeting
        .filter((p) => p.uid !== observer.uid)
        .map((p) => `${p.seat}号`)
        .sort(),
    );
    assert.ok(
      !JSON.stringify(publicView(r, observer.uid)).includes("初始见面匪"),
    );
  }
  for (const p of r.players.filter((p) =>
    [
      "redSwordsman",
      "redLancelot",
      "blueLancelot",
      "gareth",
      "gaheris",
    ].includes(r.roles[p.uid]),
  ))
    assert.ok(privateView(r, p.uid).information.startsWith("没有视野。"));

  const [observer, changed] = meeting;
  const before = privateView(r, observer.uid).information;
  r.roles[changed.uid] = "redGuard";
  r.knights.players[changed.uid].b = true;
  r.knights.players[changed.uid].availableRound = 2;
  assert.equal(privateView(r, observer.uid).information, before);
  assert.ok(!privateView(r, observer.uid).information.includes("红守卫"));
  assert.ok(privateView(r, changed.uid).information.startsWith("没有视野。"));
  assert.ok(!privateView(r, changed.uid).information.includes("初始见面匪"));
});

test("圣骑士首阶段仅确认，追加阶段私密选择本轮出局者，复活猎人取消开枪", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "blueHunter", p3: "paladin", p4: "redAwakened" });
  r.knights.deck = [];
  begin(r, "skills");
  assert.deepEqual(privateView(r, "p3").action.choices, ["pass"]);
  assert.throws(() => run(r, "p3", "submit", { value: "revive:2" }), /不合法/);
  submitAll(r, { p1: "target:2", p4: "target:5" });
  assert.equal(r.phase, "paladinTurn");
  assert.deepEqual(privateView(r, "p3").action.choices, ["pass", "revive:2", "revive:5"]);
  for (const p of r.players) {
    const view = publicView(r, p.uid);
    if (p.uid === r.host) assert.equal(view.operationProgress.total, 12);
    assert.match(view.operationStatus.detail, /再次操作/);
    assert.ok(!JSON.stringify(view).includes("revive:"));
    if (p.uid !== "p3") assert.deepEqual(privateView(r, p.uid).action.choices, ["pass"]);
  }
  assert.throws(() => run(r, "p1", "submit", { value: "revive:2" }), /不合法/);
  assert.throws(() => run(r, "p3", "submit", { value: "revive:3" }), /不合法/);
  submitAll(r, { p3: "revive:2" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p2.alive, true);
  assert.equal(r.knights.players.p2.used, false);
  assert.equal(r.knights.players.p3.used, true);
  assert.deepEqual(r.knights.summary.restored, [2]);
});

test("圣骑士先跳过，猎人开枪造成新出局后再次复活，并可打断猎人链", () => {
  let r = setup();
  configure(r, { p1: "blueAwakened", p2: "redHunter", p3: "paladin", p4: "blueHunter" });
  r.knights.deck = [];
  skills(r, { p1: "target:2" });
  assert.equal(r.phase, "paladinTurn");
  const oldStage = r.stage;
  submitAll(r);
  assert.equal(r.phase, "hunterTurn");
  assert.equal(r.knights.players.p3.used, false);
  submitAll(r, { p2: "target:4" });
  assert.equal(r.phase, "paladinTurn");
  r = JSON.parse(JSON.stringify(r)); // Reconnect / persisted state retains the chain.
  assert.throws(() => command(r, "p3", { type: "submit", stage: oldStage, value: "revive:2" }), /阶段已变化/);
  submitAll(r, { p3: "revive:4" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p4.alive, true);
  assert.equal(r.knights.players.p4.used, false);
  assert.equal(r.knights.players.p2.used, true);
});

test("圣骑士跳过且猎人不开枪时结束，不重复询问；截止追加阶段不消耗复活", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "redHunter", p3: "paladin" });
  r.knights.deck = [];
  skills(r, { p1: "target:2" });
  assert.equal(r.phase, "paladinTurn");
  assert.equal(publicView(r, "p1").closeWaiting.mode, "pass");
  run(r, "p1", "closeWaiting", { confirm: true });
  assert.equal(r.phase, "hunterTurn");
  submitAll(r);
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p3.used, false);
});

test("圣骑士已出局不能复活自己或其他人，女巫替死者不可复活", () => {
  for (const deadPaladin of [false, true]) {
    const r = setup();
    configure(r, { p1: "blueAwakened", p2: "witch", p3: "blueHunter", p4: "paladin", p5: "redAwakened" });
    r.knights.deck = [];
    skills(r, { p1: "target:2", p2: "target:3", p5: deadPaladin ? "target:4" : "target:6" });
    assert.equal(r.knights.players.p3.alive, false);
    if (deadPaladin) {
      assert.equal(r.phase, "tools");
      assert.equal(r.knights.players.p4.alive, false);
      assert.equal(r.knights.players.p4.used, false);
    } else {
      assert.equal(r.phase, "paladinTurn");
      assert.deepEqual(privateView(r, "p4").action.choices, ["pass", "revive:6"]);
      assert.throws(() => run(r, "p4", "submit", { value: "revive:3" }), /不合法/);
      submitAll(r, { p4: "revive:6" });
      assert.equal(r.phase, "tools");
    }
  }
});

test("主动自爆不受女巫替死影响，主动与被动共享次数，圣骑士救回不重置", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "witch", p3: "blueHunter", p4: "paladin", p5: "redHunter", p7: "redAwakened" });
  r.knights.deck = [];
  // 3 is made a substitute before their committed active shot is processed.
  skills(r, { p1: "target:2", p2: "target:3", p3: "detonate:6", p5: "detonate:8" });
  assert.equal(r.phase, "paladinTurn");
  assert.equal(r.knights.players.p6.alive, false);
  assert.equal(r.knights.players.p8.alive, false);
  assert.equal(r.knights.players.p3.used, true);
  assert.equal(r.knights.players.p5.used, true);
  assert.ok(!privateView(r, "p4").action.choices.includes("revive:3"));
  submitAll(r, { p4: "revive:5" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p5.alive, true);
  assert.equal(r.knights.players.p5.used, true);
  begin(r, "skills");
  assert.deepEqual(privateView(r, "p5").action.choices, ["pass"]);
  submitAll(r, { p7: "target:5" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p5.alive, false);
});

test("猎人主动自爆必出局，向目标开枪仍可被守护，未启用或已用技能不能自爆", () => {
  const r = setup();
  configure(r, { p1: "redHunter", p2: "blueGuard", p3: "redGuard", p4: "blueHunter" });
  r.knights.deck = [];
  r.knights.players.p4.availableRound = 2;
  begin(r, "skills");
  assert.ok(privateView(r, "p1").action.choices.includes("detonate:5"));
  assert.deepEqual(privateView(r, "p4").action.choices, ["pass"]);
  assert.throws(() => run(r, "p4", "submit", { value: "detonate:5" }), /不合法/);
  submitAll(r, { p1: "detonate:5", p2: "target:1", p3: "target:5" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p1.alive, false);
  assert.equal(r.knights.players.p2.used, false);
  assert.equal(r.knights.players.p3.used, true);
  assert.equal(r.knights.players.p5.alive, true);
});

test("换号导致骑士刀错自爆也消耗魔术师，不连带死亡且下轮不可再次换号", () => {
  for (const leader of [1, 4, 8, 12]) {
    const r = setup();
    configure(r, { p1: "blueKnight", p2: "magician", p3: "redKnight" });
    r.leader = leader;
    r.knights.deck = [];
    skills(r, { p1: "target:3", p2: "swap:3:4" });
    assert.equal(r.knights.players.p1.alive, false);
    assert.equal(r.knights.players.p2.alive, true);
    assert.equal(r.knights.players.p2.used, true);
    assert.equal(r.knights.players.p4.alive, true);
    begin(r, "skills");
    assert.deepEqual(privateView(r, "p2").action.choices, ["pass"]);
    submitAll(r);
  }
});

test("换号只提交而无号码参与结算不消耗；映射到守护仍算已使用", () => {
  for (const attack of [false, true]) {
    const r = setup();
    configure(r, { p1: "blueAwakened", p2: "magician", p3: "blueGuard" });
    skills(r, { p1: attack ? "target:4" : "pass", p2: "swap:4:5", p3: "target:4" });
    assert.equal(r.knights.players.p2.used, attack);
    assert.equal(r.knights.players.p3.used, attack);
    assert.equal(r.knights.players.p5.alive, true);
  }
});

test("一次守护只挡一刀，两刀仍出局；梅林派西首刀原牌、第二刀抽新B牌", () => {
  for (const role of ["merlin", "percival"]) {
    const r = setup();
    configure(r, { p1: "blueAwakened", p2: "redAwakened", p3: role, p4: "blueGuard", p5: "blueAwakened" });
    r.knights.players.p3.armor = true;
    r.knights.deck = ["redKnight", "redGuard"];
    skills(r, { p1: "target:3", p2: "target:3", p4: "target:3" });
    assert.equal(r.knights.players.p4.used, true);
    assert.equal(r.roles.p3, role);
    assert.equal(r.knights.players.p3.armor, false);
    assert.equal(r.knights.deck.length, 1);
    skills(r, { p5: "target:3" });
    assert.equal(r.roles.p3, "redGuard");
    assert.equal(r.knights.deck.length, 0);
  }
});

test("圣骑士追加阶段作废恢复所有技能与出局状态", () => {
  const r = setup();
  configure(r, { p1: "redHunter", p2: "paladin", p3: "magician" });
  const before = structuredClone(r.knights.players);
  skills(r, { p1: "detonate:4", p3: "swap:4:5" });
  assert.equal(r.phase, "paladinTurn");
  run(r, "p1", "cancelActivity");
  assert.deepEqual(r.knights.players, before);
  assert.equal(r.phase, "tools");
  skills(r);
  assert.equal(r.phase, "tools");
});

test("换号影响女巫替死落点时消耗魔术师，魔术师仍存活", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "witch", p3: "magician" });
  r.knights.deck = [];
  skills(r, { p1: "target:2", p2: "target:4", p3: "swap:4:5" });
  assert.equal(r.knights.players.p5.alive, false);
  assert.equal(r.knights.players.p4.alive, true);
  assert.equal(r.knights.players.p3.alive, true);
  assert.equal(r.knights.players.p3.used, true);
});

test("猎人已被动开枪后被圣骑士复活，再次中刀不再开枪", () => {
  const r = setup();
  configure(r, { p1: "blueAwakened", p2: "blueHunter", p3: "paladin", p5: "redAwakened" });
  r.knights.deck = [];
  skills(r, { p1: "target:2" });
  submitAll(r); // Paladin passes before the first shot.
  submitAll(r, { p2: "target:4" });
  assert.equal(r.phase, "paladinTurn");
  submitAll(r, { p3: "revive:2" });
  assert.equal(r.knights.players.p2.alive, true);
  assert.equal(r.knights.players.p2.used, true);
  skills(r, { p5: "target:2" });
  assert.equal(r.phase, "tools");
  assert.equal(r.knights.players.p2.alive, false);
});

test("五类A刀客与刺客互刀保持同时生效，刺客仅失去刀且下轮不可再刀", () => {
  const cards = ["gareth", "gaheris", "blueLancelot", "redLancelot", "redSwordsman", "assassin"];
  for (const left of cards) for (const right of cards) {
    const r = setup();
    configure(r, { p1: left, p2: right });
    r.knights.deck = [];
    skills(r, { p1: "target:2", p2: "target:1" });
    assert.equal(r.knights.players.p1.alive, left === "assassin");
    assert.equal(r.knights.players.p2.alive, right === "assassin");
    assert.equal(r.knights.players.p1.used, true);
    assert.equal(r.knights.players.p2.used, true);
    begin(r, "skills");
    assert.deepEqual(privateView(r, "p1").action.choices, ["pass"]);
    assert.deepEqual(privateView(r, "p2").action.choices, ["pass"]);
    submitAll(r);
  }
});

test("仙女查验转换后的两名兰斯洛特真实阵营并正常传递", () => {
  const r = setup();
  configure(r, { p2: "blueLancelot", p3: "redLancelot" });
  r.knights.fairy = 1;
  r.knights.conversions = [true];
  begin(r, "conversion");
  begin(r, "fairy");
  submitAll(r, { p1: "target:2" });
  assert.match(privateView(r, "p1").fairyResult.information, /2号查验结果：坏人/);
  assert.equal(r.knights.fairy, 2);
  begin(r, "fairy");
  submitAll(r, { p2: "target:3" });
  assert.match(privateView(r, "p2").fairyResult.information, /3号查验结果：好人/);
  assert.equal(r.knights.fairy, 3);
});
