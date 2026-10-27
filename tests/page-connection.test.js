const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../miniprogram");
const { harness, settle } = require("./helpers/connection-client");
test("首次读取在500毫秒内完成从不显示卡片，隐藏与卸载会取消延迟展示", async () => {
  for (const hide of [false, true]) {
    const h = harness();
    try {
      const reading = h.page.load();await h.advance(350);
      assert.equal(h.last().connectionVisible,false);assert.equal(h.last().connectionInitialLoading,true);
      if(hide)h.release();
      h.calls[0].success({statusCode:200,data:{records:[]}});await reading;await h.advance(1000);
      assert.ok(h.updates.every(value => !value.connectionVisible));assert.equal(h.jobs.size,0);
    } finally {h.release();}
  }
});
test("首次读取切后台后再返回，完成时不会重新闪出已取消的加载提示", async () => {
  const h=harness();let resumed;
  try{
    const reading=h.page.load();await h.advance(250);h.release();await h.advance(1000);
    resumed=h.connection.activate(h.page,v=>h.updates.push(structuredClone(v)));
    h.calls[0].success({statusCode:200,data:{records:[]}});await reading;await h.advance(0);
    assert.ok(h.updates.every(v=>!v.connectionVisible));assert.equal(h.jobs.size,0);
  }finally{resumed?.();h.release();}
});
test("已有可用内容时，即使刷新较慢也保持静默；真实失败立即切换异常反馈", async () => {
  const h = harness();
  try {
    h.page.data.loaded=true;h.page.data.records=[];
    const reading=h.page.load();await h.advance(3000);
    assert.ok(h.updates.every(value=>!value.connectionVisible));assert.equal(h.jobs.size,0);
    h.calls[0].fail({errMsg:"request:fail timeout"});await reading;await h.advance(0);
    assert.equal(h.last().connectionVisible,true);assert.equal(h.last().connectionTitle,"连接超时");
  }finally{h.release();}
});
test("连续与并行接口共用一次首次加载，秒数不重置、卡片不反复开关", async () => {
  const h=harness();
  try {
    const first=h.api.request("/api/me/score-ledger?stage=1");await h.advance(700);
    assert.equal(h.last().connectionVisible,true);
    h.calls[0].success({statusCode:200,data:{}});await first;
    const a=h.api.request("/api/me/score-ledger?stage=2"),b=h.api.request("/api/me/score-ledger?stage=3");
    await h.advance(1300);assert.equal(h.last().connectionElapsedSeconds,2);
    h.calls[1].success({statusCode:200,data:{}});await a;
    assert.equal(h.last().connectionVisible,true);
    h.calls[2].success({statusCode:200,data:{}});await b;h.page.data.loading=false;await h.advance(0);
    const visible=h.updates.map(v=>v.connectionVisible),start=visible.indexOf(true),end=visible.lastIndexOf(true);
    assert.ok(visible.slice(start,end+1).every(Boolean));assert.equal(h.last().connectionVisible,false);
  } finally {h.release();}
});
test("健康连接主动重新连接立即反馈，不受首次加载延迟影响", async () => {
  const h=harness();
  try{
    h.page.data.loaded=true;const retry=h.connection.retry(h.page);await settle();
    assert.equal(h.last().connectionVisible,true);assert.equal(h.last().connectionElapsedSeconds,0);
    h.calls[0].success({statusCode:200,data:{}});await retry;await h.advance(0);
    assert.equal(h.last().connectionVisible,false);
  }finally{h.release();}
});
test("从战绩返回我的时实际控制器静默刷新，保留资料战绩直到新数据到达", async () => {
  const h=harness("pages/me/me"),definition=h.loadModule(path.join(root,"pages/me/controller.js"))();
  const owner={...definition,data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};
  const profile={nickname:"子龙",displayName:"子龙",identityType:"wx",initial:"子"};
  const stats={total:19,wins:10,losses:9,winRate:52.6,byFaction:[],byBoard:[],recent:[],score:{total:35,month:35}};
  Object.assign(owner.data,{profile,stats,loading:false});owner.onLoad();
  h.page.lobbyController={};h.page.personalController=owner;h.page.data.activeTab=1;
  const stop=h.connection.activate(h.page,value=>h.updates.push(structuredClone(value)));
  try{
    const reading=owner.onShow();await settle();await h.advance(3000);
    assert.equal(owner.data.profile,profile);assert.equal(owner.data.stats,stats);
    assert.ok(h.updates.every(value=>!value.connectionVisible));
    for(const request of h.calls){const data=request.url.endsWith('/profile')?{...profile,version:2}:request.url.endsWith('/stats')?{...stats,total:20}:{rooms:[],records:[],total:0};request.success({statusCode:200,data});}
    await reading;await h.advance(0);
    assert.equal(owner.data.stats.total,20);assert.ok(h.updates.every(value=>!value.connectionVisible));
  }finally{stop();h.release();owner.onUnload();}
});
test("页面实际请求驱动动效、秒数与自动重读；成功后收起且不再更新", async () => {
  const h = harness();
  try {
    const reading = h.page.load();assert.equal(h.last().connectionVisible, false);
    await h.advance(500);assert.equal(h.last().connectionPhase, "connecting");
    await h.advance(2500);assert.equal(h.last().connectionElapsedSeconds, 3);
    h.calls[0].fail({ errMsg: "request:fail timeout" });await reading;await settle();
    assert.equal(h.last().connectionTitle, "连接超时");assert.equal(h.last().connectionRetrySeconds, 1);
    assert.equal(h.last().connectionPhase, "waiting");assert.equal(h.last().connectionCanRetry, true);
    await h.advance(1000);assert.equal(h.calls.length, 2);assert.equal(h.last().connectionPhase, "connecting");
    h.calls[1].success({ statusCode: 200, data: { records: [] } });await settle();await h.advance(0);
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
  h.network(false);await h.advance(0);assert.equal(h.last().connectionPhase, "offline");assert.equal(h.jobs.size, 0);
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
