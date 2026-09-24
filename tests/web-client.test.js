const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { newRoom, enter, command, publicView, BOARDS } = require("../server/engine");

function client(fetch) {
  let scheduled;
  const scrolls = [], lookups = [];
  const element = { focus() {}, scrollIntoView(options) { scrolls.push(options); }, addEventListener() {}, hidden: true, classList: { add() {}, remove() {} } };
  const source = fs.readFileSync(require.resolve("../server/web/app.js"), "utf8");
  const context = {
    document: { hidden: false, getElementById: id => { lookups.push(id); return element; }, addEventListener() {} },
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
    window.test = { state, schedule, loadSettings, settingsSave, CHANGES, ACTIONS, viewActionDialog, refresh, viewRoom, viewHostBar, viewSettingsDialog, kickFromSettings, sendKick,
      setConfirm(fn) { confirm = fn; },
      setRefresh(fn) { refresh = fn; },
      stop() { foreground = false; }
    };
  })();`, context);
  return { ...context.window.test, scrolls, lookups, scheduled: () => scheduled };
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


test("旧服务缺少移出权限时提示不支持，不误报对局进行中", async () => {
  const r = newRoom("123456", "p1", "房主");
  enter(r, "p2", "玩家");
  const legacy = publicView(r, "p1");
  delete legacy.canKick;
  const c = client(async path => response(path === "/api/boards" ? { boards: BOARDS } : legacy));
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  const html = c.viewSettingsDialog();
  assert.match(html, /暂不支持移出玩家/);
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

test("网页普通玩家看到湖仙座位标记，传递刷新后移动，关闭后消失", async () => {
  const r = newRoom("123456", "p1", "房主", "classic", 8);
  for (let i = 2; i <= 8; i++) enter(r, `p${i}`, `玩家${i}`);
  const run = (uid, type, data = {}) => command(r, uid, { type, stage: r.stage, ...data });
  r.players.forEach(p => run(p.uid, "ready", { ready: true }));
  run("p1", "start", { flexible: true });
  r.fairy.fairy = 1;
  const c = client(async () => response(publicView(r, "p2")));
  c.state.room = publicView(r, "p2");
  await c.refresh();
  const seats = html => [...html.matchAll(/<button[^>]*data-action="seat"[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.match(seats(c.viewRoom())[0], /seat-fairy/);
  assert.equal(seats(c.viewRoom()).filter(s => s.includes("seat-fairy")).length, 1);
  run("p1", "beginActivity", { kind: "fairy" });
  run("p1", "submit", { value: "target:2" });
  await c.refresh();
  assert.match(seats(c.viewRoom())[1], /seat-fairy/);
  assert.doesNotMatch(seats(c.viewRoom())[0], /seat-fairy/);
  run("p1", "updateSettings", { board: r.board, capacity: 8, visible: false, fairyEnabled: false });
  await c.refresh();
  assert.doesNotMatch(c.viewRoom(), /seat-fairy/);
});

test("网页人数、板子及开关更改即保存，成功后保留表单且无底部保存按钮", async () => {
  const r = newRoom("123456", "host", "房主", "classic", 7);
  const writes = [];
  const c = client(async (path, options) => {
    if (options?.method === "POST") {
      const data = JSON.parse(options.body);
      writes.push(data);
      command(r, "host", data);
      return response({ accepted: true });
    }
    return response(path === "/api/boards" ? { boards: BOARDS } : publicView(r, "host"));
  });
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  await c.CHANGES.settingsCapacity({ value: "10" });
  assert.equal(r.capacity, 10);
  assert.equal(c.state.settings.fairyEnabled, true);
  await c.CHANGES.settingsBoard({ value: "knights-10" });
  assert.equal(r.board, "knights-10");
  await c.CHANGES.settingsFairy({ checked: false });
  assert.equal(r.fairyEnabled, false);
  await c.CHANGES.settingsVisibility({ checked: true });
  assert.equal(writes.length, 4);
  assert.equal(c.state.settings.visible, true);
  assert.equal(c.state.settings.dirty, false);
  assert.equal(c.state.settings.loading, false);
  assert.equal(c.state.settings.busy, false);
  const html = c.viewSettingsDialog();
  assert.doesNotMatch(html, /data-action="settingsSave"|7人局默认|开启后公开|任意阶段均可移交|选择玩家后需确认/);
});

test("网页自动保存失败保留原请求重试，未确认时禁止再次修改", async () => {
  const r = newRoom("123456", "host", "房主", "classic", 8);
  const writes = [];
  let fail = true;
  const c = client(async (path, options) => {
    if (options?.method === "POST") {
      writes.push({ data: options.body, id: options.headers["Idempotency-Key"] });
      if (fail) throw new Error("网络中断");
      command(r, "host", JSON.parse(options.body));
      return response({ accepted: true });
    }
    return response(path === "/api/boards" ? { boards: BOARDS } : publicView(r, "host"));
  });
  c.state.showRoomSettings = true;
  c.state.settings = { busy: false };
  await c.loadSettings();
  await c.CHANGES.settingsFairy({ checked: false });
  assert.equal(c.state.settings.pendingSave, true);
  assert.match(c.viewSettingsDialog(), /重试保存/);
  await c.CHANGES.settingsFairy({ checked: true });
  assert.equal(c.state.settings.fairyEnabled, false);
  assert.equal(writes.length, 1);
  fail = false;
  await c.settingsSave();
  assert.deepEqual(writes[1], writes[0]);
  assert.ok(writes[0].id);
  assert.equal(c.state.settings.pendingSave, false);
  assert.equal(c.state.settings.error, "");
});

test("结果图标、记录时间与最近转换可见；座位可收起，记录从三条展开", async () => {
  const r = newRoom("123456", "host", "房主", "classic", 8);
  r.phase = "tools";
  r.history = [
    { kind: "toolQuest", number: 1, team: [1, 3], fails: 1, success: false },
    { kind: "toolQuest", number: 2, team: [1, 3], fails: 0, success: true },
    { kind: "toolVote", number: 3, team: [1, 4], approved: true, votes: [{ seat: 1, approve: true }], startedAt: new Date(2026, 8, 21, 23, 38).getTime() },
    { kind: "variant", resultType: "conversion", text: "本轮阵营转换", startedAt: new Date(2026, 8, 21, 23, 40).getTime() },
  ];
  const c = client(async () => response(publicView(r, "host")));
  await c.refresh();
  assert.equal(c.state.latestResult.text, "本轮阵营转换");
  assert.equal(c.state.history[2].resultTone, "success");
  assert.equal(c.state.history[0].resultTone, "failure");
  assert.equal(c.state.history[2].timeLabel, "23:38");
  assert.equal(c.state.history[0].timeLabel, "");
  let html = c.viewRoom();
  assert.match(html, /公开记录 · 共4条/);
  assert.match(html, /第1次 · × 失败/);
  assert.equal((html.match(/class="history-row"/g) || []).length, 3);
  assert.match(html, /展开更早的 1 条记录/);
  c.ACTIONS.toggleHistory();
  html = c.viewRoom();
  assert.equal((html.match(/class="history-row"/g) || []).length, 4);
  assert.ok(html.indexOf("#4") < html.indexOf("#1"));
  c.ACTIONS.toggleSeats();
  assert.doesNotMatch(c.viewRoom(), /class="seats"/);
  c.ACTIONS.toggleSeats();
  assert.match(c.viewRoom(), /class="seats"/);
  c.state.room = { ...c.state.room, phase: "teamVote", team: [1, 4], needsSubmission: true };
  c.state.actionDialog = true;
  c.state.actionLabel = "是否同意这支队伍？";
  assert.match(c.viewActionDialog(), /任务队伍：1、4号/);
});

test("网页仙女关闭需确认，取消保留结果，等待确认时新结果不被旧确认清除", async () => {
  const c = client(async () => { throw new Error("不应提交"); });
  const result = { revision: 1, summary: "6号 · 坏人" };
  c.state.fairyResult = result;
  c.state.fairyResultRevealed = true;
  c.setConfirm(async (title, text) => { assert.match(text, /关闭后不会再显示/); return false; });
  await c.ACTIONS.acknowledgeFairyResult();
  assert.equal(c.state.fairyResult, result);
  c.setConfirm(async () => { c.state.fairyResult = { revision: 2 }; return true; });
  await c.ACTIONS.acknowledgeFairyResult();
  assert.equal(c.state.fairyResult.revision, 2);
});

test("网页阶段集中待办，房主工具与任务进度优先，最近结果仅展示公开数据", async () => {
  const room = newRoom("123456", "p1", "房主");
  const run = (uid, type, extra = {}) => command(room, uid, { type, stage: room.stage, ...extra });
  for (let i = 2; i <= 6; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach(p => run(p.uid, "ready", { ready: true }));
  run("p1", "start", { flexible: true });
  run("p1", "beginActivity", { kind: "quest", team: [2], threshold: 1 });
  run("p2", "submit", { value: "success" });
  const c = client(async () => response(publicView(room, "p1")));
  await c.refresh();
  let html = c.viewRoom();
  assert.equal((html.match(/等待房主发起操作/g) || []).length, 1);
  assert.ok(html.indexOf('data-action="openTool"') < html.indexOf('data-action="toggleSeats"'));
  assert.ok(html.indexOf("任务进度") < html.indexOf('data-action="toggleSeats"'));
  c.ACTIONS.showLatestRecord();
  assert.equal(c.lookups.at(-1), "history-record-" + c.state.latestResult.key);
  assert.equal(c.scrolls.length, 1);
  assert.equal(c.state.focusedHistoryKey, c.state.latestResult.key);
  run("p1", "beginActivity", { kind: "vote" });
  await c.refresh();
  html = c.viewRoom();
  assert.ok(html.indexOf('data-action="openAction"') < html.indexOf('class="latest-result"'));
  assert.match(html, /class="primary" data-action="openAction"/);
});

test("网页断网或等待请求时仍可立即遮盖身份", async () => {
  const c = client();
  c.state.room = publicView(newRoom("123456", "p1", "房主"), "p1");
  c.state.room.phase = "tools";
  c.state.revealed = true;
  c.state.secret = { role: "私密身份", information: "私密视野" };
  c.state.busy = true;
  c.state.network = false;
  assert.match(c.viewRoom(), /data-action="reveal">立即遮盖/);
  await c.ACTIONS.reveal();
  assert.equal(c.state.revealed, false);
  assert.doesNotMatch(c.viewRoom(), /私密身份|私密视野/);
});

test("查看结果定位更早的公开记录，并展开被折叠的目标", () => {
  const c = client();
  c.state.history = [0, 1, 2, 3, 4].map(key => ({ key, text: "公开记录" }));
  c.state.latestResult = c.state.history[0];
  c.ACTIONS.showLatestRecord();
  assert.equal(c.state.historyExpanded, true);
  assert.equal(c.state.focusedHistoryKey, 0);
  assert.equal(c.lookups.at(-1), "history-record-0");
  assert.equal(c.scrolls[0].block, "start");
});

test("网页猎人技能三选一后只显示该模式号码，返回及阶段变化清除草稿", async () => {
  const options = [{value: "pass", label: "不使用技能"}, {value: "detonate:1", label: "自爆并开枪1号"}, {value: "detonate:11", label: "自爆并开枪11号"}, {value: "passive:5", label: "出局时向5号开枪"}];
  const c = client(async () => response({stage: "s1", action: {hunterModes: true, choices: options.map(o => o.value), options}}));
  c.state.room = {code: "123456", stage: "s1", phase: "skillPrepare", needsSubmission: true, me: {submitted: false}};
  await c.ACTIONS.openAction();
  assert.deepEqual(Array.from(c.state.actionChoices, o => o.label), ["主动技能", "被动技能", "不使用技能"]);
  c.ACTIONS.submitChoice({dataset: {value: "mode:detonate"}});
  assert.deepEqual(Array.from(c.state.actionChoices, o => o.value), ["detonate:1", "detonate:11", "mode:"]);
  assert.match(c.viewActionDialog(), /第 2 步：选择相邻一人/);
  c.ACTIONS.submitChoice({dataset: {value: "mode:"}});
  c.ACTIONS.submitChoice({dataset: {value: "mode:passive"}});
  assert.deepEqual(Array.from(c.state.actionChoices, o => o.value), ["passive:5", "mode:"]);
  c.ACTIONS.closeAction();
  assert.equal(c.state.hunterChoices.length, 0);
  assert.equal(c.state.hunterMode, "");
});
