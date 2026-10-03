const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BOARDS, newRoom, publicView } = require('../server/engine');
const { wxmlToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname,'../miniprogram');
function page(route, api, { storage = new Map(), appState = {}, pages = [{},{}], wx: overrides = {}, home = false } = {}) {
  let definition;
  const navigations = [];
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key,value) => storage.set(key,value), removeStorageSync: key => storage.delete(key),
    navigateTo: o => { navigations.push(o.url); o.complete?.(); }, switchTab: o => navigations.push(o.url),
    navigateBack: () => navigations.push('back'), showToast() {},
    onNetworkStatusChange() {}, offNetworkStatusChange() {},
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
  if (!home && route === 'lobby') definition = load(path.join(root,'pages/table/controller.js'))({ lobby: true });
  else if (!home && route === 'me') definition = load(path.join(root,'pages/me/controller.js'))();
  else load(path.join(root,'pages',route,route+'.js'));
  const p = { ...definition, data: structuredClone(definition.data), alive: true, foreground: true,
    setData(patch,callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.'); let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts[parts.length - 1]] = value;
      }
      callback?.();
    } };
  if (p.schedule) p.schedule = () => {};
  return { p, wx, navigations, storage, appState };
}
const emptyStats = { total:0,wins:0,losses:0,excluded:0,winRate:null,byFaction:[],byBoard:[],recent:[] };
const profile = { nickname:'林间',avatarUrl:null,version:1,identityType:'wx' };
const apiBase = { login: async () => {}, requestId: () => 'same-request-id-123', assetUrl: p => 'https://test.invalid'+p };
function renderMainPanel(factory, index, data) {
  const tree = factory('pages/lobby/lobby.wxml')({ activeTab: index, lobby: index === 0 ? data : { isLobby: true }, personal: index === 1 ? data : {} });
  const find = node => typeof node === 'object' &&
    (node.attr?.class === 'main-panel' && !node.attr.hidden ? node : (node.children || []).map(find).find(Boolean));
  return find(tree);
}

test('首页在同一窗口保留两个区域、表单和滚动位置，切回时刷新且不调用页面导航', async () => {
  const scrolls = [], pages = [];
  const api = { ...apiBase, request: async url => url === '/api/boards' ? { boards: BOARDS }
    : url.endsWith('/profile') ? profile : url.endsWith('/stats') ? emptyStats : { rooms: [], records: [], total: 0 } };
  const { p, navigations } = page('lobby', api, { home: true, pages, wx: { pageScrollTo: options => { scrolls.push(options.scrollTop); options.complete(); } } });
  p.route = 'pages/lobby/lobby'; pages.push(p);
  p.onLoad(); await p.onShow();
  p.inputName({ detail: { value: '本桌草稿' } });
  p.setData({ 'lobby.code': '654321' }); p.lobbyController.data.code = '654321';
  p.onPageScroll({ scrollTop: 240 });
  await p.switchMainTab(1);
  const shownProfile = p.data.personal.profile;
  assert.equal(p.data.activeTab, 1);
  assert.equal(shownProfile.displayName, '林间');
  p.onPageScroll({ scrollTop: 120 });
  await p.switchMainTab(0);
  assert.equal(p.data.activeTab, 0);
  assert.equal(p.data.lobby.name, '本桌草稿');
  assert.equal(p.data.lobby.code, '654321');
  assert.equal(p.data.personal.profile, shownProfile);
  await p.switchMainTab(1);
  assert.equal(p.data.personal.profile, shownProfile);
  assert.deepEqual(scrolls, [0, 240, 120]);
  assert.equal(navigations.length, 0);
  assert.equal(p.route, 'pages/lobby/lobby');
  p.onUnload();
});

test('我的入口首次只读个人数据，资料与记录预览仍从当前首页传给下一页', async () => {
  const reads = [], pages = [];
  const api = { ...apiBase, request: async url => { reads.push(url); return url.endsWith('/profile') ? profile
    : url.endsWith('/stats') ? emptyStats : { records: [], total: 0, hasMore: false }; } };
  const { p } = page('me', api, { home: true, pages });
  p.route = 'pages/me/me'; pages.push(p); p.onLoad(); await p.onShow();
  assert.equal(p.data.activeTab, 1);
  assert.ok(!reads.includes('/api/boards'));
  assert.ok(!reads.includes('/api/me/rooms'));
  const { p: editor } = page('profile', api, { pages: [p, {}] });
  const loading = editor.onLoad();
  assert.equal(editor.data.nickname, '林间');
  assert.equal(editor.data.profile.displayName, '林间');
  await loading;
  const { p: records } = page('matches', api, { pages: [p, {}] });
  const recordsLoading = records.onLoad();
  assert.equal(records.data.loaded, true); await recordsLoading;
  p.onUnload();
});

test('从我的入口进入的牌桌返回原首页对局区域，隐藏页不提前刷新', async () => {
  const reads = [], pages = [];
  const api = { ...apiBase, request: async url => { reads.push(url); return url === '/api/boards' ? { boards: BOARDS }
    : url.endsWith('/profile') ? profile : url.endsWith('/stats') ? emptyStats : { rooms: [], records: [] }; } };
  const { p: home } = page('me', api, { home: true, pages });
  home.route = 'pages/me/me'; pages.push(home); home.onLoad(); await home.onShow(); home.onHide();
  const back = [];
  const { p: table } = page('table', api, { pages, wx: { navigateBack: options => back.push(options) } });
  table.route = 'pages/table/table'; table.data.room = { code: '123456' }; table.roomCode = '123456'; pages.push(table);
  reads.length = 0; await table.returnHome();
  assert.equal(back[0].delta, 1);
  assert.equal(home.data.activeTab, 0);
  assert.equal(table.data.room.code, '123456');
  assert.equal(reads.length, 0);
  pages.pop(); await home.onShow();
  assert.ok(reads.includes('/api/me/rooms')); home.onUnload();
});

test('同一首页模板保留两个区域，仅隐藏非当前区域且顶部导航只渲染一次', () => {
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
  const nodes = n => typeof n === 'object' ? [n, ...(n.children || []).flatMap(nodes)] : [];
  for (const activeTab of [0, 1]) {
    const tree = factory('pages/lobby/lobby.wxml')({ activeTab, lobby: { isLobby: true, name: '草稿' }, personal: { profile: { displayName: '林间' } } });
    const panels = nodes(tree).filter(node => node.attr?.class === 'main-panel');
    assert.equal(panels.length, 2);
    assert.equal(panels[activeTab].attr.hidden, false);
    assert.equal(panels[1 - activeTab].attr.hidden, true);
    assert.ok(panels.every(panel => panel.children.length > 0));
    assert.equal(nodes(tree).filter(node => node.tag === 'wx-app-nav').length, 1);
  }
});

test('独立页面通过原入口返回时指定目标区域，旧首页的选中状态不会覆盖返回目标', async () => {
  const appState = { homeTabRequest: { selected: 1 } }, reads = [];
  const api = { ...apiBase, request: async url => { reads.push(url); return url === '/api/boards' ? { boards: BOARDS }
    : url.endsWith('/profile') ? profile : url.endsWith('/stats') ? emptyStats : { rooms: [], records: [] }; } };
  const { p: home } = page('lobby', api, { home: true, appState });
  home.onLoad(); await home.onShow();
  assert.equal(home.data.activeTab, 1);
  assert.equal(appState.homeTabRequest, undefined);
  assert.ok(!reads.includes('/api/boards'));
  await home.switchMainTab(0); home.onHide();
  const { p: detail, navigations } = page('stats', api, { pages: [{}], appState });
  detail.back();
  assert.equal(navigations[0], '/pages/me/me');
  assert.equal(appState.homeTabRequest.selected, 1);
  await home.onShow();
  assert.equal(home.data.activeTab, 1);
  assert.equal(appState.homeTabRequest, undefined);
  home.onUnload();
});
test('分享入口只传内容选择，拦截旧预览和读取失败，不传个人成绩或内部标识', () => {
  const {p,navigations}=page('stats',apiBase);
  p.setData({loading:true,stats:{total:10}});p.shareStats();assert.equal(navigations.length,0);
  p.setData({loading:false,error:'网络错误'});p.shareStats();assert.equal(navigations.length,0);
  p.setData({error:'',stats:{total:10,fun:{cards:[{id:'classic:merlin',shareMetric:'merlin_evade'}]}}});
  p.shareStats();p.shareFun({currentTarget:{dataset:{card:'classic:merlin'}}});
  assert.equal(navigations[0],'/pages/share/share?kind=stats');
  const query=new URL('https://example.test'+navigations[1]).searchParams;
  assert.equal(query.get('card'),'classic:merlin');assert.equal(query.get('metric'),'merlin_evade');
  const rawOptions=Object.fromEntries(navigations[1].split('?')[1].split('&').map(item=>item.split('=')));
  assert.equal(require('../miniprogram/share-card').parseSelection(rawOptions).card,'classic:merlin');
  const ranking=page('leaderboard',apiBase);
  ranking.p.setData({loading:false,board:{rows:[],me:{status:'not_enough',knownGames:4,opportunities:4,rate:50},metric:'fun_knife_enemy',period:'month',fun:true,mode:'knights',sort:'rate',role:'gareth',nextOffset:20,version:'private'}});
  ranking.p.shareLeaderboard();
  assert.equal(ranking.navigations[0],'/pages/share/share?kind=leaderboard&metric=fun_knife_enemy&period=month&mode=knights&sort=rate&role=gareth');
  ranking.p.setData({visibilitySaving:true});ranking.p.shareLeaderboard();assert.equal(ranking.navigations.length,1);
  ranking.p.setData({visibilitySaving:false,board:{rows:[{rank:1}],metric:'points',me:{total:0,points:0}}});
  ranking.p.shareLeaderboard();assert.equal(ranking.navigations.length,1);
});
test('榜单未上榜仍可分享本人真实成绩，暂无记录与无机会点击后说明原因', () => {
  const notices = [];
  const {p,navigations} = page('leaderboard', apiBase, {wx:{showToast: options => notices.push(options)}});
  p.setData({loading:false,board:{rows:[],metric:'overall',period:'all',me:{status:'not_enough',rank:null,total:2,wins:1,winRate:50,remaining:8}}});
  p.shareLeaderboard();
  assert.equal(navigations[0],'/pages/share/share?kind=leaderboard&metric=overall&period=all');
  assert.equal(p.data.shareOpening,false);
  assert.equal(notices.length,0);
  p.setData({board:{rows:[{rank:1,nickname:'其他玩家'}],metric:'overall',me:{status:'no_games',total:0}}});
  p.shareLeaderboard();
  assert.match(p.data.shareNotice,/暂无本人成绩.*完成相关对局/);
  assert.equal(notices[0].title,p.data.shareNotice);
  assert.equal(notices[0].icon,'none');
  assert.equal(navigations.length,1);
  const fun={rows:[],metric:'fun_good_shield',period:'all',fun:true,sort:'rate',mode:'all',me:{status:'not_enough',knownGames:2,count:0,opportunities:0,rate:null}};
  p.setData({board:fun});p.shareLeaderboard();
  assert.match(notices.at(-1).title,/暂无有效机会.*切换次数榜/);
  assert.equal(navigations.length,1);
  p.setData({board:{...fun,sort:'count'}});p.shareLeaderboard();
  assert.equal(navigations[1],'/pages/share/share?kind=leaderboard&metric=fun_good_shield&period=all&mode=all&sort=count');
  assert.equal(p.data.shareNotice,'');
  p.setData({error:'网络错误'});p.shareLeaderboard();
  assert.match(notices.at(-1).title,/重试读取榜单/);
  assert.equal(navigations.length,2);
});
test('榜单分享打开期间不重复跳转，打开失败可重试，卸载后不更新旧页面', () => {
  const requests = [];
  const {p} = page('leaderboard',apiBase,{wx:{navigateTo:options=>requests.push(options)}});
  const board={metric:'games',period:'all',rows:[],me:{status:'ranked',total:2,rank:1}};
  p.setData({loading:false,board});
  for (const key of ['loading','loadingMore','visibilitySaving']) {
    p.setData({[key]:true});p.shareLeaderboard();assert.equal(requests.length,0);p.setData({[key]:false});
  }
  p.shareLeaderboard();p.shareLeaderboard();
  assert.equal(requests.length,1);assert.equal(p.data.shareOpening,true);
  requests[0].fail();requests[0].complete();
  assert.match(p.data.shareNotice,/分享页暂时无法打开/);
  assert.equal(p.data.shareOpening,false);
  p.shareLeaderboard();assert.equal(requests.length,2);assert.equal(p.data.shareNotice,'');
  p.onUnload();requests[1].fail();requests[1].complete();
  assert.equal(p.data.shareNotice,'');assert.equal(p.data.shareOpening,true);
});
test('小程序本人积分调整独立分页，失败保留记录可重试，读取期间不混合筛选，卸载丢弃旧响应',async()=>{
  const ledger={id:'a',created:1,delta:-3,beforePoints:5,afterPoints:2,reason:'现场修正'};
  let reads=0,finish;
  const {p}=page('matches',{...apiBase,request:async url=>{
    if(url.includes('/score-adjustments')) {reads++;assert.equal(url,'/api/me/score-adjustments?offset=1');if(reads===1)throw Error('网络中断');return new Promise(resolve=>{finish=resolve;});}
    return {records:[],total:0,hasMore:false,adjustments:{records:[ledger],total:2,hasMore:true}};
  }});
  await p.onLoad();assert.equal(p.data.adjustments[0].pointsLabel,'-3 分');
  await p.loadAdjustments();assert.equal(p.data.adjustments.length,1);assert.equal(p.data.adjustmentsError,'网络中断');
  const pending=p.loadAdjustments();await p.loadAdjustments();p.filterScores({currentTarget:{dataset:{scored:'1'}}});assert.equal(reads,2);assert.equal(p.data.scoredOnly,false);
  p.onUnload();finish({records:[{...ledger,id:'b'}],total:2,hasMore:false});await pending;assert.equal(p.data.adjustments.length,1);
});
test('头像按风格筛选，浏览分类保留选择和昵称；新风格可保存并恢复选中', async () => {
  const presets = require('../miniprogram/builtin-avatars');
  const pixel = presets.find(item => item.id === 'pixel-32'), crayon = presets.find(item => item.id === 'crayon-32');
  const saved = { ...profile, avatarUrl: '/api/avatars/' + pixel.hash };
  const writes = [];
  const { p } = page('profile', { ...apiBase, request: async (url, method, body) => {
    if (method === 'POST') { writes.push(body); return { ...saved, version: 2 }; }
    return saved;
  } });
  await p.load();
  assert.equal(p.data.avatarStyle, 'pixel');
  assert.equal(p.data.selectedAvatar, pixel.id);
  assert.equal(p.data.visibleAvatars.length, 32);
  p.chooseAvatarStyle({ currentTarget: { dataset: { style: 'crayon' } } });
  assert.equal(p.data.avatarStyle, 'crayon');
  assert.equal(p.data.selectedAvatar, pixel.id);
  assert.equal(p.data.dirty, false);
  p.inputName({ detail: { value: '晚风' } });
  p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: crayon.id } } });
  p.chooseAvatarStyle({ currentTarget: { dataset: { style: 'sketch' } } });
  assert.equal(p.data.nickname, '晚风');
  assert.equal(p.data.avatarPreview, crayon.path);
  p.chooseAvatarStyle({ currentTarget: { dataset: { style: 'invalid' } } });
  assert.equal(p.data.avatarStyle, 'sketch');
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
  const rendered = JSON.stringify(factory('pages/profile/profile.wxml')(p.data));
  assert.match(rendered, /sketch-01.jpg/);
  assert.doesNotMatch(rendered, /pixel-01.jpg/);
  // The currently selected crayon remains in the preview while browsing another style.
  assert.match(rendered, /crayon-32.jpg/);
  await p.save();
  assert.equal(writes[0].avatar, 'builtin:' + crayon.id);
  assert.equal(writes[0].nickname, '晚风');
});
test('从个人页预览定位头像风格，延迟资料响应不打断分类浏览', async () => {
  const presets = require('../miniprogram/builtin-avatars');
  const geometric = presets.find(item => item.style === 'geometric');
  const saved = { ...profile, avatarUrl: '/api/avatars/' + geometric.hash };
  let resolveProfile;
  const { p } = page('profile', { ...apiBase, request: () => new Promise(resolve => { resolveProfile = resolve; }) }, {
    pages: [{ route: 'pages/me/me', data: { profile: { ...saved, initial: '林' } } }, {}],
  });
  const loading = p.onLoad();
  assert.equal(p.data.avatarStyle, 'geometric');
  p.chooseAvatarStyle({ currentTarget: { dataset: { style: 'sketch' } } });
  await new Promise(resolve => setImmediate(resolve));
  resolveProfile(saved); await loading;
  assert.equal(p.data.avatarStyle, 'sketch');
  assert.equal(p.data.selectedAvatar, geometric.id);
  assert.equal(p.data.dirty, false);
});
test('内置头像无需图片接口即可预览和保存，待确认时锁定选择并保留重试内容', async () => {
  const presets = require('../miniprogram/builtin-avatars');
  const writes=[]; let fail=true;
  const {p} = page('profile',{...apiBase,request:async(url,method,body,id)=>{
    if(method!=='POST') return profile;
    writes.push({body:structuredClone(body),id});
    if(fail) throw new Error('network lost');
    return {...profile,avatarUrl:'/api/avatars/'+presets[0].hash,version:2};
  }});
  await p.load();
  const pick = preset => p.chooseBuiltinAvatar({currentTarget:{dataset:{id:preset.id}}});
  pick(presets[0]);
  assert.equal(p.data.avatarPreview,presets[0].path); assert.equal(p.data.selectedAvatar,presets[0].id);
  assert.equal(p.data.dirty,true);
  await p.save(); assert.equal(p.data.pendingSave,true);
  p.chooseAvatarStyle({currentTarget:{dataset:{style:'pixel'}}}); assert.equal(p.data.avatarStyle,'classic');
  pick(presets[1]); assert.equal(p.data.selectedAvatar,presets[0].id);
  p.removeAvatar(); assert.equal(p.data.selectedAvatar,presets[0].id);
  fail=false; await p.save();
  assert.equal(writes[0].body.avatar,'builtin:'+presets[0].id);
  assert.deepEqual(writes[1],writes[0]);
});
test('已保存内置头像载入后显示选中，切换后选回原头像不产生改动', async () => {
  const presets = require('../miniprogram/builtin-avatars');
  const saved = {...profile,avatarUrl:'/api/avatars/'+presets[0].hash};
  const {p} = page('profile',{...apiBase,request:async()=>saved});
  await p.load(); assert.equal(p.data.selectedAvatar,presets[0].id);
  p.chooseBuiltinAvatar({currentTarget:{dataset:{id:presets[1].id}}}); assert.equal(p.data.dirty,true);
  p.chooseBuiltinAvatar({currentTarget:{dataset:{id:presets[0].id}}}); assert.equal(p.data.dirty,false);
  p.removeAvatar(); assert.equal(p.data.selectedAvatar,''); assert.equal(p.avatar,null); assert.equal(p.data.dirty,true);
  p.chooseBuiltinAvatar({currentTarget:{dataset:{id:presets[0].id}}}); assert.equal(p.data.dirty,false);
});
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
test('小程序保存新个人昵称后刷新大厅替换旧昵称草稿，新建及加入使用新默认值', async () => {
  let current = { ...profile, nickname: '新朋友', version: 0 };
  const writes = [];
  const api = { ...apiBase, request: async (url, method, body) => {
    if (url === '/api/me/profile' && method === 'POST') {
      current = { ...current, nickname: body.nickname, avatarUrl: '/api/avatars/new', version: current.version + 1 };
      return structuredClone(current);
    }
    if (method === 'POST') { writes.push({ url, body: structuredClone(body) }); return { code: '234567' }; }
    if (url === '/api/me/profile') return structuredClone(current);
    if (url === '/api/me/rooms') return { rooms: [] };
    throw new Error('意外请求 ' + url);
  } };
  const lobby = page('lobby', api).p;
  await lobby.refreshLobby();
  lobby.inputName({ detail: { value: '新朋友' } });
  const editor = page('profile', api).p;
  await editor.load();
  editor.inputName({ detail: { value: 'zz' } });
  editor.chooseBuiltinAvatar({ currentTarget: { dataset: { id: 'avatar-02' } } });
  await editor.save();
  await lobby.refreshLobby();
  assert.equal(lobby.data.name, 'zz');
  assert.equal(lobby.nameEdited, false);
  lobby.create();
  while (lobby.data.busy) await new Promise(resolve => setImmediate(resolve));
  await lobby.refreshLobby();
  lobby.setData({ code: '123456' });
  lobby.join();
  while (lobby.data.busy) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes.map(w => w.body.name), ['zz', 'zz']);
});
test('大厅普通刷新及仅改头像保留手动桌名，延迟资料响应不覆盖刚输入的桌名', async () => {
  let current = { ...profile, nickname: '原名', version: 1 };
  let pendingProfile;
  const api = { ...apiBase, request: async url => url === '/api/me/rooms' ? { rooms: [] }
    : pendingProfile ? pendingProfile.promise : structuredClone(current) };
  const lobby = page('lobby', api).p;
  await lobby.refreshLobby();
  lobby.inputName({ detail: { value: '本桌专用昵称' } });
  current = { ...current, avatarUrl: '/api/avatars/new', version: 2 };
  await lobby.refreshLobby();
  assert.equal(lobby.data.name, '本桌专用昵称');
  pendingProfile = deferred();
  const refresh = lobby.refreshLobby();
  await new Promise(resolve => setImmediate(resolve));
  lobby.inputName({ detail: { value: '刚输入的桌名' } });
  pendingProfile.resolve({ ...current, nickname: '新个人昵称', version: 3 });
  await refresh;
  assert.equal(lobby.data.name, '刚输入的桌名');
});
test('大厅重叠刷新只应用最新资料响应', async () => {
  const old = deferred(); let reads = 0;
  const api = { ...apiBase, request: async url => url === '/api/me/rooms' ? { rooms: [] }
    : ++reads === 1 ? old.promise : { ...profile, nickname: '最新昵称' } };
  const lobby = page('lobby', api).p;
  const first = lobby.refreshLobby();
  await new Promise(resolve => setImmediate(resolve));
  await lobby.refreshLobby();
  old.resolve({ ...profile, nickname: '过期昵称' });
  await first;
  assert.equal(lobby.data.name, '最新昵称');
});
test('大厅未修改昵称的失焦事件不阻止初次回填和个人昵称更新', async () => {
  for (const initial of ['', '旧个人昵称']) {
    const pendingProfile = deferred();
    const api = { ...apiBase, request: async url => url === '/api/me/rooms' ? { rooms: [] } : pendingProfile.promise };
    const lobby = page('lobby', api).p;
    lobby.setData({ name: initial });
    if (initial) lobby.lobbyProfileNickname = initial;
    const refresh = lobby.refreshLobby();
    await new Promise(resolve => setImmediate(resolve));
    lobby.inputName({ type: 'blur', detail: { value: initial } });
    pendingProfile.resolve({ ...profile, nickname: '最新个人昵称' });
    await refresh;
    assert.equal(lobby.data.name, '最新个人昵称');
    assert.ok(!lobby.nameEdited);
  }
});
test('大厅昵称读取失败后自动重连补齐默认值，创建和加入无需再次输入', async () => {
  let reads = 0;
  const writes = [];
  const api = { ...apiBase, request: async (url, method, body) => {
    if (method === 'POST') { writes.push({ url, body: structuredClone(body) }); return { code: '234567' }; }
    if (url === '/api/boards') return { boards: BOARDS };
    if (url === '/api/me/rooms') return { rooms: [] };
    if (++reads === 1) throw new Error('暂时无法读取昵称');
    return profile;
  } };
  const lobby = page('lobby', api).p;
  await lobby.bootstrap();
  assert.equal(lobby.data.reconnecting, true);
  await lobby.recoverConnection();
  assert.equal(lobby.data.reconnecting, false);
  assert.equal(lobby.data.name, profile.nickname);
  for (const mode of ['create', 'join']) {
    lobby.switchEntry({ currentTarget: { dataset: { mode } } });
    assert.equal(lobby.data.name, profile.nickname);
    lobby.submitEntry({ detail: { value: { nickname: lobby.data.name, code: '123456' } } });
    while (lobby.data.busy) await new Promise(resolve => setImmediate(resolve));
    await lobby.refreshLobby();
  }
  assert.deepEqual(writes.map(w => [w.url, w.body.name]), [['/api/rooms', '林间'], ['/api/rooms/123456/join', '林间']]);
});
test('大厅刷新按钮同步个人昵称，房间列表失败仍能回填昵称', async () => {
  let current = profile, failRooms = false;
  const api = { ...apiBase, request: async url => {
    if (url === '/api/me/profile') return current;
    if (failRooms) throw new Error('房间列表暂不可用');
    return { rooms: [] };
  } };
  const lobby = page('lobby', api).p;
  lobby.setData({ loading: false });
  await lobby.refreshRooms();
  assert.equal(lobby.data.name, profile.nickname);
  current = { ...profile, nickname: '改后昵称' };
  failRooms = true;
  await lobby.refreshRooms();
  assert.equal(lobby.data.name, '改后昵称');
  assert.equal(lobby.data.reconnecting, true);
});
test('实际清空本桌昵称后刷新仍保留空值，提交不得偷偷复用个人昵称', async () => {
  const writes = [];
  const api = { ...apiBase, request: async (url, method, body) => {
    if (method === 'POST') writes.push(body);
    return url === '/api/me/rooms' ? { rooms: [] } : profile;
  } };
  const lobby = page('lobby', api).p;
  lobby.setData({ loading: false });
  await lobby.refreshLobby();
  lobby.inputName({ detail: { value: '' } });
  await lobby.refreshLobby();
  assert.equal(lobby.data.name, '');
  assert.equal(lobby.nameEdited, true);
  for (const mode of ['create', 'join']) {
    lobby.switchEntry({ currentTarget: { dataset: { mode } } });
    lobby.submitEntry({ detail: { value: { nickname: '', code: '123456' } } });
    assert.match(lobby.data.error, /请填写昵称/);
  }
  assert.equal(writes.length, 0);
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
test('返回已存在的对局页直接回退，过渡保留牌桌及座位，只遮盖秘密且不读取旧页列表', async () => {
  const room = publicView(newRoom('123456', 'p1', '林间'), 'p1');
  const storage = new Map([['roomCode', room.code]]), requests = [], frames = [];
  const { p } = page('table', { ...apiBase, request: async url => { throw Error('旧页面不应读取 ' + url); } }, {
    storage, pages: [{ route: 'pages/lobby/lobby' }, { route: 'pages/table/table' }],
    wx: { offNetworkStatusChange() {}, navigateBack: options => { requests.push(options); frames.push({ room: p.data.room, secret: p.data.secret, revealed: p.data.revealed }); } },
  });
  p.roomCode = room.code;
  p.setData({ room, loading: false, secret: { role: '梅林' }, revealed: true });
  await p.returnHome(); await p.returnHome();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].delta, 1);
  assert.equal(frames[0].room, room);
  assert.equal(frames[0].secret, null);
  assert.equal(frames[0].revealed, false);
  assert.equal(storage.get('roomCode'), room.code);
  p.onHide(); p.onUnload();
  assert.equal(p.data.room, room);
  assert.equal(storage.get('roomCode'), room.code);
});
test('直接邀请返回对局及回退失败均可切换到大厅，跳转失败保留牌桌并允许重试', async () => {
  for (const cachedLobby of [false, true]) {
    const requests = [];
    const pages = [...(cachedLobby ? [{ route: 'pages/lobby/lobby' }] : []), { route: 'pages/table/table' }];
    const { p } = page('table', { ...apiBase, request: async () => { throw Error('不应读取旧页'); } }, {
      pages, wx: { navigateBack: options => options.fail(), switchTab: options => requests.push(options) },
    });
    const room = { code: '123456' }; p.roomCode = room.code; p.data.room = room;
    await p.returnHome(); await p.returnHome();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/pages/lobby/lobby');
    requests[0].fail(); requests[0].complete();
    assert.equal(p.data.room, room);
    assert.equal(p.roomCode, room.code);
    assert.match(p.data.error, /未能返回对局/);
    await p.returnHome();
    assert.equal(requests.length, 2);
  }
});
test('牌桌仍有未确认操作时返回被阻止，原房间和请求保持可重试', async () => {
  const { p, navigations } = page('table', apiBase);
  const pending = { id: 'pending-request', data: { type: 'ready' } }, room = { code: '123456' };
  p.pending = pending; p.data.room = room;
  await p.returnHome();
  assert.equal(navigations.length, 0);
  assert.equal(p.pending, pending);
  assert.equal(p.data.room, room);
  assert.match(p.data.error, /未确认请求/);
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
test('昵称原位编辑保留空值提示，完成只更新草稿，头像与昵称统一保存且失败重试锁定编辑', async () => {
  const writes=[]; let fail=true;
  const {p}=page('profile',{...apiBase,request:async(url,method,body,id)=>{
    if(method!=='POST') return profile;
    writes.push({body:structuredClone(body),id});
    if(fail) throw new Error('network lost');
    return {...profile,...body,version:2};
  }});
  await p.load(); p.editNickname();
  assert.equal(p.data.editingNickname,true);
  p.keyboardHeightChange({detail:{height:300}}); assert.equal(p.data.keyboardHeight,300);
  p.finishNicknameEdit({detail:{value:'   '}});
  assert.equal(p.data.editingNickname,true); assert.match(p.data.nicknameError,/1–16/);
  await p.save(); assert.equal(writes.length,0);
  p.inputName({detail:{value:'  晚风  '}}); assert.equal(p.data.nicknameError,'');
  p.finishNicknameEdit({detail:{value:'  晚风  '}});
  assert.equal(p.data.nickname,'晚风'); assert.equal(p.data.editingNickname,false);
  assert.equal(p.data.keyboardHeight,0); assert.equal(p.data.dirty,true); assert.equal(writes.length,0);
  const preset=require('../miniprogram/builtin-avatars')[1];
  p.chooseBuiltinAvatar({currentTarget:{dataset:{id:preset.id}}});
  // The input no longer exists in the submitted form after inline editing finishes.
  await p.save({detail:{value:{}}});
  assert.equal(writes[0].body.nickname,'晚风'); assert.equal(writes[0].body.avatar,'builtin:'+preset.id);
  p.editNickname(); assert.equal(p.data.editingNickname,false);
  p.finishNicknameEdit({detail:{value:'不能替换待确认内容'}}); assert.equal(p.data.nickname,'晚风');
  fail=false; await p.save(); assert.deepEqual(writes[1],writes[0]);
});
test('后台资料刷新不打断已进入但尚未输入的昵称编辑，迟到的键盘事件不隐藏保存按钮', async () => {
  const request=deferred();
  const {p}=page('profile',{...apiBase,request:()=>request.promise},{pages:priorMe()});
  const loading=p.onLoad(); p.editNickname();
  request.resolve({...profile,nickname:'远端昵称',version:2}); await loading;
  assert.equal(p.data.editingNickname,true); assert.equal(p.data.nickname,'林间');
  p.finishNicknameEdit({detail:{value:'林间'}});
  assert.equal(p.data.dirty,false);
  p.keyboardHeightChange({detail:{height:300}}); assert.equal(p.data.keyboardHeight,0);
});
test('战绩按阵营展开角色，对局详情与成员独立展开并在分页后保留', async () => {
  const detailedStats = { ...emptyStats, total: 2, wins: 1, losses: 1, winRate: 50,
    byFaction: [{ faction: 'good', label: '好人阵营', total: 2, wins: 1, losses: 1, excluded: 0, winRate: 50 }],
    byRole: [{ faction: 'good', role: '梅林', total: 2, wins: 1, losses: 1, excluded: 0, winRate: 50 }] };
  const stats = page('stats',{...apiBase,request:async()=>detailedStats}).p;
  await stats.load();
  assert.equal(stats.data.stats.byFaction[0].expanded,false);
  stats.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.data.stats.byFaction[0].expanded,true);
  assert.equal(stats.data.stats.byFaction[0].roles[0].rateLabel,'50%');
  stats.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.data.stats.byFaction[0].expanded,false);
  assert.equal(stats.data.stats.total,2);

  const record = (id, endedAt) => ({ id, boardName: '经典', capacity: 6, endedAt, winner: 'good', source: 'manual', excludedReason: null,
    name: '林间', seat: 1, role: '梅林', faction: 'good', outcome: 'win', members: [{seat:1,name:'林间'},{seat:2,name:'晚风'}] });
  const reads=[];
  const matches = page('matches',{...apiBase,request:async url => {
    reads.push(url);
    return url.endsWith('offset=0') ? {records:[record('one',1000)],total:2,hasMore:true} : {records:[record('two',500)],total:2,hasMore:false};
  }}).p;
  await matches.load();
  assert.equal(matches.data.records[0].expanded,false);
  assert.equal(matches.data.records[0].membersExpanded,false);
  matches.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].expanded,true);
  assert.equal(matches.data.records[0].membersExpanded,false);
  assert.equal(matches.data.records[0].members[0].isSelf,true);
  matches.toggleMembers({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].membersExpanded,true);
  matches.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].expanded,false);
  assert.equal(matches.data.records.length,1);
  assert.equal(reads.length,1);
  await matches.loadMore();
  assert.deepEqual(reads,['/api/me/matches?offset=0','/api/me/matches?offset=1']);
  assert.equal(matches.data.records.length,2);
  assert.equal(matches.data.hasMore,false);
  assert.equal(matches.data.records[0].membersExpanded,true);
  assert.equal(matches.data.records[1].membersExpanded,false);
  matches.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].membersExpanded,true);
  matches.toggleMembers({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].membersExpanded,false);
});
test('深色界面的按钮显式控制按压态，展开按钮禁用原生浅色背景与整行淡出', () => {
  const templates=fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.wxml'));
  let disclosures=0;
  for(const file of templates) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const [tag] of source.matchAll(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
      assert.match(tag,/hover-class="(?:none|me-pressed|transfer-option-hover)"/,file+': '+tag);
      if(tag.includes('aria-expanded=')) {
        disclosures++;
        assert.match(tag,/hover-class="none"/);
        assert.match(tag,/(?<![\w-])class="disclosure-button /);
      }
    }
  }
  assert.ok(disclosures>=10);
  const styles=fs.readFileSync(path.join(root,'app.wxss'),'utf8');
  assert.match(styles,/button\.disclosure-button:not\(\[disabled\]\):active\s*\{\s*opacity:\s*1;/);
});
test('新页面模板编译，资料与战绩只出现在个人页面，牌桌无底部导航内容', () => {
  const context = {window:{},global:{},console}; vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const lobby=JSON.stringify(renderMainPanel(factory,0,{isLobby:true,room:null,memberRooms:[],visibleMemberRooms:[]}));
  assert.doesNotMatch(lobby,/今晚，开一桌|和朋友面对面|总胜率|编辑资料/);
  const me=JSON.stringify(renderMainPanel(factory,1,{profile:{displayName:'林间',initial:'林'},stats:{total:0,wins:0,rateLabel:'—'}}));
  assert.match(me,/编辑资料/); assert.match(me,/对局记录/);
  assert.doesNotMatch(me,/去开一局|还没有有效战绩|逐场查看/);
  const editor=JSON.stringify(factory('pages/profile/profile.wxml')({profile:{},nickname:'林间',avatarPreview:'',initial:'林'}));
  assert.doesNotMatch(editor,/"openType":"chooseAvatar"|bindchooseavatar|avatar-canvas|上传头像/); assert.match(editor,/formType/);
  assert.match(editor,/选择头像/);
  const expandedStats=JSON.stringify(factory('pages/stats/stats.wxml')({tab:'records',stats:{total:2,wins:1,rateLabel:'50%',excluded:0,byFaction:[{faction:'good',label:'好人阵营',total:2,wins:1,rateLabel:'50%',expanded:true,roles:[{role:'梅林',total:2,wins:1,rateLabel:'50%'}]}]}}));
  assert.match(expandedStats,/梅林/); assert.match(expandedStats,/阵营战绩/);
  const matches=JSON.stringify(factory('pages/matches/matches.wxml')({records:[{id:'one',dateLabel:'今天',boardName:'经典',capacity:6,role:'梅林',factionLabel:'好人',outcomeLabel:'胜利',outcome:'win',expanded:true,membersExpanded:true,winner:'good',winnerLabel:'好人',sourceLabel:'房主登记',members:[{seat:1,name:'林间',isSelf:true}]}],total:1,hasMore:false}));
  assert.match(matches,/同桌成员/); assert.match(matches,/林间/);
  const emptyMatches=JSON.stringify(factory('pages/matches/matches.wxml')({loading:false,error:'',records:[],total:0}));
  assert.match(emptyMatches,/暂无对局记录/); assert.doesNotMatch(emptyMatches,/去开一局|逐场查看/);
});
test('窗口与顶部导航保持深色，底栏随页面绘制，所有页面都有顶部导航', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const color = '#101c24';
  assert.equal(config.window.backgroundColor, color);
  assert.equal(config.window.backgroundColorTop, color);
  assert.equal(config.window.backgroundColorBottom, color);
  assert.equal(config.window.navigationBarBackgroundColor, color);
  assert.equal(config.tabBar.backgroundColor, color);
  assert.equal(config.window.navigationStyle, 'custom');
  assert.equal(config.tabBar.custom, true);
  const routes = [...config.pages, ...(config.subPackages || []).flatMap(pkg => pkg.pages.map(route => pkg.root + '/' + route))];
  for (const route of routes) {
    const pageConfig = JSON.parse(fs.readFileSync(path.join(root, route + '.json'), 'utf8'));
    const template = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
    assert.equal(pageConfig.usingComponents['app-nav'], '/components/app-nav/app-nav', route);
    if (route.endsWith('/lobby/lobby') || route.endsWith('/me/me')) {
      assert.match(template, /<app-nav/);
    } else if (route.endsWith('/table/table')) {
      assert.match(fs.readFileSync(path.join(root, 'pages/table/shared.wxml'), 'utf8'), /<app-nav/);
    } else assert.match(template, /<app-nav/);
  }
});

test('一级页面在慢网读取前同步底栏选中态，重复显示不重绘；牌桌不操作底栏', async () => {
  const selections = [];
  const bar = { data: { selected: 0 }, setData(patch) { selections.push(patch.selected); Object.assign(this.data, patch); } };
  const login = deferred();
  const { p: me } = page('me', { ...apiBase, login: () => login.promise, request: async url =>
    url.endsWith('/profile') ? profile : url.endsWith('/stats') ? emptyStats : { records: [] } });
  me.getTabBar = () => bar;
  const refresh = me.onShow();
  assert.deepEqual(selections, [1]);
  assert.equal(me.data.profile, null);
  login.resolve(); await refresh;
  await me.onShow();
  assert.deepEqual(selections, [1]);
  const { p: lobby } = page('lobby', apiBase);
  lobby.getTabBar = () => bar;
  lobby.alive = false;
  lobby.onShow();
  const { p: table } = page('table', apiBase);
  table.getTabBar = () => { throw new Error('牌桌不应访问底栏'); };
  table.alive = false;
  table.onShow();
  assert.deepEqual(selections, [1, 0]);
});

test('个人入口使用原生导航与即时轻按态，不触发默认白色按钮背景', () => {
  const context = {window:{},global:{},console}; vm.createContext(context);
  const factory = vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const tree = renderMainPanel(factory,1,{profile:{displayName:'林间'},error:'断线'});
  const nodes = n => typeof n === 'object' ? [n,...(n.children || []).flatMap(nodes)] : [];
  const links = nodes(tree).filter(n => n.tag === 'wx-navigator');
  assert.deepEqual(links.map(n => n.attr.url), ['/pages/profile/profile','/pages/stats/stats','/pages/matches/matches?scored=1','/pages/help/help?section=scoring','/pages/matches/matches','/pages/stats/stats?tab=fun',...['leaderboard','help'].map(name => `/pages/${name}/${name}`)]);
  const points = nodes(tree).find(n => n.attr?.class === 'me-points');
  assert.deepEqual(Array.from(points.children).filter(n => n.tag === 'wx-navigator').map(n => n.attr.url), ['/pages/matches/matches?scored=1', '/pages/help/help?section=scoring']);
  assert.ok(links.every(n => !nodes(n).slice(1).some(child => child.tag === 'wx-navigator')));
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
test('新小程序连接旧服务时自动显示局数榜，周期和胜率可用，升级后恢复积分入口', async () => {
  const urls=[];let upgraded=false;
  const {p}=page('leaderboard',{...apiBase,request:async url=>{
    urls.push(url);
    const params=new URL('https://test.invalid'+url).searchParams,metric=params.get('metric');
    if(metric==='points' && !upgraded)throw Object.assign(new Error('排行榜参数无效，请刷新后重试'),{status:400});
    return rankResult(metric,{period:params.get('period'),...(upgraded?{availableMetrics:['points','games','overall','good','evil']}:{})});
  }});
  await p.onShow();
  assert.deepEqual(urls,['/api/leaderboard?metric=points&period=all','/api/leaderboard?metric=games&period=all']);
  assert.equal(p.data.metric,'games');assert.equal(p.data.board.metric,'games');assert.equal(p.data.error,'');
  assert.equal(p.data.pointsAvailable,false);assert.match(p.data.notice,/尚未开放积分榜/);
  await p.chooseMetric({currentTarget:{dataset:{id:'points'}}});assert.equal(urls.length,2);
  await p.choosePeriod({currentTarget:{dataset:{id:'month'}}});
  assert.equal(urls.at(-1),'/api/leaderboard?metric=games&period=month');
  await p.chooseGroup({currentTarget:{dataset:{id:'overall'}}});assert.equal(p.data.board.metric,'overall');
  upgraded=true;await p.onShow();assert.equal(p.data.pointsAvailable,true);assert.equal(p.data.notice,'');
  await p.chooseMetric({currentTarget:{dataset:{id:'points'}}});assert.equal(p.data.board.metric,'points');
  assert.equal(urls.at(-1),'/api/leaderboard?metric=points&period=month');
});
test('过期积分请求的参数错误不会覆盖新选择，权限和普通请求错误不降级',async()=>{
  const pending=deferred(),urls=[];
  const {p}=page('leaderboard',{...apiBase,request:url=>{
    urls.push(url);return urls.length===1?pending.promise:Promise.resolve(rankResult('good'));
  }});
  const initial=p.onShow();await new Promise(resolve=>setImmediate(resolve));
  await p.chooseMetric({currentTarget:{dataset:{id:'good'}}});
  pending.reject(Object.assign(new Error('排行榜参数无效，请刷新后重试'),{status:400}));await initial;
  assert.equal(urls.length,2);assert.equal(p.data.board.metric,'good');assert.equal(p.data.pointsAvailable,true);
  for(const [status,message] of [[401,'请重新登录'],[403,'禁止访问'],[500,'暂时无法处理'],[400,'其他输入错误']]) {
    let reads=0;
    const failed=page('leaderboard',{...apiBase,request:async()=>{reads++;throw Object.assign(new Error(message),{status});}}).p;
    await failed.onShow();assert.equal(reads,1);assert.equal(failed.data.error,message);assert.equal(failed.data.pointsAvailable,true);
  }
});
test('积分榜分页遇到旧服务后从局数榜第一页重新加载，不混合两种榜单记录',async()=>{
  const urls=[];
  const {p}=page('leaderboard',{...apiBase,request:async url=>{
    urls.push(url);
    if(url.includes('offset='))throw Object.assign(new Error('排行榜参数无效，请刷新后重试'),{status:400});
    return rankResult(url.includes('metric=points')?'points':'games',{hasMore:urls.length===1,nextOffset:20,version:'old'});
  }});
  await p.onShow();await p.loadMore();
  assert.equal(urls.at(-1),'/api/leaderboard?metric=games&period=all');
  assert.equal(p.data.board.metric,'games');assert.equal(p.data.board.rows.length,1);assert.equal(p.data.error,'');
});
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
  assert.match(render(),/rank-list/);assert.match(render(),/rank-mine/);assert.doesNotMatch(render(),/"class":"status"/);
  assert.match(render(),/rank-share-status.*正在读取榜单/);
  await p.choosePeriod({currentTarget:{dataset:{id:'month'}}});assert.equal(requests.length,2);
  requests[1].resolve(rankResult('games',{period:'month',rows:[]}));await change;
  assert.equal(frames.length,2);assert.ok(frames.every(frame=>frame.board));
  assert.equal(p.data.board.period,'month');assert.equal(p.data.loading,false);assert.match(render(),/暂无公开排名/);
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
test('排行榜底栏可开关公开展示，失败重试同一请求，游客不提交', async () => {
  let visible=false;const writes=[];
  const {p}=page('leaderboard',{...apiBase,request:async(url,method,body,id)=>{
    if(method==='POST') {
      writes.push({url,body,id});if(writes.length===1)throw Error('断线');
      visible=body.leaderboardVisible;return {leaderboardVisible:visible};
    }
    return rankResult('games',{me:{...rankResult().me,status:visible?'ranked':'hidden',rank:visible?1:null}});
  }});
  await p.load();assert.equal(p.data.visible,false);
  await p.changeVisibility({detail:{value:true}});assert.equal(p.data.visible,false);assert.equal(p.data.visibilityError,'断线');
  await p.retryVisibility();assert.deepEqual(writes[0],writes[1]);assert.equal(p.data.visible,true);
  await p.changeVisibility({detail:{value:false}});assert.equal(p.data.visible,false);assert.equal(p.data.board.me.status,'hidden');
  assert.equal(writes[2].url,'/api/me/leaderboard-visibility');
  p.data.board.me.status='unsupported';await p.changeVisibility({detail:{value:true}});assert.equal(writes.length,3);
});
test('小程序排行榜保留空榜、错误、样本量与参与入口，移除说明性文案', () => {
  const context={window:{},global:{},console};vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const rank=page('leaderboard',apiBase).p;
  const render=data=>JSON.stringify(factory('pages/leaderboard/leaderboard.wxml')({...rank.data,loading:false,...data}));
  const board={...rankResult(),metricLabel:'局数',me:{...rankResult().me,status:'hidden',rank:null,statusLabel:''},rows:[]};
  const tree=render({board,error:'请求失败',mineExpanded:true});
  assert.match(tree,/在排行榜公开展示/);assert.match(tree,/暂无公开排名/);assert.match(tree,/请求失败/);assert.doesNotMatch(tree,/同桌相聚|规则|仅展示|仅微信|满10局|满20局|尚未开启|更新于/);
  const template=fs.readFileSync(path.join(root,'pages/leaderboard/leaderboard.wxml'),'utf8');
  assert.match(template,/aria-pressed/);assert.match(template,/item.wins/);assert.match(template,/item.total/);
  const footer=template.slice(template.indexOf('<view class="rank-mine"'));
  assert.match(footer,/我的名次/);assert.match(footer,/总局数/);assert.match(footer,/board.me.rank/);
  assert.doesNotMatch(footer,/board.me.wins|board.me.total/);
  assert.match(tree,/未上榜/);
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

test('切回我的页即时保留内容，相同资料刷新不重新绑定头像和战绩', async () => {
  let delayed = false;
  const profileRead = deferred(), statsRead = deferred();
  const {p} = page('me', { ...apiBase, request: async url => {
    if (url.includes('/matches')) return { records: [], total: 0, hasMore: false };
    if (url.endsWith('/profile')) return delayed ? profileRead.promise : structuredClone(profile);
    return delayed ? statsRead.promise : structuredClone(emptyStats);
  } });
  await p.onShow();
  const previousProfile = p.data.profile, previousStats = p.data.stats;
  const patches = [], setData = p.setData;
  p.setData = function(patch) { patches.push(patch); setData.call(this, patch); };
  delayed = true;
  const refresh = p.onShow();
  assert.equal(p.data.profile, previousProfile);
  assert.equal(p.data.stats, previousStats);
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
  const rendered = JSON.stringify(renderMainPanel(factory,1,p.data));
  assert.match(rendered, /林间/);
  assert.doesNotMatch(rendered, /正在读取个人资料/);
  profileRead.resolve(structuredClone(profile)); statsRead.resolve(structuredClone(emptyStats));
  await refresh;
  assert.equal(p.data.loading, false);
  assert.equal(p.data.profile, previousProfile);
  assert.equal(p.data.stats, previousStats);
  assert.ok(patches.every(patch => !('profile' in patch) && !('stats' in patch)));
});

test('我的页后台刷新仍应用新资料，快速切换时迟到响应不覆盖新结果', async () => {
  const oldProfile = deferred(), oldStats = deferred();
  let profileReads = 0, statsReads = 0;
  const latest = { ...profile, nickname: '晚风', avatarUrl: '/api/avatars/new', version: 2 };
  const {p} = page('me', { ...apiBase, request: async url => {
    if (url.includes('/matches')) return { records: [], total: 0, hasMore: false };
    if (url.endsWith('/profile')) return ++profileReads === 1 ? oldProfile.promise : latest;
    return ++statsReads === 1 ? oldStats.promise : { ...emptyStats, total: 2, wins: 1, losses: 1, winRate: 50 };
  } });
  const first = p.onShow();
  await new Promise(resolve => setImmediate(resolve));
  await p.onShow();
  assert.equal(p.data.profile.displayName, '晚风');
  assert.equal(p.data.profile.avatarUrl, 'https://test.invalid/api/avatars/new');
  assert.equal(p.data.stats.rateLabel, '50%');
  oldProfile.resolve(profile); oldStats.resolve(emptyStats); await first;
  assert.equal(p.data.profile.displayName, '晚风');
  assert.equal(p.data.stats.total, 2);
  assert.equal(p.data.loading, false);
});

test('我的页资料先返回即可使用，战绩占位保留入口布局且失败不清空资料', async () => {
  const statsRead = deferred();
  const { p } = page('me', { ...apiBase, request: async url => {
    if (url.includes('/matches')) return { records: [], total: 0, hasMore: false };
    return url.endsWith('/profile') ? profile : statsRead.promise;
  } });
  const loading = p.load();
  await new Promise(setImmediate);
  assert.equal(p.data.profile.displayName, '林间');
  assert.equal(p.data.stats, null);
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
  const rendered = JSON.stringify(renderMainPanel(factory,1,p.data));
  assert.match(rendered, /me-stats-panel/);
  assert.match(rendered, /对局记录/);
  assert.doesNotMatch(rendered, /正在读取个人资料/);
  statsRead.reject(new Error('战绩暂不可用'));
  await loading;
  assert.equal(p.data.profile.displayName, '林间');
  assert.equal(p.data.error, '战绩暂不可用');
  assert.equal(p.data.loading, false);
});

test('大厅刷新保留空状态与表单，不插入页面加载文字，重复刷新只发送一次', async () => {
  const roomsRead = deferred(); let reads = 0;
  const { p } = page('lobby', { ...apiBase, request: async url => {
    if (url.endsWith('/profile')) return profile;
    reads++; return roomsRead.promise;
  } });
  p.data.loading = false;
  const refreshing = p.refreshRooms();
  await new Promise(setImmediate);
  await p.refreshRooms();
  assert.equal(reads, 1);
  assert.equal(p.data.loading, false);
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
  const rendered = JSON.stringify(renderMainPanel(factory,0,p.data));
  assert.match(rendered, /还没有牌桌/);
  assert.match(rendered, /刷新中/);
  assert.doesNotMatch(rendered, /正在连接牌桌/);
  roomsRead.resolve({ rooms: [] }); await refreshing;
  assert.equal(p.data.roomsRefreshing, false);
});
test('切回对局时相同列表与表单不提交视图更新，实际变化仍正常显示', async () => {
  let currentProfile = profile, rooms = [];
  const { p } = page('lobby', { ...apiBase, request: async url => url.endsWith('/profile') ? currentProfile : { rooms } });
  await p.refreshLobby(); p.data.loading = false;
  const patches = [], previousRooms = p.data.memberRooms, setData = p.setData;
  p.setData = function(patch) { patches.push(patch); setData.call(this, patch); };
  p.onShow(); await new Promise(setImmediate);
  assert.equal(patches.length, 0);
  assert.equal(p.data.memberRooms, previousRooms);
  currentProfile = { ...profile, nickname: '晚风', version: 2 };
  rooms = [{ code: '123456', status: 'lobby', seat: 2, capacity: 6, players: 2 }];
  p.onShow(); await new Promise(setImmediate);
  assert.equal(p.data.name, '晚风');
  assert.equal(p.data.memberRooms[0].code, '123456');
  assert.equal(p.data.memberRooms[0].seat, 2);
  assert.ok(patches.some(patch => 'memberRooms' in patch));
});
test('快速切回大厅时旧房间列表响应不覆盖新的列表', async () => {
  const oldRooms = deferred(); let reads = 0;
  const { p } = page('lobby', { ...apiBase, request: async () => ++reads === 1 ? oldRooms.promise : { rooms: [{ code: '234567', status: 'lobby', capacity: 6, players: 2 }] } });
  const old = p.loadRooms(); await p.loadRooms();
  oldRooms.resolve({ rooms: [{ code: '123456', status: 'lobby', capacity: 6, players: 1 }] });
  await old;
  assert.equal(p.data.memberRooms[0].code, '234567');
});

test('预取记录立即可见，首屏刷新失败后重试首屏，不误用加载更多', async () => {
  const record={id:'one',endedAt:1000,seat:1,role:'梅林',faction:'good',outcome:'win',members:[{seat:1,name:'林间'}]};
  const result={records:[record],total:1,hasMore:false};
  const reads=[],request=deferred();
  const {p}=page('matches',{...apiBase,request:url=>{reads.push(url);return reads.length===1?request.promise:Promise.resolve(result);}},{pages:priorMe({matchesPreview:result})});
  const loading=p.onLoad();assert.equal(p.data.loaded,true);assert.equal(p.data.records[0].id,'one');
  p.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  p.toggleMembers({currentTarget:{dataset:{id:'one'}}});
  request.reject(new Error('刷新失败'));await loading;
  assert.equal(p.data.records[0].expanded,true);
  await p.retry();
  assert.deepEqual(reads,['/api/me/matches?offset=0','/api/me/matches?offset=0']);
  assert.equal(p.data.error,'');assert.equal(p.data.records[0].expanded,true);
  assert.equal(p.data.records[0].membersExpanded,true);
});

test('计分表单接受服务端结束原因，提交实际目标；分值与加分标签由服务端明细展示', async () => {
  const {p}=page('table',apiBase);
  p.data.room={canUseTools:true,stage:'score-stage',players:[{seat:1,name:'甲'},{seat:2,name:'乙'}],winnerOptions:[{value:'good',label:'好人胜'}],scoreSettlement:[{id:'remote-reason',label:'服务端新结算选项',requiresTarget:true}]};
  let submission;
  p.cmd=(type,body)=>submission={type,body};
  p.finishTools();p.pickScoreReason({currentTarget:{dataset:{id:'remote-reason'}}});
  await p.saveResult();assert.equal(submission,undefined);
  p.nextResult();p.pickScoreTarget({currentTarget:{dataset:{seat:2}}});p.nextResult();await p.saveResult();
  assert.equal(submission.type,'finishTools');assert.equal(submission.body.scoreReason,'remote-reason');assert.equal(submission.body.scoreTarget,2);assert.ok(!Object.hasOwn(submission.body,'winner'));
  const presented=require('../miniprogram/profile').presentMatches([{id:'x',endedAt:1,members:[],score:{status:'scored',total:9,breakdown:[{id:'future-award',label:'服务端新增奖励',points:9}]}}]);
  const context={window:{},global:{}};vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const rendered=JSON.stringify(factory('pages/matches/matches.wxml')({records:presented.map(row=>({...row,expanded:true})),total:1}));
  assert.match(rendered,/服务端新增奖励/);assert.match(rendered,/9 分/);
});
test('不计积分的骑士登记要求实际带刀人和目标，自选目标会清空，提交独立趣味事实',async()=>{
  const {p}=page('table',apiBase);let submission;
  p.data.room={canUseTools:true,stage:'fun-stage',knights:{},players:[{seat:1,name:'甲'},{seat:2,name:'乙'}],winnerOptions:[],scoreSettlement:[],funSettlement:[{id:'early_assassination',requiresTarget:true},{id:'quest_fail',winner:'evil'}]};
  p.cmd=(type,body)=>submission={type,body};
  const choose=(handler,dataset)=>p[handler]({currentTarget:{dataset}});
  p.finishTools();choose('pickScoreReason',{id:'early_assassination'});choose('pickScoreTarget',{seat:2});await p.saveResult();assert.equal(submission,undefined);
  choose('pickFunActor',{seat:2});assert.equal(p.data.resultTarget,null);await p.saveResult();assert.equal(submission,undefined);
  choose('pickScoreTarget',{seat:1});p.nextResult();p.nextResult();p.nextResult();await p.saveResult();assert.equal(submission.body.funReason,'early_assassination');assert.equal(submission.body.funTarget,1);assert.equal(submission.body.funActor,2);assert.ok(!Object.hasOwn(submission.body,'scoreReason'));
});
test('小程序趣味战绩保留未知而非零，指标回查与分页持续保留玩法和出刀角色',async()=>{
  const aggregate=require('../server/fun').aggregate;
  const fun=aggregate([{match_id:'old',mode:'knights',metric:'knife_enemy',role:'gareth',role_label:'加雷斯',status:'unknown',count:0,opportunities:0}]);
  const stats=page('stats',{...apiBase,request:async()=>({...emptyStats,fun})}).p;await stats.onLoad({tab:'fun'});
  assert.equal(stats.data.tab,'fun');assert.equal(stats.data.stats.fun.cards[0].metrics[0].valueLabel,'—');assert.equal(stats.data.stats.fun.cards[0].roles[0].countLabel,'—');
  const urls=[];const {p}=page('matches',{...apiBase,request:async url=>{urls.push(url);return {records:[{id:String(urls.length),endedAt:1,members:[]}],total:2,hasMore:urls.length===1};}},{pages:[{route:'pages/me/me',matchesPreview:{records:[{id:'unfiltered',members:[]}],total:1}},{}]});
  await p.onLoad({fun:'knife_enemy',mode:'knights',role:'gareth'});await p.loadMore();
  assert.deepEqual(urls,['/api/me/matches?offset=0&fun=knife_enemy&mode=knights&role=gareth','/api/me/matches?offset=1&fun=knife_enemy&mode=knights&role=gareth']);
  await p.clearFunFilter();assert.equal(urls.at(-1),'/api/me/matches?offset=0');
});
test('小程序趣味榜跨板子汇总，保留筛选与样本门槛，迟到响应隔离，旧服务回退独立于积分',async()=>{
  const defs=require('../server/fun').publicMetrics();let resolveOld;const urls=[];
  const result=(metric='fun_knife_enemy')=>rankResult(metric,{fun:true,mode:'all',sort:'rate',role:'gareth',unit:'%',metricLabel:'命中敌方率',threshold:10,availableMetrics:['points','games','overall','good','evil'],availableFunMetrics:defs,roleOptions:[{id:'gareth',label:'加雷斯'}],rows:[],me:{count:3,opportunities:4,knownGames:4,rate:75,status:'not_enough',rank:null,remaining:6}});
  const {p}=page('leaderboard',{...apiBase,request:async url=>{urls.push(url);if(urls.length===1)return new Promise(resolve=>resolveOld=resolve);const metric=new URL('http://test'+url).searchParams.get('metric');return {...result(metric),...(metric==='fun_good_shield'?{role:null,roleOptions:[]}: {})};}});
  const old=p.load(false,{metric:'fun_merlin_evade'});await new Promise(resolve=>setImmediate(resolve));
  await p.load(false,{metric:'fun_knife_enemy',funSort:'rate',funRole:'gareth'});resolveOld(result('fun_merlin_evade'));await old;
  assert.match(urls[1],/mode=all&sort=rate&role=gareth/);assert.equal(p.data.board.metric,'fun_knife_enemy');assert.equal(p.data.funRoleIndex,1);assert.match(p.data.board.me.statusLabel,/还差 6 次机会/);
  assert.equal(p.data.funOptions.length,defs.filter(m=>m.key!=='fun_final_hit').length);assert.ok(p.data.funOptions.some(m=>m.key==='fun_good_shield'));assert.ok(!p.data.funOptions.some(m=>m.key==='fun_final_hit'));
  p.toggleMetrics();assert.equal(p.data.metricsExpanded,true);
  await p.chooseFunMetric({currentTarget:{dataset:{id:'fun_good_shield'}}});assert.match(urls.at(-1),/metric=fun_good_shield.*mode=all&sort=rate$/);
  assert.equal(p.data.metric,'fun_good_shield');assert.equal(p.data.funRole,'');assert.equal(p.data.metricsExpanded,false);
  p.toggleMetrics();const reads=urls.length;
  await p.chooseFunMetric({currentTarget:{dataset:{id:'fun_good_shield'}}});assert.equal(p.data.metricsExpanded,false);assert.equal(urls.length,reads);
  for (const key of ['fun_percival_bust','fun_merlin_hit','fun_assassin_miss','fun_knife_ally','fun_duel_ally']) {
    await p.chooseFunMetric({currentTarget:{dataset:{id:key}}});
    assert.match(urls.at(-1),new RegExp('metric='+key+'.*mode=all&sort=rate$'));
    assert.equal(p.data.board.metric,key);assert.equal(p.data.board.rateLabel,'发生率');
    assert.equal(p.data.metricsExpanded,false);
  }
  const fallback=page('leaderboard',{...apiBase,request:async url=>{if(url.includes('metric=fun_'))throw Object.assign(Error('排行榜参数无效'),{status:400});return rankResult('games',{availableMetrics:['points','games']});}}).p;
  await fallback.load(false,{metric:'fun_merlin_evade'});assert.equal(fallback.data.metric,'games');assert.equal(fallback.data.pointsAvailable,true);assert.equal(fallback.data.funAvailable,false);assert.match(fallback.data.notice,/趣味榜/);
});
test('积分明细入口不复用全部对局预取，过滤与后续分页持续使用计分局口径',async()=>{
  const urls=[];
  const {p}=page('matches',{...apiBase,request:async url=>{urls.push(url);return {records:[{id:String(urls.length),endedAt:1,members:[],score:{status:'scored',total:0,breakdown:[]}}],total:2,hasMore:urls.length===1};}},{pages:[{route:'pages/me/me',matchesPreview:{records:[{id:'unscored',endedAt:1,members:[]}],total:1}},{}]});
  await p.onLoad({scored:'1'});assert.equal(p.data.records[0].scoreLabel,'+0 分');
  await p.loadMore();assert.deepEqual(urls,['/api/me/matches?offset=0&scored=1','/api/me/matches?offset=1&scored=1']);
});

test('小程序分步结算取消终确认保留摘要，改原因清除旧目标，阶段变化阻止提交', async () => {
  const {p}=page('table',apiBase); const writes=[];
  p.cmd=(type,body)=>writes.push({type,body});
  p.data.room={code:'123456',stage:'flow',canUseTools:true,knights:{},scoreSettlement:[{id:'knife',label:'提前盘刀',requiresTarget:true},{id:'fail',label:'三次任务失败'}],funSettlement:[],players:[{seat:1,name:'甲'},{seat:2,name:'乙'},{seat:3,name:'出局',alive:false}],winnerOptions:[{value:'good',label:'好人胜'}]};
  const choose=(handler,dataset)=>p[handler]({currentTarget:{dataset}});
  p.finishTools();p.nextResult();assert.equal(p.data.resultStep,'reason');
  choose('pickScoreReason',{id:'knife'});p.nextResult();assert.equal(p.data.resultStep,'actor');
  choose('pickFunActor',{seat:3});p.nextResult();assert.equal(p.data.resultActor,null);assert.equal(p.data.resultStep,'actor');
  choose('pickFunActor',{seat:1});p.nextResult();choose('pickScoreTarget',{seat:1});assert.equal(p.data.resultTarget,null);
  choose('pickScoreTarget',{seat:2});p.nextResult();assert.equal(p.data.resultStep,'review');
  p.confirm=async()=>false;await p.saveResult();assert.equal(writes.length,0);assert.equal(p.data.resultDialog,true);assert.match(p.data.resultSummary[1].value,/1号/);
  p.backResult();p.backResult();p.backResult();choose('pickScoreReason',{id:'fail'});assert.equal(p.data.resultTarget,null);assert.equal(p.data.resultActor,null);
  p.nextResult();assert.equal(p.data.resultStep,'review');p.data.room.stage='later';p.confirm=async()=>true;await p.saveResult();assert.equal(writes.length,0);assert.match(p.data.error,/阶段已变化/);
  p.data.error='';p.finishTools();choose('pickResult',{value:'none'});p.nextResult();
  assert.match(p.data.resultNotice,/不计战绩及积分/);
  await p.saveResult();assert.equal(writes.length,1);assert.equal(writes[0].body.winner,null);
});

test('小程序按刺客状态跳过带刀步骤，无刺客板子仍要求选人且禁止自刀',async()=>{
  for(const scoring of [false,true]){
    const {p}=page('table',apiBase);const writes=[];p.cmd=(type,body)=>writes.push(body);p.confirm=async()=>true;
    const reason={id:'assassination',label:'三绿，已完成最终刺杀',requiresTarget:true};
    p.data.room={code:'123456',stage:'flow',canUseTools:true,knights:{},settlementRequiresActor:false,scoreSettlement:scoring?[reason]:[],funSettlement:[reason],players:[{seat:1,name:'甲'},{seat:2,name:'乙'}]};
    const choose=(handler,dataset)=>p[handler]({currentTarget:{dataset}});
    p.finishTools();choose('pickScoreReason',{id:'assassination'});p.nextResult();assert.equal(p.data.resultStep,'target');assert.equal(p.data.resultSteps.length,3);
    choose('pickScoreTarget',{seat:1});p.nextResult();assert.equal(p.data.resultStep,'review');await p.saveResult();
    assert.equal(writes.length,1);assert.equal(writes[0][scoring?'scoreTarget':'funTarget'],1);assert.ok(!Object.hasOwn(writes[0],'funActor'));
    p.data.room.settlementRequiresActor=true;delete p.data.room.knights;
    p.finishTools();choose('pickScoreReason',{id:'assassination'});p.nextResult();assert.equal(p.data.resultStep,'actor');
    choose('pickFunActor',{seat:1});p.nextResult();choose('pickScoreTarget',{seat:1});assert.equal(p.data.resultTarget,null);assert.equal(p.data.resultNeedsActor,true);
  }
});

test('趣味记录页顶部分享入口生成完整分享，单项入口仍保留，未知或读取失败时禁止分享',()=>{
  const {p,navigations}=page('stats',apiBase);
  p.setData({tab:'fun',loading:false,error:'',stats:{fun:{shareable:true,cards:[{id:'knights:knife',shareMetric:'knife_enemy'}]}}});
  p.shareStats();assert.equal(navigations[0],'/pages/share/share?kind=funSummary');
  p.shareFun({currentTarget:{dataset:{card:'knights:knife'}}});assert.match(navigations[1],/kind=fun&card=knights%3Aknife&metric=knife_enemy/);
  p.data.stats.fun.shareable=false;p.shareStats();assert.equal(navigations.length,2);
  p.data.stats.fun.shareable=true;p.data.error='读取失败';p.shareStats();assert.equal(navigations.length,2);
});
