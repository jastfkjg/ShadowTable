const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../server/store');
const { readProfile, saveProfile } = require('../server/profile');
const { Leaderboard, periodRange } = require('../server/leaderboard');
const { createApp } = require('../server/app');
const NOW = Date.parse('2026-09-28T08:00:00Z');
function profile(store, uid, visible = true, nickname = uid.split(':')[1]) {
  return store.transaction(() => saveProfile(store, uid, {nickname, version:readProfile(store,uid).version, leaderboardVisible:visible}));
}
function games(store, uid, total, wins, { faction = 'good', endedAt = NOW - 1000, excluded = false } = {}) {
  store.transaction(() => {
    for (let i = 0; i < total; i++) store.archiveMatch({id:randomUUID(),board:'classic',boardName:'经典',capacity:6,endedAt,
      source:i % 2 ? 'manual' : 'system',winner:excluded ? null : 'good',excludedReason:excluded ? '未登记胜负' : null,
      players:[{uid,name:'历史昵称',role:'本人角色',faction,outcome:excluded ? 'excluded' : i < wins ? 'win' : 'loss'}]});
  });
}
const query = (board, uid, text = '') => board.read(uid, new URLSearchParams(text), NOW);
test('四榜复用有效归档：最终阵营、第三阵营、手动/系统来源和门槛一致；隐藏及游客不公开', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store);
    profile(store,'wx:me'); profile(store,'wx:hidden',false); profile(store,'guest:guest',false);
    games(store,'wx:me',12,8); games(store,'wx:me',9,6,{faction:'evil'}); games(store,'wx:me',3,1,{faction:'third'});
    games(store,'wx:me',10,10,{excluded:true}); games(store,'wx:hidden',30,30); games(store,'guest:guest',30,30);
    const all = query(board,'wx:me','metric=overall');
    assert.equal(all.rows.length,1); assert.equal(all.rows[0].nickname,'me'); assert.equal(all.me.total,24); assert.equal(all.me.wins,15); assert.equal(all.me.winRate,62.5);
    assert.equal(all.me.status,'ranked'); assert.equal(all.me.rank,1);
    assert.equal(all.rows[0].isSelf,true); assert.equal(query(board,'guest:guest','metric=overall').rows[0].isSelf,false);
    assert.equal(store.statsFor('wx:me').total,all.me.total);
    const good = query(board,'wx:me','metric=good');
    assert.equal(good.me.total,12); assert.equal(good.me.winRate,66.7); assert.equal(good.rows.length,1);
    const evil = query(board,'wx:me','metric=evil');
    assert.equal(evil.me.total,9); assert.equal(evil.me.status,'ranked'); assert.equal(evil.me.remaining,0); assert.equal(evil.me.rank,1);
    assert.equal(query(board,'wx:hidden').me.status,'hidden');
    assert.equal(query(board,'guest:guest').me.status,'unsupported');
    profile(store,'wx:new'); assert.equal(query(board,'wx:new').me.status,'no_games');
    assert.equal(query(board,'wx:new','metric=overall').me.winRate,null);
    const publicJson=JSON.stringify(all);
    assert.doesNotMatch(publicJson,/wx:|guest:|"uid"|openid|历史昵称|本人角色|"source"|"match_id"/);
    assert.match(all.rows[0].publicId,/^[\da-f-]{36}$/);
  } finally { store.close(); }
});
test('首局即可进入总胜率和对应阵营榜，零局不生成胜率', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store);
    profile(store,'wx:good'); profile(store,'wx:evil');
    games(store,'wx:good',1,0); games(store,'wx:evil',1,1,{faction:'evil'});
    for (const [uid,faction,rate] of [['wx:good','good',0],['wx:evil','evil',100]]) {
      for (const metric of ['games','overall',faction]) {
        const result=query(board,uid,'metric='+metric);
        assert.equal(result.threshold,1); assert.equal(result.me.status,'ranked');
        assert.equal(result.me.total,1); assert.equal(result.me.winRate,rate);
      }
      const other=query(board,uid,'metric='+(faction==='good'?'evil':'good'));
      assert.equal(other.me.status,'no_games'); assert.equal(other.me.rank,null); assert.equal(other.me.winRate,null);
    }
  } finally {store.close();}
});
test('一局可上榜、零胜率、原始比例排序、样本量优先与并列跳号', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store);
    for (const name of ['a','b','c','d','zero','short']) profile(store,'wx:'+name);
    games(store,'wx:a',30,20); games(store,'wx:b',60,40); games(store,'wx:c',60,40);
    games(store,'wx:d',1000,667); games(store,'wx:zero',20,0); games(store,'wx:short',1,1);
    const ranked = query(board,'wx:a','metric=overall');
    assert.deepEqual(ranked.rows.map(r=>r.rank),[1,2,3,3,5,6]);
    assert.equal(ranked.rows[1].nickname,'d'); assert.equal(ranked.rows[4].nickname,'a');
    assert.equal(ranked.rows[1].winRate,ranked.rows[4].winRate);
    assert.equal(ranked.rows[5].winRate,0); assert.equal(query(board,'wx:short','metric=overall').me.remaining,0);
    const count = query(board,'wx:me','metric=games');
    assert.deepEqual(count.rows.map(r=>r.rank),[1,2,2,4,5,6]);
    games(store,'wx:short',1,1); assert.equal(query(board,'wx:short','metric=overall').me.rank,1);
  } finally { store.close(); }
});
test('本月按上海时区结束时间取半开区间，月初缓存切换，一局月榜也有排名', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store), {start,end} = periodRange('month',NOW);
    assert.equal(new Date(start).toISOString(),'2026-08-31T16:00:00.000Z');
    assert.equal(new Date(end).toISOString(),'2026-09-30T16:00:00.000Z');
    profile(store,'wx:me');
    games(store,'wx:me',20,20,{endedAt:start-1}); games(store,'wx:me',1,1,{endedAt:start});
    games(store,'wx:me',1,0,{endedAt:end-1}); games(store,'wx:me',1,1,{endedAt:end});
    const month=query(board,'wx:me','metric=overall&period=month');
    assert.equal(month.me.total,2); assert.equal(month.me.status,'ranked'); assert.equal(month.me.remaining,0);
    assert.equal(query(board,'wx:me','metric=overall').me.total,23);
    const last = board.read('wx:me',new URLSearchParams('period=month'),end-1);
    const next = board.read('wx:me',new URLSearchParams('period=month'),end);
    assert.notEqual(last.version,next.version); assert.equal(next.me.total,1);
  } finally { store.close(); }
});
test('排名先覆盖所有合格玩家，前100位分页稳定，榜外本人有真实名次', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store);
    for (let i=0;i<105;i++) { profile(store,'wx:'+i); games(store,'wx:'+i,2,1); }
    profile(store,'wx:last'); games(store,'wx:last',1,0);
    const first=query(board,'wx:last');
    assert.equal(first.eligibleCount,106); assert.equal(first.rows.length,20); assert.equal(first.me.rank,106);
    const ids = [...first.rows.map(row=>row.publicId)];
    for(let offset=20;offset<100;offset+=20){
      const page=query(board,'wx:last','offset='+offset+'&version='+first.version);
      assert.equal(page.version,first.version); ids.push(...page.rows.map(row=>row.publicId));
      assert.equal(page.hasMore,offset<80);
    }
    assert.equal(new Set(ids).size,100);
    assert.equal(board.read('wx:last',new URLSearchParams('offset=20&version='+first.version),NOW+31000).version,first.version);
    assert.equal(query(board,'wx:0').rows.filter(row=>row.isSelf).length,first.rows.some(r=>r.nickname==='0')?1:0);
    profile(store,'wx:0',false);
    assert.throws(()=>query(board,'wx:last','offset=20&version='+first.version),e=>e.status===409);
    assert.equal(query(board,'wx:last').eligibleCount,105);
  } finally { store.close(); }
});
test('缓存仅在提交后失效：回滚、重复归档、昵称头像及公开设置更新', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store); profile(store,'wx:me'); games(store,'wx:me',20,10);
    const first=query(board,'wx:me');
    assert.equal(query(board,'wx:me').version,first.version);
    assert.throws(()=>store.transaction(()=>{saveProfile(store,'wx:me',{nickname:'不应发布',version:1,leaderboardVisible:false});throw Error('rollback');}));
    assert.equal(query(board,'wx:me').version,first.version); assert.equal(readProfile(store,'wx:me').leaderboardVisible,true);
    const record={id:randomUUID(),board:'classic',endedAt:NOW,players:[{uid:'wx:me',faction:'evil',outcome:'win'}]};
    store.transaction(()=>store.archiveMatch(record)); const second=query(board,'wx:me'); assert.notEqual(second.version,first.version);
    store.transaction(()=>store.archiveMatch(record)); assert.equal(query(board,'wx:me').version,second.version);
    profile(store,'wx:me',true,'新昵称'); const renamed=query(board,'wx:me');
    assert.equal(renamed.rows[0].nickname,'新昵称'); assert.equal(renamed.rows[0].publicId,first.rows[0].publicId);
    profile(store,'wx:me',false); assert.equal(query(board,'wx:me').rows.length,0); assert.equal(query(board,'wx:me').me.total,21);
    const hiddenVersion=query(board,'wx:me').version;
    const refreshed=board.read('wx:me',new URLSearchParams(),NOW+30000);
    assert.equal(refreshed.version,hiddenVersion);assert.equal(refreshed.updatedAt,NOW+30000);
  } finally { store.close(); }
});
test('旧资料迁移默认不公开，公开ID跨重启稳定，旧客户端保存保留公开设置', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadow-rank-')),path=join(dir,'db.sqlite'); let store;
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE profiles(uid TEXT PRIMARY KEY,nickname TEXT NOT NULL,avatar_hash TEXT,version INTEGER NOT NULL,updated INTEGER NOT NULL); INSERT INTO profiles VALUES('wx:me','旧昵称',NULL,1,1)");old.close();
    store=new Store(path);assert.equal(readProfile(store,'wx:me').leaderboardVisible,false);
    profile(store,'wx:me'); games(store,'wx:me',1,1); const id=query(new Leaderboard(store),'wx:me').rows[0].publicId;
    store.transaction(()=>saveProfile(store,'wx:me',{nickname:'旧客户端改名',version:2}));
    assert.equal(readProfile(store,'wx:me').leaderboardVisible,true);
    store.close();store=new Store(path);assert.equal(query(new Leaderboard(store),'wx:me').rows[0].publicId,id);
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP鉴权、参数白名单、公开设置类型/身份校验，以及保存失败/幂等与缓存一致', async () => {
  const app=createApp({database:':memory:',exchangeCode:async code=>code,clock:()=>NOW});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  async function request(path,token,data,id=randomUUID()){
    const res=await fetch(base+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+(token||''),'Idempotency-Key':id,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
    return {status:res.status,data:await res.json()};
  }
  try {
    assert.equal((await request('/api/leaderboard')).status,401);
    const token=(await request('/api/login',null,{code:'owner'})).data.token;
    const uid='wx:'+createHash('sha256').update('owner').digest('hex');games(app.store,uid,20,10);
    for (const q of ['metric=unknown','metric=__proto__','period=week','offset=-1','offset=20','offset=100','metric=good&metric=evil','uid=other','version=bad','limit=100000'])
      assert.equal((await request('/api/leaderboard?'+q,token)).status,400,q);
    assert.equal((await request('/api/me/profile',token,{nickname:'我',version:0,leaderboardVisible:'true'})).status,400);
    const body={nickname:'我',version:0,leaderboardVisible:true},id=randomUUID();
    const add=app.store.addReceipt; app.store.addReceipt=()=>{throw Error('write failed');};
    assert.equal((await request('/api/me/profile',token,body,id)).status,500);
    assert.equal((await request('/api/leaderboard',token)).data.rows.length,0);
    app.store.addReceipt=add;
    const saved=await request('/api/me/profile',token,body,id);assert.equal(saved.status,200);
    const before=(await request('/api/leaderboard',token)).data;
    assert.deepEqual((await request('/api/me/profile',token,body,id)).data,saved.data);
    assert.equal((await request('/api/leaderboard',token)).data.version,before.version);
    const guestToken='a'.repeat(64);app.store.addSession(createHash('sha256').update(guestToken).digest('hex'),'guest:guest');
    assert.equal((await request('/api/me/profile',guestToken,{nickname:'游客',version:0,leaderboardVisible:true})).status,400);
    const guest=(await request('/api/leaderboard',guestToken)).data;
    assert.equal(guest.me.status,'unsupported');assert.equal(guest.rows[0].isSelf,false);assert.equal(before.rows[0].isSelf,true);
  } finally {await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});
