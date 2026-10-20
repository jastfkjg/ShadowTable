// Project the production receipt notifier and WXML/WXSS for browser visual QA.
// This does not replace verification in the native WeChat runtime.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { present } = require("../miniprogram/dialog");
const avoidance = require("../miniprogram/avoidance");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(process.argv[2] || path.join(__dirname, "../output/playwright/avoidance-notices"));
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = file => fs.readFileSync(path.join(root, file), "utf8")
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/(^|[\s>+~])(text|image|view|scroll-view)(?=[\s.:#\[>+~,{])/gm, (_, prefix, tag) => prefix + ({ text: "span", image: "img", view: "div", "scroll-view": "div" })[tag])
  .replace(/^page\s*\{/gm, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return escape(node);
  if (!node.tag || node.tag === "wx-block") return (node.children || []).map(html).join("");
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img" })[node.tag] || "div";
  const attributes = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    if (key === "src" && value.startsWith("/")) value = "data:image/svg+xml;base64," + fs.readFileSync(path.join(root, value)).toString("base64");
    return ["class", "style", "src", "role", "aria-label", "aria-hidden", "aria-modal"].includes(key) ? [key + '="' + escape(value) + '"'] : [];
  }).join(" ");
  return "<" + tag + " " + attributes + ">" + (node.children || []).map(html).join("") + (tag === "img" ? "" : "</" + tag + ">");
}
async function receipt(kind, reasons) {
  const value = { balance: 1, notice: { kind, reasons, through: "preview", amount: 1, grants: 1 } };
  const controller = { alive: true, foreground: true, data: { room: { phase: "lobby" } }, setData() {} };
  const shared = { dialogQueue: [] };
  const host = Object.assign(controller, { route: "pages/table/table", selectComponent: () => shared });
  const module = { exports: {} };
  let options;
  vm.runInNewContext(fs.readFileSync(path.join(root, "avoidance-notices.js"), "utf8"), {
    module, getCurrentPages: () => [host], wx: { getStorageSync: () => "preview-session" },
    require: name => name === "./avoidance" ? avoidance : name === "./api" ? { request: async () => value }
      : { show: async shown => { options = shown; return { confirm: false }; } },
  });
  const notifier = module.exports.create();
  try { await notifier.start(); return present(options); }
  finally { notifier.stop(); }
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const style = css("app.wxss") + css("components/app-dialog/app-dialog.wxss")
    + "body{margin:0}button{font-family:inherit}img{object-fit:contain}.app-dialog-body{overflow:auto}";
  const measure = `<script>function fit(){const q=s=>document.querySelector(s),backdrop=q('.app-dialog-backdrop'),message=q('.app-dialog-message'),body=q('.app-dialog-body');if(!backdrop||!body)return;const height=s=>q(s)?.getBoundingClientRect().height||0;const context=height('.app-dialog-context'),grant=!!q('.is-avoidance-grant');const available=Math.max(44,backdrop.height||backdrop.getBoundingClientRect().height);body.style.height=Math.min(message.scrollHeight,Math.max(44,available-160-height(grant?'.app-dialog-grant-header':'.app-dialog-title')-(context?context+(grant?22:16):0)-(height('.app-dialog-actions')||48)))+'px';}addEventListener('load',fit);addEventListener('resize',fit);document.querySelector('button').onclick=()=>{document.querySelector('.app-dialog-backdrop').remove();};</script>`;
  const scenes = [["loss", "累计失利 2 场", "loss"], ["win", "累计胜利 4 场", "win"],
    ["admin-reason", "后台发放 · 已填写原因", "generic", ["感谢参加本次聚会，送你一张回避卡！"]],
    ["admin-empty", "后台发放 · 未填写原因", "generic"],
    ["admin-long", "长原因与特殊字符", "generic", ["感谢参加本次线下聚会！\n\n" + "期待下次继续一起游戏，收获更多精彩对局。".repeat(7) + "<b>这段保持原文</b>"]]];
  const presentation = require("../miniprogram/avoidance");
  const webSource = fs.readFileSync(path.resolve(__dirname, "../server/web/app.js"), "utf8");
  const webConfirm = webSource.slice(webSource.indexOf("  function confirm(title,"), webSource.indexOf("  let grantNoticeOpen"));
  const webEscape = webSource.slice(webSource.indexOf("  function esc(v)"), webSource.indexOf("  function voteSummary"));
  const webIndex = fs.readFileSync(path.resolve(__dirname, "../server/web/index.html"), "utf8");
  const webModal = webIndex.slice(webIndex.indexOf('    <div id="modal"'), webIndex.indexOf("  </body>"));
  const webStyle = fs.readFileSync(path.resolve(__dirname, "../server/web/style.css"), "utf8");
  fs.mkdirSync(path.join(output, "assets"), { recursive: true });
  fs.copyFileSync(path.join(root, "assets/table-cards.svg"), path.join(output, "assets/table-cards.svg"));
  for (const [name, , kind, reasons] of scenes) {
    const markup = html(factory("components/app-dialog/app-dialog.wxml")({ dialog: { ...await receipt(kind, reasons), id: 1 }, bodyHeight: 0 }));
    fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>收到回避卡</title><style>${style}</style><body>${markup}${measure}</body></html>`);
    const value = { title: "收到回避卡", amount: 1, ...presentation.grantCopy({ notice: { kind, amount: 1, reasons } }) };
    const data = JSON.stringify(value).replace(/</g, "\\u003c");
    fs.writeFileSync(path.join(output, "web-" + name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>网页收卡弹窗</title><style>${webStyle}</style><body>${webModal}<script>const modal=document.getElementById('modal'),modalTitle=document.getElementById('modal-title'),modalMessage=document.getElementById('modal-message'),modalOk=document.getElementById('modal-ok'),modalCancel=document.getElementById('modal-cancel');${webEscape}${webConfirm}const value=${data};confirm(value.title,value.content,false,'知道了',{amount:value.amount,lead:value.lead});</script></body></html>`);
  }
  const overview = selected => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>回避卡弹窗预览</title><style>body{box-sizing:border-box;margin:0;padding:28px;background:#101c24;color:#f2eee5;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}h1{font-size:21px;margin:0 0 8px;font-weight:600}p{font-size:13px;color:#b1bfc6;margin:0 0 24px}.scenes{display:grid;grid-template-columns:repeat(2,375px);gap:20px}.label{font-size:14px;font-weight:500;margin-bottom:12px;color:#e5c68b}iframe{display:block;width:375px;height:510px;border:1px solid rgba(177,191,198,.24);border-radius:22px;box-sizing:border-box}</style><body><h1>收到回避卡</h1><p>发放原因作为正文，使用提示保持普通样式</p><div class="scenes">${selected.map(([name, label]) => `<section><div class="label">${label}</div><iframe title="${label}" src="${name}.html"></iframe></section>`).join("")}</div></body></html>`;
  fs.writeFileSync(path.join(output, "overview.html"), overview(scenes.slice(0, 4)));
  fs.writeFileSync(path.join(output, "admin-overview.html"), overview(scenes.slice(2, 4)));
  console.log(output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
