const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BOARDS, newRoom, publicView, invitationView, enter } = require('../server/engine');
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
  else if (!home && ['stats', 'matches'].includes(route)) definition = load(path.join(root,'pages',route,'controller.js'))();
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

const renderStatsShell = factory => data => factory('pages/stats/stats.wxml')({tab:data.tab || 'records', statistics:data, history:{}, historyStarted:false, scrollTops:{}});
const renderHistoryShell = factory => data => factory('pages/matches/matches.wxml')({tab:'matches', statistics:{}, history:data, historyStarted:true, scrollTops:{}});
const emptyStats = { total:0,wins:0,losses:0,excluded:0,winRate:null,byFaction:[],byBoard:[],recent:[] };
const profile = { nickname:'林间',avatarUrl:null,version:1,identityType:'wx' };
const apiBase = { login: async () => {}, requestId: () => 'same-request-id-123', assetUrl: p => 'https://test.invalid'+p };
test('旧接口的趣味统计、历史摘要和详情统一文案，保留计数和原始响应', async () => {
  const legacy = require('./helpers/fun-copy-fixtures');
  const before = JSON.stringify(legacy);
  const api = { ...apiBase, request: async url => url.includes('/stats') ? legacy.stats
    : { records: [legacy.match], total: 1, hasMore: false } };
  const { p: stats } = page('stats', api);
  await stats.onLoad({ tab: 'fun' });
  assert.equal(stats.data.stats.fun.cards[0].enemyLabel, '刀中敌方');
  assert.equal(stats.data.stats.fun.cards[0].allyLabel, '刀中友方');
  assert.equal(stats.data.stats.fun.cards[0].metrics[1].count, 1);
  const { p: matches } = page('matches', api);
  await matches.onLoad({});
  assert.equal(matches.data.records[0].funLabel, '成功挡刀 · 刀中友方');
  assert.equal(matches.data.records[0].fun.events[1].label, '刀中友方');
  assert.equal(matches.data.records[0].fun.events[0].detail, '最终刀落到本人（1号） · 房主登记');
  assert.equal(JSON.stringify(legacy), before);
});
test('对局筛选重置分页、保留趣味回查条件，失败可重试并清空筛选', async () => {
  const urls = [];
  let fail = false;
  const record = { id: 'one', endedAt: 1, members: [], role: '魔术师', outcome: 'win' };
  const filterOptions = { boards: [{ id: 'knights', label: '十二骑士' }], roles: [{ id: '魔术师', label: '魔术师' }] };
  const { p } = page('matches', { ...apiBase, request: async url => {
    urls.push(url);
    if (fail) { fail = false; throw Error('网络中断'); }
    const more = url.includes('offset=1');
    return { records: [{ ...record, id: more ? 'two' : 'one' }], total: 2, hasMore: !more, ...(!more ? { filterOptions } : {}) };
  } });
  await p.onLoad({ scored: '1', fun: 'knife_enemy', mode: 'knights', role: 'gaheris' });
  p.toggleFilters(); assert.equal(p.data.filtersExpanded, true);
  const choose = (key, value) => p.chooseFilter({ currentTarget: { dataset: { key } }, detail: { value } });
  await choose('period', 1); await choose('board', 1); await choose('matchRole', 1); await choose('outcome', 1);
  assert.equal(urls.length, 1); assert.equal(p.data.filterCount, 0);
  await p.confirmFilters(); assert.equal(urls.length, 2); assert.equal(p.data.filtersExpanded, false);
  assert.equal(p.data.outcomeSummary, '');
  assert.equal(p.data.filterCount, 4); assert.match(p.data.filterSummary, /本月.*十二骑士.*魔术师.*胜利/);
  const query = new URL('http://test' + urls.at(-1)).searchParams;
  for (const [key, value] of Object.entries({ scored: '1', fun: 'knife_enemy', role: 'gaheris', matchRole: '魔术师', board: 'knights', outcome: 'win', period: 'month', offset: '0' }))
    assert.equal(query.get(key), value);
  await p.loadMore(); assert.equal(p.data.records.length, 2); assert.equal(new URL('http://test' + urls.at(-1)).searchParams.get('offset'), '1');
  assert.equal(p.data.outcomeSummary, '2 胜 · 0 负');
  fail = true; p.toggleFilters(); await choose('outcome', 2); await p.confirmFilters();
  assert.equal(p.data.records.length, 0); assert.equal(p.data.error, '网络中断'); assert.equal(p.data.filters.outcome, 'loss');
  const failedUrl = urls.at(-1); await p.retry(); assert.equal(urls.at(-1), failedUrl); assert.equal(p.data.error, '');
  filterOptions.boards = []; filterOptions.roles = [];
  await p.load(); assert.match(p.data.filterSummary, /十二骑士.*魔术师.*失利/);
  assert.equal(p.data.filterGroups.find(group => group.key === 'board').valueLabel, '十二骑士');
  await p.clearFilters(); assert.equal(p.data.filterCount, 0); assert.equal(p.data.records.length, 1);
  assert.equal(urls.at(-1), '/api/me/matches?offset=0&scored=1&fun=knife_enemy&mode=knights&role=gaheris');
  const old = page('matches', { ...apiBase, request: async () => ({ records: [], total: 0 }) }).p;
  await old.onLoad({}); assert.equal(old.data.filtersAvailable, false);
});
test('筛选弹层的关闭放弃草稿，重置只改草稿，重复确认不请求且不丢失已展开记录', async () => {
  const urls = [];
  const { p } = page('matches', { ...apiBase, request: async url => {
    urls.push(url);
    return { records: [{ id: 'one', endedAt: 1, members: [] }], total: 1, hasMore: false, filterOptions: { boards: [], roles: [] } };
  } });
  await p.onLoad();
  const choose = index => p.chooseFilter({ currentTarget: { dataset: { key: 'outcome' } }, detail: { value: index } });
  choose(1); assert.equal(p.data.draftFilters.outcome, '');
  p.toggleFilters(); choose(1); p.closeFilters();
  assert.equal(p.data.filters.outcome, ''); assert.equal(urls.length, 1);
  p.toggleFilters(); assert.equal(p.data.draftFilters.outcome, '');
  choose(2); await p.confirmFilters(); assert.equal(p.data.filters.outcome, 'loss');
  p.toggleRecord({ currentTarget: { dataset: { id: 'one' } } });
  p.toggleFilters(); await p.confirmFilters();
  assert.equal(urls.length, 2); assert.equal(p.data.records[0].expanded, true);
  p.toggleFilters(); p.resetDraftFilters();
  assert.equal(p.data.draftFilters.outcome, ''); assert.equal(p.data.filters.outcome, 'loss');
  p.closeFilters(); p.toggleFilters(); assert.equal(p.data.draftFilters.outcome, 'loss');
  p.resetDraftFilters(); await p.confirmFilters();
  assert.equal(p.data.filterCount, 0); assert.equal(urls.length, 3);
  p.fetching = true; p.toggleFilters(); assert.equal(p.data.filtersExpanded, false);
});
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
    assert.match(lobby.data.entryNameError, /请填写昵称/);
  }
  assert.equal(writes.length, 0);
});
test('首页进入独立牌桌，切后台时建房成功不强行跳转；邀请留在目标房间填写昵称', async () => {
  const api = { ...apiBase, request: async (url,method) => method==='POST' ? {code:'234567'} : url==='/api/boards' ? {boards:BOARDS} : url==='/api/me/rooms' ? {rooms:[]} : url==='/api/me/profile' ? {nickname:'新朋友',nicknameConfirmed:false,version:0} : {code:'654321',createdAt:123,phase:'lobby',isMember:false} };
  const first = page('lobby',api); first.p.data.name='林间';
  await first.p.mutate('/api/rooms',{name:'林间'},'enter');
  assert.deepEqual(first.navigations,['/pages/table/table?code=234567&resume=1']); assert.equal(first.p.data.room,null);
  first.navigations.length=0; first.p.foreground=false;
  await first.p.mutate('/api/rooms',{name:'林间'},'enter'); assert.equal(first.navigations.length,0);
  const invited = page('table',api); invited.p.inviteCode='654321'; await invited.p.bootstrap();
  assert.equal(invited.p.data.invitation.code,'654321'); assert.equal(invited.p.data.invitationNeedsName,true); assert.deepEqual(invited.navigations,[]);
});
test('返回已有牌桌沿用成员接口，服务端尚未部署邀请接口时仍可进入', async () => {
  const room = newRoom('654321', 'host', '子龙');
  const calls = [];
  const api = { ...apiBase, request: async url => {
    calls.push(url);
    if (url === '/api/boards') return { boards: BOARDS };
    if (url === '/api/me/rooms') return { rooms: [] };
    if (url === '/api/rooms/654321') return publicView(room, 'host');
    throw Object.assign(Error('接口不存在'), { status: 404 });
  } };
  const home = page('lobby', api);
  await home.p.enterTable(room.code);
  const query = Object.fromEntries(new URL('https://test.invalid' + home.navigations[0]).searchParams);
  const table = page('table', api);
  await table.p.onLoad(query);
  assert.equal(table.p.data.room.code, room.code);
  assert.equal(table.p.data.invitation, null);
  assert.equal(table.p.data.error, '');
  assert.equal(calls.some(url => url.includes('/invitation')), false);
  table.p.onUnload();
});
function invitationClient(room, { nicknameConfirmed = true, uid = 'friend', storage = new Map(), appState = {}, failJoin = false } = {}) {
  const calls = [], writes = [];
  const api = { ...apiBase, request: async (url, method, body, id) => {
    calls.push(url);
    const pathname = url.split('?')[0];
    if (pathname === '/api/boards') return { boards: BOARDS };
    if (pathname.endsWith('/invitation')) return invitationView(room, uid);
    if (pathname === '/api/me/profile') return { nickname: nicknameConfirmed ? '晚风' : '新朋友', nicknameConfirmed, version: 0 };
    if (method === 'POST') {
      writes.push({ url, body, id });
      enter(room, uid, body.name);
      if (failJoin && writes.length === 1) throw Error('response lost');
      return { code: room.code };
    }
    return publicView(room, uid);
  } };
  return { ...page('table', api, { storage, appState }), calls, writes };
}
test('分享自动加入指定房间，优先于旧房间；有昵称无需确认，不自动准备', async () => {
  const room = newRoom('654321', 'host', '子龙', 'knights', 12);
  const c = invitationClient(room, { storage: new Map([['roomCode', '123456']]) });
  await c.p.onLoad({ code: room.code, instance: String(room.createdAt) });
  assert.equal(c.p.data.room.code, room.code);
  assert.equal(c.p.data.room.me.name, '晚风');
  assert.equal(c.p.data.room.me.ready, false);
  assert.equal(c.p.data.room.me.seat, 2);
  assert.equal(c.storage.get('roomCode'), room.code);
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].body.createdAt, room.createdAt);
  assert.equal(c.calls.some(url => url.includes('123456')), false);
  assert.deepEqual(c.navigations, []);
});
test('首次邀请只填写昵称，读取原生表单最终值，确认后仍进入原目标房间', async () => {
  const room = newRoom('654321', 'host', '子龙');
  const c = invitationClient(room, { nicknameConfirmed: false });
  await c.p.onLoad({ code: room.code, instance: String(room.createdAt) });
  assert.equal(c.writes.length, 0);
  assert.equal(c.p.data.invitationNeedsName, true);
  await c.p.submitInvitation({ detail: { value: { nickname: '  ' } } });
  assert.equal(c.p.data.entryNameError, '请填写昵称');
  assert.equal(c.writes.length, 0);
  await c.p.submitInvitation({ detail: { value: { nickname: ' 微信最终昵称 ', code: '123456' } } });
  assert.equal(c.writes[0].body.name, '微信最终昵称');
  assert.equal(c.writes[0].body.confirmNickname, true);
  assert.equal(c.writes[0].url, '/api/rooms/654321/join');
  assert.equal(c.p.data.room.code, room.code);
  assert.equal(c.p.data.invitation, null);
  assert.equal(c.p.data.entryNameError, '');
});
test('满座邀请进入旁观，开局后新成员被提示，原成员恢复自己的座位', async () => {
  const full = newRoom('654321', 'host', '子龙');
  for (let i = 1; i < full.capacity; i++) enter(full, 'p' + i, '玩家' + i);
  const spectator = invitationClient(full);
  await spectator.p.onLoad({ code: full.code });
  assert.equal(spectator.p.data.room.me.seat, null);
  assert.match(spectator.p.data.notice, /座位已满.*旁观者/);
  const playing = newRoom('234567', 'host', '子龙');
  playing.phase = 'identity';
  const newcomer = invitationClient(playing);
  await newcomer.p.onLoad({ code: playing.code });
  assert.equal(newcomer.writes.length, 0);
  assert.match(newcomer.p.data.invitationError, /本局已开始/);
  assert.deepEqual(newcomer.navigations, []);
  const member = invitationClient(playing, { uid: 'host' });
  await member.p.onLoad({ code: playing.code });
  assert.equal(member.p.data.room.me.seat, 1);
  assert.equal(member.writes.length, 0);
});
test('加入响应丢失后保留目标、创建信息与编号，重试只恢复同一成员', async () => {
  const room = newRoom('654321', 'host', '子龙');
  const c = invitationClient(room, { failJoin: true });
  await c.p.onLoad({ code: room.code, instance: String(room.createdAt) });
  assert.equal(c.p.data.reconnecting, true);
  assert.ok(c.storage.has('pendingEntry'));
  await c.p.retry();
  assert.equal(c.writes.length, 2);
  assert.equal(c.writes[0].id, c.writes[1].id);
  assert.equal(c.writes[1].body.createdAt, room.createdAt);
  assert.equal(room.players.filter(p => p.uid === 'friend').length, 1);
  assert.equal(c.p.data.room.code, room.code);
  assert.equal(c.storage.has('pendingEntry'), false);
});
test('断线加入重试确认已经开局后停止重连，清除待确认状态并允许返回', async () => {
  let joins = 0;
  const c = page('table', { ...apiBase, request: async (url, method) => {
    if (url === '/api/boards') return { boards: BOARDS };
    if (url.includes('/invitation')) return { code: '654321', createdAt: 100, isMember: false, phase: 'lobby' };
    if (url === '/api/me/profile') return { nickname: '晚风', nicknameConfirmed: true, version: 0 };
    if (method === 'POST') {
      if (++joins === 1) throw Error('offline');
      throw Object.assign(Error('游戏已开始，无法加入'), { status: 400 });
    }
    throw Error('不应恢复旧房间');
  } });
  await c.p.onLoad({ code: '654321', instance: '100' });
  assert.equal(c.p.data.hasPendingRequest, true);
  await c.p.retry();
  assert.equal(c.p.pending, null);
  assert.equal(c.p.data.hasPendingRequest, false);
  assert.equal(c.p.data.reconnecting, false);
  assert.equal(c.storage.has('pendingEntry'), false);
  assert.match(c.p.data.invitationError, /本局已开始/);
  await c.p.returnHome();
  assert.deepEqual(c.navigations, ['/pages/lobby/lobby']);
});
test('无效、解散及过期邀请原地显示原因，不恢复本地旧房间', async () => {
  for (const [status, text] of [[404, /已解散/], [410, /已失效/]]) {
    const calls = [];
    const c = page('table', { ...apiBase, request: async url => {
      calls.push(url);
      if (url === '/api/boards') return { boards: BOARDS };
      throw Object.assign(Error('invitation unavailable'), { status });
    } }, { storage: new Map([['roomCode', '123456']]) });
    await c.p.onLoad({ code: '654321', instance: '123' });
    assert.match(c.p.data.invitationError, text);
    assert.equal(c.p.data.room, null);
    assert.equal(calls.some(url => url.includes('123456')), false);
    assert.deepEqual(c.navigations, []);
  }
  const c = page('table', { ...apiBase, request: async () => { throw Error('不得读取'); } });
  await c.p.onLoad({ code: 'bad-code', instance: '123' });
  assert.match(c.p.data.invitationError, /邀请无效/);
});
test('其他房间的待确认加入保持原请求，邀请不会恢复或覆盖它', async () => {
  const pending = { path: '/api/rooms/123456/join', data: { name: '旧昵称' }, after: 'enter', id: 'original-request-key' };
  const storage = new Map([['pendingEntry', pending], ['roomCode', '123456']]);
  const c = invitationClient(newRoom('654321', 'host', '子龙'), { storage });
  await c.p.onLoad({ code: '654321' });
  assert.equal(c.writes.length, 0);
  assert.equal(storage.get('pendingEntry'), pending);
  assert.match(c.p.data.invitationError, /尚未确认/);
  assert.equal(c.p.data.invitation.code, '654321');
  assert.deepEqual(c.navigations, []);
});
test('按钮与菜单分享同一房间实例，只用专用封面，不包含身份或实时人数', async () => {
  const room = publicView(newRoom('654321', 'host', '子龙', 'knights', 12), 'host');
  const c = page('table', apiBase);
  c.p.data.room = room;
  c.p.data.secret = { role: '梅林', information: '私密同伴' };
  c.p.shareCover = { path: null, promise: Promise.resolve('temp-room-cover.png') };
  const content = c.p.onShareAppMessage({ from: 'button' });
  assert.equal(content.path, `/pages/table/table?code=654321&instance=${room.createdAt}`);
  assert.equal(content.title, '子龙邀你加入阿瓦隆 · 房间 654321');
  assert.equal(content.imageUrl, '/assets/share-cover.jpg');
  assert.equal((await content.promise).imageUrl, 'temp-room-cover.png');
  assert.equal(c.p.onShareAppMessage({ from: 'menu' }).path, content.path);
  assert.doesNotMatch(JSON.stringify(content), /梅林|私密同伴|players|ready|occupied/);
  c.p.clearRoom();
  assert.equal(c.p.onShareAppMessage().path, '/pages/lobby/lobby');
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
  assert.equal(stats.data.stats.byFaction[0].expanded,true);
  stats.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.data.stats.byFaction[0].expanded,false);
  assert.equal(stats.data.stats.byFaction[0].roles[0].rateLabel,'50%');
  stats.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.data.stats.byFaction[0].expanded,true);
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
      assert.match(tag,/hover-class="(?:none|me-pressed|transfer-option-hover|ledger-pressed|room-invite-pressed)"/,file+': '+tag);
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
  const expandedStats=JSON.stringify(renderStatsShell(factory)({tab:'records',stats:{total:2,wins:1,rateLabel:'50%',excluded:0,byFaction:[{faction:'good',label:'好人阵营',total:2,wins:1,rateLabel:'50%',expanded:true,roles:[{role:'梅林',total:2,wins:1,rateLabel:'50%'}]}]}}));
  assert.match(expandedStats,/梅林/); assert.match(expandedStats,/阵营与角色/);
  const matches=JSON.stringify(renderHistoryShell(factory)({records:[{id:'one',dateLabel:'今天',boardName:'经典',capacity:6,role:'梅林',factionLabel:'好人',outcomeLabel:'胜利',outcome:'win',expanded:true,membersExpanded:true,winner:'good',winnerLabel:'好人',sourceLabel:'房主登记',members:[{seat:1,name:'林间',isSelf:true}]}],total:1,hasMore:false}));
  assert.match(matches,/同桌成员/); assert.match(matches,/林间/);
  const emptyMatches=JSON.stringify(renderHistoryShell(factory)({loading:false,error:'',records:[],total:0}));
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
    } else if (['pages/stats/stats','pages/matches/matches'].includes(route)) {
      assert.match(template, /records\/shell.wxml/);
      assert.match(fs.readFileSync(path.join(root,'pages/records/shell.wxml'),'utf8'), /<app-nav/);
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
  assert.deepEqual(links.map(n => n.attr.url), ['/pages/profile/profile','/pages/stats/stats','/pages/scores/scores','/pages/matches/matches','/pages/stats/stats?tab=fun',...['leaderboard','help'].map(name => `/pages/${name}/${name}`)]);
  const points = nodes(tree).find(n => n.attr?.class === 'me-points');
  assert.deepEqual(Array.from(points.children).filter(n => n.tag === 'wx-navigator').map(n => n.attr.url), ['/pages/scores/scores']);
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
test('小程序排行榜头像复用战绩卡，显示最新公开资料，失败可重试且支持头像占位', async () => {
  let fail=true;const urls=[];
  const {p}=page('leaderboard',{...apiBase,request:async url=>{
    urls.push(url);
    if(!url.endsWith('/stats'))return rankResult();
    if(fail)throw Error('读取失败');
    return {player:{id:'player',name:'新昵称',avatarUrl:'/assets/avatar.svg'},status:'available',stats:{total:40,wins:25,winRate:62.5,scoreTotal:80,byFaction:[]}};
  }});
  await p.onShow();p.data.mineExpanded=true;
  await p.openRankPlayerCard({currentTarget:{dataset:{id:'player'}}});
  assert.equal(p.data.mineExpanded,false);assert.equal(p.data.playerCardError,'读取失败');
  fail=false;await p.retryPlayerCard();
  assert.equal(urls.at(-1),'/api/leaderboard/players/player/stats');
  assert.equal(p.data.playerCard.scope,'leaderboard');assert.equal(p.data.playerCard.name,'新昵称');
  assert.equal(p.data.playerCard.avatarUrl,'https://test.invalid/assets/avatar.svg');
  assert.equal(p.data.playerCardStats.rateLabel,'62.5%');assert.equal(p.data.playerCardStats.total,40);
  p.data.board.rows[0].avatarUrl='/old.svg';
  p.rankAvatarError({currentTarget:{dataset:{id:'player',url:'/old.svg'}}});
  assert.equal(p.data.board.rows[0].avatarFailed,true);
  await p.openRankPlayerCard({currentTarget:{dataset:{id:'player'}}});
  assert.equal(p.data.playerCardStats.total,40);
});
test('小程序排行榜关闭、隐藏、卸载或切换筛选后忽略旧卡片响应，快速换人不串数据', async () => {
  for(const leave of ['closePlayerCard','onHide','onUnload','filter']) {
    const pending=deferred();
    const {p}=page('leaderboard',{...apiBase,request:url=>url.endsWith('/stats')?pending.promise:Promise.resolve(rankResult())});
    await p.onShow();const opening=p.openRankPlayerCard({currentTarget:{dataset:{id:'player'}}});
    if(leave==='filter')await p.load(false,{period:'month'});else p[leave]();
    pending.resolve({player:{id:'player',name:'旧昵称'},status:'available',stats:{total:0,wins:0,winRate:null,scoreTotal:0,byFaction:[]}});
    await opening;assert.equal(p.data.playerCard,null,leave);assert.equal(p.data.playerCardStats,null,leave);
  }
  const calls=[];
  const {p}=page('leaderboard',{...apiBase,request:()=>{const pending=deferred();calls.push(pending);return pending.promise;}});
  p.data.loading=false;p.data.board={rows:[{publicId:'a',nickname:'甲'},{publicId:'b',nickname:'乙'}]};
  const first=p.openRankPlayerCard({currentTarget:{dataset:{id:'a'}}});
  const second=p.openRankPlayerCard({currentTarget:{dataset:{id:'b'}}});
  calls[1].resolve({player:{id:'b',name:'乙'},status:'available',stats:{total:0,wins:0,winRate:null,scoreTotal:0,byFaction:[]}});await second;
  calls[0].reject(Error('旧请求失败'));await first;
  assert.equal(p.data.playerCard.id,'b');assert.equal(p.data.playerCardError,'');assert.equal(p.data.playerCardStats.rateLabel,'—');
});
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
test('小程序排行榜保留空榜、错误、样本量与参与入口，规则按需展示', () => {
  const context={window:{},global:{},console};vm.createContext(context);
  const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
  const rank=page('leaderboard',apiBase).p;
  const render=data=>JSON.stringify(factory('pages/leaderboard/leaderboard.wxml')({...rank.data,loading:false,...data}));
  const board={...rankResult(),metricLabel:'局数',me:{...rankResult().me,status:'hidden',rank:null,statusLabel:''},rows:[]};
  const tree=render({board,error:'请求失败',mineExpanded:true});
  assert.match(tree,/在排行榜公开展示/);assert.match(tree,/暂无公开排名/);assert.match(tree,/请求失败/);assert.doesNotMatch(tree,/同桌相聚|仅展示|仅微信|满10局|满20局|尚未开启|更新于/);
  const template=fs.readFileSync(path.join(root,'pages/leaderboard/leaderboard.wxml'),'utf8');
  assert.match(template,/aria-pressed/);assert.match(template,/item.secondaryLabel/);
  const footer=template.slice(template.indexOf('<view class="rank-mine"'));
  assert.match(footer,/我的排名/);assert.match(footer,/board.valueHeading/);assert.match(footer,/board.me.rank/);
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

test('战绩即时显示预览，单阵营默认展开，刷新保留用户收起且不修改上级数据', async () => {
  const request=deferred();
  const stats={...previewStats,total:1,byFaction:[{faction:'good',total:1,expanded:false,roles:[]}]};
  const pages=priorMe();pages[0].data.stats=stats;
  const {p}=page('stats',{...apiBase,request:()=>request.promise},{pages});
  const loading=p.onLoad(); assert.equal(p.data.stats.total,1);
  p.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  assert.equal(stats.byFaction[0].expanded,false);
  request.resolve({...emptyStats,total:2,byFaction:[{faction:'good',total:2,winRate:50}]}); await loading;
  assert.equal(p.data.stats.total,2);assert.equal(p.data.stats.byFaction[0].expanded,false);
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
  const rendered=JSON.stringify(renderHistoryShell(factory)({records:presented.map(row=>({...row,expanded:true})),total:1}));
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
  const result=(metric='fun_knife_enemy')=>rankResult(metric,{fun:true,mode:'all',sort:'rate',role:'gareth',unit:'%',metricLabel:'刀中敌方率',threshold:10,availableMetrics:['points','games','overall','good','evil'],availableFunMetrics:defs,roleOptions:[{id:'gareth',label:'加雷斯'}],rows:[],me:{count:3,opportunities:4,knownGames:4,rate:75,status:'not_enough',rank:null,remaining:6}});
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
test('旧计分对局入口不复用全部对局预取，过滤与后续分页持续使用计分局口径',async()=>{
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

test('战绩三个页签在同页保留筛选、详情、滚动位置和折叠状态，只首次进入读取数据', async () => {
  const reads = [], legacy = require('./helpers/fun-copy-fixtures');
  const api = { ...apiBase, request: async url => {
    reads.push(url);
    return url.includes('/stats') ? legacy.stats : { records: [legacy.match], total: 1, hasMore: false,
      filterOptions: { boards: [], roles: [{ id: '魔术师', label: '魔术师' }] } };
  } };
  const { p, navigations } = page('stats', api, { home: true });
  await p.onLoad(); assert.equal(p.data.tab, 'records'); assert.equal(reads.length, 1);
  p.rememberScroll({ currentTarget: { dataset: { tab: 'records' } }, detail: { scrollTop: 180 } });
  await p.switchPanel('matches');
  p.historyToggleFilters();
  await p.historyChooseFilter({ currentTarget: { dataset: { key: 'matchRole' } }, detail: { value: 1 } });
  await p.historyConfirmFilters();
  p.historyToggleRecord({ currentTarget: { dataset: { id: legacy.match.id } } });
  p.rememberScroll({ currentTarget: { dataset: { tab: 'matches' } }, detail: { scrollTop: 350 } });
  p.shareStats(); assert.equal(navigations.length, 0);
  await p.switchPanel('fun'); p.toggleFunRules();
  p.rememberScroll({ currentTarget: { dataset: { tab: 'fun' } }, detail: { scrollTop: 90 } });
  await p.switchPanel('matches');
  assert.equal(p.data.history.filters.matchRole, '魔术师'); assert.equal(p.data.history.records[0].expanded, true);
  assert.equal(p.data.scrollTops.matches, 350);
  await p.switchPanel('records'); assert.equal(p.data.scrollTops.records, 180);
  await p.switchPanel('fun'); assert.equal(p.data.scrollTops.fun, 90); assert.equal(p.data.statistics.funRulesExpanded, true);
  assert.equal(reads.filter(url => url.includes('/stats')).length, 1); assert.equal(reads.length, 3);
  assert.equal(navigations.length, 0);
  p.shareStats(); assert.equal(navigations[0], '/pages/share/share?kind=funSummary');
  await p.switchPanel('matches'); p.historyToggleFilters(); p.back();
  assert.equal(p.data.tab, 'matches'); assert.equal(p.data.history.filtersExpanded, false);
  p.historyToggleFilters(); await p.switchPanel('records');
  assert.equal(p.data.history.filtersExpanded, false);
});

test('旧对局入口直接选中记录页签；统计失败不阻塞记录，返回统计仍可重试', async () => {
  let statsReads = 0;
  const { p } = page('matches', { ...apiBase, request: async url => {
    if (!url.includes('/stats')) return { records: [], total: 0 };
    if (++statsReads === 1) throw Error('统计暂不可用');
    return emptyStats;
  } }, { home: true });
  await p.onLoad({ scored: '1' });
  assert.equal(p.data.tab, 'matches'); assert.equal(p.data.history.scoredOnly, true); assert.equal(statsReads, 0);
  await p.switchPanel('records'); assert.equal(p.data.statistics.error, '统计暂不可用');
  await p.switchPanel('matches'); assert.equal(p.data.history.error, '');
  await p.switchPanel('records'); await p.load();
  assert.equal(p.data.statistics.error, ''); assert.equal(statsReads, 2);
});

test('趣味回查切到记录并可返回原位置，新回查和离开页面不被旧请求覆盖', async () => {
  const first = deferred(), second = deferred(), reads = [];
  const { p, navigations } = page('stats', { ...apiBase, request: url => {
    if (url.includes('/stats')) return Promise.resolve(require('./helpers/fun-copy-fixtures').stats);
    reads.push(url); return reads.length === 1 ? first.promise : second.promise;
  } }, { home: true });
  await p.onLoad({ tab: 'fun' });
  p.rememberScroll({ currentTarget: { dataset: { tab: 'fun' } }, detail: { scrollTop: 420 } });
  const open = url => p.openFunMatches({ currentTarget: { dataset: { url } } });
  const old = open('/pages/matches/matches?fun=knife_enemy&mode=knights&role=gaheris');
  await new Promise(resolve => setImmediate(resolve));
  const latest = open('/pages/matches/matches?fun=good_shield&mode=classic');
  await new Promise(resolve => setImmediate(resolve));
  second.resolve({ records: [{ id: 'new', endedAt: 1, members: [] }], total: 1 }); await latest;
  first.resolve({ records: [{ id: 'old', endedAt: 1, members: [] }], total: 1 }); await old;
  assert.equal(p.data.history.records[0].id, 'new'); assert.equal(p.data.history.funFilter.metric, 'good_shield');
  assert.match(reads[0], /role=gaheris/); assert.equal(p.data.tab, 'matches');
  await p.back(); assert.equal(p.data.tab, 'fun'); assert.equal(p.data.scrollTops.fun, 420); assert.equal(navigations.length, 0);
  await p.switchPanel('matches'); await p.historyClearFunFilter();
  assert.equal(p.data.historyFromFun, false); p.back(); assert.equal(navigations[0], 'back');
  const slow = deferred(); p.historyController.onUnload();
  // A fresh host tests actual disposal while its first request is outstanding.
  const leaving = page('stats', { ...apiBase, request: () => slow.promise }, { home: true }).p;
  const pending = leaving.onLoad(); leaving.onUnload();
  slow.resolve(emptyStats); await pending; assert.equal(leaving.data.statistics.stats, null);
});

test('积分入口打开独立页面且保留统计位置；角色展开与刷新状态保持', async () => {
  const detail = { ...emptyStats, total: 12, score: { total: 2, games: 0, average: null },
    byFaction: [{ faction: 'good', label: '好人阵营', total: 12, wins: 6, winRate: 50 }],
    byRole: Array.from({ length: 7 }, (_, i) => ({ role: '角色' + i, faction: 'good', total: 1, wins: 0, winRate: 0 })) };
  const { p, navigations } = page('stats', { ...apiBase, request: async url => url.includes('/stats') ? detail
    : { records: [], total: 0, adjustments: { records: [{ id: 'adjustment', created: 1, delta: 2 }], total: 1 } } }, { home: true });
  await p.onLoad(); assert.equal(p.data.statistics.stats.byFaction[0].expanded, true);
  p.toggleFactionRoles({ currentTarget: { dataset: { faction: 'good' } } }); await p.load();
  assert.equal(p.data.statistics.stats.byFaction[0].rolesExpanded, true);
  p.toggleFaction({ currentTarget: { dataset: { faction: 'good' } } }); await p.load();
  assert.equal(p.data.statistics.stats.byFaction[0].expanded, false);
  p.rememberScroll({ currentTarget: { dataset: { tab: 'records' } }, detail: { scrollTop: 300 } });
  await p.openScoreHistory(); assert.equal(p.data.tab, 'records');
  assert.equal(navigations[0], '/pages/scores/scores'); assert.equal(p.data.historyStarted, false);
  assert.equal(p.scrollPositions.records, 300);
});

test('积分明细统一分页，失败保留记录可重试，重复触底和卸载不重复追加', async () => {
  const first = { id: 'adjustment:a', type: 'adjustment', occurredAt: 1, points: -3, beforePoints: 5, afterPoints: 2, reason: '现场修正' };
  const result = { records: [first], total: 2, hasMore: true, revision: 7, summary: { total: 2, matchPoints: 5, adjustmentPoints: -3, games: 1, adjustments: 1 } };
  const later = deferred(); let reads = 0;
  const { p } = page('scores', { ...apiBase, request: async url => {
    if (!url.includes('offset=1')) return result;
    reads++; assert.equal(url, '/api/me/score-ledger?offset=1&revision=7');
    if (reads === 1) throw Error('网络中断');
    return later.promise;
  } });
  await p.onLoad(); assert.equal(p.data.records[0].pointsLabel, '-3');
  await p.onReachBottom(); assert.equal(p.data.moreError, '网络中断'); assert.equal(p.data.records.length, 1);
  await p.onReachBottom(); assert.equal(reads, 1);
  const pending = p.retryMore(); await p.onReachBottom(); assert.equal(reads, 2);
  p.onUnload(); later.resolve({ ...result, records: [{ ...first, id: 'b' }], hasMore: false }); await pending;
  assert.equal(p.data.records.length, 1);
});

test('积分分页期间分数变化会重新读取，零分与只有调整均保留，点对局进入详情后正常返回', async () => {
  const match = { id: 'match:m', type: 'match', matchId: 'm', occurredAt: 1, points: 0, boardName: '经典', role: '梅林', outcome: 'loss' };
  let reads = 0, fail = true, scrolling = 0, stopped = 0;
  const result = { records: [match], total: 2, hasMore: true, revision: 1, summary: { total: 2, matchPoints: 0, adjustmentPoints: 2, games: 1, adjustments: 1 } };
  const { p, navigations } = page('scores', { ...apiBase, request: async url => {
    if (fail) { fail = false; throw Error('暂时离线'); }
    if (url.includes('offset=1')) throw Object.assign(Error('更新'), { status: 409 });
    reads++; return reads === 1 ? result : { ...result, revision: 2, total: 1, hasMore: false, records: [{ id: 'adjustment:a', type: 'adjustment', occurredAt: 1, points: 2 }], summary: { ...result.summary, games: 0 } };
  } }, { wx: { pageScrollTo: () => scrolling++, stopPullDownRefresh: () => stopped++ } });
  await p.onLoad(); assert.equal(p.data.loaded, false); assert.equal(p.data.error, '暂时离线');
  await p.load(); assert.equal(p.data.records[0].pointsLabel, '0');
  p.openMatch({ currentTarget: { dataset: { id: 'match:m' } } });
  assert.equal(navigations[0], '/pages/match-detail/match-detail?id=m');
  await p.onReachBottom(); assert.equal(scrolling, 1); assert.equal(p.data.records.length, 1);
  assert.equal(p.data.records[0].type, 'adjustment'); assert.match(p.data.notice, /有更新/);
  p.openMatch({ currentTarget: { dataset: { id: 'adjustment:a' } } }); assert.equal(navigations.length, 1);
  await p.onPullDownRefresh(); assert.equal(stopped, 1); p.back(); assert.equal(navigations.at(-1), 'back');
  const row = require('./helpers/fun-copy-fixtures').match;
  const detail = page('match-detail', { ...apiBase, request: async url => { assert.equal(url, '/api/me/matches/m'); return { record: row }; } });
  await detail.p.onLoad({ id: 'm' }); assert.equal(detail.p.data.record.id, row.id);
  detail.p.historyToggleMembers(); assert.equal(detail.p.data.record.membersExpanded, true);
  detail.p.back(); assert.equal(detail.navigations[0], 'back');
  const removed = page('match-detail', { ...apiBase, request: async () => { throw Error('对局记录不存在或已移除'); } }).p;
  await removed.onLoad({ id: 'gone' }); assert.equal(removed.data.record, null); assert.match(removed.data.error, /已移除/);
});

test('首页入口按需展开，关闭保留草稿且清理键盘；原生键盘晚到的事件不会复活面板', () => {
  let hidden = 0;
  const { p } = page('lobby', apiBase, { wx: { hideKeyboard() { hidden++; } } });
  p.setData({ loading: false, name: '子龙', nicknameSetup: false });
  assert.equal(p.data.entrySheet, false);
  p.switchEntry({ currentTarget: { dataset: { mode: 'join' } } });
  assert.equal(p.data.entrySheet, true);
  assert.equal(p.data.entryEditingName, false);
  assert.equal(p.data.entryFocusedField, 'code');
  p.entryKeyboardChange({ detail: { height: 280 } });
  assert.equal(p.data.entryKeyboardHeight, 280);
  p.inputCode({ detail: { value: '062819' } });
  p.closeEntry();
  assert.equal(p.data.code, '062819');
  assert.equal(p.data.entryKeyboardHeight, 0);
  assert.equal(hidden, 1);
  p.entryKeyboardChange({ detail: { height: 280 } });
  assert.equal(p.data.entryKeyboardHeight, 0);
  p.switchEntry({ currentTarget: { dataset: { mode: 'create' } } });
  assert.equal(p.data.entryFocusedField, '');
  p.editEntryName();
  assert.equal(p.data.entryFocusedField, 'nickname');
  p.onHide();
  assert.equal(p.data.entryFocusedField, '');
});

test('粘贴只接受完整六码、保留前导零，关闭或切换面板后忽略剪贴板回调', () => {
  const callbacks = [];
  const { p } = page('lobby', apiBase, { wx: { getClipboardData(options) { callbacks.push(options); } } });
  p.setData({ loading: false, name: '子龙', nicknameSetup: false });
  const open = mode => p.switchEntry({ currentTarget: { dataset: { mode } } });
  open('join');
  p.pasteRoomCode(); callbacks.pop().success({ data: ' 062819 ' });
  assert.equal(p.data.code, '062819');
  p.pasteRoomCode(); callbacks.pop().success({ data: '1234567' });
  assert.match(p.data.entryCodeError, /完整/);
  assert.equal(p.data.code, '062819');
  p.pasteRoomCode(); p.closeEntry(); open('join');
  callbacks.pop().success({ data: '999999' });
  assert.equal(p.data.code, '062819');
  p.pasteRoomCode(); open('create');
  callbacks.pop().fail();
  assert.equal(p.data.entryCodeError, '');
});

test('加入面板提交收起的昵称；显式清空和不完整房间码就近校验，不发请求', async () => {
  const writes = [];
  const { p } = page('lobby', apiBase);
  p.mutate = async (...args) => writes.push(args);
  p.setData({ loading: false, name: '子龙', nicknameSetup: false });
  p.switchEntry({ currentTarget: { dataset: { mode: 'join' } } });
  p.submitEntry({ detail: { value: { code: '062819' } } });
  assert.equal(writes[0][0], '/api/rooms/062819/join');
  assert.equal(writes[0][1].name, '子龙');
  p.submitEntry({ detail: { value: { nickname: '', code: '062819' } } });
  assert.match(p.data.entryNameError, /昵称/);
  assert.equal(p.data.entryFocusedField, 'nickname');
  assert.equal(p.data.error, '');
  p.submitEntry({ detail: { value: { nickname: '新名字', code: '123' } } });
  assert.match(p.data.entryCodeError, /6 位/);
  assert.equal(p.data.entryFocusedField, 'code');
  assert.equal(writes.length, 1);
});

test('加入面板中的业务错误保留表单，未确认的网络请求锁住面板且复用幂等键', async () => {
  const writes = []; let failure = 'business';
  const { p } = page('lobby', { ...apiBase, request: async (url, method, body, id) => {
    if (method !== 'POST') return { rooms: [] };
    writes.push({ url, body, id });
    if (failure === 'business') throw Object.assign(Error('房间不存在'), { status: 404 });
    if (failure === 'network') throw Error('offline');
    return { code: '123456' };
  } });
  p.setData({ loading: false, name: '子龙', nicknameSetup: false });
  p.switchEntry({ currentTarget: { dataset: { mode: 'join' } } });
  const form = { detail: { value: { code: '123456' } } };
  p.submitEntry(form); while (p.data.busy) await new Promise(setImmediate);
  assert.equal(p.data.entrySheet, true);
  assert.equal(p.data.entryError, '房间不存在');
  assert.equal(p.data.error, '');
  failure = 'network';
  p.submitEntry(form); while (p.data.busy) await new Promise(setImmediate);
  assert.equal(p.data.hasPendingRequest, true);
  p.closeEntry();
  assert.equal(p.data.entrySheet, true);
  const original = p.pending;
  p.submitEntry(form);
  assert.equal(p.pending, original);
  failure = '';
  await p.retry();
  assert.equal(writes[1].id, writes[2].id);
  assert.deepEqual(writes[1].body, writes[2].body);
  assert.equal(p.data.entrySheet, false);
});

test('分享邀请自动打开加入面板，首页列表合并房主信息且复制不触发访问', async () => {
  const copies = [], writes = [];
  const { p } = page('lobby', { ...apiBase, request: async (url, method) => {
    if (method === 'POST') writes.push(url);
    if (url.endsWith('/boards')) return { boards: BOARDS };
    if (url.endsWith('/profile')) return profile;
    return { rooms: [{ code: '123456', boardName: '阿瓦隆 · 十二骑士', capacity: 12, occupied: 1, isHost: true, hostName: '林间', seat: 1, status: 'lobby' }] };
  } }, { wx: { setClipboardData(options) { copies.push(options.data); } } });
  await p.onLoad({ code: '062819' });
  assert.equal(p.data.entrySheet, true);
  assert.equal(p.data.code, '062819');
  assert.equal(p.data.entryFocusedField, 'code');
  assert.equal(p.data.memberRooms[0].compactRelation, '我是房主 · 1号');
  p.copyListedRoom({ currentTarget: { dataset: { code: '123456' } } });
  assert.deepEqual(copies, ['123456']);
  assert.equal(writes.length, 0);
});

test('首页表单打开立即收起底栏，关闭、成功进入房间和切换区域时正确恢复', async () => {
  const bar = { data: { selected: 0, entrySheetVisible: false }, setData(patch) { Object.assign(this.data, patch); } };
  const api = { ...apiBase, request: async url => url === '/api/boards' ? { boards: BOARDS }
    : url.endsWith('/profile') ? profile : url.endsWith('/stats') ? emptyStats : { rooms: [], records: [], total: 0 } };
  const { p } = page('lobby', api, { home: true });
  p.getTabBar = () => bar;
  p.onLoad(); await p.onShow();
  const open = mode => p.switchEntry({ currentTarget: { dataset: { mode } } });
  for (const mode of ['join', 'create']) {
    open(mode);
    assert.equal(bar.data.entrySheetVisible, true);
    p.entryKeyboardChange({ detail: { height: 280 } });
    p.entryKeyboardChange({ detail: { height: 0 } });
    assert.equal(bar.data.entrySheetVisible, true);
    p.closeEntry();
    assert.equal(bar.data.entrySheetVisible, false);
  }
  open('join');
  p.onHide(); await p.onShow();
  assert.equal(bar.data.entrySheetVisible, true);
  await p.enterTable('123456');
  assert.equal(bar.data.entrySheetVisible, false);
  open('create');
  await p.switchMainTab(1);
  assert.equal(bar.data.entrySheetVisible, false);
  await p.switchMainTab(0);
  assert.equal(bar.data.entrySheetVisible, true);
  p.onUnload();
});

test('趣味指标弹层取消不换榜，确认才请求，切分类保留草稿并关闭其他弹层',async()=>{
  const defs=require('../server/fun').publicMetrics(),urls=[];
  const {p}=page('leaderboard',{...apiBase,request:async url=>{urls.push(url);return rankResult(new URL('http://test'+url).searchParams.get('metric'),{fun:true,sort:'count',unit:'次',availableFunMetrics:defs,rows:[],me:{rank:null,status:'no_records',knownGames:0}});}});
  await p.load(false,{metric:'fun_good_shield'});
  const pick=(fn,id)=>p[fn]({currentTarget:{dataset:{id}}});
  p.toggleMine();p.toggleMetrics();assert.equal(p.data.mineExpanded,false);
  pick('chooseFunCategory','evil');pick('previewFunMetric','fun_assassin_miss');
  assert.equal(p.data.metric,'fun_good_shield');assert.equal(urls.length,1);
  p.toggleMetrics();assert.equal(urls.length,1);
  p.toggleMetrics();assert.equal(p.data.pendingFunMetric,'fun_good_shield');
  pick('chooseFunCategory','evil');pick('previewFunMetric','fun_assassin_miss');pick('chooseFunCategory','more');
  assert.equal(p.data.pendingFunMetric,'fun_assassin_miss');
  await p.confirmFunMetric();assert.match(urls.at(-1),/metric=fun_assassin_miss/);assert.equal(p.data.metricsExpanded,false);
  p.toggleRules();p.toggleMine();assert.equal(p.data.rulesExpanded,false);
});
