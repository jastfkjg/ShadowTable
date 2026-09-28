const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BOARDS, newRoom, publicView } = require('../server/engine');
const { wxmlToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname,'../miniprogram');
function page(route, api, { storage = new Map(), appState = {}, pages = [{},{}], wx: overrides = {} } = {}) {
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
      Page: value => definition = value, wx, getApp: () => appState, getCurrentPages: () => pages, setTimeout, clearTimeout,
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

test('个人入口使用原生导航与即时轻按态，不触发默认白色按钮背景', () => {
  const context = {window:{},global:{},console}; vm.createContext(context);
  const factory = vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const tree = factory('pages/me/me.wxml')({profile:{displayName:'林间'},error:'断线'});
  const nodes = n => typeof n === 'object' ? [n,...(n.children || []).flatMap(nodes)] : [];
  const links = nodes(tree).filter(n => n.tag === 'wx-navigator');
  assert.deepEqual(links.map(n => n.attr.url), ['profile','stats','leaderboard','matches','help'].map(name => `/pages/${name}/${name}`));
  for (const node of nodes(tree).filter(n => ['wx-navigator','wx-button'].includes(n.tag))) {
    assert.equal(node.attr.hoverClass,'me-pressed');
    assert.equal(node.attr.hoverStartTime,0);
    assert.equal(node.attr.hoverStayTime,70);
  }
  assert.ok(links.every(n => n.attr.openType === 'navigate' && !n.attr.bindtap));
});

const previewProfile = { ...profile, displayName:'林间',initial:'林',avatarUrl:'' };
const previewStats = { ...emptyStats, rateLabel:'—' };
const priorMe = (extra = {}) => [{route:'pages/me/me',data:{profile:previewProfile,stats:previewStats},...extra},{}];
function deferred() { let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }

function rankResult(metric='games', extra={}) {
  return {metric,period:'all',threshold:1,eligibleCount:1,maxRows:100,updatedAt:1,version:'one',hasMore:false,nextOffset:null,
    rows:[{publicId:'player',nickname:'甲',avatarUrl:null,rank:1,total:20,wins:12,losses:8,winRate:60,isSelf:true}],
    me:{rank:1,status:'ranked',total:20,wins:12,losses:8,winRate:60,remaining:0},...extra};
}
test('小程序切换周期保留榜单和底栏，完成后一次更新，失败可重试目标周期', async () => {
  const requests=[];
  const {p}=page('leaderboard',{...apiBase,request:url=>{
    const pending=deferred();requests.push({url,...pending});return pending.promise;
  }});
  const context={window:{},global:{},console};vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const render=()=>JSON.stringify(factory('pages/leaderboard/leaderboard.wxml')(p.data));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const first=p.onShow();await tick();
  assert.match(render(),/正在读取榜单/);
  requests[0].resolve(rankResult());await first;
  const board=p.data.board,frames=[];
  const setData=p.setData;
  p.setData=function(patch){setData.call(this,patch);frames.push({...this.data});};
  const change=p.choosePeriod({currentTarget:{dataset:{id:'month'}}});await tick();
  assert.equal(p.data.period,'month');assert.equal(p.data.board,board);
  assert.match(render(),/rank-list/);assert.match(render(),/rank-mine/);assert.doesNotMatch(render(),/正在读取榜单/);
  await p.choosePeriod({currentTarget:{dataset:{id:'month'}}});assert.equal(requests.length,2);
  requests[1].resolve(rankResult('games',{period:'month',rows:[]}));await change;
  assert.equal(frames.length,2);assert.ok(frames.every(frame=>frame.board));
  assert.equal(p.data.board.period,'month');assert.equal(p.data.loading,false);assert.match(render(),/暂无战绩/);
  const failed=p.choosePeriod({currentTarget:{dataset:{id:'all'}}});await tick();
  requests[2].reject(new Error('网络中断'));await failed;
  assert.equal(p.data.period,'month');assert.equal(p.data.board.period,'month');
  const retry=p.retry();await tick();assert.match(requests[3].url,/period=all/);
  requests[3].resolve(rankResult());await retry;
  assert.equal(p.data.period,'all');assert.equal(p.data.error,'');
});
test('小程序排行榜快速切换忽略旧响应，分页过期自动刷新，普通错误保留已加载数据', async () => {
  const old=deferred();let reads=0;
  const {p}=page('leaderboard',{...apiBase,request:async url=>{
    reads++;if(reads===1)return old.promise;
    return rankResult('good');
  }});
  const first=p.onShow();await Promise.resolve();
  await p.chooseMetric({currentTarget:{dataset:{id:'good'}}});
  old.resolve(rankResult());await first;
  assert.equal(p.data.board.metric,'good');assert.equal(p.data.board.rows[0].value,'60.0');
  let step=0;const urls=[];
  const paged=page('leaderboard',{...apiBase,request:async url=>{
    urls.push(url);step++;
    if(step===2)throw Object.assign(new Error('榜单已更新'),{status:409});
    if(step===4)throw new Error('网络中断');
    return rankResult('games',{hasMore:step===1,nextOffset:20,version:step===1?'old':'new'});
  }}).p;
  await paged.onShow();await paged.loadMore();
  assert.equal(urls[1],'/api/leaderboard?metric=games&period=all&offset=20&version=old');
  assert.equal(paged.data.board.rows.length,1);assert.equal(paged.data.board.version,'new');assert.match(paged.data.notice,/重新加载/);
  await paged.load();assert.equal(paged.data.error,'网络中断');assert.equal(paged.data.board.rows.length,1);
  await paged.retry();assert.equal(paged.data.error,'');
  p.onUnload();assert.equal(p.alive,false);
});
test('小程序公开设置独立标记草稿，保存重试不改变原请求，游客不能打开', async () => {
  const writes=[];
  const {p}=page('profile',{...apiBase,request:async(url,method,body)=>{
    if(method!=='POST')return {...profile,leaderboardVisible:false};
    writes.push(body);if(writes.length===1)throw Error('断线');return {...profile,leaderboardVisible:body.leaderboardVisible};
  }});
  await p.load();p.changeLeaderboard({detail:{value:true}});assert.equal(p.data.dirty,true);
  await p.save();p.changeLeaderboard({detail:{value:false}});assert.equal(p.data.leaderboardVisible,true);
  await p.save();assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].leaderboardVisible,true);
  const guest=page('profile',{...apiBase,request:async()=>({...profile,identityType:'guest'})}).p;
  await guest.load();guest.changeLeaderboard({detail:{value:true}});assert.equal(guest.data.leaderboardVisible,false);
});
test('小程序排行榜保留空榜、错误、样本量与参与入口，移除说明性文案', () => {
  const context={window:{},global:{},console};vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const rank=page('leaderboard',apiBase).p;
  const render=data=>JSON.stringify(factory('pages/leaderboard/leaderboard.wxml')({...rank.data,loading:false,...data}));
  const board={...rankResult(),metricLabel:'局数',me:{...rankResult().me,status:'hidden',statusLabel:''},rows:[]};
  const tree=render({board,error:'请求失败'});
  assert.match(tree,/参与排行/);assert.match(tree,/暂无战绩/);assert.match(tree,/请求失败/);assert.doesNotMatch(tree,/同桌相聚|规则|仅展示|仅微信|满10局|满20局|尚未开启|更新于/);
  const template=fs.readFileSync(path.join(root,'pages/leaderboard/leaderboard.wxml'),'utf8');
  assert.match(template,/aria-pressed/);assert.match(template,/item.wins/);assert.match(template,/item.total/);
});

test('资料页在网络返回前展示已有资料，后台刷新不覆盖刚输入的草稿', async () => {
  const request = deferred();
  const {p}=page('profile',{...apiBase,request:()=>request.promise},{pages:priorMe()});
  const loading=p.onLoad();
  assert.equal(p.data.nickname,'林间'); assert.equal(p.data.profile.displayName,'林间');
  p.inputName({detail:{value:'正在编辑'}});
  request.resolve({...profile,nickname:'远端更新',version:2}); await loading;
  assert.equal(p.data.nickname,'正在编辑'); assert.equal(p.data.dirty,true);
  assert.equal(p.original.version,1); // Save keeps its optimistic-concurrency version.
  assert.equal(p.data.loading,false);
  await p.reload();
  assert.equal(p.data.nickname,'远端更新'); assert.equal(p.data.dirty,false);
  assert.equal(p.original.version,2);
});

test('预览只来自直接上级的我的页，直接进入仍正常请求最新资料', async () => {
  const request=deferred();
  const {p}=page('profile',{...apiBase,request:()=>request.promise},{pages:[{route:'pages/table/table',data:{profile:previewProfile}},{}]});
  const loading=p.onLoad(); assert.equal(p.data.profile,null);
  request.resolve({...profile,nickname:'最新'}); await loading;
  assert.equal(p.data.nickname,'最新');
});

test('战绩即时显示预览，刷新保留已展开的阵营且不修改上级数据', async () => {
  const request=deferred();
  const stats={...previewStats,total:1,byFaction:[{faction:'good',total:1,expanded:false,roles:[]}]};
  const pages=priorMe();pages[0].data.stats=stats;
  const {p}=page('stats',{...apiBase,request:()=>request.promise},{pages});
  const loading=p.onLoad(); assert.equal(p.data.stats.total,1);
  p.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.byFaction[0].expanded,false);
  request.resolve({...emptyStats,total:2,byFaction:[{faction:'good',total:2,winRate:50}]}); await loading;
  assert.equal(p.data.stats.total,2);assert.equal(p.data.stats.byFaction[0].expanded,true);
});

test('预取对局记录不阻塞我的页面，过期预取结果和失败均不覆盖当前状态', async () => {
  const first=deferred(),second=deferred();let reads=0;
  const {p}=page('me',{...apiBase,request:async url=>url.includes('/matches')?(++reads===1?first.promise:second.promise):url.endsWith('/stats')?emptyStats:profile});
  await p.load(); assert.equal(p.data.loading,false); assert.equal(p.matchesPreview,null);
  await p.load();
  first.resolve({records:[],total:9,hasMore:false}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.matchesPreview,null);
  second.reject(new Error('预取断线')); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.data.error,''); assert.equal(p.data.profile.displayName,'林间');
});

test('预取记录立即可见，首屏刷新失败后重试首屏，不误用加载更多', async () => {
  const record={id:'one',endedAt:1000,seat:1,role:'梅林',faction:'good',outcome:'win',members:[{seat:1,name:'林间'}]};
  const result={records:[record],total:1,hasMore:false};
  const reads=[],request=deferred();
  const {p}=page('matches',{...apiBase,request:url=>{reads.push(url);return reads.length===1?request.promise:Promise.resolve(result);}},{pages:priorMe({matchesPreview:result})});
  const loading=p.onLoad();assert.equal(p.data.loaded,true);assert.equal(p.data.records[0].id,'one');
  p.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  request.reject(new Error('刷新失败'));await loading;
  assert.equal(p.data.records[0].expanded,true);
  await p.retry();
  assert.deepEqual(reads,['/api/me/matches?offset=0','/api/me/matches?offset=0']);
  assert.equal(p.data.error,'');assert.equal(p.data.records[0].expanded,true);
});
