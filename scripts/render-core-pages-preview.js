// Project the production mini-program templates for visual QA. Native interactions
// remain covered by controller tests and still require a device smoke test.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { Store } = require("../server/store");
const { completed, onlineCompleted } = require("../tests/helpers/replay-fixtures");
const { presentReplay, trajectory } = require("../miniprogram/replay");
const { presentEntries } = require("../miniprogram/pages/scores/presentation");
const createTable = require("../miniprogram/pages/table/controller");
const roomSwipe = require("../miniprogram/room-swipe");
const roomList = require("../miniprogram/room-list");
const connectionFeedback = require("../miniprogram/connection-feedback");
const { present: presentDialog } = require("../miniprogram/dialog");
const roomConfirmation = require("../miniprogram/room-confirmation");
const { tabBarVisibility } = require("../miniprogram/tab-navigation");
const { BOARDS, newRoom, enter, publicView } = require("../server/engine");
const { presentRoleGroups, fitBody, presentPrivateIdentity, presentFairyResult, presentVision } = require("../miniprogram/room-sheet-presentation");
const { portrait } = require("../miniprogram/role-portraits");
const tableFixtures = require("../tests/helpers/replay-fixtures");
const { privateView } = require("../server/engine");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(process.argv[2] || path.join(__dirname, "../output/playwright/core-pages-implemented"));
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const css = file => fs.readFileSync(path.join(root, file), "utf8")
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/(^|[\s>+~])(text|image|picker|scroll-view|view)(?=[\s.:#\[>+~,{])/gm, (_, before, tag) => before + ({ text: "span", image: "img", picker: "div", view: "div", "scroll-view": "div" })[tag])
  .replace(/^page\s*\{/m, "body {").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
let previewConnection = null;
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (!node.tag || node.tag === "wx-block") return (node.children || []).map(html).join("");
  if (node.tag === "wx-connection-state") return previewConnection ? html(factory("components/connection-state/connection-state.wxml")(previewConnection)) : "";
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
    return ["id", "class", "src", "style", "role", "aria-label", "aria-live", "aria-busy", "aria-selected", "aria-pressed", "aria-expanded", "aria-hidden", "aria-haspopup", "aria-modal", "value", "placeholder", "maxlength"].includes(key) ? [`${key}="${safe(value)}"`] : [];
  }).join(" ");
  return `<${tag} ${attrs}>${(node.children || []).map(html).join("")}${["img", "input"].includes(tag) ? "" : `</${tag}>`}`;
}
// Include native button clipping so nested rounded outlines cannot hide QA defects.
const projection = 'body{margin:0}button,input{font:inherit}button{position:relative;overflow:hidden;border:0;width:100%}span{display:inline}img{object-fit:contain}a{text-decoration:none;color:inherit}input{box-sizing:border-box}[hidden]{display:none!important}.preview-nav{position:relative;flex-shrink:0}.preview-clock{position:absolute;z-index:101;top:14px;left:28px;font-size:14px;font-weight:600}.preview-capsule{position:absolute;z-index:101;right:16px;top:50px;height:32px;width:87px;border:1px solid #65747b;border-radius:18px;display:flex;align-items:center;justify-content:space-evenly;font-size:14px;background:#0c171d}.preview-capsule i{height:17px;width:1px;background:#65747b}.preview-capsule b{font-size:24px;font-weight:500}.preview-homebar{position:fixed;z-index:500;bottom:8px;left:50%;transform:translateX(-50%);height:4px;width:132px;border-radius:4px;background:#c5cbd0;pointer-events:none}';
const common = css("app.wxss") + css("components/app-nav/app-nav.wxss") + css("components/app-dialog/app-dialog.wxss") + css("components/connection-state/connection-state.wxss");
fs.mkdirSync(output, { recursive: true });
const scenes = [];
function write(name, file, data, styles, extra = "") {
  data = { ...data };
  const key = data.personal && data.activeTab === 1 ? "personal" : data.publicShare && data.sharedSurface ? "publicShare" : data.statistics ? data.tab === "matches" ? "history" : "statistics" : "";
  const owner = key ? data[key] = { ...data[key] } : data;
  const manual = file === "pages/table/table.wxml" || data.lobby && data.activeTab !== 1;
  const runtime = owner.connectionPreview || (owner.loading && !owner.error ? { active:true, startedAt:Date.now() } : null);
  previewConnection = !manual && runtime ? { ...owner, ...connectionFeedback.present({ ...owner, network:owner.network !== false }, { context:"page", ...runtime }), connectionVisible:true } : null;
  if (previewConnection) owner.connectionVisible = true;
  const rendered = html(factory(file)(data));
  const dialog = data.appDialog || data.lobby?.appDialog;
  const alert = dialog ? html(factory("components/app-dialog/app-dialog.wxml")({ dialog: { ...presentDialog(dialog), id: 1 } })) : "";
  fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>桌边助手 · ${name} · 实际模板</title><style>${projection}${common}${styles}${dialog?'.tab-bar{display:none}.preview-homebar{z-index:5100}':''}</style>${rendered}${extra}${alert}<div class="preview-homebar"></div></html>`);
  scenes.push(name);
}
// Browser projection of the native selector-query measurement, not app behavior.
const sheetProjection = `<script>window.fitRoomSheets=()=>{const fit=${fitBody.toString()};for(const [prefix,sheetSelector,bodySelector] of [['.entry','.entry-sheet','.entry-sheet-scroll-region'],['.room-rules','.room-rules-sheet','.room-rules-body']]){const sheet=document.querySelector(sheetSelector),backdrop=document.querySelector(prefix+'-backdrop');if(!sheet||!backdrop)continue;const rects=[backdrop,...['-sheet-top','-sheet-fields','-sheet-footer'].map(s=>document.querySelector(prefix+s))].map(el=>el?.getBoundingClientRect());const height=fit(rects,prefix==='.entry'?parseFloat(getComputedStyle(sheet).getPropertyValue('--entry-keyboard-height'))||0:0);if(height!==null){document.querySelector(bodySelector).style.height=height+'px';sheet.classList.add('has-measured-body');sheet.classList.remove('is-measuring');}}};addEventListener('load',window.fitRoomSheets);addEventListener('resize',window.fitRoomSheets);</script>`;
const store = new Store(":memory:");
let raw, online;
try {
  const room = completed(); store.save(room); raw = store.replayFor("wx:replay-5", room.matchRecord.id);
  const onlineRoom = onlineCompleted(); store.save(onlineRoom); online = store.replayFor("wx:replay-5", onlineRoom.matchRecord.id);
} finally { store.close(); }
const legacy = { ...raw, endedAt: Date.parse("2026-10-11T23:33:00+08:00"), status: "legacy", winner: null,
  message: "旧对局未保存完整复盘，仅展示已有记录；缺失过程不作推测。",
  self: { ...raw.self, outcome: "excluded", score: { status: "legacy" } },
  final: { ...raw.final, label: "房主登记结果", actor: null, target: null, targetSeat: null, hit: null, emptyWin: null },
  events: raw.events.filter(e => e.kind === "quest").map(e => ({ ...e, cards: [] })),
};
const unknown = structuredClone(raw);
unknown.initialPlayers[0].role = null; unknown.initialPlayers[0].faction = "unknown";
const long = structuredClone(online);
long.boardName = "阿瓦隆 · 十二骑士与扩展角色配置测试";
long.self.name = "昵称较长的玩家名字测试";
for (const p of [...long.initialPlayers, ...long.finalPlayers]) p.name = "昵称较长的玩家名字测试";
const replayScenes = {
  replay: presentReplay(legacy), "replay-complete": presentReplay(raw), "replay-round": presentReplay(online, "global", ["round-1", "round-2", "round-3"]),
  "replay-mine": presentReplay(raw, "mine", ["round-1"]), "replay-player": { ...presentReplay(raw), playerDetail: trajectory(raw, 7) },
  "replay-final": { ...presentReplay(raw), playersExpanded: true }, "replay-unknown": presentReplay(unknown),
  "replay-long": presentReplay(long, "global", ["round-1", "round-2", "round-3"]),
  "replay-empty": presentReplay({ ...legacy, events: [] }), "replay-error": { replay: null, error: "对局记录不存在或已移除" }, "replay-loading": { loading: true },
};
for (const [name, data] of Object.entries(replayScenes)) write(name, "pages/replay/replay.wxml", { loading: false, error: "", playersExpanded: false, playerDetail: null, activeRoundId: "", ...data }, css("pages/replay/replay.wxss"));
const at = (day, time) => Date.parse(`2026-10-${day}T${time}:00+08:00`);
const record = (id, role, time, points, faction, outcome, capacity = 12) => ({ id, type: "match", boardName: "阿瓦隆 · 十二骑士" + (capacity === 12 ? "" : `（${capacity}人）`), capacity, role, faction, outcome, points, occurredAt: at("11", time) });
const records = presentEntries([
  record("assassin", "刺客", "23:29", 0, "evil", "loss", 11), record("gareth", "蓝刀客·加雷斯", "22:11", 1, "good", "loss"),
  record("morgana", "莫甘娜", "20:21", 3, "evil", "win"), record("gaheris", "蓝刀客·加赫雷斯", "18:03", 4, "good", "win"),
  record("servant", "亚瑟的忠臣", "16:51", 0, "good", "loss"), record("servant10", "亚瑟的忠臣", "15:25", 1, "good", "loss", 10),
  { id: "adjust-minus", type: "adjustment", points: -2, beforePoints: 2, afterPoints: 0, reason: "修正重复登记", occurredAt: at("07", "10:20") },
  { id: "adjust-plus", type: "adjustment", points: 2, beforePoints: 0, afterPoints: 2, reason: "现场积分核对", occurredAt: at("07", "10:10") },
]);
const scoreBase = { loaded: true, loading: false, error: "", notice: "", records, summary: { total: 9 }, total: 8, hasMore: false, moreError: "", loadingMore: false };
const scoreScenes = {
  scores: {}, "scores-adjustment": { records: records.slice(-2), total: 2, summary: { total: 0 } },
  "scores-empty": { records: [], total: 0, summary: { total: 0 } }, "scores-loading": { loaded: false, loading: true },
  "scores-error": { loaded: false, error: "网络异常，积分明细未能加载" }, "scores-more": { hasMore: true }, "scores-retry": { moreError: "网络异常，加载更多失败" },
  "scores-long": { summary: { total: -999999999 }, total: 2, records: presentEntries([
    { ...record("long", "觉醒蓝刀客·加赫雷斯", "23:29", -999999999, "good", "loss"), boardName: "阿瓦隆 · 十二骑士与扩展角色配置测试（12人）" },
    { id: "adjust-long", type: "adjustment", points: 100000000, beforePoints: -1099999999, afterPoints: -999999999, reason: "积分修正原因较长的记录，完整显示原始原因及操作时的积分余额", occurredAt: at("11", "22:00") },
  ]) },
};
for (const [name, data] of Object.entries(scoreScenes)) write(name, "pages/scores/scores.wxml", { ...scoreBase, ...data }, css("pages/scores/scores.wxss"));
let helpData;
vm.runInNewContext(fs.readFileSync(path.join(root, "pages/help/help.js"), "utf8"), { require: () => ({}), Page: page => { helpData = page.data; } });
const scoringRules = require("../server/scoring").publicRules();
const scoringBase = { ...helpData, scoringOnly: true, scoringRules, scoringLoading: false, scoringError: "" };
const legacyScoringRules = { ...scoringRules }; delete legacyScoringRules.table; delete legacyScoringRules.bonuses;
for (const [name, data] of Object.entries({
  "scoring-rules": {},
  "scoring-rules-help": { scoringOnly: false, references: [{ id: "scoring", title: "计分规则", subtitle: "计分范围与加分项目", icon: "record-cup", expanded: true }] },
  "scoring-rules-legacy": { scoringRules: legacyScoringRules },
  "scoring-rules-loading": { scoringRules: null, scoringLoading: true },
  "scoring-rules-error": { scoringRules: null, scoringError: "计分规则暂未加载，请重试。" },
})) write(name, "pages/help/help.wxml", { ...scoringBase, ...data }, css("pages/help/help.wxss"));
const homeBase = { ...createTable({ lobby: true }).data, loading: false, serverConnected: true };
const room = (code, status, people, relation, activity, extra = {}) => ({ code, status, statusLabel: status === "lobby" ? "待开局" : status === "playing" ? "进行中" : "已结束", boardName: "阿瓦隆 · 十二骑士", peopleLabel: people, compactRelation: relation, activityLabel: activity, entryLabel: status === "ended" ? "查看牌桌" : "返回牌桌", available: true, updatedAt: 1, canSwipeDissolve: true, isHost: true, isMember: true, canLeave: true, ...extra });
const rooms = [room("201375", "lobby", "12/12 人已入座", "我是房主 · 1号", "今天 15:50"), room("534718", "lobby", "1/12 人已入座", "我是房主 · 1号", "10/13 14:53"), room("273843", "ended", "11 人", "房主：大V · 我在4号", "10/11 23:33", { boardName: "阿瓦隆 · 十二骑士（11人）", isHost: false, canSwipeDissolve: false })];
const homeScenes = {
  "home-connection-connecting": { loading: true, serverConnected: false, memberRooms: [], visibleMemberRooms: [] },
  "home-connection-reconnecting": { reconnecting: true, serverConnected: false, roomsSyncLabel: "21:16", memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  "home-connection-retrying": { loading: true, reconnecting: true, serverConnected: false, roomsSyncLabel: "21:16", memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  "home-connection-offline": { network: false, reconnecting: true, serverConnected: false, roomsSyncLabel: "21:16", memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  "home-connection-no-cache": { reconnecting: true, serverConnected: false, memberRooms: [], visibleMemberRooms: [] },
  "home-connection-ready": { roomsSyncLabel: "21:17", memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  "home-connection-timeout": { reconnecting: true, serverConnected: false, roomsSyncLabel: "23:03", memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  "home-connection-pending": { loading: true, reconnecting: true, hasPendingRequest: true, serverConnected: false, roomsSyncLabel: "23:03", memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  "home-connection-cooldown": { reconnecting: true, serverConnected: false, memberRooms: [rooms[0]], visibleMemberRooms: [rooms[0]] },
  home: {}, "home-empty": { memberRooms: [], visibleMemberRooms: [] }, "home-loading": { loading: true, memberRooms: [], visibleMemberRooms: [] },
  "home-offline": { network: false, serverConnected: false }, "home-swipe": { roomSwipeCode: rooms[0].code, roomSwipeOffset: -roomSwipe.width(rooms[0]) },
  "home-swipe-single": { roomSwipeCode: rooms[2].code, roomSwipeOffset: -roomSwipe.width(rooms[2]) },
  "home-menu": { roomMenu: rooms[0] }, "home-join": { entrySheet: true, entryMode: "join", name: "子龙", nicknameSetup: false },
  "home-menu-member": { roomMenu: { ...rooms[0], code: "993636", boardName: "阿瓦隆 · 十二骑士（10人）", isHost: false } },
  "home-menu-ended": { roomMenu: { ...rooms[2], code: "672158", boardName: "阿瓦隆 · 十二骑士", canLeave: false } },
  "home-menu-expired": { roomMenu: { ...rooms[2], available: false, statusLabel: "已失效", canLeave: false } },
  "home-menu-busy": { roomMenu: rooms[0], busy: true },
  "home-menu-long": { roomMenu: { ...rooms[0], boardName: "阿瓦隆 · 十二骑士与扩展角色配置测试，较长的牌桌名称完整显示" } },
  "home-keyboard": { entrySheet: true, entryMode: "join", entryKeyboardHeight: 320, entryFocusedField: "code", code: "2013", name: "子龙", nicknameSetup: false },
  "home-long": { memberRooms: [...rooms, ...rooms], visibleMemberRooms: [room("201375", "playing", "12/12 人已入座 · 3人准备", "房主：昵称较长的玩家名字测试 · 我在12号", "2026/10/16 15:50", { note: "这是一个用于检查窄屏长备注换行的牌桌记录", boardName: "阿瓦隆 · 十二骑士与扩展角色配置测试（12人）" })] },
};
const feedbackNow = Date.now();
for (const [name, runtime] of Object.entries({
  "home-connection-connecting": { active:true, startedAt:feedbackNow-3000 },
  "home-connection-reconnecting": { failure:"failed", retryAt:feedbackNow+5000 },
  "home-connection-retrying": { active:true, startedAt:feedbackNow-3000 },
  "home-connection-no-cache": { failure:"failed", retryAt:feedbackNow+5000 },
  "home-connection-timeout": { failure:"timeout", retryAt:feedbackNow+5000 },
  "home-connection-pending": { active:true, startedAt:feedbackNow-3000, pending:{after:"enter",path:"/api/rooms"} },
  "home-connection-cooldown": { failure:"rate", retryAt:feedbackNow+60000, rateLimitUntil:feedbackNow+60000 },
})) homeScenes[name].connectionRuntime = runtime;
const roomsNow = Date.now();
const organizedRooms = [room("201375", "lobby", "6/12 人已入座", "我是房主 · 1号", "今天 12:30", { updatedAt: roomsNow }),
  ...Array.from({ length: 5 }, (_, i) => room(String(273840 + i), "ended", "11 人", "房主：大V · 我在4号", i ? "昨天 21:24" : "今天 11:20", {
    updatedAt: roomsNow - (i + 1) * 3600000, boardName: i ? "阿瓦隆 · 十二骑士" : "阿瓦隆 · 十二骑士（11人）", isHost: false, canSwipeDissolve: false,
  })),
  room("534718", "ended", "12 人", "我是房主 · 1号", "10/11 23:29", { updatedAt: roomsNow - 6 * 86400000 }),
  room("623811", "unavailable", "12 人", "房间已解散", "10/10 22:16", { updatedAt: roomsNow - 7 * 86400000, statusLabel: "已失效", entryLabel: "已失效", available: false, canSwipeDissolve: false }),
];
const organized = { memberRooms: organizedRooms, ...roomList.present(organizedRooms, "all", roomsNow) };
homeScenes["home-room-organized"] = organized;
homeScenes["home-room-history"] = { ...organized, historyExpanded: true };
homeScenes["home-room-history-entering"] = { ...organized, historyExpanded: true, busy: true, hasPendingRequest: true, enteringCode: organizedRooms[1].code };
homeScenes["home-room-history-refreshing"] = { ...organized, historyExpanded: true, roomsRefreshing: true };
homeScenes["home-room-unavailable"] = { memberRooms: organizedRooms, ...roomList.present(organizedRooms, "all", roomsNow), historyExpanded: true };
homeScenes["home-history-only"] = { memberRooms: [organizedRooms[6]], ...roomList.present([organizedRooms[6]], "all", roomsNow) };
homeScenes["home-unavailable-only"] = { memberRooms: [organizedRooms[7]], ...roomList.present([organizedRooms[7]], "all", roomsNow) };
const expiredRooms = [
  room("534718", "unavailable", "12 人", "房间已解散", "10/17 11:55", { updatedAt: roomsNow - 4 * 86400000, statusLabel: "已失效", available: false, canSwipeDissolve: false }),
  room("201375", "unavailable", "12 人", "房间已解散", "10/16 21:24", { updatedAt: roomsNow - 5 * 86400000, statusLabel: "已失效", available: false, canSwipeDissolve: false }),
];
homeScenes["home-expired-hidden"] = { memberRooms: expiredRooms, ...roomList.present(expiredRooms, "all", roomsNow), historyExpanded: true };
const redesignRooms = [room("201375", "ended", "12 人", "我是房主 · 1号", "昨天 21:24", { updatedAt: roomsNow - 86400000, entryLabel: "查看结果" }),
  room("273843", "ended", "11 人", "房主：大V · 我在4号", "10/11 23:29", { updatedAt: roomsNow - 6 * 86400000, entryLabel: "查看结果", boardName: "阿瓦隆 · 十二骑士（11人）", isHost: false, canSwipeDissolve: false }),
  room("534718", "unavailable", "12 人", "房间已解散", "11:55", { updatedAt: roomsNow - 7 * 86400000, statusLabel: "已失效", entryLabel: "已失效", available: false, canSwipeDissolve: false })];
const redesign = { memberRooms: redesignRooms, ...roomList.present(redesignRooms, "all", roomsNow), historyExpanded: true };
homeScenes["home-room-redesign"] = redesign;
homeScenes["home-room-redesign-collapsed"] = { ...redesign, historyExpanded: false };
homeScenes["home-room-redesign-expanded"] = redesign;
const remainingRedesignRooms = redesignRooms.filter(room => room.code !== "273843");
homeScenes["home-room-removed"] = { memberRooms: remainingRedesignRooms, ...roomList.present(remainingRedesignRooms, "all", roomsNow), historyExpanded: true };
homeScenes["home-room-removed-feedback"] = { ...homeScenes["home-room-removed"], roomFeedback: "已移除" };
homeScenes["home-room-redesign-refreshing"] = { ...redesign, roomsRefreshing: true };
homeScenes["home-room-redesign-swipe"] = { ...redesign, roomSwipeCode: redesignRooms[1].code, roomSwipeOffset: -roomSwipe.width() };
homeScenes["home-room-redesign-swipe-expired"] = { ...redesign, roomSwipeCode: redesignRooms[2].code, roomSwipeOffset: -roomSwipe.width() };
homeScenes["home-room-redesign-swipe-host"] = { ...redesign, historyRooms: redesign.historyRooms.map(r => r.code === redesignRooms[1].code ? { ...r, isHost: true, canSwipeDissolve: true } : r), roomSwipeCode: redesignRooms[1].code, roomSwipeOffset: -roomSwipe.width() };
for (const [name, appDialog] of Object.entries({
  'dialog-remove': roomConfirmation.present('hide', { code:'993636', status:'lobby' }),
  'dialog-leave': roomConfirmation.present('leave', { code:'993636', status:'lobby', isHost:false }),
  'dialog-leave-host': roomConfirmation.present('leave', { code:'993636', status:'lobby', isHost:true }),
  'dialog-dissolve': roomConfirmation.present('delete', { code:'858201', status:'lobby' }),
  'dialog-information': { title:'关于桌边助手', content:'ShadowTable · 为面对面的阿瓦隆聚会而做。\n身份、投票与技能交给牌桌，讨论和故事留给同桌的朋友。', showCancel:false },
  'dialog-long': { title:'荣誉徽章规则', content:require('../miniprogram/badges').rules + '\n趣味徽章按次数榜授予。最多佩戴3枚。', showCancel:false },
})) homeScenes[name] = { ...redesign, appDialog };
function entryScene(capacity, boardId, extra = {}) {
  const page = createTable({ lobby: true });
  page.data = { ...page.data, boards: BOARDS };
  page.setData = (values, callback) => { Object.assign(page.data, values); callback?.(); };
  page.selectCapacity(capacity);
  page.pickBoard({ currentTarget: { dataset: { index: page.data.availableBoards.findIndex(board => board.id === boardId) } } });
  return { ...page.data, loading:false, serverConnected:true, entrySheet:true, entryMode:'create', nicknameSetup:false,
    name:'子龙', entryAvatarUrl:'/pages/profile/assets/avatars/crayon-07.jpg', ...extra };
}
Object.assign(homeScenes, {
  'entry-join': entryScene(6,'classic',{entryMode:'join'}),
  'entry-code': entryScene(6,'classic',{entryMode:'join',code:'062819',entryFocusedField:'code'}),
  'entry-join-error': entryScene(6,'classic',{entryMode:'join',code:'062',entryCodeError:'请输入完整的 6 位数字房间码'}),
  'entry-new-player': entryScene(6,'classic',{entryMode:'join',name:'',nicknameSetup:true,entryNameError:'请填写昵称'}),
  'entry-create6': entryScene(6,'classic'), 'entry-create12': entryScene(12,'knights'),
  'entry-create9': entryScene(9,'classic-court'), 'entry-create11': entryScene(11,'classic-11'),
  'entry-lancelot11': entryScene(11,'lancelot'), 'entry-lancelot12': entryScene(12,'lancelot'),
  'entry-classic12': entryScene(12,'classic-court'), 'entry-chaos12': entryScene(12,'chaos'),
  'entry-create13': entryScene(13,'knights-13'),
  'entry-keyboard': entryScene(12,'knights',{entryKeyboardHeight:320,entryFocusedField:'nickname'}),
  'entry-pending': entryScene(12,'knights',{hasPendingRequest:true,entryError:'请求尚未确认，请等待连接恢复'}),
  'entry-long': entryScene(12,'knights',{name:'昵称较长的玩家名字测试',entryNameError:'昵称未能保存，请检查网络后重试'}),
});
for (const [name, data] of Object.entries(homeScenes)) {
  const { connectionRuntime, ...scene } = data;
  const lobby = { ...homeBase, memberRooms: rooms, visibleMemberRooms: rooms, ...scene };
  Object.assign(lobby, connectionFeedback.present(lobby, connectionRuntime || {}, feedbackNow));
  lobby.availableRoomCount = roomList.availableRooms(lobby.memberRooms).length;
  const tabs = html(factory("custom-tab-bar/index.wxml")({ selected: 0, ...tabBarVisibility({ data: { lobby } }, 0), list: [
    { pagePath: "pages/lobby/lobby", text: "对局", icon: "/assets/tab-table.png", activeIcon: "/assets/tab-table-active.png" },
    { pagePath: "pages/me/me", text: "我的", icon: "/assets/tab-me.png", activeIcon: "/assets/tab-me-active.png" },
  ] }));
  write(name, "pages/lobby/lobby.wxml", { activeTab: 0, lobby, personal: {} }, css("pages/lobby/lobby.wxss") + css("custom-tab-bar/index.wxss") + ".tab-bar{height:78px;padding-bottom:28px}.room-feedback.above-tab{bottom:94px}.entry-sheet-footer{padding-bottom:40px}.entry-sheet.has-keyboard .entry-sheet-footer{padding-bottom:12px}.preview-homebar{z-index:1200}", tabs + sheetProjection);
}
// These fixtures render the production table templates, including private DOM
// guards. Sample stats are illustrative; game choices come from privateView.
function tableScene(source, uid, extra = {}) {
  const room = publicView(source, uid);
  if (room.phase === 'lobby' && room.me.seat !== null) room.me.avoidance = { balance: 0, selected: false };
  const history = room.history.filter(h => h.kind === 'toolQuest').map((h, i) => ({...h,key:i,number:i+1,
    questResult:h.success?'success':'failure',resultTone:h.success?'success':'failure',
    text:h.success?'任务成功':'任务失败',latestDetail:h.team.join('、')+'号 · '+h.fails+'张失败票',timeLabel:'17:29'}));
  return {...createTable().data,loading:false,room,network:true,seatsExpanded:true,
    seats:room.players.map(p=>({...p,occupied:true,mine:p.seat===room.me.seat,host:p.isHost,avatarInitial:p.name[0],inTeam:room.team.includes(p.seat)})),
    seatOccupiedCount:room.players.length,seatReadyCount:room.players.filter(p=>p.ready).length,
    operationProgressSegments:Array.from({length:room.operationProgress?.total || 0},(_,index)=>({index,completed:index<room.operationProgress.completed})),
    history,historyLatest:history.at(-1),latestResult:history.at(-1),questTimeline:history,
    teamText:room.team.join('、'),actionEntryLabel:({quest:'提交任务牌',teamVote:'参与表决',identity:'查看身份'})[room.phase] || '完成本轮操作',...extra};
}
const tableSource = tableFixtures.setup();
tableFixtures.task(tableSource,[1,2,3]);
const tablePlaying = tableScene(tableSource,'wx:replay-5',{historyUnreadCount:1});
const privateSource = privateView(tableSource,'wx:replay-5');
const privateData = {...privateSource, factionTone:'good',portrait:portrait(privateSource.role,'good').portrait,vision:presentVision(privateSource.information,tablePlaying.seats)};
const tableReadySource = newRoom('201375','host','子龙','knights',12);
for(let i=2;i<=12;i++) enter(tableReadySource,'player-'+i,'陪测'+(i-1));
enter(tableReadySource,'spectator','围观玩家');
tableReadySource.players[0].ready=true;
const tableReady = tableScene(tableReadySource,'host',{startHint:'等待其他玩家准备',canStart:false});
const tableUnreadySource = structuredClone(tableReadySource);
tableUnreadySource.players[0].ready = false;
const tableAllReadySource = structuredClone(tableReadySource);
tableAllReadySource.players.forEach(player => { player.ready = true; });
const tablePlayerReadySource = structuredClone(tableReadySource);
tablePlayerReadySource.players[1].ready = true;
const badgeSamples = require('../miniprogram/badges').catalogue.slice(0,3);
const playerStats = {scoreTotal:9,rateLabel:'37.5%',rateValue:'37.5',total:8,wins:3,byFaction:[
  {faction:'evil',label:'坏人阵营',total:2,wins:1,winRate:50,rateLabel:'50.0%',rateValue:'50.0'},
  {faction:'good',label:'好人阵营',total:6,wins:2,winRate:100/3,rateLabel:'33.3%',rateValue:'33.3'}]};
const playerSample = {name:'阿伟',initial:'阿',seat:6,badges:badgeSamples};
const tableScenes = {
  'player-card-a': {...tablePlaying, playerCard: {...playerSample, name:'大V', initial:'大', seat:1, isHost:true, avatarUrl:'/pages/profile/assets/avatars/crayon-07.jpg'},
    playerCardStats: {scoreTotal:27,rateLabel:'55.6%',rateValue:'55.6',total:18,wins:10,byFaction:[
      {faction:'evil',label:'坏人阵营',total:5,wins:4,rateValue:'80.0'},
      {faction:'good',label:'好人阵营',total:13,wins:6,rateValue:'46.2'}]}},
  'table-ready':tableReady, 'table-playing':tablePlaying,
  'table-unready':tableScene(tableUnreadySource,'host',{startHint:'等待其他玩家准备',canStart:false}),
  'table-can-start':tableScene(tableAllReadySource,'host',{canStart:true,startHint:'全员已准备，可以发放身份'}),
  'table-player-ready':tableScene(tablePlayerReadySource,'player-2'),
  'table-player-unready':tableScene(tableReadySource,'player-2'),
  'table-lobby-spectator':tableScene(tableReadySource,'spectator'),
  'table-identity':{...tablePlaying,revealed:true,secret:privateData},
  'table-covered':{...tablePlaying,dealtIdentityDialog:true},
  'table-revealed':{...tablePlaying,dealtIdentityDialog:true,dealtIdentitySecret:privateData},
  'player-card':{...tablePlaying,playerCard:playerSample,playerCardStats:playerStats},
  'player-card-loading':{...tablePlaying,playerCard:{...playerSample,badges:[]},playerCardLoading:true},
  'player-card-badge':{...tablePlaying,playerCard:playerSample,playerCardStats:playerStats,playerCardBadge:badgeSamples[0]},
  'player-card-long':{...tablePlaying,playerCard:{...playerSample,name:'昵称很长的玩家名字完整展示测试'},playerCardStats:{...playerStats,scoreTotal:-123456789,rateLabel:'—',rateValue:'—',byFaction:[...playerStats.byFaction,{faction:'third',label:'盗贼阵营',total:0,wins:0,winRate:null,rateLabel:'—',rateValue:'—'}]}},
  'player-card-error':{...tablePlaying,playerCard:playerSample,playerCardError:'网络暂时不可用，请稍后重试'},
  'player-card-untracked':{...tablePlaying,playerCard:playerSample,playerCardStatus:'untracked'},
};
const completedSource = tableFixtures.completed();
tableScenes['table-ended'] = tableScene(completedSource, 'wx:replay-5');
tableScenes['table-ended-busy'] = { ...tableScenes['table-ended'], busy: true };
tableScenes['table-ended-host'] = tableScene(completedSource, 'wx:replay-1');
tableFixtures.run(tableSource,'beginActivity',{kind:'quest',team:[1,5,9],threshold:1});
const taskSource = privateView(tableSource,'wx:replay-5').action;
const taskChoices = taskSource.choices.map(value=>({value,label:taskSource.options?.find(o=>o.value===value)?.label||({success:'任务成功',fail:'任务失败',magic:'魔法（反转结果）',thiefFail:'盗贼失败'})[value]||value}));
const taskData = tableScene(tableSource,'wx:replay-5',{actionDialog:true,stagedChoice:true,actionChoices:taskChoices});
Object.assign(tableScenes,{'table-task':taskData,'table-selected':{...taskData,draftChoice:taskChoices[0].value,draftLabel:taskChoices[0].label},
  'table-host-task':tableScene(tableSource,'wx:replay-1'),
  'table-task-evil':tableScene(tableSource,'wx:replay-9',{actionDialog:true,stagedChoice:true,actionChoices:privateView(tableSource,'wx:replay-9').action.choices.map(value=>({value,label:value==='fail'?'任务失败':'任务成功'}))}),
  'table-spectator':tableScene(tableSource,'spectator')});
const thirteen = newRoom('201376','host','昵称很长的房主名字完整显示','knights-13',13);
for(let i=2;i<=13;i++) enter(thirteen,'player-'+i,'昵称很长的玩家名字'+i);
Object.assign(tableScenes,{'table-thirteen':tableScene(thirteen,'host'),
  'table-private-long':{...tablePlaying,dealtIdentityDialog:true,dealtIdentitySecret:{...privateData,information:'这是较长的私密视野说明，需要完整阅读。'.repeat(20),skillStatus:{title:'技能已使用',detail:'完整技能状态说明。'.repeat(12)}}}});
const skillSource = fs.readFileSync(path.join(root,'pages/table/controller.js'),'utf8');
const skillPresentation = vm.runInNewContext('(function(){'+skillSource.slice(skillSource.indexOf('function skillView('),skillSource.indexOf('function factionTone('))+'return {skillView,skillSelectionView};})()');
const skillFixtures = require('../tests/helpers/skill-target-fixtures');
for(const [role,mode,value] of [...skillFixtures.cases,['servant','none','pass']]) {
  const {source,room,secret}=skillFixtures.fixture(role,mode);
  const swapOptions=(secret.action.choices || []).filter(v=>v.startsWith('swap:'));
  const choices=mode==='final'?secret.action.targets.map(t=>({value:'target:'+t.seat,label:'目标'+t.seat})):secret.action.hunterModes?secret.action.options.filter(c=>c.value.startsWith(mode+':')).concat([{value:'mode:',label:'返回选择技能方式'}]):secret.action.options.filter(c=>!c.value.startsWith('swap:'));
  const data={...tableScene(source,'p2'),room,actionDialog:true,stagedChoice:true,actionChoices:choices,swapOptions,swapSeats:[],swapPlayers:[],...skillPresentation.skillView(room,choices,!!secret.action.hunterModes,secret.action.hunterModes?mode:'',swapOptions,secret.action.unavailableHint)};
  tableScenes['skill-'+role]=data;
  tableScenes['skill-'+role+'-selected']={...data,draftChoice:value,draftLabel:choices.find(c=>c.value===value)?.label||'',...skillPresentation.skillSelectionView(room,value,data.skillTargetMode),...(mode==='swap'?{swapSeats:[2,7],swapPlayers:data.swapPlayers.map(p=>({...p,selected:[2,7].includes(p.seat)}))}:{})};
}
const newIdentity=presentPrivateIdentity({role:'红猎人',faction:'坏人阵营',information:'没有视野。 主动自爆带走相邻一人；或预选场上其他一人，出局时被动开枪；也可不使用技能。主动与被动共用一次技能，替女巫出局不触发被动开枪。',skillStatus:{title:'新技能尚未启用',detail:'下次技能环节可用。'}},'evil');
const identityHistory=[{...newIdentity,id:1,current:true,sinceLabel:'第2轮 · 换牌'},{...presentPrivateIdentity({role:'亚瑟的忠臣',information:'没有视野。',faction:'好人阵营'},'good'),id:0,initial:true,sinceLabel:'开局 · A牌',detailAvailable:true}];
Object.assign(tableScenes,{
  'new-identity':{...tablePlaying,identityChange:newIdentity,identityChangeRevealed:true},
  'new-identity-covered':{...tablePlaying,identityChange:newIdentity},
  'new-identity-long':{...tablePlaying,identityChange:{...newIdentity,abilityText:newIdentity.abilityText.repeat(8)},identityChangeRevealed:true},
  'identity-history':{...tablePlaying,revealed:true,secret:{...newIdentity,identityHistory},identityHistoryOpen:true,identityHistoryExpandedId:0},
  'fairy-result':{...tablePlaying,fairyResult:presentFairyResult({summary:'7号 · 坏人',information:'7号查验结果：坏人（第2轮）'}),fairyResultRevealed:true},
  'fairy-covered':{...tablePlaying,fairyResult:presentFairyResult({summary:'7号 · 坏人'})},
  'fairy-future':{...tablePlaying,fairyResult:presentFairyResult({summary:'未来扩展结果，完整保留服务端原文。'}),fairyResultRevealed:true},
  'table-vote':{...taskData,room:{...taskData.room,phase:'teamVote'},actionChoices:[{value:'approve',label:'赞成'},{value:'reject',label:'反对'}]},
});
const voteSource=tableFixtures.setup();tableFixtures.run(voteSource,'beginActivity',{kind:'vote',team:[1,6,8]});
tableScenes['table-vote']=tableScene(voteSource,'wx:replay-5',{actionDialog:true,stagedChoice:true,actionChoices:[{value:'approve',label:'赞成'},{value:'reject',label:'反对'}]});
for(const kind of ['quest','vote','skills','assassination']) {
  const page=createTable();page.data={...tablePlaying,room:publicView(tableSource,'wx:replay-1')};
  page.setData=(v,callback)=>{Object.assign(page.data,v);callback?.();};
  page.openTool({currentTarget:{dataset:{kind}}});tableScenes['host-'+kind]=page.data;
}
const classicSource=newRoom('201377','host','子龙','classic',6);for(let n=2;n<=6;n++)enter(classicSource,'p'+n,'玩家'+n);classicSource.players.forEach(p=>p.ready=true);tableFixtures.run(classicSource,'start',{flexible:false});
const classic=tableScene(classicSource,'host'),classicPrivate=privateView(classicSource,'host');
tableScenes['classic-identity']={...classic,actionDialog:true,actionChoices:[{value:'confirm',label:'确认'}]};
tableScenes['classic-revealed']={...tableScenes['classic-identity'],actionSecret:presentPrivateIdentity(classicPrivate,classicPrivate.faction.includes('好人')?'good':'evil')};
tableScenes['classic-targets']={...classic,room:{...classic.room,phase:'assassination',needsSubmission:true},actionDialog:true,actionLabel:'选择刺杀目标',actionTargets:classic.room.players.filter(p=>p.seat!==classic.room.me.seat)};
thirteen.players.forEach(p=>p.ready=true);tableFixtures.run(thirteen,'start',{flexible:true});
const thirteenPage=createTable();thirteenPage.data=tableScene(thirteen,'host');thirteenPage.setData=(v,callback)=>{Object.assign(thirteenPage.data,v);callback?.();};thirteenPage.openTool({currentTarget:{dataset:{kind:'quest'}}});tableScenes['host-thirteen']=thirteenPage.data;
tableScenes['player-card-empty']={...tablePlaying,playerCard:playerSample,playerCardStats:{scoreTotal:0,rateLabel:'—',rateValue:'—',total:0,wins:0,byFaction:[]}};
const avoidancePresentation = require('../miniprogram/avoidance');
const avoidanceOptions = require('../server/engine').avoidanceOptions(tableReadySource).map(o => ({ ...o, portrait: portrait(o.name,o.faction).portrait }));
const avoidanceDraft = { ...tableReady, avoidanceOpen: true, avoidanceLoading: false,
  avoidance: { balance: 1, selected: null, editable: true, options: avoidanceOptions }, avoidanceDraft:'merlin',avoidanceDraftName:'梅林',
  avoidanceGroups:avoidancePresentation.groups(avoidanceOptions,'merlin') };
tableScenes['avoidance-select'] = avoidanceDraft;
tableScenes['avoidance-loading'] = { ...avoidanceDraft, avoidanceLoading: true, avoidance: { balance: 1 }, avoidanceGroups: [], avoidanceDraft:'', avoidanceDraftName:'' };
tableScenes['avoidance-empty'] = { ...avoidanceDraft, avoidance: { ...avoidanceDraft.avoidance, balance: 0 }, avoidanceDraft:'',avoidanceDraftName:'',avoidanceGroups:avoidancePresentation.groups(avoidanceOptions,null) };
tableScenes['avoidance-effective'] = { ...tablePlaying, dealtIdentityDialog:true, dealtIdentitySecret:{...privateData,avoidance:avoidancePresentation.result({status:'effective',roleName:'梅林'})} };
tableScenes['avoidance-ineffective'] = { ...tablePlaying, dealtIdentityDialog:true, dealtIdentitySecret:{...privateData,avoidance:avoidancePresentation.result({status:'ineffective',roleName:privateData.role})} };
// Project the same native four-rectangle fit used by the controller.
const merlinSource=tableFixtures.setup();
function placePreviewRole(role,seat) {
  const target=merlinSource.players.find(player=>player.seat===seat),old=merlinSource.players.find(player=>merlinSource.roles[player.uid]===role);
  [merlinSource.roles[target.uid],merlinSource.roles[old.uid]]=[merlinSource.roles[old.uid],merlinSource.roles[target.uid]];
}
for(const [role,seat] of [['morgana',1],['merlin',2],['mordred',3],['assassin',7]]) placePreviewRole(role,seat);
merlinSource.knights.initialRoles={...merlinSource.roles};
const identityNames=['小橙','子龙','林间','初夏','北川','舟舟','阿木','七月','阿辰','小鱼','向晚','晚风'];
const identityAvatars=['19','04','13','18','14','21','20','16','15','22','27','28'];
merlinSource.players.forEach((player,index)=>Object.assign(player,{name:identityNames[index],avatarUrl:'/pages/profile/assets/avatars/crayon-'+identityAvatars[index]+'.jpg'}));
for(const [role,tone] of [['merlin','good'],['morgana','evil']]) {
  const player=merlinSource.players.find(player=>merlinSource.roles[player.uid]===role),secret=privateView(merlinSource,player.uid);
  tableScenes['ui-identity-'+role]=tableScene(merlinSource,player.uid,{dealtIdentityDialog:true,dealtIdentitySecret:{...secret,
    factionTone:tone,portrait:portrait(secret.role,tone).portrait,vision:presentVision(secret.information,merlinSource.players)}});
}
for(const [name,profiles] of [['long-name',merlinSource.players.map(player=>player.seat===3?{...player,name:'这是一个很长的完整玩家昵称'}:player)],
  ['avatar-failed',merlinSource.players.map(player=>({...player,avatarFailed:true}))]]) {
  const scene=tableScenes['ui-identity-morgana'],secret=scene.dealtIdentitySecret;
  tableScenes['ui-identity-'+name]={...scene,dealtIdentitySecret:{...secret,vision:presentVision(secret.information,profiles)}};
}
// Focused review scenes use the shipped templates and actual private endpoint
// projection; the forced role allocation makes the requested example stable.
const reviewSource = newRoom('201375','review-1','子龙','knights',12);
for(let i=2;i<=12;i++) enter(reviewSource,'review-'+i,'陪测'+(i-1));
reviewSource.players.forEach(player=>player.ready=true);
tableFixtures.run(reviewSource,'start',{flexible:true});
for(const player of reviewSource.players) reviewSource.roles[player.uid]='servant';
Object.assign(reviewSource.roles,{'review-1':'morgana','review-3':'mordred','review-7':'assassin'});
reviewSource.knights.initialRoles={...reviewSource.roles};
const reviewSecret=privateView(reviewSource,'review-1');
const reviewIdentity={...reviewSecret,factionTone:'evil',portrait:portrait(reviewSecret.role,'evil').portrait,vision:presentVision(reviewSecret.information,reviewSource.players)};
tableScenes['ui-identity-morgana-no-avatars']=tableScene(reviewSource,'review-1',{dealtIdentityDialog:true,dealtIdentitySecret:reviewIdentity});
for(const [name,information] of [['anonymous','梅林与莫甘娜位于：3、7号。你无法区分谁是梅林。'],['long','完整的私密视野说明。'.repeat(35)]]) {
  tableScenes['ui-identity-'+name]=tableScene(reviewSource,'review-1',{dealtIdentityDialog:true,dealtIdentitySecret:{...reviewIdentity,information,vision:presentVision(information,reviewSource.players)}});
}
reviewSource.knights.fairy=1;reviewSource.knights.fairyVisited=[8];
tableFixtures.run(reviewSource,'beginActivity',{kind:'fairy'});
const reviewRoom=publicView(reviewSource,'review-1'),reviewAction=privateView(reviewSource,'review-1').action;
const reviewSkill=skillPresentation.skillView(reviewRoom,reviewAction.options,false,'',[]);
tableScenes['ui-fairy-selection']={...tableScene(reviewSource,'review-1'),actionDialog:true,stagedChoice:true,actionChoices:reviewAction.options,...reviewSkill,
  draftChoice:'target:3',...skillPresentation.skillSelectionView(reviewRoom,'target:3','fairy')};
tableScenes['ui-fairy-result']={...tableScene(reviewSource,'review-1'),fairyResult:presentFairyResult({summary:'3号 · 坏人'}),fairyResultRevealed:true};
for(const [tone,label] of [['good','好人'],['third','盗贼阵营']]) {
  tableScenes['ui-fairy-result-'+tone]={...tableScenes['ui-fairy-result'],fairyResult:presentFairyResult({summary:'12号 · '+label})};
}
tableScenes['ui-host-fairy']=tableScene(reviewSource,'review-1',{settleHint:'还差 1 人提交'});
tableScenes['ui-host-vote']={...tableScenes['ui-host-fairy'],room:{...reviewRoom,phase:'teamVote',closeWaiting:{mode:'settle',label:'提前结算投票'}}};
const processProjection=`<script>window.fitProcessSheet=()=>{const dealt=document.querySelector('.dealt-identity-dialog'),sheet=dealt||document.querySelector('.process-sheet');if(!sheet)return;const fit=${fitBody.toString()},selectors=dealt?['.dealt-identity-backdrop','.dealt-identity-top','.dealt-identity-fields','.dealt-identity-footer']:['.process-backdrop','.process-sheet-top','.process-sheet-fields','.process-sheet-footer'],rects=selectors.map(s=>document.querySelector(s)?.getBoundingClientRect());const height=fit(rects);if(height!==null){sheet.querySelector(dealt?'.dealt-identity-body':'.process-sheet-body').style.height=height+'px';sheet.classList.add('has-measured-body');}};addEventListener('load',window.fitProcessSheet);addEventListener('resize',window.fitProcessSheet);</script>`;
const playerCardProjection=`<script>window.fitPlayerCard=()=>{const sheet=document.querySelector('.player-card-sheet');if(!sheet)return;const fit=${fitBody.toString()},rects=['.player-card-backdrop','.player-card-top','.player-card-content','.player-card-bottom'].map(s=>document.querySelector(s)?.getBoundingClientRect());const height=fit(rects);if(height!==null){sheet.querySelector('.player-card-body').style.height=height+'px';sheet.classList.add('has-measured-body');}sheet.classList.remove('is-measuring');};addEventListener('load',window.fitPlayerCard);addEventListener('resize',window.fitPlayerCard);</script>`;
for(const [name,data] of Object.entries(tableScenes)) write(name,'pages/table/table.wxml',data,'.preview-homebar{z-index:1200}.player-card-bottom{padding-bottom:34px}',processProjection+playerCardProjection);
for(const [gallery,items] of [['table-pages',[['player-card','玩家战绩'],['table-ready','准备阶段'],['table-playing','最近结果'],['table-identity','身份与视野']]],['table-dialogs',[['table-covered','身份已遮盖'],['table-revealed','主动查看身份'],['table-task','选择任务牌'],['table-selected','确认提交']]],['game-actions',[['player-card','玩家战绩'],['skill-servant','使用技能'],['skill-blueAwakened-selected','选择目标'],['host-quest','发起任务']]],['game-privacy',[['new-identity','获得新身份'],['identity-history','身份历程'],['fairy-result','查验结果'],['table-vote','队伍表决']]]]) {
  fs.writeFileSync(path.join(output,gallery+'.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0;background:#09141c;color:#f2eee5;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{padding:28px 40px;width:1638px}header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}strong{font-size:26px}header span,p{color:#b1bfc6;font-size:12px}.screens{display:flex;gap:24px}h2{font-size:14px;margin:0 0 12px;font-weight:500}h2 span{color:#e5c68b;margin-right:10px}iframe{display:block;width:390px;height:844px;border:1px solid #344752;border-radius:28px;background:#101c24}p{margin-top:20px}</style><main><header><strong>桌边助手</strong><span>深色改造 · 实际页面模板</span></header><div class="screens">${items.map(([name,title],i)=>`<section><h2><span>0${i+1}</span>${title}</h2><iframe src="${name}.html" title="${title}"></iframe></section>`).join('')}</div><p>保留游戏规则与私密流程 · 示例数据 · 需真机验收</p></main></html>`);
}
for (const [name, boardId, capacity, extra] of [
  ['configuration','knights',12,{}], ['configuration-classic','classic',6,{}],
  ['configuration-chaos','chaos',12,{}], ['configuration-unscored','classic',6,{testRoom:false,scoreSettings:{enabled:false},scoreNotice:'本局未开启计分'}],
  ['configuration-notice','knights',12,{scoreNotice:'本局为测试房间；陪测仅用于验证流程，不计入个人战绩、积分及排行榜。'}],
]) {
  const source = newRoom('201375','host','子龙',boardId,capacity);
  for (let i=2;i<=capacity;i++) enter(source,'player-'+i,'陪测'+(i-1));
  const room = {...publicView(source,'host'),testRoom:true,scoreSettings:{enabled:true},...extra};
  const page = {...createTable().data,loading:false,room,showRoomRules:true,roomRulesMeasuring:true,roomRoleGroups:presentRoleGroups(room.roleConfiguration),
    seats:room.players.map(player=>({...player,occupied:true,mine:player.seat===1,host:player.seat===1,avatarInitial:player.name[0]})),seatOccupiedCount:capacity,seatReadyCount:0};
  write(name,'pages/table/table.wxml',page,'.room-rules-sheet-footer{padding-bottom:40px}.preview-homebar{z-index:1200}',sheetProjection);
}
fs.writeFileSync(path.join(output,'room-sheets-gallery.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>桌边助手 · 房间弹层实际模板</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{padding:32px 44px 24px;width:1632px}header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:26px}header strong{font-size:26px}header span,p{color:#b1bfc6;font-size:12px}.screens{display:flex;gap:24px}h2{font-size:14px;font-weight:500;margin:0 0 13px}h2 span{color:#e5c68b;margin-right:10px;font-size:12px}iframe{display:block;width:390px;height:1100px;border:1px solid #344752;border-radius:28px;background:#101c24}p{margin-top:20px}</style><main><header><strong>桌边助手</strong><span>深色弹层 · 实际页面模板</span></header><div class="screens">${[['entry-join','加入房间'],['entry-create6','创建房间 · 6 人'],['entry-create12','创建房间 · 12 人'],['configuration','角色配置']].map(([name,title],i)=>`<section><h2><span>0${i+1}</span>${title}</h2><iframe src="${name}.html" title="${title}"></iframe></section>`).join('')}</div><p>紧凑人数选择 · 按阵营展示角色 · 底部操作固定 · 示例数据</p></main></html>`);
fs.writeFileSync(path.join(output, "scenes.json"), JSON.stringify(scenes, null, 2));
fs.writeFileSync(path.join(output, "gallery.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>桌边助手 · 实际页面</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.board{width:1230px;padding:32px 48px 24px}.heading{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}.heading strong{font-size:25px}.heading span{font-size:12px;color:#b1bfc6}.screens{display:flex;gap:28px}h2{margin:0 0 12px;font-size:14px;font-weight:500}h2 span{color:#e5c68b;margin-right:10px;font-size:12px}iframe{display:block;width:390px;height:1135px;border:1px solid #344752;border-radius:28px;background:#101c24}.note{margin-top:20px;color:#b1bfc6;font-size:11px}</style><main class="board"><header class="heading"><strong>桌边助手</strong><span>深色改造 · 实际页面模板</span></header><div class="screens">${[["replay", "对局复盘"], ["scores", "积分明细"], ["home", "首页"]].map(([name, title], index) => `<section><h2><span>0${index + 1}</span>${title}</h2><iframe src="${name}.html" title="${title}"></iframe></section>`).join("")}</div><p class="note">保留现有功能与统计口径 · 示例数据 · 牌桌页面保持原样</p></main></html>`);
console.log("Production WXML projections: " + output + " (" + scenes.length + " scenes)");
