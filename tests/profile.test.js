const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createApp } = require('../server/app');
const { decodeAvatar } = require('../server/profile');
const builtinAvatars = require('../miniprogram/builtin-avatars');
const avatarBytes = readFileSync(join(__dirname,'../miniprogram/assets/tab-me.png'));
const avatar = 'data:image/png;base64,' + avatarBytes.toString('base64');
test('内置头像选择跨重启保留，与上传头像互换、去重、重试及清除兼容', async () => {
  const directory = mkdtempSync(join(tmpdir(),'shadow-builtin-')), db = join(directory,'db.sqlite');
  let app = await launch(db);
  try {
    const preset = builtinAvatars[0], last = builtinAvatars.at(-1);
    const token = (await app.req('/api/login',null,{code:'builtin-account'})).data.token;
    const body = { nickname:'林间',version:0,avatar:'builtin:'+preset.id }, id = randomUUID();
    const saved = await app.req('/api/me/profile',token,body,id);
    assert.equal(saved.status,200);
    assert.equal(saved.data.avatarUrl,'/api/avatars/'+preset.hash);
    assert.deepEqual((await app.req('/api/me/profile',token,body,id)).data,saved.data);
    const bytes = readFileSync(join(__dirname,'../miniprogram',preset.path));
    assert.deepEqual((await app.req(saved.data.avatarUrl)).data,bytes);
    await app.close(); app = await launch(db);
    const again = (await app.req('/api/login',null,{code:'builtin-account'})).data.token;
    assert.deepEqual((await app.req('/api/me/profile',again)).data,saved.data);
    assert.deepEqual((await app.req(saved.data.avatarUrl)).data,bytes);
    assert.equal((await app.req('/api/me/profile',again,{nickname:'改名',version:1})).data.avatarUrl,saved.data.avatarUrl);
    const uploaded = await app.req('/api/me/profile',again,{nickname:'改名',version:2,avatar});
    assert.notEqual(uploaded.data.avatarUrl,saved.data.avatarUrl);
    const picked = await app.req('/api/me/profile',again,{nickname:'改名',version:3,avatar:'builtin:'+last.id});
    assert.equal(picked.data.avatarUrl,'/api/avatars/'+last.hash);
    const other = (await app.req('/api/login',null,{code:'other-builtin-account'})).data.token;
    await app.req('/api/me/profile',other,{nickname:'朋友',version:0,avatar:'builtin:'+last.id});
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM avatars').get().n,3);
    assert.equal((await app.req('/api/me/profile',again,{nickname:'改名',version:4,avatar:null})).data.avatarUrl,null);
  } finally { await app.close(); rmSync(directory,{recursive:true,force:true}); }
});
test('内置头像拒绝未列出的编号及路径，资源均能通过头像校验', async () => {
  for (const preset of builtinAvatars) {
    const bytes = readFileSync(join(__dirname,'../miniprogram',preset.path));
    assert.equal(decodeAvatar('data:image/jpeg;base64,'+bytes.toString('base64')).hash,preset.hash);
  }
  const app = await launch();
  try {
    const token = (await app.req('/api/login',null,{code:'invalid-builtin'})).data.token;
    for (const value of ['builtin:','builtin:avatar-99','builtin:../../package.json','builtin:/etc/passwd']) {
      const result = await app.req('/api/me/profile',token,{nickname:'甲',version:0,avatar:value});
      assert.equal(result.status,400); assert.match(result.data.error,/内置头像/);
    }
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM avatars').get().n,0);
    assert.equal((await app.req('/api/me/profile',token)).data.version,0);
  } finally { await app.close(); }
});
async function launch(database = ':memory:') {
  const app = createApp({ database, exchangeCode: async code => code });
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  return { ...app, async close() { await new Promise(resolve => app.server.close(resolve)); app.store.close(); },
    async req(path, token, body, id = randomUUID()) {
      const res = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + (token || ''), 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, headers: res.headers, data: res.headers.get('content-type').startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.json() };
    } };
}
test('牌桌展示当前头像且不泄露资料字段；改头像不改游戏状态，换座后头像跟随玩家', async () => {
  const app = await launch();
  try {
    const login = async code => (await app.req('/api/login', null, { code })).data.token;
    const host = await login('avatar-host'), player = await login('avatar-player'), outsider = await login('avatar-outsider');
    const first = builtinAvatars[0], next = builtinAvatars[1];
    await app.req('/api/me/profile', host, { nickname: '个人昵称', avatar: 'builtin:' + first.id, version: 0 });
    const created = await app.req('/api/rooms', host, { name: '桌上房主', board: 'classic', capacity: 6 });
    const path = '/api/rooms/' + created.data.code;
    assert.equal((await app.req(path + '/join', player, { name: '桌上玩家' })).status, 200);
    const before = (await app.req(path, host)).data;
    assert.equal(before.players[0].avatarUrl, '/api/avatars/' + first.hash);
    assert.equal(before.players[0].name, '桌上房主');
    assert.equal(before.players[1].avatarUrl, null);
    assert.equal((await app.req(path, outsider)).status, 403);
    const peer = (await app.req(path, player)).data;
    assert.equal(peer.players[0].avatarUrl, before.players[0].avatarUrl);
    for (const p of peer.players) {
      assert.deepEqual(Object.keys(p).sort(), ['alive', 'avatarUrl', 'isHost', 'name', 'ready', 'seat'].sort());
    }
    await app.req('/api/me/profile', host, { nickname: '改后个人昵称', avatar: 'builtin:' + next.id, version: 1 });
    const updated = (await app.req(path, host)).data;
    assert.equal(updated.players[0].avatarUrl, '/api/avatars/' + next.hash);
    assert.equal(updated.stage, before.stage);
    assert.deepEqual({ ...updated, players: updated.players.map(({ avatarUrl, ...p }) => p) },
      { ...before, players: before.players.map(({ avatarUrl, ...p }) => p) });
    assert.equal((await app.req(path + '/commands', host, { type: 'seat', stage: updated.stage, seat: 4 })).status, 200);
    const moved = (await app.req(path, player)).data;
    assert.equal(moved.players.find(p => p.seat === 4).avatarUrl, '/api/avatars/' + next.hash);
    assert.ok(!moved.players.some(p => p.seat === 1));
    await app.req('/api/me/profile', host, { nickname: '改后个人昵称', avatar: null, version: 2 });
    assert.equal((await app.req(path, player)).data.players.find(p => p.seat === 4).avatarUrl, null);
    assert.equal((await app.req(path + '/commands', host, { type: 'stand', stage: moved.stage })).status, 200);
    assert.ok(!(await app.req(path, player)).data.players.some(p => p.seat === 4));
  } finally { await app.close(); }
});
test('微信资料跨登录与重启保留，头像持久化；昵称修改不追改房间和战绩身份', async () => {
  const directory = mkdtempSync(join(tmpdir(),'shadow-profile-')), db = join(directory,'db.sqlite');
  let app = await launch(db);
  try {
    const token = (await app.req('/api/login',null,{code:'same-account'})).data.token;
    const other = (await app.req('/api/login',null,{code:'other-account'})).data.token;
    assert.equal((await app.req('/api/me/profile',token)).data.version,0);
    const room = (await app.req('/api/rooms',token,{name:'桌上昵称',capacity:6})).data;
    const first = await app.req('/api/me/profile',token,{nickname:' 林间 ',avatar,version:0});
    assert.equal(first.status,200); assert.equal(first.data.nickname,'林间');
    assert.equal(first.data.identityType,'wx'); assert.equal(first.data.version,1);
    assert.match(first.data.avatarUrl,/^\/api\/avatars\/[a-f0-9]{64}$/);
    assert.equal((await app.req('/api/rooms/'+room.code,token)).data.me.name,'桌上昵称');
    assert.equal((await app.req('/api/me/profile',other)).data.nickname,'');
    const image = await app.req(first.data.avatarUrl);
    assert.equal(image.status,200); assert.deepEqual(image.data,avatarBytes);
    assert.equal(image.headers.get('content-type'),'image/png');
    assert.equal(image.headers.get('x-content-type-options'),'nosniff');
    await app.close(); app = await launch(db);
    const again = (await app.req('/api/login',null,{code:'same-account'})).data.token;
    assert.deepEqual((await app.req('/api/me/profile',again)).data,first.data);
    assert.deepEqual((await app.req(first.data.avatarUrl)).data,avatarBytes);
    const removed = await app.req('/api/me/profile',again,{nickname:'晚风',version:1,avatar:null});
    assert.equal(removed.data.avatarUrl,null);
    assert.equal((await app.req('/api/rooms/'+room.code,again)).data.me.name,'桌上昵称');
  } finally { await app.close(); rmSync(directory,{recursive:true,force:true}); }
});
test('资料写入鉴权、版本冲突与幂等重试；事务失败不遗留头像或部分资料', async () => {
  const app = await launch();
  try {
    const token = (await app.req('/api/login',null,{code:'account'})).data.token;
    assert.equal((await app.req('/api/me/profile')).status,401);
    const body = { nickname:'甲',version:0,avatar }, id = randomUUID();
    const addReceipt = app.store.addReceipt;
    app.store.addReceipt = () => { throw new Error('write failed'); };
    assert.equal((await app.req('/api/me/profile',token,body,id)).status,500);
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM profiles').get().n,0);
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM avatars').get().n,0);
    app.store.addReceipt = addReceipt;
    const saved = await app.req('/api/me/profile',token,body,id);
    assert.equal(saved.status,200);
    assert.deepEqual((await app.req('/api/me/profile',token,body,id)).data,saved.data);
    assert.equal((await app.req('/api/me/profile',token,{...body,nickname:'乙'},id)).status,409);
    assert.equal((await app.req('/api/me/profile',token,{...body,nickname:'乙'})).status,409);
    assert.equal((await app.req('/api/me/profile',token)).data.nickname,'甲');
    assert.equal((await app.req('/api/me/profile',token,{nickname:' ',version:1})).status,400);
    assert.equal((await app.req('/api/me/profile',token,{nickname:'甲\n乙',version:1})).status,400);
  } finally { await app.close(); }
});
test('头像只接受受限光栅图片，拒绝脚本、损坏文件与超大尺寸；普通接口仍限8KB', async () => {
  assert.equal(decodeAvatar(avatar).mime,'image/png');
  for (const value of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/avatar.png', 'data:image/png;base64,c2NyaXB0', 'data:image/jpeg;base64,/9j/2Q==']) assert.throws(() => decodeAvatar(value));
  const oversized = Buffer.from(avatarBytes); oversized.writeUInt32BE(4096,16);
  assert.throws(() => decodeAvatar('data:image/png;base64,'+oversized.toString('base64')),/1024/);
  const app = await launch();
  try {
    const token = (await app.req('/api/login',null,{code:'account'})).data.token;
    assert.equal((await app.req('/api/me/profile',token,{nickname:'甲',version:0,avatar:'a'.repeat(370*1024)})).status,413);
    assert.equal((await app.req('/api/rooms',token,{name:'甲',padding:'x'.repeat(9000)})).status,413);
    assert.equal((await app.req('/api/me/profile',token,{nickname:'甲',version:0,avatar:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);
    assert.equal((await app.req('/api/avatars/'+'a'.repeat(64))).status,404);
  } finally { await app.close(); }
});
