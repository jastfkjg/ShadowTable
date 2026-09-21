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

test("清空陪测：终止和进行中均可重置，转交真人房主并重新补位", async () => {
  const a = await launch();
  try {
    for (const terminated of [true, false]) {
      const human = (await a.request("/api/dev-login", null, {})).token;
      const { code } = await a.request("/api/rooms", human, {
        name: "真人",
        capacity: 6,
      });
      let saved;
      const panel = new Companion({
        request: a.request,
        save: (s) => (saved = structuredClone(s)),
      });
      const bot = await panel.add(code);
      await panel.fill();
      const view = () => a.request("/api/rooms/" + code, human);
      const command = async (type, extra = {}) =>
        a.request("/api/rooms/" + code + "/commands", human, {
          type,
          stage: (await view()).stage,
          ...extra,
        });
      await command("ready", { ready: true });
      await panel.batch("ready");
      await command("transfer", { seat: bot.room.me.seat });
      await panel.refresh();
      await panel.command(bot, "start");
      await panel.refresh();
      if (terminated) {
        await panel.command(bot, "terminate");
        await panel.refresh();
      }
      await panel.clearPlayers();
      const room = await view();
      assert.equal(room.phase, "lobby");
      assert.equal(room.me.isHost, true);
      assert.equal(room.me.ready, false);
      assert.equal(room.players.length, 1);
      assert.equal(panel.actors.length, 0);
      assert.deepEqual(saved.actors, []);
      await panel.add(code);
      await panel.fill();
      assert.equal(panel.actors.length, 5);
    }
  } finally {
    await a.close();
  }
});

test("清空陪测不能代替真人结束对局，也不能遗失唯一房主", async () => {
  const a = await launch();
  try {
    const human = (await a.request("/api/dev-login", null, {})).token;
    const { code } = await a.request("/api/rooms", human, {
      name: "真人",
      capacity: 6,
    });
    const panel = new Companion({ request: a.request });
    const bot = await panel.add(code);
    await panel.fill();
    const view = () => a.request("/api/rooms/" + code, human);
    const command = async (type, extra = {}) =>
      a.request("/api/rooms/" + code + "/commands", human, {
        type,
        stage: (await view()).stage,
        ...extra,
      });
    await command("ready", { ready: true });
    await panel.batch("ready");
    await command("start");
    await assert.rejects(panel.clearPlayers(), /请先由房主/);
    assert.equal((await view()).phase, "identity");
    assert.equal(panel.actors.length, 5);
    await command("terminate");
    await command("rematch");
    await command("transfer", { seat: bot.room.me.seat });
    await command("leave");
    await assert.rejects(panel.clearPlayers(), /真人玩家入座/);
    assert.equal(panel.actors.length, 5);
    assert.equal(bot.room.me.isHost, true);
  } finally {
    await a.close();
  }
});

test("清空回执丢失保留凭据和幂等编号，确认后才移除", async () => {
  const a = await launch();
  try {
    const human = (await a.request("/api/dev-login", null, {})).token;
    const { code } = await a.request("/api/rooms", human, { name: "真人" });
    const panel = new Companion({ request: a.request });
    const bot = await panel.add(code);
    let lostId;
    panel.request = async (...args) => {
      const result = await a.request(...args);
      if (args[2]?.type === "leave") {
        lostId = args[3];
        throw new Error("回执丢失");
      }
      return result;
    };
    await assert.rejects(panel.clearPlayers(), /回执丢失/);
    assert.equal(panel.actors.length, 1);
    assert.equal(bot.pending.id, lostId);
    await assert.rejects(panel.clearPlayers(), /未确认/);
    panel.request = a.request;
    await panel.retry(bot);
    assert.equal(panel.actors.length, 0);
    assert.equal(
      (await a.request("/api/rooms/" + code, human)).players.length,
      1,
    );
  } finally {
    await a.close();
  }
});

test("陪测轮询复用同阶段私密视图，阶段变化后重新获取", async () => {
  let stage = "s1",
    privateReads = 0;
  const c = new Companion({
    state: { code: "123456", actors: [{ id: "a", token: "t", joined: true }] },
    request: async (path) => {
      if (path.endsWith("/private")) {
        privateReads++;
        return { stage, game: 1, role: "测试角色" };
      }
      return { stage, game: 1, phase: "tools", me: {} };
    },
  });
  await c.refresh();
  await c.refresh();
  await c.refresh();
  assert.equal(privateReads, 1);
  stage = "s2";
  await c.refresh();
  assert.equal(privateReads, 2);
  assert.equal(c.actors[0].secret.stage, "s2");
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function simulatedPanel(count, request) {
  return new Companion({
    state: {
      code: "123456",
      actors: Array.from({ length: count }, (_, i) => ({
        id: String(i),
        token: String(i),
        joined: true,
        room: { phase: "lobby", stage: "s1", me: { ready: false } },
      })),
    },
    request,
  });
}

test("准备回执立即更新本人状态，迟到的轮询与错误不能覆盖操作", async () => {
  for (const fail of [false, true]) {
    const old = deferred();
    const c = simulatedPanel(1, async (path, token, data) =>
      data ? {} : old.promise,
    );
    const actor = c.actors[0];
    const polling = c.refresh();
    await c.command(actor, "ready", { ready: true });
    assert.equal(actor.room.me.ready, true);
    if (fail) old.reject(Object.assign(new Error("旧错误"), { status: 403 }));
    else old.resolve({ phase: "lobby", stage: "s1", me: { ready: false } });
    await polling;
    assert.equal(actor.room.me.ready, true);
    assert.equal(actor.joined, true);
    assert.equal(actor.error, "");
  }
});

test("更新的查询优先，旧私密响应不能覆盖新阶段", async () => {
  const secret = deferred();
  let stage = "s1";
  const c = simulatedPanel(1, async (path) =>
    path.endsWith("/private")
      ? secret.promise
      : {
          phase: stage === "s1" ? "identity" : "lobby",
          stage,
          me: { ready: false },
        },
  );
  const old = c.refresh();
  await new Promise(setImmediate);
  stage = "s2";
  await c.refresh();
  secret.resolve({ stage: "s1", role: "旧角色" });
  await old;
  assert.equal(c.actors[0].room.stage, "s2");
  assert.equal(c.actors[0].secret, null);
});

test("11人刷新与全部准备最多并发4个请求，保留真人与已准备玩家", async () => {
  let active = 0,
    max = 0,
    requests = 0;
  const c = simulatedPanel(11, async (path, token, data) => {
    requests++;
    active++;
    max = Math.max(max, active);
    await new Promise(setImmediate);
    active--;
    return data ? {} : { phase: "lobby", stage: "s1", me: { ready: false } };
  });
  await c.refresh();
  assert.equal(requests, 11);
  assert.equal(max, 4);
  requests = 0;
  c.actors[0].room.me.ready = true;
  assert.equal(await c.batch("ready"), 10);
  assert.equal(requests, 10);
  assert.ok(c.actors.every((a) => a.room.me.ready));
  assert.equal(active, 0);
});

test("批量准备遇到失败停止派发并等待在途请求，失败保留原编号", async () => {
  const gates = Array.from({ length: 4 }, deferred);
  let requests = 0,
    settled = false;
  const c = simulatedPanel(11, (path, token) => {
    requests++;
    return gates[Number(token)].promise;
  });
  const batch = c.batch("ready");
  const rejected = assert.rejects(batch, /网络中断/).then(() => {
    settled = true;
  });
  const id = c.actors[0].pending.id;
  gates[0].reject(new Error("网络中断"));
  await new Promise(setImmediate);
  assert.equal(settled, false);
  gates.slice(1).forEach((g) => g.resolve({}));
  await rejected;
  assert.equal(requests, 4);
  assert.equal(c.actors[0].pending.id, id);
  assert.ok(c.actors.slice(1, 4).every((a) => a.room.me.ready && !a.pending));
  assert.ok(c.actors.slice(4).every((a) => !a.pending && !a.room.me.ready));
});
