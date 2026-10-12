// Render actual production WXML with a complete game produced by the rule engine.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { Store } = require("../server/store");
const { completed } = require("../tests/helpers/replay-fixtures");
const { presentReplay, trajectory } = require("../miniprogram/replay");
const { presentMatches } = require("../miniprogram/profile");
const createRecords = require("../miniprogram/pages/records/controller");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(__dirname, "../output/playwright/replay");
const context = { window: {}, global: {}, console }; vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (node.tag === "wx-app-nav") return '<nav class="preview-nav"><button aria-label="返回">‹</button><strong>' + safe(node.attr.title) + '</strong></nav>';
  const tag = ({ "wx-text": "text", "wx-button": "button", "wx-image": "img", "wx-scroll-view": "section" })[node.tag] || "view";
  const attributes = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "disabled") return value ? ["disabled"] : [];
    if (key === "hidden") return value ? ["hidden"] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    return ["id", "class", "role", "aria-label", "aria-selected", "aria-expanded", "aria-modal", "aria-hidden"].includes(key)
      ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attributes}>${(node.children || []).map(html).join("")}</${tag}>`;
}
const css = file => fs.readFileSync(path.join(root, file), "utf8")
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/^page\s*\{/m, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const store = new Store(":memory:"); let raw, record;
try {
  const room = completed(); store.save(room); raw = store.replayFor("wx:replay-5", room.matchRecord.id);
  record = presentMatches([store.matchFor("wx:replay-5", room.matchRecord.id)])[0];
}
finally { store.close(); }
const scenes = {
  overview: presentReplay(raw), round: presentReplay(raw, "global", ["round-2"]),
  mine: presentReplay(raw, "mine", ["round-1"]),
  player: { ...presentReplay(raw), playerDetail: trajectory(raw, 7) },
  legacy: presentReplay({ ...raw, events: [], status: "legacy", message: "旧对局未保存完整复盘，仅展示已有记录；缺失过程不作推测。" }),
  error: { replay: null, error: "对局记录不存在或已移除" },
};
fs.mkdirSync(output, { recursive: true });
const styles = css("app.wxss") + css("pages/replay/replay.wxss");
function writeScene(name, file, data, styles) {
  const rendered = html(factory(file)(data));
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>对局复盘 · ${name}</title><style>body{margin:0}view,section{display:block}button{font:inherit;border:0}.preview-nav{height:76px;display:flex;align-items:center;justify-content:center;position:sticky;top:0;z-index:100;background:#101c24;border-bottom:1px solid #30404a}.preview-nav button{position:absolute;left:12px;width:44px;min-height:44px;font-size:30px;padding:0}.replay-jumps,.replay-task-pips{overflow:auto}.replay-sheet-body,.records-pane{overflow-y:auto}${styles}</style>${rendered}</html>`);
}
for (const [name, data] of Object.entries(scenes)) writeScene(name, "pages/replay/replay.wxml", { loading: false, error: "", playersExpanded: false, playerDetail: null, ...data }, styles);
const records = createRecords("matches").data;
writeScene("entry", "pages/matches/matches.wxml", { ...records, historyStarted: true,
  history: { ...records.history, loading: false, loaded: true, records: [record], total: 1 } }, css("app.wxss") + css("pages/matches/matches.wxss"));
writeScene("detail", "pages/match-detail/match-detail.wxml", { loading: false, error: "", record }, css("app.wxss") + css("pages/match-detail/match-detail.wxss"));
console.log("Production replay projections: " + output);
