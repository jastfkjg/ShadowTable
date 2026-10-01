const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { createApp } = require("../server/app");
const { newRoom, enter, command, publicView } = require("../server/engine");
const { Store } = require("../server/store");
const { Leaderboard, periodRange } = require("../server/leaderboard");
const { saveProfile } = require("../server/profile");
const { publicRules, validateRules, policy } = require("../server/scoring");
const configured = require("../server/scoring-rules.json");
function run(room,type,extra={},uid=room.host) { command(room,uid,{type,stage:room.stage,...extra}); }
function deal({prefix="wx:",board="classic",capacity=6}={}) {
  const room=newRoom("123456",prefix+"1","房主",board,capacity);
  for(let i=2;i<=capacity;i++) enter(room,prefix+i,"玩家"+i);
  room.players.forEach(p=>p.ready=true);run(room,"start",{flexible:true});
  if(capacity===6) room.roles=Object.fromEntries(room.players.map((p,i)=>[p.uid,["merlin","percival","servant","servant","morgana","assassin"][i]]));
  return room;
}
function finish(room,extra={scoreReason:"assassination",scoreTarget:3}) {run(room,"finishTools",{replace:true,...extra});return room.matchRecord.players.map(p=>p.score.total);}
test("三绿刺中、未中、派西挡刀、刺到坏人和空刀正确分解积分",()=>{
  assert.deepEqual(finish(deal(),{scoreReason:"assassination",scoreTarget:1}),[1,1,1,1,3,3]);
  assert.deepEqual(finish(deal()),[3,3,4,2,0,0]);
  assert.deepEqual(finish(deal(),{scoreReason:"assassination",scoreTarget:2}),[3,5,2,2,0,0]);
  for(const target of [0,5]) assert.deepEqual(finish(deal(),{scoreReason:"assassination",scoreTarget:target}),[3,3,2,2,0,0]);
  for(const reason of ["quest_fail","five_rejections"]) assert.deepEqual(finish(deal(),{scoreReason:reason}),[0,0,0,0,3,3]);
});
test("规则与表单在开局固定，修改服务端规则只影响新局，说明随配置生成",()=>{
  const old=deal(), original=configured.awards[0].points;
  try {
    configured.awards[0].points=7;
    const fresh=deal();
    assert.equal(finish(old)[2],4);assert.equal(finish(fresh)[2],9);
    assert.notEqual(old.scorePolicy.fingerprint,fresh.scorePolicy.fingerprint);
    assert.match(publicRules().items[0].text,/7 分/);
  } finally {configured.awards[0].points=original;}
  const bad=policy();bad.awards[0].when.secret="anything";assert.throws(()=>validateRules(bad));
  const alternatives=policy();alternatives.awards[0].when={faction:['good','evil'],outcome:['win','loss'],reason:['quest_fail','five_rejections'],isTarget:false};
  assert.match(publicRules(alternatives).items[0].text,/好人／坏人 · 获胜／失利 · 三次任务失败／连续五次组队被否决 · 最终刺杀目标不是本人/);
});
test("结算无身份预览，非法目标不泄露身份，只有房主能提交，结束后只返回本人积分",()=>{
  const room=deal();room.spectators=[{uid:"wx:observer",name:"围观",seat:null}];
  assert.equal(publicView(room,"wx:1").myScore,null);
  assert.doesNotMatch(JSON.stringify(publicView(room,"wx:1").scoreSettlement),/merlin|percival|wx:/);
  assert.throws(()=>run(room,"finishTools",{scoreReason:"assassination",scoreTarget:3},"wx:2"));
  for(const target of [-1,7,"3",null]) assert.throws(()=>finish(room,{scoreReason:"assassination",scoreTarget:target}),/目标|空刀/);
  assert.equal(room.phase,"tools");finish(room);
  assert.equal(publicView(room,"wx:3").myScore.total,4);
  assert.equal(publicView(room,"wx:observer").myScore,null);
  assert.doesNotMatch(JSON.stringify(publicView(room,"wx:3")),/wx:1|wx:2|scorePolicy|scoringFacts|"uid"/);
});
test("积分资格独立于战绩；旧开局、开发局、逆仆板和缺少依据不会计分",()=>{
  for(const variant of ["legacy","dev","testRoom","unknown","reverse","terminated"]) {
    const room=variant==="reverse"?deal({capacity:9}):deal({prefix:variant==="dev"?"dev:":"wx:"});
    if(variant==="legacy") delete room.scorePolicy;
    if(variant==="testRoom") room.testRoom=true;
    if(variant==="terminated") run(room,"terminate");
    else run(room,"finishTools",{winner:"good",replace:true});
    assert.ok(room.matchRecord.players.every(p=>p.score.status==="excluded"));
    if(variant!=="terminated") assert.ok(room.matchRecord.players.every(p=>["win","loss"].includes(p.outcome)));
  }
});
test("记账幂等、事务回滚、零分分母和计分局筛选正确，删除房间不删除积分",()=>{
  const store=new Store(":memory:");try{
    const room=deal();finish(room);store.transaction(()=>store.save(room));
    const score=store.statsFor("wx:5").score;assert.equal(score.games,1);assert.equal(score.average,0);
    store.transaction(()=>store.save(room));assert.equal(store.statsFor("wx:3").score.total,4);
    const second=deal();finish(second,{scoreReason:"quest_fail"});
    assert.throws(()=>store.transaction(()=>{store.save(second);throw Error("rollback");}));
    assert.equal(store.statsFor("wx:3").score.games,1);
    const unknown=deal();run(unknown,"finishTools",{winner:"good"});store.transaction(()=>store.save(unknown));
    assert.equal(store.matchesFor("wx:3").total,2);assert.equal(store.matchesFor("wx:3",0,20,true).total,1);
    store.remove(room.code);assert.equal(store.statsFor("wx:3").score.total,4);
  }finally{store.close();}
});
test("连胜按计分局胜负推进；阶段奖励败局仍中断，奖金可仅从服务端启用",()=>{
  const store=new Store(":memory:");try{
    for(let i=0;i<4;i++) {const room=deal();room.scorePolicy.streakBonus.enabled=true;finish(room);store.transaction(()=>store.save(room));}
    assert.deepEqual(store.streakFor("wx:3"),{current:4,best:4});
    assert.equal(store.statsFor("wx:3").score.total,17);
    const unknown=deal();run(unknown,"finishTools",{winner:"evil"});store.transaction(()=>store.save(unknown));
    assert.equal(store.streakFor("wx:3").current,4);
    const loss=deal();finish(loss,{scoreReason:"assassination",scoreTarget:1});store.transaction(()=>store.save(loss));
    assert.deepEqual(store.streakFor("wx:3"),{current:0,best:4});
  }finally{store.close();}
});
test("积分榜同分并列，零分可上榜，公开设置与北京时间月界沿用现有行为",()=>{
  const store=new Store(":memory:");try{
    for(let i=1;i<=6;i++) store.transaction(()=>saveProfile(store,"wx:"+i,{nickname:"玩家"+i,version:0}));
    const room=deal();finish(room);const now=Date.now(),range=periodRange("month",now);room.matchRecord.endedAt=range.start;
    store.transaction(()=>store.save(room));const board=new Leaderboard(store);
    const result=board.read("wx:5",new URLSearchParams("metric=points&period=month"),now);
    assert.deepEqual(result.rows.map(row=>row.rank),[1,2,2,4,5,5]);assert.equal(result.me.points,0);assert.equal(result.me.rank,5);
    assert.doesNotMatch(JSON.stringify(result),/wx:|"uid"|breakdown|roleId/);
    const previous=board.read("wx:5",new URLSearchParams("metric=points"),range.start-1);
    assert.equal(previous.me.total,1); // all-time includes any archived timestamp.
    store.transaction(()=>saveProfile(store,"wx:3",{nickname:"玩家3",version:1,leaderboardVisible:false}));
    assert.equal(board.read("wx:3",new URLSearchParams("metric=points"),now).me.status,"hidden");
    const nextMonth=board.read("wx:5",new URLSearchParams("metric=points&period=month"),range.end);
    assert.equal(nextMonth.me.total,0);assert.equal(nextMonth.me.points,0);
  }finally{store.close();}
});
test("积分明细与规则快照跨重启保留，旧归档不补算",()=>{
  const dir=mkdtempSync(join(tmpdir(),"shadow-score-")),path=join(dir,"db.sqlite");let store=new Store(path);
  try{
    const room=deal();finish(room);store.transaction(()=>store.save(room));
    const record=store.matchesFor("wx:3").records[0];store.close();store=new Store(path);
    assert.deepEqual(store.matchesFor("wx:3").records[0],record);
    store.transaction(()=>store.archiveMatch({id:"old",board:"classic",endedAt:Date.now(),winner:"good",players:[{uid:"wx:3",role:"忠臣",faction:"good",outcome:"win"}]}));
    assert.equal(store.statsFor("wx:3").score.games,1);
    assert.equal(store.matchesFor("wx:3").records.find(r=>r.id==="old").score.status,"legacy");
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test("更正整局同步积分、胜负及后续连胜奖励；版本冲突和事务失败不会部分更正",()=>{
  const store=new Store(":memory:");try{
    const rooms=[];
    for(let i=0;i<3;i++){const room=deal();room.scorePolicy.streakBonus.enabled=true;finish(room);store.transaction(()=>store.save(room));rooms.push(room);}
    assert.equal(store.statsFor("wx:3").score.total,13);
    const input={revision:0,scoreReason:"quest_fail"};
    assert.throws(()=>store.transaction(()=>{store.correctMatch(rooms[0].matchId,input);throw Error("rollback");}));
    assert.equal(store.statsFor("wx:3").score.total,13);
    store.transaction(()=>store.correctMatch(rooms[0].matchId,input));
    assert.equal(store.statsFor("wx:3").score.total,8);assert.equal(store.statsFor("wx:3").wins,2);
    assert.deepEqual(store.streakFor("wx:3"),{current:2,best:2});
    assert.equal(publicView(store.get("123456"),"wx:3").myScore.total,4);
    assert.throws(()=>store.transaction(()=>store.correctMatch(rooms[0].matchId,input)),error=>error.status===409);
    store.transaction(()=>store.correctMatch(rooms[0].matchId,{revision:1,scoreReason:"assassination",scoreTarget:3}));
    assert.equal(store.statsFor("wx:3").score.total,13);
  }finally{store.close();}
});
test("HTTP积分结算同事务、幂等、本人可见，规则公开且筛选包含零分局",async()=>{
  const app=createApp({database:":memory:",exchangeCode:async code=>code});
  await new Promise(resolve=>app.server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+app.server.address().port;
  async function req(path,token,data,id=randomUUID()) {
    const response=await fetch(base+path,{method:data?"POST":"GET",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(token || ""),"Idempotency-Key":id},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  }
  try {
    const tokens=[];for(let i=0;i<6;i++) tokens.push((await req("/api/login",null,{code:"score-api-"+i})).data.token);
    const uids=tokens.map(token=>app.store.session(createHash("sha256").update(token).digest("hex")).uid);
    const room=newRoom("123456",uids[0],"房主","classic",6);uids.slice(1).forEach((uid,i)=>enter(room,uid,"玩家"+(i+2)));
    room.players.forEach(p=>p.ready=true);run(room,"start",{flexible:true});
    room.roles=Object.fromEntries(uids.map((uid,i)=>[uid,["merlin","percival","servant","servant","morgana","assassin"][i]]));
    app.store.transaction(()=>app.store.save(room));
    assert.equal((await req("/api/scoring/rules")).status,200);
    const body={type:"finishTools",stage:room.stage,replace:true,scoreReason:"assassination",scoreTarget:3},id=randomUUID(),path="/api/rooms/123456";
    assert.equal((await req(path+"/commands",tokens[1],body)).status,403);
    const original=app.store.addReceipt;app.store.addReceipt=()=>{throw Error("storage failure");};
    assert.equal((await req(path+"/commands",tokens[0],body,id)).status,500);app.store.addReceipt=original;
    assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM match_scores").get().n,0);
    assert.equal((await req(path,tokens[0])).data.phase,"tools");
    assert.equal((await req(path+"/commands",tokens[0],body,id)).status,200);
    assert.equal((await req(path+"/commands",tokens[0],body,id)).status,200);
    assert.equal((await req(path,tokens[2])).data.myScore.total,4);
    assert.equal((await req("/api/me/matches?scored=1",tokens[4])).data.total,1);
    assert.equal((await req("/api/me/stats",tokens[4])).data.score.average,0);
    assert.equal((await req("/api/me/matches?scored=bad",tokens[4])).status,400);
    assert.equal((await req("/api/me/stats",tokens[2])).data.score.total,4);
    assert.doesNotMatch(JSON.stringify((await req(path,tokens[2])).data),/"uid"|scorePolicy|scoringFacts/);
  }finally{await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});

test('服务端配置支持负分，记录与规则说明使用正确符号且客户端无需新的加分项目',()=>{
  const original=configured.awards[0].points;
  try{
    configured.awards[0].points=-4;
    const room=deal();finish(room,{scoreReason:'assassination',scoreTarget:0});
    assert.equal(room.matchRecord.players[2].score.total,-4);
    assert.match(publicRules().items[0].text,/：-4 分/);
    const {presentMatches}=require('../miniprogram/profile');
    const shown=presentMatches([{endedAt:1,members:[],score:room.matchRecord.players[2].score}]);
    assert.equal(shown[0].scoreLabel,'-4 分');
  }finally{configured.awards[0].points=original;}
});
