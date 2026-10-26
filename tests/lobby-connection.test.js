const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const createTable = require("../miniprogram/pages/table/controller");
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

test("首次连接只显示一个连接状态，无缓存时使用骨架且不提前显示空牌桌", () => {
  const tree = render({ ...createTable({ lobby: true }).data });
  assert.equal(text(tree).split("正在连接牌桌").length - 1, 1);
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
      assert.equal(text(byClass(tree, "connection-label")[0]), "同步中");
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

test("未确认提交、重试中及请求冷却沿用一个提示区，牌桌页面仍保留原有连接反馈", () => {
  const base = { ...createTable({ lobby: true }).data, loading: false, reconnecting: true };
  const pending = render({ ...base, hasPendingRequest: true });
  assert.match(text(pending), /正在确认提交结果|请勿重复提交/);
  const retrying = render({ ...base, loading: true });
  assert.equal(byClass(retrying, "home-connection-retry")[0].attr.disabled, true);
  assert.match(text(byClass(retrying, "home-connection-retry")[0]), /重试中/);
  const cooldown = render({ ...base, notice: "请求较多，冷却后会自动刷新" });
  assert.equal(text(cooldown).split("请求较多，冷却后会自动刷新").length - 1, 1);
  const table = factory("pages/table/table.wxml")({ ...base, isLobby: false });
  assert.equal(byClass(table, "home-connection").length, 0);
  assert.match(text(table), /连接中断，正在重连/);
});

function controller(api) {
  const filename = require.resolve("../miniprogram/pages/table/controller");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, require: name => name === "../../api" ? api : require(path.resolve(path.dirname(filename), name)),
    wx: { getStorageSync() {}, hideKeyboard() {} }, setTimeout, clearTimeout,
  });
  const page = module.exports({ lobby: true });
  Object.assign(page, { alive: true, foreground: true, generation: 0, schedule() {},
    setData(values, callback) { Object.assign(this.data, values); callback?.(); } });
  page.data = structuredClone(page.data);
  return page;
}

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
