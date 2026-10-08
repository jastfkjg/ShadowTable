const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newRoom, enter, command, publicView, privateView } = require("../server/engine");

const run = (room, uid, type, extra = {}) => command(room, uid, { type, stage: room.stage, ...extra });
function setup(capacity = 12) {
  const room = newRoom("123456", "p1", "房主", capacity === 12 ? "knights" : `knights-${capacity}`, capacity);
  for (let i = 2; i <= capacity; i++) enter(room, `p${i}`, `玩家${i}`);
  enter(room, "spectator", "围观");
  room.players.forEach(player => run(room, player.uid, "ready", { ready: true }));
  run(room, "p1", "start", { flexible: true });
  for (const player of room.players) {
    room.roles[player.uid] = "servant";
    Object.assign(room.knights.players[player.uid], { armor: false, used: false, b: false });
  }
  Object.assign(room.roles, { p1: "gareth", p2: "redLancelot", p3: "blueAwakened" });
  room.knights.initialRoles = { ...room.roles };
  room.knights.deck = ["redAwakened", "blueGuard"];
  return room;
}
function skills(room, actions = {}) {
  run(room, "p1", "beginActivity", { kind: "skills" });
  for (const player of room.players) {
    const action = privateView(room, player.uid).action;
    if (action) run(room, player.uid, "submit", { value: actions[player.uid] ?? "pass" });
  }
  assert.equal(room.phase, "tools");
}

test("具体技能记录保存当时座位和轮次，仅本人可见且不受后续换号影响", () => {
  const room = setup();
  skills(room, { p1: "target:8" });
  const history = privateView(room, "p1").skillHistory;
  assert.deepEqual(history, [{ id: 0, round: 1, text: "刀8号" }]);
  assert.deepEqual(privateView(room, "p1").identityHistory[0].skillHistory, history);
  assert.equal(privateView(room, "p1").skillStatus.title, "技能已用完");
  for (const player of room.players) {
    assert.doesNotMatch(JSON.stringify(publicView(room, player.uid)), /skillHistory|刀8号/);
    if (player.uid !== "p1") assert.deepEqual(privateView(room, player.uid).skillHistory, []);
  }
  room.players.find(player => player.uid === "p8").seat = 9;
  assert.deepEqual(privateView(room, "p1").skillHistory, history);
  assert.deepEqual(privateView(JSON.parse(JSON.stringify(room)), "p1").skillHistory, history);
});

test("同轮互刀换牌前归档技能，新身份记录独立，阵营转换也保留旧记录", () => {
  const room = setup();
  skills(room, { p1: "target:2", p2: "target:1" });
  for (const [uid, text] of [["p1", "刀2号"], ["p2", "刀1号"]]) {
    const view = privateView(room, uid);
    assert.deepEqual(view.skillHistory, []);
    assert.deepEqual(view.identityHistory[1].skillHistory, [{ id: 0, round: 1, text }]);
  }
  const old = privateView(room, "p2").identityHistory[1];
  skills(room, { p2: "target:8" });
  assert.deepEqual(privateView(room, "p2").skillHistory, [{ id: 0, round: 2, text: "刀8号" }]);
  assert.deepEqual(privateView(room, "p2").identityHistory[1], old);

  const converted = setup();
  skills(converted, { p2: "target:8" });
  converted.knights.conversions = [true];
  run(converted, "p1", "beginActivity", { kind: "conversion" });
  const view = privateView(converted, "p2");
  assert.deepEqual(view.skillHistory, []);
  assert.equal(view.identityHistory[1].skillHistory[0].text, "刀8号");
});

test("守护逐轮记录目标，区分未触发和已消耗", () => {
  const room = setup();
  room.roles.p2 = "blueGuard";
  room.knights.players.p2.b = true;
  skills(room, { p2: "target:9" });
  assert.equal(room.knights.players.p2.used, false);
  skills(room, { p2: "target:9", p3: "target:9" });
  const view = privateView(room, "p2");
  assert.deepEqual(view.skillHistory, [
    { id: 0, round: 1, text: "守护9号 · 未触发，技能未消耗" },
    { id: 1, round: 2, text: "守护9号 · 已触发，技能已消耗" },
  ]);
  assert.equal(view.skillStatus.title, "技能已用完");
  assert.equal(room.knights.players.p9.alive, true);
});

test("换号记录保留选择与结算目标，替死、查验和反伤记录对应技能", () => {
  const swapped = setup();
  swapped.roles.p4 = "magician";
  swapped.roles.p5 = "blueGuard";
  skills(swapped, { p1: "target:8", p4: "swap:8:9", p5: "target:9" });
  assert.equal(privateView(swapped, "p1").skillHistory[0].text, "刀8号（换号后目标9号）");
  assert.equal(privateView(swapped, "p4").skillHistory[0].text, "换号8号 ↔ 9号 · 已触发，技能已消耗");
  assert.equal(privateView(swapped, "p5").skillHistory[0].text, "守护9号（换号后目标8号） · 未触发，技能未消耗");

  const witch = setup();
  witch.roles.p2 = "witch";
  skills(witch, { p2: "target:9", p3: "target:2" });
  assert.equal(privateView(witch, "p2").skillHistory[0].text, "指定9号替死 · 已触发，技能已消耗");

  const inspect = setup();
  inspect.roles.p2 = "gargoyle";
  skills(inspect, { p2: "inspect:9" });
  assert.equal(privateView(inspect, "p2").skillHistory[0].text, "查验9号");
  skills(inspect, { p2: "inspect:8" });
  assert.equal(privateView(inspect, "p2").skillHistory[1].text, "查验8号");

  const paladin = setup();
  paladin.roles.p2 = "paladin";
  skills(paladin, { p3: "target:2" });
  assert.equal(privateView(paladin, "p2").skillHistory[0].text, "反伤3号");
});

test("猎人区分预选与实际开枪，自爆和决斗在换牌前保存", () => {
  for (const [value, attack, expected] of [
    ["passive:8", false, "预选被动开枪8号 · 未触发，技能未消耗"],
    ["passive:8", true, "被动开枪8号 · 已触发，技能已消耗"],
    ["detonate:1", false, "主动自爆并向1号开枪"],
  ]) {
    const room = setup();
    room.roles.p2 = "blueHunter";
    skills(room, { p2: value, ...(attack ? { p3: "target:2" } : {}) });
    const view = privateView(room, "p2");
    const record = view.skillHistory[0] || view.identityHistory[1].skillHistory[0];
    assert.equal(record.text, expected);
  }
  const room = setup();
  room.roles.p2 = "blueKnight";
  skills(room, { p2: "target:8" });
  assert.equal(privateView(room, "p2").identityHistory[1].skillHistory[0].text, "决斗8号");
});

test("未结算、取消和跳过不追加技能记录；旧存档不伪造使用目标，重开清空", () => {
  const room = setup();
  run(room, "p1", "beginActivity", { kind: "skills" });
  run(room, "p1", "submit", { value: "target:8" });
  assert.deepEqual(privateView(room, "p1").skillHistory, []);
  run(room, "p1", "cancelActivity");
  skills(room);
  assert.deepEqual(privateView(room, "p1").skillHistory, []);
  skills(room, { p1: "target:8" });
  const saved = privateView(room, "p1").skillHistory;
  run(room, "p1", "beginActivity", { kind: "skills" });
  run(room, "p1", "cancelActivity");
  assert.deepEqual(privateView(room, "p1").skillHistory, saved);
  const legacy = JSON.parse(JSON.stringify(room));
  delete legacy.knights.players.p1.skillHistory;
  const before = JSON.stringify(legacy);
  assert.deepEqual(privateView(legacy, "p1").skillHistory, []);
  assert.equal(JSON.stringify(legacy), before);
  run(room, "p1", "finishTools");
  run(room, "p1", "rematch");
  room.players.forEach(player => run(room, player.uid, "ready", { ready: true }));
  run(room, "p1", "start", { flexible: true });
  assert.deepEqual(privateView(room, "p1").skillHistory, []);
});

test("十二骑士11/12/13人局保存多次身份变化，倒序回看且只向本人返回", () => {
  for (const size of [11, 12, 13]) {
    const room = setup(size);
    assert.equal(privateView(room, "p2").identityHistory.length, 1);
    skills(room, { p1: "target:2" });
    const first = privateView(room, "p2").identityHistory;
    assert.deepEqual(first.map(record => record.role), ["觉醒红刀客", "红兰斯洛特"]);
    assert.equal(first[0].current, true);
    assert.equal(first[0].sinceLabel, "第1轮 · 换牌");
    assert.equal(first[1].initial, true);
    assert.match(first[1].information, /可刀刀客或B角色一次/);
    assert.equal(first[1].skillStatus, undefined);
    assert.equal(first[1].action, undefined);
    skills(room, { p3: "target:2" });
    const view = privateView(room, "p2");
    assert.deepEqual(view.identityHistory.map(record => record.role), ["蓝守卫", "觉醒红刀客", "红兰斯洛特"]);
    assert.equal(view.identityHistory[0].sinceLabel, "第2轮 · 换牌");
    assert.deepEqual(view.identityHistory[2], first[1]);
    assert.deepEqual(privateView(JSON.parse(JSON.stringify(room)), "p2").identityHistory, view.identityHistory);
    for (const player of room.players) {
      assert.doesNotMatch(JSON.stringify(publicView(room, player.uid)), /identityHistory|identitySince|可刀刀客或B角色一次/);
      if (player.uid !== "p2") assert.equal(privateView(room, player.uid).identityHistory.length, 1);
    }
    assert.throws(() => privateView(room, "spectator"), /围观玩家没有身份/);
    const before = JSON.stringify(room);
    privateView(room, "p2");
    assert.equal(JSON.stringify(room), before);
    run(room, "p1", "finishTools");
    run(room, "p1", "rematch");
    room.players.forEach(player => run(room, player.uid, "ready", { ready: true }));
    run(room, "p1", "start", { flexible: true });
    assert.equal(privateView(room, "p2").identityHistory.length, 1);
  }
});

test("阵营转换保留原阵营；不转换不追加，同名角色可区分转换记录", () => {
  const room = setup();
  room.knights.conversions = [false, true, true];
  run(room, "p1", "beginActivity", { kind: "conversion" });
  assert.equal(privateView(room, "p2").identityHistory.length, 1);
  run(room, "p1", "beginActivity", { kind: "conversion" });
  const view = privateView(room, "p2");
  assert.deepEqual(view.identityHistory.map(record => record.faction), ["好人阵营", "坏人阵营"]);
  assert.equal(view.identityHistory[0].sinceLabel, "第1轮 · 阵营转换");
  run(room, "p1", "beginActivity", { kind: "conversion" });
  assert.deepEqual(privateView(room, "p2").identityHistory.map(record => record.faction), ["坏人阵营", "好人阵营", "坏人阵营"]);
});

test("历史视野包含换牌前本轮查验，之后查验结果和换号不会改写旧视野", () => {
  const room = setup();
  room.roles.p2 = "gargoyle";
  room.knights.players.p2.b = true;
  room.knights.players.p2.identitySince = { round: 1, reason: "redraw" };
  room.knights.deck = ["blueGuard"];
  skills(room, { p1: "target:2", p2: "inspect:3" });
  const old = privateView(room, "p2").identityHistory[1];
  assert.equal(old.role, "石像鬼");
  assert.match(old.information, /第1次查验：3号拥有主动击杀能力/);
  assert.doesNotMatch(privateView(room, "p2").information, /查验记录/);
  room.roles.p3 = "servant";
  room.players.find(player => player.uid === "p3").seat = 9;
  assert.deepEqual(privateView(room, "p2").identityHistory[1], old);
});

test("取消技能与护甲保留原牌不会生成旧身份，旧存档只补已知初始角色", () => {
  const room = setup();
  run(room, "p1", "beginActivity", { kind: "skills" });
  run(room, "p1", "submit", { value: "target:2" });
  run(room, "p1", "cancelActivity");
  assert.equal(privateView(room, "p2").identityHistory.length, 1);
  room.roles.p2 = "merlin";
  room.knights.initialRoles.p2 = "merlin";
  room.knights.players.p2.armor = true;
  skills(room, { p3: "target:2" });
  assert.equal(privateView(room, "p2").identityHistory.length, 1);
  const legacy = setup();
  legacy.roles.p2 = "redAwakened";
  legacy.knights.players.p2.b = true;
  delete legacy.knights.players.p2.identityHistory;
  delete legacy.knights.players.p2.identitySince;
  const history = privateView(legacy, "p2").identityHistory;
  assert.equal(history[0].round, null);
  assert.equal(history[1].role, "红兰斯洛特");
  assert.equal(history[1].detailAvailable, false);
  assert.equal(history[1].information, null);
  skills(legacy, { p3: "target:2" });
  assert.deepEqual(privateView(legacy, "p2").identityHistory.map(record => record.role), ["觉醒红刀客", "觉醒红刀客", "红兰斯洛特"]);
});
