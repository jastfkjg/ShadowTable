"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createApp } = require("../server/app");
const run = promisify(execFile);
const client = resolve(__dirname, "../deploy/cloud/smoke-client.cjs");

async function start(database, webOrigin = "https://table.example.com") {
  const app = createApp({ database, webOrigin });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  return app;
}
async function stop(app) {
  await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
  app.store.close();
}

test("container smoke client logs in with proxy headers and restores SQLite session after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadowtable-smoke-"));
  const database = join(dir, "test.sqlite");
  let app;
  try {
    app = await start(database);
    const env = { ...process.env, SMOKE_SESSION_FILE: join(dir, "token"), SMOKE_BASE_URL: `http://127.0.0.1:${app.server.address().port}` };
    await run(process.execPath, [client, "login"], { env });
    await stop(app);
    app = undefined;
    app = await start(database);
    env.SMOKE_BASE_URL = `http://127.0.0.1:${app.server.address().port}`;
    await run(process.execPath, [client, "resume"], { env });
  } finally {
    if (app) await stop(app);
    await rm(dir, { recursive: true, force: true });
  }
});

test("container smoke client reports HTTP status and server error for origin rejection", async () => {
  const app = await start(":memory:", "https://different.example.com");
  try {
    await assert.rejects(run(process.execPath, [client, "login"], {
      env: { ...process.env, SMOKE_BASE_URL: `http://127.0.0.1:${app.server.address().port}` },
    }), error => {
      assert.match(error.stderr, /POST \/api\/guest-login: HTTP 403/);
      assert.match(error.stderr, /请求来源不匹配/);
      return true;
    });
  } finally {
    await stop(app);
  }
});
