"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const flush = () => new Promise(setImmediate);

function panel() {
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
        closest() {
          return null;
        },
      });
    return elements.get(id);
  };
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
  });
  const response = (body) => ({
    status: 200,
    ok: true,
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
            ? [element("fill"), element("refresh"), element("leave")]
            : [],
      },
      location: { pathname: "/admin/companion" },
      sessionStorage: {
        getItem: () => JSON.stringify({ code: "123456", actors }),
        setItem() {},
      },
      crypto: { randomUUID },
      AbortSignal,
      setInterval(fn) {
        poll = fn;
      },
      fetch: (path, options) => {
        const token = options.headers.Authorization.slice(7);
        calls.push({ path, method: options.method, token });
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
    calls,
    pending,
    poll: () => poll(),
    hold: (value) => {
      hold = value;
    },
    click: (id) =>
      element("players").handlers.click({
        target: {
          closest: (selector) =>
            selector === "[data-action]"
              ? { dataset: { action: "ready" } }
              : { dataset: { actor: id } },
        },
      }),
  };
}

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
