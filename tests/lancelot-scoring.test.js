const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { newRoom, enter, command, publicView, privateView } = require('../server/engine');
const { Store } = require('../server/store');
const { Leaderboard } = require('../server/leaderboard');
const honors = require('../server/honors');
const scoring = require('../server/scoring');
const run = (room, type, extra = {}) => command(room, room.host, { type, stage: room.stage, ...extra });
const role = (room, name) => room.players.find(p => room.roles[p.uid] === name);
function setup(capacity, enabled = true) {
  const room = newRoom('123456', 'wx:1', '房主', 'lancelot', capacity);
  for (let i = 2; i <= capacity; i++) enter(room, `wx:${i}`, `玩家${i}`);
  run(room, 'updateSettings', { board: room.board, capacity, visible: false, scoreEnabled: enabled });
  room.players.forEach(p => p.ready = true);
  run(room, 'start', { flexible: true });
  room.lancelot.conversions = [true, false, true];
  return room;
}
const finish = (room, reason = 'assassination', target = role(room, 'merlin').seat) =>
  run(room, 'finishTools', { scoreReason: reason, scoreTarget: target, replace: true });

test('红蓝兰斯11／12人支持计分但默认关闭，使用单刀表单且不开放提前盘刀', () => {
  for (const capacity of [11, 12]) {
    const lobby = newRoom('123456', 'wx:1', '房主', 'lancelot', capacity);
    assert.equal(scoring.settings(lobby).enabled, false);
    assert.equal(scoring.settings(lobby).unavailableReason, null);
    const room = setup(capacity), view = publicView(room, room.host);
    assert.deepEqual(view.scoreSettlement.map(o => o.id), ['assassination', 'quest_fail']);
    assert.equal(view.scoreSettlement[0].requiresReverseTarget, undefined);
    assert.equal(view.settlementRequiresActor, false);
    const before = structuredClone(room);
    assert.throws(() => finish(room, 'early_assassination'), /结束原因无效/);
    assert.throws(() => finish(room, 'assassination', capacity + 1), /目标/);
    assert.deepEqual(room, before);
  }
  assert.equal(scoring.settings(newRoom('123456', 'wx:1', '房主', 'chaos', 12)).unavailableReason, '本板子暂未参与计分');
});

test('未转换、转换一次及转换回原阵营的兰斯按终局阵营计分，角色奖励仍仅适用梅林派西', () => {
  for (const capacity of [11, 12]) for (const draws of [0, 1, 2, 3])
    for (const ending of ['hit', 'miss', 'quest_fail']) {
      const room = setup(capacity);
      for (let i = 0; i < draws; i++) run(room, 'beginActivity', { kind: 'conversion' });
      const swapped = draws === 1 || draws === 2;
      finish(room, ending === 'quest_fail' ? 'quest_fail' : 'assassination', ending === 'miss' ? 0 : role(room, 'merlin').seat);
      const winner = ending === 'miss' ? 'good' : 'evil';
      assert.equal(room.result.winner, winner);
      for (const player of room.matchRecord.players) {
        const lance = ['blueLancelot', 'redLancelot'].includes(player.roleId);
        if (lance) {
          const expected = (player.roleId === 'blueLancelot') !== swapped ? 'good' : 'evil';
          assert.equal(player.faction, expected);
          assert.equal(player.outcome, expected === winner ? 'win' : 'loss');
          assert.equal(player.score.total, expected === winner ? 9 : expected === 'good' && ending === 'hit' ? 3 : 0);
          assert.ok(!player.score.breakdown.some(a => a.id === 'role'));
        } else if (['merlin', 'percival'].includes(player.roleId)) {
          assert.equal(player.score.total, ending === 'miss' ? 12 : ending === 'hit' ? 2 : 0);
        }
      }
    }
});

test('蓝方兰斯可挡刀，转红后不拿挡刀奖励，作废未完成任务仍保留已完成转换', () => {
  for (const capacity of [11, 12]) for (const converted of [false, true]) for (const roleId of ['blueLancelot', 'redLancelot']) {
    const room = setup(capacity);
    if (converted) run(room, 'beginActivity', { kind: 'conversion' });
    const target = role(room, roleId);
    run(room, 'beginActivity', { kind: 'quest', team: [target.seat], threshold: 1 });
    finish(room, 'assassination', target.seat);
    const player = room.matchRecord.players.find(p => p.uid === target.uid);
    const good = (roleId === 'blueLancelot') !== converted;
    assert.equal(player.faction, good ? 'good' : 'evil');
    assert.equal(player.score.total, good ? 15 : 0);
    assert.equal(player.score.breakdown.some(a => a.id === 'shield'), good);
  }
});

test('转换状态重启后结算进明细和榜单，管理员更正保持归档阵营，重存不重复计分', () => {
  for (const capacity of [11, 12]) {
    const dir = mkdtempSync(join(tmpdir(), 'lancelot-scoring-')), path = join(dir, 'db.sqlite');
    let store = new Store(path);
    try {
      let room = setup(capacity);
      const blue = role(room, 'blueLancelot'), red = role(room, 'redLancelot'), merlin = role(room, 'merlin');
      run(room, 'beginActivity', { kind: 'conversion' });
      store.save(room);store.close();store = new Store(path);room = store.get(room.code);
      assert.equal(privateView(room, blue.uid).faction, '坏人阵营');
      finish(room, 'assassination', red.seat);store.save(room);store.save(room);
      assert.equal(store.statsFor(red.uid).score.total, 15);
      assert.equal(store.statsFor(red.uid).score.games, 1);
      assert.equal(new Leaderboard(store).read(red.uid, new URLSearchParams('metric=points')).me.points, 15);
      store.transaction(() => store.correctMatch(room.matchId, { revision: 0, scoreReason: 'assassination', scoreTarget: merlin.seat }));
      assert.equal(store.matchFor(red.uid, room.matchId).score.total, 3);
      assert.equal(store.matchFor(blue.uid, room.matchId).score.total, 9);
      store.transaction(() => store.correctMatch(room.matchId, { revision: 1, scoreReason: 'quest_fail' }));
      assert.equal(store.matchFor(red.uid, room.matchId).score.total, 0);
      assert.equal(store.matchFor(blue.uid, room.matchId).score.total, 9);
      assert.equal(store.statsFor(blue.uid).byFaction.find(f => f.faction === 'evil').score.total, 9);
      assert.equal(privateView(store.get(room.code), red.uid).faction, '好人阵营');
      assert.equal(store.matchFor(red.uid, room.matchId).role, '红兰斯洛特');
      assert.doesNotMatch(JSON.stringify(publicView(store.get(room.code), merlin.uid)), /"lancelot"\s*:|"conversions"|"scorePolicy"/);
    } finally { store.close();rmSync(dir, { recursive: true, force: true }); }
  }
});

test('红蓝兰斯按最终胜负参与MVP／SVP，重复保存不重复发奖', () => {
  for (const capacity of [11, 12]) {
    const room = setup(capacity), store = new Store(':memory:');
    try {
      run(room, 'beginActivity', { kind: 'conversion' });finish(room);store.save(room);
      const blue = role(room, 'blueLancelot'), red = role(room, 'redLancelot');
      const winners = room.matchRecord.players.filter(p => p.outcome === 'win'), losers = room.matchRecord.players.filter(p => p.outcome === 'loss');
      const act = (uid, type, extra = {}) => store.transaction(() => honors.handle(store, store.get(room.code), uid,
        { type, stage: room.stage, matchId: room.matchId, ...extra }));
      act(room.host, 'honorStart');
      for (const voter of room.players) act(voter.uid, 'honorVote', {
        mvp: blue.uid !== voter.uid ? blue.seat : winners.find(p => p.uid !== voter.uid).seat,
        svp: red.uid !== voter.uid ? red.seat : losers.find(p => p.uid !== voter.uid).seat,
      });
      assert.equal(store.matchFor(blue.uid, room.matchId).score.total, 10);
      assert.equal(store.matchFor(red.uid, room.matchId).score.total, 4);
      store.save(store.get(room.code));
      assert.equal(store.statsFor(blue.uid).score.total, 10);
      assert.equal(store.statsFor(red.uid).score.total, 4);
    } finally { store.close(); }
  }
});

test('关闭计分、终止、仅登记胜方及v15旧快照不计分，旧资格不能由后台补算', () => {
  for (const capacity of [11, 12]) for (const mode of ['disabled', 'terminated', 'manual', 'legacy']) {
    const room = setup(capacity, mode !== 'disabled');
    if (mode === 'legacy') { delete room.scorePolicy.boards.lancelot;room.scorePolicy.version = 'avalon-2026-11-v15'; }
    if (mode === 'terminated') run(room, 'terminate');
    else run(room, 'finishTools', { winner: 'good' });
    assert.ok(room.matchRecord.players.every(p => p.score.status === 'excluded'));
    if (['disabled', 'legacy'].includes(mode)) {
      const store = new Store(':memory:');
      try {
        store.save(room);
        assert.throws(() => store.transaction(() => store.correctMatch(room.matchId, { revision: 0, scoreReason: 'quest_fail' })), /不在计分范围/);
      } finally { store.close(); }
    }
  }
});
