const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { clientAddressResolver, createMetrics } = require("../server/network");
const { createApp } = require("../server/app");
const req = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: { "x-forwarded-for": forwarded } });
test("只信任配置的代理，按从右到左的可信链识别地址并防伪造", () => {
  const resolve = clientAddressResolver("127.0.0.1/32,10.8.0.0/24,2001:db8::/32");
  assert.equal(clientAddressResolver()(req("127.0.0.1", "1.2.3.4")), "127.0.0.1");
  assert.equal(resolve(req("192.0.2.1", "1.2.3.4")), "192.0.2.1");
  assert.equal(resolve(req("::ffff:127.0.0.1", "1.2.3.4")), "1.2.3.4");
  assert.equal(resolve(req("127.0.0.1", "forged, 1.2.3.4")), "127.0.0.1");
  assert.equal(resolve(req("127.0.0.1", "8.8.8.8, 192.0.2.2, 10.8.0.2")), "192.0.2.2");
  assert.equal(resolve(req("2001:db8::2", "2001:db9::2")), "2001:db9::2");
  assert.throws(() => clientAddressResolver("0.0.0.0/33"), /无效/);
});
test("请求统计固定容量，报告429/5xx/304和延迟分位区间", () => {
  const logs = [], metrics = createMetrics({ logger: { log: line => logs.push(JSON.parse(line)) }, clock: () => 1 });
  for (let n = 0; n < 100; n++) metrics.observe(n < 97 ? 304 : n < 99 ? 429 : 503, n < 95 ? 40 : 700);
  metrics.flush(); metrics.flush();
  assert.equal(logs.length, 1); assert.equal(logs[0].requests, 100); assert.equal(logs[0].p95MsUpperBound, 50);
  assert.equal(logs[0].statuses[503], 1); assert.equal(logs[0].statuses[429], 2);
});
async function launch(options = {}) {
  const app = createApp({ database: ":memory:", devAuth: true, ...options });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  return { ...app, async close() { await new Promise(resolve => app.server.close(resolve)); app.store.close(); },
    async request(path, token, body, headers = {}) {
      return fetch(base + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + (token || ""), "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...headers }, body: body ? JSON.stringify(body) : undefined });
    }
  };
}
test("可信代理后的登录额度按客户端隔离，不可信转发头无法绕过额度", async () => {
  for (const trusted of ["127.0.0.1/32", ""]) {
    const app = await launch({ trustedProxies: trusted });
    try {
      for (let i = 0; i < 60; i++) { const r = await app.request("/api/dev-login", null, {}, { "X-Forwarded-For": "192.0.2.1" }); assert.equal(r.status, 200); await r.json(); }
      let r = await app.request("/api/dev-login", null, {}, { "X-Forwarded-For": "192.0.2.1" }); assert.equal(r.status, 429); await r.json();
      r = await app.request("/api/dev-login", null, {}, { "X-Forwarded-For": "192.0.2.2" }); assert.equal(r.status, trusted ? 200 : 429); await r.json();
    } finally { await app.close(); }
  }
});
test("房间ETag先鉴权，用户/头像/成员变化会失效，304不含数据且不缓存私密接口", async () => {
  const app = await launch();
  try {
    const tokens = [];
    for (let n = 0; n < 3; n++) tokens.push((await (await app.request("/api/dev-login", null, {})).json()).token);
    const code = (await (await app.request("/api/rooms", tokens[0], { name: "房主" })).json()).code, path = "/api/rooms/" + code;
    await (await app.request(path + "/join", tokens[1], { name: "玩家" })).json();
    let r = await app.request(path, tokens[0]); const etag = r.headers.get("ETag"), view = await r.json(); assert.ok(etag);
    r = await app.request(path, tokens[0], null, { "If-None-Match": etag }); assert.equal(r.status, 304); assert.equal(await r.text(), "");
    r = await app.request(path, tokens[1], null, { "If-None-Match": etag }); assert.equal(r.status, 200); assert.notEqual(r.headers.get("ETag"), etag); await r.json();
    r = await app.request(path, tokens[2], null, { "If-None-Match": etag }); assert.equal(r.status, 403); await r.json();
    await (await app.request("/api/me/profile", tokens[0], { nickname: "房主", version: 0, avatar: "builtin:avatar-01" })).json();
    r = await app.request(path, tokens[0], null, { "If-None-Match": etag }); assert.equal(r.status, 200); assert.notEqual(r.headers.get("ETag"), etag); await r.json();
    await (await app.request(path + "/commands", tokens[0], { type: "kick", stage: view.stage, seat: 2, targetId: view.players[1].managementId, confirm: true })).json();
    r = await app.request(path, tokens[1], null, { "If-None-Match": etag }); assert.equal(r.status, 403); await r.json();
    r = await app.request(path + "/private", tokens[0]); assert.equal(r.headers.get("ETag"), null); await r.json();
  } finally { await app.close(); }
});
test("读请求额度耗尽仍可提交操作；新过期编号不会首次执行", async () => {
  const now = Date.now(), app = await launch({ clock: () => now });
  try {
    const token = (await (await app.request("/api/dev-login", null, {})).json()).token;
    const old = "v1_" + (now - 31 * 86400000).toString(36) + "_old_request";
    let r = await app.request("/api/rooms", token, { name: "旧请求" }, { "Idempotency-Key": old }); assert.equal(r.status, 410); await r.json();
    assert.equal(app.store.personalRooms(app.store.db.prepare("SELECT uid FROM sessions").get().uid).length, 0);
    for (let n = 0; n < 181; n++) { r = await app.request("/api/me/rooms", token); await r.json(); }
    assert.equal(r.status, 429);
    r = await app.request("/api/rooms", token, { name: "正常操作" }); assert.equal(r.status, 200); await r.json();
  } finally { await app.close(); }
});
