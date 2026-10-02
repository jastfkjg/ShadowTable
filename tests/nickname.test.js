const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { wxmlToJs } = require('miniprogram-compiler');
const { createApp } = require('../server/app');
const { Store } = require('../server/store');
const { readProfile } = require('../server/profile');
const root = resolve(__dirname, '../miniprogram');
const fingerprint = (path, data) => createHash('sha256').update(JSON.stringify([path, data])).digest('hex');
async function launch(database = ':memory:') {
  const app = createApp({ database, exchangeCode: async code => code });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  return { ...app,
    async request(path, token, data, id = randomUUID()) {
      const response = await fetch(base + path, { method: data ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + (token || ''), 'Content-Type': 'application/json', 'Idempotency-Key': id },
        body: data ? JSON.stringify(data) : undefined });
      return { status: response.status, data: await response.json() };
    },
    async login(code) { return (await this.request('/api/login', null, { code })).data.token; },
    async close() { await new Promise(resolve => app.server.close(resolve)); app.store.close(); },
  };
}
test('登录与恢复牌桌不强制设置；首次创建和加入确认昵称，与个人资料同事务且幂等', async () => {
  const app = await launch();
  try {
    const host = await app.login('host'), player = await app.login('player');
    assert.equal((await app.request('/api/me/profile', host)).data.nicknameConfirmed, false);
    const body = { name: '林间', capacity: 6, confirmNickname: true, profileVersion: 0 }, id = randomUUID();
    const first = await app.request('/api/rooms', host, body, id);
    assert.equal(first.status, 200); assert.equal(first.data.profile.nickname, '林间');
    assert.equal(first.data.profile.nicknameConfirmed, true); assert.equal(first.data.profile.version, 1);
    assert.deepEqual(await app.request('/api/rooms', host, body, id), first);
    const path = '/api/rooms/' + first.data.code;
    assert.equal((await app.request(path + '/join', player, { name: '晚风', confirmNickname: true, profileVersion: 0 })).status, 200);
    assert.equal((await app.request('/api/me/profile', player)).data.nickname, '晚风');
    const again = await app.login('host');
    assert.deepEqual((await app.request('/api/me/profile', again)).data, first.data.profile);
    assert.equal((await app.request(path, again)).data.me.name, '林间');
    const uid = 'wx:' + createHash('sha256').update('host').digest('hex');
    app.store.transaction(() => app.store.archiveMatch({ id: randomUUID(), board: 'classic', endedAt: Date.now(),
      players: [{ uid, faction: 'good', outcome: 'win' }] }));
    const ranked = (await app.request('/api/leaderboard?metric=games', again)).data;
    assert.equal(ranked.rows[0].nickname, '林间'); assert.equal(ranked.me.total, 1);
    const oldClient = await app.login('old-client');
    assert.equal((await app.request(path + '/join', oldClient, { name: '仅本桌名' })).status, 200);
    await app.request(path, oldClient);
    assert.equal((await app.request('/api/me/profile', oldClient)).data.nicknameConfirmed, false);
  } finally { await app.close(); }
});
test('已设置个人昵称再次进桌仅修改本桌名；旧设备的首次确认不会覆盖新个人昵称、头像和隐藏选择', async () => {
  const app = await launch();
  try {
    const token = await app.login('confirmed');
    const saved = (await app.request('/api/me/profile', token, { nickname: '新朋友', version: 0,
      avatar: 'builtin:avatar-01', leaderboardVisible: false })).data;
    assert.equal(saved.nicknameConfirmed, true);
    const create = await app.request('/api/rooms', token, { name: '本桌化名', capacity: 6, confirmNickname: true, profileVersion: 0 });
    assert.equal(create.status, 200); assert.deepEqual(create.data.profile, saved);
    assert.equal((await app.request('/api/rooms/' + create.data.code, token)).data.me.name, '本桌化名');
    await app.request('/api/rooms', token, { name: '第二桌', capacity: 6 });
    assert.deepEqual((await app.request('/api/me/profile', await app.login('confirmed'))).data, saved);
  } finally { await app.close(); }
});
test('历史默认名需确认，公开开关不确认昵称；失败与版本冲突不会留下新昵称、房间或榜单缓存变更', async () => {
  const app = await launch();
  try {
    const token = await app.login('legacy');
    const old = (await app.request('/api/me/leaderboard-visibility', token, { leaderboardVisible: false })).data;
    assert.equal(old.nickname, '新朋友'); assert.equal(old.nicknameConfirmed, false);
    const revision = app.store.leaderboardRevision;
    const body = { name: '确认后的名字', capacity: 6, confirmNickname: true, profileVersion: old.version }, id = randomUUID();
    assert.equal((await app.request('/api/rooms/000000/join', token, body)).status, 404);
    assert.equal((await app.request('/api/rooms', token, { ...body, profileVersion: 0 })).status, 409);
    for (const invalid of [false, 'true', 1])
      assert.equal((await app.request('/api/rooms', token, { ...body, confirmNickname: invalid })).status, 400);
    const addReceipt = app.store.addReceipt;
    app.store.addReceipt = () => { throw Error('write failed'); };
    assert.equal((await app.request('/api/rooms', token, body, id)).status, 500);
    app.store.addReceipt = addReceipt;
    assert.equal(app.store.leaderboardRevision, revision);
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 0);
    assert.deepEqual((await app.request('/api/me/profile', token)).data, old);
    const saved = await app.request('/api/rooms', token, body, id);
    assert.equal(saved.status, 200); assert.equal(saved.data.profile.nickname, body.name);
    assert.equal(saved.data.profile.nicknameConfirmed, true); assert.equal(saved.data.profile.leaderboardVisible, false);
    assert.equal(saved.data.profile.version, old.version + 1);
    assert.deepEqual(await app.request('/api/rooms', token, body, id), saved);
  } finally { await app.close(); }
});
test('旧资料迁移区分主动保存的新朋友和开关生成的默认名，未知来源需确认且重启不重置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-nickname-')), path = join(dir, 'db.sqlite');
  let store;
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE profiles(uid TEXT PRIMARY KEY,nickname TEXT NOT NULL,avatar_hash TEXT,version INTEGER NOT NULL,
      updated INTEGER NOT NULL,leaderboard_visible INTEGER NOT NULL,public_id TEXT);
      CREATE TABLE receipts(uid TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,
        created INTEGER NOT NULL,PRIMARY KEY(uid,request));`);
    const insert = legacy.prepare('INSERT INTO profiles VALUES(?,?,NULL,1,1,0,?)');
    for (const [uid, nickname] of [['wx:named','已设置'], ['wx:auto','新朋友'], ['wx:explicit','新朋友'], ['wx:unknown','新朋友'], ['wx:blank','']])
      insert.run(uid, nickname, randomUUID());
    const receipt = legacy.prepare('INSERT INTO receipts VALUES(?,?,?,?,1)');
    for (const [uid, path, body] of [['wx:auto','/api/me/leaderboard-visibility',{leaderboardVisible:false}],
      ['wx:explicit','/api/me/profile',{nickname:'新朋友',version:0}]])
      receipt.run(uid, randomUUID(), fingerprint(path, body), JSON.stringify({nickname:'新朋友',version:1,identityType:'wx'}));
    const before = legacy.prepare('SELECT * FROM profiles ORDER BY uid').all();
    legacy.close(); store = new Store(path);
    for (const uid of ['wx:named','wx:explicit']) assert.equal(readProfile(store, uid).nicknameConfirmed, true);
    for (const uid of ['wx:auto','wx:unknown','wx:blank']) assert.equal(readProfile(store, uid).nicknameConfirmed, false);
    assert.deepEqual(store.db.prepare('SELECT uid,nickname,avatar_hash,version,updated,leaderboard_visible,public_id FROM profiles ORDER BY uid').all(), before);
    store.close(); store = new Store(path);
    assert.equal(readProfile(store, 'wx:explicit').nicknameConfirmed, true);
    assert.equal(readProfile(store, 'wx:unknown').nicknameConfirmed, false);
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
function miniPage(route, api, storage = new Map()) {
  let definition;
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key), navigateTo: options => options.complete?.(), showToast() {},
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, navigateBack() {} };
  const appState = {};
  function load(file) {
    if (file === join(root, 'api.js')) return api;
    const mod = { exports: {} };
    vm.runInNewContext(readFileSync(file, 'utf8'), { module: mod, require: name => load(resolve(dirname(file), name + '.js')),
      Page: page => definition = page, wx, getApp: () => appState, getCurrentPages: () => [{},{}], setTimeout, clearTimeout });
    return mod.exports;
  }
  load(join(root, 'pages', route, route + '.js'));
  return { ...definition, data: structuredClone(definition.data), alive: true, foreground: true,
    setData(patch, callback) { Object.assign(this.data, patch); callback?.(); }, schedule() {} };
}
const miniApi = { login: async () => {}, requestId: randomUUID, assetUrl: path => path };
async function idle(page) { while (page.data.busy) await new Promise(resolve => setImmediate(resolve)); }
const template = vm.runInNewContext('(function(global){' +
  wxmlToJs(root, { wxmlList: ['pages/lobby/lobby.wxml','pages/table/shared.wxml'], wxsList: [] }) + '})(global)',
  { window: {}, global: {} });
function entryTree(page) { return JSON.stringify(template('pages/lobby/lobby.wxml')(page.data)); }
test('小程序历史默认名预填本桌名并显式确认，网络重试保留请求和最终表单值；确认后只改本桌名', async () => {
  let current = { nickname: '新朋友', nicknameConfirmed: false, version: 1 }, fail = true;
  const writes = [], storage = new Map([['nickname','原本桌名字']]);
  const api = { ...miniApi, request: async (url, method, body, id) => {
    if (method === 'POST') {
      writes.push({ url, body: structuredClone(body), id });
      if (fail) { fail = false; throw Error('network lost'); }
      if (body.confirmNickname) current = { nickname: body.name, nicknameConfirmed: true, version: 2 };
      return { code: '123456', ...(body.confirmNickname ? { profile: current } : {}) };
    }
    return url.endsWith('/profile') ? current : { rooms: [] };
  } };
  const lobby = miniPage('lobby', api, storage);
  lobby.setData({ loading: false }); await lobby.refreshLobby();
  assert.equal(lobby.data.name, '原本桌名字'); assert.equal(lobby.data.nicknameSetup, true);
  assert.match(entryTree(lobby), /玩家昵称|确认昵称并加入房间/);
  assert.match(entryTree(lobby), /用于牌桌和排行榜/);
  lobby.setData({ entryMode: 'create', name: '事件未更新的名字' });
  lobby.submitEntry({ detail: { value: { nickname: '微信快捷填写的名字' } } }); await idle(lobby);
  assert.equal(lobby.data.hasPendingRequest, true);
  await lobby.retry();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].body.name, '微信快捷填写的名字');
  assert.equal(writes[0].body.confirmNickname, true); assert.equal(writes[0].body.profileVersion, 1);
  await lobby.refreshLobby(); assert.equal(lobby.data.nicknameSetup, false);
  assert.equal(lobby.data.name, '微信快捷填写的名字');
  lobby.inputName({ detail: { value: '仅本桌临时名' } }); lobby.setData({ code: '123456' });
  lobby.join(); await idle(lobby);
  assert.equal(writes.at(-1).body.name, '仅本桌临时名'); assert.equal(writes.at(-1).body.confirmNickname, undefined);
  assert.equal(current.nickname, '微信快捷填写的名字');
});
test('小程序已有个人昵称新登录直接带入，主动选择新朋友也不再次要求确认；微信填写支持表单最终值', async () => {
  for (const nickname of ['个人昵称','新朋友']) {
    const profile = { nickname, nicknameConfirmed: true, version: 3, identityType: 'wx' };
    const api = { ...miniApi, request: async url => url.endsWith('/profile') ? profile : { rooms: [] } };
    const lobby = miniPage('lobby', api, new Map([['nickname','之前的本桌名']]));
    await lobby.refreshLobby(); assert.equal(lobby.data.name, nickname); assert.equal(lobby.data.nicknameSetup, false);
    assert.doesNotMatch(entryTree(lobby), /确认昵称并加入房间|用于牌桌和排行榜/);
  }
  const writes = [];
  const editor = miniPage('profile', { ...miniApi, request: async (url, method, body) => {
    if (method === 'POST') { writes.push(body); return { ...body, nicknameConfirmed: true }; }
    return { nickname: '', nicknameConfirmed: false, version: 0, avatarUrl: null };
  } });
  await editor.load();
  editor.setData({ nickname: '旧输入事件值' });
  await editor.save({ detail: { value: { nickname: '微信表单最终值' } } });
  assert.equal(writes[0].nickname, '微信表单最终值');
  assert.match(readFileSync(join(root, 'pages/profile/profile.wxml'), 'utf8'), /name="nickname" type="nickname"/);
});
test('首次昵称确认遇到资料版本冲突，刷新版本保留微信最终填写值，再次提交可成功', async () => {
  let profile = { nickname: '', nicknameConfirmed: false, version: 0 }, conflict = true;
  const bodies = [];
  const lobby = miniPage('lobby', { ...miniApi, request: async (url, method, body) => {
    if (method === 'POST') {
      bodies.push(body);
      if (conflict) {
        conflict = false; profile = { nickname: '新朋友', nicknameConfirmed: false, version: 1 };
        throw Object.assign(Error('资料已更新'), { status: 409 });
      }
      profile = { nickname: body.name, nicknameConfirmed: true, version: 2 };
      return { code: '123456', profile };
    }
    return url.endsWith('/profile') ? profile : { rooms: [] };
  } });
  lobby.setData({ loading: false }); await lobby.refreshLobby();
  const form = { detail: { value: { nickname: '微信快捷选择值', code: '123456' } } };
  lobby.submitEntry(form); await idle(lobby);
  assert.equal(lobby.pending, null); assert.equal(lobby.data.name, '微信快捷选择值');
  assert.equal(lobby.data.nicknameVersion, 1);
  lobby.submitEntry(form); await idle(lobby);
  assert.deepEqual(bodies.map(body => body.profileVersion), [0, 1]);
  assert.equal(profile.nickname, '微信快捷选择值');
});
function webClient(fetch, storage = new Map([['session','token']])) {
  const fields = { nickname: { value: '' }, code: { value: '123456' } };
  const element = { querySelector() { return null; }, addEventListener() {}, hidden: true };
  const context = { document: { getElementById: id => fields[id] || element, addEventListener() {} },
    window: { history: { pushState() {}, replaceState() {} }, scrollTo() {}, addEventListener() {} },
    location: { hash: '#/lobby' }, navigator: {}, URL, URLSearchParams, fetch,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout() { return 1; }, clearTimeout() {}, console };
  const source = readFileSync(resolve(__dirname, '../server/web/app.js'), 'utf8');
  vm.runInNewContext(source.slice(0, source.indexOf('  // ===== boot =====')) + `
    render = function () {}; refresh = async function () {};
    window.test = { state, applyRoute, ACTIONS, viewEntry };
  })();`, context);
  return { ...context.window.test, fields, storage };
}
const response = data => ({ status: 200, json: async () => data });
async function webIdle(client) { while (client.state.busy) await new Promise(resolve => setImmediate(resolve)); }
test('网页与小程序使用相同的首次确认规则，重试不重复保存且已设置用户只改本桌名', async () => {
  let profile = { nickname: '新朋友', nicknameConfirmed: false, version: 1 }, fail = true;
  const posts = [], storage = new Map([['session','token'], ['nickname','已填过的本桌名']]);
  const client = webClient(async (url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); posts.push({body, id: options.headers['Idempotency-Key']});
      if (fail) { fail = false; throw Error('network lost'); }
      if (body.confirmNickname) profile = { nickname: body.name, nicknameConfirmed: true, version: 2 };
      return response({code:'123456', ...(body.confirmNickname ? {profile} : {})});
    }
    return response(url.endsWith('/profile') ? profile : {rooms:[]});
  }, storage);
  await client.applyRoute('#/lobby'); client.state.loading = false;
  assert.equal(client.state.name, '已填过的本桌名');
  assert.match(client.viewEntry(), /确认昵称并加入房间/);
  client.fields.nickname.value = '首次确认名'; client.ACTIONS.join(); await webIdle(client);
  await client.ACTIONS.retry();
  assert.deepEqual(posts[0], posts[1]); assert.equal(posts[0].body.profileVersion, 1);
  assert.equal(client.state.profile.nickname, '首次确认名');
  await client.applyRoute('#/lobby');
  assert.doesNotMatch(client.viewEntry(), /确认昵称并加入房间/);
  assert.equal(client.state.name, '首次确认名');
  client.fields.nickname.value = '本桌化名'; client.ACTIONS.create(); await webIdle(client);
  assert.equal(posts.at(-1).body.confirmNickname, undefined); assert.equal(profile.nickname, '首次确认名');
});
