"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function client(api, offset = 0) {
  const source = fs.readFileSync(
    require.resolve("../server/admin/app.js"),
    "utf8",
  );
  const context = { api, offset };
  vm.runInNewContext(
    source.slice(
      source.indexOf("async function currentRoomCodes"),
      source.indexOf("async function refresh()"),
    ) + ";this.client = { currentRoomCodes, fetchAudit };",
    context,
  );
  return context.client;
}

test("房间选择使用现有房间接口，包含概览其他页且不依赖历史日志", async () => {
  const pages = [
    {
      rooms: Array.from({ length: 50 }, (_, i) => ({
        code: String(100000 + i),
      })),
      total: 51,
    },
    { rooms: [{ code: "200000" }], total: 51 },
  ];
  const c = client(async (path) => {
    assert.equal(path, "rooms?offset=0");
    return pages[0];
  }, 50);
  const codes = await c.currentRoomCodes(pages[1]);
  assert.equal(codes.length, 51);
  assert.ok(codes.includes("100000"));
  assert.ok(codes.includes("200000"));
});

test("旧接口的账号创建记录在分页前过滤，数量和后续页保持准确", async () => {
  const groups = Array.from({ length: 45 }, (_, i) => ({
    key: String(i),
    entries: [{ action: i < 22 ? "actor" : "player" }],
  }));
  const c = client(async (path) => {
    const start = Number(
      new URL(path, "http://localhost").searchParams.get("offset"),
    );
    return { groups: groups.slice(start, start + 20), total: 45, pageSize: 20 };
  });
  const first = await c.fetchAudit("123456", 0);
  assert.equal(first.total, 23);
  assert.equal(first.groups.length, 20);
  assert.equal(first.groups[0].key, "22");
  const next = await c.fetchAudit("123456", 20);
  assert.equal(next.total, 23);
  assert.equal(next.groups.length, 3);
  assert.equal(next.groups[0].key, "42");
});

test("新版接口保留服务端分页，不额外读取全部日志", async () => {
  let calls = 0;
  const result = { filtered: true, groups: [], total: 100, pageSize: 20 };
  const c = client(async () => {
    calls++;
    return result;
  });
  assert.equal(await c.fetchAudit("123456", 20), result);
  assert.equal(calls, 1);
});

function auditRenderer() {
  function node(tag, text = "", className = "") {
    return {
      tag,
      text,
      className,
      children: [],
      append(...items) {
        this.children.push(...items);
      },
      replaceChildren() {
        this.children = [];
      },
    };
  }
  const elements = new Map();
  const context = {
    $: (id) => {
      if (!elements.has(id)) elements.set(id, node("div"));
      return elements.get(id);
    },
    el: node,
    document: { createTextNode: (text) => node("text", text) },
    labels: { login: "管理员登录" },
    auditOffset: 0,
  };
  const source = fs.readFileSync(
    require.resolve("../server/admin/app.js"),
    "utf8",
  );
  vm.runInNewContext(
    source.slice(
      source.indexOf("function renderAudit("),
      source.indexOf("function renderRoomOptions("),
    ) + ";this.render = renderAudit;",
    context,
  );
  const flatten = (n) => [n, ...n.children.flatMap(flatten)];
  return {
    render: context.render,
    nodes: () => flatten(elements.get("audit")),
  };
}

test("操作记录显示行动当时身份和发起时间，不使用后续身份、不展示局轮或明细", () => {
  const c = auditRenderer();
  const startedAt = new Date("2026-09-19T02:44:00Z").getTime();
  const actor = { seat: 1, name: "zzz", role: "魔术师", required: true };
  c.render({
    groups: [
      {
        active: false,
        entries: [
          {
            created: startedAt + 90000,
            details: {
              game: 1,
              round: 2,
              stage: "s1",
              phaseKey: "skillPrepare",
              phase: "同时秘密使用技能",
              activityStartedAt: startedAt,
              participants: [{ ...actor, role: "红猎人" }],
              player: { seat: 2, name: "other", role: "忠臣" },
              command: "submit",
              value: "pass",
            },
          },
          {
            created: startedAt + 30000,
            details: {
              game: 1,
              round: 2,
              stage: "s1",
              phaseKey: "skillPrepare",
              phase: "同时秘密使用技能",
              activityStartedAt: startedAt,
              participants: [actor],
              player: actor,
              command: "submit",
              choice: "秘密换号 3号 ↔ 4号",
            },
          },
        ],
      },
    ],
    total: 1,
    pageSize: 20,
  });
  const nodes = c.nodes();
  const text = nodes.map((n) => n.text).join(" ");
  assert.match(text, /1号·zzz·魔术师/);
  assert.doesNotMatch(text, /zzz·红猎人|第 1 局|第 2 轮|明细/);
  assert.equal(
    nodes.find((n) => n.tag === "time").text,
    "发起于 " + new Date(startedAt).toLocaleString(),
  );
  assert.ok(!nodes.some((n) => ["details", "summary"].includes(n.tag)));
});

test("旧记录不猜身份，时间取首次记录；管理员操作保留简短说明", () => {
  const c = auditRenderer();
  c.render({
    groups: [
      {
        entries: [
          {
            created: 3000,
            details: {
              stage: "s1",
              phase: "技能",
              game: 1,
              player: { seat: 1, name: "旧玩家" },
              command: "submit",
              value: "pass",
            },
          },
          { created: 1000, details: { stage: "s1", phase: "技能", game: 1 } },
        ],
      },
      {
        entries: [
          { created: 4000, action: "login", reason: "测试登录", details: {} },
        ],
      },
    ],
    total: 2,
    pageSize: 20,
  });
  const nodes = c.nodes();
  assert.match(nodes.map((n) => n.text).join(" "), /1号·旧玩家·身份未记录/);
  assert.equal(
    nodes.find((n) => n.tag === "time").text,
    "记录于 " + new Date(1000).toLocaleString(),
  );
  assert.match(nodes.map((n) => n.text).join(" "), /管理员登录 · 测试登录/);
});

function actionClient(api) {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        disabled: false,
        open: false,
        handlers: {},
        reset() {},
        focus() {},
        addEventListener(name, fn) {
          this.handlers[name] = fn;
        },
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
          this.handlers.close?.();
        },
      });
    return elements.get(id);
  };
  const messages = [];
  const context = {
    $,
    api,
    actionBusy: false,
    loading: false,
    pending: null,
    labels: {
      "test-on": "开启陪测",
      "clear-testers": "清理陪测座位",
      "test-off": "关闭陪测",
      terminate: "终止对局",
      rematch: "同房重开",
      delete: "删除房间",
    },
    refresh: async () => {},
    feedback: (text) => messages.push(text),
  };
  const source = fs.readFileSync(
    require.resolve("../server/admin/app.js"),
    "utf8",
  );
  vm.runInNewContext(
    source.slice(
      source.indexOf("function openAction("),
      source.indexOf('$("refresh").addEventListener'),
    ) + ";this.open = openAction;",
    context,
  );
  return {
    $,
    messages,
    open: context.open,
    submit: () => $("action-form").handlers.submit({ preventDefault() {} }),
  };
}

test("开启和清理直接发送，不弹确认；请求中拦截重复点击并恢复状态", async () => {
  for (const action of ["test-on", "clear-testers"]) {
    const calls = [];
    let finish;
    const c = actionClient((path, body) => {
      calls.push({ path, body });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const room = { code: "123456", stage: "s1" };
    const request = c.open(room, action);
    c.open(room, action);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, action);
    assert.equal(calls[0].body.stage, "s1");
    assert.equal(calls[0].body.confirm, undefined);
    assert.equal(c.$("confirm-dialog").open, false);
    assert.equal(c.$("rooms").inert, true);
    finish({ ok: true });
    await request;
    assert.equal(c.$("rooms").inert, false);
    assert.equal(c.$("refresh").disabled, false);
    assert.match(c.messages.at(-1), /完成/);
  }
});

test("终止重开删除和关闭陪测可取消，仅点击确认后发送布尔确认", async () => {
  for (const action of ["terminate", "rematch", "delete", "test-off"]) {
    const calls = [];
    const c = actionClient(async (path, body) => {
      calls.push({ path, body });
    });
    const room = { code: "123456", stage: "s1" };
    c.open(room, action);
    assert.equal(calls.length, 0);
    assert.equal(c.$("confirm-dialog").open, true);
    c.$("cancel").handlers.click();
    await c.submit();
    assert.equal(calls.length, 0);
    c.open(room, action);
    await c.submit();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.confirm, true);
    assert.equal(c.$("confirm-dialog").open, false);
  }
});

test("直接执行失败时展示错误并允许重试", async () => {
  let calls = 0;
  const c = actionClient(async () => {
    if (++calls === 1) throw new Error("房间状态已变化");
  });
  const room = { code: "123456", stage: "s1" };
  await c.open(room, "clear-testers");
  assert.match(c.messages.at(-1), /房间状态已变化/);
  assert.equal(c.$("rooms").inert, false);
  await c.open(room, "clear-testers");
  assert.equal(calls, 2);
});
