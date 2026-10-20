const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { newRoom, enter, command, publicView, BOARDS } = require("../server/engine");

function client(fetch, storage = new Map([["session", "session"]]), layout, runtime = {}) {
  let scheduled, scheduledDelay;
  const events = {};
  const scrolls = [], lookups = [], navigations = [];
  const element = { querySelector() { return null; }, focus() {}, scrollIntoView(options) { scrolls.push(options); }, addEventListener(name, fn) { events['app:' + name] = fn; }, removeEventListener(name, fn) { if (events['app:' + name] === fn) delete events['app:' + name]; }, hidden: true, classList: { add() {}, remove() {} } };
  if (layout) element.querySelector = () => ({ focus() {}, getBoundingClientRect: () => layout.anchor });
  const source = fs.readFileSync(require.resolve("../server/web/app.js"), "utf8");
  const context = {
    document: { hidden: false, getElementById: id => { lookups.push(id); return element; }, addEventListener(name, fn) { events[name] = fn; } },
    location: { hash: "#/lobby" },
    window: { location: { replace: url => navigations.push(url), reload: () => navigations.push('reload') }, history: { replaceState() {}, pushState() {} }, scrollTo() {}, innerHeight: layout?.height, addEventListener(name, fn) { events["window:" + name] = fn; }, shadowtableBuiltinAvatars: require('../miniprogram/builtin-avatars'), shadowtableAvatarStyles: require('../miniprogram/avatar-library').avatarStyles, shadowtableFunCopy: require('../miniprogram/fun-copy') },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    navigator: {},
    fetch,
    setTimeout(fn, delay) { scheduled = fn; scheduledDelay = delay; return 1; },
    clearTimeout() { scheduled = undefined; },
    URL, URLSearchParams, console,
    ...runtime,
  };
  context.window.shadowtableBadges = require('../miniprogram/badges');
  context.window.shadowtableHonors = require('../miniprogram/honors');
  context.window.shadowtableLeaderboard = require('../miniprogram/leaderboard-presentation');
  context.window.shadowtableMonthlyReport = require('../miniprogram/monthly-report');
  context.window.shadowtableMonthlyCard = require('../miniprogram/monthly-report-card');
  context.window.shadowtablePublicHistory = require('../miniprogram/public-history');
  context.window.shadowtableRoomSwipe = require('../miniprogram/room-swipe');
  context.window.shadowtableRoomList = require('../miniprogram/room-list');
  context.window.shadowtableResultRegistration = require('../miniprogram/result-registration');
  context.window.shadowtableBoardDetail = require('../miniprogram/board-detail');
  context.window.shadowtableAvoidance = require('../miniprogram/avoidance');
  vm.runInNewContext(source.slice(0, source.indexOf("  // ===== boot =====")) + `
    render = function () {};
    roomCode = "123456";
    window.test = { grantNotifier, request, requestId, mutate, handleError, recoverConnection, retry, login, state, schedule, loadSettings, settingsSave, CHANGES, ACTIONS, viewActionDialog, refresh, viewRoom, viewHostBar, viewSettingsDialog, kickFromSettings, sendKick,
      viewHonorBallot, viewHonors, viewHistorySheet, viewHistoryEntry, viewPlayerCard, openPlayerCard, closePlayerCard, viewDealtIdentity, viewIdentityHistory, showIdentityHintWhenVisible, viewStats, viewResultDialog, seatAvatarError, loadMatches, viewMatches, viewAvoidance,
      navigate, applyRoute, loadProfile, saveProfile, viewNavigation, INPUTS, loadLeaderboard, viewLeaderboard, viewProfileEditor, viewMe, viewMonthlyReport, viewBadgeManager, viewBoardDetails,
      initializeWebAccount, startWebLogin, pollWebLogin, cancelWebLogin, continueAsGuest, viewWebLogin, bootstrap,
      viewEntry, loadRooms, startRoomSwipe, moveRoomSwipe, finishRoomSwipe, closeRoomSwipe,
      getWebSessionTag() { return webSessionTag; },
      setConfirm(fn) { confirm = fn; },
      setRefresh(fn) { refresh = fn; },
      stop() { foreground = false; }
    };
  })();`, context);
  return { ...context.window.test, scrolls, lookups, navigations, events, document: context.document, scheduled: () => scheduled, scheduledDelay: () => scheduledDelay };
}
const response = (body) => ({ status: 200, json: async () => body });
test('网页收卡通过主题弹窗展示，未确认不读，身份或操作面板打开时延后提醒', async () => {
  const calls = [], dialogs = [];
  let notice = { through: 'grant-1', amount: 2, grants: 1 }, accepted = false;
  const c = client(async (url, options = {}) => {
    calls.push([url, options]);
    if (options.method === 'POST') { notice = null; return response({ acknowledged: true }); }
    return response({ balance: 4, notice });
  });
  c.state.loading = false; c.state.page = 'table'; c.state.room = { phase: 'lobby', me: { avoidance: { balance: 2 } } };
  c.setConfirm(async (...args) => { dialogs.push(args); return accepted; });
  try {
    c.state.avoidanceOpen = true; await c.grantNotifier.start(); assert.equal(calls.length, 0);
    c.state.avoidanceOpen = false;
    for (const page of ['lobby', 'me']) { c.state.page = page; await c.grantNotifier.check(); assert.equal(calls.length, 0); }
    c.state.page = 'table';
    for (const phase of ['vote', 'identity', 'ended', 'terminated']) { c.state.room.phase = phase; await c.grantNotifier.check(); assert.equal(calls.length, 0); }
    c.state.room.phase = 'lobby'; await c.grantNotifier.check();
    assert.equal(dialogs.length, 1); assert.equal(dialogs[0][0], '收到回避卡'); assert.equal(dialogs[0][2], false); assert.equal(dialogs[0][3], '知道了');
    assert.match(dialogs[0][1], /本次获得 \+2 张/); assert.doesNotMatch(dialogs[0][1], /管理员|发放/); assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 0);
    assert.equal(c.state.room.me.avoidance.balance, 4);
    accepted = true; await c.grantNotifier.check();
    assert.equal(calls.filter(([, options]) => options.method === 'POST').length, 1);
    await c.grantNotifier.check(); assert.equal(dialogs.length, 2);
  } finally { c.grantNotifier.stop(); c.stop(); }
});
test('收卡弹窗未确认时房主发牌，收到新房间状态后立即收起且不标记已读', async () => {
  const room = newRoom('123456', 'host', '房主', 'classic', 6);
  for (let i = 2; i <= 6; i++) enter(room, 'p' + i, '玩家' + i);
  for (const player of room.players) command(room, player.uid, { type: 'ready', ready: true, stage: room.stage });
  const writes = [];
  const c = client(async (url, options = {}) => {
    if (options.method === 'POST') writes.push(url);
    return response(url.includes('/avoidance/notice') ? { balance: 1, notice: { through: 'grant-1', amount: 1, grants: 1 } }
      : url.endsWith('/private') ? require('../server/engine').privateView(room, 'host') : publicView(room, 'host'));
  });
  c.state.loading = false; c.state.page = 'table'; c.state.room = publicView(room, 'host');
  try {
    const notification = c.grantNotifier.start();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.equal(c.document.getElementById('modal').hidden, false);
    command(room, 'host', { type: 'start', flexible: true, stage: room.stage });
    await c.refresh(); await notification;
    assert.equal(c.document.getElementById('modal').hidden, true);
    assert.deepEqual(writes, []);
    assert.doesNotMatch(c.viewRoom(), /data-action="openAvoidance"/);
  } finally { c.grantNotifier.stop(); c.stop(); }
});
test('网页房间管理按有效性与权限展示可用操作，省略额外说明并保留关闭入口', () => {
  const c = client(async () => response({})); c.state.loading = false;
  try {
    for (const available of [true, false]) for (const isHost of [true, false]) for (const canLeave of [true, false, undefined]) {
      c.state.roomMenu = { code: '273843', boardName: '<十二骑士>', statusLabel: '已结束', available, isHost, isMember: true, canLeave };
      const html = c.viewEntry().split('<div class="dialog-backdrop room-menu-backdrop">')[1];
      assert.ok(html); assert.match(html, /aria-label="关闭房间管理"/); assert.match(html, /&lt;十二骑士&gt;/);
      assert.equal((html.match(/data-action="closeRoomMenu"/g) || []).length, 2);
      assert.equal(html.includes('data-kind="leave"'), available && canLeave === true);
      assert.equal(html.includes('data-kind="delete"'), available && isHost);
      assert.ok(html.includes(available ? '从列表移除' : '移除失效记录'));
      assert.ok(html.includes(available ? '已结束' : '已失效'));
      assert.doesNotMatch(html, /连续.*3.*天|战绩与复盘|当前状态暂不可离开|离开权限暂未同步/);
    }
    c.ACTIONS.closeRoomMenu(); assert.equal(c.state.roomMenu, null);
    c.state.roomMenu = { code: '273843', available: true, isMember: false, canLeave: true };
    assert.doesNotMatch(c.viewEntry(), /data-kind="leave"/);
    c.state.busy = true;
    const locked = c.viewEntry().split('<div class="dialog-backdrop room-menu-backdrop">')[1];
    assert.equal((locked.match(/data-action="closeRoomMenu"[^>]* disabled/g) || []).length, 2);
    c.ACTIONS.closeRoomMenu(); assert.ok(c.state.roomMenu);
  } finally { c.stop(); }
});
test('网页房间管理打开时聚焦关闭按钮，关闭后回到对应房间入口', () => {
  const c = client(async () => response({})), focused = [];
  c.document.getElementById('app').querySelector = selector => ({ focus: options => focused.push({ selector, options }) });
  c.state.memberRooms = [{ code: '273843', available: false }];
  c.ACTIONS.openRoomMenu({ dataset: { code: '273843' } });
  assert.equal(focused[0].selector, '.room-list-dialog input, .room-list-dialog button:not(:disabled)');
  assert.equal(focused[0].options.preventScroll, true);
  c.ACTIONS.closeRoomMenu();
  assert.equal(focused[1].selector, '[data-action="openRoomMenu"][data-code="273843"]');
  assert.equal(focused[1].options.preventScroll, true);
  assert.equal(c.state.roomMenu, null); c.stop();
});
test('网页房间到期410返回列表并显示失效提示，不继续轮询旧房间', async () => {
  const c=client(async url=>url==='/api/me/rooms'?response({rooms:[{code:'123456',status:'unavailable',available:false}]}):{status:410,json:async()=>({error:'房间已失效'})});
  Object.assign(c.state,{loading:false,room:{code:'123456'}});await c.refresh();
  assert.equal(c.state.room,null);assert.match(c.state.notice,/房间已失效/);
  assert.equal(c.state.memberRooms.length,0);assert.doesNotMatch(c.state.notice,/请清理/);
});
test('网页自动隐藏失效记录，展开历史仅展示有效房间，移除失效筛选和清理入口', async () => {
  const now=Date.now(),rooms=[{code:'111111',status:'lobby',available:true},
    ...Array.from({length:5},(_,i)=>({code:String(222220+i),status:'ended',available:true,lastActivityAt:now-i*1000})),
    {code:'333333',status:'ended',available:true,lastActivityAt:now-3*86400000},
    {code:'444444',status:'unavailable',available:false}];
  const c=client(async()=>response({rooms,serverTime:now}));
  try {
    c.state.loading=false;await c.loadRooms();
    let html=c.viewEntry();assert.equal((html.match(/data-room-swipe=/g)||[]).length,4);
    assert.match(html,/历史牌桌/);assert.match(html,/class="room-subheading"><span>最近结束/);
    c.ACTIONS.toggleRoomHistory();html=c.viewEntry();
    assert.equal((html.match(/data-room-swipe=/g)||[]).length,7);
    assert.match(html,/data-room-swipe="333333"/);
    assert.doesNotMatch(html,/data-room-swipe="444444"|room-cleanup|data-filter="unavailable"|已失效/);
    assert.equal(c.ACTIONS.cleanupUnavailableRooms,undefined);
    c.ACTIONS.filterRooms({dataset:{filter:'ended'}});c.ACTIONS.toggleRoomHistory();
    assert.equal((c.viewEntry().match(/data-room-swipe=/g)||[]).length,6);
    c.ACTIONS.filterRooms({dataset:{filter:'unavailable'}});assert.equal(c.state.roomListFilter,'ended');
    c.ACTIONS.filterRooms({dataset:{filter:'lobby'}});html=c.viewEntry();
    assert.equal((html.match(/data-room-swipe=/g)||[]).length,1);assert.doesNotMatch(html,/历史牌桌/);
  } finally {c.stop();}
});
test('网页牌桌复制只复制所选房间号，失效记录仍可复制且不触发进入请求', async () => {
  const copied = [], writes = [];
  const c = client(async (...args) => { writes.push(args); return response({}); }, new Map(), undefined,
    { navigator: { clipboard: { writeText: async text => copied.push(text) } } });
  try {
    c.state.memberRooms = [{ code: '201375', available: true }, { code: '534718', available: false }];
    await c.ACTIONS.copyListedRoom({ dataset: { code: '201375' } });
    await c.ACTIONS.copyListedRoom({ dataset: { code: '534718' } });
    await c.ACTIONS.copyListedRoom({ dataset: { code: '000000' } });
    assert.deepEqual(copied, ['201375', '534718']);
    assert.equal(writes.length, 0);
  } finally { c.stop(); }
});
test('网页仅有失效房间时显示创建加入空态，旧数据重新加入后恢复，无需写入请求', async () => {
  let rooms=[{code:'123456',status:'unavailable',available:false}],writes=0,dialogs=0;
  const c=client(async(url,options)=>{if(options.method==='POST')writes++;return response({rooms});});
  try {
    c.state.loading=false;c.setConfirm(()=>{dialogs++;return true;});await c.loadRooms();
    let html=c.viewEntry();assert.match(html,/还没有牌桌/);
    assert.doesNotMatch(html,/历史牌桌|room-cleanup|data-filter="unavailable"|没有符合条件/);
    rooms=[{code:'123456',status:'lobby',available:true}];await c.loadRooms();
    html=c.viewEntry();assert.match(html,/data-room-swipe="123456"/);
    assert.doesNotMatch(html,/还没有牌桌/);assert.equal(writes,0);assert.equal(dialogs,0);
  } finally {c.stop();}
});
test('网页各板子详情自适应技能和规则模式，搜索不受牌组限制，目录跳转先展开目标', () => {
  const c = client(async () => response({}));
  c.state.boards = BOARDS.map(board => ({...board,detail:require('../server/board-info')[board.id]}));
  for (const source of c.state.boards.filter(b=>b.available)) for (const capacity of source.counts) {
    c.state.room = { board:source.id, boardName:source.name, capacity };
    c.ACTIONS.openBoardDetails();
    let html = c.viewBoardDetails();
    assert.match(html,/角色配置|角色速查/);
    assert.match(html,new RegExp(capacity+' 人'));
    if (c.state.boardDetail.hasRoles) {
      c.INPUTS.boardDetailSearch({value:'女巫'});
      assert.match(c.viewBoardDetails(),/>女巫</);
      c.ACTIONS.boardDetailGroup({dataset:{value:'b-evil'}});
      assert.equal(c.state.boardDetailQuery,'');
      assert.match(c.viewBoardDetails(),/>石像鬼</);
      c.ACTIONS.toggleBoardRole({dataset:{value:'1:4'}});
      assert.match(c.viewBoardDetails(),/detail-role-body/);
    } else assert.doesNotMatch(html,/搜索角色或技能/);
    c.ACTIONS.openBoardDirectory();assert.match(c.viewBoardDetails(),/aria-label="章节目录"/);
    c.ACTIONS.jumpBoardSection({dataset:{value:'1'}});
    assert.equal(c.state.boardDirectory,false);assert.equal(c.state.boardDetailTab,'rules');assert.equal(c.state.boardChapters[1].expanded,true);
    c.ACTIONS.toggleAllBoardChapters();assert.ok(c.state.boardChapters.every(ch=>ch.expanded));
    c.ACTIONS.closeBoardDetails();assert.equal(c.viewBoardDetails(),'');
  }
  c.stop();
});
test('网页通过房间码在进行中和终局加入旁观，提示手动入座且不展示身份入口', async () => {
  for (const phase of ['identity', 'ended', 'terminated']) {
    const room = newRoom('123456', 'host', '房主'); room.phase = phase;
    const writes = [];
    const c = client(async (url, options) => {
      if (options?.method === 'POST') {
        const data = JSON.parse(options.body); writes.push({ url, data });
        enter(room, 'late', data.name);
        return response({ code: room.code });
      }
      return response(publicView(room, 'late'));
    });
    try {
      await c.mutate('/api/rooms/123456/join', { name: '迟到的朋友' }, 'enter');
      assert.equal(writes.length, 1);
      assert.equal(c.state.room.me.seat, null);
      assert.equal(c.state.room.me.ready, false);
      assert.equal(room.players.length, 1);
      const html = c.viewRoom();
      assert.match(html, phase === 'identity' ? /本局进行中，你正在旁观/ : /本局已结束，你正在旁观/);
      assert.match(html, /手动入座/);
      assert.doesNotMatch(html, /data-action="reveal"|data-action="ready"/);
      room.phase = 'lobby';
      await c.refresh();
      assert.equal(c.state.room.me.seat, null);
      assert.match(c.viewRoom(), /点击入座/);
      assert.doesNotMatch(c.viewRoom(), /本局进行中|本局已结束/);
    } finally { c.stop(); }
  }
});
function webSwipeEvent(code, x = 250, y = 400) {
  const row = { dataset: { roomSwipe: code } };
  const content = { closest: () => row };
  return { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
    target: { closest: selector => selector === '.room-swipe-content' ? content : row } };
}
function webSwipe(c, code, x = 60) {
  c.startRoomSwipe(webSwipeEvent(code)); c.moveRoomSwipe(webSwipeEvent(code, x)); c.finishRoomSwipe();
}
test('网页左滑按身份和房间状态显示操作，关闭时不向键盘和读屏暴露隐藏按钮', () => {
  const c = client(async () => response({}));
  c.state.loading = false;
  c.state.historyExpanded = true;
  for (const [status, isHost, available, canDelete] of [['lobby',true,true,true], ['ended',true,true,true],
    ['playing',true,true,false], ['lobby',false,true,false], ['unavailable',false,false,false]]) {
    c.state.memberRooms = [{ code:'123456', status, isHost, available }];
    c.closeRoomSwipe();
    const closed = c.viewEntry();
    if (!available) { assert.doesNotMatch(closed, /data-room-swipe|room-swipe-actions/); continue; }
    assert.match(closed, /class="room-swipe-actions" aria-hidden="true" inert/);
    webSwipe(c, '123456');
    const open = c.viewEntry();
    assert.equal(open.includes('data-kind="delete"'), canDelete);
    assert.match(open, /class="room-swipe-actions" aria-hidden="false"/);
    assert.match(open, /data-action="openRoomMenu"/);
    assert.equal(c.state.roomSwipeOffset, -124);
  }
});
test('网页左滑不写请求，纵滑和取消收起，只有一条展开且筛选和切页清理状态', async () => {
  const writes = [];
  const c = client(async (url, options) => {
    if (options.method === 'POST') writes.push(url);
    return response(url.endsWith('/rooms') ? { rooms: [] } : {});
  });
  Object.assign(c.state, { loading:false, memberRooms:[{code:'123456',status:'lobby',isHost:true},{code:'234567',status:'playing',isHost:true}] });
  webSwipe(c,'123456');
  c.events['app:click']({ detail:1, preventDefault() {}, target:{ closest:() => null } });
  assert.equal(writes.length,0);
  webSwipe(c,'234567'); assert.equal(c.state.roomSwipeCode,'234567');
  c.startRoomSwipe(webSwipeEvent('234567')); c.moveRoomSwipe(webSwipeEvent('234567',240,510)); c.finishRoomSwipe();
  assert.equal(c.state.roomSwipeCode,'');
  webSwipe(c,'123456'); c.startRoomSwipe(webSwipeEvent('123456')); c.finishRoomSwipe(true);
  assert.equal(c.state.roomSwipeCode,'');
  c.startRoomSwipe(webSwipeEvent('123456')); c.moveRoomSwipe(webSwipeEvent('123456',60)); c.closeRoomSwipe();
  c.events['app:click']({ detail:1, preventDefault() {}, target:{ closest:()=>({dataset:{action:'openRoom',code:'123456'}}) } });
  assert.equal(writes.length,0);
  webSwipe(c,'123456'); c.ACTIONS.filterRooms({dataset:{filter:'lobby'}});
  assert.equal(c.state.roomSwipeCode,'');
  webSwipe(c,'123456'); await c.applyRoute('#/me');
  assert.equal(c.state.roomSwipeCode,''); assert.equal(writes.length,0);
});
test('网页左滑和菜单移除均须确认，取消或离开页面不提交，确认后不显示撤销', async () => {
  for (const source of ['swipe', 'menu']) for (const result of ['cancel', 'confirm', 'background', 'failure']) {
    let hidden = false, resolveConfirm;
    const writes = [], dialogs = [];
    const room = {code:'123456',status:'lobby',isHost:true,available:true};
    const c = client(async (url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); writes.push({url,body});
        if (result === 'failure') return {status:409,json:async()=>({error:'列表已更新'})};
        hidden = body.action === 'hide'; return response({code:room.code,accepted:true});
      }
      return response({rooms:hidden?[]:[room]});
    });
    c.setConfirm((title, message, showCancel, label) => {
      dialogs.push({title,message,label});
      return new Promise(resolve => { resolveConfirm = resolve; });
    });
    Object.assign(c.state,{loading:false,memberRooms:[room]});
    if (source === 'swipe') webSwipe(c,room.code);
    else c.ACTIONS.openRoomMenu({dataset:{code:room.code}});
    const action = () => source === 'swipe'
      ? c.ACTIONS.swipeRoomAction({dataset:{code:room.code,kind:'hide'}})
      : c.ACTIONS.roomMenuAction({dataset:{kind:'hide'}});
    const removing = action();
    assert.equal(c.state.busy,true); assert.equal(writes.length,0);
    await action(); assert.equal(dialogs.length,1);
    assert.match(dialogs[0].title,/从列表移除房间 123456/);
    assert.match(dialogs[0].message,/不会离开或解散房间/);
    assert.equal(dialogs[0].label,'移除');
    if (result === 'background') c.stop();
    resolveConfirm(result !== 'cancel'); await removing;
    assert.equal(writes.length,result === 'confirm' || result === 'failure' ? 1 : 0);
    assert.equal(c.state.memberRooms.length,result === 'confirm' ? 0 : 1);
    assert.equal(c.state.busy,false);
    if (writes.length) assert.equal(writes[0].body.action,'hide');
    if (result === 'failure') assert.equal(c.state.notice,'');
    assert.doesNotMatch(c.viewEntry(),/room-undo|undoRemoveRoom|撤销/);
  }
});
test('网页左滑解散须确认，取消不删除，快捷操作不解散已经开局的房间', async () => {
  let status = 'lobby', allow = false;
  const calls = [], dialogs = [];
  const room = {code:'123456',status:'lobby',isHost:true,available:true,stage:'stage'};
  const c = client(async (url, options) => {
    calls.push({url,method:options.method});
    if(url.endsWith('/management'))return response({...room,status});
    return response({rooms:[{...room,status}]});
  });
  c.setConfirm(async (title, message) => {dialogs.push({title,message}); return allow;});
  Object.assign(c.state,{loading:false,memberRooms:[room]});
  webSwipe(c,room.code); await c.ACTIONS.swipeRoomAction({dataset:{code:room.code,kind:'delete'}});
  assert.equal(dialogs.length,1); assert.match(dialogs[0].title,/解散房间 123456/);
  assert.equal(calls.some(x=>x.url.endsWith('/delete')),false);
  status='playing'; allow=true; webSwipe(c,room.code);
  await c.ACTIONS.swipeRoomAction({dataset:{code:room.code,kind:'delete'}});
  assert.equal(dialogs.length,1); assert.equal(calls.some(x=>x.url.endsWith('/delete')),false);
  assert.match(c.state.notice,/状态已更新/);
});
test('网页读取旧趣味响应时同步转换统计、比例、历史摘要和事件文案', async () => {
  const legacy = require('./helpers/fun-copy-fixtures');
  const before = JSON.stringify(legacy);
  const c = client(async url => response(url.includes('/stats') ? legacy.stats
    : { records: [legacy.match], total: 1, hasMore: false }));
  await c.applyRoute('#/stats?tab=fun');
  const stats = c.viewStats();
  assert.match(stats, /刀中敌方率 0\.0%/);
  assert.match(stats, /刀中友方/);
  assert.doesNotMatch(stats, /命中同伴|命中敌方/);
  await c.applyRoute('#/matches');
  const matches = c.viewMatches();
  assert.match(matches, /成功挡刀 · 刀中友方/);
  assert.match(matches, /最终刀落到本人（1号） · 房主登记/);
  assert.doesNotMatch(matches, /命中同伴|非梅林好人/);
  assert.equal(JSON.stringify(legacy), before);
});
test('网页恢复 Cookie 身份并保留原游客；正式会话过期不会自动新建游客', async () => {
  const storage = new Map([['session', 'guest-token'], ['pendingEntry', 'guest-command'], ['roomCode', '123456']]), calls = [];
  let expired = false;
  const c = client(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/web-auth/session')) return response({ enabled: true, authenticated: !expired, sessionTag: 'cookie-tag' });
    if (expired) return { status: 401, json: async () => ({ error: '网页登录已过期' }) };
    return response({ identityType: 'wx' });
  }, storage);
  await c.initializeWebAccount(); await c.login();
  assert.equal(storage.get('guestSession'), 'guest-token'); assert.equal(storage.has('session'), false);
  assert.equal(storage.has('pendingEntry'), false); assert.equal(storage.has('roomCode'), false);
  assert.equal(c.getWebSessionTag(), 'cookie-tag');
  await c.request('/api/me/profile');
  assert.equal(calls.at(-1).options.headers['X-Web-Session'], 'cookie-tag');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer ');
  expired = true;
  await assert.rejects(c.request('/api/me/profile'), /过期/);
  await assert.rejects(c.login(), /重新扫码/);
  await c.initializeWebAccount(); await assert.rejects(c.login(), /重新扫码/);
  assert.equal(calls.some(call => call.url === '/api/guest-login'), false);
});
test('扫码等待与确认分开，领取失败重试同一请求；登录后清除旧账号草稿并通知其他标签页', async () => {
  const storage = new Map([['session', 'guest-token'], ['pendingEntry', 'old-action'], ['nickname', 'old-name']]);
  const calls = [];
  let status = 'scanned', claims = 0;
  const c = client(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/web-auth/session')) return response({ enabled: true, authenticated: false });
    if (url.endsWith('/web-auth/requests')) return response({ id: 'a'.repeat(32), qrCode: 'data:image/png;base64,AA==', expiresAt: Date.now() + 120000 });
    if (url.endsWith('/claim')) {
      if (++claims === 1) throw new Error('response lost');
      return response({ authenticated: true, sessionTag: 'new-tag' });
    }
    return response({ status });
  }, storage);
  c.setConfirm(async () => true);
  Object.assign(c.state, { page: 'login', loading: false });
  await c.initializeWebAccount();
  await c.startWebLogin(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.state.webLoginStatus, 'scanned'); assert.equal(claims, 0);
  assert.match(c.viewWebLogin(), /已扫码，请在小程序中确认/);
  status = 'confirmed'; await c.pollWebLogin();
  assert.equal(claims, 1); assert.match(c.state.webLoginError, /未确认/);
  await c.pollWebLogin();
  assert.equal(claims, 2); assert.equal(storage.get('guestSession'), 'guest-token');
  assert.equal(storage.has('session'), false); assert.equal(storage.get('webAccount'), 'wechat');
  assert.equal(storage.has('pendingEntry'), false); assert.equal(storage.has('nickname'), false);
  assert.ok(storage.get('accountRevision'));
  assert.deepEqual(c.navigations, ['/#/me', 'reload']); assert.equal(c.state.webLoginError, '');
  const paths = calls.filter(call => call.url.endsWith('/claim')).map(call => call.url);
  assert.equal(paths[0], paths[1]);
});
test('刷新发生在旧轮询途中，新小程序码仍继续轮询；取消后旧响应不能领取会话', async () => {
  let generation = 0, release;
  const calls = [];
  const c = client(async (url) => {
    calls.push(url);
    if (url.endsWith('/requests')) return response({ id: (++generation === 1 ? 'a' : 'b').repeat(32), expiresAt: Date.now() + 120000 });
    if (url.endsWith('/cancel')) return response({ status: 'cancelled' });
    if (url.includes('a'.repeat(32))) return new Promise(resolve => { release = resolve; });
    return response({ status: 'pending' });
  });
  c.state.page = 'login';
  await c.startWebLogin(); await new Promise(resolve => setImmediate(resolve));
  await c.startWebLogin();
  release(response({ status: 'confirmed' })); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.scheduledDelay(), 0); await c.scheduled()();
  assert.ok(calls.some(url => url.endsWith('b'.repeat(32))));
  assert.equal(calls.some(url => url.endsWith('/claim')), false);
  await c.cancelWebLogin(); assert.equal(c.state.webLogin, null);
});
test('退出只撤销网页会话并恢复原游客；同一微信会话刷新保留待核对请求', async () => {
  const storage = new Map([['webAccount', 'wechat'], ['guestSession', 'original-guest'], ['pendingEntry', 'wechat-pending']]);
  const calls = [];
  const c = client(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/web-auth/session')) return response({ enabled: true, authenticated: true, sessionTag: 'cookie-tag' });
    return response(url.endsWith('/logout') ? { ok: true } : { identityType: 'guest' });
  }, storage);
  await c.initializeWebAccount(); assert.equal(storage.get('pendingEntry'), 'wechat-pending');
  c.setConfirm(async () => true); await c.continueAsGuest();
  assert.equal(storage.get('session'), 'original-guest');
  assert.equal(storage.has('guestSession'), false); assert.equal(storage.has('webAccount'), false);
  assert.equal(storage.has('pendingEntry'), false);
  assert.equal(calls.find(c => c.url.endsWith('/logout')).options.headers['X-Web-Session'], 'cookie-tag');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer original-guest');
  assert.deepEqual(c.navigations, ['/#/me', 'reload']);
});
test('网页慢请求十秒后中止，成功与失败均释放超时计时器', async () => {
  const timers = new Map(); let next = 0, slow = true, signal;
  const c = client(async (_url, options) => {
    signal = options.signal;
    if (!slow) return response({ ok: true });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' }))));
  }, undefined, undefined, {
    AbortController,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const failed = assert.rejects(c.request('/api/rooms/123456'), /请求超时/);
  const timer = [...timers.values()][0]; assert.equal(timer.delay, 10000);
  timer.fn(); await failed; assert.equal(signal.aborted, true); assert.equal(timers.size, 0);
  slow = false; assert.equal((await c.request('/api/rooms/123456')).ok, true);
  assert.equal(signal.aborted, false); assert.equal(timers.size, 0);
});
test('网页并发登录复用一次请求，失败后仍可重新登录', async () => {
  const storage = new Map(); let calls = 0, finish;
  const c = client(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, storage);
  const first = c.login(), second = c.login();
  assert.equal(calls, 1); finish({ status: 503, json: async () => ({ error: '暂时不可用' }) });
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(storage.has('session'), false);
  const retry = c.login(); assert.equal(calls, 2);
  finish(response({ token: 'new-session' })); await retry; assert.equal(storage.get('session'), 'new-session');
});
test('网页网络失败自动退避恢复，后台停止，恢复联网后立即同步', async () => {
  const room = publicView(newRoom('123456','host','房主'),'host'); let reads=0;
  const c=client(async()=>{ if (++reads===1) throw Error('offline'); return response(structuredClone(room)); });
  Object.assign(c.state,{loading:false,boards:BOARDS});
  await c.refresh().catch(c.handleError);
  assert.equal(c.state.reconnecting,true); assert.equal(c.state.error,'');
  assert.ok(c.scheduledDelay()>=800 && c.scheduledDelay()<=1000);
  await c.scheduled()(); assert.equal(c.state.reconnecting,false); assert.equal(reads,2);
  c.events['window:offline'](); await c.scheduled()(); assert.equal(reads,2);
  c.events['window:online'](); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,3); assert.equal(c.state.serverConnected,true);
  c.document.hidden=true; c.events.visibilitychange(); assert.equal(c.scheduled(),undefined);
});
test('网页响应丢失后自动重试同一编号，重复点击不新增写入，最终只执行一次', async () => {
  const room = publicView(newRoom('123456','host','房主'),'host'), writes=[], accepted=new Set();
  const c=client(async(url,options)=>{
    if(options.method==='POST') {
      const id=options.headers['Idempotency-Key']; writes.push(id);
      if(!accepted.has(id)) {accepted.add(id);throw Error('response lost');}
      return response({accepted:true,code:'123456'});
    }
    return response(structuredClone(room));
  });
  Object.assign(c.state,{loading:false,boards:BOARDS,room});
  await c.mutate('/api/rooms/123456/commands',{type:'ready',stage:room.stage,ready:true});
  assert.equal(c.state.reconnecting,true); assert.equal(c.state.hasPendingRequest,true);
  await c.mutate('/api/rooms/123456/commands',{type:'ready',stage:room.stage,ready:false});
  assert.equal(writes.length,1);
  await c.scheduled()();
  assert.equal(writes.length,2); assert.equal(writes[0],writes[1]); assert.equal(accepted.size,1);
  assert.equal(c.state.hasPendingRequest,false); assert.equal(c.state.reconnecting,false);
});
test('网页429遵守冷却，401停止自动恢复且不会悄悄创建游客身份', async () => {
  let calls=0; const c=client(async()=>{calls++;return {status:401,json:async()=>({error:'登录失效'})};});
  Object.assign(c.state,{loading:false,boards:BOARDS});
  c.handleError(Object.assign(Error('限流'),{status:429,retryAfterMs:120000}));
  assert.ok(c.scheduledDelay()>119000);
  await c.recoverConnection(); assert.equal(calls,0);
  c.handleError(Object.assign(Error('登录失效'),{status:401}));
  assert.equal(c.state.needsLogin,true);assert.equal(c.state.reconnecting,false);
  c.events['window:online'](); await c.recoverConnection(); assert.equal(calls,0);
});
test('网页闲置牌桌逐步降频，进行中牌桌保持2500ms', async () => {
  const room = newRoom('123456','host','房主');
  const c=client(async()=>response(publicView(room,'host')));
  for(let n=0;n<14;n++)await c.refresh(); c.schedule(); assert.equal(c.scheduledDelay(),10000);
  room.phase='tools'; await c.refresh(); c.schedule(); assert.equal(c.scheduledDelay(),2500);
});
test('网页仅缓存本人公开房间视图，304复用独立副本，写入和登录变化失效', async () => {
  const storage=new Map([['session','one']]), headers=[];let calls=0;
  const c=client(async(url,options)=>{
    headers.push(options.headers);calls++;
    if(calls===2)return {status:304};
    return {...response({players:[{name:'甲'}]}),headers:{get:()=> '"view-one"'}};
  },storage);
  const first=await c.request('/api/rooms/123456');first.players[0].name='mutated';
  assert.equal((await c.request('/api/rooms/123456')).players[0].name,'甲');
  assert.equal(headers[1]['If-None-Match'],'"view-one"');
  await c.request('/api/rooms/123456/private');assert.equal(headers[2]['If-None-Match'],undefined);
  storage.set('session','two');await c.request('/api/rooms/123456');assert.equal(headers[3]['If-None-Match'],undefined);
  await c.request('/api/rooms/123456/commands','POST',{},'same-request-number');
  await c.request('/api/rooms/123456');assert.equal(headers[5]['If-None-Match'],undefined);
});
test('网页显示本人积分调整和原因，分页重试不重复，切换页面后不接收旧调整响应',async()=>{
  const row={id:'adjustment',created:1,delta:-2,beforePoints:4,afterPoints:2,reason:'<img src=x onerror=evil()>修正'};
  let requests=0,finish;
  const c=client(async url=>{
    if(url.includes('/score-adjustments')) {requests++;if(requests===1)throw Error('网络中断');return new Promise(resolve=>{finish=resolve;});}
    return response({records:[],total:0,hasMore:false,adjustments:{records:[row],total:2,hasMore:true}});
  });
  await c.applyRoute('#/matches');let html=c.viewMatches();assert.match(html,/管理员积分调整 · 2 条/);assert.match(html,/-2 分/);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
  await c.ACTIONS.moreScoreAdjustments();assert.match(c.viewMatches(),/网络未确认|重试加载调整记录/);
  const pending=c.ACTIONS.moreScoreAdjustments();c.ACTIONS.moreScoreAdjustments();assert.equal(requests,2);
  await c.applyRoute('#/lobby');finish(response({records:[{...row,id:'stale'}],total:2,hasMore:false}));await pending;
  await c.applyRoute('#/matches');assert.equal((c.viewMatches().match(/积分 4/g)||[]).length,1);
});
test('网页按风格筛选头像，切换分类保留草稿和预览并且不触发保存', async () => {
  const presets = require('../miniprogram/builtin-avatars');
  const geometric = presets.find(item => item.id === 'geometric-32'), crayon = presets.find(item => item.id === 'crayon-32');
  let posts = 0;
  const c = client(async (url, options) => {
    if (options.method === 'POST') posts++;
    return response({ nickname: '林间', version: 1, avatarUrl: '/api/avatars/' + geometric.hash });
  });
  await c.applyRoute('#/profile');
  const rendered = () => c.viewProfileEditor();
  assert.equal(c.state.profileDraft.avatarStyle, 'geometric');
  assert.equal((rendered().match(/class="avatar-option(?: is-selected)?"/g) || []).length, 32);
  assert.match(rendered(), /data-id="geometric-32"/);
  assert.doesNotMatch(rendered(), /data-id="avatar-01"|data-id="crayon-01"/);
  const switchStyle = style => c.ACTIONS.chooseProfileAvatarStyle({ dataset: { style } });
  switchStyle('crayon');
  assert.equal(c.state.profileDirty, false);
  assert.equal(c.state.profileDraft.avatarPreview, '/api/avatars/' + geometric.hash);
  c.INPUTS.profileName({ value: '晚风' });
  c.ACTIONS.chooseBuiltinProfileAvatar({ dataset: { id: crayon.id } });
  switchStyle('pixel');
  assert.equal(c.state.profileDraft.avatar, 'builtin:' + crayon.id);
  assert.equal(c.state.profileDraft.nickname, '晚风');
  assert.equal(c.state.profileDraft.avatarPreview, crayon.path);
  assert.match(rendered(), /data-id="pixel-01"/);
  switchStyle('invalid');
  assert.equal(c.state.profileDraft.avatarStyle, 'pixel');
  assert.equal(posts, 0);
});
test('网页内置头像只改草稿，重新选原头像取消改动，保存与断网重试保持同一选择', async () => {
  const presets = require('../miniprogram/builtin-avatars'), posts = [];
  let saved = { nickname: '林间', version: 2, identityType: 'guest', avatarUrl: '/api/avatars/' + presets[0].hash };
  const c = client(async (url, options) => {
    if (options.method === 'POST') {
      posts.push(options);
      if (posts.length === 1) throw new Error('网络未确认');
      saved = { ...saved, version: 3, avatarUrl: '/api/avatars/' + presets.at(-1).hash };
    }
    return response(url.endsWith('/profile') ? saved : url.endsWith('/rooms') ? {rooms:[]} : {total:0,wins:0,winRate:null});
  });
  await c.applyRoute('#/profile');
  assert.equal((c.viewProfileEditor().match(/class="avatar-option(?: is-selected)?"/g) || []).length, 32);
  assert.doesNotMatch(c.viewProfileEditor(), /type="file"|上传头像/);
  assert.match(c.viewProfileEditor(), /data-id="avatar-01" aria-label="头像 01，已选择" aria-pressed="true"/);
  const choose = id => c.ACTIONS.chooseBuiltinProfileAvatar({ dataset: { id } });
  choose(presets[1].id);
  assert.equal(c.state.profileDraft.avatar, 'builtin:' + presets[1].id);
  assert.equal(c.state.profileDirty, true);
  assert.equal(posts.length, 0);
  choose(presets[0].id);
  assert.equal(c.state.profileDraft.avatar, undefined);
  assert.equal(c.state.profileDirty, false);
  choose('avatar-99');
  assert.equal(c.state.profileDirty, false);
  choose(presets.at(-1).id);
  await c.saveProfile();
  c.ACTIONS.chooseProfileAvatarStyle({ dataset: { style: 'classic' } });
  assert.equal(c.state.profileDraft.avatarStyle, 'pixel');
  choose(presets[1].id);
  assert.equal(c.state.profileDraft.avatar, 'builtin:' + presets.at(-1).id);
  await c.saveProfile();
  assert.equal(posts[0].body, posts[1].body);
  assert.equal(posts[0].headers['Idempotency-Key'], posts[1].headers['Idempotency-Key']);
  assert.equal(JSON.parse(posts[1].body).avatar, 'builtin:' + presets.at(-1).id);
  await c.navigate('profile');
  assert.equal(c.state.profileDraft.avatarStyle, 'pixel');
  assert.match(c.viewProfileEditor(), /data-id="pixel-32" aria-label="像素风 · 宝箱，已选择" aria-pressed="true"/);
});
test('网页昵称在头像下编辑，空值保留错误，完成后仅更新草稿', async () => {
  let writes = 0;
  const c = client(async (url, options) => {
    if (options.method === 'POST') writes++;
    return response({ nickname:'林间', version:1, avatarUrl:null });
  });
  await c.applyRoute('#/profile');
  c.ACTIONS.editProfileNickname();
  c.INPUTS.profileName({value:' '});
  c.ACTIONS.finishProfileNickname();
  assert.equal(c.state.profileEditingNickname, true);
  assert.match(c.viewProfileEditor(), /aria-invalid="true"/);
  c.INPUTS.profileName({value:' 晚风 '});
  c.ACTIONS.finishProfileNickname();
  assert.equal(c.state.profileEditingNickname, false);
  assert.equal(c.state.profileDraft.nickname, '晚风');
  assert.equal(c.state.profileDirty, true);
  assert.equal(writes, 0);
  assert.match(c.viewProfileEditor(), /nickname-text">晚风/);
  assert.match(c.viewProfileEditor(), /profile-save-bar/);
});

test('网页已有资料立即可编辑，迟到的刷新不覆盖昵称头像或保存版本', async () => {
  let finish;
  const original = { nickname: '林间', version: 1, avatarUrl: null, identityType: 'wx' };
  const c = client(() => new Promise(resolve => { finish = resolve; }));
  c.state.profile = original;
  const entering = c.applyRoute('#/profile');
  await new Promise(setImmediate);
  assert.match(c.viewProfileEditor(), /林间/);
  assert.match(c.viewProfileEditor(), /aria-busy="true"/);
  c.ACTIONS.editProfileNickname();
  c.INPUTS.profileName({ value: '正在编辑' });
  c.ACTIONS.chooseBuiltinProfileAvatar({ dataset: { id: 'avatar-02' } });
  finish(response({ ...original, nickname: '远端昵称', version: 2 }));
  await entering;
  assert.equal(c.state.profileDraft.nickname, '正在编辑');
  assert.equal(c.state.profileDraft.avatar, 'builtin:avatar-02');
  assert.equal(c.state.profileDraft.version, 1);
  assert.equal(c.state.profile.nickname, '林间');
  assert.equal(c.state.profileLoading, false);
  assert.equal(c.state.profileEditingNickname, true);
});

test('网页资料预览浏览头像分类时保持分类，未编辑的昵称应用最新资料', async () => {
  let finish;
  const original = { nickname: '林间', version: 1, avatarUrl: null, identityType: 'wx' };
  const c = client(() => new Promise(resolve => { finish = resolve; }));
  c.state.profile = original;
  const entering = c.applyRoute('#/profile'); await new Promise(setImmediate);
  c.ACTIONS.chooseProfileAvatarStyle({ dataset: { style: 'pixel' } });
  finish(response({ ...original, nickname: '最新昵称', version: 2 })); await entering;
  assert.equal(c.state.profileDraft.avatarStyle, 'pixel');
  assert.equal(c.state.profileDraft.nickname, '最新昵称');
  assert.equal(c.state.profileDraft.version, 2);
  assert.equal(c.state.profileDirty, false);
});

test('网页战绩刷新保留统计与记录，失败可重试且重复点击不重复请求', async () => {
  let reject, calls = 0;
  const stats = { total: 1, wins: 1, losses: 0, excluded: 0, winRate: 100, byFaction: [], byBoard: [], recent: [] };
  const c = client(() => { calls++; return new Promise((resolve, no) => { reject = no; }); });
  c.state.stats = stats;
  const refreshing = c.ACTIONS.loadStats();
  assert.equal(c.state.stats, stats);
  assert.match(c.viewStats(), /1 局有效对局/);
  assert.match(c.viewStats(), /刷新中/);
  assert.doesNotMatch(c.viewStats(), /正在读取战绩/);
  await c.ACTIONS.loadStats(); assert.equal(calls, 1);
  reject(new Error('网络异常')); await refreshing;
  assert.equal(c.state.stats, stats);
  assert.match(c.viewStats(), /网络未确认/);
  assert.match(c.viewStats(), /1 局有效对局/);
  assert.match(c.viewStats(), /重试/);
  c.state.profile = { nickname: '玩家', identityType: 'wx', avatarUrl: null };
  c.state.stats = null;
  assert.match(c.viewMe(), /重试/);
  assert.doesNotMatch(c.viewMe(), /正在读取战绩/);
});

test('网页快速切换后旧战绩响应不覆盖新页面的数据', async () => {
  let finishOld, count = 0;
  const stats = { total: 2, wins: 1, losses: 1, excluded: 0, winRate: 50, byFaction: [], byBoard: [], recent: [] };
  const c = client(url => {
    if (url.endsWith('/profile')) return Promise.resolve(response({ nickname: '林间', version: 1 }));
    if (++count === 1) return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve(response(stats));
  });
  const old = c.ACTIONS.loadStats();
  await c.applyRoute('#/me');
  assert.equal(c.state.stats.total, 2);
  finishOld(response({ ...stats, total: 99 })); await old;
  assert.equal(c.state.stats.total, 2);
  assert.equal(c.state.statsLoading, false);
});
test("网页座位昵称转义且轮询更新人数和准备统计", async () => {
  const room = dealtWebRoom({ phase: "lobby", capacity: 13, stage: "s1", code: "123456",
    players: [{ seat: 1, name: "完整昵称<甲>", ready: false, isHost: true, role: "秘密角色" }, { seat: 2, name: "乙", ready: true }] });
  let writes = 0;
  const c = client(async (path,options) => { if (options?.method === "POST") writes++; return response(structuredClone(room)); });
  await c.refresh();
  assert.equal(c.state.seatOccupiedCount, 2);
  assert.equal(c.state.seatReadyCount, 1);
  assert.match(c.viewRoom(), /class="seat-name">完整昵称&lt;甲&gt;/);
  assert.doesNotMatch(c.viewRoom(), /秘密角色|玩家名单|关闭名单/);
  assert.match(c.viewRoom(), /已准备 1\/2/);
  room.players[0].ready = true;
  room.players[1].seat = 4;
  room.players[1].name = "更新后的完整昵称";
  await c.refresh();
  assert.equal(c.state.seatReadyCount, 2);
  assert.match(c.viewRoom(), /aria-label="4号，更新后的完整昵称/);
  assert.match(c.viewRoom(), /已准备 2\/2/);
  assert.equal(writes, 0);
});
test("网页房主进度可展开收起，刷新保留状态，新操作默认收起", async () => {
  const room = dealtWebRoom({ phase: "skillPrepare", canUseTools: true, knights: { round: 3, remainingCards: 6 }, operationProgress: { total: 2, completed: 1, players: [{ seat: 1, name: "甲", required: true, completed: true }, { seat: 2, name: "乙", required: true, completed: false }] } });
  const c = client(async () => response(structuredClone(room)));
  await c.refresh();
  assert.equal(c.state.operationProgressExpanded, false);
  assert.match(c.viewRoom(), /1 \/ 2 已完成/);
  assert.doesNotMatch(c.viewRoom(), /class="progress-player"|再次发起技能/);
  c.ACTIONS.toggleOperationProgress();
  assert.match(c.viewRoom(), /class="progress-player"/);
  assert.match(c.viewRoom(), /aria-expanded="true"/);
  room.operationProgress.completed = 2;
  await c.refresh();
  assert.equal(c.state.operationProgressExpanded, true);
  c.ACTIONS.toggleOperationProgress();
  assert.doesNotMatch(c.viewRoom(), /class="progress-player"/);
  c.ACTIONS.toggleOperationProgress();
  room.stage = "next";
  await c.refresh();
  assert.equal(c.state.operationProgressExpanded, false);
});
test("网页最近结果与历史记录隐藏空的原牌复活及最终仍出局，保留旧版实际复活", async () => {
  const event = { kind: "skillResult", text: "技能最终结果", eliminated: [3, 5], redrawn: [3, 5], restored: [], out: [], detail: "本轮出局：3、5号；抽牌复活：3、5号；原牌复活：无；最终仍出局：无" };
  const room = dealtWebRoom({ history: [event] });
  const c = client(async () => response(structuredClone(room)));
  await c.refresh();
  assert.equal(c.state.latestResult.latestDetail, "本轮出局：3、5 号；抽牌复活：3、5 号");
  assert.equal(c.state.history[0].resultRows.length, 2);
  assert.doesNotMatch(c.viewRoom(), /原牌复活|最终仍出局/);
  event.out = [5];
  await c.refresh();
  assert.equal(c.state.history[0].resultRows[0].final, true);
  assert.match(c.state.latestResult.latestDetail, /最终仍出局：5 号/);
  assert.match(c.viewRoom(), /最终仍出局<\/span><span class="history-result-value">5 号/);
  event.restored = [4];
  await c.refresh();
  assert.match(c.state.latestResult.latestDetail, /原牌复活：4 号/);
  assert.equal(c.state.history[0].resultRows.at(-1).value, "4 号");
});
function dealtWebRoom(overrides = {}) {
  return { code: "123456", game: 1, phase: "tools", stage: "deal-1", flexible: true,
    capacity: 6, players: [{ seat: 1, name: "甲" }], me: { seat: 1, identityRevision: 0 },
    team: [], history: [], ...overrides };
}
test("网页身份历程只读且转义旧视野，关闭返回当前身份，遮盖后台与阶段变化清空", async () => {
  const room = dealtWebRoom({ me: { seat: 1, identityRevision: 1 } });
  const history = [{ id: 1, current: true, role: "觉醒红刀客", faction: "坏人阵营", sinceLabel: "第1轮 · 换牌", skillHistory: [{ round: 2, text: "刀8号" }] },
    { id: 0, current: false, initial: true, role: "红兰斯洛特", faction: "坏人阵营", information: "旧视野<script>", detailAvailable: true, sinceLabel: "开局 · A牌", skillHistory: [{ round: 1, text: "刀9号<script>" }] }];
  const storage = new Map([["session", "session"]]);
  const c = client(async url => response(structuredClone(url.endsWith('/private') ? { stage: room.stage, faction: "坏人阵营", identityHistory: history, skillHistory: history[0].skillHistory } : room)), storage);
  c.state.room = room;
  await c.ACTIONS.reveal();
  assert.match(c.viewRoom(), /data-action="openIdentityHistory"/);
  assert.match(c.viewRoom(), /技能记录/); assert.match(c.viewRoom(), /刀8号/);
  c.ACTIONS.openIdentityHistory();
  assert.equal(c.state.identityHistoryExpandedId, 0);
  assert.match(c.viewIdentityHistory(), /旧视野&lt;script&gt;|初始|当前/);
  assert.match(c.viewIdentityHistory(), /刀8号/); assert.match(c.viewIdentityHistory(), /刀9号&lt;script&gt;/);
  assert.doesNotMatch(c.viewIdentityHistory(), /data-action="submit|<script>/);
  c.ACTIONS.toggleIdentityHistory({ dataset: { id: "0" } });
  assert.match(c.viewIdentityHistory(), /class="identity-history-detail" hidden/);
  c.ACTIONS.closeIdentityHistory(); assert.equal(c.state.revealed, true);
  c.ACTIONS.openIdentityHistory(); c.state.busy = true; c.state.network = false;
  c.ACTIONS.hideIdentityHistory();
  assert.equal(c.state.secret, null); assert.equal(c.viewIdentityHistory(), "");
  c.state.busy = false; c.state.network = true;
  await c.ACTIONS.reveal(); c.ACTIONS.openIdentityHistory();
  c.document.hidden = true; c.events.visibilitychange();
  assert.equal(c.state.identityHistoryOpen, false); assert.equal(c.state.secret, null);
  assert.doesNotMatch(JSON.stringify([...storage]), /红兰斯洛特|旧视野|刀8号|刀9号/);
  c.document.hidden = false; c.events.visibilitychange();
  await c.ACTIONS.reveal(); c.ACTIONS.openIdentityHistory();
  room.stage = "new-stage"; await c.refresh();
  assert.equal(c.state.identityHistoryOpen, false); assert.equal(c.state.secret, null);
  Object.assign(c.state, { revealed: true, secret: { identityHistory: [history[0]] } });
  assert.doesNotMatch(c.viewRoom(), /data-action="openIdentityHistory"/);
});
test("网页座位头像失败回退且轮询不重试，换座跟随玩家，新头像不清空选人", async () => {
  const room = dealtWebRoom({ phase: "proposal", flexible: false, leader: 1,
    players: [{ seat: 1, name: "甲", isHost: true, avatarUrl: "/api/avatars/a" }, { seat: 2, name: "乙" }] });
  const c = client(async () => response(structuredClone(room)));
  await c.refresh();
  assert.match(c.viewRoom(), /class="seat-avatar-image" src="\/api\/avatars\/a"/);
  assert.match(c.viewRoom(), /class="seat-self">你<\/span>/);
  assert.match(c.viewRoom(), /class="seat-flag">房主<\/span>/);
  assert.match(c.viewRoom(), /aria-label="1号，甲，你的座位，房主"/);
  assert.match(c.viewRoom(), /seat-empty/);
  assert.doesNotMatch(c.viewRoom(), /点击入座/);
  c.ACTIONS.toggleProposalSeat({ dataset: { seat: "2" } });
  c.ACTIONS.toggleSeats();
  c.seatAvatarError({ dataset: { seat: "1", seatAvatarUrl: "/api/avatars/a" } });
  await c.refresh();
  assert.equal(c.state.seats[0].avatarFailed, true);
  assert.deepEqual(Array.from(c.state.selected), [2]);
  assert.equal(c.state.seatsExpanded, false);
  c.ACTIONS.toggleSeats();
  assert.doesNotMatch(c.viewRoom(), /class="seat-avatar-image"/);
  room.players[0].seat = 4;
  await c.refresh();
  assert.equal(c.state.seats[0].avatarUrl, "");
  assert.equal(c.state.seats[3].avatarFailed, true);
  room.players[0].avatarUrl = "/api/avatars/b";
  await c.refresh();
  assert.equal(c.state.seats[3].avatarFailed, false);
  c.seatAvatarError({ dataset: { seat: "4", seatAvatarUrl: "/api/avatars/a" } });
  assert.equal(c.state.seats[3].avatarFailed, false);
  assert.match(c.viewRoom(), /class="seat-avatar-image" src="\/api\/avatars\/b"/);
  assert.deepEqual(Array.from(c.state.selected), [2]);
  room.players[0].avatarUrl = "/api/avatars/a";
  await c.refresh();
  assert.equal(c.state.seats[3].avatarFailed, false);
  room.phase = "lobby";
  room.players[0].ready = true;
  await c.refresh();
  assert.match(c.viewRoom(), /class="seat-status seat-ready">已准备<\/span>/);
  assert.match(c.viewRoom(), /class="seat-empty-label">点击入座<\/span>/);
});
test("网页首次提醒无需秘密请求，主动揭示后关闭并清空，刷新不重弹且重开再提醒", async () => {
  let room = dealtWebRoom(), reads = 0;
  const storage = new Map([["session", "session"]]);
  const fetch = async path => {
    if (path.endsWith("/private")) { reads++; return response({ stage: room.stage, role: "梅林", faction: "好人阵营", information: "秘密视野" }); }
    return response(structuredClone(room));
  };
  const c = client(fetch, storage);
  await c.refresh();
  assert.equal(c.state.dealtIdentityDialog, true);
  assert.match(c.viewDealtIdentity(), /身份已发放/);
  assert.match(c.viewDealtIdentity(), /稍后查看/);
  assert.ok(!c.viewDealtIdentity().includes("梅林"));
  assert.equal(reads, 0);
  await c.ACTIONS.revealDealtIdentity();
  assert.match(c.viewDealtIdentity(), /梅林/);
  assert.match(c.viewDealtIdentity(), /秘密视野/);
  c.ACTIONS.closeDealtIdentity();
  assert.equal(c.state.dealtIdentitySecret, null);
  assert.ok(!JSON.stringify([...storage]).includes("秘密视野"));
  const resumed = client(fetch, storage);
  await resumed.refresh();
  assert.equal(resumed.state.dealtIdentityDialog, false);
  room = dealtWebRoom({ game: 2, stage: "deal-2" });
  await resumed.refresh();
  assert.equal(resumed.state.dealtIdentityDialog, true);
});
test("网页稍后查看保留手动入口，定位教学只在真实入口可见时显示一次", async () => {
  const room = dealtWebRoom(), storage = new Map([["session", "session"]]);
  const layout = { height: 667, anchor: { top: -50, bottom: -6, height: 44 } };
  const c = client(async path => response(path.endsWith("/private")
    ? { stage: room.stage, role: "梅林", information: "秘密" } : structuredClone(room)), storage, layout);
  await c.refresh();
  c.ACTIONS.closeDealtIdentity();
  assert.equal(c.state.identityHintVisible, false);
  assert.equal(storage.has("identityEntryHintSeen"), false);
  Object.assign(layout.anchor, { top: 100, bottom: 144 });
  c.state.showRoomRules = true;
  c.showIdentityHintWhenVisible();
  assert.equal(c.state.identityHintVisible, false);
  c.state.showRoomRules = false;
  c.showIdentityHintWhenVisible();
  assert.equal(c.state.identityHintVisible, true);
  assert.match(c.viewRoom(), /随时点这里/);
  await c.ACTIONS.reveal();
  assert.equal(c.state.identityHintVisible, false);
  assert.equal(c.state.secret.role, "梅林");
  room.game++; room.stage = "deal-2";
  await c.refresh();
  c.ACTIONS.closeDealtIdentity();
  assert.equal(c.state.identityHintVisible, false);
});
test("网页关闭、切后台及阶段变化后的旧身份请求被丢弃", async () => {
  for (const reason of ["close", "background", "stage"]) {
    let finish;
    const room = dealtWebRoom();
    const c = client(async path => path.endsWith("/private")
      ? new Promise(resolve => { finish = resolve; }) : response(structuredClone(room)));
    await c.refresh();
    const read = c.ACTIONS.revealDealtIdentity();
    if (reason === "close") c.ACTIONS.closeDealtIdentity();
    if (reason === "background") { c.document.hidden = true; c.events.visibilitychange(); }
    if (reason === "stage") { room.stage = "next-stage"; await c.refresh(); }
    finish(response({ stage: "deal-1", role: "梅林", information: "秘密" }));
    await read;
    assert.equal(c.state.dealtIdentitySecret, null, reason);
  }
});
test("网页未查看的后台发牌会补提醒，旁观、终局与换过身份的玩家不收到初次发牌提醒", async () => {
  let room = dealtWebRoom({ phase: "lobby", game: 0 });
  const c = client(async () => response(structuredClone(room)));
  c.document.hidden = true; c.events.visibilitychange();
  room = dealtWebRoom(); await c.refresh();
  assert.equal(c.state.dealtIdentityDialog, false);
  c.document.hidden = false; c.events.visibilitychange(); await c.refresh();
  assert.equal(c.state.dealtIdentityDialog, true);
  c.ACTIONS.closeDealtIdentity();
  for (const extra of [{ me: { seat: null } }, { phase: "ended" }, { phase: "terminated" }, { flexible: false }, { me: { seat: 1, identityRevision: 1 } }]) {
    const other = client(async () => response(dealtWebRoom(extra)));
    await other.refresh();
    assert.equal(other.state.dealtIdentityDialog, false);
  }
});

test("网页轮询等待当前请求完成再调度，切后台后不继续轮询", async () => {
  const c = client();
  let finish;
  c.setRefresh(() => new Promise(resolve => { finish = resolve; }));
  c.schedule();
  const timer = c.scheduled();
  const pending = timer();
  assert.equal(c.scheduled(), timer);
  finish();
  await pending;
  assert.notEqual(c.scheduled(), timer);
  const next = c.scheduled()();
  c.stop();
  finish();
  await next;
  assert.equal(c.scheduled(), undefined);
});

test("关闭并重开网页设置后，旧请求不能覆盖新设置", async () => {
  let resolveBoards;
  const room = publicView(newRoom("123456", "p1", "房主"), "p1");
  const c = client(async path => {
    if (path === "/api/boards") return new Promise(resolve => { resolveBoards = resolve; });
    return response(room);
  });
  c.state.settings = { busy: false };
  const oldLoad = c.loadSettings();
  while (!resolveBoards) await Promise.resolve();
  const fresh = { busy: false, loading: true, capacity: 12, dirty: true };
  c.state.settings = fresh;
  resolveBoards(response({ boards: BOARDS }));
  await oldLoad;
  assert.deepEqual(fresh, { busy: false, loading: true, capacity: 12, dirty: true });
});

test("网页房主变更后关闭管理操作并撤销设置权限", async () => {
  const room = newRoom("123456", "p1", "房主");
  enter(room, "p2", "玩家");
  const before = publicView(room, "p1");
  room.host = "p2";
  const c = client(async () => response(publicView(room, "p1")));
  c.state.room = before;
  c.state.toolType = "vote";
  c.state.settings = { authorized: true };
  await c.refresh();
  assert.equal(c.state.toolType, "");
  assert.equal(c.state.settings.authorized, false);
  assert.match(c.state.settings.error, /房主已变更/);
});


test("网页恢复后保留最近结果、弃权票和无需操作提示，进入下一项仍可回看", async () => {
  const room = newRoom("123456", "p1", "房主");
  const run = (uid, type, extra = {}) => command(room, uid, { type, stage: room.stage, ...extra });
  for (let i = 2; i <= 6; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach(p => run(p.uid, "ready", { ready: true }));
  run("p1", "start", { flexible: true });
  run("p1", "beginActivity", { kind: "vote" });
  run("p1", "submit", { value: "approve" });
  run("p1", "closeWaiting", { confirm: true });
  const c = client(async () => response(publicView(room, "p1")));
  await c.refresh();
  assert.match(c.state.latestResult.text, /提前截止/);
  assert.equal(c.state.latestResult.voteGroups[2].label, "弃权");
  assert.equal(c.state.latestResult.voteGroups[2].count, 5);
  run("p1", "beginActivity", { kind: "quest", team: [2], threshold: 1 });
  await c.refresh();
  assert.match(c.state.latestResult.text, /提前截止/);
  const html = c.viewRoom();
  assert.doesNotMatch(html, /最近操作结果|上次结果/);
  c.state.dealtIdentityDialog = false;
  c.ACTIONS.openHistory();
  assert.match(c.viewHistorySheet(), /id="history-record-0"/);
  assert.doesNotMatch(c.viewHistorySheet(), /5票弃权/);
  c.ACTIONS.toggleHistoryRow({ dataset: { key: '0' } });
  assert.match(c.viewHistorySheet(), /5票弃权/);
  assert.match(html, /本次你无需操作/);
  assert.match(c.viewHostBar(), /作废本次任务/);
  assert.ok(!c.viewHostBar().includes('data-action="settleTool"'));
  assert.ok(!c.viewHostBar().includes('data-action="cancelTool"'));
  run("p2", "submit", { value: "success" });
  await c.refresh();
  assert.equal(c.state.latestResult.text, "任务成功");
  run("p1", "finishTools");
  run("p1", "rematch");
  await c.refresh();
  assert.equal(c.state.latestResult, null);
});


test("网页移出失败可重试原请求，成功更新成员列表和保留设置草稿", async () => {
  const r = newRoom("123456", "p1", "房主", "knights", 12);
  enter(r, "p2", "玩家2");
  let dropped = true;
  const writes = [];
  const c = client(async (path, options) => {
    if (options.method === "POST") {
      writes.push({ id: options.headers["Idempotency-Key"], data: JSON.parse(options.body) });
      if (dropped) { dropped = false; throw new Error("断线"); }
      command(r, "p1", writes[0].data);
      return response({ accepted: true });
    }
    return response(path === "/api/boards" ? { boards: BOARDS } : publicView(r, "p1"));
  });
  c.setConfirm(async () => true);
  c.state.room = publicView(r, "p1");
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  Object.assign(c.state.settings, { dirty: true, visible: true });
  await c.kickFromSettings(2);
  assert.equal(c.state.settings.pendingKick, true);
  assert.match(c.viewSettingsDialog(), /data-action="retryKick"/);
  await c.sendKick();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(c.state.settings.pendingKick, false);
  assert.equal(c.state.settings.dirty, true);
  assert.equal(c.state.settings.visible, true);
  assert.equal(c.state.settings.room.players.length, 1);
});

test("被移出时网页清空身份和房间并显示原因，设置中对局开始后禁用移出", async () => {
  const c = client(async path => path === "/api/me/rooms" ? response({ rooms: [] }) : ({ status: 403, json: async () => ({ error: "你已被房主移出房间" }) }));
  c.state.room = { code: "123456" };
  c.state.secret = { role: "梅林" };
  c.state.revealed = true;
  await c.refresh();
  assert.equal(c.state.room, null);
  assert.equal(c.state.secret, null);
  assert.equal(c.state.revealed, false);
  assert.equal(c.state.notice, "你已被房主移出房间");
  const r = newRoom("123456", "p1", "房主");
  enter(r, "p2", "玩家");
  const active = publicView(r, "p1");
  active.canKick = false;
  active.phase = "tools";
  const host = client(async () => response(active));
  host.state.showRoomSettings = true;
  host.state.settings = { authorized: true, room: publicView(r, "p1"), boards: [], choices: [], capacities: [] };
  await host.refresh();
  assert.match(host.viewSettingsDialog(), /data-change="settingsKick" disabled/);
  assert.match(host.viewSettingsDialog(), /对局进行中不能移出/);
});


test("旧服务缺少移出权限时提示不支持，不误报对局进行中", async () => {
  const r = newRoom("123456", "p1", "房主");
  enter(r, "p2", "玩家");
  const legacy = publicView(r, "p1");
  delete legacy.canKick;
  const c = client(async path => response(path === "/api/boards" ? { boards: BOARDS } : legacy));
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  const html = c.viewSettingsDialog();
  assert.match(html, /暂不支持移出玩家/);
  assert.doesNotMatch(html, /对局进行中不能移出玩家/);
  assert.match(html, /data-change="settingsKick" disabled/);
  legacy.canKick = true;
  await c.loadSettings();
  assert.doesNotMatch(c.viewSettingsDialog(), /data-change="settingsKick" disabled/);
});

test("网页围观不显示准备或私密身份，自己的座位可点击站起", () => {
  const r = newRoom("123456", "host", "房主");
  const c = client();
  c.state.room = publicView(r, "host");
  c.state.seats = [{ seat: 1, name: "房主", mine: true, occupied: true }];
  let html = c.viewRoom();
  assert.match(html, /点自己站起/);
  assert.match(html, /data-action="seat" data-seat="1" aria-label="[^"]*" aria-description="点击站起围观">/);
  command(r, "host", { type: "stand", stage: r.stage });
  c.state.room = publicView(r, "host");
  html = c.viewRoom();
  assert.doesNotMatch(html, /data-action="ready"/);
  assert.doesNotMatch(html, /你在 null/);
  for (let i = 1; i <= 6; i++) {
    enter(r, `p${i}`, `玩家${i}`);
    command(r, `p${i}`, { type: "ready", ready: true, stage: r.stage });
  }
  command(r, "host", { type: "start", stage: r.stage, flexible: true });
  c.state.room = publicView(r, "host");
  html = c.viewRoom();
  assert.doesNotMatch(html, /查看我的身份|data-action="reveal"/);
});

test("网页普通玩家看到湖仙座位标记，传递刷新后移动，关闭后消失", async () => {
  const r = newRoom("123456", "p1", "房主", "classic", 8);
  for (let i = 2; i <= 8; i++) enter(r, `p${i}`, `玩家${i}`);
  const run = (uid, type, data = {}) => command(r, uid, { type, stage: r.stage, ...data });
  r.players.forEach(p => run(p.uid, "ready", { ready: true }));
  run("p1", "start", { flexible: true });
  r.fairy.fairy = 1;
  const c = client(async () => response(publicView(r, "p2")));
  c.state.room = publicView(r, "p2");
  await c.refresh();
  const seats = html => [...html.matchAll(/<button[^>]*data-action="seat"[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.match(seats(c.viewRoom())[0], /seat-fairy/);
  assert.equal(seats(c.viewRoom()).filter(s => s.includes("seat-fairy")).length, 1);
  run("p1", "beginActivity", { kind: "fairy" });
  run("p1", "submit", { value: "target:2" });
  await c.refresh();
  assert.match(seats(c.viewRoom())[1], /seat-fairy/);
  assert.doesNotMatch(seats(c.viewRoom())[0], /seat-fairy/);
  run("p1", "updateSettings", { board: r.board, capacity: 8, visible: false, fairyEnabled: false });
  await c.refresh();
  assert.doesNotMatch(c.viewRoom(), /seat-fairy/);
});

test('网页房主计分开关自动保存，板子与人数默认值及发牌锁定与服务端一致',async()=>{
  const room=newRoom('123456','host','房主','classic',6),writes=[];
  const c=client(async(path,options)=>{
    if(options?.method==='POST'){const data=JSON.parse(options.body);writes.push(data);command(room,'host',data);return response({accepted:true});}
    return response(path==='/api/boards'?{boards:BOARDS}:publicView(room,'host'));
  });
  c.state.showRoomSettings=true;c.state.settings={busy:false};await c.loadSettings();
  assert.equal(c.state.settings.scoreEnabled,false);assert.match(c.viewSettingsDialog(),/aria-label="本局计分"/);
  await c.CHANGES.settingsScoring({checked:true});assert.equal(room.scoreEnabled,true);assert.equal(writes[0].scoreEnabled,true);
  await c.CHANGES.settingsCapacity({value:'12'});assert.equal(room.scoreEnabled,false);assert.equal(writes.at(-1).scoreEnabled,false);
  await c.CHANGES.settingsBoard({value:'knights'});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsScoring({checked:false});assert.equal(room.scoreEnabled,false);
  await c.loadSettings();assert.equal(c.state.settings.scoreEnabled,false);
  await c.CHANGES.settingsBoard({value:'classic-court'});assert.equal(room.scoreEnabled,false);
  await c.CHANGES.settingsScoring({checked:true});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsBoard({value:'chaos'});assert.equal(room.scoreEnabled,false);
  await c.CHANGES.settingsBoard({value:'knights'});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsCapacity({value:'10'});assert.equal(room.scoreEnabled,false);
  await c.CHANGES.settingsBoard({value:'knights-10'});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsCapacity({value:'11'});assert.equal(room.scoreEnabled,false);
  await c.CHANGES.settingsBoard({value:'knights-11'});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsCapacity({value:'13'});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsCapacity({value:'6'});assert.equal(room.scoreEnabled,false);
  for(let i=2;i<=6;i++)enter(room,'p'+i,'玩家'+i);room.players.forEach(p=>p.ready=true);
  command(room,'host',{type:'start',stage:room.stage,flexible:true});await c.loadSettings();const count=writes.length;
  assert.match(c.viewSettingsDialog(),/data-change="settingsScoring" disabled/);
  await c.CHANGES.settingsScoring({checked:true});assert.equal(writes.length,count);assert.equal(room.scoreEnabled,false);
});
test("网页人数、板子及开关更改即保存，成功后保留表单且无底部保存按钮", async () => {
  const r = newRoom("123456", "host", "房主", "classic", 7);
  const writes = [];
  const c = client(async (path, options) => {
    if (options?.method === "POST") {
      const data = JSON.parse(options.body);
      writes.push(data);
      command(r, "host", data);
      return response({ accepted: true });
    }
    return response(path === "/api/boards" ? { boards: BOARDS } : publicView(r, "host"));
  });
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  await c.CHANGES.settingsCapacity({ value: "10" });
  assert.equal(r.capacity, 10);
  assert.equal(c.state.settings.fairyEnabled, true);
  await c.CHANGES.settingsBoard({ value: "knights-10" });
  assert.equal(r.board, "knights-10");
  await c.CHANGES.settingsFairy({ checked: false });
  assert.equal(r.fairyEnabled, false);
  await c.CHANGES.settingsVisibility({ checked: true });
  assert.equal(writes.length, 4);
  assert.equal(c.state.settings.visible, true);
  assert.equal(c.state.settings.dirty, false);
  assert.equal(c.state.settings.loading, false);
  assert.equal(c.state.settings.busy, false);
  const html = c.viewSettingsDialog();
  assert.doesNotMatch(html, /data-action="settingsSave"|7人局默认|开启后公开|任意阶段均可移交|选择玩家后需确认/);
});

test("网页自动保存失败保留原请求重试，未确认时禁止再次修改", async () => {
  const r = newRoom("123456", "host", "房主", "classic", 8);
  const writes = [];
  let fail = true;
  const c = client(async (path, options) => {
    if (options?.method === "POST") {
      writes.push({ data: options.body, id: options.headers["Idempotency-Key"] });
      if (fail) throw new Error("网络中断");
      command(r, "host", JSON.parse(options.body));
      return response({ accepted: true });
    }
    return response(path === "/api/boards" ? { boards: BOARDS } : publicView(r, "host"));
  });
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  await c.CHANGES.settingsFairy({ checked: false });
  assert.equal(c.state.settings.pendingSave, true);
  assert.match(c.viewSettingsDialog(), /重试保存/);
  await c.CHANGES.settingsFairy({ checked: true });
  assert.equal(c.state.settings.fairyEnabled, false);
  assert.equal(writes.length, 1);
  fail = false;
  await c.settingsSave();
  assert.deepEqual(writes[1], writes[0]);
  assert.ok(writes[0].id);
  assert.equal(c.state.settings.pendingSave, false);
  assert.equal(c.state.settings.error, "");
});

test("结果图标、记录时间与最近转换可见；座位可收起，记录从底部抽屉打开", async () => {
  const r = newRoom("123456", "host", "房主", "classic", 8);
  r.phase = "tools";
  r.history = [
    { kind: "toolQuest", number: 1, team: [1, 3], fails: 1, success: false },
    { kind: "toolQuest", number: 2, team: [1, 3], fails: 0, success: true },
    { kind: "toolVote", number: 3, team: [1, 4], approved: true, votes: [{ seat: 1, approve: true }], startedAt: new Date(2026, 8, 21, 23, 38).getTime() },
    { kind: "variant", resultType: "conversion", text: "本轮阵营转换", startedAt: new Date(2026, 8, 21, 23, 40).getTime() },
  ];
  const c = client(async () => response(publicView(r, "host")));
  await c.refresh();
  assert.equal(c.state.latestResult.text, "本轮阵营转换");
  assert.equal(c.state.history[2].resultTone, "success");
  assert.equal(c.state.history[0].resultTone, "failure");
  assert.equal(c.state.history[2].timeLabel, "23:38");
  assert.equal(c.state.history[0].timeLabel, "");
  let html = c.viewRoom();
  assert.match(html, /查看公开记录，共4条/);
  assert.match(html, /第1次 · × 失败/);
  assert.doesNotMatch(html, /id="history-record-/);
  assert.match(html, /data-action="openHistory"/);
  c.ACTIONS.openHistory();
  html = c.viewHistorySheet();
  assert.equal((html.match(/id="history-record-/g) || []).length, 4);
  assert.ok(html.indexOf('id="history-record-3"') < html.indexOf('id="history-record-0"'));
  c.ACTIONS.toggleSeats();
  assert.doesNotMatch(c.viewRoom(), /class="seats"/);
  c.ACTIONS.toggleSeats();
  assert.match(c.viewRoom(), /class="seats"/);
  c.state.room = { ...c.state.room, phase: "teamVote", team: [1, 4], needsSubmission: true };
  c.state.actionDialog = true;
  c.state.actionLabel = "是否同意这支队伍？";
  assert.match(c.viewActionDialog(), /任务队伍：1、4号/);
});

test('网页任务与投票详情在收起时隐藏，点击展开后呈现队伍和票数', () => {
  const historyUI = require('../miniprogram/public-history');
  const c = client();
  c.state.room = dealtWebRoom();
  c.state.dealtIdentityDialog = false;
  c.state.history = [
    { key: 0, category: 'quest', text: '任务成功', timeLabel: '15:50', teamLabel: '2、4、6 号', cards: [{ label: '成功', count: 3, tone: 'success' }], thresholdLabel: '至少 1 张失败票才失败' },
    { key: 1, category: 'vote', text: '投票通过', timeLabel: '15:51', voteGroups: [{ label: '赞成', count: 2, tone: 'approve', seats: '10、12 号' }] },
    { key: 2, category: 'other', text: '仙女查验已完成', timeLabel: '15:52' },
  ];
  Object.assign(c.state, historyUI.open(c.state));
  let html = c.viewHistorySheet();
  assert.equal((html.match(/public-history-chevron-slot/g) || []).length, 3);
  assert.doesNotMatch(html, /public-history-details|public-history-team|public-history-counts/);
  for (const key of [0, 1]) {
    c.ACTIONS.toggleHistoryRow({ dataset: { key: String(key) } });
    html = c.viewHistorySheet();
    assert.match(html, /public-history-details/);
    assert.match(html, key === 0 ? /成功 3 张/ : /2票赞成/);
    if (key === 0) assert.match(html, /至少 1 张失败票才失败/);
    c.ACTIONS.toggleHistoryRow({ dataset: { key: String(key) } });
    assert.doesNotMatch(c.viewHistorySheet(), /public-history-details/);
  }
});

test("网页仙女关闭需确认，取消保留结果，等待确认时新结果不被旧确认清除", async () => {
  const c = client(async () => { throw new Error("不应提交"); });
  const result = { revision: 1, summary: "6号 · 坏人" };
  c.state.fairyResult = result;
  c.state.fairyResultRevealed = true;
  c.setConfirm(async (title, text) => { assert.match(text, /关闭后不会再显示/); return false; });
  await c.ACTIONS.acknowledgeFairyResult();
  assert.equal(c.state.fairyResult, result);
  c.setConfirm(async () => { c.state.fairyResult = { revision: 2 }; return true; });
  await c.ACTIONS.acknowledgeFairyResult();
  assert.equal(c.state.fairyResult.revision, 2);
});

test("网页阶段集中待办，房主工具与任务进度优先，最近结果仅展示公开数据", async () => {
  const room = newRoom("123456", "p1", "房主");
  const run = (uid, type, extra = {}) => command(room, uid, { type, stage: room.stage, ...extra });
  for (let i = 2; i <= 6; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach(p => run(p.uid, "ready", { ready: true }));
  run("p1", "start", { flexible: true });
  run("p1", "beginActivity", { kind: "quest", team: [2], threshold: 1 });
  run("p2", "submit", { value: "success" });
  const c = client(async () => response(publicView(room, "p1")));
  await c.refresh();
  let html = c.viewRoom();
  assert.equal((html.match(/等待房主发起操作/g) || []).length, 1);
  assert.ok(html.indexOf('data-action="openTool"') < html.indexOf('data-action="toggleSeats"'));
  assert.ok(html.indexOf("任务进度") < html.indexOf('data-action="toggleSeats"'));
  c.ACTIONS.showLatestRecord();
  assert.equal(c.lookups.at(-1), "history-record-" + c.state.latestResult.key);
  assert.equal(c.scrolls.length, 0);
  assert.equal(c.state.focusedHistoryKey, c.state.latestResult.key);
  run("p1", "beginActivity", { kind: "vote" });
  await c.refresh();
  html = c.viewRoom();
  assert.doesNotMatch(html, /class="latest-result"|上次结果/);
  assert.equal(c.state.history[0].key, 0);
  assert.match(html, /class="primary" data-action="openAction"/);
  for (const phase of ["quest", "skillPrepare", "fairy", "identity"]) {
    c.state.room.phase = phase;
    assert.doesNotMatch(c.viewRoom(), /class="latest-result"|上次结果/);
  }
});

test("网页断网或等待请求时仍可立即遮盖身份", async () => {
  const c = client();
  c.state.room = publicView(newRoom("123456", "p1", "房主"), "p1");
  c.state.room.phase = "tools";
  c.state.revealed = true;
  c.state.secret = { role: "私密身份", information: "私密视野" };
  c.state.busy = true;
  c.state.network = false;
  assert.match(c.viewRoom(), /data-action="reveal">立即遮盖/);
  await c.ACTIONS.reveal();
  assert.equal(c.state.revealed, false);
  assert.doesNotMatch(c.viewRoom(), /私密身份|私密视野/);
});

test("查看结果定位更早的公开记录，并展开被折叠的目标", () => {
  const c = client();
  c.state.history = [0, 1, 2, 3, 4].map(key => ({ key, text: "公开记录" }));
  c.state.latestResult = c.state.history[0];
  c.ACTIONS.showLatestRecord();
  assert.equal(c.state.historyOpen, true);
  assert.equal(c.state.focusedHistoryKey, 0);
  assert.equal(c.lookups.at(-1), "history-record-0");
  assert.equal(c.scrolls.length, 0);
  assert.equal(c.state.visibleHistory.find(h => h.key === 0).expanded, true);
});

test("网页猎人技能三选一后只显示该模式号码，返回及阶段变化清除草稿", async () => {
  const options = [{value: "pass", label: "不使用技能"}, {value: "detonate:1", label: "自爆并开枪1号"}, {value: "detonate:11", label: "自爆并开枪11号"}, {value: "passive:5", label: "出局时向5号开枪"}];
  const c = client(async () => response({stage: "s1", action: {hunterModes: true, choices: options.map(o => o.value), options}}));
  c.state.room = {code: "123456", stage: "s1", phase: "skillPrepare", needsSubmission: true, me: {submitted: false}};
  await c.ACTIONS.openAction();
  assert.deepEqual(Array.from(c.state.actionChoices, o => o.label), ["主动技能", "被动技能", "本轮不开枪"]);
  c.ACTIONS.submitChoice({dataset: {value: "pass"}});
  assert.match(c.viewActionDialog(), /本轮若出局，将不会触发被动开枪。是否确认？/);
  assert.match(c.viewActionDialog(), /确认本轮不开枪/);
  c.ACTIONS.submitChoice({dataset: {value: "mode:detonate"}});
  assert.deepEqual(Array.from(c.state.actionChoices, o => o.value), ["detonate:1", "detonate:11", "mode:"]);
  assert.match(c.viewActionDialog(), /第 2 步：选择相邻一人/);
  assert.ok(!c.viewActionDialog().includes("本轮若出局，将不会触发被动开枪"));
  c.ACTIONS.submitChoice({dataset: {value: "mode:"}});
  c.ACTIONS.submitChoice({dataset: {value: "mode:passive"}});
  assert.deepEqual(Array.from(c.state.actionChoices, o => o.value), ["passive:5", "mode:"]);
  c.ACTIONS.closeAction();
  assert.equal(c.state.hunterChoices.length, 0);
  assert.equal(c.state.hunterMode, "");
});

test("网页技能先选再确认，过期和后台草稿不提交", async () => {
  const writes = [];
  const options = [{ value: "pass", label: "不使用技能 / 确认" }, { value: "target:2", label: "对 2号开刀" }];
  const c = client(async (path, init) => {
    if (init.method === "POST") { writes.push(JSON.parse(init.body)); return response({}); }
    return response({ stage: "s1", action: { choices: options.map(c => c.value), options } });
  });
  c.state.room = { stage: "s1", phase: "skillPrepare", needsSubmission: true, me: { submitted: false }, players: [{ seat: 2, name: '<玩家乙>' }] };
  c.setRefresh(async () => {});
  c.setConfirm(() => { throw new Error("不应出现第二层确认框"); });
  await c.ACTIONS.openAction();
  assert.match(c.viewActionDialog(), /skill-target-grid/);
  assert.match(c.viewActionDialog(), /&lt;玩家乙&gt;/);
  c.ACTIONS.confirmChoice();
  c.ACTIONS.submitChoice({ dataset: { value: "target:2" } });
  assert.equal(writes.length, 0);
  assert.match(c.viewActionDialog(), /确认对 2 号开刀/);
  c.ACTIONS.submitChoice({ dataset: { value: "pass" } });
  assert.match(c.viewActionDialog(), /确认本轮不开刀/);
  c.state.room.stage = "s2";
  c.ACTIONS.confirmChoice();
  assert.equal(writes.length, 0);
  c.state.room.stage = "s1";
  c.state.hasPendingRequest = true;
  c.ACTIONS.confirmChoice();
  assert.equal(writes.length, 0);
  c.state.hasPendingRequest = false;
  c.ACTIONS.confirmChoice();
  for (let i = 0; i < 20 && c.state.busy; i++) await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value, "pass");
  c.stop();
  c.ACTIONS.confirmChoice();
  assert.equal(writes.length, 1);
  c.ACTIONS.closeAction();
  assert.equal(c.state.skillTargets.length, 0);
  assert.equal(c.state.draftChoice, "");
});

test("网页十二骑士选人技能统一网格，双选与特殊目标仍提交原协议", async () => {
  const { cases, fixture } = require("./helpers/skill-target-fixtures");
  for (const [role, mode, value, selfAllowed] of cases) {
    const { room, secret } = fixture(role, mode);
    const writes = [];
    const c = client(async (path, init) => {
      if (init.method === "POST") { writes.push(JSON.parse(init.body)); return response({}); }
      return response(secret);
    });
    c.state.room = room;
    c.setRefresh(async () => {});
    c.setConfirm(() => { throw new Error("不应弹第二层确认"); });
    const choose = value => c.ACTIONS.submitChoice({ dataset: { value } });
    await c.ACTIONS.openAction();
    if (secret.action.hunterModes) await choose("mode:" + mode);
    assert.equal(c.state.skillTargetMode, mode, role);
    assert.match(c.viewActionDialog(), /skill-target-dialog/);
    assert.match(c.viewActionDialog(), /已出局/);
    assert.match(c.viewActionDialog(), /&lt;小鱼&gt;/);
    const grid = mode === "swap" ? c.state.swapPlayers : c.state.skillTargets;
    assert.equal(grid.length, 12, role);
    assert.equal(!grid.find(t => t.seat === 2).disabledReason, selfAllowed, role);
    c.ACTIONS.confirmChoice();
    await choose(mode === "inspect" ? "inspect:5" : "target:5");
    assert.equal(c.state.draftChoice, "");
    if (mode === "swap") {
      const toggle = seat => c.ACTIONS.toggleSwapSeat({ dataset: { seat } });
      toggle(5); assert.equal(c.state.swapSeats.length, 0);
      toggle(2); c.ACTIONS.confirmChoice(); assert.equal(writes.length, 0);
      assert.match(c.viewActionDialog(), /请再选择一个座位/);
      toggle(7);
      assert.match(c.viewActionDialog(), /确认交换 2 号与 7 号/);
      await choose("pass");
      assert.equal(c.state.swapSeats.length, 0);
      assert.ok(c.state.swapPlayers.every(t => !t.selected));
      toggle(2); toggle(7);
      assert.equal(c.state.swapPlayers.find(t => t.seat === 5).disabledReason, "已出局");
    } else {
      await choose(value);
      if (mode === "final") {
        assert.match(c.viewActionDialog(), /确认本次空刀/);
        await choose("target:7");
        assert.match(c.viewActionDialog(), /最终盘刀目标：7 号/);
        await choose(value);
      } else if (!secret.action.hunterModes) {
        await choose("pass");
        assert.ok(c.state.skillTargets.every(t => t.value !== c.state.draftChoice));
        await choose(value);
      } else {
        assert.doesNotMatch(c.viewActionDialog(), /返回选择技能方式<\/span><span class="skill-pass-mark"/);
      }
    }
    assert.equal(writes.length, 0);
    c.state.hasPendingRequest = true; c.ACTIONS.confirmChoice(); c.state.hasPendingRequest = false;
    assert.equal(writes.length, 0);
    c.ACTIONS.confirmChoice(); c.ACTIONS.confirmChoice();
    for (let i = 0; i < 20 && c.state.busy; i++) await Promise.resolve();
    assert.equal(writes.length, 1, role);
    assert.equal(writes[0].value, mode === "final" ? 0 : value, role);
    c.ACTIONS.closeAction();
    assert.equal(c.state.skillTargetMode, "");
  }
});

test("网页仙女只确认合法当前目标，提示传递关系并阻止过期与重复提交", async () => {
  const writes = [];
  const options = [1, 3, 4].map(seat => ({ value: `target:${seat}`, label: `查验 ${seat}号并传递仙女` }));
  const c = client(async (path, init) => {
    if (init.method === "POST") { writes.push(JSON.parse(init.body)); return response({}); }
    return response({ stage: "f1", action: { choices: options.map(c => c.value), options } });
  });
  c.state.room = { stage: "f1", phase: "fairy", round: 2, fairyHolder: 2,
    needsSubmission: true, me: { seat: 2, submitted: false },
    players: [1, 2, 3, 4, 5].map(seat => ({ seat, name: seat === 3 ? '<玩家三>' : `玩家${seat}` })) };
  c.setRefresh(async () => {});
  c.setConfirm(() => { throw new Error("仙女选择不应再弹第二层确认框"); });
  await c.ACTIONS.openAction();
  assert.equal(c.state.draftChoice, "");
  assert.match(c.viewActionDialog(), /skill-target-dialog/);
  assert.match(c.viewActionDialog(), /当前持有者/);
  assert.match(c.viewActionDialog(), /曾持有仙女/);
  assert.match(c.viewActionDialog(), /请先选择目标/);
  c.ACTIONS.submitChoice({ dataset: { value: "target:5" } });
  assert.equal(c.state.draftChoice, "");
  c.ACTIONS.submitChoice({ dataset: { value: "target:3" } });
  assert.equal(writes.length, 0);
  assert.match(c.viewActionDialog(), /查验目标：3 号 · &lt;玩家三&gt;/);
  assert.match(c.viewActionDialog(), /仙女将传给 3 号 · 确认后不可更改/);
  c.state.room.stage = "f2";
  c.ACTIONS.confirmChoice();
  c.state.room.stage = "f1";
  c.state.network = false;
  c.ACTIONS.confirmChoice();
  assert.equal(writes.length, 0);
  c.state.network = true;
  c.ACTIONS.confirmChoice();
  c.ACTIONS.confirmChoice();
  for (let i = 0; i < 20 && c.state.busy; i++) await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value, "target:3");
  c.ACTIONS.closeAction();
  assert.equal(c.state.skillTargetMode, "");
  assert.equal(c.state.skillSummary, "");
  c.state.fairyResult = { revision: 1, information: "3号查验结果：好人" };
  c.state.fairyResultRevealed = true;
  c.ACTIONS.hideFairyResult();
  assert.equal(c.state.fairyResultRevealed, false);
  assert.equal(c.state.fairyResult.revision, 1);
  assert.equal(writes.length, 1);
});

test("网页隐藏轮次推进，时间与最新标记清晰展示，记录定位和最新结果保持对应", async () => {
  const room = dealtWebRoom({ history: [
    { kind: "variant", text: "进入第2轮" },
    { kind: "variant", text: "本轮不转换", resultType: "conversion" },
    { kind: "skillResult", text: "技能最终结果", detail: "无人出局", startedAt: 1234567890000 },
    { kind: "variant", text: "进入第3轮" },
  ] });
  const c = client(async () => response(structuredClone(room)));
  await c.refresh();
  assert.deepEqual(Array.from(c.state.history, h => h.key), [1, 2]);
  assert.equal(c.state.latestResult.key, 2);
  c.state.dealtIdentityDialog = false;
  c.ACTIONS.openHistory();
  const html = c.viewHistorySheet();
  assert.ok(!html.includes("进入第"));
  assert.match(html, /public-history-meta"><span>\d{2}:\d{2}<\/span>/);
  assert.equal((html.match(/public-history-latest-mark/g) || []).length, 1);
  assert.doesNotMatch(html, /<span>#\d+<\/span>/);
  assert.match(html, /id="history-record-2"/);
  assert.ok(!html.includes('class="history-subtitle"'));
  assert.ok(!html.includes("全屏"));
  assert.equal(c.ACTIONS.toggleHistoryFullscreen, undefined);
});

test("网页转换和查验归其他，查验座位直接显示在记录和最近结果", async () => {
  const room = dealtWebRoom({ history: [
    { kind: "variant", text: "本轮阵营转换", resultType: "conversion" },
    { kind: "skillResult", text: "技能最终结果", detail: "无人出局" },
    { kind: "variant", text: "仙女查验已完成", number: 2 },
    { kind: "variant", text: "仙女查验已完成", resultType: "fairy", number: 3, actor: 10, target: 12 },
  ] });
  const c = client(async () => response(structuredClone(room)));
  await c.refresh();
  c.state.dealtIdentityDialog = false;
  assert.match(c.viewRoom(), /history-detail">10号查验了12号/);
  c.ACTIONS.openHistory();
  c.ACTIONS.filterHistory({ dataset: { value: "skill" } });
  assert.deepEqual(Array.from(c.state.visibleHistory, h => h.key), [1]);
  assert.doesNotMatch(c.viewHistorySheet(), /仙女查验|本轮阵营转换/);
  c.ACTIONS.filterHistory({ dataset: { value: "other" } });
  assert.deepEqual(Array.from(c.state.visibleHistory, h => h.key), [3, 2, 0]);
  assert.match(c.viewHistorySheet(), /public-history-inspection">10号查验了12号/);
  assert.equal(c.state.visibleHistory[0].hasDetails, false);
  room.history.pop();
  await c.refresh();
  assert.equal(c.state.latestResult.text, "仙女查验已完成");
  assert.equal(c.state.latestResult.latestDetail, "");
  assert.doesNotMatch(c.viewRoom(), /undefined|10号查验了12号/);
});

test("网页战绩空态、错误重试与第三阵营结算选择", async () => {
  let calls = 0;
  const c = client(async () => {
    calls++;
    if (calls === 1) throw new Error("网络异常");
    return response({ identityType: "guest", total: 0, wins: 0, losses: 0, excluded: 1, winRate: null, byFaction: [], byBoard: [], recent: [] });
  });
  await c.ACTIONS.toggleStats();
  assert.match(c.viewStats(), /重试/);
  await c.ACTIONS.loadStats();
  assert.match(c.viewStats(), /还没有有效战绩/);
  assert.match(c.viewStats(), /游客战绩/);
  assert.doesNotMatch(c.viewStats(), /0%/);
  c.state.room = { stage: "s1", canUseTools: true, winnerOptions: [{value: "third", label: "盗贼阵营胜"}] };
  c.ACTIONS.finishTools();
  assert.match(c.viewResultDialog(), /盗贼阵营胜/);
  assert.match(c.viewResultDialog(), /data-action="nextResult" disabled/);
  c.ACTIONS.pickResult({ dataset: { value: "third" } });
  assert.match(c.viewResultDialog(), /aria-pressed="true"/);
  c.ACTIONS.nextResult();
  c.state.room.stage = "s2";
  await c.ACTIONS.saveResult();
  assert.match(c.state.error, /阶段已变化/);
  assert.equal(calls, 2);
  c.state.room = { stage: 'knight-stage', canUseTools: true, knights: {}, winnerOptions: [], scoreSettlement: [{ id: 'early_assassination', label: '三绿前提前盘刀', requiresTarget: true }], players: [{ seat: 1, name: '已出局', alive: false }, { seat: 2, name: '在场', alive: true }] };
  c.state.error = '';c.ACTIONS.finishTools();c.ACTIONS.pickScoreReason({ dataset: { id: 'early_assassination' } });
  assert.match(c.viewResultDialog(), /三绿前提前盘刀/);c.ACTIONS.nextResult();const knifeHtml = c.viewResultDialog();
  assert.doesNotMatch(knifeHtml, /data-seat="1"/);assert.match(knifeHtml, /data-seat="2"/);assert.match(knifeHtml, /data-seat="0"/);
});


test("网页独立页面与资料草稿保护，牌桌隐藏底部导航", async () => {
  const profile = { nickname: "林间", version: 1, identityType: "wx", avatarUrl: null };
  const c = client(async url => response(url.endsWith('/profile') ? profile : url.endsWith('/stats') ? {total:0,wins:0,losses:0,excluded:0,winRate:null,byFaction:[],byBoard:[],recent:[]} : {rooms:[]}));
  await c.applyRoute('#/me');
  assert.equal(c.state.page,'me'); assert.equal(c.state.profile.nickname,'林间');
  assert.match(c.viewNavigation(),/aria-current="page"/);
  await c.navigate('profile');
  c.INPUTS.profileName({value:'未保存'});
  c.setConfirm(async()=>false); await c.navigate('me');
  assert.equal(c.state.page,'profile'); assert.equal(c.state.profileDraft.nickname,'未保存');
  c.setConfirm(async()=>true); await c.navigate('me'); assert.equal(c.state.page,'me');
  c.setRefresh(async()=>{}); await c.applyRoute('#/table/123456');
  assert.equal(c.state.page,'table'); assert.equal(c.viewNavigation(),'');
});

test("网页资料保存断网重试复用请求与版本，成功回到我的", async () => {
  let fail = true, saved = {nickname:'原名',version:2,identityType:'wx',avatarUrl:null};
  const posts=[];
  const c = client(async (url,opts) => {
    if (opts?.method === 'POST') {
      posts.push({body:opts.body,headers:opts.headers});
      if (fail) { fail=false; throw new Error('网络中断'); }
      saved={...saved,nickname:'新名',version:3}; return response(saved);
    }
    return response(url.endsWith('/profile')?saved:{total:0,wins:0,losses:0,excluded:0,winRate:null,byFaction:[],byBoard:[],recent:[]});
  });
  await c.applyRoute('#/profile'); c.INPUTS.profileName({value:'新名'});
  await c.saveProfile(); assert.equal(c.state.page,'profile'); assert.equal(c.state.profileDirty,true);
  await c.saveProfile(); assert.deepEqual(posts[0],posts[1]);
  assert.equal(JSON.parse(posts[0].body).version,2); assert.equal(c.state.page,'me'); assert.equal(c.state.profile.nickname,'新名');
});

function webRanks(metric='games',extra={}) {
  return {metric,period:'all',threshold:1,eligibleCount:1,maxRows:100,updatedAt:1,version:'one',hasMore:false,
    rows:[{publicId:'public-player',nickname:'<script>坏名字</script>',avatarUrl:null,rank:1,total:20,wins:10,winRate:50,isSelf:true}],
    me:{status:'ranked',rank:1,total:20,wins:10,winRate:50,remaining:0},...extra};
}
test('网页切换周期保留榜单且不插入加载提示，切换失败仍能重试目标周期', async () => {
  const requests=[];
  const c=client(url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})));
  c.state.page='leaderboard';
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const first=c.loadLeaderboard();await tick();
  assert.match(c.viewLeaderboard(),/正在读取榜单/);
  requests[0].resolve(response(webRanks()));await first;
  const board=c.state.rankBoard;
  const change=c.ACTIONS.rankPeriod({dataset:{value:'month'}});await tick();
  assert.equal(c.state.rankPeriod,'month');assert.equal(c.state.rankBoard,board);
  assert.match(c.viewLeaderboard(),/rank-list/);assert.match(c.viewLeaderboard(),/rank-mine/);
  assert.doesNotMatch(c.viewLeaderboard(),/class="status"|正在读取榜单/);
  await c.ACTIONS.rankPeriod({dataset:{value:'month'}});assert.equal(requests.length,2);
  requests[1].resolve(response(webRanks('games',{period:'month',rows:[]})));await change;
  assert.equal(c.state.rankBoard.period,'month');assert.equal(c.state.rankLoading,false);
  const failed=c.ACTIONS.rankPeriod({dataset:{value:'all'}});await tick();
  requests[2].reject(new Error('断线'));await failed;
  assert.equal(c.state.rankPeriod,'month');assert.equal(c.state.rankBoard.period,'month');
  const retry=c.ACTIONS.rankRetry();await tick();assert.match(requests[3].url,/period=all/);
  requests[3].resolve(response(webRanks()));await retry;
  assert.equal(c.state.rankPeriod,'all');assert.equal(c.state.rankError,'');
});
test('网页排行榜可深链，私密资料不公开，输出转义昵称并显示样本量和本人状态', async () => {
  const c=client(async()=>response(webRanks()));
  await c.applyRoute('#/leaderboard');
  assert.equal(c.state.page,'leaderboard');assert.equal(c.viewNavigation(),'');
  const html=c.viewLeaderboard();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/10 胜 · 胜率 50%/);assert.match(html,/第 1 名/);
  for (const [metric,label] of [['games','有效局数'],['overall','总胜率'],['good','好人胜率'],['evil','坏人胜率']]) {
    c.state.rankBoard=webRanks(metric);c.state.rankMineExpanded=true;
    const footer=c.viewLeaderboard().split('<aside class="rank-mine"')[1];
    assert.match(footer,/我的排名/);assert.ok(footer.includes(label));
    assert.match(footer,/rank-mine-place/);assert.doesNotMatch(footer,/胜 ·/);
    assert.ok(footer.includes(metric==='games'?'20<span':'50.0<span'));
  }
  c.state.rankBoard=webRanks('games',{rows:[],me:{status:'hidden',rank:null,total:20,wins:10,winRate:50}});
  assert.match(c.viewLeaderboard(),/在排行榜公开展示/);assert.match(c.viewLeaderboard(),/暂无公开排名/);
  assert.doesNotMatch(c.viewLeaderboard(),/同桌相聚|仅展示|仅微信|满10局|满20局|尚未开启|更新于/);
  c.state.rankBoard.me.status='unsupported';
  assert.doesNotMatch(c.viewLeaderboard(),/仅微信账号|参与排行/);
});
test('网页积分榜兼容旧服务，升级后自动恢复入口，不把积分参数错误显示在局数榜',async()=>{
  const urls=[];let upgraded=false;
  const c=client(async url=>{
    urls.push(url);const params=new URL('https://test.invalid'+url).searchParams,metric=params.get('metric');
    if(metric==='points' && !upgraded)return {status:400,json:async()=>({error:'排行榜参数无效，请刷新后重试'})};
    return response(webRanks(metric,{period:params.get('period'),...(upgraded?{availableMetrics:['points','games','overall','good','evil']}:{})}));
  });
  await c.applyRoute('#/leaderboard');
  assert.equal(c.state.rankMetric,'games');assert.equal(c.state.rankError,'');assert.equal(c.state.rankPointsAvailable,false);
  assert.match(c.state.rankNotice,/尚未开放积分榜/);assert.match(c.viewLeaderboard(),/data-value="points"[^>]+ disabled/);
  assert.equal(urls.length,2);await c.ACTIONS.rankMetric({dataset:{value:'points'}});assert.equal(urls.length,2);
  await c.ACTIONS.rankPeriod({dataset:{value:'month'}});assert.equal(urls.at(-1),'/api/leaderboard?metric=games&period=month');
  await c.ACTIONS.rankMetric({dataset:{value:'good'}});assert.equal(c.state.rankBoard.metric,'good');
  upgraded=true;await c.ACTIONS.rankRefresh();assert.equal(c.state.rankPointsAvailable,true);assert.equal(c.state.rankNotice,'');
  await c.ACTIONS.rankMetric({dataset:{value:'points'}});assert.equal(c.state.rankBoard.metric,'points');
});
test('网页旧积分错误不触发过期降级，其他服务错误继续保留真实错误',async()=>{
  let rejectOld;const urls=[];
  const c=client(async url=>{
    urls.push(url);if(urls.length===1)return new Promise((resolve,reject)=>{rejectOld=reject;});
    return response(webRanks('good'));
  });
  const first=c.applyRoute('#/leaderboard');await new Promise(resolve=>setImmediate(resolve));
  await c.ACTIONS.rankMetric({dataset:{value:'good'}});
  rejectOld(Object.assign(new Error('排行榜参数无效，请刷新后重试'),{status:400}));await first;
  assert.equal(urls.length,2);assert.equal(c.state.rankBoard.metric,'good');assert.equal(c.state.rankPointsAvailable,true);
  for(const [status,message] of [[403,'禁止访问'],[500,'暂时无法处理'],[400,'其他输入错误']]) {
    let reads=0;const failed=client(async()=>{reads++;return {status,json:async()=>({error:message})};});
    await failed.applyRoute('#/leaderboard');assert.equal(reads,1);assert.equal(failed.state.rankError,message);assert.equal(failed.state.rankPointsAvailable,true);
  }
});
test('网页榜单切换和离开页面不接收旧响应，过期分页重新加载，错误可重试', async () => {
  let resolveOld;let reads=0;
  const c=client(async url=>{
    if(++reads===1)return new Promise(resolve=>resolveOld=resolve);
    return response(webRanks(url.includes('metric=good')?'good':'games'));
  });
  c.state.page='leaderboard';const first=c.loadLeaderboard();await Promise.resolve();await Promise.resolve();
  await c.ACTIONS.rankMetric({dataset:{value:'good'}});resolveOld(response(webRanks()));await first;
  assert.equal(c.state.rankBoard.metric,'good');assert.equal(c.state.rankLoading,false);
  let step=0;const urls=[];
  const paged=client(async url=>{
    urls.push(url);step++;
    if(step===2)return {status:409,json:async()=>({error:'榜单已更新'})};
    if(step===4)throw Error('断线');
    return response(webRanks('games',{version:step===1?'old':'new',hasMore:step===1,nextOffset:20}));
  });
  await paged.applyRoute('#/leaderboard');await paged.ACTIONS.rankMore();
  assert.match(urls[1],/offset=20&version=old/);assert.equal(paged.state.rankBoard.rows.length,1);assert.equal(paged.state.rankBoard.version,'new');assert.match(paged.state.rankNotice,/重新加载/);
  await paged.ACTIONS.rankRefresh();assert.match(paged.state.rankError,/网络未确认/);assert.equal(paged.state.rankBoard.rows.length,1);
  await paged.ACTIONS.rankRetry();assert.equal(paged.state.rankError,'');
  let finish;const leaving=client(async url=>url.endsWith('/api/scoring/rules')?response({scopeLabel:'经典板',items:[],notes:[]}):new Promise(resolve=>finish=resolve));
  leaving.state.page='leaderboard';const pending=leaving.loadLeaderboard();await Promise.resolve();await Promise.resolve();
  await leaving.applyRoute('#/help');finish(response(webRanks()));await pending;assert.equal(leaving.state.rankBoard,null);
});
test('网页排行榜底栏直接开关，失败重试保留请求，资料页不再编辑展示设置', async () => {
  let visible=false;const posts=[];
  const c=client(async(url,opts)=>{
    if(opts?.method==='POST') {
      posts.push({body:opts.body,id:opts.headers['Idempotency-Key']});
      if(posts.length===1)throw Error('断线');
      visible=JSON.parse(opts.body).leaderboardVisible;return response({leaderboardVisible:visible});
    }
    return response(url.endsWith('/profile')?{nickname:'我',version:1,identityType:'dev',leaderboardVisible:visible}:webRanks('games',{me:{...webRanks().me,status:visible?'ranked':'hidden',rank:visible?1:null}}));
  });
  await c.applyRoute('#/leaderboard');
  await c.CHANGES.rankVisibility({checked:true});assert.equal(c.state.rankVisible,false);assert.match(c.state.rankVisibilityError,/网络未确认/);
  await c.ACTIONS.rankVisibilityRetry();assert.deepEqual(posts[0],posts[1]);assert.equal(c.state.rankVisible,true);
  assert.match(c.viewLeaderboard(),/data-change="rankVisibility" checked/);
  await c.CHANGES.rankVisibility({checked:false});assert.equal(c.state.rankVisible,false);assert.equal(c.state.rankBoard.me.status,'hidden');
  c.state.rankBoard.me.status='unsupported';await c.CHANGES.rankVisibility({checked:true});assert.equal(posts.length,3);
  await c.applyRoute('#/profile');assert.doesNotMatch(c.viewProfileEditor(),/profileLeaderboard|在排行榜公开展示/);
});
test('网页趣味卡片用可点击数字和CSP兼容比例条，未知角色不显示虚构的零',async()=>{
  const {aggregate}=require('../server/fun');
  const rows=['enemy','ally','failed','aim_enemy'].map((suffix,i)=>({match_id:'known',mode:'knights',metric:'knife_'+suffix,role:'gareth',role_label:'<坏标签>',status:'known',count:[2,0,1,3][i],opportunities:3}));
  const unknown=['enemy','ally','failed','aim_enemy'].map(suffix=>({match_id:'unknown',mode:'knights',metric:'knife_'+suffix,role:'gaheris',role_label:'加荷里斯',status:'unknown',count:0,opportunities:0}));
  const c=client(async()=>response({total:2,wins:1,winRate:50,byFaction:[],byRole:[],byBoard:[],recent:[],fun:aggregate([...rows,...unknown],1)}));
  await c.applyRoute('#/stats?tab=fun');assert.equal(c.state.statsTab,'fun');const html=c.viewStats();
  assert.match(html,/<button[^>]+data-metric="knife_enemy"[^>]*><span class="fun-number good">2/);assert.doesNotMatch(html,/&lt;span|style="width:/);assert.match(html,/<svg class="fun-bar"/);
  assert.match(html,/缺失数据不按零次计算/);assert.match(html,/刀中敌方 —/);assert.match(html,/&lt;坏标签&gt;/);
});
test('网页趣味回查深链与分页保留过滤，清除回到全部，不混入管理员积分调整',async()=>{
  const urls=[];const c=client(async url=>{urls.push(url);return response({records:[{id:String(urls.length),endedAt:1,members:[],role:'梅林',outcome:'win',fun:{events:[],highlights:[],reason:'旧数据'}}],total:2,hasMore:urls.length===1,adjustments:{records:[{id:'a',delta:2,reason:'积分调整'}],total:1,hasMore:false}});});
  await c.applyRoute('#/matches?fun=knife_enemy&mode=knights&role=gareth');await c.loadMatches(true);
  assert.deepEqual(urls,['/api/me/matches?offset=0&fun=knife_enemy&mode=knights&role=gareth','/api/me/matches?offset=1&fun=knife_enemy&mode=knights&role=gareth']);assert.doesNotMatch(c.viewMatches(),/管理员积分调整/);
  await c.applyRoute('#/matches');assert.equal(urls.at(-1),'/api/me/matches?offset=0');assert.match(c.viewMatches(),/管理员积分调整/);
});
test('网页趣味榜弹层呈现分组指标、跨板子汇总与迟到响应隔离，未达门槛展示本人分母',async()=>{
  const defs=require('../server/fun').publicMetrics();let resolveOld;const urls=[];
  const result=metric=>webRanks(metric,{fun:true,mode:'all',sort:'rate',role:'gareth',metricLabel:'刀中敌方率',unit:'%',availableFunMetrics:defs,roleOptions:[{id:'gareth',label:'加雷斯'}],rows:[],me:{count:3,opportunities:4,knownGames:4,rate:75,status:'not_enough',remaining:6}});
  const c=client(async url=>{urls.push(url);if(urls.length===1)return new Promise(resolve=>resolveOld=resolve);const metric=new URL('http://test'+url).searchParams.get('metric');return response({...result(metric),...(metric==='fun_defense_ally'?{role:null,roleOptions:[]}: {})});});
  const old=c.applyRoute('#/leaderboard');await new Promise(resolve=>setImmediate(resolve));
  await c.loadLeaderboard(false,{rankMetric:'fun_kill_enemy',rankFunSort:'rate',rankFunRole:'gareth'});resolveOld(response(webRanks('points')));await old;
  c.ACTIONS.rankToggleMine();
  assert.equal(c.state.rankBoard.metric,'fun_kill_enemy');assert.match(urls[1],/mode=all&sort=rate&role=gareth/);assert.match(c.viewLeaderboard(),/还差 6 次机会/);assert.match(c.viewLeaderboard(),/成功 3 次 · 共 4 次机会/);
  c.ACTIONS.rankToggleMetrics();
  const options=require('../miniprogram/leaderboard-presentation').funOptions(defs,{includeFinal:true});
  assert.equal(c.state.rankFunCategory,'all');
  let html='';
  for(const category of ['all','good','evil','other']) {
    c.ACTIONS.funRankCategory({dataset:{value:category}});
    const group=c.viewLeaderboard();html+=group;
    assert.equal((group.match(/data-action="funRankPreview"/g)||[]).length,category==='all'?options.length:options.filter(item=>item.category===category).length);
  }
  assert.match(html,/绝对防御，蓝守卫／魔术师，成功保护友方的次数/);assert.match(html,/职业杀手，刀客／骑士／猎人等，成功击杀对方的次数/);assert.match(html,/共 15 项/);
  assert.match(html,/金牌替身，非梅林好人，作为非梅林好人，最终刀落到本人身上的次数/);
  assert.doesNotMatch(html,/查看不同角色的高光|次数榜至少|次机会参与排名|fun-option-description/);
  c.ACTIONS.rankToggleMetrics();
  await c.ACTIONS.funRankMetric({dataset:{value:'fun_defense_ally'}});assert.match(urls.at(-1),/metric=fun_defense_ally.*mode=all&sort=rate$/);
  c.ACTIONS.rankToggleRules();assert.match(c.viewLeaderboard(),/守卫按实际挡下伤害计数/);assert.equal(c.state.rankFunRole,'');
  for (const [key,label] of [['fun_percival_bust','竭尽全力 · 三红或梅林被刺'],['fun_merlin_hit','舍我其谁 · 被刺中'],['fun_assassin_miss','背锅侠 · 刺错梅林'],['fun_kill_ally','痛击队友 · 击杀友方'],['fun_defense_enemy','卧龙凤雏 · 保护对方']]) {
    assert.ok(html.includes('data-value="'+key+'"'));assert.ok(html.includes(label.split(' · ')[0]));
    await c.ACTIONS.funRankMetric({dataset:{value:key}});
    assert.match(urls.at(-1),new RegExp('metric='+key+'.*mode=all&sort=rate$'));
    assert.equal(c.state.rankBoard.metric,key);
    assert.match(c.viewLeaderboard(),/data-action="funRankSort" data-value="rate"[^>]*>按发生率/);
  }
});
test('网页不计积分的骑士终局必须选实际带刀人，切换带刀人排除自刀目标',async()=>{
  const c=client(async()=>response({}));c.state.room={canUseTools:true,stage:'fun-stage',knights:{},scoreSettlement:[],funSettlement:[{id:'early_assassination',label:'提前盘刀',requiresTarget:true}],players:[{seat:1,name:'<甲>'},{seat:2,name:'乙'},{seat:3,name:'出局',alive:false}]};
  c.ACTIONS.finishTools();c.ACTIONS.pickScoreReason({dataset:{id:'early_assassination'}});c.ACTIONS.pickScoreTarget({dataset:{seat:2}});c.ACTIONS.nextResult();
  assert.match(c.viewResultDialog(),/实际带刀人/);assert.match(c.viewResultDialog(),/data-action="nextResult" disabled/);assert.doesNotMatch(c.viewResultDialog(),/data-seat="3"/);
  c.ACTIONS.pickFunActor({dataset:{seat:2}});assert.equal(c.state.resultTarget,null);c.ACTIONS.nextResult();assert.match(c.viewResultDialog(),/pickScoreTarget" disabled data-seat="2"/);assert.match(c.viewResultDialog(),/1号<\/span><span class="score-player-name">&lt;甲&gt;/);assert.doesNotMatch(c.viewResultDialog(),/&amp;lt;/);
});

test('个人页隐藏回避卡和趣味预览，昵称仍转义动态文字，排名详情按需打开', async () => {
  const c = client(async () => response(webRanks()));
  c.state.profile = {nickname:'<img src=x onerror=attack()>昵称',identityType:'wx',avoidance:{balance:5}};
  c.state.stats = {total:1,wins:1,winRate:100,fun:{teaser:'<img src=x onerror=attack()>战报'}};
  const html = c.viewMe();
  assert.doesNotMatch(html, /回避卡|openAvoidanceWallet/);
  assert.match(html, /data-page="stats\?tab=fun"/);
  assert.doesNotMatch(html, /&lt;span|<img src=x/);
  assert.match(html, /&lt;img src=x onerror=attack\(\)&gt;昵称/);
  assert.doesNotMatch(html, /&gt;战报/);
  const overview = html.slice(html.indexOf('<div class="me-overview">'), html.indexOf('<div class="personal-links'));
  const controls = [...overview.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(controls.length, 3);
  assert.ok(controls.every(([, , content]) => !content.includes('<button')));
  assert.match(controls[0][1], /data-action="navigate" data-page="stats"/);
  assert.match(controls[1][1], /data-action="scoreRecords"/);
  assert.match(controls[2][1], /data-action="navigate" data-page="help"/);
  await c.applyRoute('#/leaderboard');
  assert.doesNotMatch(c.viewLeaderboard(), /role="switch"/);
  c.ACTIONS.rankToggleMine();
  assert.match(c.viewLeaderboard(), /role="dialog"[^>]*aria-label="我的排名与公开设置"/);
  assert.match(c.viewLeaderboard(), /role="switch"/);
  c.ACTIONS.rankToggleMine();
  assert.doesNotMatch(c.viewLeaderboard(), /rank-details-dialog/);
});

test('网页分步结算保留返回草稿，取消终确认不提交，重复确认只写一次', async () => {
  const writes = [];
  const c = client(async (url,options) => { if(options.method==='POST') writes.push(JSON.parse(options.body)); return response({}); });
  c.setRefresh(async()=>{});
  c.state.room={code:'123456',stage:'flow',canUseTools:true,knights:{},scoreSettlement:[{id:'early',label:'提前盘刀',requiresTarget:true}],funSettlement:[],players:[{seat:1,name:'甲'},{seat:2,name:'乙'}],winnerOptions:[{value:'good',label:'好人胜'}]};
  c.ACTIONS.finishTools();
  c.ACTIONS.nextResult();assert.equal(c.state.resultStep,'reason');
  c.ACTIONS.pickScoreReason({dataset:{id:'early'}});c.ACTIONS.nextResult();assert.equal(c.state.resultStep,'actor');
  c.ACTIONS.nextResult();assert.equal(c.state.resultStep,'actor');
  c.ACTIONS.pickFunActor({dataset:{seat:1}});c.ACTIONS.nextResult();
  c.ACTIONS.pickScoreTarget({dataset:{seat:1}});assert.equal(c.state.resultTarget,null);
  c.ACTIONS.pickScoreTarget({dataset:{seat:2}});c.ACTIONS.nextResult();assert.equal(c.state.resultStep,'review');
  assert.match(c.viewResultDialog(),/实际带刀人/);assert.match(c.viewResultDialog(),/1号 · 甲/);
  c.ACTIONS.backResult();assert.equal(c.state.resultTarget,2);c.ACTIONS.nextResult();
  c.setConfirm(async()=>false);await c.ACTIONS.saveResult();assert.equal(writes.length,0);assert.equal(c.state.resultDialog,true);assert.equal(c.state.resultStep,'review');
  let release; c.setConfirm(()=>new Promise(resolve=>{release=resolve;}));
  const first=c.ACTIONS.saveResult();await c.ACTIONS.saveResult();release(true);await first;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes.length,1);assert.equal(writes[0].scoreReason,'early');assert.equal(writes[0].funActor,1);assert.equal(writes[0].scoreTarget,2);
});

test('网页登记方式独立切换并保留两边草稿，旧响应中的五次否决不显示也不能选择', () => {
  const c = client(async () => response({}));
  c.state.room = { code: '123456', stage: 'flow', canUseTools: true, settlementRequiresActor: false,
    scoreSettlement: [{ id: 'assassination', label: '三绿，已完成最终刺杀', requiresTarget: true },
      { id: 'quest_fail', label: '三次任务失败', winner: 'evil' }, { id: 'five_rejections', label: '连续五次组队被否决' }],
    players: [{ seat: 1, name: '甲' }], winnerOptions: [{ value: 'good', label: '好人胜' }, { value: 'evil', label: '坏人胜' }] };
  c.ACTIONS.finishTools();
  assert.doesNotMatch(c.viewResultDialog(), /five_rejections|连续五次|data-value="good"/);
  c.ACTIONS.pickScoreReason({ dataset: { id: 'five_rejections' } });
  assert.equal(c.state.resultNextEnabled, false);
  c.ACTIONS.pickScoreReason({ dataset: { id: 'assassination' } });
  c.ACTIONS.nextResult(); c.ACTIONS.pickScoreTarget({ dataset: { seat: 1 } }); c.ACTIONS.backResult();
  assert.match(c.viewResultDialog(), /data-value="none"/);
  assert.doesNotMatch(c.viewResultDialog(), /接下来：|下一步选择|请选择结束原因|score-helper/);
  c.ACTIONS.toggleResultOther();
  assert.equal(c.state.resultNextEnabled, false);
  assert.equal(c.state.resultReason, '');
  assert.doesNotMatch(c.viewResultDialog(), /data-action="pickScoreReason"/);
  assert.doesNotMatch(c.viewResultDialog(), /data-value="none"|信息不完整|保留未知/);
  c.ACTIONS.pickResult({ dataset: { value: 'good' } });
  assert.equal(c.state.resultSteps.length, 2);
  c.ACTIONS.toggleResultOther();
  assert.equal(c.state.resultReason, 'assassination'); assert.equal(c.state.resultTarget, 1); assert.equal(c.state.resultChoice, '');
  c.ACTIONS.toggleResultOther();
  assert.equal(c.state.resultChoice, 'good'); assert.equal(c.state.resultReason, '');
  c.ACTIONS.nextResult(); assert.equal(c.state.resultStep, 'review');
  assert.match(c.viewResultDialog(), /仅登记胜方 · 好人胜/);
  assert.doesNotMatch(c.viewResultDialog(), /实际刺杀目标|三绿，已完成最终刺杀/);
  c.ACTIONS.backResult(); c.ACTIONS.toggleResultOther();
  c.ACTIONS.pickResult({ dataset: { value: 'none' } });
  assert.equal(c.state.resultOther, false); assert.equal(c.state.resultSteps.length, 2);
  assert.equal(c.state.resultTarget, null); assert.equal(c.state.resultActor, null);
  c.ACTIONS.toggleResultOther(); assert.equal(c.state.resultChoice, 'good');
  c.ACTIONS.toggleResultOther(); assert.equal(c.state.resultChoice, 'none');
  c.ACTIONS.nextResult(); assert.equal(c.state.resultStep, 'review');
  assert.match(c.viewResultDialog(), /本局不计战绩及积分/);
});

test('网页按服务端刺客状态跳过带刀人，计分和不计分均可直接提交目标', async () => {
  for (const scoring of [false, true]) {
    const writes=[];
    const c=client(async(url,options)=>{if(options.method==='POST')writes.push(JSON.parse(options.body));return response({});});
    c.setRefresh(async()=>{});c.setConfirm(async()=>true);
    const reason={id:'assassination',label:'三绿，已完成最终刺杀',requiresTarget:true};
    c.state.room={code:'123456',stage:'flow',canUseTools:true,knights:{},settlementRequiresActor:false,scoreSettlement:scoring?[reason]:[],funSettlement:[reason],players:[{seat:1,name:'甲'},{seat:2,name:'乙'}]};
    c.ACTIONS.finishTools();c.ACTIONS.pickScoreReason({dataset:{id:'assassination'}});c.ACTIONS.nextResult();
    assert.equal(c.state.resultStep,'target');assert.equal(c.state.resultSteps.length,3);
    c.ACTIONS.pickScoreTarget({dataset:{seat:1}});c.ACTIONS.nextResult();
    assert.equal(c.state.resultStep,'review');assert.doesNotMatch(c.viewResultDialog(),/实际带刀人/);
    await c.ACTIONS.saveResult();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(writes.length,1);assert.equal(writes[0][scoring?'scoreTarget':'funTarget'],1);assert.ok(!Object.hasOwn(writes[0],'funActor'));
    c.state.room.settlementRequiresActor=true;delete c.state.room.knights;
    c.ACTIONS.finishTools();c.ACTIONS.pickScoreReason({dataset:{id:'assassination'}});c.ACTIONS.nextResult();
    assert.equal(c.state.resultStep,'actor');
    c.ACTIONS.pickFunActor({dataset:{seat:1}});c.ACTIONS.nextResult();c.ACTIONS.pickScoreTarget({dataset:{seat:1}});
    assert.equal(c.state.resultTarget,null);
  }
});

test('网页战绩卡兼容旧版未开放和异常响应，保留提示与重试，恢复后显示真实统计', async () => {
  const player={seat:1,name:'甲',statsId:'a'.repeat(64)}, info={id:player.statsId,seat:1};
  for (const old of [{player:info,status:'hidden'},{player:info,status:'unknown'},{player:info,status:'available'},null]) {
    let payload=old;
    const c=client(async()=>response(payload));c.state.room=dealtWebRoom({players:[player]});
    await c.openPlayerCard(1);
    assert.equal(c.state.playerCard.name,'甲');assert.equal(c.state.playerCardStats,null);assert.equal(c.state.playerCardLoading,false);
    assert.match(c.viewPlayerCard(),/战绩暂时无法读取/);assert.match(c.viewPlayerCard(),/data-action="retryPlayerCard"/);
    payload={player:info,status:'available',stats:{total:3,wins:2,winRate:200/3,scoreTotal:2,byFaction:[]}};
    await c.ACTIONS.retryPlayerCard();
    assert.equal(c.state.playerCardError,'');assert.equal(c.state.playerCardStats.total,3);assert.match(c.viewPlayerCard(),/66.7%/);
    c.state.playerCardStats=null;c.state.playerCardStatus='hidden';
    assert.match(c.viewPlayerCard(),/战绩暂时无法读取/);assert.match(c.viewPlayerCard(),/data-action="retryPlayerCard"/);
  }
});

test('网页主座位在准备时看他人战绩、游戏时看自己；关闭和阶段变化丢弃响应', async () => {
  let resolveStats;
  const players=[{seat:1,name:'甲',statsId:'a'.repeat(64)},{seat:2,name:'<乙>',statsId:'b'.repeat(64)}];
  let room=dealtWebRoom({phase:'lobby',players});
  const c=client(async url=>url.endsWith('/stats')?new Promise(resolve=>resolveStats=resolve):response(structuredClone(room)));
  await c.refresh();
  let opening=c.ACTIONS.seat({dataset:{seat:'2'}});
  assert.equal(c.state.playerCard.name,'<乙>');assert.match(c.viewPlayerCard(),/&lt;乙&gt;/);
  resolveStats(response({player:{id:players[1].statsId,seat:2},status:'available',stats:{total:0,wins:0,winRate:null,scoreTotal:0,byFaction:[]}}));
  await opening;
  // The action delegate may not return a promise; allow the read to finish.
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(c.viewPlayerCard(),/暂无有效战绩/);assert.equal(c.state.playerCardStats.rateLabel,'—');
  c.ACTIONS.closePlayerCard();assert.equal(c.state.playerCard,null);
  room.phase='tools';room.stage='game';await c.refresh();c.ACTIONS.closeDealtIdentity();
  opening=c.openPlayerCard(1);assert.equal(c.state.playerCard.name,'甲');c.closePlayerCard();
  resolveStats(response({player:{id:players[0].statsId,seat:1},status:'hidden'}));await opening;assert.equal(c.state.playerCard,null);
  opening=c.openPlayerCard(1);room.stage='next';await c.refresh();resolveStats(response({player:{id:players[0].statsId,seat:1},status:'hidden'}));await opening;
  assert.equal(c.state.playerCard,null);
});

test('网页排行榜头像与占位头像打开同一战绩卡，支持错误重试并转义最新昵称', async () => {
  const calls=[];let fail=true;
  const c=client(async url=>{
    calls.push(url);
    if(!url.endsWith('/stats'))return response(webRanks());
    if(fail)return {status:404,json:async()=>({error:'该玩家已关闭排行榜公开展示或暂不可查看'})};
    return response({player:{id:'public-player',name:'<新昵称>',avatarUrl:null},status:'available',stats:{total:40,wins:25,winRate:62.5,scoreTotal:80,byFaction:[]}});
  });
  await c.applyRoute('#/leaderboard');
  assert.match(c.viewLeaderboard(),/data-action="rankPlayerCard" data-id="public-player"/);
  assert.match(c.viewLeaderboard(),/rank-avatar-fallback/);
  c.state.rankMineExpanded=true;await c.ACTIONS.rankPlayerCard({dataset:{id:'public-player'}});
  assert.equal(c.state.rankMineExpanded,false);assert.match(c.viewPlayerCard(),/暂不可查看/);
  fail=false;await c.ACTIONS.retryPlayerCard();
  assert.equal(calls.at(-1),'/api/leaderboard/players/public-player/stats');
  assert.equal(c.state.playerCardStats.rateLabel,'62.5%');
  assert.match(c.viewPlayerCard(),/&lt;新昵称&gt;/);assert.doesNotMatch(c.viewPlayerCard(),/全部历史战绩|历史有效对局|不含进行中的对局/);
  assert.doesNotMatch(c.viewPlayerCard(),/号位|<新昵称>/);
});
test('网页排行榜离开、关闭与换榜丢弃迟到响应，快速点击只显示最后一人', async () => {
  for(const leave of ['close','route','filter']) {
    let resolveStats;
    const c=client(url=>url.endsWith('/stats')?new Promise(resolve=>resolveStats=resolve):Promise.resolve(response(webRanks())));
    await c.applyRoute('#/leaderboard');
    const opening=c.ACTIONS.rankPlayerCard({dataset:{id:'public-player'}});
    if(leave==='close')c.closePlayerCard();
    else if(leave==='route')await c.applyRoute('#/help');
    else await c.loadLeaderboard(false,{rankPeriod:'month'});
    resolveStats(response({player:{id:'public-player',name:'迟到昵称'},status:'hidden'}));await opening;
    assert.equal(c.state.playerCard,null,leave);assert.equal(c.state.playerCardStats,null,leave);
  }
  const calls=[];
  const c=client(()=>new Promise((resolve,reject)=>calls.push({resolve,reject})));
  c.state.page='leaderboard';c.state.rankBoard=webRanks('games',{rows:[{publicId:'a',nickname:'甲'},{publicId:'b',nickname:'乙'}]});
  const first=c.ACTIONS.rankPlayerCard({dataset:{id:'a'}}),second=c.ACTIONS.rankPlayerCard({dataset:{id:'b'}});
  calls[1].resolve(response({player:{id:'b',name:'乙'},status:'available',stats:{total:0,wins:0,winRate:null,scoreTotal:0,byFaction:[]}}));await second;
  calls[0].reject(Error('过期请求'));await first;
  assert.equal(c.state.playerCard.id,'b');assert.equal(c.state.playerCardError,'');assert.match(c.viewPlayerCard(),/暂无有效战绩/);
});

test('网页编辑资料移除同房战绩开关，旧设置不影响昵称编辑', async () => {
  const c=client(async()=>response({nickname:'甲',version:2,roomStatsVisible:false,leaderboardVisible:true}));
  c.state.page='profile';await c.loadProfile(true);
  assert.equal(c.CHANGES.profileRoomStatsVisibility,undefined);
  assert.doesNotMatch(c.viewProfileEditor(),/允许同房玩家查看战绩|profileRoomStatsVisibility/);
  c.INPUTS.profileName({value:'乙'});assert.equal(c.state.profileDirty,true);
  c.INPUTS.profileName({value:'甲'});assert.equal(c.state.profileDirty,false);
});

test('网页趣味弹层草稿可取消，确认后请求；弹层互斥且背景不可交互',async()=>{
  const defs=require('../server/fun').publicMetrics(),urls=[];
  const c=client(async url=>{urls.push(url);return response(webRanks(new URL('http://test'+url).searchParams.get('metric'),{fun:true,sort:'count',unit:'次',availableFunMetrics:defs,rows:[],me:{rank:null,status:'no_records',knownGames:0}}));});
  c.state.page='leaderboard';await c.loadLeaderboard(false,{rankMetric:'fun_defense_ally'});
  c.ACTIONS.rankToggleMetrics();c.ACTIONS.funRankCategory({dataset:{value:'evil'}});c.ACTIONS.funRankPreview({dataset:{value:'fun_assassin_miss'}});
  assert.match(c.viewLeaderboard(),/rank-workspace" inert/);assert.equal(urls.length,1);
  c.ACTIONS.rankToggleMetrics();assert.equal(c.state.rankMetric,'fun_defense_ally');
  c.ACTIONS.rankToggleMetrics();assert.equal(c.state.rankPendingMetric,'fun_defense_ally');
  c.ACTIONS.funRankCategory({dataset:{value:'evil'}});c.ACTIONS.funRankPreview({dataset:{value:'fun_assassin_miss'}});
  await c.ACTIONS.funRankConfirm();assert.match(urls.at(-1),/metric=fun_assassin_miss/);assert.equal(c.state.rankMetricsExpanded,false);
  c.ACTIONS.rankToggleRules();c.ACTIONS.rankToggleMine();assert.equal(c.state.rankRulesExpanded,false);
});

test('网页月报默认完整展示且不重复榜单，荣誉使用头像明细并隐藏空榜', () => {
  const report = require('../tests/helpers/monthly-fixtures').monthlyFixture();
  report.mainBoards[1].rows = [];
  report.funBoards.filter(board => board.metric === 'assassin_hit').forEach(board => { board.rows = []; });
  report.mainBoards[0].rows[0].nickname = '<img src=x onerror=alert(1)>';
  const c = client(async () => response({}));
  c.state.monthlyReport = require('../miniprogram/monthly-report').presentReport(report);
  c.state.monthlyMonth = report.month;
  const html = c.viewMonthlyReport();
  assert.doesNotMatch(html, /好人胜率榜|坏人胜率榜|战绩榜|职业刺客|暂无满足|<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /查看完整月报|收起完整月报|monthly-honor-row/);
  assert.equal((html.match(/class="monthly-board" aria-label="闪身步大神"/g) || []).length, 1);
  assert.match(html, /monthly-avatar/);
  assert.match(html, /成功率 80% · 10 次机会/);
  assert.match(html, /桌边常驻王/);
  assert.match(html, /生成月报分享图/);
  for (const board of [...report.mainBoards, ...report.funBoards]) board.rows = [];
  c.state.monthlyReport = require('../miniprogram/monthly-report').presentReport(report);
  const empty = c.viewMonthlyReport();
  assert.doesNotMatch(empty, /monthly-featured-heading|monthly-details-toggle|monthly-honor-row|暂无/);
  assert.match(empty, /有效对局/);
});

test('网页月报只导出一张完整长图，预览和下载无分页入口', async()=>{
  const report=require('./helpers/monthly-fixtures').monthlyFixture(),rendered=[],downloads=[],labels=[];
  const ctx=new Proxy({fillText:value=>labels.push(value)},{get:(target,key)=>key in target?target[key]:()=>{}});
  const c=client(async()=>response(report),undefined,undefined,{Image:class{constructor(){this.width=64;this.height=64;}set src(value){this.onload();}}});
  c.document.createElement=tag=>tag==='canvas'?{getContext:()=>ctx,toDataURL(){rendered.push({width:this.width,height:this.height});return 'data:image/png;base64,long-poster';}}:{click(){downloads.push({href:this.href,name:this.download});},remove(){}};
  c.document.body={appendChild(){}};
  Object.assign(c.state,{page:'monthly',monthlyMonth:report.month,monthlyReport:require('../miniprogram/monthly-report').presentReport(report)});
  await c.ACTIONS.monthlyShare();
  assert.equal(c.state.monthlyError,'');assert.equal(rendered.length,1);assert.ok(rendered[0].height>1920);
  assert.equal(c.state.monthlyImages.length,1);assert.ok(labels.includes('绝对防御'));
  assert.doesNotMatch(c.viewMonthlyReport(),/上一张|下一张|自动分图|第1张/);
  assert.match(c.viewMonthlyReport(),/保存长图/);
  c.ACTIONS.monthlyDownload();assert.deepEqual(downloads,[{href:'data:image/png;base64,long-poster',name:'桌边助手-月度战报-2026-09.png'}]);
});

test('网页最佳玩家票选不限时，支持房主未投名单、选择修改与全部并列获奖卡片', async()=>{
  const hp=require('../miniprogram/honors');const c=client(async()=>response({}));
  const h=hp.present({status:'open',matchId:'m',canVote:true,canClose:true,total:6,completed:0,required:3,pendingPlayers:[{seat:2,name:'<林间>'},{seat:5,name:'晚风'}],groups:[{key:'mvp',title:'最强 MVP',side:'胜方',players:[{seat:1,name:'我',disabled:true},{seat:2,name:'林间'}]},{key:'svp',title:'最强 SVP',side:'败方',players:[{seat:5,name:'晚风'}]}]});
  Object.assign(c.state,{page:'table',honors:h,network:true,busy:false});c.ACTIONS.openHonors();
  c.ACTIONS.chooseHonor({dataset:{key:'mvp',seat:'1'}});assert.equal(c.state.honorReady,false);
  c.ACTIONS.chooseHonor({dataset:{key:'mvp',seat:'2'}});c.ACTIONS.chooseHonor({dataset:{key:'svp',seat:'5'}});assert.equal(c.state.honorReady,true);
  assert.match(c.viewHonorBallot(),/aria-pressed="true"/);assert.match(c.viewHonorBallot(),/我 · 不可选/);
  assert.doesNotMatch(c.viewHonorBallot(),/剩余|截止前可修改|关闭后可从牌桌继续|NaN/);
  const pending=c.viewHonors(h);assert.match(pending,/未投票：2号 &lt;林间&gt;、5号 晚风/);
  assert.match(pending,/data-action="closeHonors"/);assert.doesNotMatch(pending,/剩余|NaN/);
  assert.doesNotMatch(c.viewHonors({...h,canClose:false}),/未投票：|data-action="closeHonors"/);
  const waiting=c.viewHonors(hp.present({status:'not_started',canStart:false}));
  assert.match(waiting,/等待房主发起票选/);assert.doesNotMatch(waiting,/胜方 MVP|可选环节|每局仅一次/);
  assert.match(c.viewHonors(hp.present({status:'not_started',canStart:true})),/data-action="startHonors"/);
  c.ACTIONS.dismissHonors();assert.equal(c.viewHonorBallot(),'');
  const shown=hp.present({status:'settled',completed:6,total:6,mvp:[{seat:2,name:'林间',votes:3},{seat:3,name:'阿风',votes:3}],svp:[{seat:5,name:'晚风',votes:4}]});
  const html=c.viewHonors(shown);assert.equal((html.match(/class="honor-winner"/g)||[]).length,3);assert.match(html,/并列获奖/);assert.match(html.replace(/<[^>]*>/g,''),/2 号 · 3 票/);
});

test('战绩卡仅显示徽章图案，点击显示称号介绍，关闭还原；佩戴管理提交明确状态', async () => {
  const badge=require('../miniprogram/badges').catalogue.find(b=>b.id==='assassin_hit');
  const collection={badges:[{...badge,equipped:true}],version:0,periodStart:1};
  const calls=[];
  const c=client(async(path,options)=>{
    calls.push({path,data:options.body?JSON.parse(options.body):null});
    if(options.method==='POST')return response({...collection,version:1,badges:[{...badge,equipped:false}]});
    return response(collection);
  });
  c.state.playerCard={id:'p',scope:'leaderboard',name:'玩家',initial:'玩',badges:[badge]};
  c.state.playerCardStats={total:0,wins:0,rateLabel:'—',scoreTotal:0,byFaction:[]};
  const html=c.viewPlayerCard();
  assert.match(html,/aria-label="查看职业刺客徽章"/);
  assert.doesNotMatch(html,/>职业刺客</);
  c.ACTIONS.showPlayerCardBadge({dataset:{id:badge.id}});
  assert.match(c.viewPlayerCard(),/>职业刺客</);assert.match(c.viewPlayerCard(),/本月/);
  c.ACTIONS.closePlayerCardBadge();assert.doesNotMatch(c.viewPlayerCard(),/>职业刺客</);
  await c.applyRoute('#/badges');
  assert.equal(c.state.badgeCollection.badges[0].equipped,true);
  await c.ACTIONS.toggleOwnedBadge({dataset:{id:badge.id}});
  assert.deepEqual(calls.at(-1).data,{id:badge.id,equipped:false,version:0,periodStart:1});
  assert.equal(c.state.badgeCollection.badges[0].equipped,false);
});

test('网页限制3枚并保留换装能力，徽章详情不含计算规则', async () => {
  const badges=require('../miniprogram/badges').catalogue.slice(0,4).map((b,i)=>({...b,equipped:i<3}));
  let calls=0;
  const c=client(async()=>{calls++;return response({badges:badges.map(b=>({...b,equipped:false})),version:1});});
  Object.assign(c.state,{page:'badges',badgeFilter:'all',badgeCollection:{badges,version:0,periodStart:1}});
  await c.ACTIONS.toggleOwnedBadge({dataset:{id:badges[3].id}});
  assert.equal(calls,0);assert.match(c.state.badgeManagerError,/最多佩戴3枚/);
  await c.ACTIONS.toggleOwnedBadge({dataset:{id:badges[0].id}});assert.equal(calls,1);
  c.state.playerCard={id:'p',scope:'leaderboard',name:'甲',initial:'甲',badges};
  c.state.playerCardStats={total:0,wins:0,rateLabel:'—',scoreTotal:0,byFaction:[]};
  assert.equal((c.viewPlayerCard().match(/class="player-badge-button"/g)||[]).length,3);
  c.ACTIONS.showPlayerCardBadge({dataset:{id:badges[0].id}});
  assert.match(c.viewPlayerCard(),/积分王者/);assert.doesNotMatch(c.viewPlayerCard(),/按北京时间本月/);
});

test('网页荣誉入口进入独立路由，目录筛选与未拥有详情不提供佩戴操作', async () => {
  const {catalogue}=require('../miniprogram/badges');
  const c=client(async url=>response(url.endsWith('/badges') ? {badges:[{...catalogue[1],equipped:true}],version:0,periodStart:1} : {}));
  c.state.profile={nickname:'林间',identityType:'wx'};
  assert.match(c.viewMe(),/data-page="badges"/); assert.doesNotMatch(c.viewMe(),/toggleBadgeManager/);
  await c.applyRoute('#/badges');
  assert.equal(c.state.page,'badges'); assert.equal(c.viewNavigation(),'');
  assert.equal((c.viewBadgeManager().match(/class="badge-tile /g)||[]).length,18);
  assert.match(c.viewBadgeManager(),/<span> \/ 18<\/span>/);assert.match(c.viewBadgeManager(),/金牌替身/);
  c.ACTIONS.badgeFilter({dataset:{id:'owned'}});
  assert.equal((c.viewBadgeManager().match(/class="badge-tile /g)||[]).length,1);
  c.ACTIONS.badgeFilter({dataset:{id:'unowned'}});
  assert.equal((c.viewBadgeManager().match(/class="badge-tile /g)||[]).length,17);
  c.ACTIONS.showBadgeDetail({dataset:{id:'points'}});
  const detail=c.viewBadgeManager().split('class="badge-detail"')[1];
  assert.match(detail,/积分王者/);assert.match(detail,/未拥有/);assert.doesNotMatch(detail,/data-action="toggleOwnedBadge"/);
  c.ACTIONS.closeBadgeDetail(); assert.equal(c.state.selectedBadgeId,'');
});

test('网页徽章页离开后丢弃加载结果，失败刷新不误显示为零枚', async () => {
  let release, fail=false;
  const c=client(async url=> {
    if(url.endsWith('/badges')) { if(fail) throw new Error('网络断开'); return new Promise(resolve=>release=resolve); }
    return response({});
  });
  const pending=c.applyRoute('#/badges');await Promise.resolve();await Promise.resolve();
  await c.applyRoute('#/help');release(response({badges:[],version:0}));await pending;
  assert.equal(c.state.page,'help');assert.equal(c.state.badgeCollection,null);
  fail=true;await c.applyRoute('#/badges');assert.match(c.state.badgeManagerError,/网络/);
  assert.match(c.viewBadgeManager(),/刷新徽章/);assert.doesNotMatch(c.viewBadgeManager(),/未拥有 17/);
});

test('网页月初提醒只在我的页出现，确认失败可重试且服务端确认后不再显示', async () => {
  const notice = { month: '2026-10', previousMonth: '2026-09', previous: { total: 8, wins: 3, losses: 5, winRate: 37.5, points: 9 } };
  let fail = true, seen = false;
  const c = client(async (url, options) => {
    if (url === '/api/me/monthly-reset') { assert.equal(JSON.parse(options.body).month, '2026-10'); if (fail) throw Error('离线'); seen = true; return response({ month: '2026-10' }); }
    if (url === '/api/me/stats') return response({ total: 8, wins: 3, winRate: 37.5, score: { total: 0 }, monthlyReset: seen ? null : notice });
    if (url === '/api/me/profile') return response({ nickname: '月度玩家', identityType: 'wx' });
    return response({});
  });
  await c.applyRoute('#/me'); assert.equal(c.state.monthlyReset.previous.points, 9);
  await c.ACTIONS.monthlyResetDismiss(); assert.ok(c.state.monthlyReset); assert.match(c.state.resetError, /网络未确认/);
  fail = false; await c.ACTIONS.monthlyResetDismiss(); assert.equal(c.state.monthlyReset, null);
  await c.applyRoute('#/stats'); assert.equal(c.state.monthlyReset, null);
  await c.applyRoute('#/me'); assert.equal(c.state.monthlyReset, null);
});

test('网页徽章管理按需显示摘下，详情精简说明且保留获取条件', () => {
  const {catalogue}=require('../miniprogram/badges');
  const c=client(async()=>response({}));
  Object.assign(c.state,{page:'badges',badgeFilter:'all',badgeCollection:{badges:[{...catalogue[1],equipped:true}],periodStart:1}});
  assert.doesNotMatch(c.viewBadgeManager(),/class="badge-remove"/);
  c.ACTIONS.badgeManage();assert.match(c.viewBadgeManager(),/class="badge-remove"/);
  c.ACTIONS.badgeManage();c.ACTIONS.showBadgeDetail({dataset:{id:catalogue[1].id}});
  const detail=c.viewBadgeManager().split('class="badge-detail"')[1];
  assert.match(detail,/获取条件/);assert.match(detail,/持有规则/);
  assert.doesNotMatch(detail,/按北京时间本月|摘下后仍保留/);
  assert.match(detail,/secondary badge-detail-action/);
});

test('网页版回避卡单选、确认、只读和私密结果遮盖，与小程序规则一致', async () => {
  const value = { code: '123456', stage: 1, phase: 'lobby', balance: 1, selected: null, editable: true,
    options: [{ id: 'merlin', name: '梅林', faction: 'good', count: 1, portrait: '/assets/roles/merlin.png' }] };
  const c = client(async () => response(value)); c.state.page = 'table';
  c.state.room = { code: '123456', stage: 1, phase: 'lobby', me: { seat: 1, ready: true, avoidance: { balance: 1 } } };
  try {
    await c.ACTIONS.openAvoidance(); assert.equal(c.state.avoidanceOpen, true);
    c.ACTIONS.chooseAvoidance({ dataset: { id: 'merlin' } });
    assert.equal(c.state.avoidanceDraft, 'merlin');
    assert.equal(c.state.room.me.ready, true);
    assert.match(c.viewAvoidance(), /aria-pressed="true"/); assert.match(c.viewAvoidance(), />避开梅林<\/button>/);
    c.state.avoidance.selected = 'merlin';
    assert.match(c.viewAvoidance(), />不避开了（不扣卡）<\/button>/); assert.doesNotMatch(c.viewAvoidance(), /data-action="saveAvoidance"/);
    c.state.avoidance.options.push({ id: 'percival', name: '派西维尔', faction: 'good', count: 1, portrait: '/assets/roles/percival.png' });
    c.ACTIONS.chooseAvoidance({ dataset: { id: 'percival' } });
    assert.match(c.viewAvoidance(), />改成避开派西维尔<\/button>/); assert.doesNotMatch(c.viewAvoidance(), /data-action="cancelAvoidance"/);
    c.ACTIONS.closeAvoidance(); assert.equal(c.state.avoidance, null); assert.equal(c.state.avoidanceDraft, '');
    c.state.dealtIdentityDialog = true; c.state.dealtIdentitySecret = null;
    assert.doesNotMatch(c.viewDealtIdentity(), /已回避/);
    c.state.dealtIdentitySecret = { role: '忠臣', faction: '好人', factionTone: 'good', information: '没有视野', avoidance: { roleName: '梅林', status: 'effective' } };
    assert.match(c.viewDealtIdentity(), /已回避「梅林」/);
    c.ACTIONS.closeDealtIdentity(); assert.equal(c.state.dealtIdentitySecret, null);
  } finally { c.stop(); }
});
test('网页版优先提示暂无回避卡，发牌后隐藏牌桌回避卡入口', () => {
  const c = client(async () => response({})); c.state.page = 'table';
  c.state.room = { code: '123456', stage: 1, phase: 'lobby', players: [], team: [], history: [], me: { seat: 1, ready: true, avoidance: { balance: 0 } } };
  try {
    c.state.avoidanceOpen = true; c.state.avoidance = { balance: 0, editable: false };
    const html = c.viewAvoidance();
    assert.match(html, /class="avoidance-note">暂无回避卡<\/div>/);
    assert.doesNotMatch(html, /取消准备后|当前无法使用回避卡/);
    c.ACTIONS.closeAvoidance();
    assert.match(c.viewRoom(), /data-action="openAvoidance"/);
    let actions = c.viewRoom().split('<div class="web-lobby-action-inner">')[1];
    assert.ok(actions.indexOf('data-action="openAvoidance"') < actions.indexOf('data-action="ready"'));
    assert.match(actions, /取消准备/);
    c.state.room.me.isHost = true; c.state.canStart = true;
    actions = c.viewRoom().split('<div class="web-lobby-action-inner">')[1];
    assert.ok(actions.indexOf('data-action="ready"') < actions.indexOf('data-action="start"'));
    c.state.network = false;
    assert.match(c.viewRoom(), /data-action="ready" disabled/);
    c.state.network = true;
    for (const phase of ['identity', 'tools', 'quest', 'ended', 'terminated']) {
      c.state.room.phase = phase;
      assert.doesNotMatch(c.viewRoom(), /data-action="openAvoidance"/);
    }
  } finally { c.stop(); }
});
