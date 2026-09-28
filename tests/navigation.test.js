const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BOARDS, newRoom, publicView } = require('../server/engine');
const { wxmlToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname,'../miniprogram');
function page(route, api, { storage = new Map(), appState = {}, wx: overrides = {} } = {}) {
  let definition;
  const navigations = [];
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key,value) => storage.set(key,value), removeStorageSync: key => storage.delete(key),
    navigateTo: o => { navigations.push(o.url); o.complete?.(); }, switchTab: o => navigations.push(o.url),
    navigateBack: () => navigations.push('back'), showToast() {},
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    showModal: o => o.success({ confirm: true }), ...overrides,
  };
  function load(file) {
    if (file === path.join(root,'api.js')) return api;
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file,'utf8'), {
      module: mod, require: name => load(path.resolve(path.dirname(file), name + '.js')),
      Page: value => definition = value, wx, getApp: () => appState, getCurrentPages: () => [{},{}], setTimeout, clearTimeout,
    }, { filename: file });
    return mod.exports;
  }
  load(path.join(root,'pages',route,route+'.js'));
  const p = { ...definition, data: structuredClone(definition.data), alive: true, foreground: true,
    setData(patch,callback) { Object.assign(this.data,patch); callback?.(); } };
  if (p.schedule) p.schedule = () => {};
  return { p, wx, navigations, storage, appState };
}
const emptyStats = { total:0,wins:0,losses:0,excluded:0,winRate:null,byFaction:[],byBoard:[],recent:[] };
const profile = { nickname:'林间',avatarUrl:null,version:1,identityType:'wx' };
const apiBase = { login: async () => {}, requestId: () => 'same-request-id-123', assetUrl: p => 'https://test.invalid'+p };
test('小程序一级导航为对局与我的，独立牌桌仍支持原邀请地址', async () => {
  const config = JSON.parse(fs.readFileSync(path.join(root,'app.json')));
  assert.equal(config.pages[0],'pages/lobby/lobby');
  assert.deepEqual(config.tabBar.list.map(i=>i.text),['对局','我的']);
  assert.ok(!config.tabBar.list.some(i=>i.pagePath === 'pages/table/table'));
  for (const tab of config.tabBar.list) assert.ok(fs.statSync(path.join(root,tab.iconPath)).size > 0);
  const reads = [], storage = new Map([['roomCode','123456']]);
  const api = { ...apiBase, request: async url => { reads.push(url); if(url==='/api/boards')return {boards:BOARDS}; if(url==='/api/me/rooms')return {rooms:[{code:'123456',status:'playing',available:true}]}; if(url==='/api/me/profile')return profile; throw new Error('意外请求 '+url); } };
  const { p } = page('lobby',api,{storage});
  await p.bootstrap();
  assert.equal(p.data.isLobby,true); assert.equal(p.data.room,null);
  assert.equal(p.data.activeRooms[0].code,'123456'); assert.equal(p.data.name,'林间');
  assert.ok(!reads.includes('/api/rooms/123456'));
  const board = page('table',api).p; assert.equal(board.data.isLobby,false);
});
test('首页进入独立牌桌，切后台时建房成功不强行跳转；直接邀请提示加入', async () => {
  const api = { ...apiBase, request: async (url,method) => method==='POST' ? {code:'234567'} : url==='/api/boards' ? {boards:BOARDS} : url==='/api/me/rooms' ? {rooms:[]} : url==='/api/me/profile' ? profile : Promise.reject(Object.assign(new Error('你不在该房间'),{status:403})) };
  const first = page('lobby',api); first.p.data.name='林间';
  await first.p.mutate('/api/rooms',{name:'林间'},'enter');
  assert.deepEqual(first.navigations,['/pages/table/table?code=234567']); assert.equal(first.p.data.room,null);
  first.navigations.length=0; first.p.foreground=false;
  await first.p.mutate('/api/rooms',{name:'林间'},'enter'); assert.equal(first.navigations.length,0);
  const invited = page('table',api); invited.p.inviteCode='654321'; await invited.p.bootstrap();
  assert.equal(invited.storage.get('invitedRoom'),'654321'); assert.deepEqual(invited.navigations,['/pages/lobby/lobby']);
});
test('离开牌桌遮盖身份；未确认操作在内存中恢复并复用请求编号', async () => {
  let calls = 0; const ids = [];
  const room = newRoom('123456','p1','林间');
  const api = { ...apiBase, request: async (url,method,body,id) => {
    if(method==='POST'){ ids.push(id); if(++calls===1)throw new Error('response lost'); return {code:'123456'}; }
    if(url==='/api/boards')return {boards:BOARDS}; if(url==='/api/me/rooms')return {rooms:[]}; return publicView(room,'p1');
  } };
  const appState = {}, first = page('table',api,{appState}); first.p.roomCode='123456';
  first.p.data.secret={role:'梅林'}; first.p.data.revealed=true;
  await first.p.mutate('/api/rooms/123456/commands',{type:'ready',stage:room.stage,ready:true});
  first.p.onHide(); assert.equal(first.p.data.secret,null); assert.equal(first.p.data.revealed,false);
  assert.ok(appState.pendingTableRequest); assert.equal(first.storage.has('pendingEntry'),false);
  const lobby = page('lobby',api,{appState}); await lobby.p.mutate('/api/rooms',{name:'林间'},'enter');
  assert.equal(ids.length,1); assert.match(lobby.p.data.error,/未确认/);
  const resumed = page('table',api,{appState}); resumed.p.inviteCode='123456'; await resumed.p.bootstrap();
  assert.equal(ids.length,2); assert.equal(ids[0],ids[1]); assert.equal(appState.pendingTableRequest,null);
});
test('个人资料失败保留草稿，重试复用编号；冲突不覆盖其他设备资料', async () => {
  let writes=0; const ids=[];
  const api = {...apiBase,request:async(url,method,body,id)=>{
    if(method!=='POST') return profile;
    ids.push(id); if(++writes===1)throw new Error('network lost'); return {...profile,nickname:body.nickname,version:2};
  }};
  const {p,navigations}=page('profile',api); await p.load(); p.inputName({detail:{value:'晚风'}});
  await p.save(); assert.equal(p.data.nickname,'晚风'); assert.equal(p.data.pendingSave,true); assert.equal(navigations.length,0);
  p.inputName({detail:{value:'不应修改待确认内容'}}); assert.equal(p.data.nickname,'晚风');
  await p.save(); assert.equal(ids[0],ids[1]); assert.equal(p.data.dirty,false); assert.deepEqual(navigations,['back']);
  const conflict=page('profile',{...apiBase,request:async(url,method)=>{if(method==='POST')throw Object.assign(new Error('资料已更新'),{status:409});return profile;}}).p;
  await conflict.load(); conflict.inputName({detail:{value:'改名'}}); await conflict.save();
  assert.equal(conflict.data.conflict,true); assert.equal(conflict.data.nickname,'改名'); assert.equal(conflict.data.pendingSave,false);
});
test('编辑资料取消离开仍保留输入；我的和战绩页可独立刷新和重试', async () => {
  const api={...apiBase,request:async url=>url.endsWith('/stats')?emptyStats:profile};
  const edit=page('profile',api,{wx:{showModal:o=>o.success({confirm:false})}});
  await edit.p.load(); edit.p.inputName({detail:{value:'未保存'}}); await edit.p.back();
  assert.equal(edit.navigations.length,0); assert.equal(edit.p.data.nickname,'未保存');
  const me=page('me',api); await me.p.load(); assert.equal(me.p.data.profile.displayName,'林间'); assert.equal(me.p.data.stats.rateLabel,'—');
  me.p.openStats(); assert.deepEqual(me.navigations,['/pages/stats/stats']);
  me.p.openMatches(); assert.deepEqual(me.navigations,['/pages/stats/stats','/pages/matches/matches']);
  let reads=0; const stats=page('stats',{...apiBase,request:async()=>{if(++reads===1)throw new Error('断线');return emptyStats;}}).p;
  await stats.load(); assert.equal(stats.data.error,'断线'); await stats.load(); assert.equal(stats.data.stats.total,0); assert.equal(stats.data.error,'');
});
test('战绩逐层展开，记录逐场展开成员并可继续分页', async () => {
  const detailedStats = { ...emptyStats, total: 2, wins: 1, losses: 1, winRate: 50,
    byFaction: [{ faction: 'good', label: '好人阵营', total: 2, wins: 1, losses: 1, excluded: 0, winRate: 50 }],
    byRole: [{ faction: 'good', role: '梅林', total: 2, wins: 1, losses: 1, excluded: 0, winRate: 50 }] };
  const stats = page('stats',{...apiBase,request:async()=>detailedStats}).p;
  await stats.load();
  assert.equal(stats.data.overviewExpanded,false);
  stats.toggleOverview(); assert.equal(stats.data.overviewExpanded,true);
  stats.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.data.stats.byFaction[0].expanded,true);
  assert.equal(stats.data.stats.byFaction[0].roles[0].rateLabel,'50%');

  const record = (id, endedAt) => ({ id, boardName: '经典', capacity: 6, endedAt, winner: 'good', source: 'manual', excludedReason: null,
    name: '林间', seat: 1, role: '梅林', faction: 'good', outcome: 'win', members: [{seat:1,name:'林间'},{seat:2,name:'晚风'}] });
  const reads=[];
  const matches = page('matches',{...apiBase,request:async url => {
    reads.push(url);
    return url.endsWith('offset=0') ? {records:[record('one',1000)],total:2,hasMore:true} : {records:[record('two',500)],total:2,hasMore:false};
  }}).p;
  await matches.load();
  matches.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].expanded,true);
  assert.equal(matches.data.records[0].members[0].isSelf,true);
  await matches.loadMore();
  assert.deepEqual(reads,['/api/me/matches?offset=0','/api/me/matches?offset=1']);
  assert.equal(matches.data.records.length,2);
  assert.equal(matches.data.hasMore,false);
});
test('新页面模板编译，资料与战绩只出现在个人页面，牌桌无底部导航内容', () => {
  const context = {window:{},global:{},console}; vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const lobby=JSON.stringify(factory('pages/lobby/lobby.wxml')({isLobby:true,room:null,memberRooms:[],visibleMemberRooms:[]}));
  assert.doesNotMatch(lobby,/今晚，开一桌|和朋友面对面|总胜率|编辑资料/);
  const me=JSON.stringify(factory('pages/me/me.wxml')({profile:{displayName:'林间',initial:'林'},stats:{total:0,wins:0,rateLabel:'—'}}));
  assert.match(me,/编辑资料/); assert.match(me,/对局记录/);
  assert.doesNotMatch(me,/去开一局|还没有有效战绩|逐场查看/);
  const editor=JSON.stringify(factory('pages/profile/profile.wxml')({profile:{},nickname:'林间',avatarPreview:'',initial:'林'}));
  assert.match(editor,/chooseAvatar/); assert.match(editor,/formType/);
  const expandedStats=JSON.stringify(factory('pages/stats/stats.wxml')({stats:{total:2,wins:1,rateLabel:'50%',excluded:0,byFaction:[{faction:'good',label:'好人阵营',total:2,wins:1,rateLabel:'50%',expanded:true,roles:[{role:'梅林',total:2,wins:1,rateLabel:'50%'}]}]},overviewExpanded:true}));
  assert.match(expandedStats,/梅林/); assert.match(expandedStats,/阵营战绩/);
  const matches=JSON.stringify(factory('pages/matches/matches.wxml')({records:[{id:'one',dateLabel:'今天',boardName:'经典',capacity:6,role:'梅林',factionLabel:'好人',outcomeLabel:'胜利',outcome:'win',expanded:true,winnerLabel:'好人',sourceLabel:'房主登记',members:[{seat:1,name:'林间',isSelf:true}]}],total:1,hasMore:false}));
  assert.match(matches,/同桌成员/); assert.match(matches,/林间/);
  const emptyMatches=JSON.stringify(factory('pages/matches/matches.wxml')({loading:false,error:'',records:[],total:0}));
  assert.match(emptyMatches,/暂无对局记录/); assert.doesNotMatch(emptyMatches,/去开一局|逐场查看/);
});
test('窗口背景与自绘导航保持深色，所有页面都有顶部导航', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const color = '#101c24';
  assert.equal(config.window.backgroundColor, color);
  assert.equal(config.window.backgroundColorTop, color);
  assert.equal(config.window.backgroundColorBottom, color);
  assert.equal(config.window.navigationBarBackgroundColor, color);
  assert.equal(config.tabBar.backgroundColor, color);
  assert.equal(config.window.navigationStyle, 'custom');
  assert.equal(config.tabBar.custom, true);
  for (const route of config.pages) {
    const pageConfig = JSON.parse(fs.readFileSync(path.join(root, route + '.json'), 'utf8'));
    const template = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
    assert.equal(pageConfig.usingComponents['app-nav'], '/components/app-nav/app-nav', route);
    if (route.endsWith('/lobby/lobby') || route.endsWith('/table/table')) {
      assert.match(fs.readFileSync(path.join(root, 'pages/table/shared.wxml'), 'utf8'), /<app-nav/);
    } else assert.match(template, /<app-nav/);
  }
});
