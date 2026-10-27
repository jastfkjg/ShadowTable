const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const createTable = require("../miniprogram/pages/table/controller");
const feedback = require("../miniprogram/connection-feedback");
const root = path.resolve(__dirname, "../miniprogram");
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const render = data => factory("pages/lobby/lobby.wxml")({ activeTab: 0, lobby: data, personal: {} });
const nodes = node => typeof node !== "object" || !node ? [] : [node, ...(node.children || []).flatMap(nodes)];
const byClass = (tree, name) => nodes(tree).filter(node => String(node.attr?.class || "").split(/\s+/).includes(name));
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const room = { code: "620816", status: "lobby", statusLabel: "待开局", available: true,
  boardName: "阿瓦隆 · 十二骑士", capacity: 12, occupied: 8, seat: 3, peopleLabel: "8 / 12 人已入座" };

test("首次连接先保留状态点与骨架，不立即插入卡片或提前显示空牌桌", () => {
  const tree = render({ ...createTable({ lobby: true }).data });
  assert.equal(byClass(tree, "home-connection").length, 0);
  assert.equal(byClass(tree, "home-room-skeleton").length, 2);
  assert.doesNotMatch(text(tree), /还没有牌桌|立即重试|连接中断/);
  assert.equal(byClass(tree, "connection-button").length, 1);
  assert.match(byClass(tree, "connection-dot")[0].attr.class, /pending/);
  assert.equal(text(byClass(tree, "connection-label")[0]), "同步中");
  assert.equal(byClass(tree, "home-connection-retry").length, 0);
  for (const button of byClass(tree, "home-action")) assert.equal(button.attr.disabled, true);
});

test("弱网与断网保留牌桌正文及复制，只阻止网络操作并标明内容来自上次同步", () => {
  for (const patch of [{ reconnecting: true }, { network: false }]) {
    const tree = render({ ...createTable({ lobby: true }).data, loading: false, serverConnected: false,
      roomsSyncLabel: "21:16", memberRooms: [room], visibleMemberRooms: [room], ...patch });
    assert.match(text(tree), /21:16|已保留内容/);
    assert.match(text(tree), /阿瓦隆 · 十二骑士/);
    assert.match(text(tree), /上次：待开局/);
    assert.doesNotMatch(text(tree), /还没有牌桌|立即重试|连接中断/);
    assert.equal(byClass(tree, "home-room-skeleton").length, 0);
    assert.equal(byClass(tree, "home-connection-retry").length, 1);
    if (patch.reconnecting) {
      assert.match(byClass(tree, "connection-dot")[0].attr.class, /pending/);
      assert.equal(text(byClass(tree, "connection-label")[0]), "等待重连");
    }
    assert.equal(byClass(tree, "room-list-open")[0].attr.disabled, true);
    assert.match(text(byClass(tree, "room-list-open")[0]), /连接后可进入/);
    assert.ok(nodes(tree).some(n => n.attr?.catchtap === "copyListedRoom" && !n.attr.disabled));
    for (const button of byClass(tree, "home-action")) assert.equal(button.attr.disabled, true);
  }
});

test("无缓存重连不声称已保留内容，恢复后空列表与进入按钮使用真实状态", () => {
  const base = { ...createTable({ lobby: true }).data, loading: false };
  const retrying = render({ ...base, reconnecting: true });
  assert.doesNotMatch(text(retrying), /还没有牌桌|已保留/);
  assert.equal(byClass(retrying, "home-room-skeleton").length, 2);
  const ready = render({ ...base, serverConnected: true, roomsSyncLabel: "21:17" });
  assert.match(text(ready), /还没有牌桌/);
  assert.doesNotMatch(text(ready), /已连接牌桌|牌桌已同步|可创建或加入房间|21:17/);
  assert.equal(byClass(ready, "home-connection").length, 0);
  assert.match(byClass(ready, "connection-dot")[0].attr.class, /online/);
  assert.equal(byClass(ready, "connection-label").length, 0);
  assert.equal(byClass(ready, "home-room-skeleton").length, 0);
  assert.equal(byClass(ready, "home-connection-retry").length, 0);
  const refreshing = render({ ...base, roomsRefreshing: true });
  assert.equal(byClass(refreshing, "home-connection").length, 0);
  assert.match(byClass(refreshing, "connection-dot")[0].attr.class, /pending/);
  assert.doesNotMatch(text(refreshing), /正在连接牌桌/);
  for (const button of byClass(ready, "home-action")) assert.equal(button.attr.disabled, false);
  const cached = render({ ...base, serverConnected: true, memberRooms: [room], visibleMemberRooms: [room] });
  assert.doesNotMatch(text(cached), /上次：|已保留内容|连接后可进入/);
  assert.equal(byClass(cached, "room-list-open")[0].attr.disabled, false);
});

test("未确认操作、请求进行中与冷却等待使用明确阶段，牌桌页面复用同一连接反馈", () => {
  const base = { ...createTable({ lobby: true }).data, loading: false, reconnecting: true };
  const data = { ...base, loading: true, hasPendingRequest: true };
  const pending = render({ ...data, ...feedback.present(data, { active: true, startedAt: 0,
    pending: { after: "enter", path: "/api/rooms" } }, 3000) });
  assert.match(text(pending), /正在重新连接|正在找回建房结果|请勿重复创建|已等待 3 秒/);
  assert.doesNotMatch(text(pending), /正在确认提交结果/);
  assert.equal(byClass(pending, "home-connection-retry").length, 0);
  assert.equal(byClass(pending, "home-connection-spinner").length, 1);
  const cooldown = render({ ...base, ...feedback.present(base, { failure: "rate", rateLimitUntil: 60000, retryAt: 60000 }, 0) });
  assert.match(text(cooldown), /连接繁忙|60秒后自动重试/);
  assert.equal(byClass(cooldown, "home-connection-retry")[0].attr.disabled, true);
  const table = factory("pages/table/table.wxml")({ ...base, isLobby: false });
  assert.equal(byClass(table, "home-connection").length, 1);
  assert.match(text(table), /暂时无法连接/);
  assert.doesNotMatch(text(table), /连接中断，正在重连|正在确认提交结果/);
});

function controller(api, { clock, realSchedule = false, lobby = true } = {}) {
  const filename = require.resolve("../miniprogram/pages/table/controller");
  const module = { exports: {} };
  const storage = new Map();
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, require: name => name === "../../api" ? api : require(path.resolve(path.dirname(filename), name)),
    wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: key => storage.delete(key), navigateTo: options => options.complete?.(),
      onNetworkStatusChange() {}, offNetworkStatusChange() {}, hideKeyboard() {} },
    Date: clock?.Date || Date, Math: clock?.Math || Math,
    setTimeout: clock?.setTimeout || setTimeout, clearTimeout: clock?.clearTimeout || clearTimeout,
  });
  const page = module.exports({ lobby });
  Object.assign(page, { alive: true, foreground: true, generation: 0,
    setData(values, callback) { Object.assign(this.data, values); callback?.(); } });
  if (!realSchedule) page.schedule = () => {};
  page.data = structuredClone(page.data);
  return page;
}

const settle = () => new Promise(resolve => setImmediate(resolve));
function fakeClock() {
  let now = 1000000, id = 0;
  const jobs = new Map();
  const math = Object.create(Math); math.random = () => 1;
  return { jobs, Math: math,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    setTimeout(callback, delay) { const key = ++id; jobs.set(key, { callback, at: now + delay }); return key; },
    clearTimeout(key) { jobs.delete(key); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs.entries()].filter(([,job]) => job.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; jobs.delete(next[0]); next[1].callback(); await settle();
      }
      now = end; await settle();
    },
  };
}

test("真实重试计划驱动等待倒计时与请求秒数，手动连接取消旧计划且不会重复发送", async () => {
  const clock = fakeClock(), requests = [];
  const p = controller({ login: async () => {}, request: async url => {
    if (url === "/api/me/profile") return { nickname: "大V", nicknameConfirmed: true };
    return await new Promise((resolve, reject) => requests.push({ resolve, reject }));
  } }, { clock, realSchedule: true });
  p.data.loading = false; p.data.boards = [{}];
  p.handleError(new Error("请求超时"));
  assert.equal(p.data.connectionPhase, "waiting"); assert.equal(p.data.connectionRetrySeconds, 1);
  await clock.advance(1000);
  assert.equal(requests.length, 1); assert.equal(p.data.connectionPhase, "connecting");
  await clock.advance(2500); assert.equal(p.data.connectionElapsedSeconds, 2);
  requests[0].reject(new Error("请求超时")); await settle();
  assert.equal(p.data.connectionTitle, "连接超时"); assert.equal(p.data.connectionPhase, "waiting");
  assert.equal(p.data.connectionElapsedSeconds, 0); assert.equal(p.data.connectionRetrySeconds, 2);
  await clock.advance(1000); assert.equal(p.data.connectionRetrySeconds, 1);
  const manual = p.retryLobbyConnection(); await p.retryLobbyConnection(); await settle();
  assert.equal(requests.length, 2); assert.equal(p.data.connectionElapsedSeconds, 0);
  requests[1].resolve({ rooms: [room] }); await manual;
  assert.equal(p.data.connectionPhase, "idle"); assert.equal(p.data.reconnecting, false);
  assert.equal(clock.jobs.size, 0);
  await clock.advance(15000); assert.equal(requests.length, 2);
});

test("断网停止自动请求，网络恢复立即连接；隐藏和卸载清理计时且不复活旧任务", async () => {
  const clock = fakeClock(); let reads = 0, release;
  const p = controller({ login: async () => {}, request: async url => {
    if (url === "/api/boards") return { boards: require("../server/engine").BOARDS };
    if (url === "/api/me/profile") return { nickname: "大V", nicknameConfirmed: true };
    reads++;
    if (reads > 1) await new Promise(resolve => release = resolve);
    return { rooms: [room] };
  } }, { clock, realSchedule: true });
  await p.onLoad(); assert.equal(p.data.connectionPhase, "idle");
  p.networkListener({ isConnected: false });
  assert.equal(p.data.connectionPhase, "offline"); assert.equal(clock.jobs.size, 0);
  await clock.advance(30000); assert.equal(reads, 1);
  p.networkListener({ isConnected: true }); await settle();
  assert.equal(p.data.connectionPhase, "connecting"); assert.equal(reads, 2);
  await clock.advance(2000); assert.equal(p.data.connectionElapsedSeconds, 2);
  p.onHide(); assert.equal(clock.jobs.size, 0);
  await clock.advance(5000); assert.equal(p.data.connectionElapsedSeconds, 2);
  p.onUnload(); release(); await settle();
  assert.equal(clock.jobs.size, 0);
});

test("未确认建房沿用原请求，读列表成功不能解除写入保护；冷却期不能提前重试", async () => {
  const clock = fakeClock(), posts = [];
  const p = controller({ login: async () => {}, requestId: () => "same-id", request: async (url, method, body, id) => {
    if (method === "POST") {
      posts.push({ body: structuredClone(body), id });
      if (posts.length === 1) throw new Error("请求超时");
      return { code: room.code };
    }
    return { rooms: [room] };
  } }, { clock, realSchedule: true });
  p.data.loading = false; p.data.boards = [{}];
  await p.mutate("/api/rooms", { name: "大V" }, "enter");
  const pending = p.pending, deadline = p.connectionRetryAt;
  await p.loadRooms();
  assert.equal(p.pending, pending); assert.equal(p.data.hasPendingRequest, true);
  assert.equal(p.data.reconnecting, true); assert.equal(p.connectionRetryAt, deadline);
  await p.mutate("/api/rooms", { name: "另一项操作" }, "enter"); assert.equal(posts.length, 1);
  await p.retryLobbyConnection();
  assert.deepEqual(posts, [{ body: { name: "大V" }, id: "same-id" }, { body: { name: "大V" }, id: "same-id" }]);
  assert.equal(p.data.hasPendingRequest, false); assert.equal(p.pending, null); assert.equal(p.data.connectionPhase, "idle");
  p.handleError(Object.assign(new Error("请求太多"), { status: 429, retryAfterMs: 60000 }));
  assert.equal(p.data.connectionCanRetry, false); assert.equal(p.data.connectionRetrySeconds, 60);
  const count = posts.length; await p.retryLobbyConnection(); assert.equal(posts.length, count);
  p.onUnload(); assert.equal(clock.jobs.size, 0);
});

test("牌桌使用实际请求秒数和重试计划，恢复后收起提示并继续原有房间轮询", async () => {
  const clock = fakeClock(), reads = [];
  const p = controller({ request: () => new Promise((resolve, reject) => reads.push({ resolve, reject })) }, { clock, realSchedule: true, lobby: false });
  p.data.loading = false;p.data.boards = [{}];p.roomCode = "123456";
  p.prepareRoomShare = () => {};p.showDealtIdentity = () => false;p.showIdentityHintWhenVisible = () => {};
  try {
    p.handleError(new Error("请求超时"));assert.equal(p.data.connectionPhase, "waiting");
    await clock.advance(1000);assert.equal(p.data.connectionPhase,"connecting");
    await clock.advance(2000);assert.equal(p.data.connectionElapsedSeconds,2);
    reads[0].reject(new Error("请求超时"));await settle();
    assert.equal(p.data.connectionTitle,"连接超时");assert.equal(p.data.connectionRetrySeconds,2);
    const retry = p.retryLobbyConnection();await settle();
    const fixtures=require("./helpers/replay-fixtures"),source=fixtures.setup();
    reads[1].resolve(require("../server/engine").publicView(source,"wx:replay-1"));await retry;
    assert.equal(p.data.connectionPhase,"idle");assert.equal(p.data.reconnecting,false);
    assert.ok(clock.jobs.size > 0, "连接恢复后保留正常牌桌轮询");
  } finally { p.onHide();p.onUnload();assert.equal(clock.jobs.size,0); }
});
test("大厅和牌桌首次加载延迟500毫秒，短请求无卡片，主动重连立即显示", async () => {
  for(const lobby of [true,false]){
    const clock=fakeClock(),p=controller({}, {clock,realSchedule:true,lobby});
    try{
      const first=p.beginConnectionAttempt();assert.equal(p.data.connectionDeferred,true);
      await clock.advance(499);assert.equal(p.data.connectionDeferred,true);
      await clock.advance(1);assert.equal(p.data.connectionDeferred,false);
      p.setData({loading:false});p.finishConnectionAttempt(first);p.schedule();
      assert.equal(p.data.connectionPhase,"idle");
      const manual=p.beginConnectionAttempt(true);assert.equal(p.data.connectionDeferred,false);
      assert.equal(p.data.connectionPhase,"connecting");p.finishConnectionAttempt(manual);p.schedule();
    }finally{p.onHide();p.onUnload();assert.equal(clock.jobs.size,0);}
  }
});

test("读列表失败保留数据与同步时间，手动重试合并并发且成功后恢复入口", async () => {
  let reads = 0, release;
  const p = controller({ login: async () => {}, request: async url => {
    if (url === "/api/me/profile") return { nickname: "子龙", nicknameConfirmed: true, version: 1 };
    assert.equal(url, "/api/me/rooms");
    reads++;
    if (reads > 1) await new Promise(resolve => release = resolve);
    return { rooms: [room], serverTime: new Date(2026, 9, 26, 21, reads === 1 ? 16 : 17).getTime() };
  } });
  p.data.loading = false; p.data.boards = [{}];
  await p.loadRooms();
  const saved = p.data.memberRooms;
  assert.equal(p.data.roomsSyncLabel, "21:16");
  p.handleError(new Error("timeout"));
  assert.equal(p.data.memberRooms, saved);
  assert.equal(p.data.roomsSyncLabel, "21:16");
  const recovering = p.retryLobbyConnection();
  await p.retryLobbyConnection();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
  assert.equal(p.data.loading, true);
  release(); await recovering;
  assert.equal(p.data.roomsSyncLabel, "21:17");
  assert.equal(p.data.reconnecting, false);
  assert.equal(p.data.loading, false);
  assert.equal(p.data.serverConnected, true);
});

test("重连阻止卡片空白与快捷入口绕过禁用状态，手动重试保留登录与冷却约束", async () => {
  const p = controller({});
  p.data.loading = false;
  for (const patch of [{ reconnecting: true }, { network: false }, { needsLogin: true }]) {
    Object.assign(p.data, { reconnecting: false, network: true, needsLogin: false, ...patch });
    p.mutate = () => assert.fail("不应提交新操作");
    await p.openRoom({ currentTarget: { dataset: { code: room.code } } });
    p.switchEntry({ currentTarget: { dataset: { mode: "join" } } });
    assert.equal(p.data.entrySheet, false);
    assert.equal(p.data.enteringCode, undefined);
  }
  let retries = 0;
  p.retry = async () => { retries++; };
  p.data.needsLogin = true;
  await p.retryLobbyConnection();
  assert.equal(retries, 1);
  p.data.needsLogin = false;
  p.rateLimitUntil = Date.now() + 60000;
  await p.retryLobbyConnection();
  assert.equal(retries, 1);
});
