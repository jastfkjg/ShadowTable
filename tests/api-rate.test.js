const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
test("429冷却期间不再发请求，到期允许显式重试且保留幂等编号", async () => {
  let now = 0,
    calls = 0;
  const headers = [];
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../miniprogram/api"), "utf8"),
    {
      module,
      require: () => ({ baseUrl: "http://test" }),
      Date: { now: () => now },
      wx: {
        getStorageSync: () => "",
        request: (o) => {
          calls++;
          headers.push(o.header);
          o.success(
            calls === 1
              ? {
                  statusCode: 429,
                  data: { error: "请求过于频繁" },
                  header: { "retry-after": "5" },
                }
              : { statusCode: 200, data: { ok: true } },
          );
        },
      },
    },
  );
  const api = module.exports;
  await assert.rejects(
    () => api.request("/commands", "POST", {}, "same-id"),
    (e) => e.status === 429 && e.retryAfterMs === 5000,
  );
  await assert.rejects(
    () => api.request("/room"),
    (e) => e.status === 429,
  );
  assert.equal(calls, 1);
  now = 5000;
  await api.request("/commands", "POST", {}, "same-id");
  assert.equal(calls, 2);
  assert.equal(headers[1]["Idempotency-Key"], "same-id");
});
