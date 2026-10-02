const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cards = require("../miniprogram/share-card");
const fixtures = require("./helpers/share-fixtures");
const copy = value => structuredClone(value);

test("战绩图片只投影本人摘要，保留有效局数与计分连胜口径，不导出私人明细", () => {
  const stats = copy(fixtures.stats), profile = copy(fixtures.profile);
  const card = cards.statsCard(profile, stats, fixtures.now);
  assert.equal(card.hero + card.unit, "62.5%");
  assert.deepEqual(card.metrics.map(item => item.value), ["48", "30", "18"]);
  assert.deepEqual(card.highlight, { label: "连胜纪录", value: "5 连胜", details: ["计分局口径", "全部时间"] });
  assert.doesNotMatch(JSON.stringify(card), /must-not-export|recent|members|uid|manualAdjustment|leaderboardVisible/);
  const original = JSON.stringify(card);
  stats.total = 100; profile.nickname = "改名";
  assert.equal(JSON.stringify(card), original);
  assert.throws(() => cards.statsCard(profile, { total: 0 }, fixtures.now), /没有有效战绩/);
  const plain = cards.statsCard(profile, { ...stats, score: null }, fixtures.now);
  assert.equal(plain.highlight, null);
  assert.ok(cards.dimensions(plain).height < cards.dimensions(card).height);
});
test("角色亮点合并同名角色的阵营样本，至少十局且胜率至少五成；不足时不虚构称号", () => {
  const stats = copy(fixtures.stats);
  stats.byRole = [{role:"梅林",total:8,wins:7,faction:"good"},{role:"梅林",total:2,wins:1,faction:"evil"},
    {role:"刺客",total:2,wins:2},{role:"未知角色",total:100,wins:100}];
  const card = cards.statsCard(fixtures.profile, stats, fixtures.now);
  assert.deepEqual(card.highlight, {label:"角色亮点",value:"梅林",details:["80% 胜率","8 胜 / 10 局"]});
  assert.match(cards.describe(card), /角色亮点，梅林，80% 胜率/);
  stats.byRole = [{role:"梅林",total:10,wins:4}]; stats.score.best=1;
  assert.equal(cards.statsCard(fixtures.profile, stats, fixtures.now).highlight, null);
});
test("趣味图片仅输出所选正向指标，区分未知、真实零和无机会，附已知与未知样本", () => {
  const stats = copy(fixtures.stats), metric = stats.fun.cards[0].metrics[0];
  const create = () => cards.funCard(fixtures.profile, stats, "classic:merlin", "merlin_evade", fixtures.now);
  assert.equal(create().hero, "8");
  assert.equal(create().chart.value, "80%");
  assert.match(cards.describe(create()), /成功率 80%/);
  assert.deepEqual(create().metrics.map(item=>item.value), ["10", "10"]);
  assert.match(create().notes.join(), /2 局未记录/);
  Object.assign(metric, { count: 0, value: 0, rate: 0 });
  assert.equal(create().hero, "0");
  assert.equal(create().chart.value, "0%");
  Object.assign(metric, { opportunities: 0, rate: null });
  assert.match(create().notes[0], /暂无有效机会/);
  assert.equal(create().chart.ratio, null);
  Object.assign(metric, { value: null, knownGames: 0 });
  assert.throws(create, /没有完整记录/);
  Object.assign(metric, { value: 1, knownGames: 1, ranked: false });
  assert.throws(create, /没有完整记录/);
});
test("排名图片突出本人成绩、真实名次及同周期样本，不导出其他玩家和标识", () => {
  const mine = cards.leaderboardCard(fixtures.profile, fixtures.board);
  assert.equal(mine.context, "2026 年 10 月 · 积分榜");
  assert.equal(mine.hero + mine.unit, "286分");
  assert.equal(mine.rank, 3);
  assert.deepEqual(mine.metrics.map(item=>[item.value,item.label]), [["24","计分局数"],["15","计分局胜场"],["62.5%","计分局胜率"]]);
  assert.doesNotMatch(JSON.stringify(mine), /private-version|not-needed|should-not-appear|晚风|北川|publicId|rows/);
  assert.equal(cards.leaderboardCard(fixtures.profile, {...fixtures.board, me:{...fixtures.board.me,rank:1}}).rank,1);
  const hidden = cards.leaderboardCard(fixtures.profile, { ...fixtures.board, rows: [], me: { ...fixtures.board.me, status: "hidden" } });
  assert.equal(hidden.rank, null); assert.equal(hidden.rankLabel, "未公开"); assert.equal(hidden.hero,"286");
  assert.ok(cards.canShareLeaderboard({...fixtures.board,rows:[]}));
  assert.equal(cards.canShareLeaderboard({...fixtures.board,me:{total:0,points:0}}),false);
  assert.throws(() => cards.leaderboardCard(fixtures.profile, { ...fixtures.board, me:{total:0,points:0} }), /本人成绩/);
  const adjusted = cards.leaderboardCard(fixtures.profile, {...fixtures.board,me:{status:"no_games",rank:null,total:0,wins:0,points:-5,winRate:null,remaining:1}});
  assert.equal(adjusted.hero,"-5");assert.equal(adjusted.rankLabel,"未上榜");assert.equal(adjusted.metrics[2].value,"—");
  assert.equal(cards.shanghaiTime(Date.UTC(2026, 8, 30, 16)), "2026.10.01 00:00");
});
test("趣味榜图片完整带上指标、排序、角色、玩法和周期，百分比不混用胜率", () => {
  const board = { ...fixtures.board, fun: true, metric: "fun_knife_enemy", title: "轮内刀法", metricLabel: "命中敌方率", mode: "knights", role: "gareth", roleOptions: [{ id: "gareth", label: "加雷斯" }], sort: "rate", unit: "%", threshold: 10,
    me: { status: "ranked", rank: 2, rate: 62.5, count: 10, opportunities: 16, knownGames: 12, unknownGames: 2, winRate: 50 } };
  const selection = cards.boardSelection(board);
  assert.deepEqual(cards.parseSelection(selection), selection);
  assert.deepEqual(selection, { kind: "leaderboard", metric: "fun_knife_enemy", period: "month", mode: "knights", sort: "rate", role: "gareth" });
  const card = cards.leaderboardCard(fixtures.profile, board);
  assert.match(card.context, /命中敌方率榜/);
  assert.equal(card.scope, "轮内刀法 · 十二骑士 · 加雷斯");
  assert.equal(card.hero + card.unit, "62.5%");
  assert.deepEqual(card.metrics.map(item=>item.value), ["10","16","12"]);
  assert.match(card.notes.join(), /至少 10 次有效机会/);
  const pending = cards.leaderboardCard(fixtures.profile, {...board,me:{...board.me,status:"not_enough",rank:null,opportunities:4,count:2,rate:50,remaining:6}});
  assert.equal(pending.rankLabel,"未上榜");assert.equal(pending.hero,"50");assert.match(pending.notes.join(),/尚未达到上榜条件 · 还差 6 次/);
  assert.equal(cards.canShareLeaderboard({...board,me:{knownGames:2,opportunities:0,rate:null}}),false);
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
test("榜单预览直接生成本人成绩，生成期间禁用发送；隐藏本人仍可分享且不虚构名次", async () => {
  let finish;
  const { p, sent, requests } = page({ render: async () => new Promise(resolve => { finish = resolve; }) });
  await p.onLoad(cards.boardSelection(fixtures.board));
  const first = p.onReady();
  assert.equal(p.data.imagePath, ""); assert.equal(p.data.rendering, true);
  p.send(); assert.equal(sent.length, 0);
  finish("wxfile://mine"); await first;
  p.imageError({currentTarget:{dataset:{path:"wxfile://old"}}});
  assert.equal(p.data.imagePath,"wxfile://mine");
  p.send(); assert.equal(sent[0].path, "wxfile://mine");
  assert.equal(p.chooseMode, undefined);
  assert.doesNotMatch(p.data.description, /晚风|北川|前三位/);
  assert.equal(requests.find(url => url.includes("leaderboard")), "/api/leaderboard?metric=points&period=month");
  const hidden = page({ api: { login: async () => {}, request: async url => url.includes("profile") ? fixtures.profile : { ...fixtures.board, rows:[], me: { ...fixtures.board.me, status: "hidden", rank: null } } } });
  await hidden.p.onLoad(cards.boardSelection(fixtures.board)); await hidden.p.onReady();
  assert.ok(hidden.p.data.imagePath); assert.match(hidden.p.data.description, /未公开/); assert.doesNotMatch(hidden.p.data.description,/第 3 名/);
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
test("原生 Canvas 按内容高度导出 PNG，头像失败使用昵称回退", async () => {
  const drawing = [], context = { fillRect() {}, strokeRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText: text => ({ width: text.length * 20 }), fillText: text => drawing.push(text), drawImage() { throw Error("failed avatar must not be drawn"); } };
  const canvas = { getContext: () => context, createImage: () => ({ set src(value) { this.onerror(); } }) };
  let exported;
  const wx = { createSelectorQuery() { const query = { in() { return query; }, select() { return query; }, fields() { return query; }, exec(callback) { callback([{ node: canvas }]); } }; return query; },
    canvasToTempFilePath(options) { exported = options; options.success({ tempFilePath: "wxfile://native" }); } };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/share-image.js"), "utf8"), { module: mod, wx, setTimeout, clearTimeout,
    require: name => name === "./api" ? { assetUrl: value => "https://example.test" + value } : cards });
  const card = cards.statsCard({ ...fixtures.profile, avatarUrl: "/api/avatars/" + "a".repeat(64) }, fixtures.stats, fixtures.now);
  assert.equal(await mod.exports.renderImage({ alive: true }, card), "wxfile://native");
  assert.equal(canvas.width, 1080); assert.equal(canvas.height, 944);
  assert.equal(exported.destWidth, 1080); assert.equal(exported.destHeight,944);
  assert.equal(exported.height,canvas.height);assert.equal(exported.fileType, "png"); assert.ok(drawing.includes("小"));
});
