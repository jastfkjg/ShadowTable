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
