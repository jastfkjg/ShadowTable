const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../server/store');
const { createApp } = require('../server/app');
const { newRoom, enter, command } = require('../server/engine');
const { readProfile, saveProfile } = require('../server/profile');
const { playerStatsId, readRoomPlayerStats } = require('../server/player-stats');

function archive(store, id, faction, outcome, score) {
  store.archiveMatch({ id, code:'654321', game:1, board:'classic', boardName:'经典基础', capacity:6,
    startedAt:1, endedAt:2, winner:'good', source:'manual', excludedReason:null,
    players:[{uid:'wx:target',name:'历史昵称',seat:2,role:'梅林',faction,outcome,
      score: {status:'scored',total:score,breakdown:[]} }] });
}
test('同房所有玩家战绩开放，不受旧公开设置影响，只返回历史汇总', () => {
  const store = new Store(':memory:');
  try {
    const room = newRoom('123456','wx:host','房主','classic',6);
    enter(room,'wx:target','本桌昵称');
    const target = room.players[1], id = playerStatsId(room,target);
    archive(store,'m1','good','win',3); archive(store,'m2','evil','loss',0);
    archive(store,'m3','good','excluded',0);
    assert.equal(readProfile(store,target.uid).roomStatsVisible,false);
    assert.deepEqual(Object.keys(readRoomPlayerStats(store,room,'wx:host',id)).sort(),['player','stats','status']);
    assert.equal(readRoomPlayerStats(store,room,'wx:host',id).status,'available');
    const own = readRoomPlayerStats(store,room,target.uid,id);
    assert.equal(own.status,'available');
    const before = readProfile(store,target.uid);
    saveProfile(store,target.uid,{nickname:'个人昵称',version:before.version,roomStatsVisible:false,leaderboardVisible:false});
    const value = readRoomPlayerStats(store,room,'wx:host',id), mine = store.statsFor(target.uid);
    assert.equal(value.player.name,'本桌昵称');
    assert.deepEqual(value.stats,{total:mine.total,wins:mine.wins,winRate:mine.winRate,scoreTotal:mine.score.total,
      byFaction:mine.byFaction.filter(r=>r.total).map(({faction,label,total,wins,winRate})=>({faction,label,total,wins,winRate}))});
    assert.equal(value.stats.total,2); assert.equal(value.stats.winRate,50);
    assert.doesNotMatch(JSON.stringify(value),/wx:|历史昵称|个人昵称|梅林|uid|recent|role|match_id|654321|manualAdjustment/);
    assert.equal(readProfile(store,target.uid).leaderboardVisible,false);
    assert.throws(()=>readRoomPlayerStats(store,room,'wx:outsider',id),e=>e.status===403);
    assert.throws(()=>readRoomPlayerStats(store,room,'wx:host','a'.repeat(64)),e=>e.status===404);
    room.spectators=[{uid:'wx:observer',name:'围观',seat:null}];
    assert.equal(readRoomPlayerStats(store,room,'wx:observer',id).status,'available');
    command(room,target.uid,{type:'stand',stage:room.stage});
    assert.throws(()=>readRoomPlayerStats(store,room,'wx:host',id),e=>e.status===404);
    enter(room,'wx:replacement','本桌昵称');
    assert.notEqual(playerStatsId(room,room.players.find(p=>p.uid==='wx:replacement')),id);
    for (const uid of ['guest:guest','dev:dev','test:companion']) {
      enter(room,uid,'测试昵称');
      const player=room.players.find(p=>p.uid===uid);
      const card=readRoomPlayerStats(store,room,'wx:host',playerStatsId(room,player));
      assert.equal(card.status,uid.startsWith('test:')?'untracked':'available');
      if(card.status==='available')assert.equal(card.stats.total,0);
    }
  } finally { store.close(); }
});
test('旧同房设置保留兼容数据，但关闭或重启后仍可查看战绩', () => {
  const dir = mkdtempSync(join(tmpdir(),'shadow-player-card-')), path=join(dir,'data.sqlite');
  let store = new Store(path);
  try {
    let p=saveProfile(store,'wx:target',{nickname:'甲',version:0,roomStatsVisible:true});
    p=saveProfile(store,'wx:target',{nickname:'乙',version:p.version,leaderboardVisible:false});
    assert.equal(p.roomStatsVisible,true);
    assert.throws(()=>saveProfile(store,'wx:target',{nickname:'乙',version:p.version,roomStatsVisible:'true'}),/同房战绩/);
    store.close(); store=new Store(path);
    assert.equal(readProfile(store,'wx:target').roomStatsVisible,true);
    assert.equal(readProfile(store,'wx:new').roomStatsVisible,false);
    const room=newRoom('123456','wx:new','房主','classic',6);
    enter(room,'wx:target','乙');
    assert.equal(readRoomPlayerStats(store,room,'wx:new',playerStatsId(room,room.players[1])).status,'available');
    assert.equal(readRoomPlayerStats(store,room,'wx:target',playerStatsId(room,room.players[0])).status,'available');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('同房战绩 HTTP 默认开放且忽略旧开关，鉴权、离房及房间删除仍生效', async () => {
  const app=createApp({database:':memory:',exchangeCode:async code=>code});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;
  async function req(path,token,body) {
    const res=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(token||''),'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});
    return {status:res.status,headers:res.headers,data:await res.json()};
  }
  try {
    const host=(await req('/api/login',null,{code:'host'})).data.token;
    const peer=(await req('/api/login',null,{code:'peer'})).data.token;
    const stranger=(await req('/api/login',null,{code:'stranger'})).data.token;
    await req('/api/me/profile',host,{nickname:'房主',version:0});
    const {data:created}=await req('/api/rooms',host,{name:'房主',board:'classic',capacity:6});
    const roomPath='/api/rooms/'+created.code;
    await req(roomPath+'/join',peer,{name:'乙'});
    const room=(await req(roomPath,peer)).data;
    const target=room.players.find(p=>p.isHost), path=roomPath+'/players/'+target.statsId+'/stats';
    assert.match(target.statsId,/^[a-f0-9]{64}$/);
    assert.equal((await req(path)).status,401);
    assert.equal((await req(path,stranger)).status,403);
    const success=await req(path,peer);
    assert.equal(success.status,200);assert.equal(success.data.status,'available');assert.equal(success.data.stats.winRate,null);
    assert.equal(success.headers.get('cache-control'),'no-store');
    const profile=(await req('/api/me/profile',host)).data;
    await req('/api/me/profile',host,{nickname:'房主',version:profile.version,roomStatsVisible:false});
    const available=await req(path,peer);assert.equal(available.data.status,'available');assert.deepEqual(available.data.stats,success.data.stats);
    assert.equal((await req(path,host)).data.status,'available');
    const current=(await req(roomPath,peer)).data;
    assert.equal((await req(roomPath+'/commands',peer,{type:'leave',stage:current.stage})).status,200);
    assert.equal((await req(path,peer)).status,403);
    app.store.remove(created.code);assert.equal((await req(path,host)).status,404);
  } finally {await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});
