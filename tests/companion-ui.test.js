"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const flush = () => new Promise(setImmediate);

function panel({ overrides = {}, search = "", saved, pathname = "/admin/companion", playerCookie = false } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        dataset: {},
        handlers: {},
        innerHTML: "",
        addEventListener(event, fn) {
          this.handlers[event] = fn;
        },
        close() {},
        closest() {
          return null;
        },
      });
    return elements.get(id);
  };
  let stored;
  element('batch-ready').dataset.batch = 'ready';
  let poll,
    hold = false;
  const pending = [],
    calls = [];
  const actors = Array.from({ length: 11 }, (_, i) => ({
    id: String(i),
    token: String(i),
    name: `陪测${i}`,
    joined: true,
  }));
  const room = (token) => ({
    phase: "lobby",
    phaseName: "准备",
    stage: "s1",
    game: 0,
    players: actors,
    capacity: 12,
    me: { seat: Number(token) + 2, ready: false },
    ...overrides,
  });
  const response = (body, status = 200) => ({
    status,
    ok: status < 400,
    json: async () => body,
  });
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../server/dev-panel/panel"), "utf8"),
    {
      document: {
        hidden: false,
        getElementById: element,
        addEventListener() {},
        querySelectorAll: (selector) =>
          selector === "button"
            ? [element("fill"), element("refresh"), element("leave"), element('batch-ready')]
            : selector === '[data-batch]' ? [element('batch-ready')] : [],
      },
      URLSearchParams,
      confirm: () => true,
      location: { pathname, search },
      sessionStorage: {
        getItem: () => JSON.stringify(saved || { code: "123456", actors }),
        setItem(key, value) {
          stored = JSON.parse(value);
        },
      },
      crypto: { randomUUID },
      AbortSignal,
      setInterval(fn) {
        poll = fn;
      },
      fetch: (path, options) => {
        const token = options.headers.Authorization.slice(7);
        calls.push({
          path,
          method: options.method,
          credentials: options.credentials,
          token,
          data: options.body && JSON.parse(options.body),
        });
        if (playerCookie && options.credentials !== "omit")
          return Promise.resolve(response({ error: "浏览器账号已变化，请刷新页面" }, 409));
        const body =
          options.method === "POST" ? { accepted: true } : room(token);
        if (hold)
          return new Promise((resolve) =>
            pending.push({
              method: options.method,
              resolve: () => resolve(response(body)),
            }),
          );
        return Promise.resolve(response(body));
      },
    },
  );
  return {
    element,
    stored: () => stored,
    calls,
    pending,
    poll: () => poll(),
    hold: (value) => {
      hold = value;
    },
    click: (id, action = "ready") =>
      element("players").handlers.click({
        target: {
          closest: (selector) =>
            selector === "[data-action]"
              ? { dataset: { action } }
              : { dataset: { actor: id } },
        },
      }),
  };
}

test("本地陪测隔离网页登录 Cookie，管理陪测保留管理员 Cookie", async () => {
  const local = panel({ pathname: "/dev", playerCookie: true });
  await flush();
  assert.doesNotMatch(local.element("players").innerHTML, /浏览器账号已变化/);
  await local.element("batch-ready").onclick();
  assert.equal(local.calls.filter(call => call.method === "POST").length, 11);
  assert.ok(local.calls.every(call => call.credentials === "omit"));
  assert.match(local.element("feedback").textContent, /已完成 11/);
  const managed = panel();
  await flush();
  await managed.element("batch-ready").onclick();
  assert.ok(managed.calls.every(call => call.credentials === "same-origin"));
});

test("全部准备确认后直接解锁并显示结果，不追加11次状态读取", async () => {
  const p = panel(); await flush();
  const reads = p.calls.filter(call => call.method === 'GET').length;
  await p.element('batch-ready').onclick();
  assert.equal(p.calls.filter(call => call.method === 'POST').length, 11);
  assert.equal(p.calls.filter(call => call.method === 'GET').length, reads);
  assert.equal((p.element('players').innerHTML.match(/取消准备/g) || []).length, 11);
  assert.equal(p.element('refresh').disabled, false);
  assert.match(p.element('feedback').textContent, /已完成 11/);
});

test("轮询期间准备不丢点击：仅锁本人，回执立即显示且不额外全员查询", async () => {
  const p = panel();
  await flush();
  assert.equal(p.calls.length, 11, "恢复会话只刷新一遍");
  p.hold(true);
  const polling = p.poll();
  assert.equal(p.pending.length, 4);
  p.click("0");
  p.click("0");
  p.click("1");
  assert.equal(
    p.calls.filter((c) => c.method === "POST").length,
    2,
    "不同玩家可同时提交，同一玩家禁止重复",
  );
  assert.match(p.element("players").innerHTML, /正在确认…/);
  const reads = p.calls.filter((c) => c.method === "GET").length;
  p.pending.filter((r) => r.method === "POST").forEach((r) => r.resolve());
  await flush();
  assert.equal(p.calls.filter((c) => c.method === "GET").length, reads);
  assert.match(p.element("players").innerHTML, /已准备/);
  assert.doesNotMatch(p.element("players").innerHTML, /正在确认…/);
  assert.equal(p.element("refresh").disabled, false);
  p.hold(false);
  p.pending.filter((r) => r.method === "GET").forEach((r) => r.resolve());
  await polling;
  assert.equal(
    (p.element("players").innerHTML.match(/取消准备/g) || []).length,
    2,
    "迟到的旧轮询不能覆盖已确认状态",
  );
});

test("房主在自由操作阶段可发起投票，普通玩家没有管理入口", async () => {
  const p = panel({
    overrides: {
      phase: "tools",
      flexible: true,
      canUseTools: true,
      me: { seat: 2, isHost: true },
      players: [{ seat: 2, alive: true }],
    },
  });
  await flush();
  assert.match(p.element("players").innerHTML, /发起任务/);
  assert.match(p.element("players").innerHTML, /终止本局/);
  p.click("0", "begin:vote");
  await flush();
  assert.equal(
    p.calls.find((c) => c.method === "POST").data.type,
    "beginActivity",
  );
  assert.equal(p.calls.find((c) => c.method === "POST").data.kind, "vote");
  const normal = panel();
  await flush();
  assert.doesNotMatch(normal.element("players").innerHTML, /房主操作台/);
});

test("按房间入口恢复会话，切换保留原房间未确认请求", async () => {
  const pending = {
    path: "/api/rooms/123456/commands",
    id: "original",
    data: { type: "ready" },
  };
  const p = panel({
    search: "?room=654321",
    saved: {
      code: "123456",
      actors: [{ id: "old", token: "old", joined: true, pending }],
    },
  });
  await flush();
  assert.equal(p.element("code").value, "654321");
  assert.equal(p.calls.length, 0);
  p.element("code").value = "123456";
  await p.element("switch-room").onclick();
  await flush();
  assert.equal(p.stored().code, "123456");
  assert.equal(p.stored().actors[0].pending.id, "original");
  p.element("code").value = "654321";
  await p.element("switch-room").onclick();
  await flush();
  assert.equal(p.stored().rooms["123456"].actors[0].pending.id, "original");
  assert.equal(p.stored().actors.length, 0);
});

test("陪测猎人先选方式再选号码，切换不发送请求，仅提交最终目标", async () => {
  const p = panel({ overrides: {
    phase: "skillPrepare",
    action: {hunterModes: true, choices: ["pass", "detonate:1", "detonate:11", "passive:5"], options: [{value: "passive:5", label: "出局时向5号开枪"}]},
  }});
  await flush();
  assert.match(p.element("players").innerHTML, /hunterMode:detonate/);
  assert.ok(!p.element("players").innerHTML.includes('data-action="detonate:1"'));
  p.click("0", "hunterMode:detonate");
  assert.ok(p.element("players").innerHTML.includes('data-action="detonate:11"'));
  assert.ok(!p.element("players").innerHTML.includes('data-action="passive:5"'));
  p.click("0", "hunterMode:");
  p.click("0", "hunterMode:passive");
  assert.ok(!p.element("players").innerHTML.includes('data-action="detonate:11"'));
  assert.ok(p.element("players").innerHTML.includes('data-action="passive:5"'));
  assert.equal(p.calls.filter(c => c.method === "POST").length, 0);
  p.click("0", "passive:5");
  await flush();
  assert.equal(p.calls.find(c => c.method === "POST").data.value, "passive:5");
});
