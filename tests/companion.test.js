"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app");
const { Companion } = require("../server/dev-panel/panel");
const { serve } = require("../server/dev-panel");
async function launch(opts = {}) {
  const app = createApp({
    database: ":memory:",
    devAuth: true,
    devPanel: true,
    ...opts,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const request = async (path, token, data, id = randomUUID()) => {
    const response = await fetch(base + path, {
      method: data ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + (token || ""),
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error), { status: response.status });
    return value;
  };
  return {
    app,
    base,
    request,
    close: async () => {
      await new Promise((r) => app.server.close(r));
      app.store.close();
    },
  };
}
test("面板需显式开发开关，拒绝外部Host/Origin与非本机访问", async () => {
  for (const opts of [
    { devPanel: false },
    { devAuth: false },
    { devAuth: true, devPanel: true },
  ]) {
    const a = await launch(opts);
    try {
      for (const path of [
        "/dev",
        "/dev/",
        "/dev/panel.js",
        "/dev/panel.css",
        "/dev/icon.svg",
      ]) {
        const r = await fetch(a.base + path);
        assert.equal(
          r.status,
          opts.devPanel === false || opts.devAuth === false ? 404 : 200,
        );
        if (r.ok)
          assert.match(
            r.headers.get("content-security-policy"),
            /frame-ancestors 'none'/,
          );
      }
      for (const headers of [
        { Host: "evil.example" },
        { Origin: "https://evil.example" },
        { "Sec-Fetch-Site": "cross-site" },
      ])
        assert.equal(
          await new Promise((resolve, reject) => {
            require("node:http")
              .get(a.base + "/dev", { headers }, (res) => {
                res.resume();
                resolve(res.statusCode);
              })
              .on("error", reject);
          }),
          404,
          JSON.stringify(headers),
        );
    } finally {
      await a.close();
    }
  }
  assert.equal(
    serve(
      {
        method: "GET",
        socket: { remoteAddress: "192.168.1.2" },
        headers: { host: "localhost" },
      },
      {},
      "/dev",
    ),
    false,
  );
});
test("生产模式即使误传开发开关也无法提供面板或匿名开发登录", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const a = await launch();
  try {
    for (const path of [
      "/dev",
      "/dev/panel.js",
      "/dev/panel.css",
      "/dev/icon.svg",
    ])
      assert.equal((await fetch(a.base + path)).status, 404);
    await assert.rejects(
      a.request("/api/dev-login", null, {}),
      (e) => e.status === 404,
    );
  } finally {
    await a.close();
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
test("陪测账号经HTTP完成任务和刺杀，不替真人提交", async () => {
  const a = await launch();
  try {
    const host = (await a.request("/api/dev-login", null, {})).token;
    const { code } = await a.request("/api/rooms", host, {
      name: "真人",
      capacity: 6,
    });
    const panel = new Companion({ request: a.request });
    await panel.add(code);
    await panel.fill();
    assert.equal(panel.actors.length, 5);
    assert.equal(new Set(panel.actors.map((p) => p.token)).size, 5);
    assert.equal(await panel.batch("ready"), 5);
    const view = () => a.request("/api/rooms/" + code, host);
    const command = async (type, extra = {}) =>
      a.request("/api/rooms/" + code + "/commands", host, {
        type,
        stage: (await view()).stage,
        ...extra,
      });
    assert.equal((await view()).me.ready, false);
    await command("ready", { ready: true });
    await command("start");
    await panel.refresh();
    await panel.batch("confirm");
    assert.equal((await view()).me.submitted, false);
    await assert.rejects(command("advance"));
    await command("submit", { value: "confirm" });
    await command("advance");
    for (let i = 0; i < 3; i++) {
      await panel.refresh();
      const room = await view();
      const team = room.players.slice(0, room.teamSize).map((p) => p.seat);
      const leader = panel.actors.find((p) => p.room.me.seat === room.leader);
      if (leader) await panel.command(leader, "propose", { team });
      else await command("propose", { team });
      await command("advance");
      await panel.refresh();
      await panel.batch("approve");
      await command("submit", { value: "approve" });
      await command("advance");
      await command("advance");
      await panel.refresh();
      await panel.batch("success");
      await panel.batch("confirm");
      const action = (await a.request("/api/rooms/" + code + "/private", host))
        .action;
      await command("submit", { value: action.choices[0] });
      await command("advance");
      await command("advance");
    }
    await panel.refresh();
    assert.equal((await view()).phase, "assassination");
    const assassin = panel.actors.find(
      (p) => p.secret.action.kind === "target",
    );
    if (assassin) {
      await assert.rejects(
        panel.command(assassin, "submit", { value: assassin.room.me.seat }),
      );
      await panel.command(assassin, "submit", {
        value: assassin.secret.action.targets[0].seat,
      });
      await command("submit", { value: "confirm" });
    } else {
      const secret = await a.request("/api/rooms/" + code + "/private", host);
      await command("submit", { value: secret.action.targets[0].seat });
    }
    await panel.batch("confirm");
    await command("advance");
    assert.equal((await view()).phase, "ended");
    await command("rematch");
    await panel.refresh();
    assert.ok(panel.actors.every((p) => !p.secret && !p.room.me.ready));
    for (const p of [...panel.actors]) await panel.command(p, "leave");
    assert.equal((await view()).players.length, 1);
  } finally {
    await a.close();
  }
});
test("陪测未确认请求在刷新后沿用原编号重试", async () => {
  const a = await launch();
  try {
    const host = (await a.request("/api/dev-login", null, {})).token;
    const { code } = await a.request("/api/rooms", host, { name: "真人" });
    let saved;
    const panel = new Companion({
      request: a.request,
      save: (s) => (saved = structuredClone(s)),
    });
    const actor = await panel.add(code);
    const ids = [];
    panel.request = async (...args) => {
      ids.push(args[3]);
      await a.request(...args);
      throw new Error("回执丢失");
    };
    await assert.rejects(panel.command(actor, "ready", { ready: true }));
    const restored = new Companion({
      state: saved,
      request: async (...args) => {
        ids.push(args[3]);
        return a.request(...args);
      },
    });
    await restored.retry(restored.actors[0]);
    await restored.refresh();
    assert.equal(ids[0], ids[1]);
    assert.equal(restored.actors[0].room.me.ready, true);
    assert.equal(restored.actors[0].pending, null);
  } finally {
    await a.close();
  }
});
