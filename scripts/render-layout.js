// Layout-only HTML projection of the compiled WXML tree. Not a replacement client.
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { wxmlToJs } = require("miniprogram-compiler");
const {
  BOARDS,
  newRoom,
  enter,
  command,
  publicView,
  privateView,
} = require("../server/engine");
const root = path.resolve(__dirname, "../miniprogram");
const ctx = { window: {}, global: {}, console };
vm.createContext(ctx);
const factory = vm.runInContext(
  "(function(global){" + wxmlToJs(root) + "})(global)",
  ctx,
);
const render = data => factory(data.room || data.invitation ? "pages/table/table.wxml" : "pages/lobby/lobby.wxml")(data.room || data.invitation
  ? { ...data, isLobby: false } : { activeTab: 0, lobby: { ...data, isLobby: true }, personal: {} });
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function html(n) {
  if (typeof n === "string" || typeof n === "number") return escape(n);
  if (n.tag === "wx-app-nav")
    return html(factory("components/app-nav/app-nav.wxml")({
      ...n.attr, statusBarHeight: 20, navHeight: 44, totalHeight: 64,
    }));
  // Approximate the native switch only in this layout projection.
  if (n.tag === "wx-switch")
    return `<span role="switch" aria-checked="${!!n.attr?.checked}" style="display:inline-block;flex-shrink:0;width:50px;height:30px;border-radius:20px;background:${n.attr?.checked ? "#c3a361" : "#536570"};padding:3px;box-sizing:border-box"><span style="display:block;width:24px;height:24px;border-radius:50%;background:#f2eee5;margin-left:${n.attr?.checked ? 20 : 0}px"></span></span>`;
  const tag =
    {
      "wx-text": "span",
      "wx-button": "button",
      "wx-input": "input",
      "wx-label": "label",
      "wx-image": "img",
      "wx-form": "form",
    }[n.tag] || "div";
  if (n.tag === "wx-scroll-view")
    n.attr = { ...n.attr, style: (n.attr?.style || "") + ";overflow-y:auto" };
  const attrs = Object.entries(n.attr || {})
    .filter(([k]) =>
      ["class", "disabled", "hidden", "placeholder", "value", "role", "style", "src"].includes(
        k,
      ),
    )
    .map(([k, v]) =>
      k === "disabled" || k === "hidden"
        ? v
          ? k
          : ""
        : `${k}="${escape(k === "style" ? String(v).replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)") : k === "src" && /^\/(?:assets|pages)\//.test(v) ? "/miniprogram" + v : v)}"`,
    )
    .join(" ");
  return `<${tag} ${attrs}>${(n.children || []).map(html).join("")}${tag === "input" ? "" : `</${tag}>`}`;
}
const r = newRoom("628419", "p1", "林间", "classic-court", 12);
for (let i = 2; i <= 12; i++)
  enter(
    r,
    "p" + i,
    [
      "",
      "",
      "阿木",
      "小橙",
      "晚风",
      "Kiki",
      "七月",
      "北川",
      "小鱼",
      "向晚",
      "舟舟",
      "阿辰",
      "星河",
    ][i],
  );
const base = {
  loading: false,
  busy: false,
  error: "",
  notice: "",
  room: null,
  boardId: "classic",
  boardName: "阿瓦隆 · 经典基础",
  capacity: 6,
  boardRoleConfiguration: BOARDS[0].roleConfigurations[6],
  name: "",
  code: "",
  boards: BOARDS,
  availableBoards: BOARDS.filter((b) => b.available && b.counts.includes(6)),
  capacities: [6, 7, 8, 9, 10, 11, 12],
  entryMode: "create",
  showRules: true,
  revealed: false,
  secret: null,
  network: true,
  selected: [],
  seatsExpanded: true,
  history: [],
};
function roomData(source = r) {
  const room = publicView(source, "p1");
  return {
    ...base,
    room,
    seatOccupiedCount: room.players.length,
    seatReadyCount: room.players.filter(p => p.ready).length,
    teamText: "尚未选择",
    seats: room.players.map((p) => ({
      ...p,
      avatarInitial: Array.from(p.name || "友")[0],
      occupied: true,
      mine: p.seat === 1,
      host: p.isHost,
      inTeam: room.team.includes(p.seat),
    })),
  };
}
const scenes = {
  home: base,
  homeRules: { ...base, entrySheet: true, showRules: true },
  roomRules: { ...roomData(), showRoomRules: true },
  home12: {
    ...base, entrySheet: true,
    capacity: 12,
    boardId: "classic-court",
    availableBoards: BOARDS.filter((b) => b.available && b.counts.includes(12)),
  },
  join: { ...base, entryMode: "join", entrySheet: true, entryKeyboardHeight: 0 },
  joinWithRooms: {
    ...base, entryMode: "join", name: "zzl",
    memberRooms: [{ code: "759429" }, { code: "471755" }],
    visibleMemberRooms: ["759429", "471755"].map(code => ({
      code, status: "playing", statusLabel: "进行中", available: true,
      boardName: "阿瓦隆 · 十二骑士", peopleLabel: "12人", relationLabel: "已入座",
    })),
  },
  lobby: roomData(),
  roomInvitation: { ...base, invitation: { code: "372338", boardName: "阿瓦隆 · 十二骑士", capacity: 12, occupied: 1 }, invitationNeedsName: true },
  roomInvitationFull: { ...base, invitation: { code: "372338", boardName: "阿瓦隆 · 十二骑士", capacity: 12, occupied: 12 }, invitationNeedsName: true },
  roomInvitationExpired: { ...base, invitation: { code: "372338" }, invitationError: "该房间已解散" },
};

const homeRooms = [
  { code: "455552", status: "lobby", statusLabel: "待开局", occupied: 1, peopleLabel: "1/12 人已入座", compactRelation: "我是房主 · 1号", activityLabel: "20:28", entryLabel: "返回牌桌" },
  { code: "202430", status: "lobby", statusLabel: "待开局", occupied: 6, peopleLabel: "6/12 人已入座", compactRelation: "房主：小林 · 我在3号", activityLabel: "19:46", entryLabel: "返回牌桌" },
  { code: "308216", status: "ended", statusLabel: "已结束", peopleLabel: "12 人", compactRelation: "我在5号", activityLabel: "昨天 21:10", entryLabel: "查看结果" },
].map(room => ({ ...room, boardName: "阿瓦隆 · 十二骑士", updatedAt: 1, available: true }));
scenes.homeRedesign = { ...base, entrySheet: false, serverConnected: true, name: "子龙", nicknameSetup: false, memberRooms: homeRooms, visibleMemberRooms: homeRooms };
scenes.homeJoinSheet = { ...scenes.homeRedesign, entryMode: "join", entrySheet: true, entryKeyboardHeight: 0, code: "628193", entryFocusedField: "code" };
scenes.homeJoinKeyboard = { ...scenes.homeJoinSheet, entryKeyboardHeight: 280 };
scenes.homeJoinError = { ...scenes.homeJoinSheet, entryKeyboardHeight: 280, code: "123", entryCodeError: "请输入完整的 6 位数字房间码" };
scenes.homeCreateSheet = { ...scenes.homeRedesign, entryMode: "create", entrySheet: true, entryKeyboardHeight: 0 };
scenes.homeFirstJoin = { ...scenes.homeJoinKeyboard, name: "", nicknameSetup: true, code: "", entryEditingName: true, entryFocusedField: "nickname" };
scenes.homeLongNames = { ...scenes.homeRedesign, visibleMemberRooms: [{ ...homeRooms[0], note: "周五朋友十二骑士聚会的很长很长的牌桌备注", compactRelation: "房主：这是一个很长的玩家昵称 · 我在12号" }] };

const playerCard = { id: "preview", seat: 3, name: "小林", initial: "小", isHost: true, avatarUrl: "/pages/profile/assets/avatars/avatar-03.jpg" };
scenes.playerStats = { ...scenes.lobby, playerCard, playerCardStatus: "available", playerCardStats: { total: 48, wins: 29, rateLabel: "60.4%", scoreTotal: 126,
  byFaction: [{faction:"good",label:"好人阵营",wins:21,total:32,rateLabel:"65.6%"},{faction:"evil",label:"坏人阵营",wins:8,total:16,rateLabel:"50.0%"}] } };
scenes.playerStatsUntracked = { ...scenes.lobby, playerCard, playerCardStatus: "untracked" };
scenes.playerStatsEmpty = { ...scenes.playerStats, playerCardStats: {total:0,wins:0,rateLabel:"—",scoreTotal:0,byFaction:[]} };
scenes.playerStatsError = { ...scenes.lobby, playerCard, playerCardError:"暂时无法读取战绩，请重试" };
const avatarRoom = newRoom("628420", "p1", "zz", BOARDS.find(b => b.available && b.counts.includes(13)).id, 13);
for (let i = 2; i <= 12; i++) enter(avatarRoom, "p" + i, i === 4 ? "这是一个很长的玩家昵称测试" : "陪测" + (i - 1));
const avatarScene = roomData(avatarRoom);
scenes.seatAvatars = { ...avatarScene, seats: Array.from({ length: 13 }, (_, i) => {
  const player = avatarScene.seats.find(p => p.seat === i + 1);
  return player ? { ...player, avatarUrl: i === 2 ? "" : "../../miniprogram/pages/profile/assets/avatars/avatar-" + String(i + 1).padStart(2, "0") + ".jpg" }
    : { seat: i + 1, name: "空位", occupied: false, mine: false, avatarInitial: "+" };
}) };
scenes.seatAvatarStates = { ...scenes.seatAvatars,
  room: { ...scenes.seatAvatars.room, phase: "proposal", flexible: false, leader: 1, fairyHolder: 1 },
  seats: scenes.seatAvatars.seats.map(p => ({ ...p, selected: p.seat === 1, alive: p.seat !== 1, avatarFailed: p.seat === 5 })) };
const emptyLobby = roomData(newRoom("628421", "p1", "zz", "classic", 6));
scenes.seatCardsLobby = { ...emptyLobby, seats: Array.from({ length: 6 }, (_, i) => i === 0
  ? { ...emptyLobby.seats[0], avatarUrl: "../../miniprogram/pages/profile/assets/avatars/avatar-01.jpg" }
  : { seat: i + 1, name: "空位", occupied: false, mine: false, avatarInitial: "+" }) };
// Preparation layouts exercise the same room with player, host and spectator controls.
const compactSeats = roomData().seats.map(p => [4, 11].includes(p.seat)
  ? { seat: p.seat, name: "空位", occupied: false, mine: false }
  : { ...p, mine: p.seat === 2, ready: p.seat === 1,
    avatarUrl: p.seat === 2 ? "../../miniprogram/pages/profile/assets/avatars/avatar-02.jpg" : "" });
const compactRoom = { ...publicView(r, "p2"), scoreSettings: { enabled: true }, scoreNotice: null };
scenes.lobbyCompact = { ...base, room: compactRoom, seats: compactSeats, seatOccupiedCount: 10, seatReadyCount: 1, canStart: false };
scenes.lobbyPrepared = { ...scenes.lobbyCompact, room: { ...compactRoom, me: { ...compactRoom.me, ready: true } },
  seats: compactSeats.map(p => ({ ...p, ready: p.occupied && (p.ready || p.mine) })), seatReadyCount: 2 };
scenes.lobbyHost = { ...scenes.lobbyCompact, room: { ...compactRoom, me: { ...compactRoom.me, isHost: true } },
  seats: compactSeats.map(p => ({ ...p, host: p.mine })), startHint: "还差 2 人入座" };
scenes.lobbyHostPrepared = { ...scenes.lobbyPrepared, room: { ...scenes.lobbyPrepared.room, me: { ...scenes.lobbyPrepared.room.me, isHost: true } },
  seats: scenes.lobbyPrepared.seats.map(p => ({ ...p, host: p.mine })), startHint: "还差 2 人入座" };
scenes.lobbyHostStart = { ...scenes.lobbyHostPrepared, seats: roomData().seats.map(p => ({ ...p, ready: true, mine: p.seat === 2, host: p.seat === 2 })),
  seatOccupiedCount: 12, seatReadyCount: 12, canStart: true };
scenes.lobbySpectator = { ...scenes.lobbyCompact, room: { ...compactRoom, me: { ...compactRoom.me, seat: null } }, seats: compactSeats.map(p => ({ ...p, mine: false })) };
scenes.lobbyOffline = { ...scenes.lobbyCompact, network: false };
scenes.lobbyLongNames = { ...scenes.lobbyHostPrepared, seats: scenes.lobbyHostPrepared.seats.map(p => p.occupied ? { ...p, name: "这是一个很长的玩家昵称" } : p) };
r.players.forEach((p) =>
  command(r, p.uid, { type: "ready", ready: true, stage: r.stage }),
);
command(r, "p1", { type: "start", stage: r.stage });
scenes.identity = roomData();
const taskSeats = roomData();
scenes.lakeFairyHolder = { ...taskSeats,
  room: { ...taskSeats.room, phase: "tools", phaseName: "等待房主发起操作", canUseTools: false, needsSubmission: false,
    fairyEnabled: true, fairyHolder: 2, me: { ...taskSeats.room.me, seat: 2, isHost: false } },
  seats: taskSeats.seats.map(p => ({ ...p, mine: p.seat === 2,
    avatarUrl: p.seat === 2 ? "/pages/profile/assets/avatars/avatar-02.jpg" : "" })) };
scenes.lakeFairyTransferred = { ...scenes.lakeFairyHolder, room: { ...scenes.lakeFairyHolder.room, fairyHolder: 3 } };
scenes.lakeFairyAvatarFailed = { ...scenes.lakeFairyHolder,
  seats: scenes.lakeFairyHolder.seats.map(p => ({ ...p, avatarFailed: p.mine, name: p.mine ? "这是一个很长的玩家昵称" : p.name })) };
scenes.taskSeats = {
  ...taskSeats,
  room: {
    ...taskSeats.room,
    phase: "proposal",
    phaseName: "队长组队",
    needsSubmission: false,
    capacity: 6,
    teamSize: 2,
    leader: 3,
    team: [2, 4],
  },
  teamText: "2、4",
  seats: taskSeats.seats
    .slice(0, 6)
    .map((seat) => ({ ...seat, inTeam: [2, 4].includes(seat.seat) })),
};
scenes.selfInTeam = {
  ...scenes.taskSeats,
  room: { ...scenes.taskSeats.room, team: [1, 4] },
  teamText: "1、4",
  seats: scenes.taskSeats.seats.map((seat) => ({
    ...seat,
    inTeam: [1, 4].includes(seat.seat),
  })),
};
const toolRoom = newRoom("628419", "p1", "林间", "classic", 6);
for (let i = 2; i <= 6; i++)
  enter(toolRoom, "p" + i, ["", "", "阿木", "小橙", "晚风", "Kiki", "七月"][i]);
toolRoom.players.forEach((p) =>
  command(toolRoom, p.uid, {
    type: "ready",
    ready: true,
    stage: toolRoom.stage,
  }),
);
command(toolRoom, "p1", {
  type: "start",
  flexible: true,
  stage: toolRoom.stage,
});
scenes.tools = roomData(toolRoom);
scenes.toolDialog = {
  ...scenes.tools,
  toolType: "quest",
  toolSeats: [2, 4],
  toolThreshold: 1,
  toolThresholds: ["1 张失败票", "2 张失败票"],
  toolPlayers: toolRoom.players.map((p) => ({
    ...p,
    selected: [2, 4].includes(p.seat),
  })),
};
scenes.resultRegistration = {
  ...scenes.tools,
  room: { ...scenes.tools.room, scoreSettlement: [
    { id: 'assassination', label: '三绿，已完成最终刺杀' },
    { id: 'quest_fail', label: '三次任务失败' },
  ] },
  resultDialog: true, resultStep: 'reason', resultStepIndex: 0,
  resultSteps: ['reason', 'review'], resultStepTitle: '结束原因', resultNextEnabled: false,
};
scenes.resultRegistrationSelected = { ...scenes.resultRegistration, resultReason: 'quest_fail', resultNextEnabled: true };
scenes.finalResultScored = {
  ...scenes.tools,
  room: { ...scenes.tools.room, phase: 'ended', phaseName: '对局结束', canUseTools: false,
    result: { winner: 'good', reason: '房主已登记线下结果，战绩已归档。', source: 'manual' },
    scoreSettings: { enabled: true },
    myScore: { status: 'scored', total: 5, breakdown: [{ id: 'win', label: '好人获胜', points: 5 }] } },
  latestResult: { text: '本轮不转换' },
};
scenes.finalResultZero = { ...scenes.finalResultScored,
  room: { ...scenes.finalResultScored.room, myScore: { status: 'scored', total: 0, breakdown: [] } } };
scenes.finalResultWithFun = { ...scenes.finalResultScored,
  room: { ...scenes.finalResultScored.room, myFun: require('../miniprogram/fun-copy').story({ status: 'recorded', highlights: [
    { id: 'good_shield', label: '成功挡刀', count: 1, unit: '次' },
    { id: 'percival_green', label: '三绿车', count: 1, unit: '次' },
  ] }) } };
scenes.finalResultWithoutFun = { ...scenes.finalResultScored,
  room: { ...scenes.finalResultScored.room, myFun: require('../miniprogram/fun-copy').story({ status: 'recorded', highlights: [
    { id: 'knife_failed', label: '刀落空', count: 1, unit: '次' },
  ] }) } };
scenes.finalResultExcluded = { ...scenes.finalResultScored,
  room: { ...scenes.finalResultScored.room, result: { winner: 'evil', reason: '三次任务失败。', source: 'system' },
    myScore: { status: 'excluded', reason: '本局未开启计分' } } };
scenes.finalResultGuest = { ...scenes.finalResultZero,
  room: { ...scenes.finalResultZero.room, me: { seat: 2, isHost: false } } };
scenes.finalResultTerminated = { ...scenes.finalResultExcluded,
  room: { ...scenes.finalResultExcluded.room, phase: 'terminated', result: { winner: null, reason: '房主终止了对局，本局不判胜负' } } };
command(toolRoom, "p1", {
  type: "beginActivity",
  kind: "vote",
  team: [2, 4],
  stage: toolRoom.stage,
});
command(toolRoom, "p2", {
  type: "submit",
  value: "approve",
  stage: toolRoom.stage,
});
command(toolRoom, "p4", {
  type: "submit",
  value: "reject",
  stage: toolRoom.stage,
});
scenes.operationProgress = {
  ...roomData(toolRoom),
  teamText: "2、4",
  history: [{ key: 0, text: "上次投票已结算", detail: "公开记录保留" }],
};
scenes.actionDialog = {
  ...scenes.operationProgress,
  room: {
    ...scenes.operationProgress.room,
    phase: "quest",
    phaseName: "任务出牌",
    needsSubmission: true,
  },
  actionDialog: true,
  actionLabel: "选择本轮任务牌",
  actionChoices: [
    { value: "success", label: "任务成功" },
    { value: "fail", label: "任务失败" },
  ],
  actionTargets: [],
};
const knightRoom = newRoom("628419", "p1", "林间", "knights", 12);
for (let i = 2; i <= 12; i++) enter(knightRoom, "p" + i, "玩家" + i);
for (const p of knightRoom.players)
  command(knightRoom, p.uid, {
    type: "ready",
    ready: true,
    stage: knightRoom.stage,
  });
command(knightRoom, "p1", {
  type: "start",
  flexible: true,
  stage: knightRoom.stage,
});
scenes.knightTools = roomData(knightRoom);
// Render the shipped target-picker presentation against real allowed actions.
const skillSource = fs.readFileSync(path.join(root, "pages/table/controller.js"), "utf8");
const skillPresentation = vm.runInNewContext("(function(){" + skillSource.slice(
  skillSource.indexOf("function skillView("), skillSource.indexOf("function factionTone("),
) + "return { skillView, skillSelectionView };})()");
for (const mode of ["fairy", "sword"]) {
  const source = structuredClone(knightRoom);
  const uid = "p2";
  source.round = source.knights.round = 2;
  source.players.forEach((player, index) => {
    player.name = ["阿木", "林间", "小橙", "晚风", "Kiki", "北川", "小鱼", "向晚", "舟舟", "阿辰", "星河", "七月"][index];
  });
  source.roles[uid] = "redSwordsman";
  source.knights.fairy = 2;
  source.knights.fairyVisited = [5];
  if (mode === "sword") source.knights.players.p5.alive = false;
  command(source, source.host, { type: "beginActivity", kind: mode === "fairy" ? "fairy" : "skills", stage: source.stage });
  const room = publicView(source, uid);
  const action = privateView(source, uid).action;
  const presentation = skillPresentation.skillView(room, action.options, false, "", []);
  const data = { ...roomData(source), room, actionDialog: true, stagedChoice: true,
    actionLabel: action.label, actionChoices: action.options, actionTargets: [],
    draftChoice: "", draftLabel: "", swapOptions: [], swapPlayers: [], swapSeats: [],
    ...presentation };
  scenes[mode + "TargetPicker"] = data;
  scenes[mode + "TargetSelected"] = { ...data, draftChoice: "target:7", draftLabel: action.options.find(c => c.value === "target:7").label,
    ...skillPresentation.skillSelectionView(room, "target:7", mode) };
  if (mode === "sword") scenes.swordTargetPass = { ...data, draftChoice: "pass", draftLabel: "本轮不开刀",
    ...skillPresentation.skillSelectionView(room, "pass", mode) };
}
for (const [role, mode, value] of require("../tests/helpers/skill-target-fixtures").cases) {
  const { source, room, secret } = require("../tests/helpers/skill-target-fixtures").fixture(role, mode);
  const swapOptions = (secret.action.choices || []).filter(v => v.startsWith("swap:"));
  const actionChoices = mode === "final" ? secret.action.targets.map(t => ({ value: "target:" + t.seat, label: t.seat ? "最终盘刀 " + t.seat + "号" : "本次空刀" }))
    : secret.action.hunterModes ? secret.action.options.filter(c => c.value.startsWith(mode + ":")).concat([{ value: "mode:", label: "返回选择技能方式" }])
    : secret.action.options.filter(c => !c.value.startsWith("swap:"));
  const data = { ...roomData(source), room, actionDialog: true, stagedChoice: true,
    actionChoices, actionTargets: [], hunterModes: !!secret.action.hunterModes, hunterMode: secret.action.hunterModes ? mode : "",
    draftChoice: "", draftLabel: "", swapOptions, swapPlayers: [], swapSeats: [],
    ...skillPresentation.skillView(room, actionChoices, !!secret.action.hunterModes, secret.action.hunterModes ? mode : "", swapOptions) };
  scenes[mode + "TargetPicker"] = data;
  scenes[mode + "TargetSelected"] = { ...data, draftChoice: value,
    ...(mode === "swap" ? { swapSeats: [2, 7], swapPlayers: data.swapPlayers.map(p => ({ ...p, selected: [2, 7].includes(p.seat) })) } : {}),
    ...skillPresentation.skillSelectionView(room, value, mode) };
  if (mode === "swap") scenes.swapTargetPartial = { ...data, swapSeats: [2], swapPlayers: data.swapPlayers.map(p => ({ ...p, selected: p.seat === 2 })),
    ...skillPresentation.skillSelectionView(room, "", mode, [2]) };
}
scenes.tablePlayingHost = {
  ...scenes.knightTools,
  room: { ...scenes.knightTools.room, testRoom: true, fairyHolder: 11 },
};
scenes.tablePlayingGuest = {
  ...scenes.tablePlayingHost,
  room: { ...scenes.tablePlayingHost.room, canUseTools: false, me: { ...scenes.tablePlayingHost.room.me, seat: 2, isHost: false } },
  seats: scenes.tablePlayingHost.seats.map(p => ({ ...p, mine: p.seat === 2 })),
};
scenes.tablePlayingStates = {
  ...scenes.tablePlayingHost, busy: true,
  seats: scenes.tablePlayingHost.seats.map(p => p.seat === 11
    ? { ...p, name: '这是一个很长的玩家昵称', inTeam: true, alive: false } : p),
};
// Real settled skills exercise the current card and its archived identity together.
const memoryRoom = structuredClone(knightRoom);
for (const player of memoryRoom.players) {
  memoryRoom.roles[player.uid] = "servant";
  Object.assign(memoryRoom.knights.players[player.uid], { armor: false, used: false, b: false });
}
Object.assign(memoryRoom.roles, { p1: "gareth", p2: "redLancelot", p3: "blueAwakened", p9: "redSwordsman" });
memoryRoom.knights.initialRoles = { ...memoryRoom.roles };
memoryRoom.knights.deck = ["blueGuard"];
for (const actions of [{ p2: "target:8", p3: "target:2" }, { p1: "target:9", p2: "target:9" }]) {
  command(memoryRoom, "p1", { type: "beginActivity", kind: "skills", stage: memoryRoom.stage });
  for (const player of memoryRoom.players)
    command(memoryRoom, player.uid, { type: "submit", value: actions[player.uid] || "pass", stage: memoryRoom.stage });
}
const memorySecret = privateView(memoryRoom, "p2");
memorySecret.factionTone = "good";
memorySecret.identityHistory.forEach(record => record.factionTone = record.faction === "好人阵营" ? "good" : "evil");
scenes.identitySkills = { ...roomData(memoryRoom), room: publicView(memoryRoom, "p2"), revealed: true, secret: memorySecret };
scenes.identitySkillHistory = { ...scenes.identitySkills, identityHistoryOpen: true, identityHistoryExpandedId: 0 };
knightRoom.roles.p1 = "magician";
command(knightRoom, "p1", {
  type: "beginActivity",
  kind: "skills",
  stage: knightRoom.stage,
});
const skillAction = privateView(knightRoom, "p1").action;
scenes.knightSkills = {
  ...roomData(knightRoom),
  actionDialog: true,
  actionLabel: skillAction.label,
  actionChoices: skillAction.options,
  actionTargets: [],
};
for (const mode of ["", "detonate", "passive"]) {
  knightRoom.roles.p1 = "blueHunter";
  const action = privateView(knightRoom, "p1").action;
  scenes["hunter" + (mode || "Modes")] = {
    ...roomData(knightRoom), actionDialog: true, actionLabel: action.label,
    hunterModes: true, hunterMode: mode,
    actionChoices: mode ? action.options.filter(o => o.value.startsWith(mode + ":")).concat([{value: "mode:", label: "返回选择技能方式"}]) : [{value: "mode:detonate", label: "主动技能"}, {value: "mode:passive", label: "被动技能"}, {value: "pass", label: "不使用技能"}], actionTargets: [],
  };
}
const detailsRender = factory("pages/board-details/board-details.wxml");
const boardDetail = require("../server/board-info").knights;
scenes.boardDetails = { loading: false, error: "", hasDetail: true, title: "阿瓦隆 · 十二骑士", capacity: 12, directoryExpanded: false, ...boardDetail, summary: "" };
scenes.boardDirectory = { ...scenes.boardDetails, directoryExpanded: true };
const detailsCss = fs.readFileSync(path.join(root, "pages/board-details/board-details.wxss"), "utf8").replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const settingsRender = factory("pages/settings/settings.wxml");
scenes.roomSettings = {
  loading: false,
  authorized: true,
  busy: false,
  room: {
    code: "600435",
    boardName: "阿瓦隆 · 十二骑士",
    capacity: 12,
    phase: "tools",
  },
  boardId: "knights",
  visible: false,
  dirty: false,
};
scenes.roomSettings.transferPlayers = Array.from({ length: 11 }, (_, i) => ({ seat: i + 2, name: `玩家${i + 2}` }));
scenes.roomSettingsPicker = { ...scenes.roomSettings, showTransferPicker: true };
const settingsCss = fs
  .readFileSync(path.join(root, "pages/settings/settings.wxss"), "utf8")
  .replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const meCss = fs
  .readFileSync(path.join(root, "pages/me/me.wxss"), "utf8")
  .replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const profileCss = fs
  .readFileSync(path.join(root, "pages/profile/profile.wxss"), "utf8")
  .replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const personalTemplates = { personalMe: "me", personalEditor: "profile", personalStats: "stats" };
scenes.personalMe = { activeTab: 1, lobby: { isLobby: true }, personal: { profile: {displayName: "林间", initial: "林", identityLabel: "微信账号"}, stats: {total: 24,wins: 15,rateLabel: "62.5%"} } };
const { avatarLibrary } = require("../miniprogram/avatar-library");
scenes.personalEditor = { profile: {}, nickname: "子龙", initial: "子", loading: false, canUpload: true,
  avatarPreview: "/pages/profile/assets/avatars/avatar-01.jpg", selectedAvatar: "avatar-01", ...avatarLibrary() };
for (const [suffix, extra] of Object.entries({
  Uploading: { uploadStatus: "uploading", uploadProgress: 42, uploadBusy: true },
  Preparing: { uploadStatus: "pending" },
  Ready: { uploadStatus: "approved" },
  Failed: { uploadStatus: "failed", uploadError: "上传未完成，请检查网络后重试。" },
  Rejected: { uploadStatus: "rejected", uploadError: "这张图片暂时无法使用，请重新选择。" },
  Unavailable: { canUpload: false },
})) {
  const name = "personalEditor" + suffix;
  scenes[name] = { ...scenes.personalEditor, ...extra };
  personalTemplates[name] = "profile";
}
scenes.personalStats = {stats:{total:0,wins:0,losses:0,rateLabel:"—",excluded:0,byFaction:[],byBoard:[],recent:[]},loading:false};
const css = fs
  .readFileSync(path.join(root, "app.wxss"), "utf8")
  .replace('@import "pages/home/home.wxss";', fs.readFileSync(path.join(root, "pages/home/home.wxss"), "utf8"))
  .replace(/^page\s*\{/m, "body {")
  .replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const tabCss = fs.readFileSync(path.join(root, "custom-tab-bar/index.wxss"), "utf8");
const tabRender = factory("custom-tab-bar/index.wxml");
const tabData = { selected: 0, keyboardVisible: false, list: [{pagePath:"/pages/lobby/lobby",text:"对局",icon:"/assets/tab-table.png",activeIcon:"/assets/tab-table-active.png"},{pagePath:"/pages/me/me",text:"我的",icon:"/assets/tab-me.png",activeIcon:"/assets/tab-me-active.png"}] };
const navCss = fs.readFileSync(path.join(root, "components/app-nav/app-nav.wxss"), "utf8")
  .replace(/^@import.*$/m, "")
  .replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)")
  + ".app-nav-back{min-height:44px}";
fs.mkdirSync("output/playwright", { recursive: true });
for (const [name, data] of Object.entries(scenes)) {
  fs.writeFileSync(
    `output/playwright/${name}.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桌边助手 · 编译模板布局检查</title><style>body{margin:0}[hidden]{display:none!important}button,input{font:inherit;border:0}span{white-space:normal}form{display:block}button{width:100%}input{display:block;width:100%}${css}${navCss}${tabCss}${settingsCss}${name === "personalMe" ? meCss : ""}${name.startsWith("personalEditor") ? profileCss : ""}${name.startsWith("boardD") ? detailsCss : ""}</style>${html(personalTemplates[name] ? factory("pages/" + personalTemplates[name] + "/" + personalTemplates[name] + ".wxml")(data) : name.startsWith("boardD") ? detailsRender(data) : name.startsWith("roomSettings") ? settingsRender(data) : render(data))}${!data.room && !data.invitation && !personalTemplates[name] && !name.startsWith("boardD") && !name.startsWith("roomSettings") ? html(tabRender({...tabData,keyboardVisible:!!data.entryKeyboardHeight,entrySheetVisible:!!data.entrySheet})) : ""}</html>`,
  );
}
console.log("Layout projections: output/playwright/{home,lobby,identity}.html");
const roomShareSource = fs.readFileSync(path.join(root, "room-share.js"), "utf8");
fs.writeFileSync("output/playwright/room-share-cover.html", `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><title>房间邀请封面</title><style>body{margin:0;background:#131e25}canvas{display:block;width:100%;max-width:600px;height:auto}</style><canvas id="cover"></canvas><script>{const module={exports:{}};${roomShareSource}\nconst canvas=document.getElementById('cover');canvas.width=module.exports.width;canvas.height=module.exports.height;module.exports.drawRoomCover(canvas.getContext('2d'),${JSON.stringify({ code: "372338", boardName: "阿瓦隆 · 十二骑士" })});}</script></html>`);
