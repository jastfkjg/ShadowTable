const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { BOARDS } = require("../server/engine");
const shares = require("../miniprogram/room-share");
const { layout } = require("../miniprogram/share-cover");

function context() {
  const texts = [], images = [];
  const ctx = new Proxy({
    font: "16px sans-serif",
    measureText(value) { return { width: Array.from(value).length * Number(this.font.match(/([\d.]+)px/)[1]) }; },
    fillText(value, x, y) { texts.push({ value, x, y, font: this.font }); },
    drawImage(...args) { images.push(args); },
    createLinearGradient() { return { addColorStop() {} }; },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { ctx, texts, images };
}

test("房间封面对每个可用板子绘制真实名称和房间号，不带玩家身份或实时状态", () => {
  for (const board of BOARDS.filter(board => board.available)) {
    const trace = context();
    shares.drawRoomCover(trace.ctx, { boardName: board.name, code: "085201", secret: { role: "梅林" }, players: [{ name: "私密同伴" }] });
    const labels = trace.texts.map(row => row.value);
    assert.ok(labels.includes("阿瓦隆"));
    assert.ok(labels.includes(board.name.split(" · ")[1]), board.name);
    assert.ok(labels.includes("085201"));
    assert.doesNotMatch(labels.join(" "), /梅林|私密同伴|已连接|进行中/);
    assert.ok(!labels.includes("点击进入房间"));
  }
});

test("长板名在两行内完整显示，房间号保持在名称下方且不超出画布", () => {
  const trace = context(), board = "经典基础与圆桌骑士的长名称扩展玩法";
  shares.drawRoomCover(trace.ctx, { boardName: "阿瓦隆 · " + board, code: "123456" });
  const lines = trace.texts.filter(row => row.y === layout.subtitleTop || row.y === layout.subtitleTop + layout.subtitleHeight);
  assert.equal(lines.length, 2);
  assert.equal(lines.map(row => row.value).join(""), board);
  for (const line of lines) {
    trace.ctx.font = line.font;
    assert.ok(line.x + trace.ctx.measureText(line.value).width <= layout.left + layout.textWidth);
  }
  const number = trace.texts.find(row => row.value === "123456");
  assert.ok(number.y > lines[1].y + 44);
  assert.ok(number.y + 110 < 612);
});

test("超长板名只在第二行省略，绘制后仍保留完整六位房间号", () => {
  const trace = context();
  shares.drawRoomCover(trace.ctx, { boardName: "阿瓦隆 · " + "扩展玩法".repeat(20), code: "123456" });
  const lines = trace.texts.filter(row => row.y === layout.subtitleTop || row.y === layout.subtitleTop + layout.subtitleHeight);
  assert.equal(lines.length, 2);
  assert.ok(!lines[0].value.endsWith("…"));
  assert.ok(lines[1].value.endsWith("…"));
  assert.ok(trace.texts.some(row => row.value === "123456"));
});

function renderer({ missing = false, pending = false } = {}) {
  const trace = context(), loads = [], exports = [];
  const canvas = { getContext: () => trace.ctx, createImage() {
    const image = { width: 1000, height: 800, set src(value) {
      loads.push({ image, value });
      if (!pending) queueMicrotask(() => missing ? image.onerror?.() : image.onload?.());
    } };
    return image;
  } };
  const wx = {
    createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec(callback) { callback([{ node: canvas }]); } }),
    canvasToTempFilePath(options) { exports.push(options); options.success({ tempFilePath: "room.png" }); },
  };
  function load(name) {
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram", name + ".js"), "utf8"), {
      module: mod, require: load, wx, setTimeout, clearTimeout,
    });
    return mod.exports;
  }
  return { ...trace, canvas, loads, exports, render: load("room-share").renderRoomCover };
}

test("生成前加载本地蜡笔无字背景，按 5:4 导出房间封面", async () => {
  const r = renderer();
  assert.equal(await r.render({ alive: true }, { boardName: "阿瓦隆 · 混沌契约", code: "123456" }), "room.png");
  assert.deepEqual(r.loads.map(row => row.value), Object.values(shares.assets));
  for (const file of Object.values(shares.assets)) assert.ok(fs.existsSync(path.join(__dirname, "../miniprogram", file)));
  assert.equal(r.images.length, 1);
  assert.equal(r.exports[0].destWidth / r.exports[0].destHeight, 5 / 4);
  assert.ok(r.texts.some(row => row.value === "混沌契约"));
});

test("背景加载失败时仍可导出包含真实板子和房间号的封面", async () => {
  const r = renderer({ missing: true });
  assert.equal(await r.render({ alive: true }, { boardName: "阿瓦隆 · 经典基础", code: "123456" }), "room.png");
  assert.equal(r.images.length, 0);
  assert.ok(r.texts.some(row => row.value === "经典基础"));
  assert.ok(r.texts.some(row => row.value === "123456"));
});

test("图片加载期间页面卸载后不再绘图或导出", async () => {
  const r = renderer({ pending: true }), page = { alive: true };
  const drawing = r.render(page, { boardName: "阿瓦隆 · 经典基础", code: "123456" });
  await Promise.resolve();
  assert.equal(r.loads.length, 1);
  page.alive = false;
  r.loads.forEach(({ image }) => image.onload());
  assert.equal(await drawing, null);
  assert.equal(r.images.length, 0);
  assert.equal(r.exports.length, 0);
});
