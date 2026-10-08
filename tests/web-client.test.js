const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { newRoom, enter, command, publicView, BOARDS } = require("../server/engine");

function client(fetch, storage = new Map([["session", "session"]]), layout, runtime = {}) {
  let scheduled, scheduledDelay;
  const events = {};
  const scrolls = [], lookups = [], navigations = [];
  const element = { querySelector() { return null; }, focus() {}, scrollIntoView(options) { scrolls.push(options); }, addEventListener() {}, hidden: true, classList: { add() {}, remove() {} } };
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
  context.window.shadowtableLeaderboard = require('../miniprogram/leaderboard-presentation');
  context.window.shadowtableResultRegistration = require('../miniprogram/result-registration');
  vm.runInNewContext(source.slice(0, source.indexOf("  // ===== boot =====")) + `
    render = function () {};
    roomCode = "123456";
    window.test = { request, requestId, mutate, handleError, recoverConnection, retry, login, state, schedule, loadSettings, settingsSave, CHANGES, ACTIONS, viewActionDialog, refresh, viewRoom, viewHostBar, viewSettingsDialog, kickFromSettings, sendKick,
      viewPlayerCard, openPlayerCard, closePlayerCard, viewDealtIdentity, viewIdentityHistory, showIdentityHintWhenVisible, viewStats, viewResultDialog, seatAvatarError, loadMatches, viewMatches,
      navigate, applyRoute, loadProfile, saveProfile, viewNavigation, INPUTS, loadLeaderboard, viewLeaderboard, viewProfileEditor, viewMe,
      initializeWebAccount, startWebLogin, pollWebLogin, cancelWebLogin, continueAsGuest, viewWebLogin, bootstrap,
      getWebSessionTag() { return webSessionTag; },
      setConfirm(fn) { confirm = fn; },
      setRefresh(fn) { refresh = fn; },
      stop() { foreground = false; }
    };
  })();`, context);
  return { ...context.window.test, scrolls, lookups, navigations, events, document: context.document, scheduled: () => scheduled, scheduledDelay: () => scheduledDelay };
}
const response = (body) => ({ status: 200, json: async () => body });
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
  await c.applyRoute('#/matches');assert.equal((c.viewMatches().match(/总积分 4/g)||[]).length,1);
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
  assert.match(html, /id="history-record-0"/);
  assert.match(html, /票弃权/);
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

test('网页房主计分开关自动保存，人数默认值及发牌锁定与服务端一致',async()=>{
  const room=newRoom('123456','host','房主','classic',6),writes=[];
  const c=client(async(path,options)=>{
    if(options?.method==='POST'){const data=JSON.parse(options.body);writes.push(data);command(room,'host',data);return response({accepted:true});}
    return response(path==='/api/boards'?{boards:BOARDS}:publicView(room,'host'));
  });
  c.state.showRoomSettings=true;c.state.settings={busy:false};await c.loadSettings();
  assert.equal(c.state.settings.scoreEnabled,false);assert.match(c.viewSettingsDialog(),/aria-label="本局计分"/);
  await c.CHANGES.settingsScoring({checked:true});assert.equal(room.scoreEnabled,true);assert.equal(writes[0].scoreEnabled,true);
  await c.CHANGES.settingsCapacity({value:'12'});assert.equal(room.scoreEnabled,true);
  await c.CHANGES.settingsScoring({checked:false});assert.equal(room.scoreEnabled,false);
  await c.CHANGES.settingsCapacity({value:'10'});assert.equal(room.scoreEnabled,true);
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

test("结果图标、记录时间与最近转换可见；座位可收起，记录从三条展开", async () => {
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
  assert.match(html, /公开记录 · 共4条/);
  assert.match(html, /第1次 · × 失败/);
  assert.equal((html.match(/class="history-row"/g) || []).length, 3);
  assert.match(html, /展开更早的 1 条记录/);
  c.ACTIONS.toggleHistory();
  html = c.viewRoom();
  assert.equal((html.match(/class="history-row"/g) || []).length, 4);
  assert.ok(html.indexOf("#4") < html.indexOf("#1"));
  c.ACTIONS.toggleSeats();
  assert.doesNotMatch(c.viewRoom(), /class="seats"/);
  c.ACTIONS.toggleSeats();
  assert.match(c.viewRoom(), /class="seats"/);
  c.state.room = { ...c.state.room, phase: "teamVote", team: [1, 4], needsSubmission: true };
  c.state.actionDialog = true;
  c.state.actionLabel = "是否同意这支队伍？";
  assert.match(c.viewActionDialog(), /任务队伍：1、4号/);
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
  assert.equal(c.scrolls.length, 1);
  assert.equal(c.state.focusedHistoryKey, c.state.latestResult.key);
  run("p1", "beginActivity", { kind: "vote" });
  await c.refresh();
  html = c.viewRoom();
  assert.doesNotMatch(html, /class="latest-result"|上次结果/);
  assert.match(html, /id="history-record-0"/);
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
  assert.equal(c.state.historyExpanded, true);
  assert.equal(c.state.focusedHistoryKey, 0);
  assert.equal(c.lookups.at(-1), "history-record-0");
  assert.equal(c.scrolls[0].block, "start");
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

test("网页隐藏轮次推进，时间在标题右侧，记录定位和最新结果保持对应", async () => {
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
  const html = c.viewRoom();
  assert.ok(!html.includes("进入第"));
  assert.match(html, /history-title"><span>技能最终结果<\/span><span class="history-time">\d{2}:\d{2}<\/span><\/div><span class="history-number">#3/);
  assert.ok(!html.includes('history-subtitle'));
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
  const c=client(async url=>{urls.push(url);if(urls.length===1)return new Promise(resolve=>resolveOld=resolve);const metric=new URL('http://test'+url).searchParams.get('metric');return response({...result(metric),...(metric==='fun_good_shield'?{role:null,roleOptions:[]}: {})});});
  const old=c.applyRoute('#/leaderboard');await new Promise(resolve=>setImmediate(resolve));
  await c.loadLeaderboard(false,{rankMetric:'fun_knife_enemy',rankFunSort:'rate',rankFunRole:'gareth'});resolveOld(response(webRanks('points')));await old;
  c.ACTIONS.rankToggleMine();
  assert.equal(c.state.rankBoard.metric,'fun_knife_enemy');assert.match(urls[1],/mode=all&sort=rate&role=gareth/);assert.match(c.viewLeaderboard(),/还差 6 次机会/);assert.match(c.viewLeaderboard(),/成功 3 次 · 共 4 次机会/);
  c.ACTIONS.rankToggleMetrics();
  const options=require('../miniprogram/leaderboard-presentation').funOptions(defs,{includeFinal:true});
  let html='';
  for(const category of ['good','evil','more']) {
    c.ACTIONS.funRankCategory({dataset:{value:category}});
    const group=c.viewLeaderboard();html+=group;
    assert.equal((group.match(/data-action="funRankPreview"/g)||[]).length,options.filter(item=>item.category===category).length);
  }
  assert.match(html,/好人 · 成功挡刀/);assert.match(html,/刀客刀法 · 刀中敌方/);
  assert.doesNotMatch(html,/查看不同角色的高光|次数榜至少|次机会参与排名|fun-option-description/);
  c.ACTIONS.rankToggleMetrics();
  await c.ACTIONS.funRankMetric({dataset:{value:'fun_good_shield'}});assert.match(urls.at(-1),/metric=fun_good_shield.*mode=all&sort=rate$/);
  c.ACTIONS.rankToggleRules();assert.match(c.viewLeaderboard(),/挡刀率 = 挡刀次数/);assert.equal(c.state.rankFunRole,'');
  for (const [key,label] of [['fun_percival_bust','派西维尔 · 三炸车'],['fun_merlin_hit','梅林 · 被刺'],['fun_assassin_miss','刺客 · 歪刀'],['fun_knife_ally','刀客刀法 · 刀中友方'],['fun_duel_ally','骑士 · 决斗友方']]) {
    assert.ok(html.includes(label));
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

test('个人趣味入口不显示预览，昵称仍转义动态文字，排名详情按需打开', async () => {
  const c = client(async () => response(webRanks()));
  c.state.profile = {nickname:'<img src=x onerror=attack()>昵称',identityType:'wx'};
  c.state.stats = {total:1,wins:1,winRate:100,fun:{teaser:'<img src=x onerror=attack()>战报'}};
  const html = c.viewMe();
  assert.match(html, /data-page="stats\?tab=fun"/);
  assert.doesNotMatch(html, /&lt;span|<img src=x/);
  assert.match(html, /&lt;img src=x onerror=attack\(\)&gt;昵称/);
  assert.doesNotMatch(html, /战报/);
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
  c.state.page='leaderboard';await c.loadLeaderboard(false,{rankMetric:'fun_good_shield'});
  c.ACTIONS.rankToggleMetrics();c.ACTIONS.funRankCategory({dataset:{value:'evil'}});c.ACTIONS.funRankPreview({dataset:{value:'fun_assassin_miss'}});
  assert.match(c.viewLeaderboard(),/rank-workspace" inert/);assert.equal(urls.length,1);
  c.ACTIONS.rankToggleMetrics();assert.equal(c.state.rankMetric,'fun_good_shield');
  c.ACTIONS.rankToggleMetrics();assert.equal(c.state.rankPendingMetric,'fun_good_shield');
  c.ACTIONS.funRankCategory({dataset:{value:'evil'}});c.ACTIONS.funRankPreview({dataset:{value:'fun_assassin_miss'}});
  await c.ACTIONS.funRankConfirm();assert.match(urls.at(-1),/metric=fun_assassin_miss/);assert.equal(c.state.rankMetricsExpanded,false);
  c.ACTIONS.rankToggleRules();c.ACTIONS.rankToggleMine();assert.equal(c.state.rankRulesExpanded,false);
});
