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
  rank: cards.leaderboardCard(profile, board),
  third: cards.statsCard(profile, { total:6,wins:4,losses:2,winRate:66.7,
    byFaction:[{faction:"good",total:2,wins:1},{faction:"evil",total:2,wins:1},{faction:"third",total:2,wins:2}],
    byRole:[{role:"梅林",total:2,wins:1},{role:"刺客",total:2,wins:1},{role:"盗贼",total:2,wins:2}] }, now),
  games: cards.leaderboardCard(profile, { ...board, metric: "games", period: "all", nearby:board.nearby.map((row,i)=>({...row,total:52-i*2})),me: { ...board.me, total: 48, wins: 30, losses: 18, winRate: 62.5 } }),
  short: cards.statsCard({ nickname: "新朋友" }, { total: 2, wins: 1, losses: 1, winRate: 50,
    byFaction:[{faction:"good",total:1,wins:1},{faction:"evil",total:1,wins:0}],byRole:[{role:"梅林",total:1,wins:1},{role:"刺客",total:1,wins:0}] }, now),
  pending: cards.leaderboardCard(profile, { ...board, metric:"fun_merlin_evade",fun: true, title: "梅林", metricLabel: "成功躲刀率", mode: "classic", sort: "rate", unit: "%", threshold: 5, me: { status: "not_enough", rank: null, knownGames: 4, opportunities: 4, count: 3, rate: 75, remaining: 1 } }),
  long: cards.leaderboardCard({ ...profile, nickname: "很长的玩家昵称😀😀😀测试边界与截断" }, { ...board, metric:"fun_good_shield",fun: true, title: "好人（非梅林）", metricLabel: "成功挡刀率", mode: "knights", sort: "rate", unit: "%", threshold: 5,
    nearby:board.nearby.map((row,i)=>({...row,rank:12343+i,nickname:i===1?"昵称很长很长的附近玩家":row.nickname,rate:[70,68,66.7,63,61][i]})),
    me: { ...board.me, rank: 12345, rate: 66.7, count: 2000, opportunities: 3000, knownGames: 3200, unknownGames: 20 } }),
  hidden: cards.leaderboardCard(profile,{...board,me:{...board.me,status:"hidden",rank:null}}),
  unknown: cards.statsCard(profile,{total:8,wins:4,losses:4,winRate:50,
    byFaction:[{faction:"good",total:3,wins:2},{faction:"evil",total:2,wins:1},{faction:"third",total:2,wins:1},{faction:"unknown",total:1,wins:0}],
    byRole:[{role:"很长的自定义角色名称边界测试",total:3,wins:2},{role:"刺客",total:2,wins:1},{role:"盗贼",total:2,wins:1},{role:"未知角色",total:1,wins:0}]},now),
};
const output = path.resolve(__dirname, "../output/playwright");
fs.mkdirSync(output, { recursive: true });
const script = card => `<script>{const module={exports:{}};${source}\nconst card=${JSON.stringify(card)};const size=module.exports.dimensions(card);const canvas=document.createElement('canvas');Object.assign(canvas,size);module.exports.drawCard(canvas.getContext('2d'),card);document.querySelectorAll('img.share-image').forEach(image=>image.src=canvas.toDataURL());document.querySelectorAll('canvas.card').forEach(target=>{Object.assign(target,size);module.exports.drawCard(target.getContext('2d'),card)});}</script>`;
const base = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>分享图片 · 布局验证</title>`;
for (const [name, card] of Object.entries(scenes)) {
  const state = { imagePath: "", description: cards.describe(card), imageMenu: true };
  const tree = factory("pages/share/share.wxml")({ ...state, imagePath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });
  fs.writeFileSync(path.join(output, `share-${name}.html`), base + `<style>body{margin:0}button{font:inherit;border:0}nav{height:64px;display:flex;align-items:center;gap:16px;padding:0 20px;background:#101c24}nav button{width:44px;font-size:32px}img{height:auto} ${css("app.wxss")} ${css("pages/share/share.wxss")}</style>` + html(tree) + script(card) + "</html>");
  fs.writeFileSync(path.join(output, `share-card-${name}.html`), base + '<style>body{margin:0;background:#101c24}canvas{display:block;width:1080px;height:auto}</style><canvas class="card"></canvas>' + script(card) + "</html>");
}
const labels = { stats: "战绩 · 阵营与常玩角色", fun: "趣味成绩", rank: "积分 · 我的附近", third: "第三阵营", games: "局数 · 我的附近", short: "仅两局战绩", pending: "暂未上榜", long: "长昵称与大数字", hidden:"未公开排名",unknown:"未知样本与长角色名称" };
fs.writeFileSync(path.join(output, "share-gallery.html"), base + '<style>body{margin:32px;background:#e9e5dd;font:16px sans-serif;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}section{width:280px}canvas{width:280px;height:auto;display:block;margin-top:10px}a{color:#101c24;text-decoration:none}</style>' + Object.entries(scenes).map(([name, card]) => `<section><a href="share-${name}.html">${labels[name]}</a><canvas id="${name}"></canvas><script>{const module={exports:{}};${source}\nconst card=${JSON.stringify(card)};const canvas=document.getElementById('${name}');Object.assign(canvas,module.exports.dimensions(card));module.exports.drawCard(canvas.getContext('2d'),card);}</script></section>`).join("") + "</html>");
console.log("Share previews: output/playwright/share-gallery.html");
