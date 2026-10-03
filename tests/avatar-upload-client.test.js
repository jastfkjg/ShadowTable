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
  const timers = new Map(), writes = [], uploads = [], alerts = [], navigations = [];
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
    navigateBack: () => navigations.push("back"), showToast() {}, showModal: options => options.success({ confirm: true }) };
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
  const p = { ...spec, data: structuredClone(spec.data), setData(patch) { Object.assign(this.data, patch); } };
  return { p, api, wx, timers, uploads, writes, alerts, navigations };
}
async function ready(client) { await client.p.onLoad(); await flush(); }
const choose = (p, value = "wxfile://chosen-avatar") => p.chooseCustomAvatar({ detail: { avatarUrl: value } });

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
  assert.match(client.p.data.uploadError, /审核暂不可用/);
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
    assert.equal(client.p.data.canUpload, false); await client.p.chooseCustomAvatar({ detail: {} });
    assert.equal(client.p.data.dirty, false);
    client.p.chooseBuiltinAvatar({ currentTarget: { dataset: { id: "avatar-02" } } });
    assert.equal(client.p.avatar, "builtin:avatar-02"); assert.equal(client.p.data.dirty, true); client.p.onUnload();
  }
});

test("取消更换恢复原头像，保留昵称编辑并允许保存，迟到审核结果不再应用", async () => {
  const client = page({ uploadAvatar: async () => ({ id: "upload-one", status: "pending" }) }); await ready(client);
  await choose(client.p); client.p.inputName({ detail: { value: "只改昵称" } });
  client.p.cancelCustomAvatar();
  assert.equal(client.p.data.avatarPreview, "https://api.example.test/api/avatars/old");
  assert.equal(client.p.avatar, undefined); assert.equal(client.p.data.nickname, "只改昵称");
  assert.equal(client.p.data.dirty, true); assert.equal(client.timers.size, 0); assert.equal(client.p.data.uploadStatus, "");
  await client.p.save(); assert.deepEqual(client.writes[0].data, { nickname: "只改昵称", version: 3 }); client.p.onUnload();
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
  assert.equal(client.p.data.uploadStatus, "rejected"); assert.match(client.p.data.uploadError, /未通过/);
  await client.p.save(); assert.equal(client.writes.length, 0);
  await choose(client.p, "wxfile://second-avatar"); failed = true; await client.p.checkAvatarReview();
  assert.equal(client.p.uploadRecord, null); assert.equal(client.p.data.uploadStatus, "failed");
  assert.match(client.p.data.uploadError, /已过期/); client.p.onUnload();
});

test("小程序模板按能力显示上传按钮，审核时禁用保存，保留内置头像网格和错误重试", () => {
  const context = vm.createContext({ window: {}, global: {}, console });
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  const render = factory("pages/profile/profile.wxml"), data = page().p.data;
  function nodes(node) { return typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : []; }
  const base = { ...data, loading: false, profile, nickname: profile.nickname, canUpload: true };
  const chooseButton = tree => nodes(tree).find(node => node.attr?.openType === "chooseAvatar");
  assert.ok(chooseButton(render(base)));
  assert.equal(chooseButton(render({ ...base, canUpload: false })), undefined);
  for (const uploadStatus of ["pending", "processing", "uploading", "failed", "rejected"]) {
    const save = nodes(render({ ...base, uploadStatus })).find(node => node.attr?.formType === "submit");
    assert.equal(save.attr.disabled, true);
  }
  assert.equal(nodes(render({ ...base, uploadStatus: "approved" })).find(node => node.attr?.formType === "submit").attr.disabled, false);
  const rejected = render({ ...base, uploadStatus: "rejected", uploadError: "未通过审核" });
  assert.ok(nodes(rejected).some(node => node.attr?.role === "alert"));
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
