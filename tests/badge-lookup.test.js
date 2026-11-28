'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Store } = require('../server/store');
const { read } = require('../server/badge-lookup');
const { catalogue } = require('../miniprogram/badges');
const { readProfile, saveProfile } = require('../server/profile');
const { grantContributor } = require('../server/badge-awards');
const { create } = require('../miniprogram/pages/badges/rank-controller');

function fixture(t) {
  let now = Date.parse('2026-11-15T12:00:00+08:00');
  const store = new Store(':memory:', { clock: () => now });
  t.after(() => store.close());
  return { store, lookup: (id, params) => read(store, id, new URLSearchParams(params), now),
    game(players, settings = {}) {
      store.archiveMatch({ id: randomUUID(), board: 'classic-court', capacity: 9, endedAt: ++now, winner: 'good', ...settings,
        players: players.map(([uid, roleId, outcome], i) => ({ uid, roleId, role: roleId, seat: i + 1, outcome,
          faction: 'good', score: { status: 'scored', total: 2, breakdown: [] } })) });
    }, nextMonth() { now = Date.parse('2026-12-01T00:00:00+08:00'); } };
}

test('徽章目录覆盖全部定义与结算月份，月榜复用真实成绩和并列名次，达成与永久徽章遵循各自周期', t => {
  const f = fixture(t), roles = ['merlin', 'percival', 'servant', 'mordred', 'morgana', 'assassin', 'oberon'];
  assert.deepEqual(new Set(f.lookup().ids), new Set(catalogue.map(b => b.id)));
  for (const { id } of catalogue) assert.equal(f.lookup(id).total, 0, id);
  for (let i = 0; i < 10; i++) {
    f.game([['wx:a', roles[i % 7], 'win'], ['wx:b', 'merlin', i === 9 ? 'loss' : 'win'], ['dev:c', 'merlin', i === 9 ? 'loss' : 'win']]);
  }
  assert.deepEqual(f.lookup('win_streak').rows.map(r => [r.rank, r.value, r.earned]), [[1,10,true],[2,9,false],[2,9,false]]);
  assert.deepEqual(f.lookup('games').rows.map(r => [r.rank, r.value]), [[1,10],[1,10],[1,10]]);
  assert.deepEqual(f.lookup('rate_overall').rows.map(r => [r.rank,r.value,r.unit]), [[1,'100.0','%'],[2,'90.0','%'],[2,'90.0','%']]);
  for (const [id, count] of [['ten_wins',1], ['five_wins',3], ['role_collector',1], ['attendance',3]]) {
    const result = f.lookup(id);
    assert.equal(result.total, count);
    assert.equal(result.holdersOnly, true);
    assert.ok(result.rows.every(row => row.rank === null && row.earned));
  }
  f.nextMonth();
  assert.equal(f.lookup('role_collector').total, 0);
  assert.equal(f.lookup('ten_wins').total, 1);
  assert.ok(f.lookup().ids.includes('monthly_points_2026-11_1'));
  assert.deepEqual(f.lookup('monthly_points_2026-11_1').rows.map(r => r.rank), [1,1,1]);
  assert.throws(() => f.lookup('not_a_badge'), { status: 404 });
});

test('获得者超过 100 人时可全部分页查看，隐藏明细或榜单后刷新分页快照', t => {
  const f = fixture(t), id = 'feedback_contributor';
  f.store.transaction(() => {
    for (let i=0;i<104;i++) {
      const uid = 'wx:test' + i;
      saveProfile(f.store, uid, { nickname: '玩家' + i, version: readProfile(f.store, uid).version, leaderboardVisible: i !== 103 });
      grantContributor(f.store, uid);
    }
  });
  f.store.badgeRanks.setVisibility('wx:test102', 'fun', { visible: false });
  const first = f.lookup(id), rows = [...first.rows];
  let page = first;
  while (page.nextOffset !== null) {
    page = f.lookup(id, { offset: page.nextOffset, version: first.version });
    rows.push(...page.rows);
  }
  assert.equal(first.total,102);
  assert.equal(rows.length,102);
  assert.equal(new Set(rows.map(r => r.publicId)).size,102);
  assert.ok(rows.every(r => r.rank === null && !['玩家102','玩家103'].includes(r.nickname)));
  assert.doesNotMatch(JSON.stringify(rows), /wx:|guest:|"uid"/);
  f.store.badgeRanks.setVisibility('wx:test0', 'fun', { visible: false });
  assert.throws(() => f.lookup(id, { offset: first.nextOffset, version: first.version }), { status: 409 });
  assert.throws(() => f.lookup(id, { offset: 30 }), { status: 400 });
});

test('两端共用的徽章查询支持名称搜索、无匹配状态和翻页', async () => {
  const paths = [];
  const directory = create({ request: async path => { paths.push(path); return { ids: ['five_wins','ten_wins','role_collector'] }; }, update() {} }, 'lookup');
  await directory.load();
  directory.search('连捷');
  assert.deepEqual(directory.state.matches.map(b => b.title), ['五连捷徽']);
  directory.search('不存在');
  assert.equal(directory.state.matches.length, 0);
  const detail = create({ request: async path => {
    paths.push(path);
    const more = path.includes('?');
    return { holdersOnly: true, total: 2, rows: [{ publicId: more ? 'b' : 'a', nickname: more ? '乙' : '甲' }], nextOffset: more ? null : 1, version: 'v' };
  }, update() {} }, 'lookup', '', 'five_wins');
  await detail.load(); await detail.load(true);
  assert.equal(detail.state.badge.title, '五连捷徽');
  assert.deepEqual(detail.state.board.rows.map(r => r.nickname), ['甲','乙']);
  assert.deepEqual(paths, ['/api/leaderboard/badges','/api/leaderboard/badges/five_wins','/api/leaderboard/badges/five_wins?offset=1&version=v']);
});

test('仅开启徽章的对局参与徽章榜、出勤、永久连胜和月末积分发奖', t => {
  const f = fixture(t);
  const eligible = 'wx:eligible', ordinary = 'wx:ordinary';
  const ids = uid => require('../server/badges').readBadges(f.store, uid).badges.map(b => b.id);
  for (let i = 0; i < 7; i++) f.game([[ordinary, 'merlin', 'win']], { badgeEnabled: false });
  for (let i = 0; i < 4; i++) f.game([[eligible, 'merlin', 'win']], { badgeEnabled: true });
  f.game([[eligible, 'merlin', 'win']], { badgeEnabled: false });
  assert.ok(!ids(eligible).includes('five_wins'));
  f.game([[eligible, 'merlin', 'loss']], { badgeEnabled: false });
  f.game([[eligible, 'merlin', 'win']], { badgeEnabled: true });
  assert.deepEqual(ids(ordinary), []);
  for (const id of ['five_wins', 'games', 'points', 'attendance', 'win_streak']) {
    assert.ok(ids(eligible).includes(id), id);
    assert.equal(f.lookup(id).total, 1);
  }
  assert.equal(f.lookup('games').rows[0].value, 5);
  assert.equal(f.lookup('points').rows[0].value, 10);
  assert.deepEqual(f.store.badgeRanks.detail(ordinary, 'honor', 'self').badges, []);
  assert.ok(f.store.badgeRanks.detail(eligible, 'honor', 'self').badges.some(b => b.id === 'points'));
  const board = new (require('../server/leaderboard').Leaderboard)(f.store);
  assert.equal(board.snapshot('points', 'month', f.store.clock()).aggregates.get(ordinary).points, 14);
  f.nextMonth();
  assert.equal(f.lookup('monthly_points_2026-11_1').total, 1);
  assert.ok(ids(eligible).includes('monthly_points_2026-11_1'));
  assert.deepEqual(ids(ordinary), []);
});
