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
const { BOARDS, newRoom, enter, publicView } = require("../server/engine");
const { presentRoleGroups, fitBody, presentPrivateIdentity, presentFairyResult } = require("../miniprogram/room-sheet-presentation");
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
// Browser projection of the native selector-query measurement, not app behavior.
const sheetProjection = `<script>window.fitRoomSheets=()=>{const fit=${fitBody.toString()};for(const [prefix,sheetSelector,bodySelector] of [['.entry','.entry-sheet','.entry-sheet-scroll-region'],['.room-rules','.room-rules-sheet','.room-rules-body']]){const sheet=document.querySelector(sheetSelector),backdrop=document.querySelector(prefix+'-backdrop');if(!sheet||!backdrop)continue;const rects=[backdrop,...['-sheet-top','-sheet-fields','-sheet-footer'].map(s=>document.querySelector(prefix+s))].map(el=>el?.getBoundingClientRect());const height=fit(rects,prefix==='.entry'?parseFloat(getComputedStyle(sheet).getPropertyValue('--entry-keyboard-height'))||0:0);if(height!==null){document.querySelector(bodySelector).style.height=height+'px';sheet.classList.add('has-measured-body');}}};addEventListener('load',window.fitRoomSheets);addEventListener('resize',window.fitRoomSheets);</script>`;
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
const homeBase = { ...createTable({ lobby: true }).data, loading: false, serverConnected: true };
const room = (code, status, people, relation, activity, extra = {}) => ({ code, status, statusLabel: status === "lobby" ? "待开局" : status === "playing" ? "进行中" : "已结束", boardName: "阿瓦隆 · 十二骑士", peopleLabel: people, compactRelation: relation, activityLabel: activity, entryLabel: status === "ended" ? "查看牌桌" : "返回牌桌", available: true, updatedAt: 1, canSwipeDissolve: true, isHost: true, isMember: true, canLeave: true, ...extra });
const rooms = [room("201375", "lobby", "12/12 人已入座", "我是房主 · 1号", "今天 15:50"), room("534718", "lobby", "1/12 人已入座", "我是房主 · 1号", "10/13 14:53"), room("273843", "ended", "11 人", "房主：大V · 我在4号", "10/11 23:33", { boardName: "阿瓦隆 · 十二骑士（11人）", isHost: false, canSwipeDissolve: false })];
const homeScenes = {
  home: {}, "home-empty": { memberRooms: [], visibleMemberRooms: [] }, "home-loading": { loading: true, memberRooms: [], visibleMemberRooms: [] },
  "home-offline": { network: false, serverConnected: false }, "home-swipe": { roomSwipeCode: rooms[0].code, roomSwipeOffset: -156 },
  "home-menu": { roomMenu: rooms[0] }, "home-join": { entrySheet: true, entryMode: "join", name: "子龙", nicknameSetup: false },
  "home-keyboard": { entrySheet: true, entryMode: "join", entryKeyboardHeight: 320, entryFocusedField: "code", code: "2013", name: "子龙", nicknameSetup: false },
  "home-long": { memberRooms: [...rooms, ...rooms], visibleMemberRooms: [room("201375", "playing", "12/12 人已入座 · 3人准备", "房主：昵称较长的玩家名字测试 · 我在12号", "2026/10/16 15:50", { note: "这是一个用于检查窄屏长备注换行的牌桌记录", boardName: "阿瓦隆 · 十二骑士与扩展角色配置测试（12人）" })] },
};
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
  'entry-classic12': entryScene(12,'classic-court'), 'entry-chaos12': entryScene(12,'chaos'),
  'entry-create13': entryScene(13,'knights-13'),
  'entry-keyboard': entryScene(12,'knights',{entryKeyboardHeight:320,entryFocusedField:'nickname'}),
  'entry-pending': entryScene(12,'knights',{hasPendingRequest:true,entryError:'请求尚未确认，请等待连接恢复'}),
  'entry-long': entryScene(12,'knights',{name:'昵称较长的玩家名字测试',entryNameError:'昵称未能保存，请检查网络后重试'}),
});
for (const [name, data] of Object.entries(homeScenes)) {
  const lobby = { ...homeBase, memberRooms: rooms, visibleMemberRooms: rooms, ...data };
  const tabs = html(factory("custom-tab-bar/index.wxml")({ selected: 0, entrySheetVisible: lobby.entrySheet, list: [
    { pagePath: "pages/lobby/lobby", text: "对局", icon: "/assets/tab-table.png", activeIcon: "/assets/tab-table-active.png" },
    { pagePath: "pages/me/me", text: "我的", icon: "/assets/tab-me.png", activeIcon: "/assets/tab-me-active.png" },
  ] }));
  write(name, "pages/lobby/lobby.wxml", { activeTab: 0, lobby, personal: {} }, css("pages/lobby/lobby.wxss") + css("custom-tab-bar/index.wxss") + ".tab-bar{height:78px;padding-bottom:28px}.entry-sheet-footer{padding-bottom:40px}.entry-sheet.has-keyboard .entry-sheet-footer{padding-bottom:12px}.preview-homebar{z-index:1200}", tabs + sheetProjection);
}
// These fixtures render the production table templates, including private DOM
// guards. Sample stats are illustrative; game choices come from privateView.
function tableScene(source, uid, extra = {}) {
  const room = publicView(source, uid);
  const history = room.history.filter(h => h.kind === 'toolQuest').map((h, i) => ({...h,key:i,number:i+1,
    questResult:h.success?'success':'failure',resultTone:h.success?'success':'failure',
    text:h.success?'任务成功':'任务失败',latestDetail:h.team.join('、')+'号 · '+h.fails+'张失败票',timeLabel:'17:29'}));
  return {...createTable().data,loading:false,room,network:true,seatsExpanded:true,
    seats:room.players.map(p=>({...p,occupied:true,mine:p.seat===room.me.seat,host:p.isHost,avatarInitial:p.name[0],inTeam:room.team.includes(p.seat)})),
    seatOccupiedCount:room.players.length,seatReadyCount:room.players.filter(p=>p.ready).length,
    history,historyLatest:history.at(-1),latestResult:history.at(-1),questTimeline:history,
    teamText:room.team.join('、'),actionEntryLabel:({quest:'提交任务牌',teamVote:'参与表决',identity:'查看身份'})[room.phase] || '完成本轮操作',...extra};
}
const tableSource = tableFixtures.setup();
tableFixtures.task(tableSource,[1,2,3]);
const tablePlaying = tableScene(tableSource,'wx:replay-5',{historyUnreadCount:1});
const privateSource = privateView(tableSource,'wx:replay-5');
const privateData = {...privateSource, factionTone:'good',portrait:portrait(privateSource.role,'good').portrait};
const tableReadySource = newRoom('201375','host','子龙','knights',12);
for(let i=2;i<=12;i++) enter(tableReadySource,'player-'+i,'陪测'+(i-1));
tableReadySource.players[0].ready=true;
const tableReady = tableScene(tableReadySource,'host',{startHint:'等待其他玩家准备',canStart:false});
const badgeSamples = require('../miniprogram/badges').catalogue.slice(0,3);
const playerStats = {scoreTotal:9,rateLabel:'37.5%',rateValue:'37.5',total:8,wins:3,byFaction:[
  {faction:'evil',label:'坏人阵营',total:2,wins:1,winRate:50,rateLabel:'50.0%',rateValue:'50.0'},
  {faction:'good',label:'好人阵营',total:6,wins:2,winRate:100/3,rateLabel:'33.3%',rateValue:'33.3'}]};
const playerSample = {name:'阿伟',initial:'阿',seat:6,badges:badgeSamples};
const tableScenes = {
  'table-ready':tableReady, 'table-playing':tablePlaying,
  'table-identity':{...tablePlaying,revealed:true,secret:privateData},
  'table-covered':{...tablePlaying,dealtIdentityDialog:true},
  'table-revealed':{...tablePlaying,dealtIdentityDialog:true,dealtIdentitySecret:privateData},
  'player-card':{...tablePlaying,playerCard:playerSample,playerCardStats:playerStats},
  'player-card-badge':{...tablePlaying,playerCard:playerSample,playerCardStats:playerStats,playerCardBadge:badgeSamples[0]},
  'player-card-long':{...tablePlaying,playerCard:{...playerSample,name:'昵称很长的玩家名字完整展示测试'},playerCardStats:{...playerStats,scoreTotal:-123456789,rateLabel:'—',rateValue:'—',byFaction:[...playerStats.byFaction,{faction:'third',label:'盗贼阵营',total:0,wins:0,winRate:null,rateLabel:'—',rateValue:'—'}]}},
  'player-card-error':{...tablePlaying,playerCard:playerSample,playerCardError:'网络暂时不可用，请稍后重试'},
  'player-card-untracked':{...tablePlaying,playerCard:playerSample,playerCardStatus:'untracked'},
};
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
  const data={...tableScene(source,'p2'),room,actionDialog:true,stagedChoice:true,actionChoices:choices,swapOptions,swapSeats:[],swapPlayers:[],...skillPresentation.skillView(room,choices,!!secret.action.hunterModes,secret.action.hunterModes?mode:'',swapOptions)};
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
// Project the same native four-rectangle fit used by the controller.
const processProjection=`<script>window.fitProcessSheet=()=>{const sheet=document.querySelector('.process-sheet');if(!sheet)return;const fit=${fitBody.toString()},rects=['.process-backdrop','.process-sheet-top','.process-sheet-fields','.process-sheet-footer'].map(s=>document.querySelector(s)?.getBoundingClientRect());const height=fit(rects);if(height!==null){sheet.querySelector('.process-sheet-body').style.height=height+'px';sheet.classList.add('has-measured-body');}};addEventListener('load',window.fitProcessSheet);addEventListener('resize',window.fitProcessSheet);</script>`;
for(const [name,data] of Object.entries(tableScenes)) write(name,'pages/table/table.wxml',data,'.preview-homebar{z-index:1200}',processProjection);
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
  const page = {...createTable().data,loading:false,room,showRoomRules:true,roomRoleGroups:presentRoleGroups(room.roleConfiguration),
    seats:room.players.map(player=>({...player,occupied:true,mine:player.seat===1,host:player.seat===1,avatarInitial:player.name[0]})),seatOccupiedCount:capacity,seatReadyCount:0};
  write(name,'pages/table/table.wxml',page,'.room-rules-sheet-footer{padding-bottom:40px}.preview-homebar{z-index:1200}',sheetProjection);
}
fs.writeFileSync(path.join(output,'room-sheets-gallery.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>桌边助手 · 房间弹层实际模板</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{padding:32px 44px 24px;width:1632px}header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:26px}header strong{font-size:26px}header span,p{color:#b1bfc6;font-size:12px}.screens{display:flex;gap:24px}h2{font-size:14px;font-weight:500;margin:0 0 13px}h2 span{color:#e5c68b;margin-right:10px;font-size:12px}iframe{display:block;width:390px;height:1100px;border:1px solid #344752;border-radius:28px;background:#101c24}p{margin-top:20px}</style><main><header><strong>桌边助手</strong><span>深色弹层 · 实际页面模板</span></header><div class="screens">${[['entry-join','加入房间'],['entry-create6','创建房间 · 6 人'],['entry-create12','创建房间 · 12 人'],['configuration','角色配置']].map(([name,title],i)=>`<section><h2><span>0${i+1}</span>${title}</h2><iframe src="${name}.html" title="${title}"></iframe></section>`).join('')}</div><p>紧凑人数选择 · 按阵营展示角色 · 底部操作固定 · 示例数据</p></main></html>`);
fs.writeFileSync(path.join(output, "scenes.json"), JSON.stringify(scenes, null, 2));
fs.writeFileSync(path.join(output, "gallery.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>桌边助手 · 实际页面</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.board{width:1230px;padding:32px 48px 24px}.heading{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}.heading strong{font-size:25px}.heading span{font-size:12px;color:#b1bfc6}.screens{display:flex;gap:28px}h2{margin:0 0 12px;font-size:14px;font-weight:500}h2 span{color:#e5c68b;margin-right:10px;font-size:12px}iframe{display:block;width:390px;height:1135px;border:1px solid #344752;border-radius:28px;background:#101c24}.note{margin-top:20px;color:#b1bfc6;font-size:11px}</style><main class="board"><header class="heading"><strong>桌边助手</strong><span>深色改造 · 实际页面模板</span></header><div class="screens">${[["replay", "对局复盘"], ["scores", "积分明细"], ["home", "首页"]].map(([name, title], index) => `<section><h2><span>0${index + 1}</span>${title}</h2><iframe src="${name}.html" title="${title}"></iframe></section>`).join("")}</div><p class="note">保留现有功能与统计口径 · 示例数据 · 牌桌页面保持原样</p></main></html>`);
console.log("Production WXML projections: " + output + " (" + scenes.length + " scenes)");
