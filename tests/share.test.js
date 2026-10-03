const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cards = require("../miniprogram/share-card");
const fixtures = require("./helpers/share-fixtures");
const copy = value => structuredClone(value);

test("战绩图片展示阵营及按局数选择的四个角色，剩余角色汇总，不导出私人明细", () => {
  const stats = copy(fixtures.stats), profile = copy(fixtures.profile);
  const card = cards.statsCard(profile, stats, fixtures.now);
  assert.equal(card.hero + card.unit, "62.5%");
  assert.deepEqual(card.metrics.map(item => item.value), ["48", "30", "18"]);
  assert.deepEqual(card.factions.map(row=>[row.label,row.total,row.rate]),[["好人",30,"70%"],["坏人",18,"50%"]]);
  assert.equal(card.roles.length,4);assert.deepEqual(card.roles.map(row=>row.total),[12,10,10,8]);
  assert.equal(card.roles[0].label,"梅林");assert.equal(card.roles[0].rate,"75%");
  assert.deepEqual([card.otherRoles.total,card.otherRoles.wins,card.otherRoles.losses],[8,5,3]);
  assert.match(cards.describe(card),/好人 30 局，21 胜 9 负，胜率 70%/);
  assert.match(cards.describe(card),/其他角色 8 局/);
  assert.doesNotMatch(JSON.stringify(card), /must-not-export|recent|members|uid|manualAdjustment|leaderboardVisible/);
  const original = JSON.stringify(card);
  stats.total = 100; stats.byRole[0].wins=0; profile.nickname = "改名";
  assert.equal(JSON.stringify(card), original);
  assert.throws(() => cards.statsCard(profile, { total: 0 }, fixtures.now), /没有有效战绩/);
  const plain = cards.statsCard(profile, { ...stats, byFaction:[],byRole:[] }, fixtures.now);
  assert.deepEqual(plain.roles,[]);
  assert.ok(cards.dimensions(plain).height < cards.dimensions(card).height);
});
test("角色合并不同最终阵营，小样本和零胜率照实呈现，未知样本不冒充已知角色", () => {
  const stats = copy(fixtures.stats);
  stats.byRole = [{role:"梅林",total:8,wins:7,faction:"good"},{role:"梅林",total:2,wins:1,faction:"evil"},
    {role:"刺客",total:2,wins:0},{role:"未知角色",total:3,wins:1},{role:"无效",total:1,wins:2}];
  stats.byFaction.push({faction:"third",total:1,wins:1},{faction:"unknown",total:0,wins:0});
  const card = cards.statsCard(fixtures.profile, stats, fixtures.now);
  assert.deepEqual(card.roles.map(row=>[row.label,row.total,row.wins,row.rate]),[["梅林",10,8,"80%"],["刺客",2,0,"0%"]]);
  assert.equal(card.otherRoles,null);assert.match(card.notes.join(),/3 局未记录角色/);
  assert.equal(card.factions[2].label,"第三阵营");assert.equal(card.factions[2].rate,"100%");
  assert.equal(card.factions.length,3);assert.equal(card.highlight,undefined);
  const small=cards.statsCard(fixtures.profile,{total:2,wins:1,losses:1,winRate:50,byRole:[{role:"梅林",total:1,wins:1},{role:"刺客",total:1,wins:0}]},fixtures.now);
  assert.deepEqual(small.roles.map(row=>row.total),[1,1]);
  assert.ok(cards.dimensions(small).height<cards.dimensions(card).height);
});
test("趣味图片仅输出所选正向指标，区分未知、真实零和无机会，不展示未记录局数说明", () => {
  const stats = copy(fixtures.stats), metric = stats.fun.cards[0].metrics[0];
  const create = () => cards.funCard(fixtures.profile, stats, "classic:merlin", "merlin_evade", fixtures.now);
  assert.equal(create().hero, "8");
  assert.equal(create().chart.value, "80%");
  assert.match(cards.describe(create()), /成功率 80%/);
  assert.deepEqual(create().metrics.map(item=>item.value), ["10", "10"]);
  assert.deepEqual(create().notes, []);
  assert.doesNotMatch(cards.describe(create()), /另有.*未记录/);
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
test("排名图片保留附近玩家并隐藏分区标题", () => {
  const mine = cards.leaderboardCard(fixtures.profile, fixtures.board);
  assert.equal(mine.title, "积分榜");
  assert.equal(mine.context, "2026 年 10 月");
  assert.equal(mine.hero + mine.unit, "286分");
  assert.equal(mine.rank, 8);
  assert.doesNotMatch(cards.describe(mine), /我的附近/);
  assert.deepEqual(mine.nearby.map(row=>row.rank),[6,7,8,9,10]);
  assert.match(cards.describe(mine), /晚风.*小林（我）.*北川/);
  assert.deepEqual(mine.metrics.map(item=>[item.value,item.label]), [["24","计分局数"],["15","计分局胜场"],["62.5%","计分局胜率"]]);
  assert.doesNotMatch(JSON.stringify(mine), /private-version|not-needed|should-not-appear|publicId|rows/);
  assert.equal(cards.leaderboardCard(fixtures.profile, {...fixtures.board, me:{...fixtures.board.me,rank:1}}).rank,1);
  const hidden = cards.leaderboardCard(fixtures.profile, { ...fixtures.board, rows: [], me: { ...fixtures.board.me, status: "hidden" } });
  assert.equal(hidden.rank, null); assert.equal(hidden.rankLabel, "未公开"); assert.equal(hidden.hero,"286");
  assert.deepEqual(hidden.nearby,[]);assert.equal(hidden.gap,"");
  assert.ok(cards.canShareLeaderboard({...fixtures.board,rows:[]}));
  assert.equal(cards.canShareLeaderboard({...fixtures.board,me:{total:0,points:0}}),false);
  assert.throws(() => cards.leaderboardCard(fixtures.profile, { ...fixtures.board, me:{total:0,points:0} }), /本人成绩/);
  const adjusted = cards.leaderboardCard(fixtures.profile, {...fixtures.board,me:{status:"no_games",rank:null,total:0,wins:0,points:-5,winRate:null,remaining:1}});
  assert.equal(adjusted.hero,"-5");assert.equal(adjusted.rankLabel,"未上榜");assert.equal(adjusted.metrics[2].value,"—");
  assert.equal(cards.shanghaiTime(Date.UTC(2026, 8, 30, 16)), "2026.10.01 00:00");
});
test("缺少完整本人邻近数据时保留个人卡，并列或百分比榜不制造分差", () => {
  const board=copy(fixtures.board), build=()=>cards.leaderboardCard(fixtures.profile,board);
  board.nearby[1].points=286;board.nearby[1].rank=8;
  assert.equal(build().gap,"");assert.equal(build().nearby[1].rank,8);
  board.metric='overall';board.me.winRate=62.5;
  board.nearby.forEach(row=>row.winRate=row.isSelf?62.5:75);
  assert.equal(build().gap,"");assert.equal(build().nearby[2].value,"62.5");
  board.nearby[2].rank=99;assert.deepEqual(build().nearby,[]);
  delete board.nearby;assert.deepEqual(build().nearby,[]);assert.equal(build().hero,"62.5");
});
test("趣味榜图片完整带上指标、排序、角色、玩法和周期，百分比不混用胜率", () => {
  const board = { ...fixtures.board, fun: true, metric: "fun_knife_enemy", title: "刀客刀法", metricLabel: "命中敌方率", mode: "knights", role: "gareth", roleOptions: [{ id: "gareth", label: "加雷斯" }], sort: "rate", unit: "%", threshold: 10,
    me: { status: "ranked", rank: 2, rate: 62.5, count: 10, opportunities: 16, knownGames: 12, unknownGames: 2, winRate: 50 } };
  const selection = cards.boardSelection(board);
  assert.deepEqual(cards.parseSelection(selection), selection);
  assert.deepEqual(selection, { kind: "leaderboard", metric: "fun_knife_enemy", period: "month", mode: "knights", sort: "rate", role: "gareth" });
  const card = cards.leaderboardCard(fixtures.profile, board);
  assert.match(card.title, /命中敌方率榜/);
  assert.equal(card.scope, "刀客刀法 · 十二骑士 · 加雷斯");
  assert.equal(card.hero + card.unit, "62.5%");
  assert.deepEqual(card.metrics.map(item=>item.value), ["10","16","12"]);
  assert.match(card.notes.join(), /至少 10 次有效机会/);
  const pending = cards.leaderboardCard(fixtures.profile, {...board,me:{...board.me,status:"not_enough",rank:null,opportunities:4,count:2,rate:50,remaining:6}});
  assert.equal(pending.rankLabel,"未上榜");assert.equal(pending.hero,"50");assert.match(pending.notes.join(),/尚未达到上榜条件 · 还差 6 次有效机会/);
  assert.equal(cards.canShareLeaderboard({...board,me:{knownGames:2,opportunities:0,rate:null}}),false);
  assert.throws(() => cards.parseSelection({ ...selection, role: "../secret" }), /筛选无效/);
  assert.throws(() => cards.parseSelection({ kind: "somebody", uid: "other" }), /无效/);
});
test("分享资格由本人成绩决定，未上榜与真实零次可分享，无记录或无成功率给出一致原因", () => {
  const board={metric:"fun_good_shield",metricLabel:"成功挡刀次数",fun:true,sort:"count",unit:"次",period:"all",me:{status:"not_enough",knownGames:2,count:0,opportunities:0,rate:null,remaining:1}};
  assert.equal(cards.leaderboardShareError(board),"");
  const card=cards.leaderboardCard(fixtures.profile,board);
  assert.equal(card.hero,"0");assert.equal(card.rankLabel,"未上榜");
  assert.match(card.notes.join(),/还差 1 次/);
  const rate={...board,sort:"rate"};
  assert.match(cards.leaderboardShareError(rate),/暂无有效机会.*次数榜/);
  assert.throws(()=>cards.leaderboardCard(fixtures.profile,rate),{message:cards.leaderboardShareError(rate)});
  const empty={...board,me:{...board.me,knownGames:0}};
  assert.match(cards.leaderboardShareError(empty),/暂无本人成绩.*完成相关对局/);
  assert.throws(()=>cards.leaderboardCard(fixtures.profile,empty),{message:cards.leaderboardShareError(empty)});
  const small={metric:"overall",period:"all",me:{status:"not_enough",rank:null,total:2,wins:1,winRate:50,remaining:8}};
  assert.equal(cards.leaderboardShareError(small),"");
  assert.match(cards.leaderboardCard(fixtures.profile,small).notes.join(),/还差 8 局/);
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
  assert.doesNotMatch(p.data.description, /我的附近/);
  assert.match(p.data.description, /晚风.*北川/);
  assert.doesNotMatch(p.data.description, /前三位|should-not-appear/);
  assert.equal(requests.find(url => url.includes("leaderboard")), "/api/leaderboard?metric=points&period=month&nearby=1");
  const hidden = page({ api: { login: async () => {}, request: async url => url.includes("profile") ? fixtures.profile : { ...fixtures.board, rows:[], me: { ...fixtures.board.me, status: "hidden", rank: null } } } });
  await hidden.p.onLoad(cards.boardSelection(fixtures.board)); await hidden.p.onReady();
  assert.ok(hidden.p.data.imagePath); assert.match(hidden.p.data.description, /未公开/); assert.doesNotMatch(hidden.p.data.description,/第 8 名|晚风/);
});
test("旧服务拒绝附近参数时退回个人卡；普通网络故障不会掩盖为成功", async () => {
  let calls=[];
  const {p}=page({api:{login:async()=>{},request:async url=>{
    calls.push(url);if(url.includes('profile'))return fixtures.profile;
    if(url.includes('nearby'))throw Object.assign(Error('排行榜参数无效，请刷新后重试'),{status:400});
    const board=copy(fixtures.board);delete board.nearby;return board;
  }}});
  await p.onLoad(cards.boardSelection(fixtures.board));await p.onReady();
  assert.ok(p.data.imagePath);assert.equal(calls.length,3);assert.doesNotMatch(p.data.description,/我的附近/);
  calls=[];
  const broken=page({api:{login:async()=>{},request:async url=>{calls.push(url);if(url.includes('profile'))return fixtures.profile;throw Object.assign(Error('网络中断'),{status:500});}}});
  await broken.p.onLoad(cards.boardSelection(fixtures.board));await broken.p.onReady();
  assert.equal(calls.length,2);assert.equal(broken.p.data.error,'网络中断');assert.equal(broken.p.data.imagePath,'');
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
  const drawing = [], context = { fillRect() {}, strokeRect() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText: text => ({ width: text.length * 20 }), fillText: text => drawing.push(text), drawImage() { throw Error("failed avatar must not be drawn"); } };
  const canvas = { getContext: () => context, createImage: () => ({ set src(value) { this.onerror(); } }) };
  let exported;
  const wx = { createSelectorQuery() { const query = { in() { return query; }, select() { return query; }, fields() { return query; }, exec(callback) { callback([{ node: canvas }]); } }; return query; },
    canvasToTempFilePath(options) { exported = options; options.success({ tempFilePath: "wxfile://native" }); } };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/share-image.js"), "utf8"), { module: mod, wx, setTimeout, clearTimeout,
    require: name => name === "./api" ? { assetUrl: value => "https://example.test" + value } : cards });
  const card = cards.statsCard({ ...fixtures.profile, avatarUrl: "/api/avatars/" + "a".repeat(64) }, fixtures.stats, fixtures.now);
  assert.equal(await mod.exports.renderImage({ alive: true }, card), "wxfile://native");
  assert.equal(canvas.width, 1080); assert.equal(canvas.height, cards.dimensions(card).height);
  assert.equal(exported.destWidth, 1080); assert.equal(exported.destHeight,cards.dimensions(card).height);
  assert.equal(exported.height,canvas.height);assert.equal(exported.fileType, "png"); assert.ok(drawing.includes("小"));
});


test("趣味分享接收小程序编码和未编码的卡片参数，并完成挡刀及刀客图片生成", async () => {
  const aggregate = require("../server/fun").aggregate;
  const stats = { fun: aggregate([
    { match_id: 'm1', mode: 'knights', metric: 'good_shield', role: 'servant', role_label: '忠臣', status: 'known', count: 1, opportunities: 1 },
    { match_id: 'm1', mode: 'knights', metric: 'knife_enemy', role: 'gareth', role_label: '加雷斯', status: 'known', count: 0, opportunities: 1 },
  ]) };
  for (const card of stats.fun.cards) for (const encoded of [true, false]) {
    const { p, renderCount } = page({ api: { login: async () => {}, request: async url => url.includes('profile') ? fixtures.profile : stats } });
    await p.onLoad({ kind: 'fun', card: encoded ? encodeURIComponent(card.id) : card.id, metric: card.metrics[0].id });
    await p.onReady();
    assert.equal(p.data.error, '');
    assert.ok(p.data.imagePath);assert.equal(renderCount(), 1);
    assert.match(p.data.description, /成功挡刀|刀客刀法/);
    assert.doesNotMatch(p.data.description, /好人/);
    assert.doesNotMatch(p.data.description, /十二骑士/);
  }
  for (const card of ['knights%3', 'knights%253Ashield', '../shield', 'knights:shield?uid=other']) {
    assert.throws(() => cards.parseSelection({kind: 'fun',card,metric:'good_shield'}), /分享内容无效/);
  }
});

test("分享榜单突出标题，全部时间及全部玩法不输出，未知局数不输出", () => {
  const card = cards.leaderboardCard(fixtures.profile, { ...fixtures.board, period: 'all', fun: true, metric: 'fun_good_shield', title: '好人', metricLabel: '成功挡刀次数', mode: 'all', sort: 'count', unit: '次',
    me: { status: 'ranked', rank: 1, count: 1, rate: 100, opportunities: 1, knownGames: 1, unknownGames: 2 },
    nearby: [{rank:1,isSelf:true,nickname:'小林',count:1}] });
  assert.equal(card.title, '成功挡刀次数榜');assert.equal(card.context, '');assert.equal(card.scope, '');
  assert.deepEqual(card.notes, []);
  assert.doesNotMatch(cards.describe(card), /全部时间|全部玩法|好人|非梅林|我的附近|另有.*未记录/);
  assert.equal(card.metrics[2].value, '1');
});

test("附近玩家头像保留安全地址，本人行使用当前头像，非法图片地址不进入画布", () => {
  const avatar = "/api/avatars/" + "a".repeat(64), nearbyAvatar = "/api/avatars/" + "b".repeat(64);
  const board = copy(fixtures.board);
  board.nearby[0].avatarUrl = nearbyAvatar;
  board.nearby[1].avatarUrl = "https://example.test/untrusted-avatar.jpg";
  board.nearby[2].avatarUrl = "/api/avatars/" + "c".repeat(64);
  const card = cards.leaderboardCard({ ...fixtures.profile, avatarUrl: avatar }, board);
  assert.equal(card.nearby[0].avatar, nearbyAvatar);
  assert.equal(card.nearby[1].avatar, "");
  assert.equal(card.nearby[2].avatar, avatar);
  assert.doesNotMatch(JSON.stringify(card), /untrusted-avatar|publicId|must-not-export/);
});

test("分享画布等待所有头像加载并去重，绘制附近玩家头像，单张失败仍可导出", async () => {
  const avatar = "/api/avatars/" + "a".repeat(64), neighbor = "/api/avatars/" + "b".repeat(64), failed = "/api/avatars/" + "c".repeat(64);
  const board = copy(fixtures.board);
  board.nearby[0].avatarUrl = neighbor; board.nearby[1].avatarUrl = failed; board.nearby[3].avatarUrl = neighbor;
  const card = cards.leaderboardCard({ ...fixtures.profile, avatarUrl: avatar }, board);
  const drawn = [], drawing = [], images = [];
  const context = { fillRect() {}, strokeRect() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText: text => ({ width: text.length * 20 }), fillText: text => drawing.push(text), drawImage: (...args) => drawn.push(args) };
  const canvas = { getContext: () => context, createImage() { const image = { width: 120, height: 80, set src(value) { this.url=value; images.push(this); } }; return image; } };
  let exported;
  const wx = { createSelectorQuery() { const query = { in() { return query; }, select() { return query; }, fields() { return query; }, exec(callback) { callback([{ node: canvas }]); } }; return query; },
    canvasToTempFilePath(options) { exported=options; options.success({tempFilePath:"wxfile://avatars"}); } };
  const mod = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/share-image.js"), "utf8"), { module:mod, wx, setTimeout, clearTimeout,
    require: name => name === "./api" ? {assetUrl:value=>"https://example.test"+value} : cards });
  const rendering = mod.exports.renderImage({alive:true}, card);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(images.length, 3); assert.equal(exported, undefined);
  images.find(image=>image.url.endsWith(neighbor)).onload();
  images.find(image=>image.url.endsWith(failed)).onerror();
  assert.equal(exported, undefined);
  images.find(image=>image.url.endsWith(avatar)).onload();
  assert.equal(await rendering, "wxfile://avatars");
  const rows = drawn.filter(args=>args[5]===202);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(args=>args[0].url), [neighbor,avatar,neighbor].map(value=>"https://example.test"+value));
  for (const args of rows) assert.deepEqual(args.slice(1,5), [20,0,80,80]);
  assert.ok(drawing.includes("阿"));assert.ok(drawing.includes("栗"));
  assert.equal(exported.fileType,"png");
});

test("刀客分享同时展示出刀与三种结果，旧标题不影响新卡片，未知结果保留未知", () => {
  const stats=copy(fixtures.fullFunStats);
  stats.fun.cards.find(group=>group.id==='knights:knife').title='轮内刀法';
  const card=cards.funCard(fixtures.profile,stats,'knights:knife','knife_enemy',fixtures.now);
  assert.equal(card.title,'刀客刀法');
  assert.deepEqual(card.metrics.map(row=>[row.label,row.value]),[['出刀次数','6'],['未刀中次数','2'],['刀中敌方次数','3'],['刀中友方次数','1']]);
  assert.doesNotMatch(cards.describe(card),/轮内刀法|成功率|未记录|undefined/);
  const failed=stats.fun.cards.at(-1).metrics.find(row=>row.id==='knife_failed');failed.value=null;failed.knownGames=0;
  assert.equal(cards.funCard(fixtures.profile,stats,'knights:knife','knife_enemy',fixtures.now).metrics[1].value,'—');
});

test("完整趣味分享汇总全部项目且跨玩法合并，未知数据不冒充零，不导出个人明细", async () => {
  const stats=copy(fixtures.fullFunStats);
  stats.fun.cards.push({id:'knights:merlin',title:'梅林',metrics:[{...fixtures.metric,count:2,value:2,opportunities:4,knownGames:3}]});
  stats.fun.cards.push({id:'knights:duel',title:'骑士决斗',metrics:[{id:'duel_enemy',label:'命中敌方',value:null,count:0,knownGames:0}]});
  stats.fun.cards[0].privateStory='must-not-export';
  const card=cards.funSummaryCard(fixtures.profile,stats,fixtures.now);
  assert.equal(card.sections.length,3);assert.equal(card.sections[0].metrics[0].value,'10');
  assert.equal(card.sections[2].metrics.length,4);
  assert.doesNotMatch(JSON.stringify(card),/must-not-export|privateStory|十二骑士|经典|未记录|mode|byRole|好人/);
  assert.equal(cards.canShareFun(stats.fun),true);
  assert.throws(()=>cards.funSummaryCard(fixtures.profile,{fun:{cards:[stats.fun.cards.at(-1)]}},fixtures.now),/还没有完整/);
  assert.deepEqual(cards.parseSelection({kind:'funSummary',uid:'ignored'}),{kind:'funSummary'});
  const {p,requests,renderCount}=page({api:{login:async()=>{},request:async url=>{requests.push(url);return url.includes('profile')?fixtures.profile:stats;}}});
  await p.onLoad({kind:'funSummary'});await p.onReady();
  assert.ok(p.data.imagePath);assert.equal(renderCount(),1);assert.match(p.data.description,/完整趣味记录.*梅林.*成功挡刀.*刀客刀法/);
  assert.deepEqual(requests.sort(),['/api/me/profile','/api/me/stats']);
});
