'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../server/store');
const { saveProfile, readProfile } = require('../server/profile');
const { readBadges, saveBadge, equippedBadges } = require('../server/badges');
const { catalogue } = require('../miniprogram/badges');
const { createApp } = require('../server/app');
const NOW = Date.parse('2026-10-13T08:00:00Z');
const NEXT = Date.parse('2026-10-31T16:00:00Z');
function game(store, uid, { endedAt = store.clock(), win = true, points = 2 } = {}) {
  const id = randomUUID();
  store.transaction(() => store.archiveMatch({ id, board:'classic', boardName:'经典', capacity:6, endedAt,
    winner:'good', source:'manual', excludedReason:null,
    players:[{uid,name:'玩家',seat:1,role:'梅林',faction:'good',outcome:win?'win':'loss',score:{status:'scored',total:points,breakdown:[]}}] }));
  return id;
}
function metric(store, uid, id, count, opportunities = count) {
  const match = game(store, uid);
  store.db.prepare("INSERT INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)").run(match, uid, 'classic', id, 'merlin', '梅林', count, opportunities, 'known', store.clock());
  store.invalidateLeaderboard();
}
const ids = (store, uid) => readBadges(store, uid).badges.map(b => b.id);
function wear(store, uid, id, equipped) {
  const current = readBadges(store, uid);
  return store.transaction(() => saveBadge(store, uid, {id,equipped,version:current.version,periodStart:current.periodStart}));
}
test('17 枚徽章涵盖全部趣味称号与三种常规榜，零数据不颁发', () => {
  const store = new Store(':memory:',{clock:()=>NOW});
  try {
    assert.equal(catalogue.length,17);assert.equal(new Set(catalogue.map(b=>b.id)).size,17);
    for (const id of Object.keys(require('../miniprogram/fun-copy').honors)) assert.ok(catalogue.some(b=>b.id===id));
    for(const uid of ['wx:new','dev:new','guest:new','test:new'])assert.deepEqual(ids(store,uid),[]);
  } finally {store.close();}
});
test('北京时间月榜独立于总榜，并列榜首全员获授，新月撤销且默认重新佩戴', () => {
  let now = NOW;const store=new Store(':memory:',{clock:()=>now});
  try {
    for(let i=0;i<8;i++)game(store,'wx:old',{endedAt:Date.parse('2026-09-30T15:59:59Z')});
    game(store,'wx:a');game(store,'wx:b');
    assert.deepEqual(ids(store,'wx:old'),[]);
    for(const uid of ['wx:a','wx:b'])assert.deepEqual(ids(store,uid),['points','games','overall']);
    wear(store,'wx:a','games',false);
    assert.equal(equippedBadges(store,'wx:a').some(b=>b.id==='games'),false);
    now=NEXT;assert.deepEqual(ids(store,'wx:a'),[]);
    game(store,'wx:a');assert.ok(readBadges(store,'wx:a').badges.every(b=>b.equipped));
  } finally {store.close();}
});
test('趣味次数榜以完整快照颁发，超过100名的并列第一不遗漏，比例第一不会误获次数徽章', () => {
  const store=new Store(':memory:',{clock:()=>NOW});
  try {
    for(let i=0;i<105;i++)metric(store,'wx:tie'+i,'merlin_evade',2,5);
    metric(store,'wx:rate','merlin_evade',1,1);
    for(let i=0;i<105;i++)assert.ok(ids(store,'wx:tie'+i).includes('merlin_evade'));
    assert.equal(ids(store,'wx:rate').includes('merlin_evade'),false);
    metric(store,'wx:zero','assassin_hit',0,1);assert.equal(ids(store,'wx:zero').includes('assassin_hit'),false);
    metric(store,'wx:champion','merlin_evade',3,7);
    assert.equal(ids(store,'wx:tie104').includes('merlin_evade'),false);
    assert.ok(ids(store,'wx:champion').includes('merlin_evade'));
  } finally {store.close();}
});
test('胜率使用真实比例与局数规则；公开设置和删除对局立即更新资格', () => {
  const store=new Store(':memory:',{clock:()=>NOW});
  try {
    game(store,'wx:a');const extra=game(store,'wx:a');game(store,'wx:b');
    assert.ok(ids(store,'wx:a').includes('overall'));assert.equal(ids(store,'wx:b').includes('overall'),false);
    const before=readProfile(store,'wx:a');saveProfile(store,'wx:a',{nickname:'甲',version:before.version,leaderboardVisible:false});
    assert.deepEqual(ids(store,'wx:a'),[]);assert.ok(ids(store,'wx:b').includes('overall'));
    saveProfile(store,'wx:a',{nickname:'甲',version:before.version+1,leaderboardVisible:true});
    // Use the actual management removal path and its cache invalidation.
    store.transaction(()=>store.manageMatches({action:'exclude',matches:[{id:extra,revision:0}],reason:'测试撤销'}));
    assert.ok(ids(store,'wx:b').includes('overall'));
  } finally {store.close();}
});
test('摘戴持久化、版本冲突、跨月旧提交、伪造所有权和事务回滚', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadow-badges-'));let now=NOW;
  let store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
  try {
    game(store,'wx:a');const before=readBadges(store,'wx:a');
    wear(store,'wx:a','points',false);
    assert.throws(()=>store.transaction(()=>saveBadge(store,'wx:a',{id:'games',equipped:false,version:before.version,periodStart:before.periodStart})),e=>e.status===409);
    assert.throws(()=>wear(store,'wx:a','merlin_hit',true),e=>e.status===409);
    const old=readBadges(store,'wx:a');
    assert.throws(()=>store.transaction(()=>{saveBadge(store,'wx:a',{id:'games',equipped:false,version:old.version,periodStart:old.periodStart});throw Error('rollback');}),/rollback/);
    assert.equal(readBadges(store,'wx:a').version,old.version);
    store.close();store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
    assert.equal(readBadges(store,'wx:a').badges.find(b=>b.id==='points').equipped,false);
    now=NEXT;game(store,'wx:a');
    assert.throws(()=>store.transaction(()=>saveBadge(store,'wx:a',{id:'points',equipped:false,version:old.version,periodStart:old.periodStart})),e=>e.status===409);
    assert.throws(()=>wear(store,'wx:a','points','false'),e=>e.status===400);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('徽章 API 鉴权、仅本人修改、幂等回执与公开战绩卡只显示已佩戴徽章', async () => {
  const app=createApp({database:':memory:',clock:()=>NOW});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port,token='a'.repeat(64);
  app.store.addSession(createHash('sha256').update(token).digest('hex'),'wx:a');game(app.store,'wx:a');
  async function req(path,body,id=randomUUID(),auth=true) {
    const res=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json','Idempotency-Key':id},body:body?JSON.stringify(body):undefined});
    return {status:res.status,cache:res.headers.get('cache-control'),data:await res.json()};
  }
  try {
    assert.equal((await req('/api/me/badges',null,null,false)).status,401);
    const before=await req('/api/me/badges');assert.equal(before.cache,'no-store');
    const body={id:'points',equipped:false,version:before.data.version,periodStart:before.data.periodStart},key=randomUUID();
    const saved=await req('/api/me/badges',body,key);assert.equal(saved.status,200);
    assert.equal((await req('/api/me/badges',body,key)).data.version,saved.data.version);
    assert.equal((await req('/api/me/badges',{...body,equipped:true},key)).status,409);
    assert.equal((await req('/api/me/badges',{...body,uid:'wx:other'})).status,400);
    const publicId=app.store.db.prepare('SELECT public_id FROM profiles WHERE uid=?').get('wx:a').public_id;
    const card=await req('/api/leaderboard/players/'+publicId+'/stats');
    assert.equal(card.status,200);assert.deepEqual(card.data.player.badges.map(b=>b.id),['games','overall']);
    assert.doesNotMatch(JSON.stringify(card.data),/wx:a|badge_preferences|period_start/);
  } finally {await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});

test('小程序战绩卡适配徽章图片，说明按需打开，关闭后不残留其他玩家徽章', async () => {
  const {initialPlayerCardData,playerCardMethods}=require('../miniprogram/player-card');
  const badge=catalogue.find(b=>b.id==='merlin_hit');
  const p={alive:true,data:{...initialPlayerCardData},setData(value){Object.assign(this.data,value);},
    ...playerCardMethods({assetUrl:path=>'https://test.invalid'+path,request:async()=>({player:{id:'one',name:'甲',badges:[badge]},status:'available',stats:{total:1,wins:1,winRate:100,scoreTotal:1,byFaction:[]}})})};
  await p.loadPlayerCard({id:'one',scope:'leaderboard'},'/card');
  assert.equal(p.data.playerCard.badges[0].imageUrl,badge.imageUrl);
  assert.equal(p.data.playerCardBadge,null);
  p.showPlayerCardBadge({currentTarget:{dataset:{id:badge.id}}});assert.equal(p.data.playerCardBadge.title,'舍我其谁');
  p.closePlayerCard();assert.equal(p.data.playerCardBadge,null);assert.equal(p.data.playerCard,null);
});

test('最多默认佩戴3枚，拒绝第四枚；摘下不自动补位，自选徽章持久保存并在新月重置', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadow-badge-cap-'));let now=NOW;
  let store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
  try {
    metric(store,'wx:a','merlin_evade',1);metric(store,'wx:a','assassin_hit',1);
    const before=readBadges(store,'wx:a');
    assert.equal(before.badges.length,5);assert.equal(before.equippedCount,3);assert.equal(before.maxEquipped,3);
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),['points','games','overall']);
    assert.throws(()=>wear(store,'wx:a','assassin_hit',true),e=>e.status===400&&/最多佩戴3枚/.test(e.message));
    assert.deepEqual(readBadges(store,'wx:a'),before);
    const removed=wear(store,'wx:a','points',false);assert.equal(removed.equippedCount,2);
    wear(store,'wx:a','assassin_hit',true);
    const selected=['games','overall','assassin_hit'];
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),selected);
    store.close();store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),selected);
    metric(store,'wx:a','merlin_hit',1);
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),selected);
    now=NEXT;metric(store,'wx:a','merlin_evade',1);metric(store,'wx:a','assassin_hit',1);
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),['points','games','overall']);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('兼容旧版超过3枚的佩戴偏好，手动摘下后不会被旧偏好补位', () => {
  const store=new Store(':memory:',{clock:()=>NOW});
  try {
    metric(store,'wx:a','merlin_evade',1);metric(store,'wx:a','assassin_hit',1);
    const current=readBadges(store,'wx:a');
    for(const b of current.badges)store.db.prepare('INSERT INTO badge_preferences VALUES(?,?,?,1)').run('wx:a',b.id,current.periodStart);
    assert.equal(equippedBadges(store,'wx:a').length,3);
    wear(store,'wx:a','points',false);
    assert.equal(equippedBadges(store,'wx:a').length,2);
    wear(store,'wx:a','assassin_hit',true);
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),['games','overall','assassin_hit']);
  } finally {store.close();}
});

test('小程序达到3枚时阻止额外佩戴请求，仍可摘下', async () => {
  const api=require('../miniprogram/api'),request=api.request,requestId=api.requestId;
  let calls=0;
  api.request=async()=>{calls++;return {badges:catalogue.slice(0,4).map(b=>({...b,equipped:false})),version:1};};api.requestId=()=>randomUUID();
  const {initialBadgeManager,badgeManagerMethods}=require('../miniprogram/badge-manager');
  const p={alive:true,data:{...initialBadgeManager,badgeCollection:{badges:catalogue.slice(0,4).map((b,i)=>({...b,equipped:i<3})),version:0,periodStart:1}},setData(v){Object.assign(this.data,v);},...badgeManagerMethods()};
  try {
    await p.toggleOwnedBadge({currentTarget:{dataset:{id:catalogue[3].id}}});
    assert.equal(calls,0);assert.match(p.data.badgeManagerError,/最多佩戴3枚/);
    await p.toggleOwnedBadge({currentTarget:{dataset:{id:catalogue[0].id}}});assert.equal(calls,1);
    assert.equal(p.data.badgeCollection.equippedCount,0);
  } finally {api.request=request;api.requestId=requestId;}
});
