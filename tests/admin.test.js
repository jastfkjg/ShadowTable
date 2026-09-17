"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app");
const { Companion } = require("../server/dev-panel/panel");
const key = "test-admin-key-" + "a".repeat(40);
const origin = "https://admin.example.com";
async function setup(t, opts = {}) {
  const app = createApp({
    database: ":memory:",
    adminOrigin: origin,
    adminKey: key,
    exchangeCode: async (code) => code,
    ...opts,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
  });
  let cookie = "";
  async function raw(path, data, extra = {}) {
    const r = await new Promise((resolve, reject) => {
      const request = require("node:http").request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: "admin.example.com",
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            ...extra,
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              ok: response.statusCode < 400,
              headers: {
                get(name) {
                  const value = response.headers[name];
                  return Array.isArray(value) ? value[0] : value;
                },
              },
              json: async () => JSON.parse(text),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(data ? JSON.stringify(data) : undefined);
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  async function api(path, data, extra) {
    const r = await raw(path, data, extra);
    const b = await r.json();
    if (!r.ok) throw Object.assign(new Error(b.error), { status: r.status });
    return b;
  }
  const login = () => api("/api/admin/login", { key });
  const player = async (name) =>
    (await api("/api/login", { code: name })).token;
  const auth = (token) => ({ Authorization: "Bearer " + token });
  const room = async () => {
    const token = await player(randomUUID());
    const { code } = await api("/api/rooms", { name: "真人" }, auth(token));
    return { code, token };
  };
  const action = (code, type, extra = {}) =>
    api("/api/admin/rooms/" + code, {
      action: type,
      stage: app.store.get(code)?.stage,
      confirm: code,
      reason: "验证管理操作",
      ...extra,
    });
  return { app, raw, api, login, player, auth, room, action };
}
test("管理平台默认关闭，生产配置要求 HTTPS 和长密钥", async (t) => {
  const a = await setup(t, { adminKey: "" });
  assert.equal((await a.raw("/admin")).status, 404);
  assert.throws(
    () =>
      createApp({
        database: ":memory:",
        adminOrigin: origin,
        adminKey: "short",
      }),
    /至少32/,
  );
});
test("管理员认证、来源校验、安全 Cookie、退出失效；玩家令牌不能访问管理接口", async (t) => {
  const a = await setup(t);
  assert.equal((await a.raw("/admin")).status, 200);
  assert.equal((await a.raw("/api/admin/rooms")).status, 401);
  assert.equal(
    (
      await a.raw(
        "/api/admin/login",
        { key },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal((await a.raw("/api/admin/login", { key: "wrong" })).status, 401);
  const r = await a.raw("/api/admin/login", { key });
  assert.match(
    r.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict.*Secure/,
  );
  assert.equal((await a.raw("/api/admin/rooms")).status, 200);
  assert.equal(
    (await a.raw("/api/admin/rooms", undefined, { Host: "evil.example" }))
      .status,
    403,
  );
  assert.equal((await a.raw("/admin/companion")).status, 200);
  assert.equal(
    (await a.raw("/api/admin/logout", {}, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  await a.api("/api/admin/logout", {});
  assert.equal((await a.raw("/api/admin/rooms")).status, 401);
  const token = await a.player("human");
  assert.equal(
    (await a.raw("/api/admin/rooms", undefined, a.auth(token))).status,
    401,
  );
});
test("现有房间开启陪测，绑定房间与管理员，关闭/退出阻止继续使用", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code, token } = await a.room();
  const other = await a.room();
  await assert.rejects(
    a.api("/api/admin/actors", { code }),
    (e) => e.status === 403,
  );
  await a.action(code, "test-on");
  assert.equal(
    (await a.api("/api/rooms/" + code, undefined, a.auth(token))).testRoom,
    true,
  );
  const request = (path, actorToken, data, id) =>
    a.api(path === "/api/dev-login" ? "/api/admin/actors" : path, data, {
      ...a.auth(actorToken),
      ...(id ? { "Idempotency-Key": id } : {}),
    });
  const c = new Companion({ request });
  await c.add(code);
  await c.fill();
  assert.equal(c.actors.length, 5);
  await c.batch("ready");
  assert.equal(
    (await a.api("/api/rooms/" + code, undefined, a.auth(token))).me.ready,
    false,
  );
  const bot = c.actors[0].token;
  await assert.rejects(
    a.api(
      "/api/rooms/" + other.code + "/join",
      { name: "跨房间" },
      a.auth(bot),
    ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    a.api("/api/rooms", { name: "新房" }, a.auth(bot)),
    (e) => e.status === 403,
  );
  await assert.rejects(
    a.api("/api/rooms/" + code, undefined, { ...a.auth(bot), Cookie: "" }),
    (e) => e.status === 401,
  );
  await assert.rejects(a.action(code, "test-off"), (e) => e.status === 409);
  const hostCommand = (type, extra = {}) =>
    a.api(
      "/api/rooms/" + code + "/commands",
      { type, stage: a.app.store.get(code).stage, ...extra },
      a.auth(token),
    );
  await hostCommand("ready", { ready: true });
  await hostCommand("start");
  await c.refresh();
  assert.ok(c.actors.every((actor) => actor.secret));
  await c.batch("confirm");
  assert.equal(
    (await a.api("/api/rooms/" + code, undefined, a.auth(token))).me.submitted,
    false,
  );
  await assert.rejects(
    a.api("/api/admin/actors", { code }),
    (e) => e.status === 403,
  );
  await a.api("/api/admin/logout", {});
  await assert.rejects(
    a.api("/api/rooms/" + code, undefined, a.auth(bot)),
    (e) => e.status === 401,
  );
  await a.login();
  await assert.rejects(
    a.api("/api/rooms/" + code, undefined, a.auth(bot)),
    (e) => e.status === 403,
  );
  await assert.rejects(
    a.action(code, "clear-testers"),
    (e) => e.status === 409,
  );
  await a.action(code, "terminate");
  await a.action(code, "rematch");
  await a.action(code, "clear-testers");
  await a.action(code, "test-off");
  assert.equal(a.app.store.get(code).players.length, 1);
  assert.equal(a.app.store.get(code).players[0].uid.startsWith("wx:"), true);
});
test("管理写操作有原因与状态冲突检查，概览与审计不泄露身份", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code } = await a.room();
  await assert.rejects(
    a.action(code, "delete", { confirm: "wrong" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    a.action(code, "delete", { reason: "" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    a.action(code, "delete", { stage: "old" }),
    (e) => e.status === 409,
  );
  const room = a.app.store.get(code);
  room.phase = "identity";
  room.roles = { [room.host]: "SECRET_ROLE" };
  room.submissions = { [room.host]: "SECRET_VOTE" };
  a.app.store.save(room);
  await assert.rejects(a.action(code, "test-on"), (e) => e.status === 409);
  const list = await a.api("/api/admin/rooms");
  assert.doesNotMatch(JSON.stringify(list), /SECRET|wx:|token|openid/);
  await a.action(code, "terminate");
  assert.equal(a.app.store.get(code).phase, "terminated");
  await a.action(code, "rematch");
  assert.equal(a.app.store.get(code).phase, "lobby");
  await a.action(code, "delete");
  assert.equal(a.app.store.get(code), null);
  const audit = await a.api("/api/admin/audit");
  assert.ok(
    audit.entries.some((e) => e.action === "delete" && e.code === code),
  );
  assert.ok(audit.entries.some((e) => e.action === "terminate"));
});
test("管理登录暴力尝试限流", async (t) => {
  const a = await setup(t);
  for (let i = 0; i < 10; i++)
    assert.equal((await a.raw("/api/admin/login", { key: "bad" })).status, 401);
  assert.equal((await a.raw("/api/admin/login", { key })).status, 429);
});

test("生产可用管理平台，开发入口仍关闭", async (t) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let a;
  try {
    assert.throws(
      () =>
        createApp({
          database: ":memory:",
          adminOrigin: "http://127.0.0.1",
          adminKey: key,
        }),
      /HTTPS/,
    );
    a = await setup(t, { devAuth: true, devPanel: true });
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
  await a.login();
  assert.equal((await a.raw("/admin/companion")).status, 200);
  assert.equal((await a.raw("/dev")).status, 404);
  assert.equal((await a.raw("/api/dev-login", {})).status, 404);
});
