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
const css = file => fs.readFileSync(path.join(root, file), "utf8").replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name)))).replace(/^page\s*\{/m, "body {").replace(/([>+]) view/g, "$1 div").replace(/ image(?=[\s.{:#>])/g, " img").replace(/ text(?=[\s.{:#>])/g, " span").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (node.tag === "wx-canvas") return "";
  if (node.tag === "wx-app-nav") return html(factory("components/app-nav/app-nav.wxml")({ ...node.attr, statusBarHeight: 24, navHeight: 44, totalHeight: 68 }));
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img", "wx-picker": "div" })[node.tag] || "div";
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "disabled") return value ? ["disabled"] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    if (key === "src" && String(value).startsWith("/")) value = "/miniprogram" + value;
    if (key === "style") value = String(value).replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
    return ["id", "class", "src", "role", "style"].includes(key) || key.startsWith("aria-") ? [`${key}="${safe(value)}"`] : [];
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
const data = { month: report.month, report, loading: false, error: "", category: "overall", navTop: 68, entertainment: false, detailBoards: monthly.detailBoards(report), shareOpening: false };
const approvedFixture = structuredClone(fixture);
approvedFixture.month = "2026-10"; approvedFixture.status = "preview"; approvedFixture.overview = { games: 19, players: 24, activeDays: 6 }; approvedFixture.asOf = Date.parse("2026-10-29T09:30:00Z");
const approvedAvatars = { "元":10, "子龙":7, "阿伟":3, "阿宁":16, "ViVi":1, "大V":15 };
const approvedPerson = (nickname, fields) => {
  const preset = avatars.find(avatar => avatar.id === "crayon-" + String(approvedAvatars[nickname] || 0).padStart(2,"0"));
  return { ...fixture.mainBoards[0].rows[0], publicId: "approved-" + nickname, nickname, avatarUrl: preset ? "/api/avatars/" + preset.hash : null, avatarSrc: preset?.path || "", ...fields };
};
approvedFixture.mainBoards[0].rows = [["元",36,17,1],["子龙",35,17,2],["玉虚宫",33,17,3],["阿伟",33,13,3]].map(([nickname,points,scoredGames,rank]) => approvedPerson(nickname, { points, scoredGames, rank, tied: rank===3, adjustmentPoints: nickname === "玉虚宫" ? 3 : 0 }));
approvedFixture.mainBoards[1].rows = [["阿伟",10,13,76.9],["阿宁",7,10,70],["元",12,19,63.2]].map(([name,wins,total,winRate],i) => approvedPerson(name,{wins,total,winRate,rank:i+1,tied:false}));
approvedFixture.mainBoards[2].rows = [["元",19,1],["子龙",17,2],["玉虚宫",17,2]].map(([name,total,rank]) => approvedPerson(name,{total,rank,tied:rank===2}));
approvedFixture.mainBoards[3].rows = [["元",5,10,50],["大V",6,13,46.2],["玉虚宫",5,11,45.5]].map(([name,wins,total,winRate],i) => approvedPerson(name,{wins,total,winRate,rank:i+1,tied:false}));
const approvedHonors = { merlin_evade: [["阿伟",2,2,1],["ViVi",1,1,2],["月下江头",1,1,2],["子龙",1,1,2],["玉虚宫",1,2,2]], assassin_hit: [["元",2,4,1]], defense_ally: [["子龙",2,3,1],["阿伟",1,2,2]] };
approvedFixture.funBoards.forEach(board => { if (approvedHonors[board.metric]) board.rows = approvedHonors[board.metric].map(([name,count,opportunities,rank]) => approvedPerson(name,{count,opportunities,rate:Math.round(count/opportunities*1000)/10,rank,tied:board.metric==="merlin_evade"&&rank===2})); });
const approvedReport = monthly.presentReport(approvedFixture);
const sparseFixture = structuredClone(fixture);
sparseFixture.month = "2026-10"; sparseFixture.overview = { games: 8, players: 18, activeDays: 2 };
sparseFixture.mainBoards[0].rows = [["阿伟",19,6,1],["wyc",12,6,2],["元",11,6,3],["橙C",11,4,3]].map(([nickname,points,scoredGames,rank],i) => ({ ...fixture.mainBoards[0].rows[0], publicId: "sparse"+i, avatarUrl: null, avatarSrc: "", nickname, points, scoredGames, rank, tied: rank===3 }));
sparseFixture.mainBoards.slice(1).forEach(board => { board.rows = []; });
const sparseNames = { merlin_evade: [["月下江头",1],["阿伟",1]], assassin_hit: [["元",2]], defense_ally: [["子龙",1],["阿伟",1]] };
sparseFixture.funBoards.forEach(board => { board.rows = board.sort === "count" && sparseNames[board.metric] ? sparseNames[board.metric].map(([nickname,count],i) => ({ ...board.rows[0], publicId: board.id+i, nickname, count, rank: 1, tied: sparseNames[board.metric].length>1, avatarUrl: null, avatarSrc: "" })) : []; });
const scenes = {
  summary: data,
  approved: { ...data, month: approvedReport.month, report: approvedReport, detailBoards: monthly.detailBoards(approvedReport) },
  honors: { ...data, category: "honors" },
  sparse: { ...data, month: sparseFixture.month, report: monthly.presentReport(sparseFixture), detailBoards: monthly.detailBoards(monthly.presentReport(sparseFixture)) },
  entertainment: { ...data, category: "fun", entertainment: true, detailBoards: monthly.detailBoards(report, "count", true) },
  empty: { ...data, report: monthly.presentReport({ ...fixture, overview: { games: 0, players: 0, activeDays: 0 }, mainBoards: fixture.mainBoards.map(board => ({ ...board, rows: [] })), featuredIds: [], highlights: [] }) },
  long: { ...data, report: monthly.presentReport({ ...fixture, mainBoards: fixture.mainBoards.map((board, index) => index ? board : { ...board, rows: [{ ...board.rows[0], nickname: "非常非常长的玩家昵称用于检查换行", points: -123456789, rank: 1, tied: true }] }) }) },
  loading: { ...data, report: null, loading: true },
  error: { ...data, report: null, error: "请求超时，请稍后重试。" },
  rules: { ...data, rulesExpanded: true },
};
const styles = css("app.wxss") + css("components/app-nav/app-nav.wxss") + css("pages/monthly/monthly.wxss");
fs.mkdirSync(output, { recursive: true });
for (const [name, scene] of Object.entries(scenes)) {
  const heading = { monthYear: scene.month.slice(0, 4), monthNumber: String(Number(scene.month.slice(5))) };
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>月度战报 · ${name}</title><style>body{margin:0}button{font:inherit;border:0}img{object-fit:cover}${styles}</style>${html(factory("pages/monthly/monthly.wxml")({ ...scene, ...heading }))}</html>`);
}
const source = ["fun-copy.js", "monthly-report.js", "poster-canvas.js", "monthly-report-card.js"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const assetUrls = Object.fromEntries(avatars.map(avatar => ["/api/avatars/" + avatar.hash, "/miniprogram" + avatar.path]));
assetUrls["/assets/monthly-report-background.jpg"] = "/miniprogram/assets/monthly-report-background.jpg";
for (const role of ["merlin", "percival", "assassin"]) assetUrls["/assets/roles/" + role + ".png"] = "/miniprogram/assets/roles/" + role + ".png";
const posterFixtures = { poster: fixture, "poster-approved": approvedFixture, "poster-sparse": sparseFixture, "poster-long": { ...fixture, mainBoards: fixture.mainBoards.map((board, index) => index ? board : { ...board, rows: [{ ...board.rows[0], nickname: "非常非常长的玩家昵称用于检查换行", points: -123456789, rank: 1, tied: true }] }) },
  "poster-ties": { ...fixture, mainBoards: fixture.mainBoards.map((board, index) => index ? board : { ...board, rows: Array.from({ length: 55 }, (_, i) => ({ ...board.rows[0], nickname: "并列玩家" + (i + 1), publicId: "tie" + i, rank: 1, tied: true })) }) } };
for (const [name, scene] of Object.entries(posterFixtures)) fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>月度战报 · Canvas 分享图</title><style>body{margin:0;background:#101c24}canvas{display:block;width:1080px}</style><body><script>${source}</script><script>(async()=>{const renderer=window.shadowtableMonthlyCard,pages=renderer.cards(${JSON.stringify(scene)}),urls=${JSON.stringify(assetUrls)};
const images=new Map(await Promise.all([...new Set(pages.flatMap(card=>renderer.imagePaths(card)))].map(path=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([path,image]);image.onerror=()=>resolve([path,null]);image.src=urls[path]||path;}))));
for(const card of pages){const canvas=document.createElement('canvas');const size=renderer.renderDimensions(card);Object.assign(canvas,{width:size.width,height:size.height});const context=canvas.getContext('2d');context.save();try{if(size.scale!==1)context.scale(size.scale,size.scale);renderer.drawCard(context,card,images)}finally{context.restore()};document.body.appendChild(canvas);}window.posterReady=true;})().catch(error=>{console.error(error);window.posterError=error.message;});</script></body></html>`);
const shareStyles = css("app.wxss") + css("components/app-nav/app-nav.wxss") + css("pages/share/share.wxss");
const shareData = { monthly: true, pageTitle: "分享月报", loading: false, rendering: false, acting: false, imageMenu: true, imagePath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" };
for (const [name, patch] of Object.entries({ "share-monthly": {}, "share-monthly-fallback": { imageMenu:false }, "share-monthly-permission": { actionError:"保存需要相册权限，可前往设置开启。也可以直接发给好友。",albumDenied:true }, "share-monthly-error": { imagePath:"",error:"图片生成失败，请重试。" }, "share-monthly-loading": { imagePath:"",loading:true } })) {
  const shareScene = { ...shareData, ...patch };
  const rendering = shareScene.imagePath ? `(async()=>{const renderer=window.shadowtableMonthlyCard,card=renderer.cards(${JSON.stringify(approvedFixture)})[0],urls=${JSON.stringify(assetUrls)};const images=new Map(await Promise.all(renderer.imagePaths(card).map(path=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([path,image]);image.onerror=()=>resolve([path,null]);image.src=urls[path]||path;}))));const canvas=document.createElement('canvas');const size=renderer.renderDimensions(card);Object.assign(canvas,{width:size.width,height:size.height});const context=canvas.getContext('2d');context.save();try{if(size.scale!==1)context.scale(size.scale,size.scale);renderer.drawCard(context,card,images)}finally{context.restore()};document.querySelector('.share-image').src=canvas.toDataURL();window.monthlyCard=card;window.monthlyLayout=renderer.layout(card);window.posterReady=true;})().catch(error=>{console.error(error);window.posterError=error.message;});` : "window.posterReady=true;";
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>分享月报 · 生产布局</title><style>body{margin:0}button{font:inherit;border:0}img{height:auto}${shareStyles}.share-scroll{overflow-y:auto}.monthly-share-shell>.app-nav{flex-shrink:0}</style>${html(factory("pages/share/share.wxml")(shareScene))}<script>${source}</script><script>${rendering}</script></html>`);
}
console.log("Monthly previews: " + output);
