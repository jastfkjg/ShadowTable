// Visual QA only: compiled WXML layout plus the production Canvas 2D renderer.
// Run this script, serve the repo locally, then open output/playwright/share-gallery.html.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const cards = require("../miniprogram/share-card");
const { now, profile, stats, board } = require("../tests/helpers/share-fixtures");
const root = path.resolve(__dirname, "../miniprogram");
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const source = fs.readFileSync(path.join(root, "share-card.js"), "utf8");
const safe = text => String(text).replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]);
const css = file => fs.readFileSync(path.join(root, file), "utf8").replace(/^page\s*\{/m, "body {").replace(/([\d.]+)rpx/g, "calc($1 * 100vw / 750)");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (node.tag === "wx-canvas") return "";
  if (node.tag === "wx-app-nav") return '<nav aria-label="顶部导航"><button aria-label="返回">‹</button><span>分享成绩</span></nav>';
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img", "wx-navigator": "a" })[node.tag] || "div";
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "disabled") return value ? ["disabled"] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, ch => "-" + ch.toLowerCase());
    return ["class", "src", "role", "aria-label", "aria-hidden", "aria-pressed"].includes(key) ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attrs}>${(node.children || []).map(html).join("")}${tag === "img" ? "" : `</${tag}>`}`;
}
const scenes = {
  stats: cards.statsCard(profile, stats, now),
  fun: cards.funCard(profile, stats, "classic:merlin", "merlin_evade", now),
  rank: cards.leaderboardCard(profile, board, "mine"),
  top: cards.leaderboardCard(profile, board, "top"),
  long: cards.leaderboardCard({ ...profile, nickname: "很长的玩家昵称😀😀😀测试边界与截断" }, { ...board, fun: true, title: "好人（非梅林）", metricLabel: "成功挡刀率", mode: "knights", sort: "rate", threshold: 5, me: { ...board.me, rank: 12345, rate: 66.7, count: 2000, opportunities: 3000 } }, "mine"),
};
const output = path.resolve(__dirname, "../output/playwright");
fs.mkdirSync(output, { recursive: true });
const script = card => `<script>{const module={exports:{}};${source}\nconst card=${JSON.stringify(card)};const canvas=document.createElement('canvas');canvas.width=canvas.height=1080;module.exports.drawCard(canvas.getContext('2d'),card);document.querySelectorAll('img.share-image').forEach(image=>image.src=canvas.toDataURL());document.querySelectorAll('canvas.card').forEach(target=>{target.width=target.height=1080;module.exports.drawCard(target.getContext('2d'),card)});}</script>`;
const base = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>分享图片 · 布局验证</title>`;
for (const [name, card] of Object.entries(scenes)) {
  const state = { imagePath: "", description: cards.describe(card), leaderboard: ["rank", "top"].includes(name), mode: name === "top" ? "top" : "mine", imageMenu: true, canShareMine: true, canShareTop: true };
  const tree = factory("pages/share/share.wxml")({ ...state, imagePath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });
  fs.writeFileSync(path.join(output, `share-${name}.html`), base + `<style>body{margin:0}button{font:inherit;border:0}nav{height:64px;display:flex;align-items:center;gap:16px;padding:0 20px;background:#101c24}nav button{width:44px;font-size:32px}img{height:auto} ${css("app.wxss")} ${css("pages/share/share.wxss")}</style>` + html(tree) + script(card) + "</html>");
  fs.writeFileSync(path.join(output, `share-card-${name}.html`), base + '<style>body{margin:0;background:#101c24}canvas{display:block;width:1080px;height:1080px}</style><canvas class="card"></canvas>' + script(card) + "</html>");
}
fs.writeFileSync(path.join(output, "share-gallery.html"), base + '<style>body{margin:32px;background:#e9e5dd;font:16px sans-serif;display:flex;gap:24px;flex-wrap:wrap}section{width:280px}canvas{width:280px;height:280px;display:block}a{color:#101c24}</style>' + Object.entries(scenes).map(([name, card]) => `<section><a href="share-${name}.html">${name}</a><canvas id="${name}"></canvas><script>{const module={exports:{}};${source}\nconst canvas=document.getElementById('${name}');canvas.width=canvas.height=1080;module.exports.drawCard(canvas.getContext('2d'),${JSON.stringify(card)});}</script></section>`).join("") + "</html>");
console.log("Share previews: output/playwright/share-gallery.html");
