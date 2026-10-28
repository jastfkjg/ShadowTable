// Render the public WXML and WXSS, with sample snapshots rather than live player data.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { present } = require("../miniprogram/shared-record-view");
const fixtures = require("../tests/helpers/record-share-fixtures");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(process.argv[2] || path.join(__dirname, "../output/playwright/record-shares-implemented"));
const context = { window: {}, global: {}, console };vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function css(file) {
  return fs.readFileSync(path.join(root, file), "utf8")
    .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
    .replace(/(^|[\s>+~])(view|text|image|scroll-view)(?=[\s.:#\[>+~,{])/gm, (_, prefix, tag) => prefix + ({ view: "div", text: "span", image: "img", "scroll-view": "div" })[tag])
    .replace(/^page\s*\{/gm, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
}
function html(node) {
  if (typeof node === "string" || typeof node === "number") return escape(node);
  if (!node.tag || node.tag === "wx-block") return (node.children || []).map(html).join("");
  if (node.tag === "wx-app-dialog") return "";
  const tag = ({ "wx-text": "span", "wx-image": "img", "wx-button": "button" })[node.tag] || "div";
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "hidden" || key === "disabled") return value ? [key] : [];
    if (key === "src" && value.startsWith("/")) value = "data:image/" + (value.endsWith(".jpg") ? "jpeg" : value.endsWith(".svg") ? "svg+xml" : "png")
      + ";base64," + fs.readFileSync(path.join(root, value)).toString("base64");
    return ["class", "style", "src", "aria-label", "aria-hidden", "role"].includes(key) ? [key + '="' + escape(value) + '"'] : [];
  }).join(" ");
  return "<" + tag + " " + attrs + ">" + (node.children || []).map(html).join("") + (tag === "img" ? "" : "</" + tag + ">");
}
const styles = "body{margin:0}img{object-fit:contain}.shared-scroll{overflow-y:auto}" + css("app.wxss") + css("pages/shared/content.wxss");
fs.mkdirSync(output, { recursive: true });
const scenes = Object.fromEntries(Object.entries(fixtures).map(([key, snapshot]) => {
  snapshot = structuredClone(snapshot);snapshot.player.avatarUrl = "/pages/profile/assets/avatars/crayon-07.jpg";
  return [key, { loading: false, error: "", authoring: false, sharedRecord: present(snapshot) }];
}));
// The approved B layout, rendered from the production template with four roles.
const report = structuredClone(fixtures.stats);
report.createdAt = Date.UTC(2026, 9, 27, 3, 6);
report.player.avatarUrl = "/pages/profile/assets/avatars/crayon-07.jpg";
report.data.factions = [
  { faction:"evil",total:9,wins:6,losses:3,winRate:66.7 },
  { faction:"good",total:10,wins:4,losses:6,winRate:40 },
];
report.data.roles = [
  {role:"莫德雷德",faction:"evil",total:4,wins:3,losses:1,winRate:75},
  {role:"亚瑟的忠臣",faction:"good",total:3,wins:1,losses:2,winRate:33.3},
  {role:"刺客",faction:"evil",total:3,wins:1,losses:2,winRate:33.3},
  {role:"莫甘娜",faction:"evil",total:2,wins:2,losses:0,winRate:100},
];
scenes.report = {sharedRecord:present(report),authoring:true,posterAvailable:true,imagePath:"wxfile://ready",imageMenu:true};
scenes.reportPreparing = {...scenes.report,imagePath:"",rendering:true};
scenes.reportFailed = {...scenes.report,imagePath:"",actionError:"图片准备失败，请重试。"};
const reportLong = structuredClone(report);
reportLong.player.name = "圆桌旁一起玩阿瓦隆的长昵称玩家";
reportLong.data.total = 1234567;reportLong.data.wins = 1234566;reportLong.data.losses = 1;reportLong.data.scoreMonth = -123456;
reportLong.data.roles[0].role = "蓝刀客·加赫雷斯";
reportLong.data.factions.push({faction:"third",total:3,wins:1,losses:2,winRate:33.3});
scenes.reportLong = {...scenes.report,sharedRecord:present(reportLong)};
const reportZero = structuredClone(report);
reportZero.player.avatarUrl = "";reportZero.data.wins = 0;reportZero.data.losses = 19;reportZero.data.winRate = 0;reportZero.data.scoreMonth = 0;
reportZero.data.factions = [{faction:"good",total:19,wins:0,losses:19,winRate:0}];reportZero.data.roles = [];
scenes.reportZero = {sharedRecord:present(reportZero)};
const long = structuredClone(fixtures.fun);long.player.name = "圆桌旁一起玩阿瓦隆的长昵称玩家";
long.data.label = "用来验证完整展示的长名称趣味成绩";long.data.count = 123456789;long.data.records[0].boardName = "阿瓦隆 · 十二骑士（13人）长名称扩展玩法";
scenes.long = { sharedRecord: present(long) };
const zero = structuredClone(fixtures.fun);zero.data.count = 0;zero.data.rate = 0;zero.data.records = [];
scenes.zero = { sharedRecord: present(zero) };
scenes.error = { error: "分享不存在或已失效" };scenes.loading = { loading: true };
for(const tab of ['records','matches','fun']) scenes['intro-'+tab]={loading:false,error:'',singlePage:true,intro:require('../miniprogram/records-share').introFor(tab)};
const docs = {};
for (const [key, data] of Object.entries(scenes)) {
  const doc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>' + styles + "</style>"
    + html(factory("pages/shared/shared.wxml")(data)) + "</html>";
  fs.writeFileSync(path.join(output, key + ".html"), doc);docs[key] = doc;
}
const labels = { stats: "个人战绩", matches: "对局记录概览", funSummary: "趣味记录概览" };
const gallery = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:28px 32px;background:#edeae4;color:#192830;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}h1{font-size:23px;margin:0 0 8px}.note{font-size:12px;color:#69747b;margin:0 0 22px}.screens{display:flex;gap:28px}h2{font-size:14px;font-weight:500;margin:0 0 12px}iframe{display:block;width:375px;height:1000px;border:1px solid #354650;border-radius:18px;background:#101c24}</style><h1>朋友圈分享 · 实际模板实现</h1><p class="note">示例数据 / 内容区域预览，微信原生导航和操作栏由微信提供</p><div class="screens">'
  + Object.keys(labels).map(key => '<section><h2>' + labels[key] + '</h2><iframe title="' + key + '" srcdoc="' + escape(docs[key]) + '"></iframe></section>').join("") + "</div></html>";
fs.writeFileSync(path.join(output, "gallery.html"), gallery);
fs.writeFileSync(path.join(output, "capture.js"), `async page => {
  await page.setViewportSize({width:1250,height:1090});await page.goto(${JSON.stringify("file://" + path.join(output, "gallery.html"))});
  for(const frame of page.frames())await frame.evaluate(()=>Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))));
  await page.screenshot({path:${JSON.stringify(path.join(output, "gallery.png"))},fullPage:true});
  const checks=[];for(const frame of page.frames().slice(1))checks.push(await frame.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:document.querySelectorAll('button').length,time:document.querySelector('.shared-stamp')?.textContent})));
  for(const name of ${JSON.stringify(Object.keys(docs))}){
    await page.setViewportSize({width:320,height:812});await page.goto(${JSON.stringify("file://" + output + "/")}+name+".html");await page.evaluate(()=>Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))));
    await page.screenshot({path:${JSON.stringify(output)}+'/'+name+'-320.png'});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(name+' overflows');
  }
  for(const width of [320,375,390,430,812]){
    await page.setViewportSize({width,height:812});await page.goto(${JSON.stringify("file://" + path.join(output, "report.html"))});
    await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
    await page.addStyleTag({content:'.shared-scroll{height:auto;overflow:visible}'});
    const report=page.locator('.shared-page');
    await report.screenshot({path:${JSON.stringify(output)}+'/report-'+width+'.png'});
    const issues=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,clipped:[...document.querySelectorAll('.shared-report, .shared-report *')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className)}));
    if(issues.overflow||issues.broken||issues.clipped.length)throw Error('report '+width+': '+JSON.stringify(issues));
    checks.push({width,...issues});
  }
  await page.setViewportSize({width:320,height:812});await page.goto(${JSON.stringify("file://" + path.join(output, "reportLong.html"))});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addStyleTag({content:'.shared-scroll{height:auto;overflow:visible}.shared-page{zoom:1.5;max-width:66.6667%;margin:0}'});
  await page.locator('.shared-page').screenshot({path:${JSON.stringify(output)}+'/report-large-text.png'});
  const large=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,clipped:[...document.querySelectorAll('.shared-report, .shared-report *')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className)}));
  if(large.overflow||large.clipped.length)throw Error('report large text: '+JSON.stringify(large));
  checks.push({largeText:true,...large});
  return checks;
}`);
console.log(output);
