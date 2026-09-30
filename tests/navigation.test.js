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
test('头像按风格筛选，浏览分类保留选择和昵称；新风格可保存并恢复选中', async () => {
  const presets = require('../miniprogram/builtin-avatars');
  const pixel = presets.find(item => item.id === 'pixel-20'), crayon = presets.find(item => item.id === 'crayon-13');
  const saved = { ...profile, avatarUrl: '/api/avatars/' + pixel.hash };
  const writes = [];
  const { p } = page('profile', { ...apiBase, request: async (url, method, body) => {
    if (method === 'POST') { writes.push(body); return { ...saved, version: 2 }; }
    return saved;
  } });
  await p.load();
  assert.equal(p.data.avatarStyle, 'pixel');
  assert.equal(p.data.selectedAvatar, pixel.id);
  assert.equal(p.data.visibleAvatars.length, 20);
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
  assert.match(rendered, /crayon-13.jpg/);
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
  assert.equal(p.data.dirty,true); assert.equal(p.data.choosing,false);
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
  stats.toggleFaction({currentTarget:{dataset:{faction:'good'}}});
  stats.toggleOverview();
  assert.equal(stats.data.overviewExpanded,false);
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
  matches.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].expanded,true);
  assert.equal(matches.data.records[0].members[0].isSelf,true);
  matches.toggleRecord({currentTarget:{dataset:{id:'one'}}});
  assert.equal(matches.data.records[0].expanded,false);
  assert.equal(matches.data.records.length,1);
  assert.equal(reads.length,1);
  await matches.loadMore();
  assert.deepEqual(reads,['/api/me/matches?offset=0','/api/me/matches?offset=1']);
  assert.equal(matches.data.records.length,2);
  assert.equal(matches.data.hasMore,false);
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
  assert.deepEqual(links.map(n => n.attr.url), ['profile','stats','matches','leaderboard','help'].map(name => `/pages/${name}/${name}`));
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
  const tree=render({board,error:'请求失败'});
  assert.match(tree,/在排行榜公开展示/);assert.match(tree,/暂无战绩/);assert.match(tree,/请求失败/);assert.doesNotMatch(tree,/同桌相聚|规则|仅展示|仅微信|满10局|满20局|尚未开启|更新于/);
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
