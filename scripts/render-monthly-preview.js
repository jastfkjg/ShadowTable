// Visual QA uses the actual mini-program WXML/WXSS and the shared production Canvas renderer.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const monthly = require("../miniprogram/monthly-report");
const { monthlyFixture } = require("../tests/helpers/monthly-fixtures");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(__dirname, "../output/playwright/monthly");
const context = { window: {}, global: {}, console }; vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = file => fs.readFileSync(path.join(root, file), "utf8").replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name)))).replace(/^page\s*\{/m, "body {").replace(/> view/g, "> div").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (node.tag === "wx-app-nav") return html(factory("components/app-nav/app-nav.wxml")({ ...node.attr, statusBarHeight: 24, navHeight: 44, totalHeight: 68 }));
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img", "wx-picker": "div" })[node.tag] || "div";
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "disabled") return value ? ["disabled"] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    if (key === "src" && String(value).startsWith("/")) value = "/miniprogram" + value;
    if (key === "style") value = String(value).replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
    return ["class", "src", "role", "style", "aria-label", "aria-expanded", "aria-pressed", "aria-hidden"].includes(key) ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attrs}>${(node.children || []).map(html).join("")}${tag === "img" ? "" : `</${tag}>`}`;
}
const fixture = monthlyFixture();
const avatars = require("../miniprogram/builtin-avatars");
const sampleAvatars = { "北辰": "geometric-21", "小鹿": "geometric-13", "阿白": "geometric-01", "雾岛": "geometric-30" };
for (const board of [...fixture.mainBoards, ...fixture.funBoards]) for (const row of board.rows) {
  const avatar = avatars.find(item => item.id === sampleAvatars[row.nickname]);
  if (avatar) { row.avatarUrl = "/api/avatars/" + avatar.hash; row.avatarSrc = avatar.path; }
}
const report = monthly.presentReport(fixture);
const data = { month: report.month, report, loading: false, error: "", detailsExpanded: false, entertainment: false, sort: "count", detailBoards: monthly.detailBoards(report), shareOpening: false };
const scenes = {
  summary: data,
  details: { ...data, detailsExpanded: true },
  empty: { ...data, report: monthly.presentReport({ ...fixture, overview: { games: 0, players: 0, activeDays: 0 }, mainBoards: fixture.mainBoards.map(board => ({ ...board, rows: [] })), featuredIds: [], highlights: [] }) },
  long: { ...data, report: monthly.presentReport({ ...fixture, mainBoards: fixture.mainBoards.map((board, index) => index ? board : { ...board, rows: [{ ...board.rows[0], nickname: "非常非常长的玩家昵称用于检查换行", points: -123456789, rank: 1, tied: true }] }) }) },
};
const styles = css("app.wxss") + css("components/app-nav/app-nav.wxss") + css("pages/monthly/monthly.wxss");
fs.mkdirSync(output, { recursive: true });
for (const [name, scene] of Object.entries(scenes)) fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>月度战报 · ${name}</title><style>body{margin:0}button{font:inherit;border:0}img{object-fit:cover}${styles}</style>${html(factory("pages/monthly/monthly.wxml")(scene))}</html>`);
const source = fs.readFileSync(path.join(root, "monthly-report.js"), "utf8") + "\n" + fs.readFileSync(path.join(root, "monthly-report-card.js"), "utf8");
const assetUrls = Object.fromEntries(avatars.map(avatar => ["/api/avatars/" + avatar.hash, "/miniprogram" + avatar.path]));
assetUrls["/assets/monthly-report-background.jpg"] = "/miniprogram/assets/monthly-report-background.jpg";
const posterFixtures = { poster: fixture, "poster-long": { ...fixture, mainBoards: fixture.mainBoards.map((board, index) => index ? board : { ...board, rows: [{ ...board.rows[0], nickname: "非常非常长的玩家昵称用于检查换行", points: -123456789, rank: 1, tied: true }] }) },
  "poster-ties": { ...fixture, mainBoards: fixture.mainBoards.map((board, index) => index ? board : { ...board, rows: Array.from({ length: 55 }, (_, i) => ({ ...board.rows[0], nickname: "并列玩家" + (i + 1), publicId: "tie" + i, rank: 1, tied: true })) }) } };
for (const [name, scene] of Object.entries(posterFixtures)) fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>月度战报 · Canvas 分享图</title><style>body{margin:0;background:#101c24}canvas{display:block;width:1080px}</style><body><script>${source}</script><script>(async()=>{const renderer=window.shadowtableMonthlyCard,pages=renderer.cards(${JSON.stringify(scene)}),urls=${JSON.stringify(assetUrls)};
const images=new Map(await Promise.all([...new Set(pages.flatMap(card=>renderer.imagePaths(card)))].map(path=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([path,image]);image.onerror=()=>resolve([path,null]);image.src=urls[path]||path;}))));
for(const card of pages){const canvas=document.createElement('canvas');Object.assign(canvas,renderer.dimensions(card));renderer.drawCard(canvas.getContext('2d'),card,images);document.body.appendChild(canvas);}window.posterReady=true;})().catch(error=>{console.error(error);window.posterError=error.message;});</script></body></html>`);
console.log("Monthly previews: " + output);
