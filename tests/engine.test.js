const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  newRoom,
  enter,
  command,
  publicView,
  privateView,
  COUNTS,
  TEAMS,
} = require("../server/engine");
function setup(n = 6) {
  const r = newRoom("123456", "p1", "玩家1", "classic", n);
  for (let i = 2; i <= n; i++) enter(r, "p" + i, "玩家" + i);
  r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
  run(r, "p1", "start");
  return r;
}
function run(r, uid, type, extra = {}) {
  command(r, uid, { stage: r.stage, type, ...extra });
}
function all(r, value = "confirm") {
  r.players.forEach((p) =>
    run(r, p.uid, "submit", {
      value: typeof value === "function" ? value(p) : value,
    }),
  );
}
function advance(r) {
  run(r, "p1", "advance");
}
function beginQuest(r, team) {
  run(r, r.players.find((p) => p.seat === r.leader).uid, "propose", { team });
  advance(r);
  all(r, "approve");
  advance(r);
  advance(r);
  assert.equal(r.phase, "quest");
}
function completeQuest(r, team, fails = []) {
  beginQuest(r, team);
  all(r, (p) =>
    team.includes(p.seat)
      ? fails.includes(p.seat)
        ? "fail"
        : "success"
      : "confirm",
  );
  advance(r);
}
test("6–9人配置和视野按角色隔离，随机首队长有效", () => {
  for (let n = 6; n <= 9; n++) {
    const r = setup(n),
      roles = Object.values(r.roles);
    assert.equal(
      roles.filter((x) => ["merlin", "servant"].includes(x)).length,
      COUNTS[n][0],
    );
    assert.equal(roles.filter((x) => x === "merlin").length, 1);
    assert.ok(r.leader >= 1 && r.leader <= n);
    for (const p of r.players) {
      const pub = publicView(r, p.uid);
      assert.equal(pub.roles, undefined);
      assert.equal(pub.players[0].uid, undefined);
      const card = privateView(r, p.uid);
      assert.equal(card.role === "梅林", r.roles[p.uid] === "merlin");
      if (r.roles[p.uid] === "servant")
        assert.equal(card.information, "你没有额外的初始视野");
    }
  }
});
test("未确认板子及基础配置不支持的人数拒绝启用", () => {
  for (const id of ["shadow-blade", "chaos", "knights"])
    assert.throws(() => newRoom("123456", "p", "a", id, 12), /尚未确认/);
  assert.throws(() => newRoom("123456", "p", "a", "classic", 11), /人数/);
});
test("座位冲突、未准备、跨房间、非房主推进、过期阶段均拒绝", () => {
  const r = newRoom("123456", "p1", "甲");
  enter(r, "p2", "乙");
  assert.throws(() => run(r, "p2", "seat", { seat: 1 }), /占用/);
  assert.throws(() => run(r, "p1", "start"), /全员准备/);
  assert.throws(() => publicView(r, "stranger"), /不在/);
  const g = setup();
  assert.throws(() => run(g, "p2", "advance"), /房主/);
  assert.throws(
    () => command(g, "p1", { stage: "old", type: "advance" }),
    /阶段已变化/,
  );
});
test("秘密提交不改变其他玩家或房主视图，不提供进度或身份", () => {
  const r = setup();
  const before = JSON.stringify(publicView(r, "p1"));
  run(r, "p2", "submit", { value: "confirm" });
  assert.equal(JSON.stringify(publicView(r, "p1")), before);
  assert.throws(() => advance(r), /阶段尚未完成/);
  assert.throws(() => run(r, "p2", "submit", { value: "confirm" }), /已提交/);
});
test("六人组队3:3平票拒绝，第5次否决直接坏人胜", () => {
  const r = setup();
  all(r);
  advance(r);
  for (let i = 0; i < 5; i++) {
    run(r, r.players.find((p) => p.seat === r.leader).uid, "propose", {
      team: [1, 2],
    });
    advance(r);
    all(r, (p) => (p.seat <= 3 ? "approve" : "reject"));
    advance(r);
    if (i < 4) {
      assert.equal(r.phase, "teamResult");
      assert.equal(r.history.at(-1).approved, false);
      advance(r);
    }
  }
  assert.equal(r.result.winner, "evil");
  assert.equal(r.rejects, 5);
});
test("组队票在结算时公开，任务票从不返回个人对应", () => {
  const r = setup();
  all(r);
  advance(r);
  run(r, r.players.find((p) => p.seat === r.leader).uid, "propose", {
    team: [1, 2],
  });
  advance(r);
  all(r, "approve");
  assert.equal(publicView(r, "p1").history.length, 0);
  advance(r);
  assert.equal(publicView(r, "p1").history[0].votes.length, 6);
  advance(r);
  const before = JSON.stringify(publicView(r, "p1"));
  run(r, "p2", "submit", { value: "success" });
  assert.equal(JSON.stringify(publicView(r, "p1")), before);
});
test("好人失败票、非队员任务票、重复目标和非队长组队被拒绝", () => {
  const r = setup();
  all(r);
  advance(r);
  const leader = r.players.find((p) => p.seat === r.leader);
  assert.throws(
    () => run(r, leader.uid, "propose", { team: [1, 1] }),
    /不合法/,
  );
  assert.throws(
    () =>
      run(r, r.players.find((p) => p.uid !== leader.uid).uid, "propose", {
        team: [1, 2],
      }),
    /队长/,
  );
  const good = r.players.find((p) => r.roles[p.uid] === "servant");
  const teammate = r.players.find((p) => p.uid !== good.uid);
  beginQuest(r, [good.seat, teammate.seat]);
  assert.throws(() => run(r, good.uid, "submit", { value: "fail" }), /不合法/);
  const out = r.players.find((p) => !r.team.includes(p.seat));
  assert.throws(
    () => run(r, out.uid, "submit", { value: "success" }),
    /不合法/,
  );
});
test("完整好人胜利链路、刺杀只能合法目标、重开清空身份与记录", () => {
  const r = setup();
  all(r);
  advance(r);
  for (let q = 0; q < 3; q++) {
    completeQuest(
      r,
      r.players.slice(0, TEAMS[6][q]).map((p) => p.seat),
    );
    advance(r);
  }
  assert.equal(r.phase, "assassination");
  const assassin = r.players.find((p) => r.roles[p.uid] === "assassin"),
    servant = r.players.find((p) => r.roles[p.uid] === "servant");
  assert.throws(
    () => run(r, assassin.uid, "submit", { value: assassin.seat }),
    /不合法/,
  );
  all(r, (p) => (p.uid === assassin.uid ? servant.seat : "confirm"));
  advance(r);
  assert.equal(r.result.winner, "good");
  run(r, "p1", "rematch");
  assert.equal(r.phase, "lobby");
  assert.equal(r.roles, undefined);
  assert.equal(r.history.length, 0);
  assert.ok(r.players.every((p) => !p.ready));
  r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
  run(r, "p1", "start");
  assert.equal(r.game, 2);
});
test("刺杀梅林坏人胜", () => {
  const r = setup();
  all(r);
  advance(r);
  for (let q = 0; q < 3; q++) {
    completeQuest(
      r,
      r.players.slice(0, TEAMS[6][q]).map((p) => p.seat),
    );
    advance(r);
  }
  const merlin = r.players.find((p) => r.roles[p.uid] === "merlin");
  all(r, (p) => (r.roles[p.uid] === "assassin" ? merlin.seat : "confirm"));
  advance(r);
  assert.equal(r.result.winner, "evil");
});
test("3次失败胜利及7人第4任务双失败阈值", () => {
  const r = setup();
  all(r);
  advance(r);
  const evil = r.players.find((p) => r.roles[p.uid] === "assassin");
  for (let q = 0; q < 3; q++) {
    const team = [
      evil.seat,
      ...r.players
        .filter((p) => p !== evil)
        .slice(0, TEAMS[6][q] - 1)
        .map((p) => p.seat),
    ];
    completeQuest(r, team, [evil.seat]);
    if (q < 2) advance(r);
  }
  assert.equal(r.result.winner, "evil");
  for (const failCount of [1, 2]) {
    const g = setup(7);
    all(g);
    advance(g);
    const evils = g.players.filter((p) =>
      ["assassin", "minion"].includes(g.roles[p.uid]),
    );
    for (let q = 0; q < 4; q++) {
      const team = [
        ...evils.map((p) => p.seat),
        ...g.players.filter((p) => !evils.includes(p)).map((p) => p.seat),
      ].slice(0, TEAMS[7][q]);
      completeQuest(
        g,
        team,
        q === 0 || q === 3
          ? evils.slice(0, q === 0 ? 1 : failCount).map((p) => p.seat)
          : [],
      );
      if (q < 3) advance(g);
    }
    assert.equal(g.quests[3].success, failCount === 1);
    assert.equal(g.quests[3].threshold, 2);
  }
});
test("终止不揭露身份，可重开；开始后不能加入或移动座位", () => {
  const r = setup();
  assert.throws(() => enter(r, "x", "新玩家"), /已开始/);
  assert.throws(() => run(r, "p1", "seat", { seat: 2 }), /不可换座/);
  run(r, "p1", "terminate");
  assert.equal(r.result.winner, null);
  assert.equal(publicView(r, "p1").roles, undefined);
  run(r, "p1", "rematch");
  assert.equal(r.roles, undefined);
});

test("用户确认10/12人完整角色配置：梅林不见大莫、派西不区分梅莫、奥伯伦互不认识", () => {
  for (const n of [10, 12]) {
    const r = newRoom("123456", "p1", "房主", "classic-court", n);
    for (let i = 2; i <= n; i++) enter(r, "p" + i, "玩家" + i);
    r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
    run(r, "p1", "start");
    const find = (role) => r.players.filter((p) => r.roles[p.uid] === role);
    assert.equal(find("oberon").length, n === 10 ? 1 : 2);
    assert.equal(find("servant").length, n === 10 ? 4 : 5);
    const merlin = privateView(r, find("merlin")[0].uid).information;
    const listed = merlin.split("：")[1].split("（")[0].split("、").map(Number);
    assert.ok(!listed.includes(find("mordred")[0].seat));
    assert.ok(find("oberon").every((p) => listed.includes(p.seat)));
    const percival = privateView(r, find("percival")[0].uid).information;
    assert.ok(percival.includes("无法区分"));
    find("oberon").forEach((p) =>
      assert.equal(
        privateView(r, p.uid).information,
        "你不知道其他坏人是谁，其他坏人也看不见你。",
      ),
    );
    const allies = privateView(r, find("assassin")[0].uid)
      .information.split("：")[1]
      .split("（")[0]
      .split("、")
      .map(Number);
    assert.ok(find("oberon").every((p) => !allies.includes(p.seat)));
    if (n === 12) assert.deepEqual(TEAMS[n], [3, 4, 5, 6, 6]);
    all(r);
    advance(r);
    for (let q = 0; q < 3; q++) {
      completeQuest(
        r,
        r.players.slice(0, TEAMS[n][q]).map((p) => p.seat),
      );
      advance(r);
    }
    const actions = privateView(r, find("assassin")[0].uid).action;
    assert.equal(actions.targets.length, n - 1);
    assert.ok(
      find("oberon").every((p) =>
        actions.targets.some((t) => t.seat === p.seat),
      ),
    );
    all(r, (p) =>
      r.roles[p.uid] === "assassin" ? find("merlin")[0].seat : "confirm",
    );
    advance(r);
    assert.equal(r.result.winner, "evil");
  }
});

function setupBoard(id, n) {
  const r = newRoom("123456", "p1", "房主", id, n);
  for (let i = 2; i <= n; i++) enter(r, "p" + i, "玩家" + i);
  r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
  run(r, "p1", "start");
  return r;
}
test("11人逆仆只见刺客、对梅林举手、其他坏人看不见，只能成功", () => {
  const r = setupBoard("classic-11", 11),
    reverse = r.players.find((p) => r.roles[p.uid] === "reverse"),
    assassin = r.players.find((p) => r.roles[p.uid] === "assassin"),
    merlin = r.players.find((p) => r.roles[p.uid] === "merlin");
  assert.deepEqual(TEAMS[11], [3, 4, 5, 6, 6]);
  assert.equal(Object.values(r.roles).filter((x) => x === "servant").length, 4);
  assert.ok(
    privateView(r, reverse.uid).information.includes(
      `刺客位于：${assassin.seat}号`,
    ),
  );
  const seen = privateView(r, merlin.uid)
    .information.split("：")[1]
    .split("（")[0]
    .split("、")
    .map(Number);
  assert.ok(seen.includes(reverse.seat));
  const allies = privateView(r, assassin.uid)
    .information.split("：")[1]
    .split("（")[0]
    .split("、")
    .map(Number);
  assert.ok(!allies.includes(reverse.seat));
  all(r);
  advance(r);
  beginQuest(r, [
    reverse.seat,
    ...r.players
      .filter((p) => p !== reverse)
      .slice(0, 2)
      .map((p) => p.seat),
  ]);
  assert.throws(
    () => run(r, reverse.uid, "submit", { value: "fail" }),
    /不合法/,
  );
});
test("11人逆仆刀命中/未中均继续刺梅林；转阵营只在本人视图出现", () => {
  for (const reverseHit of [false, true])
    for (const merlinHit of [false, true]) {
      const r = setupBoard("classic-11", 11);
      all(r);
      advance(r);
      for (let q = 0; q < 3; q++) {
        completeQuest(
          r,
          r.players.slice(0, TEAMS[11][q]).map((p) => p.seat),
        );
        advance(r);
      }
      assert.equal(r.phase, "reverseStrike");
      const reverse = r.players.find((p) => r.roles[p.uid] === "reverse"),
        merlin = r.players.find((p) => r.roles[p.uid] === "merlin"),
        servant = r.players.find((p) => r.roles[p.uid] === "servant");
      all(r, (p) =>
        r.roles[p.uid] === "assassin"
          ? reverseHit
            ? reverse.seat
            : servant.seat
          : "confirm",
      );
      advance(r);
      assert.equal(r.phase, "assassination");
      assert.equal(
        privateView(r, reverse.uid).faction,
        reverseHit ? "坏人阵营" : "好人阵营",
      );
      for (const p of r.players) {
        const v = publicView(r, p.uid);
        assert.equal(v.convertedReverse, undefined);
        assert.ok(v.history.every((h) => h.kind !== "reverseStrike"));
      }
      all(r, (p) =>
        r.roles[p.uid] === "assassin"
          ? merlinHit
            ? merlin.seat
            : servant.seat
          : "confirm",
      );
      advance(r);
      assert.equal(r.result.winner, merlinHit ? "evil" : "good");
      assert.equal(
        privateView(r, reverse.uid).outcome,
        reverseHit === merlinHit ? "本局你获胜" : "本局你失败",
      );
      run(r, "p1", "rematch");
      assert.equal(r.convertedReverse, undefined);
    }
});
test("影中执刃辅助模式真实任务限制、阶段结算与线下结束，不冒充自动胜方", () => {
  const r = setupBoard("shadow-assist", 12);
  const role = (p) => r.roles[p.uid];
  assert.equal(Object.values(r.roles).filter((x) => x === "servant").length, 4);
  for (const p of r.players)
    assert.ok(privateView(r, p.uid).information.includes("不提供额外初始视野"));
  all(r);
  advance(r);
  const good = r.players.filter((p) =>
    ["merlin", "percival", "servant", "blueTraitor"].includes(role(p)),
  );
  for (let q = 0; q < 3; q++) {
    completeQuest(
      r,
      good.slice(0, TEAMS[12][q]).map((p) => p.seat),
    );
    advance(r);
  }
  assert.equal(r.phase, "offlineFinal");
  assert.equal(r.result, null);
  assert.equal(publicView(r, "p1").canAdvance, false);
  assert.throws(() => run(r, "p2", "closeOffline"), /房主/);
  run(r, "p1", "closeOffline");
  assert.equal(r.phase, "ended");
  assert.equal(r.result.winner, null);
  run(r, "p1", "rematch");
  assert.equal(r.phase, "lobby");
  const g = setupBoard("shadow-assist", 12);
  all(g);
  advance(g);
  const forced = g.players.filter((p) =>
    ["oberon", "redTraitor"].includes(g.roles[p.uid]),
  );
  const blue = g.players.find((p) => g.roles[p.uid] === "blueTraitor");
  beginQuest(g, [...forced.map((p) => p.seat), blue.seat]);
  for (const p of forced)
    assert.throws(
      () => run(g, p.uid, "submit", { value: "success" }),
      /不合法/,
    );
  assert.throws(() => run(g, blue.uid, "submit", { value: "fail" }), /不合法/);
  run(g, "p1", "offline");
  assert.equal(g.phase, "offlineFinal");
  assert.equal(g.result, null);
});

test("10人仅保留用户确认的经典基础角色板", () => {
  assert.throws(() => newRoom("123456", "p1", "甲", "classic", 10), /人数/);
  const r = newRoom("123456", "p1", "甲", "classic-court", 10);
  assert.equal(publicView(r, "p1").boardName, "阿瓦隆 · 经典基础");
});
