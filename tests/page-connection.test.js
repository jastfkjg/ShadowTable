const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../miniprogram");
const settle = () => new Promise(setImmediate);
function harness(route = "pages/scores/scores") {
  let now = 10000, next = 0, listener, pages;
  const jobs = new Map(), calls = [], updates = [];
  const page = { route, data: { loading: true }, setData(value) { Object.assign(this.data, value); } };
  pages = [page];
  const clock = { setTimeout(fn, ms) { const id = ++next;jobs.set(id, { fn, at: now + ms });return id; }, clearTimeout(id) { jobs.delete(id); } };
  const wx = { getStorageSync: () => "session", onNetworkStatusChange(fn) { listener = fn; }, offNetworkStatusChange(fn) { if (listener === fn) listener = null; },
    getNetworkType(options) { options.success({ networkType: "wifi" }); },
    request(options) { calls.push(options); }, removeStorageSync() {},
  };
  const cache = new Map();
  function load(file) {
    if (file.endsWith("/config.js")) return { baseUrl: "https://example.test" };
    if (file.endsWith("/connection-feedback.js")) return require(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };cache.set(file, mod);
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module: mod,
      require: name => load(path.resolve(path.dirname(file), name + ".js")), wx,
      Date: { now: () => now, parse: Date.parse }, Math: Object.assign(Object.create(Math), { random: () => 1 }), getCurrentPages: () => pages, ...clock }, { filename: file });
    return mod.exports;
  }
  const connection = load(path.join(root, "page-connection.js")), api = load(path.join(root, "api.js"));
  const release = connection.activate(page, value => updates.push(structuredClone(value)));
  page.load = async () => {
    page.data.loading = true;
    try { return await api.request("/api/me/score-ledger?offset=0"); }
    catch (error) { page.data.error = error.message; }
    finally { page.data.loading = false; }
  };
  return { page, api, connection, calls, updates, jobs, release, last: () => updates.at(-1),
    network(connected) { listener?.({ isConnected: connected }); },
    setPages(value) { pages = value; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, job]) => job.at <= end).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
        if (!due) break;
        now = due[1].at;jobs.delete(due[0]);due[1].fn();await settle();
      }
      now = end;await settle();
    },
  };
}
test("页面实际请求驱动动效、秒数与自动重读；成功后收起且不再更新", async () => {
  const h = harness();
  try {
    const reading = h.page.load();assert.equal(h.last().connectionPhase, "connecting");
    await h.advance(3000);assert.equal(h.last().connectionElapsedSeconds, 3);
    h.calls[0].fail({ errMsg: "request:fail timeout" });await reading;await settle();
    assert.equal(h.last().connectionTitle, "连接超时");assert.equal(h.last().connectionRetrySeconds, 1);
    assert.equal(h.last().connectionPhase, "waiting");assert.equal(h.last().connectionCanRetry, true);
    await h.advance(1000);assert.equal(h.calls.length, 2);assert.equal(h.last().connectionPhase, "connecting");
    h.calls[1].success({ statusCode: 200, data: { records: [] } });await settle();
    assert.equal(h.last().connectionVisible, false);assert.equal(h.jobs.size, 0);
    const count = h.updates.length;await h.advance(30000);assert.equal(h.updates.length, count);
  } finally { h.release(); }
});
test("并行读取部分成功不会掩盖失败；冷却倒计时不能由手动按钮绕过", async () => {
  const h = harness("pages/me/me");
  // The retained home controllers are the owner of their own error visibility.
  const owner = h.page.personalController = { data: { loading: true }, setData(v) { Object.assign(this.data, v); }, load: () => {} };
  h.page.lobbyController = {};h.page.data.activeTab = 1;
  const stop = h.connection.activate(h.page, v => h.updates.push(structuredClone(v)));
  try {
    const a = h.api.request("/api/me/profile"), b = h.api.request("/api/me/stats");
    h.calls[0].success({ statusCode: 429, data: { error: "限流" }, header: { "retry-after": "60" } });
    await assert.rejects(a);h.calls[1].success({ statusCode: 200, data: {} });await b;
    owner.data.loading = false;await settle();
    assert.equal(h.last().connectionTitle, "连接繁忙，请稍候");assert.equal(h.last().connectionCanRetry, false);
    assert.equal(h.last().connectionRetrySeconds, 60);
    await h.connection.retry(h.page);assert.equal(h.calls.length, 2);
    assert.equal(owner.data.connectionVisible, true);
  } finally { stop();h.release(); }
});
test("断网停止计划，恢复网络再读；隐藏页面取消计时、监听及迟到响应", async () => {
  const h = harness();
  const reading = h.page.load();h.calls[0].fail({ errMsg: "request:fail timeout" });await reading;
  h.network(false);assert.equal(h.last().connectionPhase, "offline");assert.equal(h.jobs.size, 0);
  await h.advance(30000);assert.equal(h.calls.length, 1);
  h.network(true);await settle();assert.equal(h.calls.length, 2);
  h.release();assert.equal(h.jobs.size, 0);
  const count = h.updates.length;
  h.calls[1].success({ statusCode: 200, data: {} });await settle();await h.advance(30000);
  assert.equal(h.updates.length, count);assert.equal(h.jobs.size, 0);
});
test("编辑页重连只探测连接，不重复保存、清理或丢弃本地草稿与幂等编号", async () => {
  for (const name of ["profile", "settings", "data-management"]) {
    const h = harness("pages/" + name + "/" + name);
    try {
      const pending = { id: "original-id", data: { nickname: "未保存草稿" } };
      h.page.pending = pending;h.page.data = { loading: false, dirty: true, pendingSave: true };
      h.page.load = () => { throw Error("不得覆盖编辑草稿"); };
      const url = name === "profile" ? "/api/me/profile" : name === "settings" ? "/api/rooms/123456/settings" : "/api/me/record-clearing";
      const writing = h.api.request(url, "POST", pending.data, pending.id);
      h.calls[0].fail({ errMsg: "request:fail timeout" });await assert.rejects(writing);await settle();
      assert.equal(h.last().connectionRetrySeconds, 0);await h.advance(30000);assert.equal(h.calls.length, 1);
      const retry = h.connection.retry(h.page);await settle();
      assert.equal(h.calls[1].method, "GET");assert.match(h.calls[1].url, /\/api\/boards$/);
      h.calls[1].success({ statusCode: 200, data: { boards: [] } });await retry;
      assert.equal(h.page.pending, pending);assert.equal(h.page.data.dirty, true);
      assert.equal(h.calls.filter(call => call.method === "POST").length, 1);
    } finally { h.release(); }
  }
});
test("前一页与预取请求不污染当前页面，牌桌仍由原有幂等重连控制器负责", async () => {
  const h = harness();
  try {
    const reading = h.page.load(), count = h.updates.length;
    h.setPages([{ route: "pages/table/table", data: {} }]);
    h.calls[0].fail({ errMsg: "request:fail timeout" });await reading;await settle();
    assert.equal(h.updates.length, count);assert.equal(h.jobs.size, 0);
    assert.equal(h.connection.begin("/api/rooms/123456"), null);
  } finally { h.release(); }
});
test("写请求失败后等待页面 finally 清除忙碌态，再开放重新连接按钮", async () => {
  const h = harness("pages/profile/profile");
  try {
    h.page.data = { loading:false, busy:true, pendingSave:true };
    const writing = h.api.request("/api/me/profile", "POST", {}, "one-id").catch(() => {}).finally(() => { h.page.data.busy = false; });
    h.calls[0].fail({errMsg:"request:fail timeout"});await writing;
    await h.advance(0);assert.equal(h.last().connectionCanRetry, true);
    assert.equal(h.last().connectionPhase,"waiting");
  } finally { h.release(); }
});
test("战绩页内部切换保留各自失败状态，迟到失败回到原标签后使用公共提示", async () => {
  const h = harness("pages/stats/stats");
  const controller = () => ({data:{loading:true},setData(v){Object.assign(this.data,v);},load(){},retry(){}});
  h.page.statisticsController = controller();h.page.historyController = controller();h.page.data.tab = "records";
  const refresh = value => h.updates.push(structuredClone(value));
  const a = h.connection.activate(h.page, refresh);
  try {
    const reading = h.api.request("/api/me/stats");
    h.page.data.tab = "matches";const b = h.connection.activate(h.page, refresh);
    h.calls[0].fail({errMsg:"request:fail timeout"});await assert.rejects(reading);
    assert.equal(h.page.historyController.data.connectionVisible, undefined);
    h.page.data.tab = "records";const c = h.connection.activate(h.page, refresh);
    assert.equal(h.last().connectionTitle,"连接超时");assert.equal(h.last().connectionRetrySeconds,1);
    c();b();
  } finally { a();h.release(); }
});
test("所有联网入口都登记对应的数据读取，公共组件随导航及匿名分享页复用", () => {
  const routes={scores:"/api/me/score-ledger",stats:"/api/me/stats",matches:"/api/me/matches",shared:"/api/shares/one",leaderboard:"/api/leaderboard?metric=games",monthly:"/api/monthly-report",replay:"/api/me/matches/one/replay","board-details":"/api/boards",help:"/api/scoring/rules",badges:"/api/me/badges",settings:"/api/rooms/123456",profile:"/api/me/profile","data-management":"/api/me/record-clearing","web-login":"/api/web-auth/requests/one/inspect",share:"/api/me/stats"};
  for(const[name,url]of Object.entries(routes)){
    const h=harness("pages/"+name+"/"+name);
    try{const handle=h.connection.begin(url);assert.ok(handle,name);h.connection.finish(handle);}
    finally{h.release();}
  }
  assert.match(fs.readFileSync(path.join(root,"components/app-nav/app-nav.wxml"),"utf8"),/<connection-state/);
  assert.match(fs.readFileSync(path.join(root,"pages/shared/content.wxml"),"utf8"),/<connection-state/);
});
test("切后台后原读取迟到仍能恢复反馈，已被新筛选替换的失败不会覆盖当前结果", async () => {
  const h = harness();
  let resumed;
  try {
    const first = h.page.load();h.release();
    resumed = h.connection.activate(h.page, v => h.updates.push(structuredClone(v)));
    h.calls[0].fail({errMsg:"request:fail timeout"});await first;await h.advance(0);
    assert.equal(h.last().connectionTitle,"连接超时");
    h.page.sequence = 1;const old = h.api.request("/api/me/score-ledger?offset=0");
    h.page.sequence = 2;const fresh = h.api.request("/api/me/score-ledger?offset=0");
    h.calls[2].success({statusCode:200,data:{records:[]}});await fresh;
    h.calls[1].fail({errMsg:"request:fail timeout"});await assert.rejects(old);await h.advance(0);
    assert.equal(h.last().connectionVisible,false);
  } finally { resumed?.();h.release(); }
});
test("设备断网期间没有失败请求，网络恢复后也会安全重读当前页面", async () => {
  const h=harness();
  try {
    h.page.data.loading=false;h.network(false);assert.equal(h.last().connectionPhase,"offline");
    h.network(true);await settle();assert.equal(h.calls.length,1);
    h.calls[0].success({statusCode:200,data:{records:[]}});await settle();await h.advance(0);
    assert.equal(h.last().connectionVisible,false);
  } finally {h.release();}
});
