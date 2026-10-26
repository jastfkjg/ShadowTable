// Render the public WXML and WXSS, with sample snapshots rather than live player data.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { present } = require("../miniprogram/shared-record-view");
const fixtures = require("../tests/helpers/record-share-fixtures");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(__dirname, "../output/playwright/record-shares-implemented");
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
    if (key === "hidden") return value ? ["hidden"] : [];
    if (key === "src" && value.startsWith("/")) value = "data:image/" + (value.endsWith(".jpg") ? "jpeg" : value.endsWith(".svg") ? "svg+xml" : "png")
      + ";base64," + fs.readFileSync(path.join(root, value)).toString("base64");
    return ["class", "style", "src"].includes(key) ? [key + '="' + escape(value) + '"'] : [];
  }).join(" ");
  return "<" + tag + " " + attrs + ">" + (node.children || []).map(html).join("") + (tag === "img" ? "" : "</" + tag + ">");
}
const styles = "body{margin:0}img{object-fit:contain}.shared-scroll{overflow-y:auto}" + css("app.wxss") + css("pages/shared/content.wxss");
fs.mkdirSync(output, { recursive: true });
const scenes = Object.fromEntries(Object.entries(fixtures).map(([key, snapshot]) => {
  snapshot = structuredClone(snapshot);snapshot.player.avatarUrl = "/pages/profile/assets/avatars/crayon-07.jpg";
  return [key, { loading: false, error: "", authoring: false, sharedRecord: present(snapshot) }];
}));
const long = structuredClone(fixtures.fun);long.player.name = "圆桌旁一起玩阿瓦隆的长昵称玩家";
long.data.label = "用来验证完整展示的长名称趣味成绩";long.data.count = 123456789;long.data.records[0].boardName = "阿瓦隆 · 十二骑士（13人）长名称扩展玩法";
scenes.long = { sharedRecord: present(long) };
const zero = structuredClone(fixtures.fun);zero.data.count = 0;zero.data.rate = 0;zero.data.records = [];
scenes.zero = { sharedRecord: present(zero) };
scenes.error = { error: "分享不存在或已失效" };scenes.loading = { loading: true };
const docs = {};
for (const [key, data] of Object.entries(scenes)) {
  const doc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>' + styles + "</style>"
    + html(factory("pages/shared/shared.wxml")(data)) + "</html>";
  fs.writeFileSync(path.join(output, key + ".html"), doc);docs[key] = doc;
}
const labels = { stats: "个人战绩", match: "单局对局", fun: "趣味成绩" };
const gallery = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:28px 32px;background:#edeae4;color:#192830;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}h1{font-size:23px;margin:0 0 8px}.note{font-size:12px;color:#69747b;margin:0 0 22px}.screens{display:flex;gap:28px}h2{font-size:14px;font-weight:500;margin:0 0 12px}iframe{display:block;width:375px;height:1000px;border:1px solid #354650;border-radius:18px;background:#101c24}</style><h1>朋友圈分享 · 实际模板实现</h1><p class="note">示例数据 / 内容区域预览，微信原生导航和操作栏由微信提供</p><div class="screens">'
  + Object.keys(labels).map(key => '<section><h2>' + labels[key] + '</h2><iframe title="' + key + '" srcdoc="' + escape(docs[key]) + '"></iframe></section>').join("") + "</div></html>";
fs.writeFileSync(path.join(output, "gallery.html"), gallery);
fs.writeFileSync(path.join(output, "capture.js"), `async page => {
  await page.setViewportSize({width:1250,height:1090});await page.setContent(${JSON.stringify(gallery)});
  for(const frame of page.frames())await frame.evaluate(()=>Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))));
  await page.screenshot({path:${JSON.stringify(path.join(output, "gallery.png"))},fullPage:true});
  const checks=[];for(const frame of page.frames().slice(1))checks.push(await frame.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:document.querySelectorAll('button').length,time:document.querySelector('.shared-stamp')?.textContent})));
  for(const [name,doc] of Object.entries(${JSON.stringify(docs)})){
    await page.setViewportSize({width:320,height:812});await page.setContent(doc);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))));
    await page.screenshot({path:${JSON.stringify(output)}+'/'+name+'-320.png'});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(name+' overflows');
  }
  return checks;
}`);
console.log(output);
