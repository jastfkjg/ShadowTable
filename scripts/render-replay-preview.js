// Render actual production WXML with a complete game produced by the rule engine.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { Store } = require("../server/store");
const { completed, onlineCompleted } = require("../tests/helpers/replay-fixtures");
const { presentReplay, trajectory } = require("../miniprogram/replay");
const { presentMatches } = require("../miniprogram/profile");
const createRecords = require("../miniprogram/pages/records/controller");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(__dirname, "../output/playwright/replay");
const context = { window: {}, global: {}, console }; vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (!node.tag || node.tag === "wx-block") return (node.children || []).map(html).join("");
  if (node.tag === "wx-app-nav") return '<nav class="preview-nav"><button aria-label="返回">‹</button><strong>' + safe(node.attr.title) + '</strong></nav>';
  const tag = ({ "wx-text": "text", "wx-button": "button", "wx-image": "img", "wx-scroll-view": "section" })[node.tag] || "view";
  const attributes = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "disabled") return value ? ["disabled"] : [];
    if (key === "hidden") return value ? ["hidden"] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    if (key === "src" && value.startsWith("/")) {
      const mime = value.endsWith(".svg") ? "image/svg+xml" : "image/png";
      value = "data:" + mime + ";base64," + fs.readFileSync(path.join(root, value)).toString("base64");
    }
    return ["id", "class", "src", "role", "aria-label", "aria-selected", "aria-expanded", "aria-modal", "aria-hidden"].includes(key)
      ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attributes}>${(node.children || []).map(html).join("")}${tag === "img" ? "" : `</${tag}>`}`;
}
const css = file => fs.readFileSync(path.join(root, file), "utf8")
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/(^|[\s>+~])image(?=[\s.:#\[>+~,{])/gm, "$1img")
  .replace(/^page\s*\{/m, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const store = new Store(":memory:"); let raw, record, online;
try {
  const room = completed(); store.save(room); raw = store.replayFor("wx:replay-5", room.matchRecord.id);
  record = presentMatches([store.matchFor("wx:replay-5", room.matchRecord.id)])[0];
  const onlineRoom = onlineCompleted(); store.save(onlineRoom);
  online = store.replayFor("wx:replay-5", onlineRoom.matchRecord.id);
}
finally { store.close(); }
const longNames = structuredClone(online);
for (const p of longNames.initialPlayers) p.name = "昵称较长的玩家名字测试";
for (const e of longNames.events) for (const card of e.cards || []) if (card.actor) card.actor.name = "昵称较长的玩家名字测试";
const scenes = {
  overview: presentReplay(raw), round: presentReplay(raw, "global", ["round-2"]),
  mine: presentReplay(raw, "mine", ["round-1"]),
  player: { ...presentReplay(raw), playerDetail: trajectory(raw, 7) },
  final: { ...presentReplay(raw), playersExpanded: true },
  emptyKnife: presentReplay({ ...raw, final: { ...raw.final, targetSeat: 0, target: null, emptyWin: false, hit: null } }),
  noKnife: presentReplay({ ...raw, winner: null, final: { ...raw.final, actor: null, target: null, targetSeat: null, hit: null } }),
  online: presentReplay(online, "global", ["round-1", "round-2", "round-3"]),
  onlineMine: presentReplay(online, "mine", ["round-1", "round-2", "round-3"]),
  longNames: presentReplay(longNames, "global", ["round-1", "round-2", "round-3"]),
  legacyRound: presentReplay({ ...raw, message: "", status: "legacy", events: raw.events.filter(e => e.round === 2).flatMap(e =>
    e.kind === "quest" ? [{ ...e, cards: [] }] : e.kind === "skills" ? e.actions.map((action, i) =>
      ({ id: e.id + ":" + i, kind: "skills", round: e.round, actions: [action], summary: null })) : []) }, "global", ["round-2"]),
  legacy: presentReplay({ ...raw, events: [], status: "legacy", message: "旧对局未保存完整复盘，仅展示已有记录；缺失过程不作推测。" }),
  error: { replay: null, error: "对局记录不存在或已移除" },
};
fs.mkdirSync(output, { recursive: true });
const styles = css("app.wxss") + css("pages/replay/replay.wxss");
function writeScene(name, file, data, styles) {
  const rendered = html(factory(file)(data));
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>对局复盘 · ${name}</title><style>body{margin:0}view,section{display:block}button{font:inherit;border:0}.preview-nav{height:76px;display:flex;align-items:center;justify-content:center;position:sticky;top:0;z-index:100;background:#101c24;border-bottom:1px solid #30404a}.preview-nav button{position:absolute;left:12px;width:44px;min-height:44px;font-size:30px;padding:0}.replay-jumps,.replay-task-pips{overflow:auto}.replay-sheet-body,.records-pane{overflow-y:auto}${styles}</style>${rendered}</html>`);
}
for (const [name, data] of Object.entries(scenes)) writeScene(name, "pages/replay/replay.wxml", { loading: false, error: "", playersExpanded: false, playerDetail: null,
  activeRoundId: data.rounds?.find(r => r.expanded)?.id || "", ...data }, styles);
const records = createRecords("matches").data;
writeScene("entry", "pages/matches/matches.wxml", { ...records, historyStarted: true,
  history: { ...records.history, loading: false, loaded: true, records: [record], total: 1 } }, css("app.wxss") + css("pages/matches/matches.wxss"));
writeScene("detail", "pages/match-detail/match-detail.wxml", { loading: false, error: "", record }, css("app.wxss") + css("pages/match-detail/match-detail.wxss"));
console.log("Production replay projections: " + output);
