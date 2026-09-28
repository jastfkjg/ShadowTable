const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../server/store');
const { createApp } = require('../server/app');
const { newRoom, enter, command, publicView } = require('../server/engine');
function run(room, type, extra = {}, uid = room.host) {
  command(room, uid, { type, stage: room.stage, ...extra });
}
function deal(board = 'classic', capacity = 6, prefix = 'wx:') {
  const r = newRoom('123456', prefix + '1', '房主', board, capacity);
  for (let i = 2; i <= capacity; i++) enter(r, prefix + i, '玩家' + i);
  for (const p of r.players) p.ready = true;
  run(r, 'start', { flexible: true });
  return r;
}
function finish(store, room, winner = 'good') {
  store.transaction(() => { run(room, 'finishTools', { winner, replace: true }); store.save(room); });
}
test('个人战绩按最终阵营统计，重开、移出、删房和重启均保留；保存不重复计数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shadowtable-stats-'));
  const path = join(dir, 'db.sqlite');
  let store = new Store(path);
  try {
    const r = deal();
    r.roles['wx:1'] = 'merlin';
    r.roles['wx:2'] = 'servant';
    r.convertedReverse = 'wx:2'; // Final faction overrides the printed role.
    enterObserver(r);
    finish(store, r);
    const id = r.matchRecord.id;
    assert.equal(store.statsFor('wx:1').wins, 1);
    assert.equal(store.statsFor('wx:2').losses, 1);
    assert.equal(store.statsFor('wx:2').byFaction[0].faction, 'evil');
    assert.equal(store.statsFor('wx:2').winRate, 0);
    assert.equal(store.statsFor('wx:observer').recent.length, 0);
    run(r, 'kick', { seat: 2, targetId: r.players[1].membershipId, confirm: true });
    store.save(r);
    assert.equal(store.statsFor('wx:2').recent.length, 1);
    run(r, 'rematch');
    store.save(r);
    assert.equal(store.statsFor('wx:1').recent[0].id, id);
    // Fill the seat removed above, then deal a new game in the same room.
    enter(r, 'wx:2', '新昵称');
    for (const p of r.players) p.ready = true;
    run(r, 'start', { flexible: true });
    r.roles['wx:1'] = 'merlin';
    finish(store, r, 'evil');
    assert.notEqual(r.matchRecord.id, id);
    store.save(r);
    store.remove(r.code);
    store.close();
    store = new Store(path);
    const stats = store.statsFor('wx:1');
    assert.equal(stats.total, 2);
    assert.equal(stats.winRate, 50);
    assert.equal(stats.byBoard[0].total, 2);
    assert.equal(stats.recent.length, 2);
    assert.ok(stats.recent.every(m => m.source === 'manual'));
    assert.doesNotMatch(JSON.stringify(stats), /wx:2|players|uid/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
function enterObserver(room) {
  room.spectators = [{ uid: 'wx:observer', name: '旁观者', seat: null }];
}
test('终止、不计战绩、测试房间及测试身份均排除，零有效局胜率为空', () => {
  const store = new Store(':memory:');
  try {
    let r = deal(); finish(store, r, null);
    r = deal(); run(r, 'terminate'); store.save(r);
    r = deal(); r.testRoom = true; finish(store, r);
    r = deal(); r.players[1].uid = 'dev:test'; r.roles['dev:test'] = r.roles['wx:2']; finish(store, r);
    const stats = store.statsFor('wx:1');
    assert.equal(stats.total, 0);
    assert.equal(stats.winRate, null);
    assert.equal(stats.excluded, 4);
    assert.equal(stats.recent.length, 4);
    assert.equal(store.statsFor('wx:nobody').recent.length, 0);
    assert.equal(store.statsFor('dev:test').total, 0);
  } finally { store.close(); }
});
test('胜方受板子及房主权限约束，第三阵营与系统判定来源正确', () => {
  const store = new Store(':memory:');
  try {
    const r = deal();
    const before = JSON.stringify(r);
    assert.throws(() => run(r, 'finishTools', { winner: 'third' }), /胜方不适用/);
    assert.throws(() => run(r, 'finishTools', { winner: 'good' }, 'wx:2'), /只有房主/);
    assert.equal(JSON.stringify(r), before);
    const chaos = deal('chaos', 12);
    assert.ok(publicView(chaos, chaos.host).winnerOptions.some(o => o.value === 'third'));
    chaos.roles['wx:1'] = 'blueThief';
    finish(store, chaos, 'third');
    assert.equal(store.statsFor('wx:1').wins, 1);
    assert.equal(store.statsFor('wx:1').byFaction[0].faction, 'third');
    r.flexible = false; r.phase = 'teamVote'; r.rejects = 4;
    r.submissions = Object.fromEntries(r.players.map(p => [p.uid, 'reject']));
    run(r, 'advance'); store.save(r);
    assert.equal(r.result.winner, 'evil');
    assert.equal(r.matchRecord.source, 'system');
    // Old ended snapshots are not silently counted on save after upgrade.
    const legacy = structuredClone(r); delete legacy.matchRecord;
    delete legacy.matchId; legacy.code = '654321'; store.save(legacy);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM matches').get().n, 2);
  } finally { store.close(); }
});
test('HTTP结算与归档同事务，重试幂等，重新微信登录仍访问本人战绩', async () => {
  const app = createApp({ database: ':memory:', exchangeCode: async code => code });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function req(path, token, data, id = randomUUID()) {
    const res = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || ''), 'Idempotency-Key': id }, body: data ? JSON.stringify(data) : undefined });
    return { status: res.status, data: await res.json() };
  }
  try {
    const tokens = [];
    for (let i = 1; i <= 7; i++) tokens.push((await req('/api/login', '', { code: 'wx-user-' + i })).data.token);
    const created = await req('/api/rooms', tokens[0], { name: '同名', capacity: 6 });
    const path = '/api/rooms/' + created.data.code;
    for (let i = 1; i < 7; i++) await req(path + '/join', tokens[i], { name: '同名' });
    let room = (await req(path, tokens[0])).data;
    for (const t of tokens.slice(0, 6)) await req(path + '/commands', t, { type: 'ready', stage: room.stage, ready: true });
    await req(path + '/commands', tokens[0], { type: 'start', stage: room.stage, flexible: true });
    room = (await req(path, tokens[0])).data;
    assert.equal((await req('/api/me/stats', '')).status, 401);
    assert.equal((await req('/api/me/stats', tokens[0])).data.total, 0);
    const body = { type: 'finishTools', stage: room.stage, winner: 'evil', replace: true }, id = randomUUID();
    const oldReceipt = app.store.addReceipt;
    app.store.addReceipt = () => { throw new Error('simulate storage failure'); };
    assert.equal((await req(path + '/commands', tokens[0], body, id)).status, 500);
    app.store.addReceipt = oldReceipt;
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM matches').get().n, 0);
    assert.equal((await req(path, tokens[0])).data.phase, 'tools');
    assert.equal((await req(path + '/commands', tokens[0], body, id)).status, 200);
    assert.equal((await req(path + '/commands', tokens[0], body, id)).status, 200);
    assert.equal((await req(path + '/commands', tokens[0], body)).status, 409);
    const stats = (await req('/api/me/stats', tokens[0])).data;
    assert.equal(stats.total, 1);
    assert.equal((await req('/api/me/stats', tokens[6])).data.recent.length, 0);
    assert.doesNotMatch(JSON.stringify(stats), /wx:|players|uid|openid/);
    const nextToken = (await req('/api/login', '', { code: 'wx-user-1' })).data.token;
    assert.deepEqual((await req('/api/me/stats', nextToken)).data, stats);
    room = (await req(path, tokens[0])).data;
    await req(path + '/delete', tokens[0], { stage: room.stage });
    assert.deepEqual((await req('/api/me/stats', tokens[0])).data, stats);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
