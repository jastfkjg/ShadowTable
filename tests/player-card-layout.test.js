const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { initialPlayerCardData, playerCardMethods } = require("../miniprogram/player-card");
const card = { id: "player-a", name: "大V", initial: "大", seat: 1,
  badges: [{ id: "points", title: "积分王者", imageUrl: "/assets/badges/points.png" }] };
function page(api = {}) {
  const callbacks = [], ticks = [];
  const platform = {
    nextTick(callback) { ticks.push(callback); },
    createSelectorQuery() {
      const query = { in() { return query; }, select() { return query; }, boundingClientRect() { return query; },
        exec(callback) { callbacks.push(callback); } };
      return query;
    },
  };
  const p = { ...playerCardMethods(api, platform), data: { ...initialPlayerCardData, playerCard: card },
    alive: true, foreground: true, playerCardSequence: 1,
    setData(values, callback) { Object.assign(this.data, values); callback?.(); } };
  return { p, callbacks, flush() { ticks.splice(0).forEach(callback => callback()); } };
}
const rects = (height, viewport = { width: 393, height: 852 }) => [viewport, { height: 80 }, { height }, { height: 34 }];

test("玩家战绩按内容收起，展开徽章受屏幕空间约束，收起后恢复紧凑高度", () => {
  const { p, callbacks, flush } = page();
  p.setPlayerCardData({ playerCardMeasuring: true }); flush(); callbacks.shift()(rects(360));
  assert.equal(p.data.playerCardBodyHeight, 360);
  assert.equal(p.data.playerCardMeasuring, false);
  p.showPlayerCardBadge({ currentTarget: { dataset: { id: "points" } } });
  flush(); callbacks.shift()(rects(700, { width: 375, height: 736 }));
  assert.equal(p.data.playerCardBodyHeight, 534);
  assert.equal(p.data.playerCardBadge.id, "points");
  p.closePlayerCardBadge(); flush(); callbacks.shift()(rects(360));
  assert.equal(p.data.playerCardBodyHeight, 360);
  assert.equal(p.data.playerCardBadge, null);
  p.syncPlayerCardLayout(); flush(); callbacks.shift()(rects(360, { width: 812, height: 375 }));
  assert.equal(p.data.playerCardBodyHeight, 241);
});

test("旧测量不能覆盖新内容，关闭、切后台或重开另一玩家后丢弃旧回调", () => {
  const { p, callbacks, flush } = page();
  p.syncPlayerCardLayout(); flush(); const stale = callbacks.shift();
  p.syncPlayerCardLayout(); flush(); callbacks.shift()(rects(390));
  stale(rects(700)); assert.equal(p.data.playerCardBodyHeight, 390);
  p.syncPlayerCardLayout(); flush(); const hidden = callbacks.shift();
  p.foreground = false; hidden(rects(500)); assert.equal(p.data.playerCardBodyHeight, 390);
  p.foreground = true; p.syncPlayerCardLayout(); flush(); const closed = callbacks.shift();
  p.closePlayerCard(); closed(rects(500));
  assert.equal(p.data.playerCard, null); assert.equal(p.data.playerCardBodyHeight, 0);
  p.setPlayerCardData({ playerCard: { ...card, id: "player-b" }, playerCardMeasuring: true });
  flush(); callbacks.shift()(rects(200)); closed(rects(500));
  assert.equal(p.data.playerCardBodyHeight, 200);
});

test("加载完成和读取失败重新测量；测量失败仍显示内容并允许关闭", async () => {
  let release;
  const { p, callbacks, flush } = page({ request: () => new Promise(resolve => release = resolve) });
  const loading = p.loadPlayerCard(card, "/stats");
  flush(); callbacks.shift()(rects(120));
  assert.equal(p.data.playerCardBodyHeight, 120);
  release({ status: "available", player: { id: card.id, seat: card.seat, badges: [] },
    stats: { total: 18, wins: 10, winRate: 55.6, scoreTotal: 27, byFaction: [] } });
  await loading; flush(); callbacks.shift()(rects(350));
  assert.equal(p.data.playerCardBodyHeight, 350);
  assert.equal(p.data.playerCardLoading, false);
  p.setPlayerCardData({ playerCardMeasuring: true, playerCardError: "网络中断" });
  flush(); callbacks.shift()([null]);
  assert.equal(p.data.playerCardMeasuring, false);
  p.closePlayerCard(); assert.equal(p.data.playerCard, null);
  const failed = page({ request: async () => { throw new Error("网络中断"); } });
  await failed.p.loadPlayerCard(card, "/stats"); failed.flush(); failed.callbacks.shift()(rects(160));
  assert.equal(failed.p.data.playerCardError, "网络中断");
  assert.equal(failed.p.data.playerCardBodyHeight, 160);
});

test("玩家战绩原生滚动区绑定内容高度，标题和安全区固定在滚动区外且不显示重复说明", () => {
  const context = { window: {}, global: {}, console };
  vm.createContext(context);
  const factory = vm.runInContext("(function(global){" + wxmlToJs(path.resolve(__dirname, "../miniprogram")) + "})(global)", context);
  const tree = factory("player-card.wxml")({ ...initialPlayerCardData, playerCard: card, playerCardBodyHeight: 360,
    playerCardStats: { total: 18, wins: 10, scoreTotal: 27, rateValue: "55.6", byFaction: [
      { faction: "evil", label: "坏人阵营", total: 5, wins: 4, rateValue: "80.0" }] } });
  const nodes = n => typeof n !== "object" || !n ? [] : [n, ...(n.children || []).flatMap(nodes)];
  const body = nodes(tree).find(n => n.attr?.class === "player-card-body");
  assert.equal(body.tag, "wx-scroll-view"); assert.equal(body.attr.scrollY, true);
  assert.equal(body.attr.style, "height:360px;");
  assert.ok(nodes(body).some(n => n.attr?.class === "player-card-content"));
  assert.equal(nodes(body).some(n => ["player-card-top", "player-card-bottom"].includes(n.attr?.class)), false);
  const rendered = JSON.stringify(tree);
  assert.match(rendered, /当前积分|55.6|坏人阵营/);
  assert.doesNotMatch(rendered, /仅统计有效对局|胜场 \/ 有效局|场有效对局/);
});
