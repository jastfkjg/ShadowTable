const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newRoom, enter, command, publicView } = require("../server/engine");
const { Store } = require("../server/store");
const { Leaderboard } = require("../server/leaderboard");
const funCopy = require("../miniprogram/fun-copy");

const run = (room, type, input, uid = room.host) => command(room, uid, { type, stage: room.stage, ...input });
const playersAs = (room, role) => room.players.filter(player => room.roles[player.uid] === role);
const playerAs = (room, role) => playersAs(room, role)[0];
const finish = (room, input) => run(room, "finishTools", input);
const metric = (room, player, id) => publicView(room, player.uid).myFun.metrics.find(row => row.id === id);

function deal(board, capacity) {
  const room = newRoom("123456", "wx:1", "房主", board, capacity);
  for (let i = 2; i <= capacity; i++) enter(room, `wx:${i}`, `玩家${i}`);
  room.players.forEach(player => player.ready = true);
  run(room, "start", { flexible: true });
  return room;
}

function quest(room, team, fail = [], { threshold = 1, defaults = [] } = {}) {
  run(room, "beginActivity", { kind: "quest", team: team.map(player => player.seat), threshold });
  for (const player of team) {
    if (defaults.includes(player)) continue;
    run(room, "submit", { value: fail.includes(player) ? "fail" : "success" }, player.uid);
  }
  if (defaults.length) run(room, "closeWaiting", { confirm: true });
}

test("逆仆个人记录区分两刀、拒绝互相串计，管理更正同步回查", () => {
  const room = deal("classic", 9), reverse = playerAs(room, "reverse");
  const decoy = playerAs(room, "servant"), merlin = playerAs(room, "merlin");
  finish(room, { funReason: "assassination", funTarget: reverse.seat, reverseTarget: decoy.seat });
  assert.equal(metric(room, reverse, "reverse_guard").count, 1);
  assert.equal(metric(room, reverse, "reverse_recruit").count, 0);
  assert.doesNotMatch(JSON.stringify(publicView(room, reverse.uid)), /"reverseStrike"|"reverseTarget"/);
  assert.doesNotMatch(JSON.stringify(publicView(room, decoy.uid)), /首席护卫|最佳新援/);

  const store = new Store(":memory:");
  try {
    store.save(room);
    const filter = { metric: "reverse_guard", mode: "all" };
    const tiles = funCopy.records(store.funFor(reverse.uid)).tiles;
    const guard = tiles.find(row => row.id === filter.metric);
    assert.equal(guard.title, "首席护卫");
    assert.equal(guard.unit, "局");
    assert.equal(guard.rateLabel, "");
    assert.match(guard.url, /fun=reverse_guard&mode=all/);
    assert.equal(store.matchesFor(reverse.uid, 0, 20, false, filter).total, 1);
    const leaderboard = new Leaderboard(store);
    const rank = (id, extra = {}) => leaderboard.read(reverse.uid, new URLSearchParams({ metric: "fun_" + id, ...extra }));
    for (const id of Object.keys(funCopy.roleRecords)) {
      assert.equal(rank(id).countOnly, true);
      assert.equal(rank(id).metricLabel, "达成次数");
      assert.deepEqual(rank(id).roleOptions, []);
      assert.throws(() => rank(id, { sort: "rate" }), /仅支持总次数榜/);
      assert.throws(() => rank(id, { mode: "classic" }), /仅支持总次数榜/);
    }
    const board = rank(filter.metric, { period: "all" });
    assert.equal(board.title, "首席护卫");
    assert.equal(board.me.rank, 1);
    assert.equal(board.rows[0].count, 1);
    assert.doesNotMatch(JSON.stringify(board.rows), /reverseTarget|reverseStrike|wx:/);

    store.transaction(() => store.correctFunMatch(room.matchId, {
      revision: 0, funReason: "assassination", funTarget: merlin.seat, reverseTarget: reverse.seat,
    }));
    const updated = store.get(room.code);
    assert.equal(metric(updated, reverse, "reverse_guard").count, 0);
    assert.equal(metric(updated, reverse, "reverse_recruit").count, 1);
    assert.equal(store.matchesFor(reverse.uid, 0, 20, false, filter).total, 0);
    assert.equal(rank(filter.metric, { period: "all" }).me.rank, null);
    assert.equal(rank("reverse_recruit", { period: "all" }).rows[0].count, 1);
  } finally { store.close(); }
});

test("历史任务自动结算忠臣全勤、躺赢及莫甘娜同车，三绿资料不足时躺赢保持未知", () => {
  for (const [thirdGreen, manual] of [[false, false], [true, false], [true, true]]) {
    const room = deal("classic-court", 9);
    const [regular, bench] = playersAs(room, "servant");
    const morgana = playerAs(room, "morgana"), percival = playerAs(room, "percival");
    run(room, "beginActivity", { kind: "quest", team: [bench.seat], threshold: 1 });
    run(room, "cancelActivity");
    quest(room, [regular, morgana, percival]);
    quest(room, [regular, percival, morgana]);
    if (thirdGreen) quest(room, [regular, playerAs(room, "merlin")]);
    finish(room, manual ? { winner: "good" } : { funReason: "assassination", funTarget: regular.seat });
    assert.equal(metric(room, regular, "servant_all_green").count, Number(thirdGreen));
    assert.equal(metric(room, morgana, "morgana_with_percival").count, 1);
    assert.equal(metric(room, bench, "servant_bench_win").count, Number(thirdGreen));
    assert.equal(metric(room, bench, "servant_bench_win").status, thirdGreen ? "known" : "unknown");
    assert.equal(metric(room, regular, "servant_bench_win").count, 0);
    assert.doesNotMatch(JSON.stringify(publicView(room, percival.uid)), /playedFailure|梅林二号/);

    const store = new Store(":memory:");
    try {
      store.save(room);
      const archived = JSON.parse(store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(room.matchId).snapshot);
      for (const event of archived.funFacts.events) delete event.members;
      store.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(archived), room.matchId);
      store.db.exec("DELETE FROM match_fun_stats WHERE metric='servant_bench_win'; UPDATE match_players SET snapshot=json_set(snapshot,'$.fun.version','fun-2026-10-v4')");
      store.transaction(() => store.restoreFunRecords());
      assert.equal(store.funFor(morgana.uid).metrics.find(row => row.id === "morgana_with_percival").count, 1);
      assert.equal(store.funFor(regular.uid).metrics.find(row => row.id === "servant_all_green").count, Number(thirdGreen));
      assert.equal(store.funFor(bench.uid).metrics.find(row => row.id === "servant_bench_win").value, thirdGreen ? 1 : null);
      assert.doesNotMatch(JSON.stringify(store.matchFor(regular.uid, room.matchId)), /playedFailure|梅林二号/);
    } finally { store.close(); }
  }
});

test("兰斯按当时阵营记绿车和亲手失败，允许换回原阵营且不计系统补牌", () => {
  for (const defaulted of [false, true]) {
    const room = deal("lancelot", 11), blue = playerAs(room, "blueLancelot"), red = playerAs(room, "redLancelot");
    const servant = playerAs(room, "servant");
    room.lancelot.conversions = [true, true];
    quest(room, [blue, servant]);
    quest(room, [red, servant], [red]);
    run(room, "beginActivity", { kind: "conversion" });
    quest(room, [blue, servant], [blue], { defaults: defaulted ? [blue] : [] });
    quest(room, [red, servant]);
    run(room, "beginActivity", { kind: "conversion" });
    quest(room, [red, servant], [red]);
    finish(room, { winner: "evil" });
    assert.equal(metric(room, blue, "lancelot_both").count, defaulted ? 0 : 1);
    assert.equal(metric(room, blue, "lancelot_both").status, "known");
    assert.equal(metric(room, red, "lancelot_both").count, 1);
  }
});

test("莫德雷德须是第三次炸车唯一红方，奥伯伦须本人两次炸车", () => {
  for (const secondRed of [false, true]) {
    const room = deal("classic-court", 10);
    const mordred = playerAs(room, "mordred"), oberon = playerAs(room, "oberon");
    const servant = playerAs(room, "servant"), assassin = playerAs(room, "assassin");
    quest(room, [oberon, servant], [oberon], { threshold: 2 });
    quest(room, [oberon, servant], [oberon]);
    quest(room, [oberon, servant], [oberon], { defaults: secondRed ? [oberon] : [] });
    quest(room, [mordred, servant, ...(secondRed ? [assassin] : [])], [mordred]);
    finish(room, { funReason: "quest_fail" });
    assert.equal(metric(room, mordred, "mordred_last_bust").count, secondRed ? 0 : 1);
    assert.equal(metric(room, oberon, "oberon_two_busts").count, secondRed ? 0 : 1);
  }
});
