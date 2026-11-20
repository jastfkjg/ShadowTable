const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const types = require("../miniprogram/pages/feedback/types");
const root = path.resolve(__dirname, "../miniprogram");
const context = vm.createContext({ global: {}, window: {}, console });
const render = vm.runInContext("(function(global){" + wxmlToJs(root, { wxmlList: ["feedback", "compose", "history"].map(name => "pages/feedback/" + name + ".wxml") }) + "})(global)", context);
const nodes = node => typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
function page(name, api, wx, dependencies = {}) {
  let definition;
  const file = path.join(root, "pages/feedback", name + ".js");
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { wx, Page: value => definition = value,
    require(request) {
      if (dependencies[request]) return dependencies[request];
      if (request === "../../api") return api;
      if (request === "../../profile") return { backToMe() {} };
      return require(path.resolve(path.dirname(file), request));
    },
  }, { filename: file });
  return { ...definition, data: structuredClone(definition.data), setData(patch, done) { Object.assign(this.data, patch); done?.(); } };
}

test("反馈分类入口、分支提示与可访问操作通过实际页面模板渲染", () => {
  const start = render("pages/feedback/feedback.wxml")(page("feedback").data);
  const links = nodes(start).filter(node => node.tag === "wx-navigator");
  assert.deepEqual(links.map(node => node.attr.url), ["history", ...types.map(t => "compose?type=" + t.id)]);
  for (const type of types) {
    const editor = page("compose");
    editor.onLoad({ type: type.id });
    const view = nodes(render("pages/feedback/compose.wxml")(editor.data));
    const areaButtons = view.filter(node => node.attr?.bindtap === "area");
    assert.equal(areaButtons.length, type.id === "issue" ? 4 : 0);
    // Default-size WeChat buttons have a platform width that stacks the four options.
    assert.ok(areaButtons.every(node => node.attr.size === "mini"));
    assert.equal(view.find(node => node.tag === "wx-textarea").attr.placeholder, type.prompt);
    assert.equal(view.find(node => node.attr?.bindtap === "submit").attr.disabled, true);
  }
});

test("截图可预览移除；失败保留输入和请求编号，重试进入展开的反馈记录", async () => {
  const sent = [], navigations = [];
  let preview, attempts = 0;
  const wx = {
    getStorageSync: () => "session",
    chooseMedia: opts => opts.success({ tempFiles: ["one", "two"].map(tempFilePath => ({ tempFilePath, size: 120 })) }),
    getFileSystemManager: () => ({ readFile: opts => opts.success({ data: "encoded-" + opts.filePath }) }),
    previewImage: opts => preview = opts.current, showToast() {}, redirectTo: opts => navigations.push(opts.url),
  };
  const api = { login: async () => {}, requestId: () => "retry-" + attempts, async request(path, method, body, key) {
    sent.push(JSON.parse(JSON.stringify({ path, method, body, key })));
    if (!attempts++) throw Error("网络未确认");
    return { id: 7 };
  }};
  const editor = page("compose", api, wx);
  editor.onLoad({ type: "issue" });
  editor.input({ detail: { value: "投票后仍在等待" } });
  editor.area({ currentTarget: { dataset: { area: "牌桌" } } });
  await editor.choose();
  editor.preview({ currentTarget: { dataset: { path: "one" } } });
  assert.equal(preview, "one");
  editor.remove({ currentTarget: { dataset: { path: "two" } } });
  await editor.submit();
  assert.match(editor.data.error, /网络未确认/); assert.equal(editor.data.ready, true);
  assert.equal(editor.data.photos[0], "one"); assert.equal(editor.data.content, "投票后仍在等待");
  await Promise.all([editor.submit(), editor.submit()]);
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(sent[1].body, { category: "问题反馈", area: "牌桌", content: "投票后仍在等待", images: ["encoded-one"] });
  assert.deepEqual(navigations, ["history?id=7"]);
  const submitted = render("pages/feedback/compose.wxml")(editor.data);
  assert.ok(!nodes(submitted).some(node => node.tag === "wx-page-container"));
  const history = page("history", { login: api.login, feedbackImage: async () => "jpeg", request: async () => ({ next:null, items: [{
    id:7, content:"投票后仍在等待", category:"问题反馈", area:"牌桌", photos:1, created:1, reply:"收到，正在排查", repliedAt:2,
  }] }) }, wx, { "./screenshots": { write: async () => "wxfile://sample.jpg", remove() {} } });
  history.onLoad({ id: "7" });
  await history.onShow();
  const tree = render("pages/feedback/history.wxml")(history.data);
  assert.match(JSON.stringify(tree), /收到，正在排查/);
  assert.match(JSON.stringify(tree), /反馈已提交/);
  assert.ok(nodes(tree).some(node => node.tag === "wx-image" && node.attr.src === "wxfile://sample.jpg"));
  const imageButton = nodes(tree).find(node => node.attr?.bindtap === "preview");
  assert.equal(imageButton.attr["data-id"], 7); assert.equal(imageButton.attr["data-index"], 0);
});

test("反馈退出沿用共享确认框，取消保留草稿，确认在容器收起后返回", async () => {
  let navigations = 0, resolveDialog;
  const opened = [];
  const editor = page("compose", {}, {}, {
    "../../profile": { backToMe() { navigations++; } },
    "../../dialog": { show(options) {
      opened.push(options);
      return new Promise(resolve => { resolveDialog = resolve; });
    } },
  });
  const guard = () => nodes(render("pages/feedback/compose.wxml")(editor.data))
    .find(node => node.tag === "wx-page-container");
  editor.onLoad({ type: "issue" });
  assert.equal(guard(), undefined);
  await editor.back();
  assert.equal(navigations, 1);
  editor.edit({ photos: ["screenshot"] });
  assert.equal(guard().attr.show, true);
  const first = editor.back();
  await editor.back();
  assert.equal(opened.length, 1);
  assert.match(opened[0].content, /截图/);
  assert.equal(opened[0].danger, true);
  assert.equal(opened[0].cancelText, "继续编辑");
  resolveDialog({ confirm:false }); await first;
  assert.deepEqual(editor.data.photos, ["screenshot"]);
  assert.equal(navigations, 1);
  const second = editor.onGuardClosed();
  resolveDialog({ confirm:true }); await second;
  assert.equal(guard().attr.show, false);
  assert.equal(navigations, 1);
  editor.onGuardClosed();
  assert.equal(navigations, 2);
});

test("历史截图按展开记录读取，单张失败可重试，预览保留顺序并回收过期文件", async () => {
  const requests = [], removed = [];
  let viewer, fail = true, resolveWrite, pendingWrites = false, session = "first";
  const rows = [
    { id: 8, category: "问题反馈", photos: 3, content: "第一条", created: 1 },
    { id: 7, category: "功能建议", photos: 1, content: "第二条", created: 1 },
  ];
  const history = page("history", { login: async () => {},
    request: async () => ({ items: rows, next: null }),
    feedbackImage: async (id, index) => {
      requests.push([id, index]);
      if (fail && index === 1) throw Error("offline");
      return id + "-" + index;
    },
  }, { getStorageSync: () => session, previewImage: options => { viewer = options; } }, {
    "./screenshots": { write: async bytes => pendingWrites ? new Promise(resolve => { resolveWrite = resolve; }) : bytes,
      remove: src => { if (src) removed.push(src); } },
  });
  const event = (id, index) => ({ currentTarget: { dataset: { id, index } } });
  history.onLoad({}); await history.onShow();
  assert.equal(history.data.submitted, 0); assert.equal(requests.length, 0);
  await history.toggle(event(8));
  assert.deepEqual(Array.from(history.data.photos, p => p.state), ["ready", "error", "ready"]);
  fail = false;
  await history.preview(event(8, 1)); await history.preview(event(8, 1));
  assert.deepEqual(requests, [[8, 0], [8, 1], [8, 2], [8, 1]]);
  assert.equal(viewer.current, "8-1"); assert.deepEqual(Array.from(viewer.urls), ["8-0", "8-1", "8-2"]);
  history.onHide(); await history.onShow();
  assert.equal(requests.length, 4);
  pendingWrites = true;
  const switching = history.toggle(event(7));
  await new Promise(resolve => setImmediate(resolve));
  await history.toggle(event(7)); resolveWrite("late"); await switching;
  assert.deepEqual(removed, ["8-0", "8-1", "8-2", "late"]);
  pendingWrites = false;
  await history.toggle(event(7));
  const bad = event(7, 0); bad.currentTarget.dataset.src = "7-0";
  history.imageError(bad); assert.equal(history.data.photos[0].state, "error");
  await history.preview(event(7, 0));
  session = "second"; await history.onShow();
  assert.equal(history.data.expanded, 0); assert.equal(history.data.photos.length, 0);
  assert.equal(removed.at(-1), "7-0");
});
