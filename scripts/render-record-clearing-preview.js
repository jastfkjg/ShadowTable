// Layout projection of production WXML; interaction is tested separately.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const clearing = require("../miniprogram/pages/data-management/presentation");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(process.argv[2] || "output/playwright/record-clearing");
const context = { global: {}, window: {}, console };
vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function html(node) {
  if (typeof node !== "object") return safe(node);
  if (!node.tag || node.tag === "wx-block") return (node.children || []).map(html).join("");
  if (node.tag === "wx-app-nav") return '<div class="preview-nav">' + html(factory("components/app-nav/app-nav.wxml")({ ...node.attr, statusBarHeight: 44, navHeight: 44, totalHeight: 88 })) + '<span class="preview-clock">15:24</span><span class="preview-capsule">•••<i></i><b>⊙</b></span></div>';
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img" })[node.tag] || "div";
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (["hidden", "disabled"].includes(key)) return value ? [key] : [];
    if (key === "src" && value.startsWith("/")) value = "data:image/svg+xml;base64," + fs.readFileSync(path.join(root, value)).toString("base64");
    if (key === "style") value = String(value).replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
    return ["class", "style", "src", "role", "id"].includes(key) ? [key + '="' + safe(value) + '"'] : [];
  }).join(" ");
  return "<" + tag + " " + attrs + ">" + (node.children || []).map(html).join("") + (tag === "img" ? "" : "</" + tag + ">");
}
function css(file) {
  return fs.readFileSync(path.join(root, file), "utf8")
    .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
    .replace(/(^|[\s>+~,])(text|view|image)(?=[\s.:#\[>+~,{])/gm, (_, before, tag) => before + ({ text: "span", view: "div", image: "img" })[tag])
    .replace(/^page\s*\{/m, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
}
const raw = { month: "2026-10", version: "a".repeat(64), summary: { records: 23, validGames: 18, funGames: 12, scoredGames: 15, adjustments: 2, points: -12 } };
const preview = clearing.present(raw, "2026-10");
const base = { months: ["2026-10", "2026-09"], monthLabels: ["2026 年 10 月（本月）", "2026 年 9 月"], month: "2026-10", currentMonth: "2026-10", monthIndex: 0, preview,
  loading: false, saving: false, confirming: false, confirmation: null, confirmationBodyHeight: 0, rulesExpanded: false, pending: false, error: "", notice: "", rules: clearing.rules, impacts: clearing.impacts, sheetLines: clearing.sheetLines };
const styles = ["app.wxss", "components/app-nav/app-nav.wxss", "pages/data-management/data-management.wxss"].map(css).join("\n");
const projection = 'body{margin:0}button{font:inherit;width:100%;position:relative;overflow:hidden}img{object-fit:contain}[hidden]{display:none!important}.preview-nav{position:relative}.preview-clock{position:absolute;top:11px;left:28px;font-size:15px;font-weight:600;z-index:101}.preview-capsule{position:absolute;z-index:101;right:15px;top:51px;height:30px;width:83px;border:1px solid #485963;border-radius:20px;display:flex;align-items:center;justify-content:space-evenly;color:#d7e0e4;font-size:14px}.preview-capsule i{height:15px;width:1px;background:#6f7f89}.preview-capsule b{font-size:23px;font-weight:500}';
fs.mkdirSync(output, { recursive: true });
const fit = `<script>function fit(){const sheet=document.querySelector('.data-confirm-sheet'),body=document.querySelector('.data-confirm-body'),content=document.querySelector('.data-confirm-content');if(!sheet||!body||!content)return;const top=document.querySelector('.data-confirm-top').getBoundingClientRect().height,footer=document.querySelector('.data-confirm-footer').getBoundingClientRect().height;body.style.height=Math.min(content.getBoundingClientRect().height,innerHeight*.9-top-footer-2)+'px'}addEventListener('load',fit);addEventListener('resize',fit);</script>`;
const scenes = { preview: {}, confirm: { confirming: true, confirmation: preview }, pending: { confirming: true, confirmation: preview, pending: true, error: "网络未确认，请重试原请求" }, empty: { months: [], preview: null, notice: "2026 年 10 月的个人战绩已清除" },
  historical: { month: "2026-09", monthIndex: 1, preview: clearing.present({ ...raw, month: "2026-09" }, "2026-10") },
  large: { preview: clearing.present({ ...raw, summary: { ...raw.summary, records: 12345678, validGames: 1234567, points: -987654321 } }, "2026-10") } };
for (const [name, patch] of Object.entries(scenes)) {
  fs.writeFileSync(path.join(output, name + ".html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>数据管理 · ' + name + '</title><style>' + styles + projection + '</style>' + html(factory("pages/data-management/data-management.wxml")({ ...base, ...patch })) + fit + '</html>');
}
fs.writeFileSync(path.join(output, "gallery.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>A 主页面 + C 确认面板</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{width:872px;padding:28px 32px}header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:22px}h1{font-size:22px;margin:0}header span,p{font-size:12px;color:#b1bfc6}.screens{display:flex;gap:28px}iframe{width:390px;height:844px;border:1px solid #344752;border-radius:24px;background:#101c24}h2{font-size:14px;font-weight:500;margin:0 0 12px}p{margin:16px 0 0}</style><main><header><h1>数据管理</h1><span>正式页面模板 · 示例数据</span></header><div class="screens"><section><h2>A · 月度概览</h2><iframe src="preview.html" title="数据管理主页面"></iframe></section><section><h2>C · 底部确认面板</h2><iframe src="confirm.html" title="清理确认面板"></iframe></section></div><p>月份与范围预览 → 核对清理 → 确认提交</p></main>');
console.log("Data management WXML previews: " + output);
