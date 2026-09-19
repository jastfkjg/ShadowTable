const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { newRoom, enter, command, publicView, BOARDS } = require("../server/engine");

function client(fetch) {
  let scheduled;
  const element = { addEventListener() {}, hidden: true, classList: { add() {}, remove() {} } };
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
    window.test = { state, schedule, loadSettings, refresh, viewRoom, viewHostBar, viewSettingsDialog, kickFromSettings, sendKick,
      setConfirm(fn) { confirm = fn; },
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


test("网页恢复后保留最近结果、弃权票和无需操作提示，进入下一项仍可回看", async () => {
  const room = newRoom("123456", "p1", "房主");
  const run = (uid, type, extra = {}) => command(room, uid, { type, stage: room.stage, ...extra });
  for (let i = 2; i <= 6; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach(p => run(p.uid, "ready", { ready: true }));
  run("p1", "start", { flexible: true });
  run("p1", "beginActivity", { kind: "vote" });
  run("p1", "submit", { value: "approve" });
  run("p1", "closeWaiting", { confirm: true });
  const c = client(async () => response(publicView(room, "p1")));
  await c.refresh();
  assert.match(c.state.latestResult.text, /提前截止/);
  assert.equal(c.state.latestResult.voteGroups[2].label, "弃权");
  assert.equal(c.state.latestResult.voteGroups[2].count, 5);
  run("p1", "beginActivity", { kind: "quest", team: [2], threshold: 1 });
  await c.refresh();
  assert.match(c.state.latestResult.text, /提前截止/);
  const html = c.viewRoom();
  assert.match(html, /最近操作结果/);
  assert.match(html, /本次你无需操作/);
  assert.match(c.viewHostBar(), /作废本次任务/);
  assert.ok(!c.viewHostBar().includes('data-action="settleTool"'));
  assert.ok(!c.viewHostBar().includes('data-action="cancelTool"'));
  run("p2", "submit", { value: "success" });
  await c.refresh();
  assert.equal(c.state.latestResult.text, "任务成功");
  run("p1", "finishTools");
  run("p1", "rematch");
  await c.refresh();
  assert.equal(c.state.latestResult, null);
});


test("网页移出失败可重试原请求，成功更新成员列表和保留设置草稿", async () => {
  const r = newRoom("123456", "p1", "房主", "knights", 12);
  enter(r, "p2", "玩家2");
  let dropped = true;
  const writes = [];
  const c = client(async (path, options) => {
    if (options.method === "POST") {
      writes.push({ id: options.headers["Idempotency-Key"], data: JSON.parse(options.body) });
      if (dropped) { dropped = false; throw new Error("断线"); }
      command(r, "p1", writes[0].data);
      return response({ accepted: true });
    }
    return response(path === "/api/boards" ? { boards: BOARDS } : publicView(r, "p1"));
  });
  c.setConfirm(async () => true);
  c.state.room = publicView(r, "p1");
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  Object.assign(c.state.settings, { dirty: true, visible: true });
  await c.kickFromSettings(2);
  assert.equal(c.state.settings.pendingKick, true);
  assert.match(c.viewSettingsDialog(), /data-action="retryKick"/);
  await c.sendKick();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(c.state.settings.pendingKick, false);
  assert.equal(c.state.settings.dirty, true);
  assert.equal(c.state.settings.visible, true);
  assert.equal(c.state.settings.room.players.length, 1);
});

test("被移出时网页清空身份和房间并显示原因，设置中对局开始后禁用移出", async () => {
  const c = client(async path => path === "/api/me/rooms" ? response({ rooms: [] }) : ({ status: 403, json: async () => ({ error: "你已被房主移出房间" }) }));
  c.state.room = { code: "123456" };
  c.state.secret = { role: "梅林" };
  c.state.revealed = true;
  await c.refresh();
  assert.equal(c.state.room, null);
  assert.equal(c.state.secret, null);
  assert.equal(c.state.revealed, false);
  assert.equal(c.state.notice, "你已被房主移出房间");
  const r = newRoom("123456", "p1", "房主");
  enter(r, "p2", "玩家");
  const active = publicView(r, "p1");
  active.canKick = false;
  active.phase = "tools";
  const host = client(async () => response(active));
  host.state.showRoomSettings = true;
  host.state.settings = { authorized: true, room: publicView(r, "p1"), boards: [], choices: [], capacities: [] };
  await host.refresh();
  assert.match(host.viewSettingsDialog(), /data-change="settingsKick" disabled/);
  assert.match(host.viewSettingsDialog(), /对局进行中不能移出/);
});


test("旧服务缺少移出权限时提示更新服务，不误报对局进行中", async () => {
  const r = newRoom("123456", "p1", "房主");
  enter(r, "p2", "玩家");
  const legacy = publicView(r, "p1");
  delete legacy.canKick;
  const c = client(async path => response(path === "/api/boards" ? { boards: BOARDS } : legacy));
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  const html = c.viewSettingsDialog();
  assert.match(html, /服务端尚未支持移出玩家/);
  assert.doesNotMatch(html, /对局进行中不能移出玩家/);
  assert.match(html, /data-change="settingsKick" disabled/);
  legacy.canKick = true;
  await c.loadSettings();
  assert.doesNotMatch(c.viewSettingsDialog(), /data-change="settingsKick" disabled/);
});

test("网页围观不显示准备或私密身份，自己的座位可点击站起", () => {
  const r = newRoom("123456", "host", "房主");
  const c = client();
  c.state.room = publicView(r, "host");
  c.state.seats = [{ seat: 1, name: "房主", mine: true, occupied: true }];
  let html = c.viewRoom();
  assert.match(html, /点自己站起/);
  assert.match(html, /data-action="seat" data-seat="1">/);
  command(r, "host", { type: "stand", stage: r.stage });
  c.state.room = publicView(r, "host");
  html = c.viewRoom();
  assert.doesNotMatch(html, /data-action="ready"/);
  assert.doesNotMatch(html, /你在 null/);
  for (let i = 1; i <= 6; i++) {
    enter(r, `p${i}`, `玩家${i}`);
    command(r, `p${i}`, { type: "ready", ready: true, stage: r.stage });
  }
  command(r, "host", { type: "start", stage: r.stage, flexible: true });
  c.state.room = publicView(r, "host");
  html = c.viewRoom();
  assert.doesNotMatch(html, /查看我的身份|data-action="reveal"/);
});
