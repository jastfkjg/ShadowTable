'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../server/store');
const { readBadges } = require('../server/badges');
const { notice, reconcileMilestones } = require('../server/badge-awards');
const { presentCollection, presentPlayerBadge } = require('../miniprogram/badges');
const { questMembers } = require('../server/role-fun');
const { newRoom, enter, command, publicView } = require('../server/engine');

const start = Date.parse('2026-11-01T00:00:00+08:00');
const end = Date.parse('2026-12-01T00:00:00+08:00');
function fixture(t) {
  let seq = 0,
    now = start + 86400000;
  const store = new Store(':memory:', { clock: () => now });
  t.after(() => store.close());
  function game(players, fields = {}) {
    seq++;
    const id = require('node:crypto').randomUUID();
    store.archiveMatch({
      id,
      board: 'classic-court',
      capacity: 9,
      winner: 'good',
      endedAt: start + seq,
      ...fields,
      players: players.map(([uid, outcome = 'win', roleId = 'servant', faction = 'good', scored = true], i) => ({
        uid,
        seat: i + 1,
        roleId,
        faction,
        outcome,
        role: roleId,
        score: { status: scored ? 'scored' : 'excluded', total: 0, breakdown: [] },
      })),
    });
    return id;
  }
  return {
    store,
    game,
    monthEnds() {
      now = end;
    },
    badges(uid) {
      return readBadges(store, uid).badges;
    },
  };
}
const ids = (badges) => badges.map((b) => b.id);
test('计分胜负场分别取本月最高正次数，并列持有，收藏与分类榜一致', (t) => {
  const f = fixture(t);
  function check(uid, id, kind, expected) {
    assert.equal(ids(f.badges(uid)).includes(id), expected, uid + ' / ' + id);
    const ranked = f.store.badgeRanks.detail(uid, kind, 'self').badges;
    assert.equal(ids(ranked).includes(id), expected, uid + ' / ' + kind);
  }
  const wins = (uid, expected) => check(uid, 'overall', 'honor', expected);
  const losses = (uid, expected) => check(uid, 'headwind_navigator', 'fun', expected);
  f.game([['wx:all-wins'], ['wx:busy'], ['dev:tie']]);
  losses('wx:all-wins', false);
  f.game([['wx:busy'], ['dev:tie'], ['wx:all-losses', 'loss']]);
  f.game([['wx:busy', 'loss'], ['wx:all-losses', 'loss']]);
  // Unscored results, undersized tables and the previous month's games cannot break either tie.
  f.game([['dev:tie', 'win', 'merlin', 'good', false], ['wx:busy', 'loss', 'merlin', 'good', false]]);
  f.game([['dev:tie'], ['wx:busy', 'loss']], { board: 'classic', capacity: 8 });
  f.game([['dev:tie'], ['wx:busy', 'loss']], { endedAt: start - 1 });
  wins('wx:all-wins', false);
  wins('wx:busy', true);
  wins('dev:tie', true);
  losses('wx:busy', false);
  losses('wx:all-losses', true);
  f.game([['wx:busy', 'loss']]);
  losses('wx:busy', true);
  losses('wx:all-losses', true);
  f.monthEnds();
  wins('wx:busy', false);
  losses('wx:all-losses', false);
});
test('个人最长序列、月界、达标后永久授予及重复归档', (t) => {
  const f = fixture(t),
    uid = 'wx:player';
  for (let i = 0; i < 4; i++) f.game([[uid]], { endedAt: start - 500 + i });
  for (let i = 0; i < 6; i++) f.game([[uid]]);
  assert.ok(ids(f.badges(uid)).includes('win_streak'));
  assert.ok(ids(f.badges(uid)).includes('ten_wins'));
  assert.ok(!ids(f.badges(uid)).includes('alternating_streak'));
  for (const outcome of ['loss', 'loss', 'win', 'loss', 'win']) f.game([[uid, outcome]]);
  for (const id of ['loss_streak', 'alternating_streak']) assert.ok(ids(f.badges(uid)).includes(id));
  for (let i = 0; i < 87; i++) f.game([[uid]]);
  assert.ok(!ids(f.badges(uid)).includes('hundred_wins'));
  f.game([[uid]]);
  assert.ok(ids(f.badges(uid)).includes('hundred_wins'));
  f.monthEnds();
  const milestones = ['five_wins', 'ten_wins', 'hundred_wins'];
  assert.deepEqual(
    ids(f.badges(uid)).filter((id) => !id.startsWith('monthly_points_')),
    milestones,
  );
  f.store.transaction(() => reconcileMilestones(f.store, [uid, uid]));
  assert.deepEqual(
    ids(notice(f.store, uid).notice.badges).filter((id) => milestones.includes(id)),
    milestones,
  );
});
test('胜率用有效计分局，最低样本、金银铜、同名并列和红蓝兰斯合并', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) {
    const players = [
      ['wx:gold', 'win'],
      ['wx:silver', i ? 'win' : 'loss'],
      ['dev:tie', i ? 'win' : 'loss'],
      ['wx:fourth', i < 2 ? 'loss' : 'win'],
    ];
    if (i < 9) players.push(['wx:nine', 'win']);
    f.game(
      players.map(([uid, w]) => [
        uid,
        w,
        i < 2 ? 'blueLancelot' : i === 2 ? 'redLancelot' : 'merlin',
        i === 2 ? 'evil' : 'good',
      ]),
    );
  }
  f.game([['wx:nine', 'win', 'merlin', 'good', false]]);
  assert.ok(!ids(f.badges('wx:nine')).includes('rate_overall'));
  assert.ok(!ids(f.badges('wx:fourth')).includes('rate_overall'));
  const find = (uid, id) => f.badges(uid).find((b) => b.id === id);
  assert.equal(find('wx:gold', 'rate_overall').rank, 1);
  assert.equal(find('wx:silver', 'rate_lancelot').rank, 2);
  assert.equal(find('dev:tie', 'rate_overall').rank, 2);
  const honorDetail = (uid) => f.store.badgeRanks.detail(uid, 'honor', 'self').badges;
  assert.equal(honorDetail('dev:tie').find(b => b.id === 'rate_overall').rank, 2);
  const silver = find('wx:silver', 'rate_overall');
  assert.match(presentPlayerBadge(silver).imageUrl, /-silver\.png$/);
  assert.equal(presentCollection({ badges: [silver] }).badges[0].imageUrl, silver.imageUrl);
  f.game([['dev:tie', 'loss', 'assassin', 'evil']]);
  const bronze = find('dev:tie', 'rate_overall');
  assert.equal(bronze.rank, 3);
  assert.equal(honorDetail('dev:tie').find(b => b.id === 'rate_overall').rank, 3);
  assert.equal(bronze.title, silver.title);
  assert.match(bronze.imageUrl, /-bronze\.png$/);
  assert.ok(!find('dev:tie', 'rate_assassin'));
  f.game([['dev:tie', 'loss'], ['wx:fourth', 'win']]);
  assert.ok(!honorDetail('dev:tie').some(b => b.id === 'rate_overall'));
});
test('七种基础角色、七角色各胜及按全月对局去重的 80% 边界', (t) => {
  const f = fixture(t),
    roles = ['merlin', 'percival', 'servant', 'mordred', 'morgana', 'assassin', 'oberon'];
  for (const role of roles)
    f.game([
      ['wx:a', 'win', role],
      ['wx:b', 'loss', role],
    ]);
  for (let i = 0; i < 2; i++) f.game([['wx:a'], ['wx:c']]);
  f.game([['wx:c']]);
  assert.ok(ids(f.badges('wx:a')).includes('seven_victors'));
  assert.ok(ids(f.badges('wx:b')).includes('role_collector'));
  assert.ok(!ids(f.badges('wx:b')).includes('seven_victors'));
  assert.ok(!ids(f.badges('wx:b')).includes('attendance'));
  f.game([['wx:b', 'win', 'merlin', 'good', false]]);
  assert.ok(!ids(f.badges('wx:b')).includes('attendance'));
  f.game([['wx:c']]);
  f.game([['wx:a']]); // 10/12
  f.game([['wx:c']]); // 10/13
  assert.ok(!ids(f.badges('wx:a')).includes('attendance'));
  for (let i = 0; i < 2; i++) f.game([['wx:a']]);
  assert.ok(ids(f.badges('wx:a')).includes('attendance')); // 12/15
});
test('正常任务牌、首车三人、三炸实出和有效湖仙查验', (t) => {
  const f = fixture(t);
  const players = [['wx:a'], ['wx:b'], ['wx:c'], ['wx:x']];
  const quest = (evil, defaulted) => ({
    kind: 'quest',
    id: 'quest:1',
    round: 1,
    team: [1, 2, 3],
    success: !evil,
    fails: evil ? 3 : 0,
    members: [1, 2, 3].map((seat) => ({
      seat,
      role: evil ? 'mordred' : 'servant',
      faction: evil ? 'evil' : 'good',
      playedFailure: evil && !(seat === 3 && defaulted),
      playedSuccess: !evil,
    })),
  });
  function add(evil, defaulted = false) {
    return f.game(players, {
      funFacts: { events: [quest(evil, defaulted)], badgeTimeline: [{ kind: 'fairy', actor: 2, target: 4 }] },
    });
  }
  for (let i = 0; i < 29; i++) {
    add(false);
    add(true, true);
  }
  assert.ok(!ids(f.badges('wx:a')).includes('success_courier'));
  assert.ok(!ids(f.badges('wx:a')).includes('sabotage_courier'));
  add(false);
  add(true, true);
  for (const id of ['servant_trio', 'evil_trio', 'triple_sabotage', 'success_courier', 'sabotage_courier'])
    assert.ok(ids(f.badges('wx:a')).includes(id), id);
  for (const id of ['triple_sabotage', 'sabotage_courier']) assert.ok(!ids(f.badges('wx:c')).includes(id), id);
  assert.ok(ids(f.badges('wx:b')).includes('lake_seer'));
  assert.ok(ids(f.badges('wx:x')).includes('lake_blessed'));
  assert.ok(!ids(f.badges('wx:x')).includes('evil_trio'));
  const members = questMembers(
    {
      players: [
        { seat: 1, uid: 'a' },
        { seat: 2, uid: 'b' },
      ],
      roles: { a: 'servant', b: 'morgana' },
      submissions: { a: 'success', b: 'fail' },
    },
    [1, 2],
    () => 'good',
    ['a'],
  );
  assert.equal(members[0].playedSuccess, false);
  assert.equal(members[1].playedFailure, true);
});
test('逐票匹配成功车，未通过的提案、异队任务和弃权有各自的结果', (t) => {
  const f = fixture(t);
  const v = (choice = true, opts = {}) => ({
    kind: 'vote',
    team: [1, 2],
    approved: true,
    sides: { 1: 'good', 2: 'good', 3: 'evil' },
    votes: [
      { seat: 1, approve: choice },
      { seat: 2, approve: choice },
      { seat: 3, approve: false },
    ],
    ...opts,
  });
  const q = { kind: 'quest', team: [2, 1], success: true };
  const game = (events) => f.game([['wx:a'], ['wx:b'], ['wx:c']], { funFacts: { events: [], badgeTimeline: events } });
  game([v(), q, v(), q, v(null), v(), q, v(), q]);
  const before = ids(f.badges('wx:a'));
  assert.ok(before.includes('approve_success'));
  assert.ok(before.includes('unanimous_allies'));
  assert.ok(!before.includes('faction_ballots'));
  assert.ok(!before.includes('reject_success'));
  game([v(), q, v(), q, v(), q]);
  assert.ok(ids(f.badges('wx:a')).includes('faction_ballots'));
  game([v(false), q]);
  assert.ok(ids(f.badges('wx:a')).includes('reject_success'));
  f.game([['wx:other']], { funFacts: { events: [], badgeTimeline: [v(true, { approved: false }), v(), q] } });
  assert.ok(!ids(f.badges('wx:other')).includes('approve_success'));
  f.game([['wx:wrong']], { funFacts: { events: [], badgeTimeline: [v(), { ...q, team: [2, 3] }] } });
  assert.ok(!ids(f.badges('wx:wrong')).includes('approve_success'));
});
test('经典工具对局在归档前记录投票阵营和亲手出牌，不向房间泄露私有事实', (t) => {
  const room = newRoom('123456', 'wx:1', '房主', 'classic-court', 9);
  const run = (type, input = {}, uid = room.host) => command(room, uid, { type, stage: room.stage, ...input });
  for (let i = 2; i <= 9; i++) enter(room, 'wx:' + i, '玩家' + i);
  room.players.forEach((p) => (p.ready = true));
  run('start', { flexible: true });
  const team = room.players
    .filter((p) => room.roles[p.uid] === 'servant')
    .map((p) => p.seat)
    .slice(0, 3);
  for (let i = 0; i < 5; i++) {
    run('beginActivity', { kind: 'vote', team });
    for (const p of room.players) run('submit', { value: 'approve' }, p.uid);
    run('beginActivity', { kind: 'quest', team, threshold: 1 });
    for (const p of room.players.filter((p) => team.includes(p.seat))) run('submit', { value: 'success' }, p.uid);
  }
  assert.doesNotMatch(JSON.stringify(publicView(room, room.host)), /voteSides|badgeTimeline|playedSuccess/);
  run('finishTools', { winner: 'good' });
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.archiveMatch(room.matchRecord);
  const uid = room.players.find((p) => team.includes(p.seat)).uid;
  const earned = ids(readBadges(store, uid).badges);
  for (const id of ['approve_success', 'unanimous_allies', 'faction_ballots']) assert.ok(earned.includes(id), id);
  assert.doesNotMatch(JSON.stringify(store.matchFor(uid, room.matchId)), /voteSides|badgeTimeline|playedSuccess/);
});

test('旧复盘回算身份转换后的票和仙女，部分复盘不足以认定全局每票均成功', (t) => {
  const f = fixture(t);
  const vote = {
    kind: 'vote',
    approved: true,
    team: [1, 2],
    votes: [
      { seat: 1, approve: true },
      { seat: 2, approve: true },
    ],
  };
  const quest = {
    kind: 'quest',
    round: 1,
    team: [1, 2],
    success: true,
    fails: 0,
    cards: [
      { actor: { seat: 1, roleId: 'blueLancelot', faction: 'evil' }, value: 'success' },
      { actor: { seat: 2, roleId: 'mordred', faction: 'evil' }, value: 'success' },
    ],
  };
  const replay = {
    complete: true,
    initialPlayers: [
      { seat: 1, roleId: 'blueLancelot', faction: 'good' },
      { seat: 2, roleId: 'mordred', faction: 'evil' },
    ],
    events: [
      { kind: 'conversion', changes: [{ seat: 1, after: { faction: 'evil' } }] },
      ...Array.from({ length: 5 }, () => [vote, quest]).flat(),
      { kind: 'fairy', actor: { seat: 1 }, target: { seat: 2 } },
    ],
  };
  f.game([['wx:legacy'], ['wx:other']], { board: 'knights', replay });
  for (const id of ['approve_success', 'unanimous_allies', 'faction_ballots', 'lake_seer'])
    assert.ok(ids(f.badges('wx:legacy')).includes(id), id);
  f.game([['wx:partial'], ['wx:partner']], { board: 'knights', replay: { ...replay, complete: false } });
  assert.ok(!ids(f.badges('wx:partial')).includes('approve_success'));
  f.game([['wx:nofacts']], { board: 'classic', funFacts: null });
  assert.ok(!ids(f.badges('wx:nofacts')).includes('approve_success'));
});
test('管理排除即时更新月度榜单，事务回滚和恢复都重新反映实际名次', (t) => {
  const f = fixture(t);
  const players = [['wx:a'], ['wx:b', 'loss']];
  for (let i = 0; i < 9; i++) f.game(players);
  const match = f.game(players);
  assert.equal(f.badges('wx:a').find((b) => b.id === 'rate_overall').rank, 1);
  const liveRanks = () => f.store.badgeRanks.detail('wx:a', 'honor', 'self').badges;
  assert.equal(liveRanks().find(b => b.id === 'rate_overall').rank, 1);
  const exclude = () =>
    f.store.manageMatches({ action: 'exclude', matches: [{ id: match, revision: 0 }], reason: '测试' });
  assert.throws(
    () =>
      f.store.transaction(() => {
        exclude();
        assert.ok(!ids(f.badges('wx:a')).includes('rate_overall'));
        assert.ok(!liveRanks().some(b => b.id === 'rate_overall'));
        throw Error('rollback');
      }),
    /rollback/,
  );
  assert.equal(f.badges('wx:a').find((b) => b.id === 'rate_overall').rank, 1);
  assert.equal(liveRanks().find(b => b.id === 'rate_overall').rank, 1);
  f.store.transaction(exclude);
  assert.ok(!ids(f.badges('wx:a')).includes('rate_overall'));
  assert.ok(ids(f.badges('wx:a')).includes('ten_wins'));
  const honor = liveRanks();
  assert.ok(!honor.some(b => b.id === 'rate_overall'));
  assert.ok(honor.some(b => b.id === 'ten_wins'));
  f.store.transaction(() =>
    f.store.manageMatches({ action: 'include', matches: [{ id: match, revision: 1 }], reason: '恢复' }),
  );
  assert.equal(f.badges('wx:b').find((b) => b.id === 'rate_overall').rank, 2);
});
