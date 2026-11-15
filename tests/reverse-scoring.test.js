const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { newRoom, enter, command, publicView, privateView } = require('../server/engine');
const { Store } = require('../server/store');
const { Leaderboard } = require('../server/leaderboard');
const honors = require('../server/honors');
const scoring = require('../server/scoring');
const boards = [['classic', 9], ['classic-11', 11]];
const run = (room, type, extra = {}, uid = room.host) => command(room, uid, { type, stage: room.stage, ...extra });
const role = (room, id) => room.players.find(player => room.roles[player.uid] === id);
function deal(board, capacity, { enabled = true, flexible = true } = {}) {
  const room = newRoom('123456', 'wx:1', '房主', board, capacity);
  for (let i = 2; i <= capacity; i++) enter(room, `wx:${i}`, `玩家${i}`);
  run(room, 'updateSettings', { board, capacity, visible: false, scoreEnabled: enabled });
  room.players.forEach(player => player.ready = true);
  run(room, 'start', { flexible });
  return room;
}
function strike(room, hit) {
  run(room, 'beginActivity', { kind: 'reverseStrike' });
  const target = role(room, hit ? 'reverse' : 'servant');
  for (const player of room.players) run(room, 'submit', {
    value: room.roles[player.uid] === 'assassin' ? target.seat : 'confirm',
  }, player.uid);
  assert.equal(room.phase, 'tools');
}
const finish = (room, reason = 'assassination', target = role(room, 'merlin').seat) =>
  run(room, 'finishTools', { scoreReason: reason, scoreTarget: target, replace: true });

test('房主一次登记两刀覆盖9／11人、计分开关及四种命中组合，无需任何玩家确认', () => {
  for (const [board, capacity] of boards) for (const enabled of [false, true])
    for (const hit of [false, true]) for (const merlinHit of [false, true]) {
      const room = deal(board, capacity, { enabled });
      const reverse = role(room, 'reverse');
      const options = publicView(room, room.host)[enabled ? 'scoreSettlement' : 'funSettlement'];
      assert.equal(options.find(option => option.id === 'assassination').requiresReverseTarget, true);
      assert.ok(!options.some(option => option.id === 'five_rejections'));
      assert.equal(publicView(room, room.host).reverseSettlement, true);
      run(room, 'finishTools', {
        [enabled ? 'scoreReason' : 'funReason']: 'assassination',
        [enabled ? 'scoreTarget' : 'funTarget']: role(room, merlinHit ? 'merlin' : 'servant').seat,
        reverseTarget: role(room, hit ? 'reverse' : 'servant').seat,
      });
      assert.equal(room.phase, 'ended');assert.deepEqual(room.submissions, {});
      const player = room.matchRecord.players.find(player => player.uid === reverse.uid);
      assert.equal(player.faction, hit ? 'evil' : 'good');
      assert.equal(player.outcome, hit === merlinHit ? 'win' : 'loss');
      assert.equal(player.score.status, enabled ? 'scored' : 'excluded');
      assert.equal(player.score.total, !enabled ? 0 : hit ? merlinHit ? 9 : 0 : merlinHit ? 3 : 9);
      assert.equal(room.history.some(entry => entry.kind === 'toolReverse'), false);
    }
});

test('两刀登记只允许房主，缺少或非法目标和作废中的请求均不提前改变状态', () => {
  for (const [board, capacity] of boards) for (const enabled of [false, true]) {
    const room = deal(board, capacity, { enabled });
    const fields = { [enabled ? 'scoreReason' : 'funReason']: 'assassination',
      [enabled ? 'scoreTarget' : 'funTarget']: role(room, 'merlin').seat, reverseTarget: role(room, 'reverse').seat };
    const before = structuredClone(room);
    assert.throws(() => run(room, 'finishTools', fields, 'wx:2'), /只有房主/);
    for (const reverseTarget of [undefined, null, 0, -1, capacity + 1, '2']) {
      assert.throws(() => run(room, 'finishTools', { ...fields, reverseTarget }), /逆仆刀/);
      assert.deepEqual(room, before);
    }
    assert.throws(() => run(room, 'finishTools', { ...fields, [enabled ? 'scoreTarget' : 'funTarget']: capacity + 1 }), /目标/);
    assert.deepEqual(room, before);
    run(room, 'beginActivity', { kind: 'vote' });
    const active = structuredClone(room);
    assert.throws(() => run(room, 'finishTools', fields), /作废/);
    assert.deepEqual(room, active);
    run(room, 'finishTools', { ...fields, replace: true });
    assert.equal(room.phase, 'ended');assert.equal(room.convertedReverse, role(room, 'reverse').uid);
  }
});

test('非刺杀不接受逆仆刀字段，三红车清除旧流程的转阵营，其他板子不接受两刀', () => {
  for (const [board, capacity] of boards) for (const enabled of [false, true]) {
    const room = deal(board, capacity, { enabled });
    strike(room, true);
    const reason = enabled ? 'scoreReason' : 'funReason';
    const before = structuredClone(room);
    assert.throws(() => run(room, 'finishTools', { [reason]: 'quest_fail', reverseTarget: role(room, 'reverse').seat }), /仅逆仆局/);
    assert.deepEqual(room, before);
    run(room, 'finishTools', { [reason]: 'quest_fail' });
    const reverse = room.matchRecord.players.find(player => player.roleId === 'reverse');
    assert.equal(reverse.faction, 'good');assert.equal(reverse.outcome, 'loss');assert.equal(reverse.score.total, 0);
    assert.equal(room.reverseStrike, null);
  }
  const room = deal('classic', 6);
  assert.throws(() => run(room, 'finishTools', { scoreReason: 'assassination', scoreTarget: 1, reverseTarget: 2 }), /仅逆仆局/);
});

test('两刀归档可更正第一刀，计分与不计分的阵营、胜负及结束牌桌同步且事实不公开', () => {
  for (const [board, capacity] of boards) for (const enabled of [false, true]) {
    const room = deal(board, capacity, { enabled });
    const reverse = role(room, 'reverse'), merlin = role(room, 'merlin'), servant = role(room, 'servant');
    run(room, 'finishTools', { [enabled ? 'scoreReason' : 'funReason']: 'assassination',
      [enabled ? 'scoreTarget' : 'funTarget']: merlin.seat, reverseTarget: reverse.seat });
    const store = new Store(':memory:');
    try {
      store.save(room);
      const correct = (revision, reason, reverseTarget) => store.transaction(() => store[enabled ? 'correctMatch' : 'correctFunMatch'](room.matchId,
        { revision, [enabled ? 'scoreReason' : 'funReason']: reason, [enabled ? 'scoreTarget' : 'funTarget']: merlin.seat,
          ...(reverseTarget === undefined ? {} : { reverseTarget }) }));
      correct(0, 'assassination', servant.seat);
      let record = store.matchFor(reverse.uid, room.matchId);
      assert.equal(record.faction, 'good');assert.equal(record.outcome, 'loss');assert.equal(record.score.total, enabled ? 3 : 0);
      assert.equal(privateView(store.get(room.code), reverse.uid).faction, '好人阵营');
      correct(1, 'assassination', reverse.seat);
      record = store.matchFor(reverse.uid, room.matchId);
      assert.equal(record.faction, 'evil');assert.equal(record.outcome, 'win');assert.equal(record.score.total, enabled ? 9 : 0);
      correct(2, 'quest_fail');
      assert.equal(store.matchFor(reverse.uid, room.matchId).faction, 'good');
      correct(3, 'assassination');
      assert.equal(store.matchFor(reverse.uid, room.matchId).faction, 'evil');
      assert.equal(store.statsFor(reverse.uid).score.total, enabled ? 9 : 0);
      for (const player of room.players) {
        assert.doesNotMatch(JSON.stringify(store.statsFor(player.uid)), /"reverseStrike"|"reverseTarget"/);
        assert.doesNotMatch(JSON.stringify(store.matchesFor(player.uid)), /"reverseStrike"|"reverseTarget"/);
        assert.doesNotMatch(JSON.stringify(publicView(store.get(room.code), player.uid)), /"reverseStrike"|"reverseTarget"/);
      }
    } finally { store.close(); }
  }
});

test('9、11人逆仆默认关闭，只新增这两种计分资格且不提供提前盘刀', () => {
  for (const [board, capacity] of boards) {
    const lobby = newRoom('123456', 'wx:1', '房主', board, capacity);
    assert.deepEqual(scoring.settings(lobby), { enabled: false, editable: true,
      defaultEnabledBoards: scoring.policy().defaultEnabledBoards, unavailableReason: null });
    const room = deal(board, capacity);
    assert.deepEqual(publicView(room, room.host).scoreSettlement.map(item => item.id), ['assassination', 'quest_fail']);
    assert.throws(() => finish(room, 'early_assassination'), /结束原因无效/);
  }
  for (const [board, capacity] of [['lancelot', 11], ['shadow-assist', 12], ['chaos', 12]]) {
    assert.equal(scoring.settings(newRoom('123456', 'wx:1', '房主', board, capacity)).unavailableReason, '本板子暂未参与计分');
  }
});

test('逆仆刀命中/未中 × 梅林刀命中/未中按最终阵营计分；第一段无挡刀奖励', () => {
  for (const [board, capacity] of boards) for (const hit of [false, true]) for (const merlinHit of [false, true]) {
    const room = deal(board, capacity), reverse = role(room, 'reverse');
    strike(room, hit);
    const target = role(room, merlinHit ? 'merlin' : 'percival').seat;
    finish(room, 'assassination', target);
    const player = room.matchRecord.players.find(player => player.uid === reverse.uid);
    assert.equal(player.faction, hit ? 'evil' : 'good');
    assert.equal(player.score.total, hit ? merlinHit ? 9 : 0 : merlinHit ? 3 : 9);
    assert.equal(player.outcome, hit === merlinHit ? 'win' : 'loss');
    for (const p of room.matchRecord.players) {
      const expected = p.faction === 'evil' ? merlinHit ? 9 : 0
        : ['merlin', 'percival'].includes(p.roleId) ? merlinHit ? 2 : 12 : merlinHit ? 3 : 9;
      assert.equal(p.score.total, expected);
      assert.ok(!p.score.breakdown.some(award => award.id === 'shield'));
    }
    for (const p of room.players) {
      assert.doesNotMatch(JSON.stringify(publicView(room, p.uid)), /reverseStrike|convertedReverse|scorePolicy|scoringFacts|"hit":/);
    }
    assert.equal(privateView(room, reverse.uid).faction, hit ? '坏人阵营' : '好人阵营');
  }
});

test('仅最终刺梅林可给蓝方逆仆挡刀奖励，已转红逆仆不获挡刀或三绿奖励', () => {
  for (const [board, capacity] of boards) for (const hit of [false, true]) {
    const room = deal(board, capacity);
    strike(room, hit);
    finish(room, 'assassination', role(room, 'reverse').seat);
    const reverse = room.matchRecord.players.find(p => p.roleId === 'reverse');
    assert.equal(reverse.score.total, hit ? 0 : 15);
    assert.equal(reverse.score.breakdown.some(a => a.id === 'shield'), !hit);
  }
});

test('计分局必须结算一次逆仆刀，拒绝跳过、重复和矛盾终局；作废可重试且不改变隐藏状态', () => {
  for (const [board, capacity] of boards) {
    const room = deal(board, capacity);
    let before = structuredClone(room);
    assert.throws(() => finish(room), /填写逆仆刀目标/);
    assert.throws(() => run(room, 'beginActivity', { kind: 'assassination' }), /请先完成刀逆仆/);
    assert.deepEqual(room, before);
    run(room, 'beginActivity', { kind: 'reverseStrike' });
    const assassin = role(room, 'assassin');
    run(room, 'submit', { value: role(room, 'reverse').seat }, assassin.uid);
    before = structuredClone(room);
    assert.throws(() => finish(room), /填写逆仆刀目标/);
    assert.deepEqual(room, before);
    run(room, 'cancelActivity');
    assert.equal(room.reverseStrike, null);
    assert.equal(room.convertedReverse, null);
    strike(room, false);
    before = structuredClone(room);
    assert.throws(() => run(room, 'beginActivity', { kind: 'reverseStrike' }), /不能重复/);
    for (const reason of ['five_rejections']) assert.throws(() => finish(room, reason), /不能包含逆仆刀/);
    assert.deepEqual(room, before);
    finish(room);
    run(room, 'rematch');
    assert.equal(room.reverseStrike, undefined);
    assert.equal(room.convertedReverse, undefined);
    assert.equal(room.scoreEnabled, true);
  }
});

test('三红车和五次否决逆仆失败为0分；未开启、终止、旧快照和仅登记胜方不补算', () => {
  for (const [board, capacity] of boards) {
    for (const reason of ['quest_fail', 'five_rejections']) {
      const room = deal(board, capacity);
      finish(room, reason);
      const reverse = room.matchRecord.players.find(p => p.roleId === 'reverse');
      assert.equal(reverse.faction, 'good');assert.equal(reverse.outcome, 'loss');assert.equal(reverse.score.total, 0);
    }
    for (const mode of ['disabled', 'legacy', 'manual', 'terminated']) {
      const room = deal(board, capacity, { enabled: mode !== 'disabled' });
      if (mode === 'legacy') {
        room.scorePolicy.version = 'avalon-2026-10-v13';
        delete room.scorePolicy.reverseBoards;
        if (board === 'classic') room.scorePolicy.boards.classic = [5, 6, 7, 8];
        else delete room.scorePolicy.boards['classic-11'];
      }
      if (mode === 'terminated') run(room, 'terminate');
      else run(room, 'finishTools', { winner: 'good' });
      assert.ok(room.matchRecord.players.every(p => p.score.status === 'excluded'));
      if (mode === 'disabled' || mode === 'legacy') {
        const store = new Store(':memory:');
        try {
          store.save(room);
          assert.throws(() => store.transaction(() => store.correctMatch(room.matchId, { revision: 0, scoreReason: 'quest_fail' })), /不在计分范围/);
        } finally { store.close(); }
      }
    }
    const off = deal(board, capacity, { enabled: false });
    strike(off, true);strike(off, false); // Non-scoring games retain the existing tool behavior.
  }
});

test('重启保留逆仆刀与规则快照，更正同步阵营/榜单/本人视图；同胜方改阵营也撤回票选积分', () => {
  for (const [board, capacity] of boards) {
    const dir = mkdtempSync(join(tmpdir(), 'reverse-score-')), path = join(dir, 'db.sqlite');
    let store = new Store(path);
    try {
      let room = deal(board, capacity);
      strike(room, true);
      const reverse = role(room, 'reverse'), merlin = role(room, 'merlin');
      store.save(room);store.close();store = new Store(path);room = store.get(room.code);
      assert.equal(room.reverseStrike.hit, true);
      finish(room);store.save(room);
      // Award both sides through the real anonymous voting flow.
      const act = (uid, type, extra = {}) => store.transaction(() => honors.handle(store, store.get(room.code), uid,
        { type, stage: room.stage, matchId: room.matchId, ...extra }));
      act(room.host, 'honorStart');
      const winners = room.matchRecord.players.filter(p => p.outcome === 'win');
      const losers = room.matchRecord.players.filter(p => p.outcome === 'loss');
      for (const voter of room.players) act(voter.uid, 'honorVote', {
        mvp: reverse.uid !== voter.uid ? reverse.seat : winners.find(p => p.uid !== voter.uid).seat,
        svp: merlin.uid !== voter.uid ? merlin.seat : losers.find(p => p.uid !== voter.uid).seat,
      });
      assert.equal(store.matchFor(reverse.uid, room.matchId).score.total, 10);
      assert.equal(new Leaderboard(store).read(reverse.uid, new URLSearchParams('metric=points')).me.points, 10);
      const correct = (revision, reason, target = merlin.seat) => store.transaction(() => store.correctMatch(room.matchId,
        { revision, scoreReason: reason, scoreTarget: target }));
      correct(0, 'quest_fail'); // Winner remains evil, but the reverse servant returns to good.
      let record = store.matchFor(reverse.uid, room.matchId);
      assert.equal(record.faction, 'good');assert.equal(record.outcome, 'loss');assert.equal(record.score.total, 0);
      assert.equal(record.honorResult.status, 'invalidated');
      assert.equal(privateView(store.get(room.code), reverse.uid).faction, '好人阵营');
      assert.equal(store.db.prepare('SELECT faction FROM match_players WHERE match_id=? AND uid=?').get(room.matchId, reverse.uid).faction, 'good');
      assert.equal(store.statsFor(reverse.uid).byFaction.find(row => row.faction === 'good').score.games, 1);
      correct(1, 'assassination');
      record = store.matchFor(reverse.uid, room.matchId);
      assert.equal(record.faction, 'evil');assert.equal(record.score.total, 9);
      assert.equal(privateView(store.get(room.code), reverse.uid).faction, '坏人阵营');
      assert.equal(store.statsFor(reverse.uid).score.total, 9);
      for (const player of room.players) {
        assert.doesNotMatch(JSON.stringify(store.statsFor(player.uid)), /reverseStrike|convertedReverse|scoringFacts/);
        assert.doesNotMatch(JSON.stringify(store.matchesFor(player.uid)), /reverseStrike|convertedReverse|scoringFacts/);
      }
      // Re-saving an old table does not overwrite the corrected archive or award twice.
      store.save(room);assert.equal(store.statsFor(reverse.uid).score.total, 9);
      store.close();store = new Store(path);
      assert.equal(store.matchFor(reverse.uid, room.matchId).score.total, 9);
      assert.throws(() => correct(0, 'quest_fail'), /已更新/);
      const noStrike = deal(board, capacity);finish(noStrike, 'quest_fail');store.save(noStrike);
      assert.throws(() => store.transaction(() => store.correctMatch(noStrike.matchId,
        { revision: 0, scoreReason: 'assassination', scoreTarget: role(noStrike, 'merlin').seat })), /缺少逆仆刀记录/);
    } finally { store.close();rmSync(dir, { recursive: true, force: true }); }
  }
});

test('旧顺序流程完成逆仆刀后也写入可计分事实', () => {
  for (const [board, capacity] of boards) {
    const room = deal(board, capacity, { flexible: false });
    // Enter the existing final-action phase, as three successful quests do.
    room.phase = 'reverseStrike';room.submissions = {};
    const reverse = role(room, 'reverse');
    for (const p of room.players) run(room, 'submit', { value: room.roles[p.uid] === 'assassin' ? reverse.seat : 'confirm' }, p.uid);
    run(room, 'advance');
    assert.equal(room.phase, 'assassination');assert.equal(room.reverseStrike.hit, true);
    for (const p of room.players) run(room, 'submit', { value: room.roles[p.uid] === 'assassin' ? role(room, 'merlin').seat : 'confirm' }, p.uid);
    run(room, 'advance');
    assert.equal(room.matchRecord.players.find(p => p.uid === reverse.uid).score.total, 9);
  }
});
