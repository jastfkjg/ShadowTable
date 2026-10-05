const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { wxmlToJs } = require("miniprogram-compiler");
const root = path.resolve(__dirname, "../miniprogram");
const profile = { nickname: "林间", avatarUrl: "/api/avatars/old", version: 3, identityType: "wx" };
const flush = () => new Promise(resolve => setImmediate(resolve));
function page(overrides = {}) {
  let spec, sequence = 0;
  const timers = new Map(), writes = [], uploads = [], alerts = [], navigations = [], toasts = [];
  const api = {
    login: async () => {}, requestId: () => "avatar-request-id-" + (++sequence), assetUrl: value => "https://api.example.test" + value,
    request: async (url, method, data, id) => {
      if (method === "POST") { writes.push({ url, data: structuredClone(data), id }); return profile; }
      return url === "/api/me/profile" ? profile : url === "/api/me/avatar-uploads" ? { enabled: true } : { id: "upload-one", status: "approved" };
    },
    uploadAvatar: async (...args) => { uploads.push(args); args[3]?.(100); return { id: "upload-one", status: "approved" }; }, ...overrides,
  };
  const wx = { login: options => options.success({ code: "fresh-code" }), canIUse: () => true,
    enableAlertBeforeUnload: options => alerts.push(options), disableAlertBeforeUnload() {}, pageScrollTo() {},
    navigateBack: () => navigations.push("back"), showToast: options => toasts.push(options), showModal: options => options.success({ confirm: true }) };
  function load(file) {
    if (file === path.join(root, "api.js")) return api;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module, require: name => load(path.resolve(path.dirname(file), name + ".js")),
      Page: value => { spec = value; }, wx, getCurrentPages: () => [{ route: "pages/me/me" }, {}],
      setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    }, { filename: file });
    return module.exports;
  }
  load(path.join(root, "pages/profile/profile.js"));
  const p = { ...spec, data: structuredClone(spec.data), setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
  return { p, api, wx, timers, uploads, writes, alerts, navigations, toasts };
}
async function ready(client) { await client.p.onLoad(); await flush(); }
const choose = (p, value = "wxfile://chosen-avatar") => p.chooseWechatAvatar({ detail: { avatarUrl: value } });

test("微信内置选择结果直接预览并上传，不调用额外选图或裁剪，保留昵称编辑", async () => {
  const client = page(); await ready(client);
  client.p.inputName({ detail: { value: "保留昵称" } });
  client.wx.chooseMedia = client.wx.chooseImage = client.wx.cropImage = client.wx.createSelectorQuery = client.wx.canvasToTempFilePath = () => { throw Error("不应再选图或裁剪"); };
  await choose(client.p, "wxfile://wechat-result");
  assert.equal(client.uploads.length, 1); assert.equal(client.uploads[0][0], "wxfile://wechat-result");
  assert.equal(client.p.data.avatarPreview, "wxfile://wechat-result"); assert.equal(client.p.data.nickname, "保留昵称");
  assert.equal(client.p.data.uploadStatus, "approved"); assert.equal(client.writes.length, 0); client.p.onUnload();
});

test("取消微信原生选择保留头像草稿和昵称，卸载后迟到回调不会修改资料或上传", async () => {
  const client = page(); await ready(client); await choose(client.p);
  client.p.inputName({ detail: { value: "保留昵称" } });
  const snapshot = JSON.stringify(client.p.data);
  await client.p.chooseWechatAvatar({ detail: {} });
  assert.equal(JSON.stringify(client.p.data), snapshot); assert.equal(client.uploads.length, 1); assert.equal(client.toasts.length, 0);
  client.p.onUnload();
  const unloaded = JSON.stringify(client.p.data);
  await choose(client.p, "wxfile://late-result");
  assert.equal(JSON.stringify(client.p.data), unloaded); assert.equal(client.uploads.length, 1);
});

test("不支持微信原生头像选择时保留内置头像，保存过程中原生回调不覆盖正在提交的草稿", async () => {
  const unsupported = page(); unsupported.wx.canIUse = () => false; await ready(unsupported);
  assert.equal(unsupported.p.data.canUpload, false); await choose(unsupported.p);
  assert.equal(unsupported.uploads.length, 0);
  unsupported.p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: "pixel-01" } } });
  await unsupported.p.save(); assert.equal(unsupported.writes[0].data.avatar, "builtin:pixel-01"); unsupported.p.onUnload();
  const client = page(); await ready(client);
  client.p.data.busy = true; await choose(client.p);
  client.p.data.busy = false; client.p.pending = { id: "save-pending" }; await choose(client.p);
  assert.equal(client.uploads.length, 0); assert.equal(client.p.data.dirty, false); client.p.onUnload();
});

test("上传使用新微信code和本地预览，审核通过只修改草稿，保存沿用版本和幂等编号", async () => {
  const client = page(); await ready(client);
  assert.equal(client.p.data.canUpload, true);
  await choose(client.p);
  assert.equal(client.p.data.avatarPreview, "wxfile://chosen-avatar"); assert.equal(client.p.data.uploadProgress, 100);
  assert.equal(client.uploads[0][1], "fresh-code"); assert.equal(client.p.avatar, "upload:upload-one");
  assert.equal(client.p.data.dirty, true); assert.equal(client.writes.length, 0);
  await client.p.save();
  assert.deepEqual(client.writes[0].data, { nickname: "林间", version: 3, avatar: "upload:upload-one" });
  assert.equal(client.navigations[0], "back"); assert.equal(client.p.data.dirty, false);
  client.p.onUnload();
});

test("审核中不能提交临时路径，昵称编辑保留，通过轮询后允许保存", async () => {
  const client = page({ uploadAvatar: async () => ({ id: "upload-one", status: "pending" }) }); await ready(client);
  await choose(client.p);
  assert.equal(client.p.data.uploadStatus, "pending"); assert.equal(client.timers.size, 1);
  client.p.inputName({ detail: { value: "新昵称" } }); await client.p.save();
  assert.equal(client.writes.length, 0); assert.equal(client.p.pending, null);
  await client.p.checkAvatarReview();
  assert.equal(client.timers.size, 0); assert.equal(client.p.data.uploadStatus, "approved");
  assert.equal(client.p.data.nickname, "新昵称"); await client.p.save();
  assert.equal(client.writes[0].data.nickname, "新昵称"); client.p.onUnload();
});

test("网络结果未确认时重试同一图片编号；审核故障明确后使用新编号重传", async () => {
  const attempts = []; let next = "network";
  const client = page({ uploadAvatar: async (_path, _code, id) => {
    attempts.push(id); if (next === "network") throw Error("网络未确认");
    return { id: "upload-one", status: next === "failed" ? "failed" : "approved" };
  } }); await ready(client);
  await choose(client.p); assert.match(client.p.data.uploadError, /网络/);
  next = "failed"; await client.p.retryAvatarUpload(); assert.equal(attempts[0], attempts[1]);
  assert.match(client.p.data.uploadError, /暂时无法处理/);
  next = "approved"; await client.p.retryAvatarUpload(); assert.notEqual(attempts[2], attempts[1]);
  assert.equal(client.p.data.uploadStatus, "approved"); client.p.onUnload();
});

test("换回内置头像取消审核，迟到上传或轮询响应不覆盖选择与昵称；卸载后不更新页面", async () => {
  let resolveUpload;
  const client = page({ uploadAvatar: () => new Promise(resolve => { resolveUpload = resolve; }) }); await ready(client);
  const choosing = choose(client.p); await flush();
  client.p.inputName({ detail: { value: "编辑中" } });
  client.p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: "pixel-01" } } });
  resolveUpload({ id: "late-upload", status: "pending" }); await choosing;
  assert.equal(client.p.avatar, "builtin:pixel-01"); assert.equal(client.p.data.selectedAvatar, "pixel-01");
  assert.equal(client.p.data.uploadStatus, ""); assert.equal(client.p.data.nickname, "编辑中"); assert.equal(client.timers.size, 0);
  const choosingAgain = choose(client.p); await flush(); client.p.onUnload();
  const snapshot = structuredClone(client.p.data); resolveUpload({ id: "unloaded-upload", status: "approved" }); await choosingAgain;
  assert.deepEqual(JSON.parse(JSON.stringify(client.p.data)), JSON.parse(JSON.stringify(snapshot)));
});

test("上传服务禁用或旧服务不支持时内置选择和保存仍可用；图片取消不改草稿", async () => {
  for (const failure of [false, true]) {
    const client = page({ request: async url => {
      if (url === "/api/me/avatar-uploads") { if (failure) throw Error("接口不存在"); return { enabled: false }; }
      return profile;
    } }); await ready(client);
    assert.equal(client.p.data.canUpload, false); await client.p.chooseWechatAvatar({ detail: {} });
    assert.equal(client.p.data.dirty, false);
    client.p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: "avatar-02" } } });
    assert.equal(client.p.avatar, "builtin:avatar-02"); assert.equal(client.p.data.dirty, true); client.p.onUnload();
  }
});

test("上传途中可以重新选择，旧进度和迟到结果不覆盖新图片；选择内置头像后忽略未完成上传", async () => {
  const requests = [];
  const client = page({ uploadAvatar: (path, _code, id, progress) => new Promise(resolve => requests.push({ path, id, progress, resolve })) });
  await ready(client);
  client.p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: "pixel-01" } } });
  const before = client.p.data.avatarPreview;
  const first = choose(client.p, "wxfile://first"); await flush();
  requests[0].progress(42); assert.equal(client.p.data.uploadProgress, 42);
  const second = choose(client.p, "wxfile://second"); await flush();
  assert.equal(requests.length, 2); assert.notEqual(requests[0].id, requests[1].id);
  requests[1].progress(27); requests[0].progress(100);
  requests[0].resolve({ id: "old-result", status: "approved" }); await first;
  assert.equal(client.p.data.avatarPreview, "wxfile://second");
  assert.equal(client.p.data.uploadProgress, 27); assert.equal(client.p.avatar, "local");
  assert.equal(client.p.data.uploadBusy, true);
  client.p.inputName({ detail: { value: "保留昵称" } });
  client.p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: "pixel-01" } } });
  const snapshot = structuredClone(client.p.data);
  requests[1].resolve({ id: "cancelled-result", status: "pending" }); await second;
  assert.deepEqual(JSON.parse(JSON.stringify(client.p.data)), JSON.parse(JSON.stringify(snapshot)));
  assert.equal(client.p.avatar, "builtin:pixel-01"); assert.equal(client.p.data.selectedAvatar, "pixel-01");
  assert.equal(client.p.data.avatarPreview, before); assert.equal(client.timers.size, 0);
  await client.p.save();
  assert.deepEqual(client.writes[0].data, { nickname: "保留昵称", version: 3, avatar: "builtin:pixel-01" });
  client.p.onUnload();
});

test("审核拒绝和状态查询失败保留编辑并提供恢复；过期可重新上传", async () => {
  let status = "pending", failed = false;
  const client = page({ uploadAvatar: async () => ({ id: "upload-one", status: "pending" }), request: async url => {
    if (url === "/api/me/profile") return profile;
    if (url === "/api/me/avatar-uploads") return { enabled: true };
    if (failed) throw Object.assign(Error("上传图片已过期"), { status: 410 });
    return { id: "upload-one", status };
  } }); await ready(client); await choose(client.p);
  status = "rejected"; await client.p.checkAvatarReview();
  assert.equal(client.p.data.uploadStatus, "rejected"); assert.match(client.p.data.uploadError, /无法使用/);
  await client.p.save(); assert.equal(client.writes.length, 0);
  await choose(client.p, "wxfile://second-avatar"); failed = true; await client.p.checkAvatarReview();
  assert.equal(client.p.uploadRecord, null); assert.equal(client.p.data.uploadStatus, "failed");
  assert.match(client.p.data.uploadError, /已过期/); client.p.onUnload();
});

test("头像本身可更换，准备时禁用保存但允许重新选图，成功后没有常驻说明，错误可恢复", () => {
  const context = vm.createContext({ window: {}, global: {}, console });
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  const render = factory("pages/profile/profile.wxml"), data = page().p.data;
  function nodes(node) { return typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : []; }
  const base = { ...data, loading: false, profile, nickname: profile.nickname, canUpload: true };
  const chooseButton = tree => nodes(tree).find(node => node.attr?.bindchooseavatar === "chooseWechatAvatar");
  const idle = render(base);
  assert.ok(chooseButton(idle));
  assert.equal(chooseButton(idle).attr.openType, "chooseAvatar");
  assert.equal(nodes(idle).filter(node => node.attr?.openType === "chooseAvatar").length, 1);
  assert.ok(nodes(chooseButton(idle)).some(node => node.attr?.class === "avatar-change-badge"));
  assert.equal(nodes(idle).find(node => node.attr?.class === "avatar-change-label"), undefined);
  assert.equal(chooseButton(render({ ...base, canUpload: false })), undefined);
  for (const patch of [{ busy: true }, { pendingSave: true }])
    assert.equal(chooseButton(render({ ...base, ...patch })).attr.disabled, true);
  assert.equal(nodes(idle).find(node => node.attr?.role === "dialog"), undefined);
  assert.equal(nodes(idle).find(node => node.tag === "wx-canvas" || node.tag === "wx-slider"), undefined);
  for (const uploadStatus of ["pending", "processing", "uploading", "failed", "rejected"]) {
    const tree = render({ ...base, uploadStatus, uploadBusy: true });
    const save = nodes(tree).find(node => node.attr?.formType === "submit");
    assert.equal(save.attr.disabled, true);
    assert.equal(chooseButton(tree).attr.disabled, false);
    assert.equal(nodes(tree).find(node => node.attr?.bindtap === "cancelCustomAvatar"), undefined);
  }
  const approved = render({ ...base, uploadStatus: "approved" });
  assert.equal(nodes(approved).find(node => node.attr?.formType === "submit").attr.disabled, false);
  const visibleText = tree => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree.children || []).map(visibleText).join(" ");
  assert.doesNotMatch(visibleText(approved), /更换头像|撤销更换|使用微信头像|审核|JPG|PNG|2MB|保存资料即可使用|重新选择图片|上传自己的图片/);
  const uploading = render({ ...base, uploadStatus: "uploading", uploadProgress: 42 });
  const progress = nodes(uploading).find(node => node.attr?.role === "progressbar");
  assert.equal(progress.attr.ariaValuenow, 42);
  assert.match(JSON.stringify(uploading), /头像上传中/);
  assert.match(JSON.stringify(render({ ...base, uploadStatus: "pending" })), /正在准备头像/);
  const failed = render({ ...base, uploadStatus: "failed", uploadError: "网络中断" });
  assert.ok(nodes(failed).some(node => node.attr?.bindtap === "retryAvatarUpload"));
  const rejected = render({ ...base, uploadStatus: "rejected", uploadError: "未通过审核" });
  assert.ok(nodes(rejected).some(node => node.attr?.role === "alert"));
  assert.equal(nodes(rejected).find(node => node.attr?.bindtap === "retryAvatarUpload"), undefined);
  assert.equal(nodes(rejected).filter(node => node.attr?.bindtap === "chooseBuiltinAvatar").length, 32);
});

test("wx.uploadFile携带会话与幂等编号，解析字符串响应，401只清除当前会话", async () => {
  const storage = new Map([["session", "session-one"]]); let options;
  const wx = { getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key),
    uploadFile: value => { options = value; return { onProgressUpdate(callback) { callback({ progress: 42 }); } }; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "api.js"), "utf8"), { module, wx, require: () => ({ baseUrl: "https://api.example.test" }) });
  let progress;
  const result = module.exports.uploadAvatar("wxfile://avatar", "fresh-code", "same-request-id-123", value => { progress = value; });
  assert.equal(options.header.Authorization, "Bearer session-one"); assert.equal(options.header["Idempotency-Key"], "same-request-id-123");
  assert.equal(options.header["content-type"], undefined); assert.equal(options.formData.code, "fresh-code"); assert.equal(progress, 42);
  options.success({ statusCode: 202, data: '{"id":"one","status":"pending"}' });
  assert.equal((await result).status, "pending");
  const unauthorized = module.exports.uploadAvatar("wxfile://avatar", "fresh-code", "same-request-id-123");
  storage.set("session", "session-two"); options.success({ statusCode: 401, data: '{"error":"请重新登录"}' });
  await assert.rejects(unauthorized, error => error.status === 401); assert.equal(storage.get("session"), "session-two");
  const current = module.exports.uploadAvatar("wxfile://avatar", "fresh-code", "same-request-id-123");
  options.success({ statusCode: 401, data: '{"error":"请重新登录"}' });
  await assert.rejects(current); assert.equal(storage.has("session"), false);
});

test('同房战绩开关参与未保存提示，取消修改恢复干净，保存只提交明确变更', async () => {
  const client=page();await ready(client);const p=client.p;
  assert.equal(p.data.roomStatsVisible,false);
  p.changeRoomStatsVisibility({detail:{value:true}});assert.equal(p.data.dirty,true);
  p.changeRoomStatsVisibility({detail:{value:false}});assert.equal(p.data.dirty,false);
  p.changeRoomStatsVisibility({detail:{value:true}});await p.save();
  assert.equal(client.writes[0].data.roomStatsVisible,true);assert.equal(client.writes[0].data.version,3);
  assert.equal(client.writes[0].data.leaderboardVisible,undefined);p.onUnload();
});
