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
const { catalogue, presentCollection } = require('../miniprogram/badges');
const { honors, roleRecords } = require('../miniprogram/fun-copy');
const sharp = require('sharp');
const roleIds = Object.keys(roleRecords);
const { createApp } = require('../server/app');
const NOW = Date.parse('2026-10-13T08:00:00Z');
const NEXT = Date.parse('2026-10-31T16:00:00Z');
function game(store, uid, { endedAt = store.clock(), win = true, points = 2 } = {}) {
  const id = randomUUID();
  store.transaction(() => store.archiveMatch({ id, board:'classic', boardName:'经典', capacity:9, endedAt,
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
function grantFixtureAward(store, uid, id) {
  store.db.prepare('INSERT INTO badge_awards(uid,badge_id,campaign,granted_at) VALUES(?,?,?,?)').run(uid,id,'fixture',store.clock());
  store.badgeRanks.record(uid,id);
}
function wear(store, uid, id, equipped) {
  const current = readBadges(store, uid);
  return store.transaction(() => saveBadge(store, uid, {id,equipped,version:current.version,periodStart:current.periodStart}));
}
test('旧版 55 枚徽章逐枚对应荣誉或趣味分类，已获得的积分月榜名次章归荣誉', () => {
  const expected = {
    '荣誉徽章': '加冕圣剑 银盔骑士 林间守望 积分王者 常胜将军 躺赢大师 定蓝机 双炸艺术家 最强派西 孤注一掷 化身梅派 闪身步大神 隐身乘客 幕后军师 金牌乘客 首席护卫 最佳新援 职业刺客 梅林二号 倒钩王者 深藏不露 影帝大莫 最后王牌 最强独狼 孤儿狼 双面骑士 浪子回头 反水大师 金牌替身 绝对防御 职业杀手 最强MVP',
    '趣味徽章': '共建圆桌 内测纪念册 竭尽全力 舍我其谁 与世无争 牌桌常青树 压错宝 弹射下车 圆桌劳模 站错队 背锅侠 勇敢炮灰 新手演员 车底大莫 队友勿cue 双面间谍 阵营摇摆王 卧龙凤雏 痛击队友 我在阿瓦隆玩重生 全民公敌 最强SVP 共建者',
  };
  for (const [category, titles] of Object.entries(expected)) {
    const { visibleBadges } = presentCollection({ badges: [] }, 'all', undefined, category);
    assert.deepEqual(visibleBadges.filter(b => !b.achievement).map(b => b.title.replace(/\s/g, '')).sort(), titles.split(' ').sort());
  }
  const id = 'monthly_points_2026-11_2';
  const value = { badges: [{ id }, { id: 'feedback_contributor', equipped: true }] };
  const honor = presentCollection(value, 'owned', undefined, '荣誉徽章');
  assert.deepEqual(honor.visibleBadges.map(b => b.id), [id]);
  assert.equal(honor.ownershipFilters.find(f => f.id === 'owned').count, 1);
  assert.equal(honor.slots[0].id, 'feedback_contributor');
});
test('87 枚固定徽章涵盖 78 枚月度及 9 枚永久荣誉，零数据不颁发', () => {
  const store = new Store(':memory:',{clock:()=>NOW});
  try {
    assert.equal(catalogue.length,87);assert.equal(new Set(catalogue.map(b=>b.id)).size,87);
    assert.equal(catalogue.filter(b=>b.permanent).length,9);
    for (const id of [...Object.keys(honors), ...roleIds]) assert.ok(catalogue.some(b=>b.id===id));
    for(const uid of ['wx:new','dev:new','guest:new','test:new'])assert.deepEqual(ids(store,uid),[]);
  } finally {store.close();}
});
test('角色徽章只取本月公开达成次数榜，支持并列、佩戴和跨月切换', () => {
  let now = Date.parse('2026-09-30T15:59:59Z');
  const store = new Store(':memory:', { clock: () => now });
  try {
    for (const id of roleIds) for (let i = 0; i < 3; i++) metric(store, 'wx:previous', id, 1, 0);
    now = NOW;
    for (const id of roleIds) {
      for (const uid of ['wx:tie-a', 'dev:tie-b', 'wx:hidden']) {
        metric(store, uid, id, 1, 0);
        metric(store, uid, id, 1, 0);
      }
      metric(store, 'wx:hidden', id, 1, 0);
      metric(store, 'wx:runner-up', id, 1, 0);
      metric(store, 'wx:zero', id, 0, 0);
    }
    const profile = readProfile(store, 'wx:hidden');
    saveProfile(store, 'wx:hidden', { nickname: '隐藏玩家', version: profile.version, leaderboardVisible: false });
    for (const uid of ['wx:tie-a', 'dev:tie-b']) {
      const value = readBadges(store, uid);
      const collection = presentCollection(value, 'owned', path => 'https://test.invalid' + path);
      for (const id of roleIds) {
        const badge = collection.visibleBadges.find(item => item.id === id);
        assert.equal(badge.title, roleRecords[id].title);
        assert.equal(badge.kindLabel, '月榜');
        assert.equal(badge.imageUrl, 'https://test.invalid/assets/badges/' + id + '.png');
        assert.match(badge.detailCondition, /达成次数榜第一（含并列）/);
        assert.equal(badge.detailNote, roleRecords[id].description);
      }
    }
    for (const uid of ['wx:previous', 'wx:runner-up', 'wx:zero', 'wx:hidden'])
      assert.ok(ids(store, uid).every(id => !roleIds.includes(id)));
    for (const badge of equippedBadges(store, 'wx:tie-a')) wear(store, 'wx:tie-a', badge.id, false);
    wear(store, 'wx:tie-a', 'reverse_guard', true);
    wear(store, 'wx:tie-a', 'lancelot_double_agent', true);
    assert.deepEqual(equippedBadges(store, 'wx:tie-a').map(badge => badge.id), ['reverse_guard', 'lancelot_double_agent']);
    now = NEXT;
    assert.ok(ids(store, 'wx:tie-a').every(id => !roleIds.includes(id)));
  } finally { store.close(); }
});
test('金牌替身按本月公开挡刀次数颁发，并列持有、摘戴及跨月重算沿用现有体系', () => {
  let now=NOW;const store=new Store(':memory:',{clock:()=>now});
  try {
    metric(store,'wx:double-a','good_shield',3,6);
    metric(store,'wx:double-b','good_shield',3,8);
    metric(store,'wx:rate','good_shield',1,1);
    metric(store,'wx:zero','good_shield',0,3);
    metric(store,'wx:hidden','good_shield',9,9);
    const profile=readProfile(store,'wx:hidden');
    saveProfile(store,'wx:hidden',{nickname:'隐藏玩家',version:profile.version,leaderboardVisible:false});
    for(const uid of ['wx:double-a','wx:double-b']) {
      const badge=readBadges(store,uid).badges.find(b=>b.id==='good_shield');
      assert.equal(badge.title,'金牌替身');assert.equal(badge.metric,'fun_good_shield');
      assert.equal(badge.imageUrl,'/assets/badges/good_shield.png');
      assert.match(badge.description,/本月「金牌替身」次数榜第一/);
    }
    for(const uid of ['wx:rate','wx:zero','wx:hidden'])assert.ok(!ids(store,uid).includes('good_shield'));
    for(const badge of readBadges(store,'wx:double-a').badges.filter(b=>b.equipped))wear(store,'wx:double-a',badge.id,false);
    wear(store,'wx:double-a','good_shield',true);
    assert.deepEqual(equippedBadges(store,'wx:double-a').map(b=>b.id),['good_shield']);
    wear(store,'wx:double-a','good_shield',false);
    assert.deepEqual(equippedBadges(store,'wx:double-a'),[]);
    now=NEXT;assert.ok(!ids(store,'wx:double-a').includes('good_shield'));
  } finally {store.close();}
});
test('北京时间月榜独立于总榜，并列榜首全员获授，新月撤销且默认重新佩戴', () => {
  let now = NOW;const store=new Store(':memory:',{clock:()=>now});
  try {
    for(let i=0;i<8;i++)game(store,'wx:old',{endedAt:Date.parse('2026-09-30T15:59:59Z')});
    game(store,'wx:a');game(store,'wx:b');
    assert.deepEqual(ids(store,'wx:old'),['five_wins']);
    for(const uid of ['wx:a','wx:b'])assert.deepEqual(ids(store,uid),['points','games','overall']);
    wear(store,'wx:a','games',false);
    assert.equal(equippedBadges(store,'wx:a').some(b=>b.id==='games'),false);
    now=NEXT;assert.deepEqual(ids(store,'wx:a'),[]);
    game(store,'wx:a');assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),['points','games','overall']);
    assert.ok(ids(store,'wx:a').includes('attendance'));
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
    const homepage = await fetch(origin);
    assert.match(homepage.headers.get('content-type'), /^application\/json/);
    await homepage.arrayBuffer();
    const newArt = catalogue.filter(b => b.achievement).flatMap(b => b.metric === 'podium' ? [b.id, b.id+'-silver', b.id+'-bronze'] : [b.id]);
    await Promise.all([...roleIds, ...newArt, 'good_shield', 'honor_svp'].map(async id => {
      const image = await fetch(origin + '/assets/badges/' + id + '.png');
      assert.equal(image.status, 200, id);
      assert.equal(image.headers.get('content-type'), 'image/png', id);
      const { format, width, height, hasAlpha } = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
      assert.deepEqual({ format, width, height, hasAlpha }, { format: 'png', width: 192, height: 192, hasAlpha: true }, id);
    }));
  } finally {await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});

test('小程序战绩卡适配徽章图片，说明按需打开，关闭后不残留其他玩家徽章', async () => {
  const {initialPlayerCardData,playerCardMethods}=require('../miniprogram/player-card');
  const badge=catalogue.find(b=>b.id==='merlin_hit');
  const serverBadge=catalogue.find(b=>b.id==='merlin_all_rides');
  const oldBadge={...serverBadge,title:'灯下黑梅林',description:'本月「灯下黑梅林」达成次数榜第一。',imageUrl:'/ignored.png'};
  const p={alive:true,data:{...initialPlayerCardData},setData(value){Object.assign(this.data,value);},
    ...playerCardMethods({assetUrl:path=>'https://test.invalid'+path,request:async()=>({player:{id:'one',name:'甲',badges:[badge,oldBadge]},status:'available',stats:{total:1,wins:1,winRate:100,scoreTotal:1,byFaction:[]}})})};
  await p.loadPlayerCard({id:'one',scope:'leaderboard'},'/card');
  assert.equal(p.data.playerCard.badges[0].imageUrl,badge.imageUrl);
  assert.equal(p.data.playerCard.badges[1].imageUrl,'https://test.invalid'+serverBadge.imageUrl);
  assert.equal(p.data.playerCardBadge,null);
  p.showPlayerCardBadge({currentTarget:{dataset:{id:badge.id}}});assert.equal(p.data.playerCardBadge.title,'舍我其谁');
  p.showPlayerCardBadge({currentTarget:{dataset:{id:oldBadge.id}}});
  assert.equal(p.data.playerCardBadge.title,'隐身乘客');
  assert.equal(p.data.playerCardBadge.description,serverBadge.description);
  p.closePlayerCard();assert.equal(p.data.playerCardBadge,null);assert.equal(p.data.playerCard,null);
});

test('最多默认佩戴3枚，拒绝第四枚；摘下不自动补位，自选徽章持久保存并在新月重置', () => {
  const dir=mkdtempSync(join(tmpdir(),'shadow-badge-cap-'));let now=NOW;
  let store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
  try {
    metric(store,'wx:a','merlin_evade',1);metric(store,'wx:a','assassin_hit',1);
    const before=readBadges(store,'wx:a');
    assert.equal(before.badges.length,7);assert.equal(before.equippedCount,3);assert.equal(before.maxEquipped,3);
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),['points','games','overall']);
    assert.throws(()=>wear(store,'wx:a','assassin_hit',true),e=>e.status===400&&/最多佩戴3枚/.test(e.message));
    assert.deepEqual(readBadges(store,'wx:a'),before);
    const removed=wear(store,'wx:a','points',false);assert.equal(removed.equippedCount,2);
    wear(store,'wx:a','assassin_hit',true);
    const selected=['assassin_hit','games','overall'];
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
    assert.deepEqual(equippedBadges(store,'wx:a').map(b=>b.id),['assassin_hit','games','overall']);
  } finally {store.close();}
});

test('小程序达到3枚时阻止额外佩戴请求，仍可摘下', async () => {
  const api=require('../miniprogram/api'),request=api.request,requestId=api.requestId;
  let calls=0;
  api.request=async()=>{calls++;return {badges:catalogue.slice(0,4).map(b=>({...b,equipped:false})),version:1};};api.requestId=()=>randomUUID();
  const {initialBadgeManager,badgeManagerMethods}=require('../miniprogram/pages/badges/badge-manager');
  const p={alive:true,data:{...initialBadgeManager,badgeCollection:{badges:catalogue.slice(0,4).map((b,i)=>({...b,equipped:i<3})),version:0,periodStart:1}},setData(v){Object.assign(this.data,v);},...badgeManagerMethods()};
  try {
    await p.toggleOwnedBadge({currentTarget:{dataset:{id:catalogue[3].id}}});
    assert.equal(calls,0);assert.match(p.data.badgeManagerError,/最多佩戴3枚/);
    await p.toggleOwnedBadge({currentTarget:{dataset:{id:catalogue[0].id}}});assert.equal(calls,1);
    assert.equal(p.data.badgeCollection.equippedCount,0);
  } finally {api.request=request;api.requestId=requestId;}
});

test('空位保留且可指定佩戴位置，满额替换保留位置并校验冲突', () => {
  const store = new Store(':memory:', {clock:()=>NOW});
  try {
    metric(store, 'wx:a', 'merlin_evade', 1);
    wear(store, 'wx:a', 'games', false);
    let current = readBadges(store, 'wx:a');
    let collection = require('../miniprogram/badges').presentCollection(current);
    assert.deepEqual(collection.slots.map(b=>b.id), ['points','empty-1','overall']);
    const add = {id:'merlin_evade',equipped:true,slotIndex:1,version:current.version,periodStart:current.periodStart};
    store.transaction(()=>saveBadge(store, 'wx:a', add));
    assert.deepEqual(equippedBadges(store, 'wx:a').map(b=>b.id), ['points','merlin_evade','overall']);
    assert.throws(()=>store.transaction(()=>saveBadge(store, 'wx:a', add)), e=>e.status===409);
    current = readBadges(store, 'wx:a');
    const input = {id:'games',equipped:true,replaceId:'overall',version:current.version,periodStart:current.periodStart};
    store.transaction(()=>saveBadge(store, 'wx:a', input));
    collection = require('../miniprogram/badges').presentCollection(readBadges(store, 'wx:a'));
    assert.deepEqual(collection.slots.map(b=>b.id), ['points','merlin_evade','games']);
    assert.deepEqual(require('../miniprogram/badges').presentCollection(collection, 'owned').slots.map(b=>b.id), ['points','merlin_evade','games']);
    wear(store, 'wx:a', 'points', false);
    wear(store, 'wx:a', 'games', false);
    current = readBadges(store, 'wx:a');
    assert.deepEqual(require('../miniprogram/badges').presentCollection(current).slots.map(b=>b.id), ['empty-0','merlin_evade','empty-2']);
    store.transaction(()=>saveBadge(store, 'wx:a', {id:'points',equipped:true,slotIndex:2,version:current.version,periodStart:current.periodStart}));
    current = readBadges(store, 'wx:a');
    assert.deepEqual(require('../miniprogram/badges').presentCollection(current).slots.map(b=>b.id), ['empty-0','merlin_evade','points']);
    assert.throws(()=>store.transaction(()=>saveBadge(store, 'wx:a', {id:'games',equipped:true,slotIndex:1,version:current.version,periodStart:current.periodStart})), e=>e.status===409);
    assert.deepEqual(equippedBadges(store, 'wx:a').map(b=>b.id), ['merlin_evade','points']);
  } finally { store.close(); }
});

test('荣誉榜按当前持有计数，称号易主后重排名次，永久徽章和独立隐私设置跨月保留', () => {
  const dir=mkdtempSync(join(tmpdir(),'badge-rank-history-'));
  let now=NOW, store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
  const list=(kind,uid='wx:a')=>store.badgeRanks.list(uid,kind,new URLSearchParams());
  try {
    game(store,'wx:a');
    assert.deepEqual(store.badgeRanks.detail('wx:a','honor','self').badges.map(b=>b.id),['attendance','overall','points']);
    grantFixtureAward(store,'wx:a','october_2026_crown');
    game(store,'wx:b');
    const a=list('honor').me;
    assert.equal(a.count,3);
    assert.deepEqual(list('honor').rows.map(r=>r.rank),[1,2]);
    assert.equal(list('fun').me.count,1);
    assert.deepEqual(store.badgeRanks.detail('wx:b','honor',a.publicId).badges.map(b=>b.id),['october_2026_crown','overall','points']);
    game(store,'wx:b',{points:4});
    assert.equal(list('honor').me.rank,2);
    assert.equal(list('honor').me.count,1);
    assert.deepEqual(store.badgeRanks.detail('wx:b','honor',a.publicId).badges.map(b=>b.id),['october_2026_crown']);
    const profile=readProfile(store,'wx:a');
    saveProfile(store,'wx:a',{version:profile.version,nickname:'阿岚',leaderboardVisible:false});
    store.badgeRanks.setVisibility('wx:a','honor',{visible:false});
    const hidden=store.badgeRanks.detail('wx:b','honor',a.publicId);
    assert.deepEqual(hidden.badges,[]);
    assert.equal(hidden.player.nickname,'阿岚');
    assert.equal(hidden.player.count,1);
    assert.equal(hidden.visible,false);
    assert.doesNotMatch(JSON.stringify(hidden),/wx:a|points|overall/);
    assert.equal(store.badgeRanks.detail('wx:a','honor','self').badges.length,1);
    assert.equal(list('fun').me.rank,null);
    assert.throws(()=>store.badgeRanks.detail('wx:b','fun',a.publicId), e=>e.status===404);
    now=NEXT;
    assert.equal(list('honor').total,1);
    assert.equal(list('honor').me.rank,1);
    assert.equal(list('honor','wx:b').me.rank,null);
    assert.deepEqual(store.badgeRanks.detail('wx:b','honor','self').badges,[]);
    game(store,'wx:b');
    assert.equal(list('fun','wx:b').me.count,1);
    require('../server/badge-awards').grantContributor(store,'guest:newcomer');
    assert.equal(list('fun','guest:newcomer').me.count,1);
    assert.equal(list('honor','guest:newcomer').me.rank,null);
    assert.throws(()=>store.transaction(()=>{store.badgeRanks.record('wx:a','seven_victors'); throw Error('rollback');}),/rollback/);
    store.close(); store=new Store(join(dir,'db.sqlite'),{clock:()=>now});
    assert.equal(list('honor').me.publicId,a.publicId);
    assert.equal(list('honor').me.count,1);
    assert.equal(store.badgeRanks.detail('wx:b','honor',a.publicId).visible,false);
  } finally { store.close();rmSync(dir,{recursive:true,force:true}); }
});

test('徽章数量榜不截断百名后的并列玩家，分页变更需重读，月度纪念章逐月计入', () => {
  const store=new Store(':memory:',{clock:()=>NOW}), ranks=store.badgeRanks;
  try {
    store.transaction(()=>{
      for(let i=0;i<108;i++) grantFixtureAward(store,'guest:'+i,'october_2026_crown');
      grantFixtureAward(store,'guest:0','monthly_points_2026-11_1');
      grantFixtureAward(store,'guest:0','monthly_points_2026-12_1');
    });
    let page=ranks.list('guest:0','honor',new URLSearchParams());
    assert.equal(page.total,108); assert.equal(page.me.count,3);
    assert.deepEqual(page.rows.slice(0,3).map(r=>r.rank),[1,2,2]);
    const seen=[...page.rows];
    while(page.nextOffset!==null) {
      page=ranks.list('guest:0','honor',new URLSearchParams({offset:page.nextOffset,version:page.version}));
      seen.push(...page.rows);
    }
    assert.equal(new Set(seen.map(p=>p.publicId)).size,108);
    grantFixtureAward(store,'wx:b','october_2026_silver');
    assert.throws(()=>ranks.list('guest:0','honor',new URLSearchParams({offset:30,version:page.version})),e=>e.status===409);
  } finally { store.close(); }
});

test('快速切换榜单时忽略旧响应，默认荣誉榜且可独立读取趣味榜',async()=>{
  const pending=[];
  const view=require('../miniprogram/pages/badges/rank-controller').create({
    request:path=>new Promise(resolve=>pending.push({path,resolve})),update(){},
  });
  const honor=view.load();
  assert.equal(view.state.countLabel,'当前持有');
  const fun=view.select('fun');
  assert.equal(view.state.countLabel,'当前持有');
  assert.deepEqual(pending.map(r=>r.path),['/api/badge-ranks/honor','/api/badge-ranks/fun']);
  const empty={rows:[],me:{nickname:'我',count:0,rank:null},nextOffset:null,total:0};
  pending[1].resolve(empty); await fun;
  pending[0].resolve({...empty,total:5}); await honor;
  assert.equal(view.state.kind,'fun');assert.equal(view.state.board.total,0);
});

test('旧库重启后两榜保留永久奖章，忽略已经失效的历史称号和佩戴偏好',()=>{
  const dir=mkdtempSync(join(tmpdir(),'badge-rank-upgrade-')), file=join(dir,'db.sqlite');
  let store=new Store(file,{clock:()=>NEXT});
  try {
    store.db.prepare('INSERT INTO badge_preferences VALUES(?,?,?,?)').run('wx:past','games',NOW,0);
    store.db.prepare('INSERT INTO badge_preferences VALUES(?,?,?,?)').run('wx:past','points',NOW,1);
    store.db.exec(`CREATE TABLE badge_earned(uid TEXT,badge_id TEXT,category TEXT,best_rank INTEGER,PRIMARY KEY(uid,badge_id));
      INSERT INTO badge_earned VALUES('wx:past','assassin_miss','fun',NULL),('wx:past','rate_overall','honor',1);`);
    store.badgeRanks.setVisibility('wx:past','fun',{visible:false});
    store.db.prepare('INSERT INTO badge_awards(uid,badge_id,campaign,granted_at) VALUES(?,?,?,?)').run('guest:past','october_2026_book','2026-10-beta',NOW);
    grantFixtureAward(store,'wx:past','monthly_points_2026-11_1');
    store.close();store=new Store(file,{clock:()=>NEXT});
    const { rows }=store.badgeRanks.list('wx:reader','fun',new URLSearchParams());
    assert.equal(rows.length,1);
    assert.equal(rows[0].rank,1);
    assert.deepEqual(store.badgeRanks.detail('wx:reader','fun',rows[0].publicId).badges.map(b=>b.id),['october_2026_book']);
    const own=store.badgeRanks.detail('wx:past','fun','self');
    assert.deepEqual(own.badges,[]);
    assert.equal(own.visible,false);
    const honor=store.badgeRanks.list('wx:past','honor',new URLSearchParams());
    assert.equal(honor.total,1);
    assert.equal(honor.me.count,1);
    assert.deepEqual(store.badgeRanks.detail('wx:reader','honor',honor.me.publicId).badges.map(b=>b.id),['monthly_points_2026-11_1']);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('背锅侠和牌桌常青树易主、并列和跨月后，趣味榜名次、数量与收藏一致', () => {
  let now = NOW;
  const store = new Store(':memory:', { clock: () => now });
  const ranks = store.badgeRanks, a = 'wx:a', b = 'wx:b';
  const permanent = ['feedback_contributor', 'october_2026_book', 'october_2026_table'];
  const bothTitles = ['assassin_miss', 'games'];
  function check(uid, expected, rank) {
    const page = ranks.list(uid, 'fun', new URLSearchParams());
    const self = ranks.detail(uid, 'fun', 'self');
    const owned = readBadges(store, uid).badges.filter(badge => badge.category === '趣味徽章');
    assert.deepEqual(owned.map(badge => badge.id).sort(), [...expected].sort());
    assert.deepEqual(self.badges.map(badge => badge.id), [...expected].sort());
    assert.equal(self.player.count, expected.length);
    assert.equal(page.me.count, expected.length);
    assert.equal(page.me.rank, rank);
    if (rank !== null) {
      assert.deepEqual(page.rows.find(row => row.publicId === page.me.publicId), page.me);
      assert.deepEqual(ranks.detail('wx:viewer', 'fun', page.me.publicId).badges, self.badges);
    }
    return page;
  }
  try {
    for (const id of permanent) grantFixtureAward(store,a,id);
    metric(store, a, 'assassin_miss', 1);
    const before = check(a, [...bothTitles, ...permanent], 1);
    metric(store, b, 'assassin_miss', 1);
    check(a, [...bothTitles, ...permanent], 1);
    check(b, bothTitles, 2);
    metric(store, b, 'assassin_miss', 1);
    check(a, permanent, 1);
    check(b, bothTitles, 2);
    // The same number of badges is now split across two players instead of one.
    assert.throws(() => ranks.list(a, 'fun', new URLSearchParams({offset:30, version:before.version})), e=>e.status===409);
    ranks.setVisibility(a, 'fun', {visible:false});
    const hidden = ranks.detail(b, 'fun', before.me.publicId);
    assert.deepEqual(hidden.badges, []);
    assert.equal(hidden.player.count, 3);
    assert.equal(ranks.detail(a, 'fun', 'self').badges.length, 3);
    ranks.setVisibility(a, 'fun', {visible:true});
    now = NEXT; // No new game or profile write at the month boundary.
    assert.deepEqual(ranks.detail(b, 'fun', 'self').badges, []);
    assert.equal(check(a, permanent, 1).total, 1);
    check(b, [], null);
  } finally { store.close(); }
});
