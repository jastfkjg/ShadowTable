const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const covers = require("../miniprogram/record-share-cover"), shares = require("../miniprogram/records-share");
const fixtures = require("./helpers/record-share-fixtures");

test("五种记录封面按公开快照绘制对应类型、玩家和真实摘要", () => {
  const expected = { stats: ["战绩统计", "52.6%"], matches: ["对局记录", "19 局"],
    funSummary: ["趣味记录", "1 项"], match: ["对局记录", "获胜"], fun: ["趣味记录", "3次"] };
  for (const [kind, [title, hero]] of Object.entries(expected)) {
    const content = covers.coverContent("records", fixtures[kind]);
    assert.equal(content.title, title); assert.equal(content.hero, hero);
    assert.match(JSON.stringify(content), /子龙/);
  }
  const other = structuredClone(fixtures.match);other.data.boardName = "狼人杀 · 预女猎白";
  assert.equal(covers.coverContent("matches", other).subtitle, other.data.boardName);
  const zero = structuredClone(fixtures.stats);Object.assign(zero.data, { total: 0, wins: 0, losses: 0, winRate: 0 });
  assert.equal(covers.coverContent("records", zero).hero, "0%");
  assert.equal(covers.coverContent("records", zero).detail, "0 局 · 0 胜 0 负");
  zero.data.winRate = null;assert.equal(covers.coverContent("records", zero).hero, "—");
  const fun = structuredClone(fixtures.fun);fun.data.count = 0;fun.data.rate = 0;
  assert.equal(covers.coverContent("fun", fun).hero, "0次");
  assert.equal(covers.coverContent("fun", fun).detail, "成功率 0%");
});

test("无有效分享快照的三种封面只使用品牌介绍，不携带未分享的玩家数据", () => {
  for (const [tab, title] of [["records", "战绩统计"], ["matches", "对局记录"], ["fun", "趣味记录"]]) {
    const content = covers.coverContent(tab, { id: "bad", player: { name: "未公开昵称" }, data: { winRate: 99 } });
    assert.equal(content.title, title); assert.doesNotMatch(JSON.stringify(content), /未公开昵称|99/);
  }
});

test("长昵称、长玩法和大数字保持在插画左侧，完整保留六位房间号", () => {
  const { layout } = require("../miniprogram/share-cover"), traces = [];
  const ctx = new Proxy({ font: "16px sans-serif",
    measureText(text) { return { width: Array.from(text).length * Number(this.font.match(/([\d.]+)px/)[1]) }; },
    fillText(value, x, y) { traces.push({ value, x, y, width: this.measureText(value).width }); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const long = structuredClone(fixtures.fun);
  long.player.name = "一起玩阿瓦隆的超长昵称😀".repeat(3);
  long.data.label = "长名称趣味记录".repeat(8);long.data.count = 123456789;
  covers.drawRecordCover(ctx, "fun", long);
  require("../miniprogram/room-share").drawRoomCover(ctx, { boardName: "狼人杀 · " + "扩展玩法".repeat(30), code: "012345" });
  assert.ok(traces.some(row => row.value === "123456789次"));
  assert.ok(traces.some(row => row.value === "012345"));
  assert.ok(traces.some(row => row.value === "狼人杀"));
  for (const row of traces) assert.ok(row.x + row.width <= layout.left + layout.textWidth + 1, row.value);
});

function client() {
  const pending = [], mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/record-share-cover.js"), "utf8"), {
    module: mod, require: name => name === "./records-share" ? shares : {
      renderCover: (page, content) => new Promise((resolve, reject) => pending.push({ page, content, resolve, reject })),
    },
  });
  return { api: mod.exports, pending, page: { alive: true, shareCanvasReady: true } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("分享等待当前封面，朋友圈复用已导出图片，切换标签不串用旧数据", async () => {
  const c = client();
  const first = c.api.friendContent(c.page, "records", fixtures.stats);
  c.api.prepare(c.page, "records", fixtures.stats);await tick();assert.equal(c.pending.length, 1);
  const second = c.api.friendContent(c.page, "matches", fixtures.matches);
  assert.equal(second.imageUrl, "/assets/share-cover.jpg");
  assert.equal(c.api.timelineContent(c.page, "matches", fixtures.matches).imageUrl, "/assets/share-cover.jpg");
  c.pending[0].resolve("stats.png");assert.equal((await first.promise).imageUrl, "stats.png");
  await tick();assert.equal(c.pending.length, 2);assert.equal(c.pending[1].content.title, "对局记录");
  c.pending[1].resolve("matches.png");
  assert.equal((await second.promise).path, "/pages/shared/shared?share=" + fixtures.matches.id);
  assert.equal(c.api.timelineContent(c.page, "matches", fixtures.matches).imageUrl, "matches.png");
});

test("跳过过时的排队封面，失败保留有效分享链接，卸载后不继续绘制", async () => {
  const c = client();
  const obsolete = c.api.prepare(c.page, "records", fixtures.stats);
  const latest = c.api.friendContent(c.page, "fun", fixtures.funSummary);
  await tick();assert.equal(c.pending.length, 1);assert.equal(await obsolete.promise, null);
  assert.equal(c.pending[0].content.title, "趣味记录");
  c.pending[0].reject(Error("画布不可用"));
  const content = await latest.promise;
  assert.equal(content.imageUrl, "/assets/share-cover.jpg");
  assert.equal(content.path, "/pages/shared/shared?share=" + fixtures.funSummary.id);
  const queued = c.api.prepare(c.page, "matches", fixtures.matches);c.page.alive = false;
  assert.equal(await queued.promise, null);assert.equal(c.pending.length, 1);
});
