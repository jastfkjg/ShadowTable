const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash, createCipheriv, randomBytes, randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const sharp = require("sharp");
const { createApp } = require("../server/app");
const { normalize, cleanup } = require("../server/avatar-uploads");
const { createWechatAvatarReview } = require("../server/wechat-avatar-review");
const settings = { appId: "wx-avatar-tests", appSecret: "server-only-secret", avatarPublicOrigin: "https://table.example.test",
  wechatMessageToken: "AvatarTestToken", wechatMessageAESKey: randomBytes(32).toString("base64").slice(0, -1) };
const uid = code => "wx:" + createHash("sha256").update(code).digest("hex");
const image = () => sharp({ create: { width: 500, height: 300, channels: 4, background: "#804e2d80" } }).png().toBuffer();
function signedEvent(event, appId = settings.appId) {
  const key = Buffer.from(settings.wechatMessageAESKey + "=", "base64"), message = Buffer.from(JSON.stringify(event));
  const length = Buffer.alloc(4); length.writeUInt32BE(message.length);
  const raw = Buffer.concat([randomBytes(16), length, message, Buffer.from(appId)]), padding = 32 - raw.length % 32;
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16)); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
  const params = new URLSearchParams({ timestamp: "1780000000", nonce: "test-nonce", msg_signature:
    createHash("sha1").update([settings.wechatMessageToken, "1780000000", "test-nonce", encrypted].sort().join("")).digest("hex") });
  return { params, envelope: { Encrypt: encrypted } };
}
async function launch(options = {}) {
  let now = Date.now(), submissions = 0;
  const app = createApp({ database: ":memory:", ...settings, avatarUploads: true, exchangeCode: async code => code,
    clock: () => now, avatarReview: async () => ({ traceId: "trace-" + (++submissions) }), ...options });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + app.server.address().port;
  async function req(path, token, body, id = randomUUID(), method = body ? "POST" : "GET") {
    const response = await fetch(origin + path, { method, headers: { Authorization: "Bearer " + (token || ""),
      "Idempotency-Key": id, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
    const type = response.headers.get("content-type");
    return { status: response.status, headers: response.headers, data: type?.startsWith("image/") ? Buffer.from(await response.arrayBuffer())
      : type?.startsWith("application/json") ? await response.json() : await response.text() };
  }
  return { ...app, req, submissions: () => submissions, advance(ms) { now += ms; },
    login: async (code = "owner") => (await req("/api/login", null, { code })).data.token,
    async upload(token, bytes, id = randomUUID(), code = "owner", extra) {
      const form = new FormData(); form.append("file", new Blob([bytes]), "avatar.png"); form.append("code", code); extra?.(form);
      return req("/api/me/avatar-uploads", token, form, id);
    },
    async complete(id, suggest = "pass", errcode = 0) {
      const row = app.store.db.prepare("SELECT trace_id FROM avatar_uploads WHERE id=?").get(id);
      const signed = signedEvent({ appid: settings.appId, Event: "wxa_media_check", version: 2, trace_id: row.trace_id, errcode, result: { suggest } });
      return req("/api/wechat/avatar-review?" + signed.params, null, signed.envelope);
    },
    async close() { await new Promise(resolve => app.server.close(resolve)); app.store.close(); },
  };
}

test("用户图片真实解码、旋转与重编码成256方形JPG，去除元数据，拒绝伪图片与过大像素", async () => {
  const source = await sharp(await image()).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const output = await normalize(source), metadata = await sharp(output.data).metadata();
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 256); assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined); assert.ok(output.data.length < 256 * 1024);
  await assert.rejects(normalize(Buffer.from("<svg><script>alert(1)</script></svg>")), /图片无法读取|仅支持/);
  const oversized = await sharp({ create: { width: 4097, height: 4097, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalize(oversized), /尺寸过大/);
});

test("上传及审核不修改资料；通过后保存保持幂等、版本、牌桌及排行榜头像兼容", async () => {
  const app = await launch();
  try {
    const token = await app.login(), other = await app.login("other"), bytes = await image();
    const before = (await app.req("/api/me/profile", token, { nickname: "林间", version: 0, avatar: "builtin:avatar-01" })).data;
    const room = (await app.req("/api/rooms", token, { name: "本桌昵称", capacity: 6 })).data;
    const uploadKey = randomUUID(), uploaded = await app.upload(token, bytes, uploadKey);
    assert.equal(uploaded.status, 202); assert.equal(uploaded.data.status, "pending");
    assert.deepEqual(Object.keys(uploaded.data).sort(), ["expiresAt", "id", "status"]);
    assert.deepEqual((await app.req("/api/me/profile", token)).data, before);
    const row = app.store.db.prepare("SELECT * FROM avatar_uploads WHERE id=?").get(uploaded.data.id);
    assert.equal((await app.req("/api/avatars/" + row.hash)).status, 404);
    const media = await app.req("/api/avatar-review-media/" + row.fetch_token);
    assert.equal(media.status, 200); assert.equal(media.headers.get("cache-control"), "no-store");
    assert.equal((await sharp(media.data).metadata()).width, 256);
    assert.equal((await app.req("/api/me/avatar-uploads/" + row.id, other)).status, 404);
    assert.equal((await app.req("/api/me/profile", other, { nickname: "其他人", version: 0, avatar: "upload:" + row.id })).status, 404);
    assert.equal((await app.req("/api/me/profile", token, { nickname: "待审", version: 1, avatar: "upload:" + row.id })).status, 409);
    assert.deepEqual((await app.upload(token, bytes, uploadKey, "already-used-code")).data, uploaded.data);
    assert.equal(app.submissions(), 1);
    assert.equal((await app.complete(row.id)).status, 200);
    assert.equal((await app.complete(row.id)).status, 200);
    assert.equal((await app.req("/api/avatars/" + row.hash)).status, 404, "审核通过仍需要主动保存");
    assert.equal((await app.req("/api/me/profile", token, { nickname: "旧版本", version: 0, avatar: "upload:" + row.id })).status, 409);
    const saveKey = randomUUID(), payload = { nickname: "林间", version: 1, avatar: "upload:" + row.id };
    const saved = await app.req("/api/me/profile", token, payload, saveKey);
    assert.equal(saved.status, 200); assert.equal(saved.data.avatarUrl, "/api/avatars/" + row.hash);
    assert.deepEqual(await app.req("/api/me/profile", token, payload, saveKey), saved);
    assert.deepEqual((await app.req(saved.data.avatarUrl)).data, media.data);
    assert.match((await app.req(saved.data.avatarUrl)).headers.get("cache-control"), /immutable/);
    const shown = (await app.req("/api/rooms/" + room.code, token)).data;
    assert.equal(shown.players[0].avatarUrl, saved.data.avatarUrl); assert.equal(shown.players[0].name, "本桌昵称");
    app.store.archiveMatch({ id: randomUUID(), board: "classic", endedAt: Date.now(), players: [{ uid: uid("owner"), faction: "good", outcome: "win" }] });
    assert.equal((await app.req("/api/leaderboard?metric=games", token)).data.rows[0].avatarUrl, saved.data.avatarUrl);
    assert.equal(app.store.db.prepare("SELECT data FROM avatar_uploads WHERE id=?").get(row.id).data, null);
    assert.equal((await app.req("/api/me/profile", token, { nickname: "只改名字", version: 2 })).data.avatarUrl, saved.data.avatarUrl);
    assert.equal((await app.req("/api/me/profile", token, { nickname: "只改名字", version: 3, avatar: "builtin:pixel-01" })).status, 200);
    assert.equal((await app.req("/api/me/profile", token, { nickname: "只改名字", version: 4, avatar: null })).data.avatarUrl, null);
  } finally { await app.close(); }
});

test("审核拒绝、故障与到期保留旧资料，无法公开或绑定，回调不能覆盖已确定结果", async () => {
  const app = await launch();
  try {
    const token = await app.login(), before = (await app.req("/api/me/profile", token, { nickname: "旧资料", version: 0 })).data;
    for (const [suggest, errcode, expected] of [["risky", 0, "rejected"], ["review", 0, "rejected"], ["pass", -1008, "failed"]]) {
      const uploaded = await app.upload(token, await image());
      assert.equal((await app.complete(uploaded.data.id, suggest, errcode)).status, 200);
      await app.complete(uploaded.data.id, "pass");
      assert.equal((await app.req("/api/me/avatar-uploads/" + uploaded.data.id, token)).data.status, expected);
      assert.equal(app.store.db.prepare("SELECT data FROM avatar_uploads WHERE id=?").get(uploaded.data.id).data, null);
      assert.equal((await app.req("/api/me/profile", token, { nickname: "不会保存", version: 1, avatar: "upload:" + uploaded.data.id })).status, 409);
    }
    const expired = await app.upload(token, await image()); await app.complete(expired.data.id);
    app.advance(86400001);
    assert.equal((await app.req("/api/me/avatar-uploads/" + expired.data.id, token)).status, 410);
    assert.equal((await app.req("/api/me/profile", token, { nickname: "不会保存", version: 1, avatar: "upload:" + expired.data.id })).status, 410);
    assert.deepEqual((await app.req("/api/me/profile", token)).data, before);
    app.store.transaction(() => cleanup(app.store));
    assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM avatar_uploads").get().n, 0);
  } finally { await app.close(); }
});

test("关闭及未配置审核时上传入口禁用，游客无法上传，开发模拟审核不会在生产开启", async () => {
  for (const options of [{ avatarUploads: false }, { avatarReview: undefined, wechatMessageAESKey: "" }]) {
    const app = await launch(options);
    try {
      const token = await app.login();
      assert.equal((await app.req("/api/me/avatar-uploads", token)).data.enabled, false);
      assert.equal((await app.upload(token, await image())).status, 503);
      assert.equal((await app.req("/api/me/profile", token, { nickname: "内置仍可用", version: 0, avatar: "builtin:avatar-01" })).status, 200);
    } finally { await app.close(); }
  }
  const app = await launch();
  try {
    const token = randomBytes(32).toString("hex"); app.store.addSession(createHash("sha256").update(token).digest("hex"), "guest:avatar-test");
    assert.equal((await app.req("/api/me/avatar-uploads", token)).data.enabled, false);
    assert.equal((await app.upload(token, await image())).status, 403);
    assert.equal((await app.upload(null, await image())).status, 401);
  } finally { await app.close(); }
  const oldEnvironment = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  let production;
  try {
    production = await launch({ devAuth: true, appSecret: "", avatarReview: undefined, wechatMessageAESKey: "" });
    const token = await production.login();
    assert.equal((await production.req("/api/me/avatar-uploads", token)).data.enabled, false);
  } finally {
    if (production) await production.close();
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
  }
});

test("并发重试只提交一次审核，上游故障可查询并安全重传，伪回调无法通过审核", async () => {
  let finishReview;
  const app = await launch({ avatarReview: () => new Promise(resolve => { finishReview = resolve; }) });
  try {
    const token = await app.login(), bytes = await image(), key = randomUUID();
    const first = app.upload(token, bytes, key);
    while (!finishReview) await new Promise(resolve => setImmediate(resolve));
    const second = app.upload(token, bytes, key, "used-code");
    finishReview({ traceId: "concurrent-trace" });
    const [one, two] = await Promise.all([first, second]);
    assert.equal(one.status, 202); assert.deepEqual(one.data, two.data);
    const forged = signedEvent({ appid: settings.appId, Event: "wxa_media_check", version: 2, trace_id: "concurrent-trace", errcode: 0, result: { suggest: "pass" } });
    forged.params.set("msg_signature", "0".repeat(40));
    assert.equal((await app.req("/api/wechat/avatar-review?" + forged.params, null, forged.envelope)).status, 403);
    assert.equal((await app.req("/api/me/avatar-uploads/" + one.data.id, token)).data.status, "pending");
  } finally { await app.close(); }
  const failed = await launch({ avatarReview: async () => { throw Error("upstream private response"); } });
  try {
    const token = await failed.login(), result = await failed.upload(token, await image());
    assert.equal(result.data.status, "failed");
    assert.equal((await failed.req("/api/me/avatar-uploads/" + result.data.id, token)).data.status, "failed");
    assert.equal(failed.store.db.prepare("SELECT data FROM avatar_uploads WHERE id=?").get(result.data.id).data, null);
    assert.equal((await failed.req("/api/me/profile", token)).data.version, 0);
  } finally { await failed.close(); }
});

test("图片大小、伪造内容、账号切换、请求复用与频率限制均不修改资料，普通接口仍限8KB", async () => {
  const app = await launch();
  try {
    const token = await app.login(), bytes = await image();
    assert.equal((await app.upload(token, Buffer.alloc(2 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await app.upload(token, Buffer.from("fake PNG"))).status, 400);
    assert.equal((await app.upload(token, bytes, randomUUID(), "someone-else")).status, 401);
    assert.equal((await app.upload(token, bytes, randomUUID(), "owner", form => form.append("file", new Blob([bytes]), "second.png"))).status, 400);
    const key = randomUUID(); assert.equal((await app.upload(token, bytes, key)).status, 202);
    assert.equal((await app.upload(token, bytes)).status, 429);
    app.advance(60001);
    assert.equal((await app.upload(token, Buffer.from("different"), key)).status, 409);
    assert.equal((await app.req("/api/me/profile", token, { nickname: "原请求上限", version: 0, avatar: "x".repeat(8192) })).status, 413);
    assert.equal((await app.req("/api/me/profile", token)).data.version, 0);
  } finally { await app.close(); }
});

test("上传审核和已保存头像跨重启保留，清理保护当前头像、内置头像及幂等回执", async () => {
  const directory = mkdtempSync(join(tmpdir(), "avatar-restart-")), database = join(directory, "app.sqlite");
  let app = await launch({ database });
  try {
    let token = await app.login();
    const uploaded = await app.upload(token, await image());
    await app.close(); app = await launch({ database }); token = await app.login();
    assert.equal((await app.req("/api/me/avatar-uploads/" + uploaded.data.id, token)).data.status, "pending");
    await app.complete(uploaded.data.id);
    const saved = (await app.req("/api/me/profile", token, { nickname: "持久化", version: 0, avatar: "upload:" + uploaded.data.id })).data;
    await app.close(); app = await launch({ database }); token = await app.login();
    assert.equal((await app.req("/api/me/profile", token)).data.avatarUrl, saved.avatarUrl);
    app.advance(91 * 86400000); cleanup(app.store);
    assert.equal((await app.req(saved.avatarUrl)).status, 200);
    // Refresh the expired session, then switch back to a built-in avatar.
    token = await app.login();
    const builtin = (await app.req("/api/me/profile", token, { nickname: "持久化", version: 1, avatar: "builtin:avatar-01" })).data;
    app.advance(91 * 86400000); cleanup(app.store);
    assert.equal((await app.req(saved.avatarUrl)).status, 200, "保存回执仍可返回旧地址");
    app.store.db.prepare("DELETE FROM receipts").run(); cleanup(app.store);
    assert.equal((await app.req(saved.avatarUrl)).status, 404);
    assert.equal((await app.req(builtin.avatarUrl)).status, 200);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("微信审核使用v2资料场景，缓存令牌；安全模式验证签名、解密和appid，拒绝伪回调", async () => {
  const calls = [], reviewer = createWechatAvatarReview({ appId: settings.appId, appSecret: settings.appSecret,
    token: settings.wechatMessageToken, aesKey: settings.wechatMessageAESKey,
    fetcher: async (url, options) => { calls.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, json: async () => url.includes("stable_token") ? { access_token: "secret-token", expires_in: 7200 } : { errcode: 0, trace_id: "review-trace" } }; } });
  await reviewer.submit({ openid: "fresh-openid", mediaUrl: "https://example.test/private-media" });
  await reviewer.submit({ openid: "fresh-openid", mediaUrl: "https://example.test/private-media" });
  assert.equal(calls.filter(call => call.url.includes("stable_token")).length, 1);
  assert.deepEqual(calls[1].payload, { openid: "fresh-openid", media_url: "https://example.test/private-media", media_type: 2, version: 2, scene: 1 });
  const event = { appid: settings.appId, Event: "wxa_media_check", version: 2, trace_id: "review-trace", errcode: 0, result: { suggest: "pass" } };
  const signed = signedEvent(event); assert.deepEqual(reviewer.event(signed.params, signed.envelope), event);
  const verify = new URLSearchParams({ timestamp: "1780000000", nonce: "verify", echostr: "echo", signature:
    createHash("sha1").update([settings.wechatMessageToken, "1780000000", "verify"].sort().join("")).digest("hex") });
  assert.equal(reviewer.verify(verify), "echo");
  const bad = new URLSearchParams(signed.params); bad.set("msg_signature", "0".repeat(40));
  assert.throws(() => reviewer.event(bad, signed.envelope), /签名无效/);
  assert.throws(() => reviewer.event(signed.params, event), /安全模式/);
  const otherApp = signedEvent(event, "another-app"); assert.throws(() => reviewer.event(otherApp.params, otherApp.envelope), /消息无效/);
  const failure = createWechatAvatarReview({ appId: settings.appId, appSecret: settings.appSecret,
    token: settings.wechatMessageToken, aesKey: settings.wechatMessageAESKey, fetcher: async () => { throw Error("secret URL"); } });
  await assert.rejects(failure.submit({ openid: "fresh", mediaUrl: "https://example.test/image" }), error => error.status === 503 && !error.message.includes("secret"));
});
