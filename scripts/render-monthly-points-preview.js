// Project the production mini-program templates for visual QA. Native interactions
// remain covered by controller tests and still require a device smoke test.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(process.argv[2] || path.join(__dirname, "../output/playwright/monthly-points"));
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = file => fs.readFileSync(path.join(root, file), "utf8")
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/(^|[\s>+~])(text|image|picker|scroll-view|view)(?=[\s.:#\[>+~,{])/gm, (_, before, tag) => before + ({ text: "span", image: "img", picker: "div", view: "div", "scroll-view": "div" })[tag])
  .replace(/^page\s*\{/m, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (!node.tag || node.tag === "wx-block") return (node.children || []).map(html).join("");
  if (node.tag === "wx-app-nav") return '<div class="preview-nav">' + html(factory("components/app-nav/app-nav.wxml")({ ...node.attr, statusBarHeight: 44, navHeight: 44, totalHeight: 88 })) + '<span class="preview-clock">15:50</span><div class="preview-capsule">•••<i></i><b>⊙</b></div></div>';
  if (node.tag === "wx-scroll-view") node = { ...node, attr: { ...node.attr, style: (node.attr?.style || "") + ";overflow-x:" + (node.attr?.scrollX ? "auto" : "hidden") + ";overflow-y:" + (node.attr?.scrollY ? "auto" : "hidden") } };
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img", "wx-input": "input", "wx-form": "form", "wx-label": "label", "wx-navigator": "a" })[node.tag] || "div";
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "hidden" || key === "disabled") return value ? [key] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    if (key === "src" && value.startsWith("/")) {
      const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" })[path.extname(value)];
      value = "data:" + mime + ";base64," + fs.readFileSync(path.join(root, value)).toString("base64");
    }
    if (key === "style") value = String(value).replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
    return ["id", "class", "src", "style", "role", "aria-label", "aria-selected", "aria-pressed", "aria-expanded", "aria-hidden", "aria-modal", "value", "placeholder", "maxlength"].includes(key) ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attrs}>${(node.children || []).map(html).join("")}${["img", "input"].includes(tag) ? "" : `</${tag}>`}`;
}
const projection = 'body{margin:0}button,input{font:inherit}button{border:0;width:100%}span{display:inline}img{object-fit:contain}a{text-decoration:none;color:inherit}input{box-sizing:border-box}[hidden]{display:none!important}.preview-nav{position:relative;flex-shrink:0}.preview-clock{position:absolute;z-index:101;top:14px;left:28px;font-size:14px;font-weight:600}.preview-capsule{position:absolute;z-index:101;right:16px;top:50px;height:32px;width:87px;border:1px solid #65747b;border-radius:18px;display:flex;align-items:center;justify-content:space-evenly;font-size:14px;background:#0c171d}.preview-capsule i{height:17px;width:1px;background:#65747b}.preview-capsule b{font-size:24px;font-weight:500}.preview-homebar{position:fixed;z-index:500;bottom:8px;left:50%;transform:translateX(-50%);height:4px;width:132px;border-radius:4px;background:#c5cbd0;pointer-events:none}';
const common = css("app.wxss") + css("components/app-nav/app-nav.wxss");
fs.mkdirSync(output, { recursive: true });
const scenes = [];
function write(name, file, data, styles, extra = "") {
  const rendered = html(factory(file)(data));
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>桌边助手 · ${name} · 实际模板</title><style>${projection}${common}${styles}</style>${rendered}${extra}<div class="preview-homebar"></div></html>`);
  scenes.push(name);
}

const { presentStats } = require("../miniprogram/profile");
const { presentMonthlyReset } = require("../miniprogram/monthly-reset");
const { presentLeaderboard, groups, metrics } = require("../miniprogram/leaderboard");
const profile = { displayName:"子龙", initial:"子", identityType:"wx", avatarUrl:"/pages/profile/assets/avatars/crayon-07.jpg" };
const stats = presentStats({ total:8,wins:3,losses:5,winRate:37.5,byFaction:[],byRole:[],byBoard:[],recent:[],score:{total:9,month:9,games:6} });
const monthlyReset = presentMonthlyReset({ month:"2026-10", previousMonth:"2026-09", previous:{total:24,wins:15,losses:9,winRate:62.5,points:54,scoredGames:20} });
const tabs = html(factory("custom-tab-bar/index.wxml")({selected:1,list:[{pagePath:"pages/lobby/lobby",text:"对局",icon:"/assets/tab-table.png",activeIcon:"/assets/tab-table-active.png"},{pagePath:"pages/me/me",text:"我的",icon:"/assets/tab-me.png",activeIcon:"/assets/tab-me-active.png"}]}));
for(const [name,extra] of [["me",{}],["monthly-reset",{monthlyReset}],["monthly-reset-empty",{monthlyReset:{...monthlyReset,previous:{total:0,wins:0,losses:0,points:0,rateLabel:"—",scoredGames:0}}}]]) {
 write(name,"pages/me/me.wxml",{activeTab:1,lobby:{},personal:{profile,stats,loading:false,error:"",currentRoom:null,...extra}},css("pages/me/me.wxss")+css("custom-tab-bar/index.wxss")+".tab-bar{height:78px;padding-bottom:28px}",extra.monthlyReset?"":tabs);
}
const rows = [["阿伟",1,19,6,3],["wyc",2,12,6],["元",3,11,6,10],["橙C",3,11,4],["玉虚宫",5,10,6],["大V",6,9,5,8],["子龙",6,9,6,7]].map(([nickname,rank,points,total,avatar],i)=>({publicId:"preview-"+i,nickname,rank,points,total,wins:3,winRate:50,isSelf:nickname==="子龙",avatarUrl:avatar?"/pages/profile/assets/avatars/crayon-"+String(avatar).padStart(2,"0")+".jpg":""}));
for(const metric of ["points","games"]) {
 const board = presentLeaderboard({metric,period:"month",threshold:1,rows,me:{...rows[6],status:"ranked"},eligibleCount:7,hasMore:false});
 write("leaderboard-"+metric,"pages/leaderboard/leaderboard.wxml",{groups,metrics,rateMetrics:[],metric,period:"month",board,loading:false,pointsAvailable:true,funAvailable:true},css("pages/leaderboard/leaderboard.wxss"));
}
fs.writeFileSync(path.join(output,"overview.html"),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>桌边助手 · 月度积分预览</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{padding:30px 36px 24px;width:1248px}header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}header strong{font-size:26px}header span,p{color:#b1bfc6;font-size:12px}.screens{display:flex;gap:24px}h2{font-size:14px;font-weight:500;margin:0 0 12px}h2 span{color:#e5c68b;margin-right:10px;font-size:12px}iframe{display:block;width:390px;height:844px;border:1px solid #344752;border-radius:28px;background:#101c24}p{margin-top:20px}</style><main><header><strong>桌边助手 · 月度积分</strong><span>实际页面模板 · 示例数据</span></header><div class="screens">${[["leaderboard-points","积分榜 · 仅本月"],["me","我的 · 统一积分"],["monthly-reset","每月首次进入提醒"]].map(([name,title],i)=>`<section><h2><span>0${i+1}</span>${title}</h2><iframe src="${name}.html" title="${title}"></iframe></section>`).join("")}</div><p>北京时间每月 1 日清零 · 上月战绩回顾 · 确认后当月不再提示</p></main></html>`);
console.log("Monthly points preview: "+output);
