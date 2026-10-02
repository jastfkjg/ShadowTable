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
test('未保存资料的微信和开发账号首局自动公开，五榜无需切换开关且不公开牌桌昵称', () => {
  const store=new Store(':memory:');
  try {
    const board=new Leaderboard(store), uids=['wx:new','dev:new','guest:new','test:new'];
    const original=readProfile(store,'wx:new');
    const empty=query(board,'guest:viewer');
    assert.equal(empty.rows.length,0);
    for(const faction of ['good','evil']) store.transaction(()=>store.archiveMatch({
      id:randomUUID(),board:'classic',endedAt:NOW-1000,players:uids.map(uid=>({
        uid,name:'不应公开的牌桌昵称',faction,outcome:'win',score:{status:'scored',total:3,breakdown:[]},
      })),
    }));
    assert.deepEqual(readProfile(store,'wx:new'),original);
    const ids=new Map();
    for(const metric of ['points','games','overall','good','evil']) for(const uid of uids.slice(0,2)) {
      const result=query(board,uid,'metric='+metric);
      assert.equal(result.eligibleCount,2);
      assert.equal(result.me.status,'ranked');assert.equal(result.me.rank,1);
      const own=result.rows.find(row=>row.isSelf);
      assert.ok(own);assert.equal(own.nickname,'新朋友');assert.match(own.publicId,/^[\da-f-]{36}$/);
      if(ids.has(uid)) assert.equal(own.publicId,ids.get(uid));
      else ids.set(uid,own.publicId);
      assert.doesNotMatch(JSON.stringify(result),/wx:|dev:|guest:|test:|牌桌昵称/);
    }
    assert.notEqual(query(board,'wx:new').version,empty.version);
    assert.equal(query(board,'guest:new').me.status,'unsupported');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM profiles').get().n,2);
    profile(store,'wx:new',false);
    games(store,'wx:new',1,1);
    assert.equal(query(board,'wx:new').me.status,'hidden');
    assert.equal(query(board,'dev:new').eligibleCount,1);
  } finally {store.close();}
});
test('默认公开资料与战绩同事务回滚，重复归档不改变公开ID或榜单缓存', () => {
  const store=new Store(':memory:');
  try {
    const board=new Leaderboard(store), first=query(board,'wx:new');
    const record={id:randomUUID(),board:'classic',endedAt:NOW,players:[{uid:'wx:new',faction:'good',outcome:'win'}]};
    assert.throws(()=>store.transaction(()=>{store.archiveMatch(record);throw Error('rollback');}));
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM profiles').get().n,0);
    assert.deepEqual(query(board,'wx:new'),first);
    store.transaction(()=>store.archiveMatch(record));
    const ranked=query(board,'wx:new');
    assert.equal(ranked.me.rank,1);
    store.transaction(()=>store.archiveMatch(record));
    assert.deepEqual(query(board,'wx:new'),ranked);
    store.transaction(()=>saveProfile(store,'wx:new',{nickname:'新昵称',version:0}));
    const renamed=query(board,'wx:new');
    assert.equal(renamed.rows[0].publicId,ranked.rows[0].publicId);
    assert.equal(renamed.rows[0].nickname,'新昵称');
  } finally {store.close();}
});
test('重启补齐已有战绩但无资料的账号，保留主动隐藏设置且公开ID跨重启稳定', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadow-rank-missing-')),path=join(dir,'db.sqlite');
  let store=new Store(path);
  try {
    profile(store,'wx:hidden',false);
    for(const uid of ['wx:missing','dev:missing','guest:missing','test:missing','wx:hidden']) games(store,uid,1,1);
    // Reproduce databases written before archives initialized public profiles.
    store.db.prepare("DELETE FROM profiles WHERE uid IN ('wx:missing','dev:missing')").run();
    const hidden=store.db.prepare("SELECT * FROM profiles WHERE uid='wx:hidden'").get();
    store.close();store=new Store(path);
    const first=query(new Leaderboard(store),'wx:missing');
    assert.equal(first.me.rank,1);assert.equal(first.rows.length,2);
    assert.equal(first.rows[0].nickname,'新朋友');
    assert.equal(readProfile(store,'wx:missing').version,0);
    assert.equal(readProfile(store,'wx:hidden').leaderboardVisible,false);
    assert.deepEqual(store.db.prepare("SELECT * FROM profiles WHERE uid='wx:hidden'").get(),hidden);
    const ids=first.rows.map(row=>row.publicId);
    store.close();store=new Store(path);
    assert.deepEqual(query(new Leaderboard(store),'wx:missing').rows.map(row=>row.publicId),ids);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM profiles').get().n,3);
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('开发账号默认公开并参与四榜，关闭后隐藏；游客和陪测账号仍不能公开', () => {
  const store=new Store(':memory:');
  try {
    const board=new Leaderboard(store);
    assert.equal(query(board,'dev:me').me.status,'no_games');
    assert.equal(readProfile(store,'dev:me').leaderboardVisible,true);
    store.transaction(()=>saveProfile(store,'dev:me',{nickname:'开发玩家',version:0}));
    games(store,'dev:me',1,1);games(store,'dev:me',1,0,{faction:'evil'});
    for(const metric of ['games','overall','good','evil']) {
      const result=query(board,'dev:me','metric='+metric);
      assert.equal(result.me.status,'ranked');assert.equal(result.me.rank,1);
      assert.equal(result.rows[0].nickname,'开发玩家');assert.equal(result.rows[0].isSelf,true);
    }
    profile(store,'dev:me',false);
    assert.equal(query(board,'dev:me').rows.length,0);
    assert.equal(query(board,'dev:me').me.total,2);
    for(const uid of ['guest:me','test:me']) {
      assert.equal(readProfile(store,uid).leaderboardVisible,false);
      assert.throws(()=>profile(store,uid,true),/微信或开发账号/);
    }
  } finally {store.close();}
});
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
test('附近排名基于完整同周期快照，覆盖百名之后、首尾、并列、隐藏和过期版本', () => {
  const store = new Store(':memory:');
  try {
    const board = new Leaderboard(store);
    store.transaction(() => store.archiveMatch({id:randomUUID(),board:'classic',endedAt:NOW-1000,
      players:Array.from({length:121},(_,i)=>({uid:'wx:near-'+i,name:'私人牌桌昵称',role:'私人角色',faction:'good',outcome:'win',
        score:{status:'scored',total:i===51?950:1000-i,breakdown:[]}}))}));
    profile(store,'wx:near-105',true,'附近本人');
    const selection='metric=points&period=month&nearby=1';
    const middle=query(board,'wx:near-105',selection);
    assert.equal(middle.rows.some(row=>row.isSelf),false);
    assert.equal(middle.me.rank,106);
    assert.deepEqual(middle.nearby.map(row=>row.rank),[104,105,106,107,108]);
    assert.equal(middle.nearby[2].isSelf,true);assert.equal(middle.nearby[2].nickname,'附近本人');
    assert.deepEqual(query(board,'wx:near-0',selection).nearby.map(row=>row.rank),[1,2,3,4,5]);
    assert.deepEqual(query(board,'wx:near-120',selection).nearby.map(row=>row.rank),[117,118,119,120,121]);
    const tied=query(board,'wx:near-51',selection);
    assert.equal(tied.nearby.filter(row=>row.rank===51).length,2);
    assert.equal(tied.nearby.find(row=>row.isSelf).rank,51);
    assert.deepEqual(query(board,'wx:near-51',selection).nearby,tied.nearby);
    assert.equal(query(board,'wx:near-105','metric=points').nearby,undefined);
    assert.doesNotMatch(JSON.stringify(middle),/私人|wx:|"uid"|role|breakdown|match_id/);
    assert.deepEqual(Object.keys(middle.nearby[0]).sort(),['avatarUrl','isSelf','losses','nickname','points','publicId','rank','total','winRate','wins'].sort());
    const hiddenId=query(board,'wx:near-104',selection).nearby.find(row=>row.isSelf).publicId;
    profile(store,'wx:near-104',false);
    assert.ok(query(board,'wx:near-105',selection).nearby.every(row=>row.publicId!==hiddenId));
    assert.throws(()=>query(board,'wx:near-105',selection+'&version='+middle.version),e=>e.status===409);
    profile(store,'wx:near-105',false);
    assert.deepEqual(query(board,'wx:near-105',selection).nearby,[]);
    assert.deepEqual(query(board,'guest:viewer',selection).nearby,[]);
    assert.deepEqual(query(board,'wx:no-games',selection).nearby,[]);
    const nextMonth=periodRange('month',NOW).end;
    assert.deepEqual(board.read('wx:near-0',new URLSearchParams(selection),nextMonth).nearby,[]);
  } finally {store.close();}
});
test('附近排名人数不足五人时只返回实际公开参榜者，阵营筛选继续生效', () => {
  const store=new Store(':memory:');
  try {
    const board=new Leaderboard(store);
    games(store,'wx:good',2,1);games(store,'wx:evil',1,1,{faction:'evil'});
    const all=query(board,'wx:good','metric=games&nearby=1');
    assert.equal(all.nearby.length,2);assert.equal(all.nearby[0].isSelf,true);
    const good=query(board,'wx:good','metric=good&nearby=1');
    assert.equal(good.nearby.length,1);assert.equal(good.nearby[0].winRate,50);
    assert.deepEqual(query(board,'wx:good','metric=evil&nearby=1').nearby,[]);
    for(const q of ['nearby=0','nearby=true','nearby=1&nearby=1','nearby=1&uid=wx:evil','nearby=1&offset=20&version='+all.version])
      assert.throws(()=>query(board,'wx:good',q),e=>e.status===400);
  } finally {store.close();}
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
test('旧资料迁移默认公开，公开ID跨重启稳定，关闭后改名与重启保留设置', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadow-rank-')),path=join(dir,'db.sqlite'); let store;
  try {
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE profiles(uid TEXT PRIMARY KEY,nickname TEXT NOT NULL,avatar_hash TEXT,version INTEGER NOT NULL,updated INTEGER NOT NULL); INSERT INTO profiles VALUES('wx:me','旧昵称',NULL,1,1)");old.close();
    store=new Store(path);assert.equal(readProfile(store,'wx:me').leaderboardVisible,true);
    games(store,'wx:me',1,1); const id=query(new Leaderboard(store),'wx:me').rows[0].publicId;
    store.transaction(()=>saveProfile(store,'wx:me',{nickname:'旧客户端改名',version:1}));
    assert.equal(readProfile(store,'wx:me').leaderboardVisible,true);
    store.close();store=new Store(path);assert.equal(query(new Leaderboard(store),'wx:me').rows[0].publicId,id);
    profile(store,'wx:me',false);
    store.transaction(()=>saveProfile(store,'wx:me',{nickname:'关闭后改名',version:3}));
    store.close();store=new Store(path);
    assert.equal(readProfile(store,'wx:me').leaderboardVisible,false);
    assert.equal(query(new Leaderboard(store),'wx:me').me.status,'hidden');
    assert.equal(store.db.prepare('SELECT public_id FROM profiles WHERE uid=?').get('wx:me').public_id,id);
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
    const initial=(await request('/api/leaderboard',token)).data;
    assert.equal(initial.me.status,'ranked');assert.equal(initial.me.rank,1);
    assert.equal(initial.rows[0].nickname,'新朋友');assert.equal(initial.rows[0].isSelf,true);
    assert.equal((await request('/api/leaderboard?nearby=1',token)).data.nearby[0].isSelf,true);
    assert.equal((await request('/api/leaderboard?nearby=1')).status,401);
    for (const q of ['metric=unknown','metric=__proto__','period=week','offset=-1','offset=20','offset=100','metric=good&metric=evil','uid=other','version=bad','limit=100000'])
      assert.equal((await request('/api/leaderboard?'+q,token)).status,400,q);
    assert.equal((await request('/api/me/profile',token,{nickname:'我',version:0,leaderboardVisible:'true'})).status,400);
    const body={nickname:'我',version:0,leaderboardVisible:true},id=randomUUID();
    const add=app.store.addReceipt; app.store.addReceipt=()=>{throw Error('write failed');};
    assert.equal((await request('/api/me/profile',token,body,id)).status,500);
    assert.deepEqual((await request('/api/leaderboard',token)).data,initial);
    app.store.addReceipt=add;
    const saved=await request('/api/me/profile',token,body,id);assert.equal(saved.status,200);
    const before=(await request('/api/leaderboard',token)).data;
    assert.equal(before.rows[0].nickname,'我');assert.equal(before.rows[0].publicId,initial.rows[0].publicId);
    assert.deepEqual(before.availableMetrics,['points','games','overall','good','evil']);
    assert.deepEqual((await request('/api/me/profile',token,body,id)).data,saved.data);
    assert.equal((await request('/api/leaderboard',token)).data.version,before.version);
    const guestToken='a'.repeat(64);app.store.addSession(createHash('sha256').update(guestToken).digest('hex'),'guest:guest');
    assert.equal((await request('/api/me/profile',guestToken,{nickname:'游客',version:0,leaderboardVisible:true})).status,400);
    const guest=(await request('/api/leaderboard',guestToken)).data;
    assert.equal(guest.me.status,'unsupported');assert.equal(guest.rows[0].isSelf,false);assert.equal(before.rows[0].isSelf,true);
    const setting='/api/me/leaderboard-visibility',offId=randomUUID();
    assert.equal((await request(setting,token,{leaderboardVisible:'false'})).status,400);
    assert.equal((await request(setting,guestToken,{leaderboardVisible:true})).status,400);
    const off=await request(setting,token,{leaderboardVisible:false},offId);
    assert.equal(off.status,200);assert.equal(off.data.nickname,'我');assert.equal(off.data.leaderboardVisible,false);
    assert.deepEqual((await request(setting,token,{leaderboardVisible:false},offId)).data,off.data);
    const hidden=(await request('/api/leaderboard',token)).data;
    assert.equal(hidden.rows.length,0);assert.equal(hidden.me.total,20);
    assert.equal((await request(setting,token,{leaderboardVisible:true})).status,200);
    assert.equal((await request('/api/leaderboard',token)).data.rows.length,1);
  } finally {await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});
