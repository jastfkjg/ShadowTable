const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS, TEAMS, newRoom, enter, command, publicView, privateView } = require("../server/engine");
const run = (room, type, extra = {}, uid = room.host) =>
  command(room, uid, { stage: room.stage, type, ...extra });
function setup(capacity) {
  const room = newRoom("123456", "p1", "房主", "lancelot", capacity);
  for (let i = 2; i <= capacity; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach(player => run(room, "ready", { ready: true }, player.uid));
  run(room, "start", { flexible: true });
  return room;
}

test("红蓝兰斯板仅开放11/12人，12人只增加一名奥伯伦，原有板子保留", () => {
  const board = BOARDS.find(board => board.id === "lancelot");
  assert.deepEqual(board.counts, [11, 12]);
  for (const capacity of [9, 10, 13])
    assert.throws(() => newRoom("123456", "p1", "房主", "lancelot", capacity), /人数/);
  for (const capacity of [11, 12]) {
    const room = setup(capacity);
    const expected = ["merlin", "percival", ...Array(4).fill("servant"), "blueLancelot",
      "mordred", "morgana", "assassin", "redLancelot", ...(capacity === 12 ? ["oberon"] : [])];
    assert.deepEqual(Object.values(room.roles).sort(), expected.sort());
    const view = publicView(room, room.host);
    assert.equal(view.boardName, "阿瓦隆 · 红蓝兰斯");
    assert.deepEqual(view.roleConfiguration, board.roleConfigurations[capacity]);
    assert.deepEqual(view.roleConfiguration.map(group => group.count), [7, capacity - 7]);
    assert.equal(view.hasReverse, false);
    assert.equal(view.knights, null);
    assert.equal(view.supportsConversion, true);
    assert.equal(room.lancelot.conversions.length, 7);
    assert.equal(room.lancelot.conversions.filter(Boolean).length, 2);
    assert.deepEqual(TEAMS[capacity], [3, 4, 5, 6, 6]);
    assert.throws(() => run(room, "beginActivity", { kind: "skills" }), /不支持/);
  }
  assert.ok(BOARDS.find(board => board.id === "classic-11").counts.includes(11));
  assert.ok(BOARDS.find(board => board.id === "classic-court").counts.includes(12));
});

test("红蓝兰斯均闭眼，梅林只见初始红兰，见面匪互认且不见红兰或奥伯伦", () => {
  for (const capacity of [11, 12]) {
    const room = setup(capacity);
    const find = role => room.players.find(player => room.roles[player.uid] === role);
    const merlin = privateView(room, find("merlin").uid).information;
    const visible = merlin.split("：")[1].split("（")[0].split("、").map(Number);
    assert.deepEqual(visible.sort((a, b) => a - b), ["morgana", "assassin", "redLancelot", ...(capacity === 12 ? ["oberon"] : [])]
      .map(role => find(role).seat).sort((a, b) => a - b));
    for (const role of ["blueLancelot", "redLancelot", "servant"])
      assert.equal(privateView(room, find(role).uid).information, "没有视野。");
    for (const role of ["mordred", "morgana", "assassin"]) {
      const information = privateView(room, find(role).uid).information;
      for (const ally of ["mordred", "morgana", "assassin"].filter(ally => ally !== role))
        assert.ok(information.includes(`${find(ally).seat}号`));
      assert.doesNotMatch(information, /兰斯洛特|奥伯伦/);
    }
    assert.match(privateView(room, find("percival").uid).information, /无法区分/);
    if (capacity === 12) assert.match(privateView(room, find("oberon").uid).information, /不知道其他坏人/);
  }
});

test("转换立即交换阵营和强制出牌，初始视野及已结算任务不变，只有本人收到身份提醒", () => {
  const { actionDetails, completeActionDetails } = require("../server/audit");
  for (const capacity of [11, 12]) {
    const room = setup(capacity);
    const find = role => room.players.find(player => room.roles[player.uid] === role);
    const blue = find("blueLancelot"), red = find("redLancelot"), merlin = find("merlin");
    const roles = structuredClone(room.roles), vision = privateView(room, merlin.uid).information;
    const team = [blue.seat, red.seat];
    run(room, "beginActivity", { kind: "quest", team, threshold: 1 });
    assert.deepEqual(privateView(room, blue.uid).action.choices, ["success"]);
    assert.deepEqual(privateView(room, red.uid).action.choices, ["fail"]);
    assert.throws(() => run(room, "submit", { value: "success" }, red.uid), /不合法/);
    run(room, "submit", { value: "success" }, blue.uid);
    run(room, "submit", { value: "fail" }, red.uid);
    const quest = structuredClone(room.history.at(-1));
    room.lancelot.conversions = [true, false, true];
    const before = structuredClone(room);
    const details = actionDetails(room, room.host, "beginActivity", { kind: "conversion" });
    run(room, "beginActivity", { kind: "conversion" });
    const audit = completeActionDetails(details, before, room);
    assert.equal(audit.outcomes[0].lines.length, 2);
    assert.ok(audit.outcomes[0].lines.some(line => line.includes("蓝兰斯洛特 → 坏人")));
    assert.ok(audit.outcomes[0].lines.some(line => line.includes("红兰斯洛特 → 好人")));
    assert.deepEqual(room.roles, roles);
    assert.deepEqual(room.history[0], quest);
    assert.equal(privateView(room, merlin.uid).information, vision);
    assert.equal(privateView(room, blue.uid).faction, "坏人阵营");
    assert.equal(privateView(room, red.uid).faction, "好人阵营");
    for (const player of room.players) {
      const view = publicView(room, player.uid);
      assert.equal(view.me.identityChanged, [blue.uid, red.uid].includes(player.uid));
      assert.equal(view.lancelot, undefined);
      assert.equal(view.players.some(player => "faction" in player || "role" in player), false);
    }
    assert.throws(() => run(room, "ackIdentity", { revision: 0 }, blue.uid), /已变化/);
    run(room, "ackIdentity", { revision: 1 }, blue.uid);
    assert.equal(publicView(room, blue.uid).me.identityChanged, false);
    assert.equal(publicView(room, red.uid).me.identityChanged, true);
    for (const player of [blue, red]) assert.equal(privateView(room, player.uid).information, "没有视野。");
    run(room, "beginActivity", { kind: "quest", team, threshold: 1 });
    assert.deepEqual(privateView(room, blue.uid).action.choices, ["fail"]);
    assert.deepEqual(privateView(room, red.uid).action.choices, ["success"]);
    assert.throws(() => run(room, "beginActivity", { kind: "conversion", replace: true }), /请先完成/);
    run(room, "cancelActivity");
    run(room, "beginActivity", { kind: "conversion" });
    assert.equal(privateView(room, blue.uid).identityRevision, 1);
    run(room, "beginActivity", { kind: "conversion" });
    assert.equal(privateView(room, blue.uid).faction, "好人阵营");
    assert.equal(privateView(room, blue.uid).identityRevision, 2);
    const exhausted = structuredClone(room);
    assert.throws(() => run(room, "beginActivity", { kind: "conversion" }), /已用完/);
    assert.deepEqual(room, exhausted);
  }
});

test("转换仅房主能发起，状态可持久保存，终局随当前阵营，重开清空并重置牌堆", () => {
  const { Store } = require("../server/store");
  const store = new Store(":memory:");
  try {
    const room = setup(12), player = role => room.players.find(player => room.roles[player.uid] === role);
    const blue = player("blueLancelot"), red = player("redLancelot");
    room.lancelot.conversions = [true];
    const initial = structuredClone(room);
    assert.throws(() => run(room, "beginActivity", { kind: "conversion" }, room.players[1].uid), /只有房主/);
    assert.deepEqual(room, initial);
    run(room, "beginActivity", { kind: "conversion" });
    store.transaction(() => store.save(room));
    const saved = store.get(room.code);
    assert.equal(privateView(saved, blue.uid).faction, "坏人阵营");
    assert.equal(publicView(saved, red.uid).me.identityChanged, true);
    run(room, "finishTools", { winner: "good" });
    assert.equal(privateView(room, red.uid).outcome, "本局你获胜");
    assert.equal(privateView(room, blue.uid).outcome, "本局你失败");
    assert.equal(room.matchRecord.players.find(player => player.uid === red.uid).faction, "good");
    assert.equal(room.matchRecord.players.find(player => player.uid === blue.uid).faction, "evil");
    run(room, "rematch");
    assert.equal(room.lancelot, undefined);
    room.players.forEach(player => run(room, "ready", { ready: true }, player.uid));
    run(room, "start");
    assert.equal(room.phase, "tools");
    assert.equal(room.lancelot.conversions.length, 7);
    assert.equal(room.lancelot.conversions.filter(Boolean).length, 2);
    assert.ok(room.players.every(player => !publicView(room, player.uid).me.identityChanged));
  } finally {
    store.close();
  }
});
