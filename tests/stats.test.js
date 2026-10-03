const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../server/store');
const { createApp } = require('../server/app');
const { Leaderboard } = require('../server/leaderboard');
const { readProfile, saveProfile } = require('../server/profile');
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
    assert.equal(store.statsFor('wx:2').byRole[0].role, '亚瑟的忠臣');
    assert.equal(store.statsFor('wx:2').byRole[0].faction, 'evil');
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
    assert.deepEqual({ total: stats.byRole[0].total, wins: stats.byRole[0].wins, winRate: stats.byRole[0].winRate }, { total: 2, wins: 1, winRate: 50 });
    assert.equal(stats.recent.length, 2);
    const matches = store.matchesFor('wx:1');
    assert.equal(matches.total, 2);
    assert.equal(matches.records[0].members.length, 6);
    assert.equal(matches.records[0].members[0].seat, 1);
    assert.doesNotMatch(JSON.stringify(matches), /wx:|"uid"/);
    assert.ok(stats.recent.every(m => m.source === 'manual'));
    assert.doesNotMatch(JSON.stringify(stats), /wx:2|players|uid/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('对局记录分页返回完整历史，成员只包含座位与当时昵称', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 22; i++) store.archiveMatch({
      id: 'match-' + i, code: '123456', game: i, board: 'classic', boardName: '经典', capacity: 2,
      startedAt: i, endedAt: i, winner: 'good', source: 'manual', excludedReason: null,
      players: [
        { uid: 'wx:me', name: '我', seat: 1, role: '梅林', faction: 'good', outcome: 'win' },
        { uid: 'wx:friend', name: '朋友', seat: 2, role: '刺客', faction: 'evil', outcome: 'loss' },
      ],
    });
    const first = store.matchesFor('wx:me'), second = store.matchesFor('wx:me', 20);
    assert.equal(first.records.length, 20);
    assert.equal(first.hasMore, true);
    assert.equal(second.records.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(first.records[0].endedAt, 21);
    assert.deepEqual(first.records[0].members, [{ seat: 1, name: '我' }, { seat: 2, name: '朋友' }]);
    assert.equal(store.matchesFor('wx:stranger').total, 0);
    assert.doesNotMatch(JSON.stringify(first), /wx:|"uid"/);
  } finally { store.close(); }
});
function enterObserver(room) {
  room.spectators = [{ uid: 'wx:observer', name: '旁观者', seat: null }];
}
test('陪测只保留同桌上下文，真实玩家可更正陪测目标，重启和管理操作不生成陪测统计', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadowtable-companion-context-')),path=join(dir,'db.sqlite');
  let store=new Store(path);
  try {
    const r=deal();r.testRoom=true;r.scoreEnabled=true;
    r.players[2].uid='test:merlin';
    r.roles=Object.fromEntries(r.players.map((p,i)=>[p.uid,['servant','percival','merlin','servant','morgana','assassin'][i]]));
    r.fun.initialRoles={...r.roles};
    run(r,'finishTools',{scoreReason:'assassination',scoreTarget:4});
    const record=structuredClone(r.matchRecord);
    const verify=()=>{
      for(const table of ['match_players','match_scores','match_fun_stats','score_versions'])
        assert.equal(store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE uid LIKE 'test:%'`).get().n,0);
      assert.equal(store.matchesFor('test:merlin').total,0);
      assert.equal(store.statsFor('test:merlin').total,0);
      assert.deepEqual(store.funFor('test:merlin').metrics,[]);
      const game=JSON.parse(store.db.prepare('SELECT snapshot FROM matches WHERE id=?').get(r.matchId).snapshot);
      assert.equal(game.companions.length,1);
      assert.deepEqual(Object.keys(game.companions[0]).sort(),['alive','faction','name','role','roleId','seat','uid']);
      assert.equal(store.matchesFor('wx:1').records[0].members.length,6);
      assert.doesNotMatch(JSON.stringify(store.statsFor('wx:1')),/test:|"companions"/);
      const view=publicView(store.get(r.code),'test:merlin');
      assert.equal(view.myScore?.status || null,store.get(r.code).recordManagement.state==='excluded' ? 'excluded' : null);
      assert.equal(publicView(store.get(r.code),'test:merlin').myFun,null);
    };
    assert.throws(()=>store.transaction(()=>{store.save(r);throw Error('rollback');}),/rollback/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM matches').get().n,0);
    store.transaction(()=>store.save(r));
    store.transaction(()=>store.archiveMatch(record));
    assert.equal(store.statsFor('wx:1').wins,1);verify();
    store.close();store=new Store(path);verify();
    const listed=store.managedMatches(new URLSearchParams('companion=1'));
    assert.equal(listed.total,1);assert.equal(listed.matches[0].players.length,6);
    assert.equal(listed.matches[0].players.find(p=>p.companion).points,null);
    store.transaction(()=>store.correctMatch(r.matchId,{revision:0,scoreReason:'assassination',scoreTarget:3}));
    assert.equal(store.statsFor('wx:1').losses,1);
    assert.equal(store.funFor('wx:6').metrics.find(m=>m.id==='assassin_hit').count,1);verify();
    const input={action:'exclude',matches:[{id:r.matchId,revision:1}]};
    assert.equal(store.transaction(()=>store.previewMatches(input)).affectedPlayers,5);verify();
    assert.equal(store.transaction(()=>store.manageMatches(input)).affectedPlayers,5);verify();
    store.transaction(()=>store.manageMatches({action:'include',matches:[{id:r.matchId,revision:2}]}));
    // The unscored correction path also needs the companion's Merlin identity.
    store.db.prepare("UPDATE matches SET snapshot=json_set(snapshot,'$.scoreEligibilityReason','本局未开启计分') WHERE id=?").run(r.matchId);
    store.transaction(()=>store.correctFunMatch(r.matchId,{revision:3,funReason:'assassination',funTarget:4}));
    assert.equal(store.statsFor('wx:1').wins,1);
    assert.equal(store.funFor('wx:4').metrics.find(m=>m.id==='good_shield').count,1);verify();
    store.close();store=new Store(path);verify();
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('终止、不计战绩及身份不完整仍排除，陪测房间保留真实玩家统计，陪测身份不归档', () => {
  const store = new Store(':memory:');
  try {
    let r = deal(); finish(store, r, null);
    r = deal(); run(r, 'terminate'); store.save(r);
    assert.equal(store.statsFor('wx:1').winRate, null);
    r = deal(); r.testRoom = true; r.roles['wx:1']='merlin'; finish(store, r);
    for (const prefix of ['dev:', 'test:']) {
      r = deal(); r.players[1].uid = prefix+'tester'; r.roles[prefix+'tester'] = 'assassin';
      r.roles['wx:1']='merlin'; finish(store, r, 'evil');
      assert.equal(store.statsFor(prefix+'tester').wins,prefix==='test:' ? 0 : 1);
    }
    r = deal(); r.testRoom=true; delete r.roles['wx:2']; finish(store,r);
    const stats = store.statsFor('wx:1');
    assert.equal(stats.total, 3);
    assert.equal(stats.winRate, 33.3);
    assert.equal(stats.excluded, 3);
    assert.equal(stats.recent.length, 6);
    assert.equal(store.statsFor('wx:nobody').recent.length, 0);
    saveProfile(store,'wx:1',{nickname:'房主',version:readProfile(store,'wx:1').version,leaderboardVisible:true});
    const leaderboard=new Leaderboard(store);
    for (const metric of ['games','overall','good']) {
      const board=leaderboard.read('wx:1',new URLSearchParams({metric}));
      assert.equal(board.me.total,3);assert.equal(board.rows.find(row=>row.isSelf).winRate,33.3);
    }
    assert.equal(store.matchesFor('wx:1').records.filter(record=>record.outcome!=='excluded').length,3);
  } finally { store.close(); }
});
test('旧陪测归档启动时补算，保留未判胜负和身份不完整局，重复启动与保存不重复计数', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadowtable-companion-stats-'));
  const path=join(dir,'db.sqlite');let store=new Store(path);
  try {
    const legacy=[];
    for (const kind of ['win','loss','none','unknown']) {
      const r=deal();r.testRoom=true;r.roles['wx:1']='merlin';
      if(kind==='unknown')delete r.roles['wx:2'];
      run(r,'finishTools',{winner:kind==='none'?null:kind==='loss'?'evil':'good',replace:true});
      r.matchRecord.excludedReason='测试局';
      r.matchRecord.players.forEach(player=>player.outcome='excluded');
      store.save(r);legacy.push(r);
    }
    saveProfile(store,'wx:1',{nickname:'房主',version:readProfile(store,'wx:1').version,leaderboardVisible:true});
    assert.equal(store.statsFor('wx:1').total,0);
    store.close();store=new Store(path);
    const verify=()=>{
      const stats=store.statsFor('wx:1');
      assert.equal(stats.total,2);assert.equal(stats.winRate,50);assert.equal(stats.excluded,2);
      const records=store.matchesFor('wx:1').records;
      assert.equal(records.length,4);
      assert.equal(records.filter(record=>record.excludedReason===null&&record.outcome!=='excluded').length,2);
      for(const metric of ['games','overall','good']) {
        const board=new Leaderboard(store).read('wx:1',new URLSearchParams({metric,period:'month'}));
        assert.equal(board.rows.find(row=>row.isSelf).total,2);assert.equal(board.me.winRate,50);
      }
    };
    verify();legacy.forEach(room=>store.save(room));verify();
    store.close();store=new Store(path);verify();
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('旧测试局恢复战绩时同步恢复趣味记录，已恢复胜负的旧数据也修复，重启不重复', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadowtable-test-fun-')),path=join(dir,'db.sqlite');
  let store=new Store(path);
  try {
    const rooms=[];
    for(const alreadyRestored of [false,true]) {
      const r=deal('classic',6,'dev:');r.testRoom=true;
      r.roles=Object.fromEntries(r.players.map((p,i)=>[p.uid,['merlin','percival','servant','servant','morgana','assassin'][i]]));
      r.fun.initialRoles={...r.roles};
      run(r,'finishTools',{funReason:'assassination',funTarget:3});
      r.matchRecord.excludedReason='测试局';r.matchRecord.players.forEach(p=>p.outcome='excluded');
      store.save(r);rooms.push(r);
      if(alreadyRestored) {
        store.db.prepare("UPDATE matches SET snapshot=json_set(snapshot,'$.excludedReason',NULL) WHERE id=?").run(r.matchId);
        store.db.prepare("UPDATE match_players SET outcome=CASE WHEN faction='good' THEN 'win' ELSE 'loss' END,snapshot=json_set(snapshot,'$.outcome',CASE WHEN faction='good' THEN 'win' ELSE 'loss' END) WHERE match_id=?").run(r.matchId);
      }
    }
    const unknown=deal('classic',6,'dev:');unknown.testRoom=true;finish(store,unknown);
    const terminated=deal('classic',6,'dev:');run(terminated,'terminate');store.save(terminated);
    store.close();store=new Store(path);
    const verify=()=>{
      const stats=store.statsFor('dev:3');assert.equal(stats.total,3);assert.equal(stats.excluded,1);
      const shield=stats.fun.metrics.find(row=>row.id==='good_shield');
      assert.equal(shield.count,2);assert.equal(shield.knownGames,2);
      for(const r of rooms) {
        const record=store.matchesFor('dev:3').records.find(record=>record.id===r.matchId);
        assert.equal(record.fun.status,'recorded');assert.equal(record.excludedReason,null);
        assert.ok(record.fun.events.some(event=>event.label==='成功挡刀'));
      }
      assert.equal(store.matchesFor('dev:3',0,20,false,{metric:'good_shield',mode:'classic'}).total,2);
      const board=new Leaderboard(store).read('dev:3',new URLSearchParams('metric=fun_good_shield&nearby=1'));
      assert.equal(board.me.status,'ranked');assert.equal(board.me.count,2);
      assert.equal(board.me.rank,1);assert.equal(board.eligibleCount,1);
      assert.equal(board.rows.length,1);assert.equal(board.nearby.length,1);
      assert.equal(store.matchesFor('dev:3').records.find(record=>record.id===unknown.matchId).fun.status,'partial');
      assert.equal(store.matchesFor('dev:3').records.find(record=>record.id===terminated.matchId).fun.status,'excluded');
    };
    verify();rooms.forEach(room=>store.save(room));verify();
    store.remove(rooms[0].code);store.close();store=new Store(path);verify();
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
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
    const matches = (await req('/api/me/matches?offset=0', tokens[0])).data;
    assert.equal(matches.total, 1);
    assert.equal(matches.records[0].members.length, 6);
    assert.equal((await req('/api/me/matches', tokens[6])).data.total, 0);
    assert.doesNotMatch(JSON.stringify(matches), /wx:|"uid"/);
    assert.equal((await req('/api/me/stats', tokens[6])).data.recent.length, 0);
    assert.doesNotMatch(JSON.stringify(stats), /wx:|players|uid|openid/);
    const nextToken = (await req('/api/login', '', { code: 'wx-user-1' })).data.token;
    assert.deepEqual((await req('/api/me/stats', nextToken)).data, stats);
    room = (await req(path, tokens[0])).data;
    await req(path + '/delete', tokens[0], { stage: room.stage });
    assert.deepEqual((await req('/api/me/stats', tokens[0])).data, stats);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
