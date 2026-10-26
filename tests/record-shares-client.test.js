const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const fixtures = require("./helpers/record-share-fixtures");
const { present } = require("../miniprogram/shared-record-view");
const root = path.resolve(__dirname, "../miniprogram");
function client({ single = false, publicRead, create } = {}) {
  let definition, logins = 0, requests = 0, menu = 0;
  const wx = {
    getEnterOptionsSync: () => ({ scene: single ? 1154 : 1001 }),
    getStorageSync() { throw Error("公开分享不得读登录存储"); },
    request(options) { requests++; assert.equal(options.header, undefined); publicRead ? publicRead(options) : options.success({ statusCode: 200, data: fixtures.stats }); },
    showShareMenu() { assert.equal(single, false); menu++; }, hideShareMenu() {}, setNavigationBarTitle() {}, navigateTo() {},
  };
  const api = { assetUrl: value => "https://test.invalid" + value,
    login: async () => { logins++; }, request: async (url, method, selection) => { assert.equal(url, "/api/me/shares"); assert.equal(method, "POST"); return create ? create(selection) : fixtures[selection.kind]; } };
  function load(file) {
    if (file === path.join(root, "api.js")) return api;
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module: mod, require: name => load(path.resolve(path.dirname(file), name + ".js")), wx, Page: value => definition = value, setTimeout, clearTimeout }, { filename: file });
    return mod.exports;
  }
  load(path.join(root, "pages/shared/shared.js"));
  const p = { ...definition, data: structuredClone(definition.data), setData: function(values) { Object.assign(this.data, values); } };
  return { p, wx, logins: () => logins, requests: () => requests, menus: () => menu };
}
test("朋友圈和好友分享链接匿名读取同一快照，不登录、不碰登录存储", async () => {
  for (const single of [true, false]) {
    const c = client({ single });
    try {
      await c.p.onLoad({ share: fixtures.stats.id });
      assert.equal(c.logins(), 0); assert.equal(c.requests(), 1);
      assert.equal(c.p.data.sharedRecord.name, "子龙"); assert.equal(c.p.data.sharedRecord.hero, "52.6");
      assert.equal(c.p.data.authoring, false);
      assert.equal(c.p.onShareAppMessage().path, "/pages/shared/shared?share=" + fixtures.stats.id);
      assert.equal(c.p.onShareTimeline().query, "share=" + fixtures.stats.id);
      assert.equal(c.menus(), single ? 0 : 1);
    } finally { c.p.onUnload(); }
  }
});
test("创建后才开放分享，未准备好不开放菜单，失败可重试且保留原选择", async () => {
  let finish, fail = true;
  const c = client({ create: selection => new Promise((resolve, reject) => { finish = () => fail ? reject(Error("网络中断")) : resolve(fixtures[selection.kind]); }) });
  try {
    const loading = c.p.onLoad({ kind: "fun", metric: "merlin_evade", mode: "knights" });
    await new Promise(resolve => setImmediate(resolve));assert.equal(c.menus(), 0);assert.equal(c.p.data.loading, true);
    finish();await loading;assert.match(c.p.data.error, /网络中断/);assert.equal(c.menus(), 0);
    fail = false;const retry = c.p.retrySharedRecord();await new Promise(resolve => setImmediate(resolve));finish();await retry;
    assert.equal(c.p.data.sharedRecord.hero, "3"); assert.equal(c.menus(), 1);
    assert.equal(c.p.onShareTimeline().query, "share=" + fixtures.fun.id);
    assert.equal(c.p.data.posterAvailable, false);
  } finally { c.p.onUnload(); }
});
test("读取失败可重试，卸载后的迟到响应不更新页面或打开分享菜单", async () => {
  let pending;
  const c = client({ publicRead: options => { pending = options; } });
  let loading = c.p.onLoad({ share: fixtures.stats.id });
  pending.success({ statusCode: 404, data: { error: "分享不存在" } });await loading;
  assert.match(c.p.data.error, /分享不存在/);assert.equal(c.menus(), 0);
  loading = c.p.retrySharedRecord();const before = structuredClone(c.p.data);c.p.onUnload();
  pending.success({ statusCode: 200, data: fixtures.stats });await loading;
  assert.deepEqual(c.p.data, before);assert.equal(c.menus(), 0);
});
test("离开页面后迟到的分享读取不能更改当前页菜单，返回后再恢复", async () => {
  let pending;
  const c = client({ publicRead: options => { pending = options; } });
  try {
    const loading = c.p.onLoad({share:fixtures.stats.id});c.p.onHide();
    pending.success({statusCode:200,data:fixtures.stats});await loading;
    assert.equal(c.menus(),0);assert.equal(c.p.data.sharedRecord.name,"子龙");
    c.p.onShow();assert.equal(c.menus(),1);
  } finally {c.p.onUnload();}
});
test("无效或缺失分享令牌不请求、不登录，单页不能通过 kind 参数读取自己的资料", async () => {
  for (const options of [{}, { share: "bad" }, { kind: "stats" }]) {
    const c = client({ single: true });
    try {
      await c.p.onLoad(options);
      assert.match(c.p.data.error, /分享链接无效/);assert.equal(c.requests(), 0);assert.equal(c.logins(), 0);
    } finally { c.p.onUnload(); }
  }
});
test("展示零次数、零胜率和负积分，日期使用北京时间且不受运行环境时区影响", () => {
  const stats = structuredClone(fixtures.stats);stats.data.winRate = 0;stats.data.scoreMonth = -3;
  const view = present(stats);
  assert.equal(view.hero, "0");assert.equal(view.metrics[2].value, "-3");assert.equal(view.metrics[2].label, "10月积分");
  assert.equal(view.asOf, "2026.10.26 18:00");
  const fun = structuredClone(fixtures.fun);fun.data.count = 0;fun.data.rate = 0;
  assert.equal(present(fun).hero, "0");assert.equal(present(fun).metrics[0].value, "0%");
  const match = structuredClone(fixtures.match);match.data.score = 0;
  assert.equal(present(match).metrics[1].value, "+0");
  match.data.events[0].round=null;
  assert.equal(present(match).events[0].round,"任务结果");
});
test("访客模板仅展示分享内容，没有打开按钮、本人操作或虚构的过程", () => {
  const context = { window: {}, global: {}, console };vm.createContext(context);
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  for (const snapshot of Object.values(fixtures)) {
    const text = JSON.stringify(factory("pages/shared/shared.wxml")({ loading: false, error: "", sharedRecord: present(snapshot), authoring: false }));
    assert.match(text, /子龙/);assert.match(text, /数据截至/);
    assert.doesNotMatch(text, /打开桌边助手|sharedPoster|生成成绩图片|records-tabs/);
  }
  const empty = structuredClone(fixtures.match);empty.data.events = [];
  const text = JSON.stringify(factory("pages/shared/shared.wxml")({ sharedRecord: present(empty) }));
  assert.match(text, /没有保存可分享的过程/);assert.doesNotMatch(text, /刺杀未命中/);
});
