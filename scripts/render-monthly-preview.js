// Visual QA uses the actual mini-program WXML/WXSS and the shared production Canvas renderer.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("./compile-miniprogram");
const { homeData, posterScript, placeholder } = require("./monthly-poster-preview");
const { monthlyFixture } = require("../tests/helpers/monthly-fixtures");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(process.argv[2] || path.join(__dirname, "../output/playwright/monthly"));
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
// Only the authored test data feeds this public scene. Use seat-like aliases
// and built-in illustrations instead of the review scenes' reference names.
const readmeFixture = monthlyFixture();
for (const board of [...readmeFixture.mainBoards, ...readmeFixture.funBoards]) {
  for (const row of board.rows) {
    const index = Number(row.publicId.slice(-2));
    const avatar = avatars.find(item => item.id === "geometric-0" + index);
    row.publicId = "demo-player-" + index;
    row.nickname = "演示玩家 " + String(index).padStart(2, "0");
    row.avatarUrl = "/api/avatars/" + avatar.hash;
  }
}
readmeFixture.highlights = [];
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
const sparseFixture = structuredClone(fixture);
sparseFixture.month = "2026-10"; sparseFixture.overview = { games: 8, players: 18, activeDays: 2 };
sparseFixture.mainBoards[0].rows = [["阿伟",19,6,1],["wyc",12,6,2],["元",11,6,3],["橙C",11,4,3]].map(([nickname,points,scoredGames,rank],i) => ({ ...fixture.mainBoards[0].rows[0], publicId: "sparse"+i, avatarUrl: null, avatarSrc: "", nickname, points, scoredGames, rank, tied: rank===3 }));
sparseFixture.mainBoards.slice(1).forEach(board => { board.rows = []; });
const sparseNames = { merlin_evade: [["月下江头",1],["阿伟",1]], assassin_hit: [["元",2]], defense_ally: [["子龙",1],["阿伟",1]] };
sparseFixture.funBoards.forEach(board => { board.rows = board.sort === "count" && sparseNames[board.metric] ? sparseNames[board.metric].map(([nickname,count],i) => ({ ...board.rows[0], publicId: board.id+i, nickname, count, rank: 1, tied: sparseNames[board.metric].length>1, avatarUrl: null, avatarSrc: "" })) : []; });
const longFixture = structuredClone(fixture);
Object.assign(longFixture.mainBoards[0].rows[0], { nickname: "非常非常长的玩家昵称用于检查换行", points: -123456789 });
const emptyFixture = { ...fixture, overview: { games:0,players:0,activeDays:0 }, mainBoards:[], funBoards:[] };
const scenes = { readme:[readmeFixture], summary:[fixture], approved:[approvedFixture], sparse:[sparseFixture], empty:[emptyFixture],
  long:[longFixture], loading:[null,{loading:true}], error:[null,{error:"请求超时，请重试。"}], rules:[fixture,{rulesExpanded:true}] };
const styles = css("app.wxss") + css("components/app-nav/app-nav.wxss") + css("pages/monthly/monthly.wxss");
fs.mkdirSync(output, { recursive:true });
for (const [name, [response, patch]] of Object.entries(scenes)) {
  const scene = { ...(response ? homeData(response) : { month:fixture.month }), ...patch };
  const template = html(factory("pages/monthly/monthly.wxml")(scene));
  fs.writeFileSync(path.join(output,name+".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>月度战报 · ${name}</title><style>body{margin:0}button{font:inherit;border:0}${styles}</style>${template}${posterScript(scene.imagePath && response,".monthly-poster-image")}</html>`);
}
const tiesFixture = structuredClone(fixture);
tiesFixture.mainBoards[0].rows = Array.from({ length:55 }, (_,i)=>({ ...fixture.mainBoards[0].rows[0], publicId:"tie"+i, nickname:"并列玩家"+(i+1),rank:1,tied:true }));
for (const [name,response] of Object.entries({poster:fixture,"poster-approved":approvedFixture,"poster-sparse":sparseFixture,"poster-long":longFixture,"poster-ties":tiesFixture})) {
  fs.writeFileSync(path.join(output,name+".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>月度战报</title><style>body{margin:0}canvas{display:block}</style><body>${posterScript(response,"canvas")}</body></html>`);
}
const shareStyles = css("app.wxss") + css("components/app-nav/app-nav.wxss") + css("pages/share/share.wxss");
const shareData = { monthly: true, pageTitle: "分享月报", loading: false, rendering: false, acting: false, imageMenu: true, imagePath: placeholder };
for (const [name, patch] of Object.entries({ "share-monthly": {}, "share-monthly-fallback": { imageMenu:false }, "share-monthly-permission": { actionError:"保存需要相册权限，可前往设置开启。也可以直接发给好友。",albumDenied:true }, "share-monthly-error": { imagePath:"",error:"图片生成失败，请重试。" }, "share-monthly-loading": { imagePath:"",loading:true } })) {
  const shareScene = { ...shareData, ...patch };
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>分享月报 · 生产布局</title><style>body{margin:0}button{font:inherit;border:0}img{height:auto}${shareStyles}.share-scroll{overflow-y:auto}.monthly-share-shell>.app-nav{flex-shrink:0}</style>${html(factory("pages/share/share.wxml")(shareScene))}${posterScript(shareScene.imagePath && approvedFixture,".share-image")}</html>`);
}
console.log("Monthly previews: " + output);
