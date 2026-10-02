const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cards = require("../miniprogram/share-card");
const fixtures = require("./helpers/share-fixtures");
const copy = value => structuredClone(value);

test("战绩图片只投影本人摘要，保留有效局数与计分连胜口径，不导出私人明细", () => {
  const card = cards.statsCard(fixtures.profile, fixtures.stats, fixtures.now);
  assert.equal(card.hero, "62.5%");
  assert.deepEqual(card.details, ["30 胜 / 48 局", "最高 5 连胜 · 计分局"]);
  assert.doesNotMatch(JSON.stringify(card), /must-not-export|recent|members|uid|manualAdjustment|leaderboardVisible/);
  const original = JSON.stringify(card);
  const stats = copy(fixtures.stats), profile = copy(fixtures.profile);
  stats.total = 100; profile.nickname = "改名";
  assert.equal(JSON.stringify(card), original);
  assert.throws(() => cards.statsCard(profile, { total: 0 }, fixtures.now), /没有有效战绩/);
  assert.equal(cards.statsCard(profile, { ...stats, score: null }, fixtures.now).details.length, 1);
});
test("趣味图片仅输出所选正向指标，区分未知、真实零和无机会，附已知与未知样本", () => {
  const stats = copy(fixtures.stats), metric = stats.fun.cards[0].metrics[0];
  const create = () => cards.funCard(fixtures.profile, stats, "classic:merlin", "merlin_evade", fixtures.now);
  assert.equal(create().hero, "8");
  assert.deepEqual(create().details, ["80% 成功率 · 10 次机会", "10 局有记录 · 2 局未记录"]);
  Object.assign(metric, { count: 0, value: 0, rate: 0 });
  assert.equal(create().hero, "0");
  assert.match(create().details[0], /^0%/);
  Object.assign(metric, { opportunities: 0, rate: null });
  assert.equal(create().details[0], "暂无有效机会");
  Object.assign(metric, { value: null, knownGames: 0 });
  assert.throws(create, /没有完整记录/);
  Object.assign(metric, { value: 1, knownGames: 1, ranked: false });
  assert.throws(create, /没有完整记录/);
});
test("排名图片保留服务端并列名次、月份与计分样本，前三位不导出标识或第四位", () => {
  const top = cards.leaderboardCard(fixtures.profile, fixtures.board, "top");
  assert.equal(top.context, "2026 年 10 月");
  assert.deepEqual(top.rows.map(row => row.rank), [1, 1, 3]);
  assert.equal(top.rows[2].sample, "24 场计分局");
  assert.doesNotMatch(JSON.stringify(top), /private-version|not-needed|should-not-appear|小林.*avatar/);
  const mine = cards.leaderboardCard(fixtures.profile, fixtures.board, "mine");
  assert.equal(mine.hero, "第 3 名");
  assert.equal(mine.details[0], "286 分");
  assert.throws(() => cards.leaderboardCard(fixtures.profile, { ...fixtures.board, me: { ...fixtures.board.me, status: "hidden" } }, "mine"), /未上榜/);
  assert.throws(() => cards.leaderboardCard(fixtures.profile, { ...fixtures.board, rows: [] }, "top"), /没有玩家/);
  assert.equal(cards.shanghaiTime(Date.UTC(2026, 8, 30, 16)), "2026.10.01 00:00");
});
test("趣味榜图片完整带上指标、排序、角色、玩法和周期，百分比不混用胜率", () => {
  const board = { ...fixtures.board, fun: true, metric: "fun_knife_enemy", title: "轮内刀法", metricLabel: "命中敌方率", mode: "knights", role: "gareth", roleOptions: [{ id: "gareth", label: "加雷斯" }], sort: "rate", unit: "%", threshold: 10,
    me: { status: "ranked", rank: 2, rate: 62.5, count: 10, opportunities: 16, winRate: 50 } };
  const selection = cards.boardSelection(board);
  assert.deepEqual(cards.parseSelection(selection), selection);
  assert.deepEqual(selection, { kind: "leaderboard", metric: "fun_knife_enemy", period: "month", mode: "knights", sort: "rate", role: "gareth" });
  const card = cards.leaderboardCard(fixtures.profile, board, "mine");
  assert.equal(card.title, "命中敌方率榜");
  assert.match(card.scope, /轮内刀法 · 十二骑士 · 加雷斯 · 至少 10 次机会/);
  assert.deepEqual(card.details, ["62.5%", "10 / 16 次机会"]);
  assert.throws(() => cards.parseSelection({ ...selection, role: "../secret" }), /筛选无效/);
  assert.throws(() => cards.parseSelection({ kind: "somebody", uid: "other" }), /无效/);
});

function page({ api, render, overrides = {} } = {}) {
  let definition, renderCount = 0;
  const sent = [], saved = [], previews = [], notices = [];
  const wx = { canIUse: () => true,
    showShareImageMenu: options => { sent.push(options); },
    saveImageToPhotosAlbum: options => { saved.push(options); },
    previewImage: options => previews.push(options), showToast: options => notices.push(options), ...overrides };
  const requests = [];
  const mockApi = api || { login: async () => {}, request: async url => {
    requests.push(url);
    return copy(url.includes("/profile") ? fixtures.profile : url.includes("/leaderboard") ? fixtures.board : fixtures.stats);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/pages/share/share.js"), "utf8"), {
    wx, Page: p => { definition = p; }, Date,
    require: name => name === "../../api" ? mockApi : name === "../../share-card" ? cards : name === "../../profile" ? { backToMe() {} }
      : { renderImage: async (p, card) => { renderCount++; return render ? render(p, card) : "wxfile://image-" + renderCount; } },
  });
  const p = { ...definition, data: copy(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  return { p, sent, saved, previews, notices, requests, renderCount: () => renderCount };
}
test("预览与发送、保存使用完全相同的本地图片，准备完成前不发送，取消不报错", async () => {
  const { p, sent, saved, previews, requests, renderCount } = page();
  await p.onLoad({ kind: "stats" });
  p.send(); p.save(); assert.equal(sent.length + saved.length, 0);
  assert.equal(renderCount(), 0);
  await p.onReady();
  const path = p.data.imagePath;
  p.preview(); assert.deepEqual(Array.from(previews[0].urls), [path]);
  p.send(); p.send(); assert.equal(sent.length, 1); assert.equal(sent[0].path, path);
  sent[0].fail({ errMsg: "showShareImageMenu:fail cancel" }); sent[0].complete();
  assert.equal(p.data.actionError, "");
  p.save(); assert.equal(saved[0].filePath, path); saved[0].complete();
  assert.deepEqual(requests.sort(), ["/api/me/profile", "/api/me/stats"]);
});
test("榜单预览重新读取首屏，切换期间禁用发送；隐藏本人不显示虚构名次", async () => {
  let finish;
  const { p, sent, requests } = page({ render: async () => new Promise(resolve => { finish = resolve; }) });
  await p.onLoad(cards.boardSelection(fixtures.board));
  const first = p.onReady(); finish("wxfile://mine"); await first;
  const next = p.chooseMode({ currentTarget: { dataset: { mode: "top" } } });
  assert.equal(p.data.imagePath, ""); assert.equal(p.data.rendering, true);
  p.send(); assert.equal(sent.length, 0);
  finish("wxfile://top"); await next;
  p.imageError({currentTarget:{dataset:{path:"wxfile://mine"}}});
  assert.equal(p.data.imagePath,"wxfile://top");
  p.send(); assert.equal(sent[0].path, "wxfile://top");
  assert.equal(requests.find(url => url.includes("leaderboard")), "/api/leaderboard?metric=points&period=month");
  const hidden = page({ api: { login: async () => {}, request: async url => url.includes("profile") ? fixtures.profile : { ...fixtures.board, me: { status: "hidden", rank: null } } } });
  await hidden.p.onLoad(cards.boardSelection(fixtures.board)); await hidden.p.onReady();
  assert.equal(hidden.p.data.mode, "top"); assert.equal(hidden.p.data.canShareMine, false);
});
test("网络失败可重试，卸载后的响应不生成图片或改变页面", async () => {
  let fail = true, release;
  const { p, renderCount } = page({ api: { login: async () => {}, request: async url => {
    if (fail) throw new Error("网络中断");
    if (url.includes("profile")) return fixtures.profile;
    return new Promise(resolve => { release = resolve; });
  } } });
  await p.onLoad({ kind: "stats" }); await p.onReady();
  assert.equal(p.data.error, "网络中断"); assert.equal(p.data.imagePath, "");
  fail = false;
  const pending = p.retry(); await new Promise(resolve => setImmediate(resolve));
  p.onUnload(); release(fixtures.stats); await pending;
  assert.equal(renderCount(), 0); assert.equal(p.data.imagePath, "");
});
test("图片生成失败可单独重试，不重新读取或变更这份成绩", async () => {
  let fail = true;
  const { p, requests } = page({ render: async () => { if (fail) throw new Error("导出失败"); return "wxfile://retry"; } });
  await p.onLoad({ kind: "stats" }); await p.onReady();
  const description = p.data.description;
  assert.equal(p.data.error, "导出失败");
  fail = false; await p.retry();
  assert.equal(requests.length, 2); assert.equal(p.data.description, description); assert.equal(p.data.imagePath, "wxfile://retry");
});
test("不支持图片分享时提供保存；相册拒绝可恢复，发送失败不宣称成功", async () => {
  const { p, saved } = page({ overrides: { showShareImageMenu: undefined, openSetting: options => options.success({ authSetting: { "scope.writePhotosAlbum": true } }) } });
  await p.onLoad({ kind: "stats" }); await p.onReady();
  assert.equal(p.data.imageMenu, false); p.send(); assert.match(p.data.actionError, /保存图片/);
  p.save(); saved[0].fail({ errMsg: "saveImageToPhotosAlbum:fail auth deny" }); saved[0].complete();
  assert.doesNotMatch(p.data.actionError, /直接发给好友/);
  assert.equal(p.data.albumDenied, true); p.openAlbumSettings(); assert.equal(p.data.albumDenied, false);
  const other = page(); await other.p.onLoad({ kind: "stats" }); await other.p.onReady();
  other.p.send(); other.sent[0].fail({ errMsg: "fail unsupported" }); other.sent[0].complete();
  assert.match(other.p.data.actionError, /暂时无法发送/); assert.equal(other.notices.length, 0);
});
test("原生 Canvas 导出固定尺寸 PNG，头像失败使用昵称回退", async () => {
  const drawing = [], context = { fillRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, clip() {}, measureText: text => ({ width: text.length * 20 }), fillText: text => drawing.push(text), drawImage() { throw Error("failed avatar must not be drawn"); } };
  const canvas = { getContext: () => context, createImage: () => ({ set src(value) { this.onerror(); } }) };
  let exported;
  const wx = { createSelectorQuery() { const query = { in() { return query; }, select() { return query; }, fields() { return query; }, exec(callback) { callback([{ node: canvas }]); } }; return query; },
    canvasToTempFilePath(options) { exported = options; options.success({ tempFilePath: "wxfile://native" }); } };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/share-image.js"), "utf8"), { module: mod, wx, setTimeout, clearTimeout,
    require: name => name === "./api" ? { assetUrl: value => "https://example.test" + value } : cards });
  const card = cards.statsCard({ ...fixtures.profile, avatarUrl: "/api/avatars/" + "a".repeat(64) }, fixtures.stats, fixtures.now);
  assert.equal(await mod.exports.renderImage({ alive: true }, card), "wxfile://native");
  assert.equal(canvas.width, 1080); assert.equal(canvas.height, 1080);
  assert.equal(exported.destWidth, 1080); assert.equal(exported.fileType, "png"); assert.ok(drawing.includes("小"));
});
