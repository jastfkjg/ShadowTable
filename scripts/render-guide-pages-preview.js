// Layout projection of the production WXML/WXSS, with real help and rule data.
// Native WeChat picker, scroll-view and device safe-area behavior need device QA.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { wxmlToJs } = require("miniprogram-compiler");
const { BOARDS } = require("../server/engine"), detail = require("../server/board-info");
const presentation = require("../miniprogram/board-detail"), { decorateBoard } = require("../miniprogram/board-detail-art");
const monthly = require("../miniprogram/monthly-report"), { monthlyFixture } = require("../tests/helpers/monthly-fixtures");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(__dirname, "../output/playwright/guide-pages-implemented");
const context = { window: {}, global: {}, console }; vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = file => fs.readFileSync(path.join(root, file), "utf8")
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/^page\s*\{/m, "body {")
  .replace(/(-?[\d.]+)rpx/g, "calc($1 * min(100vw, 520px) / 750)")
  .replace(/(\s|>)(view|text)(?=[\s.{:#>,+])/g, (_, before, tag) => before + (tag === "view" ? "div" : "span"))
  .replace(/(\.|\s|>)image(?=[\s.{:#>,])/g, (_, before) => before + "img");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (node.tag === "wx-app-nav") return html(factory("components/app-nav/app-nav.wxml")({ ...node.attr, statusBarHeight: 24, navHeight: 44, totalHeight: 68 }));
  const tag = ({ "wx-text": "span", "wx-button": "button", "wx-image": "img", "wx-input": "input" })[node.tag] || "div";
  const attributes = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === "disabled") return value ? ["disabled"] : [];
    if (key.startsWith("aria")) key = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    if (key === "src" && String(value).startsWith("/")) value = "/miniprogram" + value;
    if (key === "style") value = String(value).replace(/(-?[\d.]+)rpx/g, "calc($1 * min(100vw, 520px) / 750)");
    if (key.startsWith("bind") || key.startsWith("catch")) return [`data-${key}="${safe(value)}"`];
    return ["class", "id", "src", "style", "role", "placeholder", "value", "aria-label", "aria-selected", "aria-pressed", "aria-expanded", "aria-hidden", "aria-modal", "aria-controls"].includes(key) || key.startsWith("data-") ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attributes}>${(node.children || []).map(html).join("")}${["img", "input"].includes(tag) ? "" : `</${tag}>`}`;
}
function page(name, request) {
  const file = path.join(root, "pages", name, name + ".js"), realRequire = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { Page: value => { definition = value; }, require: name => name === "../../api" ? { request } : realRequire(name) });
  return { ...definition, data: structuredClone(definition.data), alive: true, setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const keys = key.replace(/\[(\d+)\]/g, ".$1").split("."); let target = this.data;
      for (const part of keys.slice(0, -1)) target = target[part]; target[keys.at(-1)] = value;
    }
  } };
}
const tap = dataset => ({ currentTarget: { dataset } });
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const scenes = {};
  const help = page("help", async url => url === "/api/boards" ? { boards: BOARDS } : require("../server/scoring").publicRules());
  help.onLoad(); await new Promise(resolve => setImmediate(resolve));
  scenes.help = ["help", structuredClone(help.data)];
  help.setGuideMode(tap({ mode: "host" })); scenes.host = ["help", structuredClone(help.data)];
  help.searchHelp({ detail: { value: "发牌" } }); scenes["help-search"] = ["help", structuredClone(help.data)];
  help.clearSearch(); help.toggleBoards(); scenes["help-boards"] = ["help", structuredClone(help.data)];
  help.data.scoringOnly = true; scenes.scoring = ["help", structuredClone(help.data)];
  const fixture = monthlyFixture(); fixture.month = "2026-10"; fixture.status = "preview"; fixture.overview = { games: 9, players: 18, activeDays: 2 };
  fixture.mainBoards[0].rows = [["阿伟", 19, 6, 1], ["wyc", 12, 6, 2], ["元", 11, 6, 3], ["橙C", 11, 4, 3]].map(([nickname, points, scoredGames, rank], i) => ({ publicId: "sample-" + i, nickname, points, scoredGames, rank, tied: rank === 3, avatarUrl: null }));
  fixture.mainBoards[1].rows = [];
  fixture.mainBoards[2].rows = [["子龙", 9, 3, 1], ["玉虚宫", 8, 4, 2], ["wyc", 8, 5, 2]].map(([nickname, total, wins, rank], i) => ({ publicId: "games-" + i, nickname, total, wins, rank, tied: rank === 2, avatarUrl: null }));
  fixture.funBoards = fixture.funBoards.filter(board => board.sort === "count").map(board => ({ ...board, rows: board.rows.slice(0, 2).map((row, i) => ({ ...row, nickname: i ? "阿伟" : "子龙", count: 1, opportunities: i ? 1 : 2, rate: i ? 100 : 50, rank: 1, tied: true })) }));
  const report = monthly.presentReport(fixture);
  for (const board of report.funBoards) if (board.metric.startsWith("merlin_")) board.portrait = "/assets/roles/merlin.png";
  const monthlyBase = { month: report.month, report, category: "overall", loading: false, error: "", entertainment: false, detailBoards: monthly.detailBoards(report), navTop: 68 };
  scenes.monthly = ["monthly", monthlyBase];
  scenes.honors = ["monthly", { ...monthlyBase, category: "honors" }];
  scenes.entertainment = ["monthly", { ...monthlyBase, category: "fun", entertainment: true, detailBoards: monthly.detailBoards(report, "count", true) }];
  scenes["monthly-rules"] = ["monthly", { ...monthlyBase, rulesExpanded: true }];
  scenes["monthly-empty"] = ["monthly", { ...monthlyBase, report: monthly.presentReport({ ...fixture, overview: { games: 0, players: 0 }, mainBoards: [], funBoards: [] }) }];
  scenes["monthly-error"] = ["monthly", { ...monthlyBase, report: null, error: "网络连接失败，请重试。" }];
  scenes["monthly-long"] = ["monthly", { ...monthlyBase, report: { ...report, coreBoards: [{ ...report.coreBoards[0], rows: [{ ...report.coreBoards[0].rows[0], nickname: "非常非常长的玩家昵称用于检查换行", value: "-123456789", valueCompact: true }] }] } }];
  for (const source of BOARDS.filter(board => board.available)) for (const capacity of source.counts) {
    const board = decorateBoard(presentation.presentBoard({ ...source, detail: detail[source.id] }, capacity));
    const data = { loading: false, error: "", board, navTop: 68, query: "", selectedGroup: board.groups[0]?.id || "", tab: board.defaultTab, chapters: board.chapters, currentChapter: 0, visibleRoles: presentation.visibleRoles(board, board.groups[0]?.id || "") };
    scenes[source.id + "-" + capacity] = ["board-details", data];
  }
  const boardBase = scenes["knights-12"][1];
  scenes["board-error"] = ["board-details", { loading: false, error: "网络连接失败，请重试。" }];
  scenes["knights-rules"] = ["board-details", { ...boardBase, tab: "rules" }];
  scenes.directory = ["board-details", { ...boardBase, directoryExpanded: true }];
  scenes["role-expanded"] = ["board-details", { ...boardBase, visibleRoles: presentation.visibleRoles(boardBase.board, "b-good", "", { "0:0": true }) }];
  const common = css("app.wxss") + css("components/app-nav/app-nav.wxss");
  for (const [id, [name, data]] of Object.entries(scenes)) {
    fs.writeFileSync(path.join(output, id + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="icon" href="data:,"><title>${safe(id)} · 实际小程序模板</title><style>body{margin:0}button{font:inherit;border:0;width:100%}input{border:0;background:none}img{object-fit:contain}.directory-list,.monthly-rules-body{overflow-y:auto}${common + css("pages/" + name + "/" + name + ".wxss")}</style>${html(factory("pages/" + name + "/" + name + ".wxml")(data))}</html>`);
  }
  const mainScreens = ["help", "monthly", "classic-6", "knights-12"], detailScreens = ["host", "honors", "knights-rules", "directory"];
  for (const [id, names] of [["overview", mainScreens], ["details", detailScreens]]) fs.writeFileSync(path.join(output, id + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>已实现 · ${id}</title><style>body{margin:0;padding:30px 44px;background:#0b141a;color:#f2eee5;font:14px -apple-system,'PingFang SC',sans-serif}h1{font-size:25px;margin:0 0 9px}p{color:#b1bfc6;margin:0 0 24px;font-size:12px}.screens{display:flex;gap:24px}section{width:390px}h2{font-size:13px;font-weight:500;margin:0 0 12px}iframe{display:block;width:390px;height:844px;border:1px solid #34434e;border-radius:25px;box-sizing:border-box}</style><h1>使用帮助、月度战报与板子详情 · 已实现</h1><p>实际 WXML / WXSS 布局投影 · 保留现有规则与统计口径</p><div class="screens">${names.map(name => `<section><h2>${safe(name)}</h2><iframe src="${name}.html" title="${name}"></iframe></section>`).join("")}</div>`);
  fs.writeFileSync(path.join(output, "scenes.json"), JSON.stringify(Object.keys(scenes)));
  console.log("Production page projections: " + output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
