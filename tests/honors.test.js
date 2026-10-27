const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../server/store');
const { newRoom, enter, command } = require('../server/engine');
const honors = require('../server/honors');
const { Leaderboard } = require('../server/leaderboard');
function fixture(store, uids = Array.from({length:6}, (_,i) => 'wx:'+(i+1)), { scoreEnabled = false, legacy = false, endedAt } = {}) {
  const r = newRoom('123456', uids[0], '玩家1', 'classic', 6);
  r.scoreEnabled = scoreEnabled;
  r.testRoom = uids.some(uid => uid.startsWith('test:'));
  for (let i=2;i<=6;i++) enter(r,uids[i-1],'玩家'+i);
  r.players.forEach(p=>p.ready=true);
  command(r,r.host,{type:'start',stage:r.stage,flexible:true});
  if (legacy) r.scorePolicy.awards = r.scorePolicy.awards.filter(award => !award.when.honor);
  r.roles=Object.fromEntries(r.players.map((p,i)=>[p.uid,['merlin','percival','servant','servant','morgana','assassin'][i]]));
  r.fun.initialRoles={...r.roles};
  command(r,r.host,{type:'finishTools',stage:r.stage,replace:true,
    ...(scoreEnabled ? {scoreReason:'assassination',scoreTarget:3} : {funReason:'assassination',funTarget:3})});
  if (endedAt !== undefined) r.matchRecord.endedAt = endedAt;
  store.transaction(()=>store.save(r));
  return r;
}
function act(s,r,uid,type,extra={}) { s.transaction(()=>honors.handle(s,s.get(r.code),uid,{type,stage:r.stage,matchId:r.matchRecord.id,...extra})); }
function vote(s,r,i,mvp=i===2?1:2,svp=i===5?6:5) { act(s,r,'wx:'+i,'honorVote',{mvp,svp}); }
test('计分局并列 MVP 与 SVP 各加一分，明细、榜单、流水和结束页同步且不重复发放',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s,undefined,{scoreEnabled:true}),rank=new Leaderboard(s);
    assert.equal(rank.read('wx:2',new URLSearchParams('metric=points')).me.points,12);
    const revision=s.scoreRevision('wx:2');
    act(s,r,r.host,'honorStart');
    vote(s,r,1,3,6);vote(s,r,2,3,5);vote(s,r,3,2,6);vote(s,r,4,2,6);vote(s,r,5,3,6);vote(s,r,6,2,5);
    for(const [uid,total,award] of [['wx:2',13,'honor_mvp'],['wx:3',16,'honor_mvp'],['wx:6',1,'honor_svp']]) {
      const score=s.matchFor(uid,r.matchId).score;
      assert.equal(score.total,total);
      assert.deepEqual(score.breakdown.filter(row=>row.id===award).map(row=>row.points),[1]);
      assert.equal(s.get(r.code).matchRecord.players.find(p=>p.uid===uid).score.total,total);
      assert.equal(s.statsFor(uid).score.total,total);
      assert.equal(s.scoreLedger(uid).summary.total,total);
      assert.equal(rank.read(uid,new URLSearchParams('metric=points')).me.points,total);
    }
    assert.throws(()=>s.scoreLedger('wx:2',0,20,revision),e=>e.status===409);
    s.transaction(()=>honors.closeForRoom(s,s.get(r.code)));
    s.transaction(()=>s.save(s.get(r.code)));
    assert.equal(s.playerScore('wx:2').points,13);
    assert.equal(s.playerScore('wx:1').points,12);
    assert.equal(s.playerScore('wx:5').points,0);
    s.transaction(()=>s.manageMatches({action:'exclude',matches:[{id:r.matchId,revision:0}]}));
    assert.equal(s.playerScore('wx:2').points,0);
    s.transaction(()=>s.manageMatches({action:'include',matches:[{id:r.matchId,revision:s.matchScoreData(r.matchId).revision}]}));
    assert.equal(s.playerScore('wx:2').points,13);
  } finally {s.close();}
});
test('票选结算事务回滚不发分，未达人数、未计分与旧规则局不发票选积分',()=>{
  for(const options of [{scoreEnabled:true},{scoreEnabled:false},{scoreEnabled:true,legacy:true}]) {
    const s=new Store(':memory:');
    try {
      const r=fixture(s,undefined,options),before=s.playerScore('wx:2').points;
      act(s,r,r.host,'honorStart');vote(s,r,1);vote(s,r,3);
      if(options.scoreEnabled && !options.legacy) {
        assert.throws(()=>s.transaction(()=>{
          honors.handle(s,s.get(r.code),'wx:4',{type:'honorVote',stage:r.stage,matchId:r.matchId,mvp:2,svp:5});
          honors.closeForRoom(s,s.get(r.code));throw Error('rollback');
        }),/rollback/);
        assert.equal(honors.view(s,s.get(r.code),r.host).status,'open');
        assert.equal(s.playerScore('wx:2').points,before);
      } else vote(s,r,4);
      act(s,r,r.host,'honorClose');
      assert.equal(honors.view(s,s.get(r.code),r.host).status,options.scoreEnabled && !options.legacy?'insufficient':'settled');
      assert.equal(s.playerScore('wx:2').points,before);
      assert.ok(!s.matchFor('wx:2',r.matchId).score.breakdown.some(row=>row.id==='honor_mvp'));
    } finally {s.close();}
  }
});
test('更正刀口保留票选奖励，改变胜方撤回奖励；手动总分保留且恢复自动时包含奖励',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s,undefined,{scoreEnabled:true});
    s.transaction(()=>s.adjustMatchScores(r.matchId,{revision:0,scores:[{uid:'wx:2',points:10}]}));
    act(s,r,r.host,'honorStart');[1,3,4].forEach(i=>vote(s,r,i));act(s,r,r.host,'honorClose');
    assert.equal(s.playerScore('wx:2').points,10);
    assert.ok(s.matchFor('wx:2',r.matchId).score.breakdown.some(row=>row.id==='honor_mvp'));
    s.transaction(()=>s.adjustMatchScores(r.matchId,{revision:1,scores:[{uid:'wx:2',points:null}]}));
    assert.equal(s.playerScore('wx:2').points,13);
    s.transaction(()=>s.correctMatch(r.matchId,{revision:2,scoreReason:'assassination',scoreTarget:2}));
    assert.equal(s.playerScore('wx:2').points,13);
    assert.equal(s.playerScore('wx:5').points,1);
    s.transaction(()=>s.correctMatch(r.matchId,{revision:3,scoreReason:'assassination',scoreTarget:1}));
    assert.equal(honors.view(s,s.get(r.code),r.host).status,'invalidated');
    assert.equal(s.playerScore('wx:2').points,2);
    assert.equal(s.playerScore('wx:5').points,9);
    assert.ok(!s.matchFor('wx:2',r.matchId).score.breakdown.some(row=>row.id.startsWith('honor_')));
  } finally {s.close();}
});
test('三绿刺中梅林坏人每人九分，MVP 额外加一分',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s,undefined,{scoreEnabled:true});
    s.transaction(()=>s.correctMatch(r.matchId,{revision:0,scoreReason:'assassination',scoreTarget:1}));
    act(s,r,r.host,'honorStart');
    vote(s,r,1,5,2);vote(s,r,3,5,2);vote(s,r,4,5,2);act(s,r,r.host,'honorClose');
    assert.equal(s.playerScore('wx:5').points,10);
    assert.equal(s.playerScore('wx:6').points,9);
    assert.equal(s.playerScore('wx:2').points,3);
    assert.deepEqual(s.matchFor('wx:5',r.matchId).score.breakdown,[
      {id:'evil_win',label:'坏人获胜',points:9},{id:'honor_mvp',label:'MVP 票选奖励',points:1}
    ]);
  } finally {s.close();}
});
test('票选奖励归对局原月份，重启后保留得分且不会重复结算',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadowtable-honor-points-')),database=path.join(dir,'test.sqlite');
  const now=Date.parse('2026-11-01T00:00:00+08:00'),endedAt=now-1;
  let s=new Store(database,{clock:()=>now});
  try {
    const r=fixture(s,undefined,{scoreEnabled:true,endedAt});
    act(s,r,r.host,'honorStart');[1,3,4].forEach(i=>vote(s,r,i));act(s,r,r.host,'honorClose');
    assert.equal(s.scoreForMonth('wx:2','2026-10').points,13);
    assert.equal(s.playerScore('wx:2').points,0);
    s.close();s=new Store(database,{clock:()=>now});
    s.transaction(()=>honors.closeForRoom(s,s.get(r.code)));
    assert.equal(s.matchFor('wx:2',r.matchId).score.total,13);
    assert.equal(s.scoreForMonth('wx:2','2026-10').points,13);
    assert.equal(s.playerScore('wx:2').points,0);
  } finally {s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('anonymous ballots validate both outcomes and self; all submitted settles ties once',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s);
    assert.throws(()=>act(s,r,'wx:2','honorStart'),/房主/);
    act(s,r,r.host,'honorStart');
    assert.throws(()=>act(s,r,r.host,'honorStart'),/已经/);
    assert.throws(()=>vote(s,r,1,1,5),/不能投自己/);
    assert.throws(()=>vote(s,r,1,5,2),/对应胜负方/);
    vote(s,r,1); vote(s,r,1,3,6); // edit, never two ballots
    const hidden=honors.view(s,s.get(r.code),'wx:2');
    assert.equal(hidden.completed,1);assert.equal(hidden.ballot,null);
    assert(!JSON.stringify(hidden).includes('wx:'));assert(!JSON.stringify(hidden).includes('votes'));
    vote(s,r,2,3,5);vote(s,r,3,2,6);vote(s,r,4,2,6);vote(s,r,5,3,6);vote(s,r,6,2,5);
    const result=honors.view(s,s.get(r.code),'wx:1');
    assert.equal(result.status,'settled');
    assert.deepEqual(result.mvp.map(p=>[p.seat,p.votes]),[[2,3],[3,3]]);
    assert.deepEqual(result.svp.map(p=>[p.seat,p.votes]),[[6,4]]);
    assert.equal(result.mvp[0].name,'玩家2');assert('avatarUrl' in result.mvp[0]);
    for(const uid of ['wx:1','wx:3','guest:spectator']) assert.deepEqual(honors.view(s,s.get(r.code),uid).mvp,result.mvp);
    const count=()=>s.funFor('wx:2').metrics.find(p=>p.id==='honor_mvp').count;
    assert.equal(count(),1);
    s.transaction(()=>honors.closeForRoom(s,s.get(r.code)));s.transaction(()=>s.save(s.get(r.code)));
    assert.equal(count(),1);
    assert.equal(s.matchesFor('wx:2',0,20,false,{metric:'honor_mvp',mode:'voted'}).total,1);
    const rank=new Leaderboard(s).read('wx:2',new URLSearchParams('metric=fun_honor_mvp'));
    assert.equal(rank.rows.length,2); assert(rank.rows.every(p=>p.rank===1 && p.tied && p.count===1));
    assert.throws(()=>new Leaderboard(s).read('wx:2',new URLSearchParams('metric=fun_honor_mvp&sort=rate')),/次数榜/);
    assert.throws(()=>vote(s,r,1),/结束/);
  } finally {s.close();}
});
test('polls have no timeout, including legacy deadlines; host closes and rematch preserves quorum result',()=>{
  let now=Date.now();const s=new Store(':memory:',{clock:()=>now});
  try {
    const r=fixture(s);act(s,r,r.host,'honorStart');vote(s,r,1);vote(s,r,2);
    const id=r.matchRecord.id;
    const poll=JSON.parse(s.db.prepare('SELECT state FROM honor_polls WHERE match_id=?').get(id).state);
    assert.equal(poll.deadline,undefined);
    // An open election created by an older server must also remain open.
    poll.deadline=now+120000;
    s.db.prepare('UPDATE honor_polls SET state=?,deadline=? WHERE match_id=?').run(JSON.stringify(poll),poll.deadline,id);
    now+=7*24*60*60*1000;honors.settleOrphaned(s);
    const open=honors.view(s,s.get(r.code),'wx:1');
    assert.equal(open.status,'open');assert.equal(open.deadline,undefined);assert.equal(open.serverNow,undefined);
    vote(s,r,1,3,6);
    assert.deepEqual(honors.view(s,s.get(r.code),'wx:1').ballot,{mvp:3,svp:6});
    act(s,r,r.host,'honorClose');
    assert.equal(honors.view(s,s.get(r.code),'wx:1').status,'insufficient');
    assert(!s.funFor('wx:2').metrics.some(p=>p.id==='honor_mvp'));
    const room=s.get(r.code);s.transaction(()=>{honors.closeForRoom(s,room);command(room,room.host,{type:'rematch',stage:room.stage});s.save(room);});
    assert.equal(honors.view(s,s.get(r.code),'wx:1'),null);
    assert.equal(s.matchFor('wx:1',r.matchRecord.id).honorResult.status,'insufficient');
  } finally {s.close();}
});
test('only the current host sees pending voters, without revealing other ballots',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s);act(s,r,r.host,'honorStart');vote(s,r,1);
    let view=honors.view(s,s.get(r.code),r.host);
    assert.deepEqual(view.pendingPlayers,Array.from({length:5},(_,i)=>({seat:i+2,name:'玩家'+(i+2)})));
    vote(s,r,2);vote(s,r,2,3,6);
    view=honors.view(s,s.get(r.code),r.host);
    assert.equal(view.completed,2);assert.deepEqual(view.pendingPlayers.map(p=>p.seat),[3,4,5,6]);
    assert.deepEqual(view.ballot,{mvp:2,svp:5});
    for(const uid of ['wx:2','guest:observer'])assert.equal(honors.view(s,s.get(r.code),uid).pendingPlayers,undefined);
    const room=s.get(r.code);room.host='wx:3';s.transaction(()=>s.save(room));
    assert.equal(honors.view(s,s.get(r.code),'wx:1').pendingPlayers,undefined);
    assert.deepEqual(honors.view(s,s.get(r.code),'wx:3').pendingPlayers.map(p=>p.seat),[3,4,5,6]);
    assert.equal(honors.view(s,s.get(r.code),'wx:3').ballot,null);
    assert(!JSON.stringify(honors.view(s,s.get(r.code),'wx:3')).includes('wx:'));
  } finally{s.close();}
});
test('early host settlement requires half; changing the winner invalidates awards',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s);act(s,r,r.host,'honorStart');[1,3,4].forEach(i=>vote(s,r,i));
    assert.throws(()=>act(s,r,'wx:2','honorClose'),/房主/);
    act(s,r,r.host,'honorClose');assert.equal(s.funFor('wx:2').metrics.find(p=>p.id==='honor_mvp').count,1);
    s.transaction(()=>s.correctFunMatch(r.matchRecord.id,{revision:0,funReason:'quest_fail'}));
    assert.equal(honors.view(s,s.get(r.code),'wx:1').status,'invalidated');
    assert(!s.funFor('wx:2').metrics.some(p=>p.id==='honor_mvp'));
  } finally {s.close();}
});
module.exports={fixture};
test('single winner skips their own MVP slot; nonparticipants cannot vote',()=>{
  const s=new Store(':memory:');
  try {
    const r=fixture(s),id=r.matchRecord.id;
    s.transaction(()=>{
      const match=JSON.parse(s.db.prepare('SELECT snapshot FROM matches WHERE id=?').get(id).snapshot);
      match.winner='third';s.db.prepare('UPDATE matches SET snapshot=? WHERE id=?').run(JSON.stringify(match),id);
      const players=s.matchParticipants(match);
      for(const p of players){p.outcome=p.seat===1?'win':'loss';p.faction=p.seat===1?'third':'evil';}
      s.rebuildFun(match,players);s.syncScoreRooms();
    });
    act(s,r,r.host,'honorStart');
    const v=honors.view(s,s.get(r.code),'wx:1');assert.equal(v.groups[0].skip,true);
    assert.throws(()=>act(s,r,'guest:observer','honorVote',{mvp:1,svp:2}),/参赛/);
    assert.throws(()=>act(s,r,'test:1','honorVote',{mvp:1,svp:2}),/参赛/);
    act(s,r,'wx:1','honorVote',{mvp:null,svp:2});
    for(let i=2;i<=6;i++)act(s,r,'wx:'+i,'honorVote',{mvp:1,svp:i===2?3:2});
    assert.deepEqual(honors.view(s,s.get(r.code),'wx:6').mvp.map(p=>[p.seat,p.votes]),[[1,5]]);
  } finally{s.close();}
});

test('one human and five companions can vote; companion winners never create personal stats or rankings',()=>{
  const s=new Store(':memory:');
  try {
    const uids=['wx:1',...Array.from({length:5},(_,i)=>'test:123456:owner:'+(i+2))];
    const r=fixture(s,uids),id=r.matchRecord.id;
    assert.equal(honors.view(s,s.get(r.code),r.host).canStart,true);
    act(s,r,r.host,'honorStart');
    const bot=honors.view(s,s.get(r.code),uids[1]);
    assert.equal(bot.canVote,true);assert.equal(bot.total,6);assert.equal(bot.required,3);
    assert.equal(bot.groups[0].players.find(p=>p.seat===2).disabled,true);
    assert.deepEqual(bot.groups[1].players.map(p=>p.seat),[5,6]);
    assert.throws(()=>act(s,r,uids[1],'honorVote',{mvp:2,svp:5}),/不能投自己/);
    for(let i=0;i<6;i++)act(s,r,uids[i],'honorVote',{mvp:i===1?3:2,svp:i===4?6:5});
    const result=honors.view(s,s.get(r.code),r.host);
    assert.equal(result.status,'settled');assert.deepEqual(result.mvp.map(p=>[p.seat,p.votes]),[[2,5]]);
    assert.deepEqual(result.svp.map(p=>[p.seat,p.votes]),[[5,5]]);
    assert.equal(s.matchFor('wx:1',id).honorResult.mvp[0].name,'玩家2');
    for(const uid of uids.slice(1)) {
      assert.equal(s.statsFor(uid).total,0);assert.deepEqual(s.funFor(uid).metrics,[]);
      assert.equal(s.matchesFor(uid).total,0);
      for(const metric of ['mvp','svp']) {
        const rank=new Leaderboard(s).read(uid,new URLSearchParams('metric=fun_honor_'+metric));
        assert.equal(rank.me.status,'unsupported');assert.equal(rank.rows.length,0);
      }
    }
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM match_fun_stats WHERE uid LIKE 'test:%'").get().n,0);
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM match_players WHERE uid LIKE 'test:%'").get().n,0);
    assert.equal(s.funFor('wx:1').metrics.find(p=>p.id==='honor_mvp').count,0);
  } finally{s.close();}
});

test('微信玩家与陪测同桌获得 SVP，新规则加一分，旧规则不补发',()=>{
  for (const legacy of [false, true]) {
    const s=new Store(':memory:');
    try {
      const uids=['test:host','test:2','test:3','test:4','wx:svp','test:6'];
      const r=fixture(s,uids,{scoreEnabled:true,legacy});
      act(s,r,r.host,'honorStart');
      for(let i=0;i<uids.length;i++) act(s,r,uids[i],'honorVote',{mvp:i===0?2:1,svp:i===4?6:5});
      assert.equal(honors.view(s,s.get(r.code),'wx:svp').svp[0].seat,5);
      const score=s.matchFor('wx:svp',r.matchRecord.id).score;
      assert.equal(score.total,legacy?0:1);
      assert.equal(score.breakdown.some(row=>row.id==='honor_svp'),!legacy);
      assert.equal(s.playerScore('wx:svp').points,legacy?0:1);
    } finally { s.close(); }
  }
});

test('companion ballots can award a human and only that human receives an honor count',()=>{
  const s=new Store(':memory:');
  try {
    const uids=['wx:1',...Array.from({length:5},(_,i)=>'test:123456:owner:'+(i+2))];
    const r=fixture(s,uids);act(s,r,r.host,'honorStart');
    for(let i=0;i<6;i++)act(s,r,uids[i],'honorVote',{mvp:i===0?2:1,svp:i===4?6:5});
    assert.equal(s.funFor('wx:1').metrics.find(p=>p.id==='honor_mvp').count,1);
    const board=new Leaderboard(s).read('wx:1',new URLSearchParams('metric=fun_honor_mvp'));
    assert.equal(board.rows.length,1);assert.equal(board.rows[0].isSelf,true);assert.equal(board.rows[0].count,1);
    assert.equal(new Leaderboard(s).read('wx:1',new URLSearchParams('metric=fun_honor_svp')).rows.length,0);
  } finally{s.close();}
});

test('pure companion elections persist and settle without creating match archives or personal records',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadowtable-honors-companion-'));
  let now=Date.now(),s=new Store(path.join(dir,'test.sqlite'),{clock:()=>now});
  try {
    const uids=Array.from({length:6},(_,i)=>'test:123456:owner:'+(i+1));
    const r=fixture(s,uids);act(s,r,r.host,'honorStart');
    for(const i of [0,2,3])act(s,r,uids[i],'honorVote',{mvp:2,svp:5});
    s.close();s=new Store(path.join(dir,'test.sqlite'),{clock:()=>now});
    assert.equal(honors.view(s,s.get(r.code),uids[1]).completed,3);
    now+=7*24*60*60*1000;honors.settleOrphaned(s);
    assert.equal(honors.view(s,s.get(r.code),uids[1]).status,'open');
    act(s,r,r.host,'honorClose');
    const shown=honors.view(s,s.get(r.code),uids[1]);
    assert.equal(shown.status,'settled');assert.equal(shown.mvp[0].votes,3);assert.equal(shown.svp[0].votes,3);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM matches').get().n,0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM match_players').get().n,0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM match_fun_stats').get().n,0);
    const room=s.get(r.code);s.transaction(()=>{honors.closeForRoom(s,room);command(room,room.host,{type:'rematch',stage:room.stage});s.save(room);});
    assert.equal(honors.view(s,s.get(r.code),uids[1]),null);
    assert.throws(()=>act(s,r,uids[1],'honorVote',{mvp:3,svp:6}),/本局已变化/);
    // Management rematches can replace the room before orphan reconciliation.
    // The private poll must still settle using only its companion context.
    const next=fixture(s,uids);act(s,next,next.host,'honorStart');
    for(const i of [0,2,3])act(s,next,uids[i],'honorVote',{mvp:2,svp:5});
    const replaced=s.get(next.code);
    s.transaction(()=>{command(replaced,replaced.host,{type:'rematch',stage:replaced.stage});s.save(replaced);});
    honors.settleOrphaned(s);
    const poll=JSON.parse(s.db.prepare('SELECT state FROM honor_polls WHERE match_id=?').get(next.matchRecord.id).state);
    assert.equal(poll.status,'settled');assert.equal(poll.result.mvp[0].votes,3);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM matches').get().n,0);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM match_fun_stats').get().n,0);
    assert.equal(s.get(next.code).matchRecord,undefined);
  } finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('open polls and settled projections survive restart and excluded records leave rankings',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shadowtable-honors-'));let s=new Store(path.join(dir,'test.sqlite'));
  try {
    const r=fixture(s);act(s,r,r.host,'honorStart');vote(s,r,1);vote(s,r,3);s.close();
    s=new Store(path.join(dir,'test.sqlite'));vote(s,r,4);act(s,r,r.host,'honorClose');
    assert.equal(s.funFor('wx:2').metrics.find(p=>p.id==='honor_mvp').count,1);s.close();
    s=new Store(path.join(dir,'test.sqlite'));assert.equal(s.funFor('wx:2').metrics.find(p=>p.id==='honor_mvp').count,1);
    assert.equal(s.matchFor('wx:2',r.matchRecord.id).honorResult.mvp[0].votes,3);
    s.transaction(()=>{s.db.prepare("INSERT INTO match_controls(match_id,state,previous_state,reason,updated) VALUES(?,'excluded','active','作废',?)").run(r.matchRecord.id,Date.now());s.syncScoreRooms();s.invalidateLeaderboard();});
    assert.equal(honors.view(s,s.get(r.code),'wx:2'),null);
    assert(!s.funFor('wx:2').metrics.some(p=>p.id==='honor_mvp'));
    assert.equal(new Leaderboard(s).read('wx:2',new URLSearchParams('metric=fun_honor_mvp')).rows.length,0);
    assert.equal(s.matchFor('wx:2',r.matchRecord.id).honorResult,null);
  } finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('HTTP votes use idempotent receipts and private projections; stale match never affects rematch',async t=>{
  const {createHash,randomUUID}=require('node:crypto');const {createApp}=require('../server/app');
  const app=createApp({database:':memory:'});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.store.close();});
  const r=fixture(app.store),base='http://127.0.0.1:'+app.server.address().port;
  const tokens=Array.from({length:7},(_,i)=>String(i+1).repeat(64));
  tokens.forEach((token,i)=>app.store.addSession(createHash('sha256').update(token).digest('hex'),'wx:'+(i+1)));
  const req=async(i,data,id=randomUUID(),suffix='')=>{
    const response=await fetch(base+'/api/rooms/'+r.code+suffix,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+tokens[i-1],...(data?{'Content-Type':'application/json','Idempotency-Key':id}:{})},...(data?{body:JSON.stringify(data)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const post=(i,type,extra={},id)=>req(i,{type,stage:r.stage,matchId:r.matchRecord.id,...extra},id,'/commands');
  assert.equal((await post(2,'honorStart')).status,403);
  assert.equal((await post(1,'honorStart')).status,200);
  const id=randomUUID();assert.equal((await post(1,'honorVote',{mvp:2,svp:5},id)).status,200);
  assert.equal((await post(1,'honorVote',{mvp:2,svp:5},id)).status,200);
  assert.equal((await post(1,'honorVote',{mvp:3,svp:5},id)).status,409);
  const other=await req(2);assert.equal(other.body.honors.completed,1);assert.equal(other.body.honors.ballot,null);
  assert.equal(other.body.honors.pendingPlayers,undefined);
  assert.deepEqual((await req(1)).body.honors.pendingPlayers.map(p=>p.seat),[2,3,4,5,6]);
  assert.deepEqual((await req(1)).body.honors.ballot,{mvp:2,svp:5});
  assert.equal((await post(7,'honorVote',{mvp:2,svp:5})).status,403);
  for(const i of [3,4])assert.equal((await post(i,'honorVote',{mvp:2,svp:5})).status,200);
  assert.equal((await post(1,'honorClose')).status,200);
  for(let i=1;i<=6;i++){
    const shown=(await req(i)).body.honors;assert.equal(shown.mvp[0].votes,3);assert.equal(shown.svp[0].votes,3);assert(!JSON.stringify(shown).includes('wx:'));
  }
  assert.equal((await post(1,'rematch')).status,200);
  assert.equal((await post(2,'honorVote',{mvp:3,svp:6})).status,409);
  assert.equal((await req(1)).body.honors,null);
});
