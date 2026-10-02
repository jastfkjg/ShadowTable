const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApp } = require('../server/app');
const { newRoom } = require('../server/engine');
const origin = 'https://play.example.com';
const digest = s => createHash('sha256').update(s).digest('hex');
const image = { mime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') };
async function setup(t, options = {}) {
  let now = Date.now();
  const app = createApp({ database: ':memory:', webOrigin: origin, webWechatLogin: true,
    exchangeCode: async code => code, wechatCode: async () => image, clock: () => now, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  async function close() { if (!closed) { closed = true; await new Promise(r => app.server.close(r)); app.store.close(); } }
  t.after(close);
  async function req(path, data, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path,
        method: data === undefined ? 'GET' : 'POST', headers: { Host: 'play.example.com', Origin: origin,
          'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...headers } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data: JSON.parse(Buffer.concat(chunks)) }));
      });
      request.on('error', reject); request.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  const bearer = token => ({ Authorization: 'Bearer ' + token });
  const wx = async (code = 'mini-openid') => (await req('/api/login', { code })).data.token;
  const guest = async () => (await req('/api/guest-login', {})).data.token;
  async function qr(token) {
    const result = await req('/api/web-auth/requests', {}, token ? bearer(token) : {});
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { ...result.data, binding: result.headers['set-cookie'][0].split(';')[0] };
  }
  async function confirm(q, token) {
    assert.equal((await req('/api/web-auth/requests/' + q.id + '/inspect', {}, bearer(token))).status, 200);
    assert.equal((await req('/api/web-auth/requests/' + q.id + '/confirm', {}, bearer(token))).status, 200);
  }
  const claim = q => req('/api/web-auth/requests/' + q.id + '/claim', {}, { Cookie: q.binding });
  const cookieAuth = result => ({ Cookie: result.headers['set-cookie'][0].split(';')[0], 'X-Web-Session': result.data.sessionTag });
  return { app, req, bearer, wx, guest, qr, confirm, claim, cookieAuth, close, advance: ms => { now += ms; } };
}

test('扫码登录共用小程序用户与座位，游客资料保留；Cookie 独立，退出不撤销小程序', async t => {
  const a = await setup(t), wx = await a.wx(), guest = await a.guest();
  await a.req('/api/me/profile', { nickname: '小程序玩家', version: 0 }, a.bearer(wx));
  await a.req('/api/me/profile', { nickname: '游客原资料', version: 0 }, a.bearer(guest));
  const q = await a.qr(guest), path = '/api/web-auth/requests/' + q.id;
  assert.match(q.id, /^[a-f0-9]{32}$/); assert.match(q.qrCode, /^data:image\/png;base64,/);
  assert.equal((await a.claim(q)).status, 409);
  assert.equal((await a.req(path + '/confirm', {}, a.bearer(wx))).status, 409);
  const inspect = await a.req(path + '/inspect', {}, a.bearer(wx));
  assert.equal(inspect.data.website, origin); assert.equal(inspect.data.status, 'scanned');
  assert.doesNotMatch(JSON.stringify(inspect.data), /uid|token|secret|hash/);
  assert.equal((await a.req(path, undefined, { Cookie: q.binding })).data.status, 'scanned');
  await a.req(path + '/confirm', {}, a.bearer(wx));
  const result = await a.claim(q), auth = a.cookieAuth(result);
  assert.equal(result.status, 200); assert.equal(result.data.token, undefined);
  assert.match(result.headers['set-cookie'][0], /__Host-shadowtable_web=.*HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/);
  assert.equal((await a.req('/api/me/profile', undefined, auth)).data.nickname, '小程序玩家');
  assert.equal((await a.req('/api/me/profile', undefined, a.bearer(guest))).data.nickname, '游客原资料');
  const room = (await a.req('/api/rooms', { name: '小程序玩家', capacity: 6 }, a.bearer(wx))).data;
  await a.req('/api/rooms/' + room.code + '/join', { name: '网页登录' }, auth);
  assert.equal(a.app.store.get(room.code).players.length, 1);
  assert.equal((await a.req('/api/web-auth/logout', {}, auth)).status, 409);
  const saved = a.app.store.get(room.code); saved.phase = 'terminated'; a.app.store.save(saved);
  assert.equal((await a.req('/api/web-auth/logout', {}, { ...auth, Cookie: auth.Cookie + '; ' + q.binding })).status, 200);
  assert.equal((await a.req('/api/me/profile', undefined, auth)).status, 401);
  assert.equal((await a.req('/api/me/profile', undefined, a.bearer(wx))).data.nickname, '小程序玩家');
  assert.equal((await a.claim(q)).status, 409);
});

test('二维码与扫码身份不能冒领会话，跨站与过期浏览器身份不回落到游客', async t => {
  const a = await setup(t), token = await a.wx(), outsider = await a.wx('another'), guest = await a.guest();
  const q = await a.qr(), path = '/api/web-auth/requests/' + q.id;
  assert.equal((await a.req(path + '/inspect', {}, a.bearer(guest))).status, 401);
  await a.confirm(q, token);
  assert.equal((await a.req(path + '/inspect', {}, a.bearer(outsider))).status, 409);
  assert.equal((await a.req(path + '/confirm', {}, a.bearer(outsider))).status, 409);
  assert.equal((await a.req(path + '/claim', {}, a.bearer(token))).status, 403);
  assert.equal((await a.req(path)).status, 403);
  assert.equal((await a.req(path + '/claim', {}, { Cookie: q.binding, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await a.req(path, undefined, { Cookie: q.binding, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const result = await a.claim(q), auth = a.cookieAuth(result);
  for (const headers of [{ ...auth, Host: 'evil.example' }, { ...auth, 'Sec-Fetch-Site': 'cross-site' }])
    assert.equal((await a.req('/api/me/profile', undefined, headers)).status, 403);
  assert.equal((await a.req('/api/me/profile', undefined, { Cookie: auth.Cookie, ...a.bearer(guest) })).status, 409);
  assert.equal((await a.req('/api/me/profile', undefined, { ...auth, 'X-Web-Session': 'stale-tab' })).status, 409);
  assert.equal((await a.req('/api/me/profile', undefined, a.bearer(auth.Cookie.split('=')[1]))).status, 401);
  assert.equal((await a.req('/api/me/profile', undefined, { 'X-Web-Session': auth['X-Web-Session'], ...a.bearer(guest) })).status, 401);
  assert.equal((await a.req('/api/me/profile', { nickname: '篡改', version: 0 }, { ...auth, Origin: 'https://evil.example' })).status, 403);
  a.advance(31 * 86400000);
  assert.equal((await a.req('/api/web-auth/session', undefined, auth)).data.authenticated, false);
  assert.equal((await a.req('/api/me/profile', undefined, { ...auth, ...a.bearer(guest) })).status, 401);
});

test('取消、刷新和过期均使旧请求失效；确认和领取响应丢失可安全重试', async t => {
  const a = await setup(t), token = await a.wx(), q = await a.qr(), path = '/api/web-auth/requests/' + q.id;
  await a.confirm(q, token);
  const first = await a.claim(q), again = await a.claim(q);
  assert.deepEqual(first.data, again.data); assert.deepEqual(first.headers['set-cookie'], again.headers['set-cookie']);
  assert.equal(a.app.store.db.prepare('SELECT count(*) AS n FROM web_sessions').get().n, 1);
  assert.equal((await a.req(path + '/confirm', {}, a.bearer(token))).data.status, 'consumed');
  const rejected = await a.qr();
  await a.req('/api/web-auth/requests/' + rejected.id + '/inspect', {}, a.bearer(token));
  await a.req('/api/web-auth/requests/' + rejected.id + '/reject', {}, a.bearer(token));
  assert.equal((await a.claim(rejected)).status, 409);
  assert.equal((await a.req('/api/web-auth/requests/' + rejected.id + '/confirm', {}, a.bearer(token))).status, 410);
  const cancelled = await a.qr(); await a.confirm(cancelled, token);
  await a.req('/api/web-auth/requests/' + cancelled.id + '/cancel', {}, { Cookie: cancelled.binding });
  assert.equal((await a.claim(cancelled)).status, 409);
  const replaced = await a.qr();
  assert.equal((await a.req('/api/web-auth/requests', {}, { Cookie: replaced.binding })).status, 200);
  assert.equal((await a.req('/api/web-auth/requests/' + replaced.id + '/inspect', {}, a.bearer(token))).status, 410);
  const expired = await a.qr(); await a.confirm(expired, token); a.advance(120001);
  assert.equal((await a.claim(expired)).status, 410);
  assert.equal((await a.req('/api/web-auth/requests/' + expired.id + '/confirm', {}, a.bearer(token))).status, 410);
});

test('游客入座、担任房主或在扫码期间开始对局时，服务端阻止切换', async t => {
  const a = await setup(t), guest = await a.guest(), token = await a.wx();
  const uid = a.app.store.session(digest(guest)).uid;
  const room = newRoom('123456', uid, '游客'); a.app.store.save(room);
  assert.equal((await a.req('/api/web-auth/requests', {}, a.bearer(guest))).status, 409);
  room.phase = 'terminated'; a.app.store.save(room);
  const q = await a.qr(guest); await a.confirm(q, token);
  room.phase = 'quest'; a.app.store.save(room);
  assert.equal((await a.claim(q)).status, 409);
  room.phase = 'ended'; a.app.store.save(room);
  assert.equal((await a.claim(q)).status, 200);
  const during = await a.qr(guest);
  room.phase = 'identity'; a.app.store.save(room);
  await a.req('/api/web-auth/requests/' + during.id + '/inspect', {}, a.bearer(token));
  assert.equal((await a.req('/api/web-auth/requests/' + during.id + '/confirm', {}, a.bearer(token))).status, 409);
  // Non-host spectator does not own a seat; its existing guest history is untouched.
  const viewer = await a.guest(), viewerUid = a.app.store.session(digest(viewer)).uid;
  room.spectators = [{ uid: viewerUid, seat: null, name: '围观' }]; a.app.store.save(room);
  assert.equal((await a.req('/api/web-auth/requests', {}, a.bearer(viewer))).status, 200);
});

test('功能开关和微信故障不影响现有小程序、游客登录；生成请求限流', async t => {
  const disabled = await setup(t, { webWechatLogin: false });
  assert.equal((await disabled.req('/api/web-auth/session')).data.enabled, false);
  assert.equal((await disabled.req('/api/web-auth/requests', {})).status, 503);
  assert.ok(await disabled.wx()); assert.ok(await disabled.guest());
  const unavailable = await setup(t, { wechatCode: async () => { throw new (require('../server/engine').RuleError)('小程序码暂时无法生成', 503); } });
  assert.equal((await unavailable.req('/api/web-auth/requests', {})).status, 503);
  assert.equal(unavailable.app.store.db.prepare('SELECT status FROM web_login_requests').get().status, 'cancelled');
  assert.ok(await unavailable.wx());
  const a = await setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await a.req('/api/web-auth/requests', {})).status, 200);
  assert.equal((await a.req('/api/web-auth/requests', {})).status, 429);
});

test('服务重启保留已确认请求和 Cookie 会话，原小程序会话仍可使用', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'shadowtable-web-auth-')), database = join(dir, 'test.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = await setup(t, { database }), token = await a.wx(), q = await a.qr();
  await a.confirm(q, token); await a.close();
  const b = await setup(t, { database }), claimed = await b.claim(q), auth = b.cookieAuth(claimed);
  assert.equal(claimed.status, 200); await b.close();
  const c = await setup(t, { database });
  assert.equal((await c.req('/api/web-auth/session', undefined, auth)).data.authenticated, true);
  assert.equal((await c.req('/api/me/profile', undefined, auth)).data.identityType, 'wx');
  assert.equal((await c.req('/api/me/profile', undefined, c.bearer(token))).status, 200);
});
test('维护清理过期授权请求与网页会话，不清理有效会话或账号资料', async t => {
  const a = await setup(t), token = await a.wx(), q = await a.qr();
  await a.confirm(q, token); await a.claim(q);
  await a.req('/api/me/profile', { nickname: '保留资料', version: 0 }, a.bearer(token));
  a.advance(121000); require('../server/retention').cleanup(a.app.store);
  assert.equal(a.app.store.db.prepare('SELECT count(*) AS n FROM web_login_requests').get().n, 0);
  assert.equal(a.app.store.db.prepare('SELECT count(*) AS n FROM web_sessions').get().n, 1);
  a.advance(31 * 86400000); require('../server/retention').cleanup(a.app.store);
  assert.equal(a.app.store.db.prepare('SELECT count(*) AS n FROM web_sessions').get().n, 0);
  assert.equal(a.app.store.db.prepare('SELECT nickname FROM profiles').get().nickname, '保留资料');
});
