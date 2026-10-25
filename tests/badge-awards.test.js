'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const vm = require('node:vm');
const { Store } = require('../server/store');
const awards = require('../server/badge-awards');
const { readBadges, saveBadge } = require('../server/badges');
const { readProfile, saveProfile } = require('../server/profile');
const presentation = require('../miniprogram/badge-awards');
const NOW = Date.parse('2026-10-25T08:00:00Z');
const ids = (s, uid) => readBadges(s, uid).badges.filter(b=>b.permanent).map(b=>b.id);
function game(s, uid, { points = 0, scored = true, endedAt = s.clock(), testGame = false, winner = 'good' } = {}) {
  const id = randomUUID();
  s.archiveMatch({ id, board:'classic', boardName:'经典', capacity:6, endedAt, winner, source:'manual',
    ...(testGame ? {recordPurpose:'test'} : {}), players:[{ uid,name:uid,seat:1,role:'梅林',faction:'good',outcome:winner?'win':'excluded',
      ...(scored ? {score:{status:'scored',total:points,breakdown:[]}} : {}) }] });
  return id;
}
function hidden(s, uid) { const p=readProfile(s,uid);saveProfile(s,uid,{nickname:'隐藏玩家',version:p.version,leaderboardVisible:false}); }
test('发布冻结公开积分前三，含并列；后续得分、隐藏及重启不会重新评奖', () => {
  const dir=mkdtempSync(join(tmpdir(),'october-awards-'));let now=NOW;let s=new Store(join(dir,'db'),{clock:()=>now});
  try {
    game(s,'wx:first',{points:9});game(s,'wx:second',{points:6});game(s,'wx:second-tie',{points:6});
    game(s,'wx:fourth',{points:1});game(s,'wx:hidden',{points:99});hidden(s,'wx:hidden');
    assert.deepEqual(ids(s,'wx:first'),[]);
    awards.activate(s);
    assert.ok(ids(s,'wx:first').includes('october_2026_crown'));
    for(const u of ['wx:second','wx:second-tie'])assert.ok(ids(s,u).includes('october_2026_silver'));
    assert.equal(s.db.prepare("SELECT count(*) n FROM badge_awards WHERE badge_id='october_2026_stag'").get().n,0);
    assert.ok(!ids(s,'wx:hidden').some(id=>id.endsWith('crown')));
    const frozen=s.db.prepare('SELECT ranking_snapshot FROM badge_campaigns').get().ranking_snapshot;
    game(s,'wx:fourth',{points:500});hidden(s,'wx:first');
    awards.activate(s);s.close();now=awards.END+86400000;s=new Store(join(dir,'db'),{clock:()=>now});awards.activate(s);
    assert.equal(s.db.prepare('SELECT ranking_snapshot FROM badge_campaigns').get().ranking_snapshot,frozen);
    assert.ok(ids(s,'wx:first').includes('october_2026_crown'));
    assert.ok(!ids(s,'wx:fourth').includes('october_2026_crown'));
  } finally {s.close();rmSync(dir,{recursive:true,force:true});}
});
test('三种名次对应正确；不计分、零分、隐藏玩家及游客的参与纪念各按资格授予', () => {
  const s=new Store(':memory:',{clock:()=>NOW});
  try {
    for(const [i,p]of[9,6,3].entries())game(s,'wx:rank'+i,{points:p});
    game(s,'wx:unscored',{scored:false});game(s,'wx:zero');game(s,'guest:one',{scored:false});
    game(s,'wx:hidden',{scored:false});hidden(s,'wx:hidden');
    awards.activate(s);
    for(const[i,name]of['crown','silver','stag'].entries())assert.ok(ids(s,'wx:rank'+i).includes('october_2026_'+name));
    for(const u of ['wx:unscored','guest:one','wx:hidden'])assert.deepEqual(ids(s,u),['october_2026_table']);
    assert.deepEqual(ids(s,'wx:zero'),['october_2026_table','october_2026_book']);
    assert.deepEqual(ids(s,'wx:none'),[]);
  } finally {s.close();}
});
test('按北京时间10月归属，不纳入九月、十一月、测试及被管理员排除/删除的对局', () => {
  const s=new Store(':memory:',{clock:()=>awards.END+1000});
  try {
    game(s,'wx:sep',{endedAt:awards.START-1});game(s,'wx:start',{endedAt:awards.START});
    game(s,'wx:end',{endedAt:awards.END-1});game(s,'wx:nov',{endedAt:awards.END});
    game(s,'wx:test',{endedAt:NOW,testGame:true});game(s,'test:companion',{endedAt:NOW});
    const excluded=game(s,'wx:excluded',{endedAt:NOW}),deleted=game(s,'wx:deleted',{endedAt:NOW});
    for(const[id,state]of[[excluded,'excluded'],[deleted,'deleted']])s.db.prepare('INSERT INTO match_controls(match_id,state,updated) VALUES(?,?,?)').run(id,state,NOW);
    awards.activate(s);
    for(const u of ['wx:start','wx:end'])assert.ok(ids(s,u).includes('october_2026_book'));
    for(const u of ['wx:sep','wx:nov','wx:test','test:companion','wx:excluded','wx:deleted','wx:spectator'])assert.deepEqual(ids(s,u),[]);
  } finally {s.close();}
});
test('新参与者自动补发；已确认的通知不会吞掉并发新增徽章；通知和确认严格隔离账号', () => {
  const s=new Store(':memory:',{clock:()=>NOW});
  try {
    awards.activate(s);game(s,'wx:late',{scored:false});
    const first=awards.notice(s,'wx:late').notice;assert.equal(first.badges.length,1);
    game(s,'wx:late',{scored:true});
    awards.acknowledge(s,'wx:late',{through:first.through});
    assert.deepEqual(awards.notice(s,'wx:late').notice.badges.map(b=>b.id),['october_2026_book']);
    assert.throws(()=>awards.acknowledge(s,'wx:other',{through:first.through}),e=>e.status===400);
    const next=awards.notice(s,'wx:late').notice;awards.acknowledge(s,'wx:late',{through:next.through});
    awards.acknowledge(s,'wx:late',{through:next.through});assert.equal(awards.notice(s,'wx:late').notice,null);
    const n=s.db.prepare('SELECT count(*) n FROM badge_awards').get().n;awards.activate(s);assert.equal(s.db.prepare('SELECT count(*) n FROM badge_awards').get().n,n);
    assert.throws(()=>awards.acknowledge(s,'wx:late',{through:999999}),e=>e.status===400);
    assert.doesNotMatch(JSON.stringify(next),/wx:late|ranking_snapshot|points_at_grant/);
  } finally {s.close();}
});
test('永久徽章佩戴偏好跨月保留，仍执行三枚上限，授予事务失败全部回滚', () => {
  let now=NOW;const s=new Store(':memory:',{clock:()=>now});
  try {
    game(s,'wx:a');assert.throws(()=>s.transaction(()=>{awards.activate(s);throw Error('rollback')}),/rollback/);
    assert.equal(s.db.prepare('SELECT count(*) n FROM badge_campaigns').get().n,0);assert.deepEqual(ids(s,'wx:a'),[]);
    awards.activate(s);
    const set=(id,equipped)=>{const c=readBadges(s,'wx:a');return s.transaction(()=>saveBadge(s,'wx:a',{id,equipped,version:c.version,periodStart:c.periodStart}));};
    for(const b of readBadges(s,'wx:a').badges.filter(b=>b.equipped))set(b.id,false);
    set('october_2026_book',true);now=awards.END+1;
    assert.deepEqual(readBadges(s,'wx:a').badges.filter(b=>b.equipped).map(b=>b.id),['october_2026_book']);
    set('october_2026_table',true);set('october_2026_crown',true);
    assert.equal(readBadges(s,'wx:a').equippedCount,3);
  } finally {s.close();}
});
test('徽章通知 HTTP 鉴权、幂等确认与禁止伪造佩戴，静态资源两端共用', async () => {
  const app=require('../server/app').createApp({database:':memory:',clock:()=>NOW,webOrigin:'http://127.0.0.1'});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const token='a'.repeat(64),base='http://127.0.0.1:'+app.server.address().port;
  app.store.addSession(createHash('sha256').update(token).digest('hex'),'wx:a');game(app.store,'wx:a');awards.activate(app.store);
  const req=(path,body,auth=true)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',Host:'127.0.0.1'},...(body?{body:JSON.stringify(body)}:{})});
  try {
    assert.equal((await req('/api/me/badges/notice',null,false)).status,401);
    const res=await req('/api/me/badges/notice'),value=await res.json();assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(value.notice.badges.length,3);
    assert.equal((await req('/api/me/badges/notice',{through:value.notice.through})).status,200);
    assert.equal((await req('/api/me/badges/notice',{through:value.notice.through})).status,200);
    assert.equal((await(await req('/api/me/badges/notice')).json()).notice,null);
    assert.equal((await req('/api/me/badges/notice',{through:value.notice.through,uid:'wx:other'})).status,400);
    for(const p of ['/badge-awards.js','/badge-awards.css','/assets/badges/october_2026_crown.png','/assets/badges/october_2026_book-large.png'])assert.equal((await req(p)).status,200,p);
  } finally {await new Promise(r=>app.server.close(r));app.store.close();}
});
test('前台通知合并为3/2/1枚；确认断网只重试确认，后台与换号不误确认', async () => {
  const defs=require('../miniprogram/badges').catalogue.filter(b=>b.permanent),rank=defs.find(b=>b.rank===1),table=defs.find(b=>b.id.endsWith('table')),book=defs.find(b=>b.id.endsWith('book'));
  for(const badges of [[rank,table,book],[table,book],[table]]) {
    const p=presentation.present({badges});assert.equal(p.count,badges.length);
    assert.equal(p.ranked,badges.length===3);assert.equal(p.secondary.length,badges.length===1?0:2);
  }
  let account='one',shown=0,acked=0,fail=true,unread=true;
  const n=presentation.createNotifier({account:()=>account,canShow:()=>true,read:async()=>({notice:unread?{badges:[table],through:1}:null}),show:async value=>{shown++;assert.equal(value.hero.title,'共建圆桌');return true},ack:async()=>{if(fail){fail=false;throw Error('offline')}acked++;unread=false},setTimeout:()=>1,clearTimeout(){}});
  await n.start();assert.equal(shown,1);assert.equal(acked,0);await n.check();assert.equal(acked,1);n.stop();
  let finish;const next=presentation.createNotifier({account:()=>account,canShow:()=>true,read:async()=>({notice:{badges:[book],through:2}}),show:()=>new Promise(r=>finish=r),ack:async()=>acked++,setTimeout:()=>1,clearTimeout(){}});
  const pending=next.start();await Promise.resolve();account='two';finish(true);await pending;assert.equal(acked,1);next.stop();
});

test('小程序只在首页/我的安全时提醒；临时离开不会读掉通知，服务端图片使用同源地址', async () => {
  let options, shown, resolveDialog;
  const data={loading:false},controller={alive:true,foreground:true,data};
  const shared={currentDialog:null,dialogQueue:[],data:{dialog:{id:1}},finish(confirm){resolveDialog({confirm});}};
  const host={route:'pages/lobby/lobby',foreground:true,selectComponent:()=>shared};
  const module={exports:{}};
  vm.runInNewContext(readFileSync(require.resolve('../miniprogram/badge-notices'),'utf8'),{
    module,wx:{getStorageSync:()=> 'one',navigateTo(){}},require:name=>name==='./api'?{assetUrl:p=>'https://test.invalid'+p,request(){}}
      :name==='./dialog'?{show:value=>{shown=value;shared.currentDialog={options:value};return new Promise(r=>resolveDialog=r);}}
      :name==='./avoidance-notices'?{surface:()=>({host,controller,data})}
      :{createNotifier:value=>{options=value;return {start(){},check(){},stop(){}};}},
  });
  const notifier=module.exports.create();assert.equal(options.canShow(),true);
  for(const route of ['pages/table/table','pages/profile/profile','pages/stats/stats']){host.route=route;assert.equal(options.canShow(),false);}
  host.route='pages/me/me';assert.equal(options.canShow(),true);
  for(const key of ['loading','monthlyReset','playerCard','entrySheet']){data[key]={};assert.equal(options.canShow(),false);delete data[key];}
  const b=require('../miniprogram/badges').catalogue.find(b=>b.id==='october_2026_book');
  const pending=options.show(presentation.present({badges:[b]}));
  assert.equal(shown.awards.hero.imageUrl,'https://test.invalid'+b.imageUrl);
  assert.equal(shown.awards.badges[0].largeImageUrl,'https://test.invalid'+b.largeImageUrl);
  notifier.stop();assert.equal(await pending,false);notifier.stop();
});
