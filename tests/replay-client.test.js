const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { Store } = require("../server/store");
const { completed, onlineCompleted } = require("./helpers/replay-fixtures");
const { presentReplay } = require("../miniprogram/replay");
const root = path.resolve(__dirname, "../miniprogram");
function fixture() {
  const store = new Store(":memory:");
  try { const room = completed(); store.save(room); return store.replayFor("wx:replay-5", room.matchRecord.id); }
  finally { store.close(); }
}
function page(api, route = "replay") {
  let definition;
  const navigations = [], toasts = [];
  const wx = { navigateBack: () => navigations.push("back"), navigateTo: o => { navigations.push(o.url); o.complete?.(); },
    showToast: o => toasts.push(o.title) };
  function load(file) {
    if (file === path.join(root, "api.js")) return api;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module,
      require: name => load(path.resolve(path.dirname(file), name + ".js")),
      wx, Page: p => definition = p, getCurrentPages: () => [{}, {}], getApp: () => ({}), setTimeout, clearTimeout });
    return module.exports;
  }
  if (route === "matches") definition = load(path.join(root, "pages/matches/controller.js"))();
  else load(path.join(root, "pages/" + route + "/" + route + ".js"));
  const p = { ...definition, data: structuredClone(definition.data), setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
  return { p, navigations, wx, toasts };
}
const tap = data => ({ currentTarget: { dataset: data } });
test("复盘页按本人认证读取，折叠、视角切换、身份轨迹和返回保留正确状态", async () => {
  const raw = fixture(); let logins = 0;
  const { p, navigations } = page({ login: async () => logins++, request: async url => {
    assert.equal(url, "/api/me/matches/" + raw.id + "/replay"); return { replay: raw };
  } });
  await p.onLoad({ id: raw.id }); assert.equal(logins, 1); assert.equal(p.data.loading, false);
  assert.equal(p.data.rounds.length, 4); assert.equal(p.data.rounds[0].expanded, false);
  p.toggleRound(tap({ id: "round-1" })); assert.equal(p.data.rounds[0].expanded, true);
  assert.equal(p.data.activeRoundId, "round-1");
  p.chooseView(tap({ view: "mine" })); assert.equal(p.data.initialPlayers.length, 1); assert.equal(p.data.rounds[0].expanded, true);
  assert.equal(p.data.activeRoundId, "round-1");
  p.openPlayer(tap({ seat: 7 })); assert.equal(p.data.playerDetail.seat, 7);
  p.back(); assert.equal(p.data.playerDetail, null); assert.equal(navigations.length, 0);
  p.togglePlayers(); assert.equal(p.data.playersExpanded, true); p.back(); assert.equal(navigations[0], "back");
  p.onUnload(); assert.equal(p.rawReplay, null);
});
test("读取失败可重试、无对局编号不请求、重复读取和卸载后的迟到响应不改页面", async () => {
  const raw = fixture(); let reads = 0;
  const first = page({ login: async () => {}, request: async () => { reads++; if (reads === 1) throw Error("网络中断"); return { replay: raw }; } }).p;
  await first.onLoad({ id: raw.id }); assert.equal(first.data.replay, null); assert.equal(first.data.error, "网络中断");
  await first.load(); assert.equal(first.data.error, ""); assert.equal(first.data.replay.id, raw.id);
  const missing = page({ login: async () => { throw Error("不应请求"); } }).p;
  await missing.onLoad(); assert.match(missing.data.error, /不存在/);
  let resolve, calls = 0;
  const pending = page({ login: async () => {}, request: () => { calls++; return new Promise(done => resolve = done); } }).p;
  const load = pending.onLoad({ id: raw.id }); await Promise.resolve(); await pending.load(); assert.equal(calls, 1);
  pending.onUnload(); resolve({ replay: raw }); await load; assert.equal(pending.data.replay, null);
});
test("对局列表的复盘入口只接受已有受支持记录，原有展开和返回行为保持不变", () => {
  const history = page({}, "matches"); history.p.alive = true;
  history.p.setData({ records: [{ id: "a/b", replayAvailable: true, expanded: false }, { id: "classic", replayAvailable: false }] });
  history.p.openReplay(tap({ id: "classic" })); history.p.openReplay(tap({ id: "missing" })); assert.equal(history.navigations.length, 0);
  history.p.openReplay(tap({ id: "a/b" })); assert.equal(history.navigations[0], "/pages/replay/replay?id=a%2Fb");
  history.p.toggleRecord(tap({ id: "a/b" })); assert.equal(history.p.data.records[0].expanded, true);
});
test("牌桌复盘按本局编号跳转，防止重复进入，失败后可重试并保留牌桌", () => {
  const { p, wx, navigations, toasts } = page({}, "table");
  p.alive = true; p.foreground = true;
  let navigation;
  wx.navigateTo = options => { navigation = options; navigations.push(options.url); };
  p.setData({ room: { phase: "tools", replayId: "current/a" } });
  p.viewReplay(); assert.equal(navigations.length, 0);
  p.setData({ room: { phase: "ended", replayId: null } });
  p.viewReplay(); assert.equal(navigations.length, 0);
  p.setData({ room: { phase: "ended", replayId: "current/a" }, busy: true });
  p.viewReplay(); assert.equal(navigations.length, 0);
  p.setData({ busy: false, hasPendingRequest: true });
  p.viewReplay(); assert.equal(navigations.length, 0);
  p.setData({ hasPendingRequest: false });
  p.viewReplay(); p.viewReplay();
  assert.deepEqual(navigations, ["/pages/replay/replay?id=current%2Fa"]);
  navigation.fail(); navigation.complete();
  assert.deepEqual(toasts, ["暂时无法打开，请重试"]);
  assert.equal(p.data.room.replayId, "current/a");
  p.viewReplay(); navigation.complete(); assert.equal(navigations.length, 2);
  p.foreground = false; p.viewReplay(); assert.equal(navigations.length, 2);
  p.foreground = true;
  p.setData({ room: { phase: "terminated", replayId: "terminated" } });
  p.viewReplay(); assert.equal(navigations[2], "/pages/replay/replay?id=terminated");
  p.alive = false; navigation.fail(); navigation.complete();
  assert.equal(toasts.length, 1);
});
test("生产 WXML 编译并显示真实复盘，个人视角和旧局不虚构缺失内容", () => {
  const context = { window: {}, global: {}, console }; vm.createContext(context);
  const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
  const render = factory("pages/replay/replay.wxml"), raw = fixture();
  const global = presentReplay(raw, "global", ["round-2"]);
  const text = JSON.stringify(render({ ...global, loading: false }));
  assert.match(text, /初始身份|技能结算|魔术师|红骑士|最终结算|刺中梅林|三绿阶段奖励/);
  assert.doesNotMatch(text, /undefined|wx:replay-/);
  const mine = presentReplay(raw, "mine", ["round-2"]);
  assert.match(JSON.stringify(render({ ...mine, loading: false })), /本轮没有我的行动记录/);
  assert.doesNotMatch(JSON.stringify(render({ loading: true, replay: null })), /初始身份|最终结算/);
  raw.status = "legacy"; raw.message = "旧对局未保存完整复盘"; raw.events = [];
  assert.match(JSON.stringify(render({ ...presentReplay(raw), loading: false })), /每轮过程未记录/);
});
test("复盘插画区分初始与最终身份，未知初始身份不根据最终角色补图或补阵营", () => {
  const raw = fixture();
  raw.initialPlayers[0] = { ...raw.initialPlayers[0], role: null, faction: "unknown" };
  raw.finalPlayers[0] = { ...raw.finalPlayers[0], role: "刺客", faction: "good" };
  const before = JSON.stringify(raw), shown = presentReplay(raw);
  assert.equal(shown.initialPlayers[0].rolePortrait, "");
  assert.equal(shown.initialPlayers[0].roleLabel, "未记录");
  assert.equal(shown.initialPlayers[0].factionLabel, "未知");
  assert.equal(shown.finalPlayers[0].rolePortrait, "/assets/roles/assassin.png");
  assert.equal(shown.finalPlayers[0].factionLabel, "好人");
  assert.equal(JSON.stringify(raw), before);
});

test("生产复盘展示线上投票和出牌明细、转换前后阵营、湖仙结果、抽牌及作废与盘刀结果", () => {
  const store = new Store(":memory:");
  try {
    const room = onlineCompleted(); store.save(room);
    const raw = store.replayFor("wx:replay-5", room.matchRecord.id);
    const projected = presentReplay(raw, "global", ["round-1", "round-2", "round-3"]);
    const events = projected.rounds.flatMap(r => r.events);
    const votes = events.filter(e => e.kind === "vote");
    assert.deepEqual(votes[0].stats.map(s => s.value), [9, 3, 0]);
    assert.deepEqual(votes[1].stats.map(s => s.value), [1, 0, 11]);
    assert.equal(votes[0].rows.length, 12); assert.equal(votes[1].rows.length, 12);
    const quests = events.filter(e => e.kind === "quest");
    assert.deepEqual(quests[1].stats.map(s => s.value), [2, 1, 1]);
    assert.equal(quests[1].rows.find(r => r.headline.startsWith("10号")).detail, "失败");
    assert.ok(quests.every(e => e.hideBadge));
    assert.equal(events.find(e => e.kind === "fairy").rows[0].resultLabel, "当时阵营：好人");
    const conversion = events.find(e => e.kind === "conversion" && e.converted);
    assert.equal(conversion.rows.find(r => r.actorSeat === 7).beforeLabel, "好人阵营");
    assert.equal(conversion.rows.find(r => r.actorSeat === 7).afterLabel, "坏人阵营");
    const context = { window: {}, global: {}, console }; vm.createContext(context);
    const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
    const text = JSON.stringify(factory("pages/replay/replay.wxml")({ ...projected, loading: false }));
    for (const label of ["投票明细", "逐人出牌", "阵营转换", "好人阵营", "坏人阵营", "不转换",
      "湖仙查验", "当时阵营：好人", "当时阵营：坏人", "湖仙传递给 7号", "抽取 B 牌",
      "提前截止", "作废操作", "未形成决定", "本次没有提交有效目标", "命中"])
      assert.ok(text.includes(label), label);
    assert.doesNotMatch(text, /旧记录仅保留|undefined|wx:replay-/);
    const mine = presentReplay(raw, "mine", ["round-1"]);
    assert.equal(mine.rounds[0].events.find(e => e.kind === "vote").rows.length, 1);
    assert.equal(mine.rounds[0].events.find(e => e.kind === "vote").rows[0].headline, "5号 子龙");
  } finally { store.close(); }
});
