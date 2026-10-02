'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {Store}=require('../server/store');
const {newRoom,enter,command}=require('../server/engine');
const {Leaderboard,periodRange}=require('../server/leaderboard');
const {createApp}=require('../server/app');
function game(store,options={}) {
 const room=newRoom('123456','wx:1','林间','classic',6);
 for(let i=2;i<=6;i++)enter(room,'wx:'+i,'玩家'+i);
 command(room,room.host,{type:'updateSettings',stage:room.stage,board:'classic',capacity:6,visible:false,scoreEnabled:true});
 room.players.forEach(p=>p.ready=true);command(room,room.host,{type:'start',stage:room.stage,flexible:true});
 room.roles=Object.fromEntries(room.players.map((p,i)=>[p.uid,['merlin','percival','servant','servant','morgana','assassin'][i]]));
 if(options.bonus)room.scorePolicy.streakBonus.enabled=true;
 command(room,room.host,{type:'finishTools',stage:room.stage,scoreReason:'assassination',scoreTarget:3});
 if(options.ended)room.matchRecord.endedAt=options.ended;
 store.transaction(()=>store.save(room));return room;
}
const adjust=(store,uid,points,mode='delta')=>store.transaction(()=>store.adjustPlayerScore({uid,points,mode,revision:store.scoreRevision(uid),reason:'管理修正'}));
test('玩家加减和设置总分保留流水，榜单同步但场均、胜负和连胜不变，版本冲突及事务回滚安全',()=>{
 const store=new Store(':memory:');try {
  game(store);const board=new Leaderboard(store),before=store.statsFor('wx:3'),version=store.scoreRevision('wx:3');
  const first=adjust(store,'wx:3',10);assert.equal(first.after,14);assert.equal(store.statsFor('wx:3').score.average,4);
  assert.equal(board.read('wx:3',new URLSearchParams('metric=points')).me.points,14);
  assert.equal(store.statsFor('wx:3').wins,before.wins);assert.deepEqual(store.streakFor('wx:3'),{current:1,best:1});
  assert.throws(()=>store.transaction(()=>store.adjustPlayerScore({uid:'wx:3',points:9,mode:'set',revision:version,reason:'旧版本'})),e=>e.status===409);
  adjust(store,'wx:3',-2,'set');assert.equal(store.statsFor('wx:3').score.total,-2);
  const records=store.scoreAdjustments('wx:3');assert.deepEqual(records.records.map(row=>row.delta),[-16,10]);assert.doesNotMatch(JSON.stringify(records),/wx:|administrator/);
  assert.throws(()=>store.transaction(()=>{store.adjustPlayerScore({uid:'wx:3',points:5,mode:'delta',revision:store.scoreRevision('wx:3'),reason:'回滚测试'});throw Error('rollback');}));
  assert.equal(store.playerScore('wx:3').points,-2);assert.equal(store.scoreAdjustments('wx:3').total,2);
  for(const points of [1.5,NaN,Infinity,1000001,'3'])assert.throws(()=>adjust(store,'wx:3',points),/整数/);
  assert.throws(()=>adjust(store,'wx:unknown',1),e=>e.status===404);
 }finally{store.close();}
});
test('单局多人改分、负分、恢复自动计分和结果重算保留手动覆盖，同步结束页与版本',()=>{
 const store=new Store(':memory:');try {
  const room=game(store);adjust(store,'wx:3',5);
  const input={revision:0,reason:'现场奖励修正',scores:[{uid:'wx:3',points:10},{uid:'wx:5',points:-3}]};
  const changed=store.transaction(()=>store.adjustMatchScores(room.matchId,input));assert.equal(changed.revision,1);
  assert.equal(store.statsFor('wx:3').score.total,15);assert.equal(store.statsFor('wx:5').score.total,-3);
  assert.equal(store.get(room.code).matchRecord.players[2].score.total,10);
  assert.throws(()=>store.transaction(()=>store.adjustMatchScores(room.matchId,input)),e=>e.status===409);
  store.transaction(()=>store.correctMatch(room.matchId,{revision:1,scoreReason:'quest_fail'}));
  assert.equal(store.statsFor('wx:3').score.total,15);assert.equal(store.streakFor('wx:3').current,0);
  assert.equal(store.matchesFor('wx:3').records[0].score.manualOverride.reason,'现场奖励修正');
  store.transaction(()=>store.adjustMatchScores(room.matchId,{revision:2,reason:'恢复自动规则',scores:[{uid:'wx:3',points:null},{uid:'wx:5',points:null}]}));
  assert.equal(store.statsFor('wx:3').score.total,5);assert.equal(store.statsFor('wx:5').score.total,3);
  assert.equal(store.matchesFor('wx:3').records[0].score.manualOverride,undefined);
  const revision=store.scoreRevision('wx:3');
  assert.throws(()=>store.transaction(()=>store.adjustMatchScores(room.matchId,{revision:3,reason:'非法批量',scores:[{uid:'wx:3',points:50},{uid:'other',points:20}]})));
  assert.equal(store.statsFor('wx:3').score.total,5);assert.equal(store.scoreRevision('wx:3'),revision);
  for(const scores of [[null],[{uid:'wx:3',points:1.2}],[{uid:'wx:3',points:2},{uid:'wx:3',points:3}]])assert.throws(()=>store.transaction(()=>store.adjustMatchScores(room.matchId,{revision:3,reason:'非法参数',scores})),e=>e.status===400);
 }finally{store.close();}
});
test('调整月份以操作时间计，单局积分归原月份，重启和原规则重算后仍保留调整及幂等版本',()=>{
 const directory=mkdtempSync(join(tmpdir(),'shadow-score-admin-')),path=join(directory,'db.sqlite');let store=new Store(path);
 try {
  const range=periodRange('month',Date.now()),room=game(store,{ended:range.start-1});
  adjust(store,'wx:3',7);store.transaction(()=>store.adjustMatchScores(room.matchId,{revision:0,reason:'历史积分修正',scores:[{uid:'wx:3',points:8}]}));
  assert.equal(store.statsFor('wx:3').score.month,7);assert.equal(store.statsFor('wx:3').score.total,15);
  const board=new Leaderboard(store),month=board.read('wx:3',new URLSearchParams('metric=points&period=month'));
  assert.equal(month.me.points,7);assert.equal(month.me.status,'no_games');assert.ok(!month.rows.some(row=>row.isSelf));
  const revision=store.scoreRevision('wx:3');store.close();store=new Store(path);
  assert.equal(store.playerScore('wx:3').points,15);assert.equal(store.scoreRevision('wx:3'),revision);
  store.transaction(()=>store.correctMatch(room.matchId,{revision:1,scoreReason:'quest_fail'}));assert.equal(store.playerScore('wx:3').points,15);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('更正早期胜负时后续连胜奖励重算，手动单局积分及独立玩家调整保持不变',()=>{
 const store=new Store(':memory:');try {
  const first=game(store,{bonus:true}),second=game(store,{bonus:true}),third=game(store,{bonus:true});
  assert.equal(store.matchesFor('wx:3').records.find(row=>row.id===third.matchId).score.total,5);
  store.transaction(()=>store.adjustMatchScores(second.matchId,{revision:0,reason:'手动固定单局',scores:[{uid:'wx:3',points:12}]}));adjust(store,'wx:3',6);
  store.transaction(()=>store.correctMatch(first.matchId,{revision:0,scoreReason:'quest_fail'}));
  const records=store.matchesFor('wx:3').records;
  assert.equal(records.find(row=>row.id===second.matchId).score.total,12);
  assert.equal(records.find(row=>row.id===third.matchId).score.total,4);
  assert.equal(store.playerScore('wx:3').points,22);assert.equal(store.streakFor('wx:3').current,2);
 }finally{store.close();}
});
async function launch(t) {
 const origin='http://localhost:8910',key='scoring-management-key-'.repeat(3);
 const app=createApp({database:':memory:',adminOrigin:origin,adminKey:key,exchangeCode:async code=>code});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.store.close();});
 let cookie='';
 const request=async(path,data,headers={})=>{
  const response=await new Promise((resolve,reject)=>{
   const req=require('node:http').request({hostname:'127.0.0.1',port:app.server.address().port,path,method:data?'POST':'GET',headers:{Host:'localhost:8910',Origin:origin,Cookie:cookie,'Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(text)}));});
   req.on('error',reject);if(data)req.write(JSON.stringify(data));req.end();
  });return response;
 };
 const login=async()=>{const response=await request('/api/admin/login',{key});cookie=response.headers['set-cookie'][0].split(';')[0];};
 return {...app,request,login};
}
test('管理积分接口要求鉴权来源和原因，跨登录重试不重复加分，审计与明细可查询且个人数据隔离',async t=>{
 const a=await launch(t),room=game(a.store);
 const lookup='/api/admin/score-players?q='+encodeURIComponent('林间');
 assert.equal((await a.request(lookup)).status,401);await a.login();
 const found=await a.request(lookup);assert.equal(found.data.players[0].uid,'wx:1');
 const player=a.store.playerScore('wx:1'),body={uid:'wx:1',points:8,mode:'delta',revision:player.revision,reason:'额外奖励',requestId:randomUUID()};
 assert.equal((await a.request('/api/admin/score-adjustments',body,{Origin:'https://evil.test'})).status,403);
 assert.equal((await a.request('/api/admin/score-adjustments',{...body,reason:''})).status,400);
 const first=await a.request('/api/admin/score-adjustments',body);assert.equal(first.status,200);assert.equal(first.data.after,11);
 await a.login();assert.deepEqual((await a.request('/api/admin/score-adjustments',body)).data,first.data);
 assert.equal((await a.request('/api/admin/score-adjustments',{...body,points:9})).status,409);
 assert.equal(a.store.db.prepare("SELECT count(*) AS n FROM admin_audit WHERE action='adjust-player-score'").get().n,1);
 const details=await a.request('/api/admin/matches/'+room.matchId+'/scores');assert.equal(details.data.players.length,6);
 const change={revision:details.data.revision,scores:[{uid:'wx:1',points:12}],reason:'本局调整',requestId:randomUUID()};
 const changed=await a.request('/api/admin/matches/'+room.matchId+'/scores',change);assert.equal(changed.status,200);
 assert.deepEqual((await a.request('/api/admin/matches/'+room.matchId+'/scores',change)).data,changed.data);
 assert.equal(a.store.statsFor('wx:1').score.total,20);
 const token='b'.repeat(64);a.store.addSession(createHash('sha256').update(token).digest('hex'),'wx:2');
 const own=await a.request('/api/me/score-adjustments?uid=wx:1',null,{Authorization:'Bearer '+token});assert.equal(own.status,200);assert.equal(own.data.total,0);
 a.store.addSession(createHash('sha256').update('c'.repeat(64)).digest('hex'),'wx:1');
 const ledger=await a.request('/api/me/matches?offset=0',null,{Authorization:'Bearer '+'c'.repeat(64)});assert.equal(ledger.data.adjustments.total,1);
 assert.doesNotMatch(JSON.stringify(ledger.data),/administrator|wx:1|wx:2/);
});
