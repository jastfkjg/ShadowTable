const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { newRoom, enter, publicView, BOARDS } = require("../server/engine");

function client(fetch) {
  let scheduled;
  const element = { addEventListener() {}, hidden: true };
  const source = fs.readFileSync(require.resolve("../server/web/app.js"), "utf8");
  const context = {
    document: { hidden: false, getElementById: () => element, addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: () => "session", setItem() {}, removeItem() {} },
    navigator: {},
    fetch,
    setTimeout(fn) { scheduled = fn; return 1; },
    clearTimeout() { scheduled = undefined; },
    URL, console,
  };
  vm.runInNewContext(source.slice(0, source.indexOf("  // ===== boot =====")) + `
    render = function () {};
    roomCode = "123456";
    window.test = { state, schedule, loadSettings, refresh,
      setRefresh(fn) { refresh = fn; },
      stop() { foreground = false; }
    };
  })();`, context);
  return { ...context.window.test, scheduled: () => scheduled };
}
const response = (body) => ({ status: 200, json: async () => body });

test("网页轮询等待当前请求完成再调度，切后台后不继续轮询", async () => {
  const c = client();
  let finish;
  c.setRefresh(() => new Promise(resolve => { finish = resolve; }));
  c.schedule();
  const timer = c.scheduled();
  const pending = timer();
  assert.equal(c.scheduled(), timer);
  finish();
  await pending;
  assert.notEqual(c.scheduled(), timer);
  const next = c.scheduled()();
  c.stop();
  finish();
  await next;
  assert.equal(c.scheduled(), undefined);
});

test("关闭并重开网页设置后，旧请求不能覆盖新设置", async () => {
  let resolveBoards;
  const room = publicView(newRoom("123456", "p1", "房主"), "p1");
  const c = client(async path => {
    if (path === "/api/boards") return new Promise(resolve => { resolveBoards = resolve; });
    return response(room);
  });
  c.state.settings = { busy: false };
  const oldLoad = c.loadSettings();
  while (!resolveBoards) await Promise.resolve();
  const fresh = { busy: false, loading: true, capacity: 12, dirty: true };
  c.state.settings = fresh;
  resolveBoards(response({ boards: BOARDS }));
  await oldLoad;
  assert.deepEqual(fresh, { busy: false, loading: true, capacity: 12, dirty: true });
});

test("网页房主变更后关闭管理操作并撤销设置权限", async () => {
  const room = newRoom("123456", "p1", "房主");
  enter(room, "p2", "玩家");
  const before = publicView(room, "p1");
  room.host = "p2";
  const c = client(async () => response(publicView(room, "p1")));
  c.state.room = before;
  c.state.toolType = "vote";
  c.state.settings = { authorized: true };
  await c.refresh();
  assert.equal(c.state.toolType, "");
  assert.equal(c.state.settings.authorized, false);
  assert.match(c.state.settings.error, /房主已变更/);
});
