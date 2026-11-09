const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { wxmlToJs } = require("miniprogram-compiler");
const { BOARDS } = require("../server/engine");
const details = require("../server/board-info");
const discovery = require("../miniprogram/rule-discovery");
const presentation = require("../miniprogram/board-detail");
const root = path.resolve(__dirname, "../miniprogram");
const boards = BOARDS.map(board => ({ ...board, detail: details[board.id] }));
const tick = () => new Promise(setImmediate);
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const nodes = node => typeof node === "object" && node ? [node, ...(node.children || []).flatMap(nodes)] : [];

function page(name, { singlePage = false, request = async () => ({ boards }) } = {}) {
  const file = path.join(root, "pages", name, name + ".js"), realRequire = createRequire(file);
  let definition;
  const calls = [], navigation = [], titles = [], menus = [];
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    Page: value => { definition = value; },
    require: name => name === "../../api" ? { publicRequest: url => { calls.push(url); return request(url); } }
      : name === "../../records-share" ? { isSinglePage: () => singlePage }
      : name === "../../tab-navigation" ? { switchHomeTab: (tab, options) => navigation.push({ tab, options }) } : realRequire(name),
    wx: { getWindowInfo: () => ({ statusBarHeight: 20 }), setNavigationBarTitle: options => titles.push(options.title),
      hideShareMenu: () => menus.push("hide"), showShareMenu: () => menus.push("show") },
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(values, cb) { Object.assign(this.data, values); cb?.(); } };
  return { p, calls, navigation, titles, menus };
}

test("收录范围仅包含公开规则，所有已注册私密页面与将来的页面由末尾规则拒绝", () => {
  const sitemap = require("../miniprogram/sitemap.json"), app = require("../miniprogram/app.json");
  const allowed = sitemap.rules.filter(rule => rule.action === "allow").map(rule => rule.page);
  assert.deepEqual(allowed.sort(), ["pages/board-details/board-details", "pages/help/help"]);
  assert.deepEqual(sitemap.rules.at(-1), { action: "disallow", page: "*" });
  const routes = [...app.pages, ...app.subPackages.flatMap(pkg => pkg.pages.map(page => pkg.root + "/" + page))];
  for (const route of routes.filter(route => !allowed.includes(route))) {
    assert.equal(sitemap.rules.find(rule => rule.page === route || rule.page === "*").action, "disallow");
  }
  assert.deepEqual(sitemap.rules.find(rule => rule.page.includes("board-details")).params, ["board", "capacity"]);
});

test("每种板子人数的分享标题与链接对应实际内容，仅携带玩法与人数", () => {
  for (const source of boards.filter(board => board.available)) for (const capacity of source.counts) {
    const board = presentation.presentBoard(source, capacity), before = JSON.stringify(board);
    const metadata = discovery.boardMetadata(source, board);
    assert.match(metadata.title, new RegExp(capacity + "人规则"));
    assert.match(metadata.title, /阿瓦隆/);
    const shared = discovery.share("/pages/board-details/board-details", metadata), query = new URLSearchParams(shared.path.split("?")[1]);
    assert.deepEqual([...query.keys()], ["board", "capacity"]);
    assert.equal(query.get("board"), source.id);
    assert.equal(Number(query.get("capacity")), capacity);
    assert.equal(JSON.stringify(board), before);
  }
});

test("规则直达加载不需登录；分享去除房间参数，建桌仅转交配置且房间内入口保持阅读", async () => {
  const m = page("board-details");
  m.p.onLoad({ board: "classic-court", capacity: "9", code: "123456", instance: "99", from: "help" }); await tick();
  assert.deepEqual(m.calls, ["/api/boards"]);
  assert.equal(m.p.data.error, "");
  assert.equal(m.p.onShareAppMessage().path, "/pages/board-details/board-details?board=classic-court&capacity=9");
  assert.equal(m.p.onShareTimeline().query, "board=classic-court&capacity=9");
  m.p.createTable();
  assert.deepEqual(JSON.parse(JSON.stringify(m.navigation[0].options.entry)), { mode: "create", board: "classic-court", capacity: 9 });
  const room = page("board-details");
  room.p.onLoad({ board: "knights", capacity: "12", from: "room" }); await tick(); room.p.createTable();
  assert.equal(room.navigation.length, 0);
  assert.equal(room.p.data.canCreate, false);
  const bad = page("board-details");
  bad.p.onLoad({ board: "classic", capacity: "13" }); await tick(); bad.p.createTable();
  assert.match(bad.p.data.error, /不支持此人数/);
  assert.deepEqual(bad.menus, ["hide"]);
  assert.equal(bad.navigation.length, 0);
});

test("帮助与计分分享保留各自内容，朋友圈单页可读公开规则且不显示建桌操作", async () => {
  for (const section of [undefined, "scoring"]) {
    const m = page("help", { singlePage: true, request: async url => url === "/api/boards" ? { boards } : { scopeLabel: "当前计分范围" } });
    m.p.onLoad({ section }); await tick();
    assert.equal(m.p.data.singlePage, true);
    assert.equal(m.p.onShareTimeline().query, section ? "section=scoring" : "");
    assert.equal(m.p.onShareAppMessage().path, "/pages/help/help" + (section ? "?section=scoring" : ""));
    assert.equal(m.navigation.length, 0);
  }
  const m = page("board-details", { singlePage: true });
  m.p.onLoad({ board: "knights-13", capacity: "13" }); await tick();
  assert.equal(m.p.data.board.roleConfiguration.find(group => group.faction === "good").count, 8);
  assert.equal(m.p.data.canCreate, false);
});

test("板子首屏保留原有标题与角色速查，配置在规则章节内，建桌与分享位于正文之后", async () => {
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  const m = page("board-details");
  m.p.onLoad({ board: "knights", capacity: "12" }); await tick();
  const tree = factory("pages/board-details/board-details.wxml")(m.p.data);
  const hero = nodes(tree).find(node => node.attr?.class === "detail-hero");
  assert.match(text(hero), /十二骑士.*12 人/);
  assert.doesNotMatch(text(hero), /12人规则|初始配置|创建牌桌|分享规则/);
  assert.match(text(tree), /角色速查.*玩法规则/);
  assert.ok(nodes(tree).some(node => node.attr?.bindtap === "createTable"));
  assert.ok(nodes(tree).some(node => node.attr?.openType === "share"));
  m.p.setTab({ currentTarget: { dataset: { tab: "rules" } } });
  const deckIndex = m.p.data.chapters.findIndex(chapter => chapter.decks);
  if (!m.p.data.chapters[deckIndex].expanded) m.p.toggleChapter({ currentTarget: { dataset: { index: deckIndex } } });
  const rules = factory("pages/board-details/board-details.wxml")(m.p.data);
  const chapter = nodes(rules).find(node => node.attr?.id === "chapter-body-" + deckIndex);
  assert.match(text(chapter), /A 牌.*梅林.*B 牌/);
  const content = nodes(rules).find(node => node.attr?.class === "board-detail-content");
  assert.equal(content.children.at(-1).attr.class, "detail-rule-actions");
  m.p.data.singlePage = true; m.p.data.canCreate = false;
  const single = factory("pages/board-details/board-details.wxml")(m.p.data);
  assert.match(text(single), /A 牌.*梅林.*B 牌/);
  assert.ok(!nodes(single).some(node => node.attr?.bindtap === "createTable" || node.attr?.openType === "share"));
});

test("帮助展开后的规则、例外和统计口径在真实模板中完整可读", async () => {
  const context = { window: {}, global: {} }; vm.createContext(context);
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  const m = page("help", { request: async url => url === "/api/boards" ? { boards } : { scopeLabel: "当前计分范围" } });
  m.p.onLoad(); await tick();
  m.p.setData({ sections: m.p.data.sections.map(section => ({ ...section, expanded: true })) });
  m.p.refreshReferences();
  let faq = m.p.data.references.find(reference => reference.id === "faq");
  for (const answer of faq.items) {
    if (!answer.expanded) m.p.toggleFaq({ currentTarget: { dataset: { id: answer.id } } });
    if (answer.details?.length) m.p.toggleFaqDetails({ currentTarget: { dataset: { id: answer.id } } });
  }
  const tree = factory("pages/help/help.wxml")(m.p.data), content = text(tree);
  for (const phrase of ["连续五次组队被否决也会使坏人获胜", "可出的牌以身份和板子规则为准", "陪测完成并登记胜负的对局正常计入胜率", "任务或必选目标操作会作废", "反向指标的比例显示发生率", "挡刀率按终局面对最终非空刀的有效机会计算", "新牌身份仍仅本人可见"])
    assert.ok(content.includes(phrase), phrase);
  const toggles = nodes(tree).filter(node => node.attr?.bindtap === "toggleFaq");
  assert.equal(toggles.length, m.p.data.sections[2].items.length);
  assert.ok(toggles.every(node => node.tag === "wx-button" && node.attr.ariaExpanded === true && node.attr.ariaControls));
  assert.doesNotMatch(content, /前往加入牌桌|前往创建牌桌/);
  m.p.onUnload();
});

test("公开规则请求不访问登录存储、不发送 Authorization，也不因401清除用户会话", async () => {
  const calls = [], mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "api.js"), "utf8"), {
    module: mod, require: name => name === "./config" ? { baseUrl: "https://example.test" } : { begin() {}, finish() {} },
    wx: { getStorageSync() { throw Error("不允许读取会话"); }, removeStorageSync() { throw Error("不允许清除会话"); }, request: options => calls.push(options) },
  });
  const first = mod.exports.publicRequest("/api/boards");
  assert.equal(calls[0].header.Authorization, undefined);
  calls[0].success({ statusCode: 200, data: { boards: [] } }); await first;
  const second = mod.exports.publicRequest("/api/scoring/rules"), rejected = assert.rejects(second, /无权限/);
  calls[1].success({ statusCode: 401, data: { error: "无权限" } }); await rejected;
  await assert.rejects(mod.exports.publicRequest("/api/me/profile"), /不支持/);
  assert.equal(calls.length, 2);
});

test("建桌跳转失败清除一次性请求，既有返回首页选项照常传递", () => {
  const app = {}, calls = [], mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "tab-navigation.js"), "utf8"), {
    module: mod, getApp: () => app, wx: { switchTab: options => calls.push(options) },
  });
  let failed = false;
  mod.exports.switchHomeTab(0, { entry: { mode: "create", board: "knights", capacity: 12 }, fail: () => { failed = true; } });
  assert.equal(app.homeTabRequest.entry.board, "knights");
  assert.equal(calls[0].entry, undefined);
  calls[0].fail({ errMsg: "failed" });
  assert.equal(app.homeTabRequest, undefined);
  assert.equal(failed, true);
  const success = () => {};
  mod.exports.switchHomeTab(1, { success });
  assert.equal(calls[1].success, success);
  assert.equal(calls[1].url, "/pages/me/me");
  assert.equal(app.homeTabRequest.entry, undefined);
});
