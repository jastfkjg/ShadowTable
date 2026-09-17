"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app");

const origin = "https://play.example.com";
const host = "play.example.com";

async function setup(t, opts = {}) {
  const app = createApp({ database: ":memory:", ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
  });
  async function raw(path, data, extra = {}) {
    const r = await new Promise((resolve, reject) => {
      const request = require("node:http").request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: host,
            Origin: origin,
            "Sec-Fetch-Site": "same-origin",
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
              headers: response.headers,
              text,
              json: async () => JSON.parse(text),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(data ? JSON.stringify(data) : undefined);
    });
    return r;
  }
  async function api(path, data, extra) {
    const r = await raw(path, data, extra);
    const b = await r.json();
    if (!r.ok) throw Object.assign(new Error(b.error), { status: r.status });
    return b;
  }
  const auth = (token) => ({ Authorization: "Bearer " + token });
  return { app, raw, api, auth };
}

test("网页版默认关闭；WEB_ORIGIN 需完整 HTTPS 源且不含路径", async (t) => {
  const a = await setup(t);
  assert.equal((await a.raw("/")).status, 401);
  assert.equal((await a.raw("/app.js")).status, 401);
  assert.equal((await a.raw("/api/guest-login", {})).status, 404);
  assert.throws(
    () => createApp({ database: ":memory:", webOrigin: "http://example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      createApp({ database: ":memory:", webOrigin: "https://example.com/x" }),
    /不含路径/,
  );
});

test("访客登录有 Host/Origin/非跨站校验，令牌可建房且 uid 为 guest 前缀", async (t) => {
  const a = await setup(t, { webOrigin: origin });
  const { token } = await a.api("/api/guest-login", {});
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(
    (await a.raw("/api/guest-login", {}, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal(
    (await a.raw("/api/guest-login", {}, { Host: "evil.example" })).status,
    403,
  );
  assert.equal(
    (await a.raw("/api/guest-login", {}, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
  );
  const { code } = await a.api(
    "/api/rooms",
    { name: "访客", capacity: 6, board: "classic" },
    a.auth(token),
  );
  assert.match(code, /^\d{6}$/);
  const stored = a.app.store.get(code);
  assert.ok(stored.players.some((p) => p.uid.startsWith("guest:")));
  // 访客与微信用户同属玩家体系，能正常看到自己在场。
  const view = await a.api("/api/rooms/" + code, undefined, a.auth(token));
  assert.equal(view.me.name, "访客");
});

test("静态资源同源托管：HTML 与 CSP、Content-Type、未知路径落到 401", async (t) => {
  const a = await setup(t, { webOrigin: origin });
  const home = await a.raw("/");
  assert.equal(home.status, 200);
  assert.match(home.headers["content-type"], /text\/html/);
  assert.match(home.headers["content-security-policy"], /script-src 'self'/);
  assert.match(home.headers["content-security-policy"], /style-src 'self'/);
  assert.match(
    home.headers["content-security-policy"],
    /default-src 'none'/,
  );
  assert.equal(home.headers["x-frame-options"], "DENY");
  assert.match(home.text, /id="app"/);
  assert.match(
    (await a.raw("/style.css")).headers["content-type"],
    /text\/css/,
  );
  assert.match(
    (await a.raw("/app.js")).headers["content-type"],
    /javascript/,
  );
  assert.match(
    (await a.raw("/icon.svg")).headers["content-type"],
    /image\/svg\+xml/,
  );
  assert.equal((await a.raw("/nope.js")).status, 401);
  assert.equal((await a.raw("/style.css", {})).status, 401);
});

test("回归锚点：微信登录与开发登录不受网页版影响", async (t) => {
  const a = await setup(t, { webOrigin: origin, exchangeCode: (c) => c });
  const wx = await a.api("/api/login", { code: "wx-code" });
  assert.match(wx.token, /^[a-f0-9]{64}$/);
  const wxRoom = await a.api(
    "/api/rooms",
    { name: "真人", capacity: 6, board: "classic" },
    a.auth(wx.token),
  );
  assert.ok(a.app.store.get(wxRoom.code).players.some((p) =>
    p.uid.startsWith("wx:"),
  ));
  assert.equal((await a.raw("/api/dev-login", {})).status, 404);
  assert.equal((await a.raw("/api/login", {})).status, 400);
});