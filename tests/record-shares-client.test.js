const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const fixtures = require("./helpers/record-share-fixtures");
const { present } = require("../miniprogram/shared-record-view");
const root = path.resolve(__dirname, "../miniprogram");
function client({ single = false, publicRead, create, render = async()=>"wxfile://report", overrides = {} } = {}) {
  let definition, logins = 0, requests = 0, menu = 0;
  const navigations=[], sent=[], saved=[], notices=[];
  const wx = {
    getEnterOptionsSync: () => ({ scene: single ? 1154 : 1001 }),
    getStorageSync() { throw Error("公开分享不得读登录存储"); },
    request(options) { requests++; assert.equal(options.header, undefined); publicRead ? publicRead(options) : options.success({ statusCode: 200, data: fixtures.stats }); },
    showShareMenu() { assert.equal(single, false); menu++; }, hideShareMenu() {}, setNavigationBarTitle() {}, navigateTo:options=>navigations.push(options), redirectTo:options=>navigations.push(options),
    showShareImageMenu:options=>sent.push(options), saveImageToPhotosAlbum:options=>saved.push(options), showToast:options=>notices.push(options),
    createSelectorQuery() { const q={in(){return q},select(){return q},fields(){return q},exec(callback){callback([])}};return q; },
    ...overrides,
  };
  const api = { assetUrl: value => "https://test.invalid" + value,
    login: async () => { logins++; }, request: async (url, method, selection) => { assert.equal(url, "/api/me/shares"); assert.equal(method, "POST"); return create ? create(selection) : fixtures[selection.kind]; } };
  function load(file) {
    if (file === path.join(root, "api.js")) return api;
    if (file === path.join(root, "share-image.js")) return {renderImage:render};
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module: mod, require: name => load(path.resolve(path.dirname(file), name + ".js")), wx, Page: value => definition = value, setTimeout, clearTimeout }, { filename: file });
    return mod.exports;
  }
  load(path.join(root, "pages/shared/shared.js"));
  const p = { ...definition, data: structuredClone(definition.data), setData: function(values) { Object.assign(this.data, values); } };
  return { p, wx, navigations, sent, saved, notices, logins: () => logins, requests: () => requests, menus: () => menu };
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
test("品牌兜底在普通与单页模式均无需登录或接口即可展示和再次分享", async () => {
  for(const single of [true,false]) for(const tab of ['records','matches','fun']) {
    const c=client({single});
    try {
      await c.p.onLoad({intro:tab});
      assert.equal(c.p.data.loading,false);assert.equal(c.p.data.error,'');assert.ok(c.p.data.intro.heading);
      assert.equal(c.logins(),0);assert.equal(c.requests(),0);
      assert.equal(c.p.onShareAppMessage().path,'/pages/shared/shared?intro='+tab);
      assert.equal(c.p.onShareTimeline().query,'intro='+tab);
      assert.equal(c.menus(),single?0:1);
      c.p.openPersonalRecords();c.p.openPersonalRecords();
      assert.equal(c.navigations.length,single?0:1);
      if(!single)assert.equal(c.navigations[0].url,'/pages/stats/stats?tab='+tab);
    } finally {c.p.onUnload();}
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
test("页面概览显示完整范围的统计和最近五局，趣味真实零与未知分别呈现", () => {
  const matches=present(fixtures.matches);
  assert.equal(matches.hero,'19');assert.equal(matches.related.length,5);
  assert.deepEqual(matches.metrics.map(row=>row.value),['10','8','1']);
  const summary=present(fixtures.funSummary);
  assert.deepEqual(summary.items.map(row=>row.countLabel),['3','0','—']);
  assert.equal(summary.hero,'1');assert.equal(summary.unit,'项');
});
test("访客模板仅展示分享内容，没有打开按钮、本人操作或虚构的过程", () => {
  const context = { window: {}, global: {}, console };vm.createContext(context);
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  for (const snapshot of Object.values(fixtures)) {
    const text = JSON.stringify(factory("pages/shared/shared.wxml")({ loading: false, error: "", sharedRecord: present(snapshot), authoring: false }));
    assert.match(text, /子龙/);assert.match(text, /数据截至/);
    assert.doesNotMatch(text, /打开桌边助手|sendSharedImage|saveSharedImage|生成成绩图片|records-tabs/);
  }
  const empty = structuredClone(fixtures.match);empty.data.events = [];
  const text = JSON.stringify(factory("pages/shared/shared.wxml")({ sharedRecord: present(empty) }));
  assert.match(text, /没有保存可分享的过程/);assert.doesNotMatch(text, /刺杀未命中/);
});
test("战报后台导出当前快照，直接发送和保存同一路径，不跳转或重新请求成绩", async()=>{
  const rendered=[];
  const c=client({render:async(page,view,options)=>{rendered.push({view,options});return "wxfile://current-report";}});
  try {
    await c.p.onLoad({kind:"stats"});
    assert.equal(rendered.length,0);
    await c.p.onReady();await c.p.prepareImage();
    assert.equal(rendered.length,1);
    assert.equal(rendered[0].view.asOf,c.p.data.sharedRecord.asOf);
    assert.equal(rendered[0].view.metrics[2].value,"35");
    assert.equal(rendered[0].options.selector,"#shared-report-canvas");
    c.p.sendSharedImage();c.p.sendSharedImage();c.p.saveSharedImage();
    assert.equal(c.sent.length,1);assert.equal(c.saved.length,0);
    c.sent[0].fail({errMsg:"showShareImageMenu:cancel"});c.sent[0].complete();
    assert.equal(c.p.data.actionError,"");
    c.p.saveSharedImage();c.p.saveSharedImage();
    assert.equal(c.saved.length,1);assert.equal(c.sent[0].path,c.saved[0].filePath);
    assert.equal(c.saved[0].filePath,"wxfile://current-report");
    c.saved[0].success();c.saved[0].complete();
    assert.equal(c.notices[0].title,"已保存到相册");assert.equal(c.navigations.length,0);assert.equal(c.requests(),0);
  } finally {c.p.onUnload();}
});
test("画布先就绪时等待快照，访客不导出，失败只重试同一份战报",async()=>{
  let finish,fail=true,renders=0;
  const c=client({create:()=>new Promise(resolve=>{finish=resolve}),render:async()=>{renders++;if(fail)throw Error("导出失败");return "wxfile://retry";}});
  try {
    const load=c.p.onLoad({kind:"stats"});
    await new Promise(resolve=>setImmediate(resolve));await c.p.onReady();
    assert.equal(renders,0);finish(fixtures.stats);await load;
    assert.equal(renders,1);assert.match(c.p.data.actionError,/导出失败/);
    fail=false;await c.p.retrySharedImage();
    assert.equal(renders,2);assert.equal(c.p.data.imagePath,"wxfile://retry");
    assert.equal(c.p.data.actionError,"");assert.equal(c.p.data.sharedRecord.asOf,"2026.10.26 18:00");
  } finally {c.p.onUnload();}
  const visitor=client({render:()=>{throw Error("访客不应导出")}});
  try {await visitor.p.onLoad({share:fixtures.stats.id});await visitor.p.onReady();visitor.p.sendSharedImage();visitor.p.saveSharedImage();assert.equal(visitor.sent.length+visitor.saved.length,0);}
  finally {visitor.p.onUnload();}
});
test("导出按快照串行，旧图片不会覆盖新快照，卸载后不写状态或发送",async()=>{
  const pending=[], views=[];let creates=0;
  const next=structuredClone(fixtures.stats);next.data.scoreMonth=36;next.id="a".repeat(48);
  const c=client({create:async()=>creates++?next:fixtures.stats,render:(page,view)=>{views.push(view);return new Promise(resolve=>pending.push(resolve));}});
  await c.p.onLoad({kind:"stats"});const first=c.p.onReady();
  await new Promise(resolve=>setImmediate(resolve));
  const reload=c.p.loadSharedRecord();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(views.length,1);pending[0]("wxfile://old");await first;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(views.length,2);assert.equal(c.p.data.imagePath,"");
  assert.equal(views[1].metrics[2].value,"36");
  pending[1]("wxfile://new");await reload;assert.equal(c.p.data.imagePath,"wxfile://new");
  const last=c.p.retrySharedImage();await new Promise(resolve=>setImmediate(resolve));
  c.p.onUnload();const before=structuredClone(c.p.data);pending[2]("wxfile://late");await last;
  assert.deepEqual(structuredClone(c.p.data),before);c.p.sendSharedImage();c.p.saveSharedImage();assert.equal(c.sent.length+c.saved.length,0);
});
test("发送不支持、失败和相册权限拒绝在当前页恢复，不把取消当失败",async()=>{
  const c=client({overrides:{showShareImageMenu:undefined,openSetting:options=>options.success({authSetting:{"scope.writePhotosAlbum":true}})}});
  try {
    await c.p.onLoad({kind:"stats"});await c.p.onReady();c.p.sendSharedImage();
    assert.match(c.p.data.actionError,/保存图片/);assert.equal(c.sent.length,0);
    c.p.saveSharedImage();c.saved[0].fail({errMsg:"saveImageToPhotosAlbum:fail auth deny"});c.saved[0].complete();
    assert.equal(c.p.data.albumDenied,true);c.p.openSharedAlbumSettings();
    assert.equal(c.p.data.albumDenied,false);assert.match(c.p.data.actionError,/再次点击保存/);
    c.p.saveSharedImage();c.saved[1].fail({errMsg:"saveImageToPhotosAlbum:cancel"});c.saved[1].complete();
    assert.equal(c.p.data.actionError,"");assert.equal(c.notices.length,0);
    c.p.onHide();c.p.saveSharedImage();assert.equal(c.saved.length,2);
  } finally {c.p.onUnload();}
  const other=client();try{await other.p.onLoad({kind:"stats"});await other.p.onReady();other.p.sendSharedImage();other.sent[0].fail({errMsg:"fail unsupported"});other.sent[0].complete();assert.match(other.p.data.actionError,/暂时无法发送/);assert.equal(other.notices.length,0);}finally{other.p.onUnload();}
});
test("作者模板直接显示发送和保存，正在准备和失败状态不再跳到图片生成页",()=>{
  const context={window:{},global:{},console};vm.createContext(context);
  const factory=vm.runInContext("(function(global){"+wxmlToJs(root)+"})(global)",context);
  const data={sharedRecord:present(fixtures.stats),authoring:true,posterAvailable:true,imageMenu:true,imagePath:"wxfile://ready"};
  const ready=JSON.stringify(factory("pages/shared/shared.wxml")(data));
  assert.match(ready,/发给好友/);assert.match(ready,/保存图片/);assert.match(ready,/shared-report-canvas/);
  assert.doesNotMatch(ready,/生成战绩图片|sharedPoster/);
  const loading=JSON.stringify(factory("pages/shared/shared.wxml")({...data,imagePath:"",rendering:true}));
  assert.match(loading,/正在准备图片/);
  const failed=JSON.stringify(factory("pages/shared/shared.wxml")({...data,imagePath:"",actionError:"导出失败"}));
  assert.match(failed,/重试/);assert.match(failed,/retrySharedImage/);
});
