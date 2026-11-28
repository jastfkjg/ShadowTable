const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newRoom, enter, command, publicView, privateView } = require("../server/engine");
const { Store } = require("../server/store");
const scoring = require("../server/scoring");
const registration = require("../miniprogram/result-registration");

const run = (room, type, input = {}) => command(room, room.host, { type, stage: room.stage, ...input });
function deal(board, scoreEnabled = true) {
  const room = newRoom("123456", "wx:1", "房主", board, 12);
  for (let i = 2; i <= 12; i++) enter(room, "wx:" + i, "玩家" + i);
  run(room, "updateSettings", { board, capacity: 12, visible: false, scoreEnabled });
  room.players.forEach(player => player.ready = true);
  run(room, "start", { flexible: true });
  return room;
}
const seat = (room, role) => room.players.find(player => room.roles[player.uid] === role)?.seat || 0;
const finish = (room, target, boardChoices) => run(room, "finishTools", {
  scoreReason: target === null ? "quest_fail" : "assassination", scoreTarget: seat(room, target), boardChoices,
});
const get = (room, roleId) => room.matchRecord.players.find(player => player.roleId === roleId);

test("内奸七种计分行逐人匹配，蓝内奸挡刀的分数独立于房主确认的独赢条件", () => {
  const roles = ["merlin", "percival", "servant", "blueTraitor", "redTraitor", "assassin"];
  for (const [knife, target, points, winner] of [
    [null, null, [1,1,1,1,8,9], "evil"],
    ["evil", "servant", [12,12,9,9,1,2], "good"],
    ["evil", "blueTraitor", [11,11,8,12,1,2], "good"],
    ["traitor", "", [12,12,9,9,3,1], "good"],
    ["traitor", "blueTraitor", [11,11,8,12,3,1], "good"],
    ["evil", "merlin", [2,2,3,3,1,9], "evil"],
    ["traitor", "merlin", [2,2,3,3,12,3], "redTraitor"],
  ]) for (const blueSolo of ["no", "yes"]) {
    const room = deal("shadow-assist");
    finish(room, target, { knife, blueSolo });
    assert.deepEqual(roles.map(role => get(room, role).score.total), points);
    assert.equal(room.result.winner, blueSolo === "yes" && target === "blueTraitor" ? "blueTraitor" : winner);
    assert.ok(room.matchRecord.players.some(p => p.outcome === "win"));
    if (room.result.winner === "blueTraitor" || room.result.winner === "redTraitor") {
      assert.deepEqual(room.matchRecord.players.filter(p => p.outcome === "win").map(p => p.roleId), [room.result.winner]);
    }
    if (target !== null) assert.equal(room.fun.terminal.actor?.role, knife === "traitor" ? "redTraitor" : undefined);
  }
});

test("混沌契约七种计分行，捣蛋鬼按绑定阵营或第四方挡刀计分", () => {
  const roles = ["merlin", "percival", "servant", "mordred", "redThief", "blueThief"];
  for (const [thieves, target, points, fourthPoints] of [
    [null, null, [2,2,2,9,1,1]],
    ["win", "servant", [3,3,2,1,12,12]],
    ["win", "trickster", [3,3,2,1,12,12], 4],
    ["win", "merlin", [1,1,2,3,12,12]],
    ["loss", "", [12,12,9,2,1,1]],
    ["loss", "trickster", [8,8,7,2,1,1], 9],
    ["loss", "merlin", [2,2,3,9,1,1]],
  ]) for (const trickster of ["good", "evil", "third", "mixed"]) {
    const room = deal("chaos");
    finish(room, target, { thieves, trickster });
    const fourth = trickster === "mixed" && target === "trickster";
    const expected = target === "trickster" && thieves === "loss" && !fourth ? [12,12,9,2,1,1] : points;
    assert.deepEqual(roles.map(role => get(room, role).score.total), expected);
    const player = get(room, "trickster");
    assert.equal(player.faction, fourth ? "fourth" : trickster === "mixed" ? "good" : trickster);
    assert.equal(player.score.total, fourth ? fourthPoints : expected[{ good:2, evil:3, third:4 }[player.faction]]);
    assert.equal(room.result.winner, thieves === "win" ? "third" : fourth ? "fourth" : target === null || target === "merlin" ? "evil" : "good");
    assert.equal(player.outcome, player.faction === room.result.winner ? "win" : "loss");
  }
});

test("板子结算字段经由表单、归档、后台更正和投票重算，新局沿用开局时的分值", () => {
  const room = deal("chaos"), view = publicView(room,room.host);
  const draft = { room:view, resultReason:"assassination", resultTarget:seat(room,"trickster"), resultStep:"board" };
  assert.equal(registration.flow(draft).resultReady, false);
  const boardChoices = { thieves:"win", trickster:"mixed" };
  assert.equal(registration.flow({ ...draft, resultBoardChoices:boardChoices }).resultReady, true);
  const before = structuredClone(room);
  assert.throws(() => finish(room, "trickster", { thieves:"win" }), /捣蛋鬼/);
  assert.deepEqual(room, before);
  finish(room, "trickster", boardChoices);
  const player = get(room,"trickster");
  const store = new Store(":memory:");
  try {
    store.transaction(() => store.save(room));
    assert.equal(store.matchFor(player.uid, room.matchId).score.total, 4);
    store.transaction(() => store.correctMatch(room.matchId, { revision:0, scoreReason:"assassination", scoreTarget:player.seat, boardChoices:{ thieves:"loss" } }));
    const updated = store.matchFor(player.uid, room.matchId);
    assert.equal(updated.score.total, 9);
    assert.equal(updated.outcome, "win");
    assert.equal(store.statsFor(player.uid).byFaction[0].label, "第四方捣蛋鬼");
    const bonus = scoring.scorePlayer({...player,outcome:"win"}, {...room.scoringFacts, scenario:"loss_shield"}, room.scorePolicy, null, { status:"settled", mvp:[{seat:player.seat}] });
    assert.equal(bonus.total, 10);
    store.transaction(() => store.correctMatch(room.matchId, { revision:1, scoreReason:"quest_fail", boardChoices:{trickster:"evil"} }));
    assert.equal(store.matchFor(player.uid,room.matchId).score.total,9);
    assert.equal(store.matchFor(player.uid,room.matchId).faction,"evil");
    assert.equal(privateView(store.get(room.code),player.uid).faction,"坏人阵营");
  } finally { store.close(); }
  const frozen = deal("shadow-assist");
  frozen.scorePolicy.boardScores["shadow-assist"].scenarios.red.points.redTraitor = 6;
  finish(frozen, null, {});
  assert.equal(get(frozen,"redTraitor").score.total,6);
  for (const board of ["shadow-assist", "chaos"]) {
    const off = deal(board, false);
    assert.deepEqual(publicView(off,off.host).scoreSettlement, []);
    const old = deal(board);
    delete old.scorePolicy.boards[board];
    delete old.scorePolicy.boardScores;
    assert.deepEqual(publicView(old,old.host).scoreSettlement, []);
    run(old, "finishTools", {winner:"good"});
    assert.ok(old.matchRecord.players.every(p => p.score.status === "excluded"));
  }
});
