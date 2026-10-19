const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createGrantNotifier } = require("../miniprogram/avoidance");

function notifier(overrides = {}) {
  const state = { account: "one", safe: true, value: { balance: 5, notice: { through: "grant-one", amount: 3, grants: 2 } }, shown: [], acked: [], timers: new Map() };
  let id = 0;
  const instance = createGrantNotifier({
    account: () => state.account, canShow: () => state.safe,
    read: async () => state.value,
    show: async value => { state.shown.push(value); return true; },
    ack: async through => { state.acked.push(through); state.value = { ...state.value, notice: null }; },
    setTimeout: callback => { state.timers.set(++id, callback); return id; },
    clearTimeout: key => state.timers.delete(key), ...overrides,
  });
  return { instance, state };
}

test("通知合并为弹窗、包含可用余额与用法，只在确认后标记已读", async () => {
  let finish;
  const { instance, state } = notifier({ show: value => { state.shown.push(value); return new Promise(resolve => finish = resolve); } });
  const job = instance.start();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.shown.length, 1); assert.equal(state.shown[0].title, "收到回避卡");
  assert.match(state.shown[0].content, /累计.*3 张/); assert.match(state.shown[0].content, /当前可用 5 张/);
  assert.match(state.shown[0].content, /生效才扣卡/); assert.deepEqual(state.acked, []);
  finish(true); await job;
  assert.deepEqual(state.acked, ["grant-one"]);
  await instance.check(); assert.equal(state.shown.length, 1);
  instance.stop(); assert.equal(state.timers.size, 0);
});
test("关键交互期间暂缓，恢复后弹窗；后台取消或未确认不丢通知", async () => {
  let confirmed = false;
  const { instance, state } = notifier({ show: async value => { state.shown.push(value); return confirmed; } });
  state.safe = false; await instance.start(); assert.equal(state.shown.length, 0);
  state.safe = true; await instance.check(); assert.equal(state.shown.length, 1); assert.equal(state.acked.length, 0);
  confirmed = true; await instance.check(); assert.equal(state.shown.length, 2); assert.equal(state.acked.length, 1);
  instance.stop();
});
test("已确认但确认请求断网时只重试确认，不重复弹窗；切换账号不确认其他账号通知", async () => {
  let failures = 1;
  const { instance, state } = notifier({ ack: async through => { if (failures-- > 0) throw Error("offline"); state.acked.push(through); state.value.notice = null; } });
  await instance.start(); assert.equal(state.shown.length, 1); assert.equal(state.acked.length, 0);
  await instance.check(); assert.equal(state.shown.length, 1); assert.deepEqual(state.acked, ["grant-one"]);
  instance.stop();
  let read;
  const other = notifier({ read: () => new Promise(resolve => read = resolve) });
  const pending = other.instance.start(); other.state.account = "two"; read(other.state.value); await pending;
  assert.equal(other.state.shown.length, 0); assert.equal(other.state.acked.length, 0); other.instance.stop();
});
test("切后台后晚到的读取不显示，账号重新进入时仍能提醒", async () => {
  let read;
  const { instance, state } = notifier({ read: () => new Promise(resolve => read = resolve) });
  const first = instance.start(); instance.stop(); read(state.value); await first;
  assert.equal(state.shown.length, 0); assert.equal(state.timers.size, 0);
  const next = instance.start(); read(state.value); await next;
  assert.equal(state.shown.length, 1); instance.stop();
});
test("小程序使用共享弹窗与卡片图标，对局和正在编辑的面板不被通知打断", async () => {
  const data = { isLobby: true }, controller = { alive: true, foreground: true, data, setData: patch => Object.assign(data, patch) };
  const host = { route: "pages/lobby/lobby", data: { activeTab: 0 }, lobbyController: controller, selectComponent: () => ({}) };
  let options, shown;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../miniprogram/avoidance-notices"), "utf8"), {
    module, getCurrentPages: () => [host], wx: { getStorageSync: () => "session" },
    require: name => name === "./avoidance" ? { createGrantNotifier: value => { options = value; return value; } } : name === "./dialog" ? { show: async value => { shown = value; return { confirm: true }; } } : { request() {} },
  });
  module.exports.create(); assert.equal(options.canShow(), true);
  for (const key of ["entrySheet", "monthlyReset", "avoidanceOpen", "playerCard", "actionDialog"]) { data[key] = {}; assert.equal(options.canShow(), false, key); delete data[key]; }
  data.room = { phase: "vote" }; assert.equal(options.canShow(), false);
  data.room.phase = "lobby"; assert.equal(options.canShow(), true);
  await options.show({ title: "收到回避卡", content: "获得3张", amount: 3 });
  assert.equal(shown.showCancel, false); assert.equal(shown.confirmText, "知道了"); assert.equal(shown.contextIcon, "/assets/table-cards.svg");
  assert.equal(controller.grantNoticeOpen, false);
});
