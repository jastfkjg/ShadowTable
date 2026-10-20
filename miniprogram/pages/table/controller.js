const dialog = require("../../dialog");
const api = require("../../api");
const avoidancePresentation = require("../../avoidance");
const { initialPlayerCardData, playerCardMethods } = require("../../player-card");
const funCopy = require("../../fun-copy");
const honorPresentation = require("../../honors");
const roomShare = require("../../room-share");
const resultRegistration = require("../../result-registration");
const publicHistory = require("../../public-history");
const roomSwipe = require("../../room-swipe");
const roomList = require("../../room-list");
const roomSheet = require("../../room-sheet-presentation");
const { portrait } = require("../../role-portraits");
const { selectTab, switchHomeTab } = require("../../tab-navigation");
const resultFlow = resultRegistration.flow;
// The sheet enters over 180ms; allow one render frame before raising the keyboard.
const ENTRY_FOCUS_DELAY = 200;
function roomListItems(rooms) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return rooms.map(r => {
    const time = roomList.activity(r) ? new Date(roomList.activity(r)) : null;
    const clock = time ? `${String(time.getHours()).padStart(2,"0")}:${String(time.getMinutes()).padStart(2,"0")}` : "";
    const day = time?.toDateString() === today.toDateString() ? "" : time?.toDateString() === yesterday.toDateString() ? "昨天 " : time ? `${time.getFullYear() === today.getFullYear() ? "" : time.getFullYear() + "/"}${time.getMonth()+1}/${time.getDate()} ` : "";
    return { ...r,
      canSwipeDissolve: roomSwipe.canDissolve(r),
      statusLabel: ({ lobby: "待开局", playing: "进行中", ended: "已结束", unavailable: "已失效" })[r.status] || r.phaseName || "待开局",
      peopleLabel: r.status === "lobby" ? `${r.occupied || 0}/${r.capacity} 人已入座` : `${r.capacity} 人`,
      relationLabel: r.available === false ? r.phaseName : `${r.isHost ? "我是房主" : r.relation === "旁观者" ? "旁观者" : "玩家"}${r.seat != null ? " · 我在" + r.seat + "号" : ""}`,
      compactRelation: r.available === false ? r.phaseName : [r.isHost ? "我是房主" : r.hostName ? "房主：" + r.hostName : "", r.seat != null ? (r.isHost ? "" : "我在") + r.seat + "号" : r.relation === "旁观者" ? "旁观者" : "未入座"].filter(Boolean).join(" · "),
      entryLabel: r.available === false ? "已失效" : r.status === "ended" ? "查看结果" : "返回牌桌",
      activityLabel: time ? day + clock : "暂无活动时间",
    };
  });
}
const CHOICES = {
  confirm: "确认",
  approve: "赞成",
  reject: "反对",
  success: "任务成功",
  fail: "任务失败",
  magic: "魔法（反转结果）",
  thiefFail: "盗贼失败",
  pass: "不使用技能 / 确认",
};
// Derive private skill controls only from the server's allowed choices.
function skillView(room, choices, hunterModes, hunterMode, swapOptions) {
  const fairyAction = room.phase === "fairy";
  const finalAction = !!room.knights && ["assassination", "reverseStrike"].includes(room.phase) && choices.some(c => /^target:\d+$/.test(c.value));
  const skillAction = fairyAction || finalAction || ["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn"].includes(room.phase);
  const targets = choices.filter(c => /^(target|inspect|detonate|passive):\d+$/.test(c.value) && Number(c.value.split(":")[1]) > 0).map(c => {
    const seat = Number(c.value.split(":")[1]);
    const player = (room.players || []).find(p => p.seat === seat);
    return { ...c, seat, name: player ? player.name : "" };
  });
  const label = targets[0]?.label || "";
  const mode = fairyAction ? "fairy" : finalAction ? "final" : swapOptions.length ? "swap"
    : hunterModes ? hunterMode
    : targets[0]?.value.startsWith("inspect:") ? "inspect"
    : label.includes("使用刀 / 决斗") ? "attack"
    : label.includes("开刀") ? "sword" : label.includes("决斗") ? "duel"
    : label.includes("指定替死者") ? "substitute" : label.includes("秘密守护") ? "guard"
    : label.includes("复活") ? "revive" : label.includes("开枪") ? "gun"
    : targets.length ? "target" : "";
  const copy = skillTargetCopy(mode);
  const players = (room.players?.length ? room.players : targets).slice().sort((a, b) => a.seat - b.seat);
  const swapSeats = new Set(swapOptions.flatMap(v => v.split(":").slice(1).map(Number)));
  function unavailable(player, allowed) {
    if (allowed) return "";
    if (fairyAction && player.seat === room.fairyHolder) return "你 · 当前持有者";
    if (player.alive === false) return "已出局";
    if (player.seat === room.me?.seat) return "你 · 不可选择";
    return fairyAction ? "曾持有仙女" : mode === "detonate" ? "仅相邻玩家可选" : "不可选择";
  }
  const skillTargets = mode && mode !== "swap" ? players.map(player => {
    const choice = targets.find(c => c.seat === player.seat);
    return { value: "disabled:" + player.seat, label: player.seat + "号", ...choice,
      seat: player.seat, name: player.name, disabledReason: unavailable(player, !!choice) };
  }) : targets;
  const round = room.knights?.round || room.round;
  const swapPlayers = mode === "swap" ? players.map(player => ({ seat: player.seat, name: player.name,
    selected: false, disabledReason: unavailable(player, swapSeats.has(player.seat)) })) : [];
  const count = mode === "swap" ? swapSeats.size : targets.length;
  return {
    skillAction, skillTargetMode: mode, skillTitle: copy?.title || (hunterModes ? "使用技能 · 猎人" : "使用技能"),
    skillHint: copy?.hint || (hunterModes ? "第 1 步：选择主动技能、被动技能，或本轮不开枪" : "本阶段没有可选目标，请确认本轮选择"),
    skillTargets,
    ...(mode === "swap" ? { swapPlayers } : {}),
    skillTargetMeta: mode ? (round ? "第 " + round + " 轮 · " : "") +
      (fairyAction ? (room.fairyHolder || room.me?.seat) + " 号持有仙女" : finalAction ? "最终盘刀" : "技能准备") : "",
    skillTargetCaption: copy?.privateResult ? "结果仅你可见" : "可选目标 " + count + " 人",
    skillEligibility: fairyAction && !room.knights ? "当前持有者与曾持有仙女的玩家不可选。" : copy?.eligibility || "",
    skillBodyHeight: mode ? Math.ceil((mode === "swap" ? swapPlayers.length : skillTargets.length) / 3) * 77 + 84 + (mode === "swap" ? 30 : 0) : Math.ceil(targets.length / 3) * 164,
    skillOtherChoices: choices.filter(c => !targets.some(t => t.value === c.value)).map(c => ({ ...c,
      label: c.value === "target:0" && finalAction ? "本次空刀" : c.value === "pass"
        ? copy?.pass || (hunterModes ? "本轮不开枪" : c.label === "确认" ? "本轮确认" : "本轮不使用技能") : c.label,
    })),
    ...skillSelectionView(room, "", mode),
  };
}
function skillTargetCopy(mode) {
  return {
    fairy: { title: "仙女查验", hint: "查验一名玩家，并将仙女传给 TA。", verb: "查验", privateResult: true, eligibility: "当前持有者、曾持有仙女或已出局的玩家不可选。" },
    sword: { title: "选择开刀目标", hint: "选择一名玩家，或本轮不开刀。", verb: "开刀", pass: "本轮不开刀", eligibility: "自己与已出局玩家不可选。" },
    duel: { title: "骑士决斗", hint: "选择一名玩家决斗，或本轮不决斗。", verb: "决斗", pass: "本轮不决斗", eligibility: "自己与已出局玩家不可选。", consequence: "决斗失败时，你将出局 · 确认后不可更改" },
    inspect: { title: "石像鬼查验", hint: "查验一名玩家是否拥有主动击杀能力。", verb: "查验", pass: "本轮不查验", privateResult: true, eligibility: "可查验自己；已出局玩家不可选。" },
    guard: { title: "秘密守护", hint: "选择一名玩家守护，或本轮不守护。", verb: "守护", pass: "本轮不守护", eligibility: "可守护自己；已出局玩家不可选。" },
    substitute: { title: "指定替死者", hint: "选择一名玩家作为替死者，或本轮不指定。", verb: "指定替死", pass: "本轮不指定替死者", eligibility: "可选择自己；已出局玩家不可选。" },
    detonate: { title: "猎人主动自爆", hint: "第 2 步：选择相邻一人，自己将自爆出局", verb: "自爆开枪", eligibility: "仅可选择相邻且存活的玩家。", consequence: "你将自爆出局并向目标开枪 · 确认后不可更改" },
    passive: { title: "猎人被动开枪", hint: "第 2 步：选择出局时开枪的目标；替女巫出局不触发", verb: "被动开枪", eligibility: "自己与已出局玩家不可选。", consequence: "仅在符合条件的出局时开枪 · 确认后不可更改" },
    gun: { title: "选择开枪目标", hint: "选择一名玩家开枪，或本轮不开枪。", verb: "开枪", pass: "本轮不开枪", eligibility: "自己与已出局玩家不可选。" },
    attack: { title: "选择技能目标", hint: "选择一名玩家使用刀或决斗，或本轮不使用技能。", verb: "使用技能", pass: "本轮不使用技能", eligibility: "自己与已出局玩家不可选。" },
    revive: { title: "选择复活目标", hint: "选择一名可复活的玩家，或本轮不复活。", verb: "复活", pass: "本轮不复活", eligibility: "仅可选择本阶段允许复活的玩家。" },
    swap: { title: "魔术师秘密换号", hint: "选择两个座位交换号码，再次点击可取消。", verb: "换号", pass: "本轮不换号", eligibility: "可选择自己；已出局玩家不可选。" },
    final: { title: "选择最终盘刀目标", hint: "录入线下多数决议的梅林目标，或选择空刀。", verb: "最终盘刀", eligibility: "自己与已出局玩家不可选。" },
    target: { title: "选择技能目标", hint: "选择一名玩家，或本轮不使用技能。", verb: "使用技能", pass: "本轮不使用技能" },
  }[mode];
}
function skillSelectionView(room, value, mode, swapSeats = []) {
  if (!mode) return { skillSummary: "", skillConsequence: "", skillConfirmLabel: "" };
  const copy = skillTargetCopy(mode);
  const seat = /^(target|inspect|detonate|passive):\d+$/.test(value) ? Number(value.split(":")[1]) : null;
  const player = (room.players || []).find(p => p.seat === seat);
  let summary = "尚未选择目标", confirm = "请先选择目标";
  if (value === "pass") {
    summary = "已选择：" + copy.pass;
    confirm = "确认" + copy.pass;
  } else if (mode === "final" && seat === 0) {
    summary = "已选择：本次空刀";
    confirm = "确认本次空刀";
  } else if (seat !== null) {
    summary = copy.verb + "目标：" + seat + " 号" + (player?.name ? " · " + player.name : "");
    confirm = mode === "fairy" || mode === "inspect" ? "确认查验 " + seat + " 号" : "确认对 " + seat + " 号" + copy.verb;
  } else if (mode === "swap") {
    const seats = value.startsWith("swap:") ? value.split(":").slice(1).map(Number) : swapSeats;
    summary = seats.length ? "已选 " + seats.length + " / 2：" + seats.join(" 号、") + " 号" : "尚未选择座位 · 需选 2 人";
    confirm = seats.length === 2 && value ? "确认交换 " + seats.join(" 号与 ") + " 号" : seats.length ? "请再选择一个座位" : "请选择两个座位";
  }
  return {
    skillSummary: summary,
    skillConsequence: mode === "fairy" && seat !== null ? "仙女将传给 " + seat + " 号 · 确认后不可更改"
      : value === "pass" ? "确认提交后不可更改" : copy.consequence || "确认提交后不可更改",
    skillConfirmLabel: confirm,
  };
}
function skillDraftLabel(choice, hunterModes, mode) {
  const copy = skillTargetCopy(mode);
  if (choice.value === "pass") return copy?.pass || (hunterModes ? "本轮不开枪" : choice.label === "确认" ? "本轮确认" : "不使用技能");
  if (choice.value.startsWith("inspect:") || mode === "fairy") return "查验 " + choice.value.split(":")[1] + " 号";
  return choice.label;
}
function factionTone(faction) {
  if (!faction) return "";
  if (faction.includes("好人")) return "good";
  if (faction.includes("坏人")) return "evil";
  if (faction.includes("盗贼")) return "third";
  return "";
}
function voteSummary(votes) {
  return (votes.some((v) => v.approve === null) ? [true, false, null] : [true, false])
    .map((approve) => {
      const seats = votes
        .filter((v) => v.approve === approve)
        .map((v) => v.seat)
        .sort((a, b) => a - b);
      return `${seats.length}票${approve === null ? "弃权" : approve ? "赞成" : "反对"}：${seats.length ? seats.join("，") : "无"}`;
    })
    .join("\n");
}
function toolHistory(h, key) {
  if (["skillDetail", "skillResult", "toolCutoff"].includes(h.kind))
    return { key, text: h.text, detail: h.detail || "" };
  if (h.kind === "variant") return { key, text: h.text, detail: "", inspectionLabel: publicHistory.inspectionLabel(h) };
  if (h.kind === "toolVote")
    return {
      key,
      text: "投票" + (h.approved ? "通过" : "未通过") + (h.earlyClosed ? " · 提前截止" : ""),
      voteGroups: (h.votes.some((v) => v.approve === null) ? [true, false, null] : [true, false]).map((approve) => {
        const seats = h.votes
          .filter((v) => v.approve === approve)
          .map((v) => v.seat)
          .sort((a, b) => a - b);
        return {
          label: approve === null ? "弃权" : approve ? "赞成" : "反对",
          count: seats.length,
          seats: seats.length ? seats.join("、") + " 号" : "无",
          tone: approve === null ? "abstain" : approve ? "approve" : "reject",
        };
      }),
      teamLabel: h.team.length ? h.team.join("、") + " 号" : "",
      detail:
        (h.team.length ? `队伍 ${h.team.join("、")}号\n` : "") +
        voteSummary(h.votes),
    };
  if (h.kind === "toolQuest")
    return {
      key,
      text: (h.success ? "任务成功" : "任务失败"),
      questResult: h.success ? "success" : "failure",
      teamLabel: h.team.join("、") + " 号",
      cards: Object.entries(
        h.counts || { success: h.team.length - h.fails, fail: h.fails },
      )
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => ({
          label:
            {
              success: "成功",
              fail: "失败",
              thiefFail: "盗贼失败",
              magic: "魔法",
            }[kind] || kind,
          count,
          tone: kind === "success" ? "success" : ["fail", "thiefFail"].includes(kind) ? "failure" : "",
        })),
      detail: h.counts
        ? `${h.team.join("、")}号 · 成功${h.counts.success} / 失败${h.counts.fail} / 盗贼失败${h.counts.thiefFail} / 魔法${h.counts.magic}`
        : `${h.team.join("、")}号 · ${h.fails}张失败票`,
    };
  if (h.kind === "toolKnife")
    return {
      key,
      text: "刀梅林",
      detail: `${h.target === 0 ? "空刀" : h.target + "号"} · ${h.hit ? (h.target === 0 ? "空刀命中" : "命中梅林") : h.target === 0 ? "空刀未命中" : "未命中梅林"}`,
    };
  if (h.kind === "toolReverse")
    return {
      key,
      text: "刀逆仆已结算",
      detail: "结果仅向相关玩家展示，可继续发起其他操作",
    };
  if (h.kind === "toolOffline")
    return { key, text: "线下刀人已完成", detail: "以线下结算为准" };
  if (h.kind === "toolCanceled")
    return { key, text: h.text || "未结算的操作已作废", detail: h.detail || "未公开或计入本次提交" };
  return null;
}
module.exports = function createTablePage({ lobby = false } = {}) { return {
  data: {
    isLobby: lobby,
    loading: true,
    roomsRefreshing: false,
    busy: false,
    error: "",
    reconnecting: false,
    recoverableError: false,
    hasPendingRequest: false,
    notice: "",
    roomFeedback: "",
    room: null,
    ...initialPlayerCardData,
    latestResult: null,
    processBodyHeight: 0,
    ...publicHistory.initialData(),
    seatsExpanded: true,
    seatOccupiedCount: 0,
    seatReadyCount: 0,
    operationProgressExpanded: false,
    questTimeline: [],
    boards: [],
    availableBoards: [],
    entryMode: "join",
    entrySheet: false,
    entryMeasuring: false,
    entryFocusedField: "",
    entryScrollTarget: "",
    entryKeyboardHeight: 0,
    entryBodyHeight: 0,
    entryAvatarUrl: "",
    entryAvatarFailed: false,
    codeSlots: [0, 1, 2, 3, 4, 5],
    entryNameError: "",
    entryCodeError: "",
    entryError: "",
    invitation: null,
    invitationError: "",
    invitationNeedsName: false,
    invitationRetry: false,
    showRoomRules: false,
    roomRulesMeasuring: false,
    roomRulesBodyHeight: 0,
    roomRoleGroups: [],
    avoidanceOpen: false, avoidanceLoading: false, avoidance: null, avoidanceGroups: [], avoidanceDraft: "", avoidanceDraftName: "",
    actionDialog: false,
    actionSecret: null,
    dealtIdentityDialog: false,
    dealtIdentitySecret: null,
    identityHintVisible: false,
    actionLoading: false,
    actionLabel: "",
    actionChoices: [],
    hunterModes: false,
    hunterMode: "",
    hunterChoices: [],
    actionTargets: [],
    draftChoice: "",
    draftLabel: "",
    stagedChoice: false,
    skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
    skillTargetMode: "", skillTargetMeta: "", skillTargetCaption: "", skillEligibility: "", skillSummary: "", skillConsequence: "", skillConfirmLabel: "",
    swapOptions: [],
    swapSeats: [],
    swapPlayers: [],
    toolType: "",
    toolSeats: [],
    toolThreshold: 1,
    showRoomSettings: false,
    boardIndex: 0,
    capacityIndex: 1,
    statsOpen: false, stats: null, statsLoading: false, statsError: "",
    honors: null, honorDialog: false, honorMatchId: "", honorDismissed: "", honorDraft: { mvp: null, svp: null }, honorGroups: [], honorReady: false,
    resultDialog: false, resultChoice: "",
    memberRooms: [],
    visibleMemberRooms: [],
    historyRooms: [], historyExpanded: false, availableRoomCount: 0,
    showHistorySection: true, currentRoomCount: 0,
    roomListFilter: "all",
    roomSwipeCode: "",
    roomSwipeOffset: 0,
    roomSwipeDragging: false,
    roomMenu: null,
    noteRoom: null,
    roomNoteDraft: "",
    roomFilters: [{id:"all",label:"全部"},{id:"playing",label:"进行中"},{id:"lobby",label:"待开局"},{id:"ended",label:"已结束"}],
    boardId: "classic",
    boardName: "阿瓦隆 · 经典基础",
    boardRoleConfiguration: [],
    name: "",
    nicknameSetup: true,
    nicknameVersion: 0,
    code: "",
    capacity: 6,
    capacities: [5, 6, 7, 8, 9, 10, 11, 12, 13],
    selected: [],
    revealed: false,
    secret: null,
    identityHistoryOpen: false,
    identityHistoryExpandedId: null,
    choiceButtons: [],
    targetButtons: [],
    network: true,
    serverConnected: false,
    needsLogin: false,
  },
  onLoad(query = {}) {
    this.alive = true;
    this.foreground = true;
    this.generation = 0;
    this.inviteCode = /^\d{6}$/.test(query.code || "") ? query.code : null;
    this.inviteInstance = query.instance == null ? null : String(query.instance);
    this.inviteBound = query.instance != null;
    this.resumingRoom = query.resume === "1" && !this.inviteBound;
    this.invalidInvitation = query.code != null && !this.inviteCode ||
      this.inviteBound && (!this.inviteCode || !/^\d+$/.test(this.inviteInstance));
    this.setData({
      name: wx.getStorageSync("nickname") || "",
      entryMode: "join",
      code: query.code || wx.getStorageSync("invitedRoom") || "",
      invitation: !this.data.isLobby && !this.resumingRoom && (this.inviteCode || this.invalidInvitation) ? { code: query.code || "" } : null,
    });
    this.networkListener = (res) => {
      this.setData({ network: res.isConnected });
      if (!res.isConnected) {
        this.mask();
        this.handleError(new Error("连接已断开"));
      } else if (this.data.reconnecting) {
        this.recoverConnection();
      }
    };
    wx.onNetworkStatusChange(this.networkListener);
    return this.bootstrap();
  },
  onReady() {
    this.shareCanvasReady = true;
    this.prepareRoomShare();
  },
  onShow() {
    if (this.data.isLobby) selectTab(this, 0);
    this.returningHome = false;
    this.foreground = true;
    this.syncRoomSheetLayout("entry");
    this.syncRoomSheetLayout("rules");
    if (this.alive) {
      if (this.data.reconnecting || this.pending) this.recoverConnection();
      else if (this.data.isLobby && !this.data.loading) this.refreshLobby();
      else if (this.roomCode) this.refresh().catch((e) => this.handleError(e));
      else if (this.inviteCode && !this.resumingRoom && !this.data.loading && !this.data.invitationNeedsName && !this.data.invitationError) this.retry();
      this.schedule();
    }
  },
  onHide() {
    this.foreground = false;
    this.clearRoomFeedback();
    this.dismissRoomSwipe();
    this.resetEntryFocus();
    clearTimeout(this.timer);
    this.mask();
  },
  onPageScroll() {
    // Native scroll callbacks can arrive after a horizontal swipe has settled.
    // Close on a new outside touch or an actual vertical gesture instead.
    this.showIdentityHintWhenVisible();
  },
  onResize() {
    this.dismissRoomSwipe();
    this.showIdentityHintWhenVisible();
    this.syncRoomSheetLayout("entry");
    this.syncRoomSheetLayout("rules");
    this.syncProcessSheetLayout();
  },
  onUnload() {
    this.alive = false;
    this.foreground = false;
    this.clearRoomFeedback();
    this.cancelEntryAutoFocus();
    clearTimeout(this.timer);
    wx.offNetworkStatusChange(this.networkListener);
    this.mask();
  },
  updateChangedData(values) {
    const changed = {};
    for (const key of Object.keys(values)) {
      if (JSON.stringify(this.data[key]) !== JSON.stringify(values[key]))
        changed[key] = values[key];
    }
    if (Object.keys(changed).length) this.setData(changed);
  },
  clearRoomFeedback() {
    clearTimeout(this.roomFeedbackTimer);
    this.roomFeedbackTimer = null;
    this.roomFeedbackRevision = (this.roomFeedbackRevision || 0) + 1;
    this.updateChangedData({ roomFeedback: "" });
  },
  showRoomFeedback(message) {
    this.clearRoomFeedback();
    if (!this.alive || !this.foreground) return;
    const revision = this.roomFeedbackRevision;
    this.setData({ roomFeedback: message });
    this.roomFeedbackTimer = setTimeout(() => {
      if (revision !== this.roomFeedbackRevision) return;
      this.roomFeedbackTimer = null;
      if (this.alive) this.setData({ roomFeedback: "" });
    }, 1500);
  },
  mask() {
    this.dismissGrantNotice?.();
    this.dismissRoomSwipe();
    this.closePlayerCard();
    this.generation = (this.generation || 0) + 1;
    this.actionGeneration = (this.actionGeneration || 0) + 1;
    this.updateChangedData({
      avoidanceOpen: false, avoidanceLoading: false, avoidance: null, avoidanceGroups: [], avoidanceDraft: "", avoidanceDraftName: "",
      historyOpen: false,
      dealtIdentityDialog: false,
      dealtIdentitySecret: null,
      identityHintVisible: false,
      fairyResult: null,
      fairyResultRevealed: false,
      identityChange: null,
      identityChangeRevealed: false,
      actionDialog: false,
      actionSecret: null,
      actionLoading: false,
      actionLabel: "",
      actionChoices: [],
      hunterModes: false,
      hunterMode: "",
      hunterChoices: [],
      actionTargets: [],
      draftChoice: "",
      draftLabel: "",
      stagedChoice: false,
      skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
      skillTargetMode: "", skillTargetMeta: "", skillTargetCaption: "", skillEligibility: "", skillSummary: "", skillConsequence: "", skillConfirmLabel: "",
      swapOptions: [],
      swapSeats: [],
      swapPlayers: [],
      revealed: false,
      secret: null,
      identityHistoryOpen: false,
      identityHistoryExpandedId: null,
      choiceButtons: [],
      targetButtons: [],
    });
  },
  buzz(type = "light") {
    try {
      if (wx.vibrateShort) wx.vibrateShort({ type });
    } catch (e) {}
  },
  async bootstrap() {
    this.setData({ loading: true, error: "" });
    try {
      if (this.invalidInvitation) { this.showInvitationError("房间邀请无效，请让朋友重新分享"); return; }
      await api.login();
      const { boards } = await api.request("/api/boards");
      this.setData({
        boards,
        capacities: [
          ...new Set(
            boards.filter((b) => b.available).flatMap((b) => b.counts),
          ),
        ].sort((a, b) => a - b),
        needsLogin: false,
      });
      this.selectCapacity(this.data.capacity);
      // Explicit links take precedence over cached rooms and unrelated pending entries.
      if (this.inviteCode && !this.data.isLobby && !this.resumingRoom) {
        await this.openInvitation();
        return;
      }
      const held = !this.data.isLobby && typeof getApp === "function" && getApp().pendingTableRequest;
      if (held && (!this.inviteCode || held.code === this.inviteCode)) {
        this.roomCode = held.code; this.pending = held;
        await this.executePending(); return;
      }
      const entry = wx.getStorageSync("pendingEntry");
      if (entry) {
        this.pending = entry;
        await this.executePending();
        return;
      }
      if (this.data.isLobby) {
        await this.refreshLobby();
        if (this.inviteCode && !this.data.entrySheet) {
          this.setData({ code: this.inviteCode });
          this.switchEntry({ currentTarget: { dataset: { mode: "join" } } });
        }
        return;
      }
      await this.loadRooms();
      const code = this.inviteCode || wx.getStorageSync("roomCode");
      if (code) {
        this.roomCode = code;
        await this.refresh();
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ loading: false });
      this.schedule();
    }
  },
  showInvitationError(message, retry = false) {
    this.connectionRecovered();
    this.setData({ invitationError: message, invitationRetry: retry, invitationNeedsName: false, hasPendingRequest: !!this.pending, recoverableError: false, error: "", entryNameError: "", entryError: "" });
  },
  async openInvitation() {
    const code = this.inviteCode;
    if (!code || !this.alive) return;
    this.setData({ invitation: { code }, invitationError: "", invitationNeedsName: false, entryNameError: "", entryError: "" });
    let invitation;
    try {
      const query = this.inviteInstance == null ? "" : "?instance=" + encodeURIComponent(this.inviteInstance);
      invitation = await api.request("/api/rooms/" + code + "/invitation" + query);
    } catch (e) {
      if (!this.alive) return;
      if (e.status === 404 || e.status === 410) {
        this.showInvitationError(e.status === 404 ? "该房间已解散" : (e.message.includes("房间已失效") ? "房间已失效，无法再进入" : "该邀请已失效，请让朋友重新分享"));
        return;
      }
      throw e;
    }
    if (!this.alive) return;
    this.inviteInstance = String(invitation.createdAt);
    this.setData({ invitation, code, serverConnected: true, needsLogin: false });
    this.connectionRecovered();
    const held = typeof getApp === "function" && getApp().pendingTableRequest;
    const entry = wx.getStorageSync("pendingEntry");
    const matches = request => request && (request.code === code || request.path === "/api/rooms/" + code + "/join") &&
      (request.instance != null ? String(request.instance) === this.inviteInstance
        : request.data?.createdAt != null ? String(request.data.createdAt) === this.inviteInstance
        : request.after !== "enter" || !this.inviteBound);
    const pending = matches(held) ? held : matches(entry) ? entry : null;
    if (pending) {
      this.roomCode = code;
      this.pending = pending;
      await this.executePending();
      return;
    }
    if (invitation.isMember) {
      this.roomCode = code;
      wx.setStorageSync("roomCode", code);
      await this.refresh();
      return;
    }
    if (held || entry) {
      this.showInvitationError("另一项房间操作尚未确认，请返回对局处理后重试邀请", true);
      return;
    }
    const profile = await api.request("/api/me/profile");
    if (!this.alive) return;
    const confirmed = profile.nicknameConfirmed ?? !!(profile.nickname && profile.nickname !== "新朋友");
    this.setData({ name: confirmed ? profile.nickname : "", nicknameSetup: !confirmed, nicknameVersion: profile.version, invitationNeedsName: !confirmed });
    if (confirmed && this.foreground) await this.join();
  },
  submitInvitation(e) {
    if (this.data.busy || this.pending || this.data.loading) return;
    const name = (e.detail?.value?.nickname || "").trim();
    this.setData({ name, entryNameError: name ? "" : "请填写昵称", entryError: "" });
    if (name) return this.join();
  },
  async refreshLobby({ preserveName = false } = {}) {
    const sequence = this.lobbyRefreshSequence = (this.lobbyRefreshSequence || 0) + 1;
    const nameInputRevision = this.nameInputRevision || 0;
    try {
      await api.login();
      // Neither read should prevent the other from populating the lobby.
      const [roomsResult, profileResult] = await Promise.allSettled([
        this.loadRooms(), api.request("/api/me/profile"),
      ]);
      if (!this.alive || sequence !== this.lobbyRefreshSequence) return;
      const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
      // A changed personal nickname replaces an older table draft, while input
      // entered during this refresh and avatar-only edits retain the user's name.
      if (profile) {
        const confirmed = profile.nicknameConfirmed ?? !!(profile.nickname && profile.nickname !== "新朋友");
        const avatarUrl = profile.avatarUrl ? api.assetUrl(profile.avatarUrl) : "";
        const values = { nicknameSetup: !confirmed, nicknameVersion: profile.version,
          entryAvatarUrl: avatarUrl, entryAvatarFailed: this.data.entryAvatarUrl === avatarUrl && this.data.entryAvatarFailed };
        if (!preserveName && this.lobbyProfileNickname !== undefined && this.lobbyProfileNickname !== profile.nickname &&
            nameInputRevision === (this.nameInputRevision || 0)) this.nameEdited = false;
        this.lobbyProfileNickname = profile.nickname;
        if (!this.nameEdited) values.name = (confirmed ? profile.nickname : "") || wx.getStorageSync("nickname") || "";
        this.updateChangedData(values);
        this.syncRoomSheetLayout("entry");
      }
      const held = typeof getApp === "function" && getApp().pendingTableRequest;
      this.updateChangedData({ pendingTableCode: held ? held.code : "" });
      const invited = wx.getStorageSync("invitedRoom");
      if (invited) {
        this.setData({ code: invited, entryMode: "join", notice: "朋友邀请你加入房间 " + invited });
        this.switchEntry({ currentTarget: { dataset: { mode: "join" } } });
        wx.removeStorageSync("invitedRoom");
      }
      if (profileResult.status === "rejected") throw profileResult.reason;
      if (roomsResult.status === "rejected") throw roomsResult.reason;
    } catch (e) { if (this.alive && sequence === this.lobbyRefreshSequence) this.handleError(e); }
  },
  async enterTable(code) {
    const held = typeof getApp === "function" && getApp().pendingTableRequest;
    if (held && held.code !== code) {
      this.setData({ error: "房间 " + held.code + " 还有未确认操作，请先返回处理" }); return;
    }
    this.roomCode = null;
    this.setData({ entrySheet: false });
    this.resetEntryFocus();
    if (!this.foreground) return;
    await new Promise(resolve => wx.navigateTo({ url: "/pages/table/table?code=" + code + "&resume=1",
      fail: () => this.setData({ error: "未能打开牌桌，请在我的牌桌中重试" }), complete: resolve }));
  },
  async loadRooms() {
    const sequence = this.roomsReadSequence = (this.roomsReadSequence || 0) + 1;
    const { rooms, serverTime } = await api.request("/api/me/rooms");
    if (this.alive && sequence === this.roomsReadSequence) {
      this.connectionRecovered();
      const items = roomListItems(roomList.availableRooms(rooms));
      this.roomsServerTime = serverTime || Date.now();
      this.dismissRoomSwipe();
      this.updateChangedData({ memberRooms: items, activeRooms: items.filter(r => r.status === "playing" && r.available !== false),
        ...roomList.present(items, this.data.roomListFilter, this.roomsServerTime), serverConnected: true, network: true });
    }
  },
  handleError(e) {
    this.mask();
    if (e.status === 403 && e.message === "你已被房主移出房间") {
      this.pending = null;
      this.clearRoom();
      this.setData({ notice: e.message, hasPendingRequest: false });
      this.loadRooms().catch(error => this.handleError(error));
      return;
    }
    if ((!e.status || e.status >= 500 || e.status === 429) && e.retryable !== false) {
      this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
      if (e.status === 429) this.rateLimitUntil = Date.now() + (e.retryAfterMs || 60000);
      this.setData({ reconnecting: true, error: "", recoverableError: false, serverConnected: false,
        hasPendingRequest: !!this.pending,
        notice: e.status === 429 && !this.pending ? "请求较多，冷却后会自动刷新" : "" });
      this.schedule();
      return;
    }
    this.setData({ reconnecting: false });
    this.setData({
      error: e.message,
      serverConnected: !!e.status && e.status < 500 && e.status !== 401,
      needsLogin: e.status === 401,
      recoverableError:
        !e.status || e.status === 401 || e.status === 429 || e.status >= 500,
      hasPendingRequest: !!this.pending,
    });
  },
  blockScroll() {},
  dismissError() {
    this.setData({
      error: "",
      recoverableError: false,
      hasPendingRequest: false,
    });
  },
  connectionRecovered() {
    this.reconnectAttempts = 0;
    this.updateChangedData({ reconnecting: false });
  },
  async recoverConnection() {
    if (!this.alive || !this.foreground || this.recovering || this.data.busy || this.data.loading || this.data.needsLogin) return;
    if (Date.now() < (this.rateLimitUntil || 0)) { this.schedule(); return; }
    this.recovering = true;
    try {
      await this.retry();
    } finally {
      this.recovering = false;
      this.schedule();
    }
  },
  schedule() {
    clearTimeout(this.timer);
    if (!this.foreground || !this.alive || (!this.roomCode && !this.data.reconnecting)) return;
    const delay = this.data.reconnecting
      ? Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(0, (this.reconnectAttempts || 1) - 1))) * (0.8 + Math.random() * 0.2)
      : this.data.room?.honors?.status === "open" ? 2500 : ["lobby", "ended", "terminated"].includes(this.data.room?.phase) ? Math.min(10000, 2500 * (1 + Math.floor((this.unchangedPolls || 0) / 4))) : 2500;
    this.timer = setTimeout(async () => {
      if (this.data.reconnecting) {
        if (this.data.network) await this.recoverConnection();
      } else if (this.roomCode && !this.data.busy && !this.pending && !this.data.error && !this.recovering) {
        try { await this.refresh(); } catch (e) { this.handleError(e); }
      }
      this.schedule();
    }, Math.max(delay, (this.rateLimitUntil || 0) - Date.now()));
  },
  async refresh() {
    if (!this.roomCode) return;
    const code = this.roomCode,
      sequence = (this.refreshSequence = (this.refreshSequence || 0) + 1);
    let room;
    try {
      const query = this.inviteCode === code && this.inviteInstance != null ? "?instance=" + encodeURIComponent(this.inviteInstance) : "";
      room = funCopy.response(await api.request("/api/rooms/" + code + query));
    } catch (e) {
      if (
        !this.alive ||
        code !== this.roomCode ||
        sequence !== this.refreshSequence
      )
        return;
      if (e.status === 404 || e.status === 403 || e.status === 410) {
        this.clearRoom();
        if (this.inviteCode === code && !this.resumingRoom) {
          this.setData({ invitation: { code } });
          this.showInvitationError(e.status === 404 ? "该房间已解散" : e.status === 410 ? (e.message.includes("房间已失效") ? "房间已失效，无法再进入" : "该邀请已失效，请让朋友重新分享") : e.message);
          return;
        }
        this.setData({
          notice: e.status === 404 ? "牌桌已删除或不存在" : e.status === 410 ? "房间已失效，已从列表隐藏" : e.message === "你已被房主移出房间" ? e.message : "你已离开这张牌桌",
        });
        await this.loadRooms();
        return;
      }
      throw e;
    }
    if (
      !this.alive ||
      code !== this.roomCode ||
      sequence !== this.refreshSequence
    )
      return;
    if (room.phase !== "lobby") this.dismissGrantNotice?.();
    this.connectionRecovered();
    if (this.data.invitation) this.setData({ invitation: null, invitationNeedsName: false, invitationError: "", entryNameError: "", entryError: "" });
    const snapshot = JSON.stringify(room);
    this.unchangedPolls = snapshot === this.lastRoomSnapshot ? (this.unchangedPolls || 0) + 1 : 0;
    this.lastRoomSnapshot = snapshot;
    const stageChanged = this.data.room?.stage !== room.stage;
    const privacyChanged = stageChanged || this.data.room?.me.identityRevision !== room.me.identityRevision;
    if (this.data.playerCard) {
      const target = room.players.find(p => p.statsId === this.data.playerCard.id);
      if (privacyChanged || room.code !== this.data.room?.code || !target || target.seat !== this.data.playerCard.seat || target.name !== this.data.playerCard.name || target.avatarUrl !== this.data.playerCard.sourceAvatarUrl)
        this.closePlayerCard();
    }
    // Haptic nudge on game-stage transitions; stronger when it is now our turn.
    if (stageChanged && this.data.room)
      this.buzz(room.needsSubmission && !room.me.submitted ? "medium" : "light");
    const selected = stageChanged ? [] : this.data.selected;
    const privacyUpdate = privacyChanged
      ? {
          avoidanceOpen: false, avoidanceLoading: false, avoidance: null, avoidanceGroups: [], avoidanceDraft: "", avoidanceDraftName: "",
          dealtIdentityDialog: false,
          dealtIdentitySecret: null,
          identityHintVisible: false,
          fairyResult: null,
          fairyResultRevealed: false,
          identityChange: null,
          identityChangeRevealed: false,
          revealed: false,
          secret: null,
          identityHistoryOpen: false,
          identityHistoryExpandedId: null,
          choiceButtons: [],
          targetButtons: [],
          selected,
          actionDialog: false,
          actionSecret: null,
          actionLoading: false,
          actionLabel: "",
          actionChoices: [],
          hunterModes: false,
          hunterMode: "",
          hunterChoices: [],
          actionTargets: [],
          draftChoice: "",
          draftLabel: "",
          stagedChoice: false,
          skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
          skillTargetMode: "", skillTargetMeta: "", skillTargetCaption: "", skillEligibility: "", skillSummary: "", skillConsequence: "", skillConfirmLabel: "",
          swapOptions: [],
          swapSeats: [],
          swapPlayers: [],
        }
      : {};
    // Invalidate pending identity reads before committing the new stage in one update.
    if (privacyChanged) {
      this.generation = (this.generation || 0) + 1;
      this.actionGeneration = (this.actionGeneration || 0) + 1;
    }
    if (!this.avatarFailures || this.data.room?.code !== room.code) this.avatarFailures = new Set();
    const currentAvatarUrls = new Set(room.players.filter(p => p.avatarUrl).map(p => api.assetUrl(p.avatarUrl)));
    for (const url of this.avatarFailures) if (!currentAvatarUrls.has(url)) this.avatarFailures.delete(url);
    const seats = Array.from({ length: room.capacity }, (_, i) => {
      const seat = i + 1,
        p = room.players.find((p) => p.seat === seat);
      const avatarUrl = p?.avatarUrl ? api.assetUrl(p.avatarUrl) : "";
      return {
        seat,
        statsId: p?.statsId || "",
        name: p ? p.name : "空位",
        avatarUrl,
        avatarInitial: p ? Array.from(p.name || "友")[0] : "+",
        avatarFailed: this.avatarFailures.has(avatarUrl),
        occupied: !!p,
        alive: p?.alive !== false,
        ready: !!p?.ready,
        mine: seat === room.me.seat,
        host: !!p?.isHost,
        inTeam: room.team.includes(seat),
        selected: selected.includes(seat),
      };
    });
    let history = room.history.map(
      (h, i) =>
        toolHistory(h, i) || {
          key: i,
          questResult:
            h.kind === "quest" ? (h.success ? "success" : "failure") : "",
          text:
            h.kind === "team"
              ? `第${h.round}轮 · ${h.leader}号组队 ${h.team.join("、")}：${h.approved ? "通过" : "否决"}`
              : h.kind === "quest"
                ? "任务结算"
                : "最终行动",
          detail:
            h.kind === "team"
              ? voteSummary(h.votes)
              : h.kind === "quest"
                ? `第${h.round}轮 · ${h.success ? "任务成功" : "任务失败"} · ${h.fails}张失败`
                : `最终目标 ${h.target}号 · ${h.hit ? "命中梅林" : "未命中梅林"}`,
        },
    );
    history.forEach((entry, i) => {
      const source = room.history[i];
      entry.category = publicHistory.category(source);
      entry.recordLabel = `记录 ${i + 1}`;
      const time = source.startedAt ? new Date(source.startedAt) : null;
      entry.timeLabel = time && !Number.isNaN(time.getTime()) ? `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}` : "";
      entry.resultTone = entry.questResult || (["toolVote", "team"].includes(source.kind) ? (source.approved ? "success" : "failure") : "");
      if (source.kind === "skillResult" && Array.isArray(source.eliminated) && Array.isArray(source.redrawn) && Array.isArray(source.restored) && Array.isArray(source.out)) {
        entry.historyText = "技能结算";
        entry.historyNote = source.text.includes("提前截止") ? "提前截止" : "";
        entry.resultRows = [["最终仍出局", source.out], ["本轮出局", source.eliminated], ["抽牌复活", source.redrawn], ["原牌复活", source.restored]]
          .filter(function (row, index) { return (index !== 0 && index !== 3) || row[1].length > 0; })
          .map(function (row) { return { label: row[0], value: row[1].length ? row[1].join("、") + " 号" : "无", final: row[0] === "最终仍出局" }; });
        entry.detail = entry.resultRows.map(function (row) { return row.label + "：" + row.value; }).join("；");
      }
      entry.latestDetail = entry.inspectionLabel || (entry.voteGroups ? voteSummary(source.votes) : entry.detail);
      entry.resultTeam = entry.voteGroups ? entry.teamLabel : "";
      entry.thresholdLabel = source.threshold ? `至少 ${source.threshold} 张失败票才失败` : "";
    });
    history = history.filter(entry => !(room.history[entry.key].kind === "variant" && /^进入第\d+轮$/.test(entry.text)));
    const historyUpdate = publicHistory.sync(this.data, history, room);
    const honors = honorPresentation.present(room.honors, api.assetUrl, this.honorAvatarFailures || new Set());
    const honorState = honorPresentation.sync(this.data, honors, this.data.historyOpen || this.data.playerCard || this.data.resultDialog || !this.foreground);
    const actionEntryLabel = ({ identity: "查看身份", teamVote: "参与表决", quest: "提交任务牌" })[room.phase] || "完成本轮操作";
    this.updateChangedData({
      ...privacyUpdate, honors, ...honorState,
      ...(stageChanged ? { resultDialog: false } : {}),
      ...(this.data.resultDialog && !stageChanged ? resultFlow({ ...this.data, room }) : {}),
      actionEntryLabel,
      seatsExpanded: room.phase !== "lobby" && this.data.room?.code === room.code ? this.data.seatsExpanded : true,
      seatOccupiedCount: seats.filter(s => s.occupied).length,
      seatReadyCount: seats.filter(s => s.occupied && s.ready).length,
      operationProgressExpanded: !!room.operationProgress && this.data.room?.code === room.code && this.data.room?.stage === room.stage && this.data.operationProgressExpanded,
      ...historyUpdate,
      questTimeline: history.filter(h => h.questResult).map((h, i) => ({ ...h, number: i + 1 })),
      notice:
        this.data.notice === "请求较多，冷却后会自动刷新"
          ? ""
          : this.data.notice,
      room,
      roomRoleGroups: roomSheet.presentRoleGroups(room.roleConfiguration),
      canStart:
        room.players.length === room.capacity &&
        room.players.every((p) => p.ready),
      startHint:
        room.players.length < room.capacity
          ? `还差 ${room.capacity - room.players.length} 人入座 · ${room.players.filter((p) => !p.ready).length} 人未准备`
          : room.players.some((p) => !p.ready)
            ? `还差 ${room.players.filter((p) => !p.ready).length} 人准备`
            : "全员已准备，可以发放身份",
      canSettle:
        !!room.operationProgress &&
        room.operationProgress.total > 0 &&
        room.operationProgress.completed === room.operationProgress.total,
      settleHint: room.operationProgress
        ? room.operationProgress.completed < room.operationProgress.total
          ? `还差 ${room.operationProgress.total - room.operationProgress.completed} 人提交`
          : room.flexible ? "提交已收齐，正在同步结果" : "参与者已全部提交，可以结算"
        : "正在确认操作进度",
      seats,
      history,
      latestResult: history.filter((entry) =>
        ["toolVote", "toolQuest", "skillResult", "toolReverse", "toolKnife", "toolOffline", "toolCanceled", "team", "quest", "assassination"].includes(room.history[entry.key].kind) ||
        (room.history[entry.key].kind === "variant" && (room.history[entry.key].number || room.history[entry.key].resultType === "conversion" || /^本轮(?:阵营转换|不转换)$/.test(room.history[entry.key].text)))
      ).pop() || null,
      questSummary: {
        total: history.filter((h) => h.questResult).length,
        success: history.filter((h) => h.questResult === "success").length,
        failure: history.filter((h) => h.questResult === "failure").length,
      },
      roomBoards: this.data.boards.filter(
        (b) => b.available && b.counts.includes(room.capacity),
      ),
      roomBoardIndex: Math.max(
        0,
        this.data.boards
          .filter((b) => b.available && b.counts.includes(room.capacity))
          .findIndex((b) => b.id === room.board),
      ),
      roomCapacities: this.data.capacities.filter((n) =>
        room.players.every((p) => p.seat <= n),
      ),
      roomCapacityIndex: this.data.capacities
        .filter((n) => room.players.every((p) => p.seat <= n))
        .indexOf(room.capacity),
      teamText: room.team.join("、") || "尚未选择",
      error: "",
      network: true,
      serverConnected: true,
      needsLogin: false,
    });
    this.prepareRoomShare();
    if (
      (!room.needsSubmission || room.me.submitted) &&
      (this.data.actionDialog || this.data.actionLoading)
    )
      this.closeAction();
    if (
      room.me.identityChanged &&
      !this.data.showRoomSettings &&
      this.foreground &&
      !this.data.identityChange
    )
      await this.showIdentityChange();
    if (
      room.me.fairyResultPending &&
      !room.me.identityChanged &&
      this.foreground &&
      !this.data.fairyResult
    )
      await this.showFairyResult();
    if (this.showDealtIdentity()) return;
    this.showIdentityHintWhenVisible();
    if (
      !room.me.identityChanged &&
      !room.me.fairyResultPending &&
      room.needsSubmission &&
      !room.me.submitted &&
      this.foreground &&
      this.promptedActionStage !== room.stage &&
      !this.data.actionLoading &&
      !this.data.toolType &&
      !this.data.showRoomRules &&
      !this.data.showRoomSettings
    )
      await this.openAction();
  },
  clearRoom() {
    clearTimeout(this.timer);
    this.shareCover = null;
    this.avatarFailures = new Set();
    this.refreshSequence = (this.refreshSequence || 0) + 1;
    this.mask();
    this.roomCode = null;
    wx.removeStorageSync("roomCode");
    this.setData({
      room: null,
      resultDialog: false, statsOpen: false, stats: null,
      toolType: "",
      toolSeats: [],
      seats: [],
      seatOccupiedCount: 0,
      seatReadyCount: 0,
      history: [],
      latestResult: null,
      selected: [],
      code: "",
      error: "",
      entryMode: "join",
      showRoomRules: false,
      showRoomSettings: false,
    });
  },
  seatAvatarError(e) {
    const { seat, url } = e.currentTarget.dataset;
    if (!this.alive || !url || !this.data.seats.some(s => s.seat === Number(seat) && s.avatarUrl === url)) return;
    if (!this.avatarFailures) this.avatarFailures = new Set();
    this.avatarFailures.add(url);
    this.setData({ seats: this.data.seats.map(s => s.avatarUrl === url ? { ...s, avatarFailed: true } : s) });
  },
  filterRooms(e) {
    const filter = e.currentTarget.dataset.filter;
    if (!this.data.roomFilters.some(f => f.id === filter)) return;
    this.dismissRoomSwipe();
    this.setData({ roomListFilter: filter, historyExpanded: false,
      ...roomList.present(this.data.memberRooms, filter, this.roomsServerTime || Date.now()) });
  },
  toggleRoomHistory() {
    if (this.data.busy || this.pending || this.data.loading || this.data.roomsRefreshing) return;
    this.dismissRoomSwipe();
    this.setData({ historyExpanded: !this.data.historyExpanded });
  },
  async refreshRooms() {
    if (this.data.busy || this.pending || this.data.loading || this.data.roomsRefreshing) return;
    this.dismissRoomSwipe();
    this.setData({ roomsRefreshing: true });
    try {
      if (this.data.isLobby) await this.refreshLobby();
      else await this.loadRooms();
      if (this.alive && !this.data.error && !this.data.reconnecting) wx.showToast?.({ title: "牌桌已更新", icon: "none" });
    } catch (e) { this.handleError(e); }
    finally { this.setData({ roomsRefreshing: false }); }
  },
  openRoomMenu(e) {
    if (this.data.busy || this.pending) return;
    if (this.consumeRoomSwipeTap()) return;
    this.dismissRoomSwipe();
    this.setData({ roomMenu: this.data.memberRooms.find(r => r.code === e.currentTarget.dataset.code) || null });
  },
  startRoomSwipePageTouch(e) {
    // Card touchstart bubbles here after startRoomSwipe; keep that gesture alive.
    if (e.touches?.length !== 1) return;
    this.roomSwipeTapUntil = 0;
    if (!this.roomSwipeGesture) this.dismissRoomSwipe();
  },
  tapRoomSwipePage() {
    if (!this.consumeRoomSwipeTap()) this.dismissRoomSwipe();
  },
  dismissRoomSwipe() {
    if (this.roomSwipeGesture?.axis) this.roomSwipeTapUntil = Date.now() + 400;
    this.roomSwipeGesture = null;
    if (this.data.roomSwipeCode || this.data.roomSwipeDragging)
      this.setData({ roomSwipeCode: "", roomSwipeOffset: 0, roomSwipeDragging: false });
  },
  consumeRoomSwipeTap() { return Date.now() < (this.roomSwipeTapUntil || 0); },
  startRoomSwipe(e) {
    if (this.data.busy || this.pending || this.data.loading || this.data.roomsRefreshing || this.data.enteringCode) return;
    if (e.touches?.length !== 1) return this.cancelRoomSwipe();
    const room = this.data.memberRooms.find(r => r.code === e.currentTarget.dataset.code);
    if (!room) return;
    this.roomSwipeTapUntil = 0;
    const opened = this.data.roomSwipeCode === room.code;
    if (!opened) this.dismissRoomSwipe();
    const touch = e.touches[0];
    this.roomSwipeGesture = roomSwipe.start(room, { x: touch.clientX ?? touch.pageX, y: touch.clientY ?? touch.pageY }, opened);
  },
  moveRoomSwipe(e) {
    const gesture = this.roomSwipeGesture;
    if (!gesture) return;
    if (e.touches?.length !== 1 || this.data.busy || this.pending) return this.cancelRoomSwipe();
    const touch = e.touches[0];
    roomSwipe.move(gesture, { x: touch.clientX ?? touch.pageX, y: touch.clientY ?? touch.pageY });
    if (gesture.axis === "y") {
      this.setData({ roomSwipeCode: "", roomSwipeOffset: 0, roomSwipeDragging: false });
    } else if (gesture.axis === "x") {
      this.setData({ roomSwipeCode: gesture.code, roomSwipeOffset: gesture.offset, roomSwipeDragging: true });
    }
  },
  endRoomSwipe() {
    const gesture = this.roomSwipeGesture;
    if (!gesture) return;
    this.roomSwipeGesture = null;
    if (gesture.axis) this.roomSwipeTapUntil = Date.now() + 400;
    const offset = roomSwipe.settle(gesture);
    this.setData({ roomSwipeCode: offset ? gesture.code : "", roomSwipeOffset: offset, roomSwipeDragging: false });
  },
  cancelRoomSwipe() {
    if (this.roomSwipeGesture) this.roomSwipeTapUntil = Date.now() + 400;
    this.dismissRoomSwipe();
  },
  async swipeRoomAction(e) {
    if (this.data.busy || this.pending || this.data.loading || this.data.roomsRefreshing || this.consumeRoomSwipeTap()) return;
    const { code, kind } = e.currentTarget.dataset;
    const room = this.data.memberRooms.find(r => r.code === code);
    if (!room || this.data.roomSwipeCode !== code || this.data.roomSwipeDragging) return;
    this.dismissRoomSwipe();
    if (kind === "hide") return this.removeRoomRecord(code);
    if (kind === "delete" && roomSwipe.canDissolve(room)) return this.deleteRoom(e, true);
  },
  startRoomSwipeAction() { this.roomSwipeTapUntil = 0; },
  closeRoomMenu() { if (!this.data.busy && !this.pending) this.setData({ roomMenu: null, noteRoom: null }); },
  inputRoomNote(e) { this.setData({ roomNoteDraft: e.detail.value }); },
  saveRoomNote() {
    if (!this.data.noteRoom) return;
    return this.mutate("/api/me/rooms/" + this.data.noteRoom.code, { action: "note", note: this.data.roomNoteDraft }, "entryNote");
  },
  async removeRoomRecord(code) {
    if (this.data.busy || this.pending) return;
    this.setData({ busy: true, error: "" });
    try {
      if (!(await this.confirm(
        "移除这条房间记录？",
        "仅从你的列表中移除，房间、座位和战绩都会保留。",
        "移除记录",
        { contextLabel: "房间", contextValue: code, contextMeta: this.data.memberRooms.find(room => room.code === code)?.statusLabel || "" },
      ))) return;
      if (!this.alive || !this.foreground) return;
      this.setData({ busy: false });
      await this.mutate("/api/me/rooms/" + code, { action: "hide" }, "entryHide");
    } finally {
      this.setData({ busy: false });
    }
  },
  async roomMenuAction(e) {
    const room = this.data.roomMenu, kind = e.currentTarget.dataset.kind;
    if (!room || this.data.busy || this.pending) return;
    this.setData({ roomMenu: null });
    if (kind === "note") return this.setData({ noteRoom: room, roomNoteDraft: room.note || "" });
    if (kind === "hide") return this.removeRoomRecord(room.code);
    if (kind === "delete" && room.isHost && room.available !== false)
      return this.deleteRoom({ currentTarget: { dataset: { code: room.code } } });
    if (kind === "leave" && room.canLeave) {
      if (!(await this.confirm("离开房间 " + room.code + "？", "将释放你的座位，房间和房主权限保留。"))) return;
      if (this.data.busy || this.pending) return;
      this.setData({ busy: true });
      try {
        const fresh = await api.request("/api/rooms/" + room.code);
        this.setData({ busy: false });
        await this.mutate("/api/rooms/" + room.code + "/commands", { type: "leave", stage: fresh.stage }, "leave");
      } catch (error) { this.handleError(error); }
      finally { this.setData({ busy: false }); }
    }
  },
  async deleteRoom(e, fromSwipe = false) {
    if (this.data.busy || this.pending) return;
    const code = e.currentTarget.dataset.code;
    this.setData({ busy: true, error: "" });
    try {
      const room = await api.request("/api/rooms/" + code + "/management");
      if (!room.isHost) throw new Error("只有当前房主可以删除牌桌");
      if (fromSwipe && !roomSwipe.canDissolve(room)) {
        await this.loadRooms();
        this.setData({ notice: "房间状态已更新，解散请使用房间管理" });
        return;
      }
      if (
        !(await this.confirm(
          "解散房间 " + code + "？",
          "所有玩家将退出，牌桌与对局记录将被删除且无法恢复。进行中的对局不判胜负。",
          "解散",
          { danger: true },
        ))
      )
        return;
      if (!this.alive || !this.foreground) return;
      this.setData({ busy: false });
      await this.mutate(
        "/api/rooms/" + code + "/delete",
        { stage: room.stage },
        "delete",
      );
    } catch (e) {
      if (e.status === 404) {
        await this.loadRooms();
        this.setData({ notice: "牌桌已删除或不存在" });
      } else this.handleError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async returnHome() {
    if (this.pending) {
      this.setData({ error: "仍有未确认请求，请先重试原请求" });
      return;
    }
    if (!this.data.isLobby) {
      if (this.returningHome) return;
      this.returningHome = true;
      // Do not replace the visible table with the entry form before navigating.
      // The cached lobby refreshes in onShow; this page only masks secrets.
      this.mask();
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const lobbyIndex = pages.findIndex(page => page.route === "pages/lobby/lobby" ||
        (page.route === "pages/me/me" && typeof page.switchMainTab === "function"));
      if (lobbyIndex >= 0) pages[lobbyIndex].switchMainTab?.(0);
      const finish = () => { this.returningHome = false; };
      const switchToLobby = () => switchHomeTab(0, {
        fail: () => {
          if (this.alive) this.setData({ error: "未能返回对局，请重试" });
        },
        complete: finish,
      });
      if (lobbyIndex >= 0 && lobbyIndex < pages.length - 1 && wx.navigateBack) {
        wx.navigateBack({ delta: pages.length - 1 - lobbyIndex, success: finish, fail: switchToLobby });
      } else switchToLobby();
      return;
    }
    this.clearRoom();
    this.updateChangedData({ notice: "" });
    try {
      await this.loadRooms();
    } catch (e) {
      this.handleError(e);
    }
  },
  resumePending() { if (this.data.pendingTableCode) return this.enterTable(this.data.pendingTableCode); },
  async openRoom(e) {
    if (this.consumeRoomSwipeTap()) return;
    if (this.data.roomSwipeCode) { this.dismissRoomSwipe(); return; }
    if (this.data.busy || this.pending || this.data.enteringCode || this.data.loading) return;
    const target = this.data.memberRooms.find(
      (r) => r.code === e.currentTarget.dataset.code,
    );
    if (target?.available === false) return;
    this.setData({ enteringCode: e.currentTarget.dataset.code });
    try {
      if (target?.isHost && target.seat === null && !target.isMember) {
        if (!this.data.name.trim()) {
          this.switchEntry({ currentTarget: { dataset: { mode: "join" } } });
          this.setData({
            code: target.code,
            entryMode: "join",
            entryNameError: "请填写昵称后重新入座",
          });
          return;
        }
        return await this.mutate(
          "/api/rooms/" + target.code + "/join",
          { name: this.data.name },
          "enter",
        );
      }
      return await this.mutate("/api/me/rooms/" + e.currentTarget.dataset.code, { action: "visit" }, "entryVisit");
    } finally {
      this.setData({ enteringCode: "" });
    }
  },
  inputName(e) {
    // Native blur events can fire without an edit, including on an empty field.
    if (e.detail.value === this.data.name) return;
    this.nameInputRevision = (this.nameInputRevision || 0) + 1;
    this.nameEdited = true;
    this.setData({ name: e.detail.value, entryNameError: "", entryError: "" });
  },
  inputCode(e) {
    const code = e.detail.value.replace(/\D/g, "").slice(0, 6);
    this.setData({ code, entryCodeError: "", entryError: "" });
    return code;
  },
  switchEntry(e) {
    if (this.data.busy || this.pending) return;
    this.dismissRoomSwipe();
    const mode = e.currentTarget.dataset.mode;
    if (!["join", "create"].includes(mode)) return;
    this.cancelEntryAutoFocus();
    const revision = this.entrySheetRevision = (this.entrySheetRevision || 0) + 1;
    const hadKeyboard = !!(this.data.entryFocusedField || this.data.entryKeyboardHeight);
    this.entryAutoFocusPending = mode === "join";
    this.setData({
      entryMode: mode,
      entrySheet: true,
      entryMeasuring: true,
      entryFocusedField: "",
      entryScrollTarget: "",
      entryKeyboardHeight: 0,
      entryBodyHeight: 0,
      entryNameError: "", entryCodeError: "", entryError: "",
      error: "",
      notice: "",
    }, () => {
      if (revision === this.entrySheetRevision) this.syncRoomSheetLayout("entry");
    });
    if (hadKeyboard) wx.hideKeyboard?.();
  },
  cancelEntryAutoFocus() {
    clearTimeout(this.entryFocusTimer);
    this.entryFocusTimer = null;
    this.entryAutoFocusPending = false;
  },
  focusEntryAfterOpen(revision) {
    if (!this.entryAutoFocusPending || revision !== this.entrySheetRevision || !this.alive || !this.foreground || !this.data.entrySheet) return;
    clearTimeout(this.entryFocusTimer);
    this.entryFocusTimer = setTimeout(() => {
      this.entryFocusTimer = null;
      if (!this.entryAutoFocusPending || revision !== this.entrySheetRevision) return;
      this.entryAutoFocusPending = false;
      if (!this.alive || !this.foreground || !this.data.entrySheet || this.data.entryMode !== "join" ||
          this.data.entryFocusedField || this.data.busy || this.pending || this.data.hasPendingRequest) return;
      this.setData({ entryFocusedField: this.data.nicknameSetup || !this.data.name.trim() ? "nickname" : "code" });
    }, ENTRY_FOCUS_DELAY);
  },
  resetEntryFocus() {
    this.cancelEntryAutoFocus();
    const revision = this.entrySheetRevision = (this.entrySheetRevision || 0) + 1;
    if (this.data.entryFocusedField || this.data.entryKeyboardHeight) {
      this.setData({ entryFocusedField: "", entryKeyboardHeight: 0, entryScrollTarget: "" }, () => {
        if (revision === this.entrySheetRevision) this.syncRoomSheetLayout("entry");
      });
      // The submit button also calls this: native form values can wait for input blur.
      wx.hideKeyboard?.();
    }
  },
  closeEntry() {
    if (this.data.busy || this.pending) return;
    this.setData({ entrySheet: false });
    this.resetEntryFocus();
  },
  editEntryName() {
    if (!this.data.entrySheet || !this.foreground || this.data.busy || this.pending || this.data.hasPendingRequest) return;
    this.cancelEntryAutoFocus();
    this.setData({ entryFocusedField: "nickname", entryScrollTarget: "entry-name-block" });
  },
  editEntryCode() {
    if (!this.data.entrySheet || this.data.entryMode !== "join" || !this.foreground || this.data.busy || this.pending || this.data.hasPendingRequest) return;
    this.cancelEntryAutoFocus();
    this.setData({ entryFocusedField: "code", entryScrollTarget: "entry-code-block" });
  },
  entryInputFocus(e) {
    if (!this.data.entrySheet || !this.foreground) return;
    this.cancelEntryAutoFocus();
    const field = e.currentTarget.dataset.field;
    if (this.data.entryFocusedField !== field)
      this.setData({ entryFocusedField: field, entryScrollTarget: field === "code" ? "entry-code-block" : "entry-name-block" });
    this.entryKeyboardChange(e);
  },
  entryInputBlur(e) {
    if (e.currentTarget.dataset.field === "nickname") this.inputName(e);
    if (this.data.entryFocusedField === e.currentTarget.dataset.field) this.setData({ entryFocusedField: "" });
  },
  entryKeyboardChange(e) {
    if (!this.data.entrySheet || !this.foreground || !Number.isFinite(e.detail.height)) return;
    const height = Math.max(0, e.detail.height);
    if (height === this.data.entryKeyboardHeight) return;
    const revision = this.entrySheetRevision;
    this.setData({ entryKeyboardHeight: height, entryScrollTarget: "" }, () => {
      if (!this.alive || !this.foreground || !this.data.entrySheet || revision !== this.entrySheetRevision || height !== this.data.entryKeyboardHeight) return;
      if (this.data.entrySheet && this.foreground && this.data.entryFocusedField)
        this.setData({ entryScrollTarget: this.data.entryFocusedField === "code" ? "entry-code-block" : "entry-name-block" });
      this.syncRoomSheetLayout("entry");
    });
  },
  entryAvatarError() { this.setData({ entryAvatarFailed: true }); },
  syncRoomSheetLayout(kind) {
    const entry = kind === "entry", openKey = entry ? "entrySheet" : "showRoomRules";
    if (!this.data[openKey] || !this.foreground) return;
    this.sheetLayoutRevisions = this.sheetLayoutRevisions || {};
    const revision = this.sheetLayoutRevisions[kind] = (this.sheetLayoutRevisions[kind] || 0) + 1;
    const entryRevision = this.entrySheetRevision;
    const applyHeight = height => {
      if (!this.alive || !this.foreground || !this.data[openKey] || revision !== this.sheetLayoutRevisions[kind] || entry && entryRevision !== this.entrySheetRevision) return;
      const patch = {}, key = entry ? "entryBodyHeight" : "roomRulesBodyHeight";
      if (height !== null && this.data[key] !== height) patch[key] = height;
      const measuringKey = entry ? "entryMeasuring" : "roomRulesMeasuring";
      const opening = this.data[measuringKey];
      if (opening) patch[measuringKey] = false;
      const rendered = () => { if (entry && opening) this.focusEntryAfterOpen(entryRevision); };
      if (Object.keys(patch).length) this.setData(patch, rendered);
      else rendered();
    };
    if (!wx.createSelectorQuery) { applyHeight(null); return; }
    const run = () => {
      if (!this.alive || !this.foreground || !this.data[openKey] || revision !== this.sheetLayoutRevisions[kind] || entry && entryRevision !== this.entrySheetRevision) return;
      const query = wx.createSelectorQuery();
      const prefix = entry ? ".entry" : ".room-rules";
      for (const suffix of ["-backdrop", "-sheet-top", "-sheet-fields", "-sheet-footer"]) query.select(prefix + suffix).boundingClientRect();
      query.exec(rects => {
        applyHeight(roomSheet.fitBody(rects, entry ? this.data.entryKeyboardHeight : 0));
      });
    };
    if (wx.nextTick) wx.nextTick(run); else run();
  },
  processSheetKey() {
    const d = this.data;
    if (d.error) return "";
    const stage = d.room?.code + ":" + d.room?.stage;
    if (d.identityHistoryOpen && d.revealed) return stage + ":history:" + d.identityHistoryExpandedId;
    if (d.identityChange) return stage + ":identity:" + d.identityChange.identityRevision + ":" + d.identityChangeRevealed;
    if (d.fairyResult) return stage + ":fairy:" + d.fairyResult.revision + ":" + d.fairyResultRevealed;
    if (d.actionDialog && d.room?.needsSubmission && !d.room.me.submitted)
      return stage + ":action:" + d.skillTargetMode + ":" + (d.actionChoices?.length || 0);
    if (d.toolType && d.room?.canUseTools) return stage + ":tool:" + d.toolType;
    return "";
  },
  setProcessData(values, callback) {
    this.setData(values, () => { if (callback) callback(); this.syncProcessSheetLayout(); });
  },
  syncProcessSheetLayout() {
    const key = this.processSheetKey();
    if (!key || !this.alive || !this.foreground || !wx.createSelectorQuery) return;
    const revision = this.processLayoutRevision = (this.processLayoutRevision || 0) + 1;
    const run = () => {
      if (!this.alive || !this.foreground || key !== this.processSheetKey()) return;
      const query = wx.createSelectorQuery().in(this);
      for (const selector of [".process-backdrop", ".process-sheet-top", ".process-sheet-fields", ".process-sheet-footer"]) query.select(selector).boundingClientRect();
      query.exec(rects => {
        if (!this.alive || !this.foreground || revision !== this.processLayoutRevision || key !== this.processSheetKey()) return;
        const height = roomSheet.fitBody(rects);
        if (height !== null && height !== this.data.processBodyHeight) this.setData({ processBodyHeight: height });
      });
    };
    if (wx.nextTick) wx.nextTick(run); else run();
  },
  pasteRoomCode() {
    if (this.data.busy || this.pending || !this.data.entrySheet) return;
    this.cancelEntryAutoFocus();
    const revision = this.entrySheetRevision;
    wx.getClipboardData?.({
      success: ({ data }) => {
        if (!this.alive || !this.foreground || !this.data.entrySheet || revision !== this.entrySheetRevision || this.data.busy || this.pending) return;
        const code = String(data || "").trim();
        if (!/^\d{6}$/.test(code)) return this.setData({ entryCodeError: "请复制完整的 6 位数字房间码" });
        this.setData({ code, entryCodeError: "", entryError: "", entryFocusedField: "code" });
      },
      fail: () => {
        if (this.alive && this.foreground && this.data.entrySheet && revision === this.entrySheetRevision && !this.data.busy && !this.pending)
          this.setData({ entryCodeError: "未能读取剪贴板，请手动输入房间码" });
      },
    });
  },
  copyListedRoom(e) {
    if (this.consumeRoomSwipeTap()) return;
    if (this.data.roomSwipeCode) { this.dismissRoomSwipe(); return; }
    const code = e.currentTarget.dataset.code;
    if (this.data.memberRooms.some(room => room.code === code)) wx.setClipboardData?.({ data: code });
  },
  toggleSeats() {
    if (!this.data.room || this.data.room.phase === "lobby") return;
    this.setData({ seatsExpanded: !this.data.seatsExpanded });
  },
  toggleOperationProgress() {
    if (!this.data.room?.canUseTools || !this.data.room.operationProgress) return;
    this.setData({ operationProgressExpanded: !this.data.operationProgressExpanded });
  },
  openHistory() {
    if (!this.data.room || this.data.room.phase === "lobby") return;
    this.openHistoryRecord(null);
  },
  openHistoryRecord(key) {
    this.closePlayerCard();
    const room = this.data.room;
    this.setData({ ...publicHistory.open(this.data, key), identityHintVisible: false }, () => {
      if (!this.data.historyOpen || this.data.room?.code !== room?.code || this.data.room?.game !== room?.game) return;
      this.setData({ historyScrollTarget: key === null ? "public-history-top" : `history-record-${key}` });
    });
  },
  closeHistory() {
    this.setData({ historyOpen: false, historyScrollTarget: "", focusedHistoryKey: null, visibleHistory: [] });
  },
  showNewHistory() {
    this.openHistoryRecord(null);
  },
  toggleHistoryRow(e) {
    this.setData(publicHistory.toggleRow(this.data, Number(e.currentTarget.dataset.key)));
  },
  filterHistory(e) {
    this.setData(publicHistory.filter(this.data, e.currentTarget.dataset.filter), () => {
      this.setData({ historyScrollTarget: "public-history-top" });
    });
  },
  showLatestRecord() {
    const entry = this.data.latestResult;
    if (!entry) return;
    this.openHistoryRecord(entry.key);
  },
  showQuestRecord(e) {
    const entry = this.data.questTimeline.find(h => h.key === Number(e.currentTarget.dataset.key));
    if (!entry) return;
    dialog.show({ title: `第 ${entry.number} 次任务 · ${entry.text}`, content: [entry.detail, entry.thresholdLabel].filter(Boolean).join("\n"), showCancel: false });
  },
  openHelp() {
    wx.navigateTo({ url: "/pages/help/help" });
  },
  openRoomRules() {
    this.sheetLayoutRevisions = this.sheetLayoutRevisions || {};
    const revision = this.sheetLayoutRevisions.rules = (this.sheetLayoutRevisions.rules || 0) + 1;
    this.setData({ showRoomRules: true, roomRulesMeasuring: true, roomRulesBodyHeight: 0,
      roomRoleGroups: roomSheet.presentRoleGroups(this.data.room?.roleConfiguration) }, () => {
      if (revision === this.sheetLayoutRevisions.rules) this.syncRoomSheetLayout("rules");
    });
  },
  openBoardDetails() {
    this.setData({ showRoomRules: false });
    const room = this.data.room;
    wx.navigateTo({
      url:
        "/pages/board-details/board-details?board=" +
        encodeURIComponent(room ? room.board : this.data.boardId) +
        "&capacity=" +
        (room ? room.capacity : this.data.capacity) +
        "&from=" + (room ? "room" : "create"),
    });
  },
  closeRoomRules() {
    this.setData({ showRoomRules: false });
  },
  toggleRoomSettings() {
    if (!this.data.room?.me.isHost || this.data.busy) return;
    this.mask();
    wx.navigateTo({
      url: "/pages/settings/settings?code=" + this.data.room.code,
    });
  },
  selectCapacity(capacity) {
    const availableBoards = this.data.boards.filter(
      (b) => b.available && b.counts.includes(capacity),
    ).map(b => ({
      ...b,
      shortName: (b.namesByCapacity?.[capacity] || b.name).replace(/^阿瓦隆\s*·\s*/, "").replace(/（\d+人）$/, ""),
      entryHint: b.id.startsWith("knights") ? "技能与 B 牌" : ({
        "classic-court": capacity === 12 ? "双奥伯伦" : "经典阵容",
        "classic-11": "逆仆指认",
        lancelot: "红蓝兰斯洛特",
        "shadow-assist": "红蓝内奸",
        chaos: "术士与盗贼",
      })[b.id] || "",
    }));
    const b =
      availableBoards.find((b) => b.id === this.data.boardId) ||
      availableBoards[0];
    if (!b) return;
    this.setData({
      capacity,
      capacityIndex: this.data.capacities.indexOf(capacity),
      availableBoards,
      boardId: b.id,
      boardName: b.namesByCapacity?.[capacity] || b.name,
      boardRoleConfiguration: roomSheet.presentRoleGroups(b.roleConfigurations?.[capacity]),
      boardIndex: availableBoards.indexOf(b),
      boardAssisted: b.mode === "assisted",
      }, () => this.syncRoomSheetLayout("entry"));
  },
  pickBoard(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget?.dataset?.index ?? e.detail.value);
    const b = this.data.availableBoards[index];
    if (!b) return;
    this.setData({
      boardId: b.id,
      boardName: b.namesByCapacity?.[this.data.capacity] || b.name,
      boardRoleConfiguration: roomSheet.presentRoleGroups(b.roleConfigurations?.[this.data.capacity]),
      boardIndex: index,
      boardAssisted: b.mode === "assisted",
      }, () => this.syncRoomSheetLayout("entry"));
  },
  pickCapacity(e) {
    if (this.data.busy) return;
    const capacity =
      Number(e.currentTarget?.dataset?.capacity) ||
      this.data.capacities[Number(e.detail.value)];
    this.selectCapacity(capacity);
  },
  async mutate(path, data, after) {
    if (this.data.busy) return;
    const held = typeof getApp === "function" && getApp().pendingTableRequest;
    if (held && (this.data.isLobby || held.code !== this.roomCode || !this.pending)) {
      this.setData({ error: "牌桌中还有未确认的操作，请先返回牌桌重试" });
      return;
    }
    if (this.pending) {
      if (this.data.reconnecting) return;
      this.setData({ error: "上次请求尚未确认，请先重试原请求" });
      return;
    }
    this.refreshSequence = (this.refreshSequence || 0) + 1;
    this.pending = { path, data, id: api.requestId(), after };
    if (!this.data.isLobby && typeof getApp === "function") getApp().pendingTableRequest = { ...this.pending, code: this.roomCode || this.inviteCode, instance: this.data.room?.createdAt ?? this.data.invitation?.createdAt };
    // Only non-secret create/join requests survive an application restart.
    if (after === "enter") wx.setStorageSync("pendingEntry", this.pending);
    await this.executePending();
  },
  async executePending() {
    const pending = this.pending;
    if (!pending || this.data.busy) return;
    this.setData({ busy: true, busyAction: pending.after === "enter" ? "enter" : pending.data.type || pending.after, error: "", notice: "" });
    try {
      await api.login();
      const result = await api.request(
        pending.path,
        "POST",
        pending.data,
        pending.id,
      );
      this.pending = null;
      if (!this.data.isLobby && typeof getApp === "function") getApp().pendingTableRequest = null;
      this.connectionRecovered();
      this.setData({
        serverConnected: true,
        hasPendingRequest: false,
        recoverableError: false,
      });
      if (pending.after === "enter") wx.removeStorageSync("pendingEntry");
      this.mask();
      if (pending.after === "enter" || pending.after === "entryVisit") {
        if (result.profile) {
          this.lobbyRefreshSequence = (this.lobbyRefreshSequence || 0) + 1;
          this.lobbyProfileNickname = result.profile.nickname;
          this.setData({ nicknameSetup: !result.profile.nicknameConfirmed, nicknameVersion: result.profile.version });
        }
        this.roomCode = result.code;
        wx.setStorageSync("roomCode", result.code);
        wx.setStorageSync("nickname", pending.data.name || this.data.name);
        if (this.data.isLobby) {
          this.nameEdited = false;
          await this.enterTable(result.code);
          await this.loadRooms();
          return;
        }
      }
      if (["entryHide", "entryRestore", "entryNote", "entryCleanup"].includes(pending.after)) {
        this.setData({ roomMenu: null, noteRoom: null,
          notice: pending.after === "entryCleanup" ? roomList.cleanupNotice(result.removed) : pending.after === "entryHide" ? "" : pending.after === "entryNote" ? "个人备注已保存" : "已恢复牌桌记录" });
        await this.loadRooms();
        if (pending.after === "entryHide") this.showRoomFeedback("已移除");
      } else if (pending.after === "leave" || pending.after === "delete") {
        this.clearRoom();
        this.setData({
          notice: pending.after === "delete" ? "" : "已离开房间",
        });
        await this.loadRooms();
        if (pending.after === "delete") this.showRoomFeedback("房间已解散");
      } else {
        this.setData({ notice: "" });
        await this.refresh();
        if (pending.data.type === "avoidance") this.showRoomFeedback(pending.data.role === null ? "本局不使用回避卡" : "本局回避已保存，生效后才扣卡");
        if (pending.after === "enter" && this.inviteCode && this.data.room?.phase === "lobby" && this.data.room.me.seat === null)
          this.setData({ notice: "座位已满，已以旁观者进入房间" });
      }
    } catch (e) {
      // Network/5xx uncertainty retains the exact command and idempotency key.
      if (e.status && e.status < 500 && e.status !== 401 && e.status !== 429) {
        this.pending = null;
        if (!this.data.isLobby && typeof getApp === "function") getApp().pendingTableRequest = null;
        if (pending.after === "enter") wx.removeStorageSync("pendingEntry");
      }
      this.setData({ notice: "" });
      if (pending.after === "enter" && this.inviteCode && !this.pending && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
        this.connectionRecovered();
        this.setData({ hasPendingRequest: false });
        if (e.status === 404 || e.status === 410 || /游戏已开始/.test(e.message))
          this.showInvitationError(e.status === 404 ? "该房间已解散" : e.status === 410 ? (e.message.includes("房间已失效") ? "房间已失效，无法再进入" : "该邀请已失效，请让朋友重新分享") : "本局已开始，暂时无法加入，请等待房主开启下一局", e.status !== 404 && e.status !== 410);
        else if (e.status === 409) this.showInvitationError(e.message, true);
        else this.setData({ invitationNeedsName: true, entryError: e.message, error: "" });
        return;
      }
      this.handleError(e);
      if (pending.after === "enter" && this.data.entrySheet && !this.pending && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
        this.setData({ error: "", entryError: e.message });
      }
      if (e.status === 409 && pending.after === "enter" && this.data.isLobby) await this.refreshLobby({ preserveName: true });
    } finally {
      this.setData({ busy: false, busyAction: "" });
      this.schedule();
    }
  },
  async retry() {
    this.setData({ error: "", recoverableError: false });
    if (this.pending) return this.executePending();
    if (this.data.needsLogin || !this.data.boards.length)
      return this.bootstrap();
    try {
      this.setData({ loading: true });
      if (this.roomCode) await this.refresh();
      else if (this.data.isLobby) await this.refreshLobby();
      else if (this.inviteCode) await this.openInvitation();
      else await this.loadRooms();
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  submitEntry(e) {
    if (this.data.busy || this.data.loading || this.pending || this.data.hasPendingRequest) return;
    // Read the native form value: nickname autofill/security checks may skip input events.
    this.nameEdited = true;
    this.nameInputRevision = (this.nameInputRevision || 0) + 1;
    const values = e.detail?.value || {};
    this.setData({ name: (Object.prototype.hasOwnProperty.call(values, "nickname") ? values.nickname : this.data.name).trim() });
    if (this.data.entryMode === "join") {
      this.setData({ code: (Object.prototype.hasOwnProperty.call(values, "code") ? values.code : this.data.code).trim() });
    }
    if (this.data.entrySheet) {
      const entryNameError = this.data.name ? "" : "请填写昵称";
      const entryCodeError = this.data.entryMode === "join" && !/^\d{6}$/.test(this.data.code) ? "请输入完整的 6 位数字房间码" : "";
      this.setData({ entryNameError, entryCodeError, entryError: "" });
      if (entryNameError || entryCodeError) {
        this.setData({ entryFocusedField: entryNameError ? "nickname" : "code" });
        return;
      }
    }
    if (this.data.entryMode === "join") {
      return this.join();
    }
    return this.create();
  },
  create() {
    if (!this.data.name.trim()) return this.setData({ error: "请填写昵称" });
    this.mutate(
      "/api/rooms",
      {
        name: this.data.name,
        board: this.data.boardId,
        capacity: this.data.capacity,
        ...(this.data.nicknameSetup ? { confirmNickname: true, profileVersion: this.data.nicknameVersion } : {}),
      },
      "enter",
    );
  },
  join() {
    if (!this.data.name.trim() || !/^\d{6}$/.test(this.data.code))
      return this.setData({ error: "请填写昵称和6位房间码" });
    return this.mutate(
      "/api/rooms/" + this.data.code + "/join",
      { name: this.data.name, ...(this.data.nicknameSetup ? { confirmNickname: true, profileVersion: this.data.nicknameVersion } : {}),
        ...(this.data.invitation ? { createdAt: this.data.invitation.createdAt } : {}) },
      "enter",
    );
  },
  cmd(type, extra = {}, after) {
    const r = this.data.room;
    if (r)
      return this.mutate(
        "/api/rooms/" + r.code + "/commands",
        { type, stage: r.stage, ...extra },
        after,
      );
  },
  async seat(e) {
    const seat = Number(e.currentTarget.dataset.seat),
      r = this.data.room;
    if (!r || this.data.busy || this.data.hasPendingRequest || !this.data.network) return;
    if (r.phase === "lobby") {
      if (seat === r.me.seat) {
        return this.confirmCommand("站起围观？", "站起后释放座位并取消准备，你仍留在房间，可点击空位重新坐下。", "stand");
      }
      if (!this.data.seats.find((s) => s.seat === seat)?.occupied)
        return this.cmd("seat", { seat });
    }
    return this.openPlayerCard(seat);
  },
  toggleProposalSeat(e) {
    const seat = Number(e.currentTarget.dataset.seat), r = this.data.room;
    if (r?.phase === "proposal" && !r.flexible && r.leader === r.me.seat && r.players.some(p => p.seat === seat) && !this.data.busy && !this.data.hasPendingRequest && this.data.network) {
      const selected = this.data.selected.includes(seat)
        ? this.data.selected.filter((s) => s !== seat)
        : [...this.data.selected, seat];
      this.setData({
        selected,
        seats: this.data.seats.map((s) => ({
          ...s,
          selected: selected.includes(s.seat),
        })),
      });
    }
  },
  ...playerCardMethods(api),
  async openPlayerCard(seat) {
    const room = this.data.room, player = room?.players.find(p => p.seat === seat);
    if (!player || !this.foreground || this.data.actionDialog || this.data.dealtIdentityDialog || this.data.identityChange || this.data.fairyResult || this.data.identityHistoryOpen || this.data.historyOpen) return;
    const sourceAvatarUrl = player.avatarUrl;
    const card = { id: player.statsId, seat, name: player.name, isHost: player.isHost, sourceAvatarUrl,
      avatarUrl: sourceAvatarUrl ? api.assetUrl(sourceAvatarUrl) : "", initial: Array.from(player.name || "友")[0], avatarFailed: false };
    return this.loadPlayerCard(card, `/api/rooms/${room.code}/players/${player.statsId}/stats`,
      () => this.data.room?.code === room.code && this.data.room?.stage === room.stage);
  },
  retryPlayerCard() { if (this.data.playerCard && !this.data.playerCardLoading) return this.openPlayerCard(this.data.playerCard.seat); },
  configureBoard(e) {
    const b = this.data.roomBoards[Number(e.detail.value)];
    if (b)
      this.cmd("configure", { board: b.id, capacity: this.data.room.capacity });
  },
  configureCapacity(e) {
    const capacity = this.data.roomCapacities[Number(e.detail.value)];
    const boards = this.data.boards.filter(
      (b) => b.available && b.counts.includes(capacity),
    );
    const b = boards.find((b) => b.id === this.data.room.board) || boards[0];
    if (b) this.cmd("configure", { board: b.id, capacity });
  },
  ready() {
    this.cmd("ready", { ready: !this.data.room.me.ready });
  },
  async openAvoidance() {
    const room = this.data.room;
    if (!room || room.phase !== "lobby" || room.me.seat === null || this.data.busy || this.pending || !this.data.network) return;
    this.mask();
    const generation = this.generation;
    this.setData({ avoidanceOpen: true, avoidanceLoading: true, avoidance: { balance: room.me.avoidance?.balance || 0 } });
    try {
      const value = await api.request("/api/rooms/" + room.code + "/avoidance");
      if (!this.alive || !this.foreground || generation !== this.generation || !this.data.avoidanceOpen || this.data.room?.code !== value.code || this.data.room.stage !== value.stage || value.phase !== "lobby") return;
      this.setData({ avoidance: value, avoidanceLoading: false, avoidanceDraft: value.selected || "",
        avoidanceDraftName: value.options.find(o => o.id === value.selected)?.name || "",
        avoidanceGroups: avoidancePresentation.groups(value.options, value.selected) });
    } catch (error) { if (generation === this.generation && this.foreground) { this.closeAvoidance(); this.handleError(error); } }
  },
  closeAvoidance() { this.generation++; this.setData({ avoidanceOpen: false, avoidanceLoading: false, avoidance: null, avoidanceGroups: [], avoidanceDraft: "", avoidanceDraftName: "" }); },
  chooseAvoidance(e) {
    const value = this.data.avoidance, id = e.currentTarget.dataset.id;
    if (!value?.editable || value.balance < 1 || this.data.busy || this.pending) return;
    const option = value.options.find(o => o.id === id); if (!option) return;
    this.setData({ avoidanceDraft: id, avoidanceDraftName: option.name, avoidanceGroups: avoidancePresentation.groups(value.options, id) });
  },
  saveAvoidance() { if (this.data.avoidance?.editable && this.data.avoidanceDraft && !this.data.avoidanceLoading) return this.cmd("avoidance", { role: this.data.avoidanceDraft }, "avoidance"); },
  cancelAvoidance() { if (this.data.avoidance?.editable) return this.cmd("avoidance", { role: null }, "avoidance"); },
  async confirm(title, content, confirmText = "确定", options = {}) {
    if (!this.alive || !this.foreground) return false;
    return new Promise((resolve) =>
      dialog.show({
        title,
        content,
        confirmText,
        ...options,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    );
  },
  async confirmCommand(title, content, type, extra = {}) {
    const stage = this.data.room?.stage;
    if (!(await this.confirm(title, content, "确定", { danger: ["terminate", "cancelActivity"].includes(type) }))) return;
    if (!this.foreground || this.data.room?.stage !== stage) {
      this.setData({ error: "阶段已变化，请查看当前阶段后重新操作" });
      return;
    }
    this.cmd(type, extra);
  },
  async toggleSkillVisibility() {
    const visible = !this.data.room.showSkillDetails;
    if (visible)
      return this.confirmCommand(
        "公开技能过程？",
        "所有玩家将看到已结算技能的出手人、目标及过程；新身份牌面不公开。",
        "setSkillVisibility",
        { visible },
      );
    this.cmd("setSkillVisibility", { visible });
  },
  openTool(e) {
    const room = this.data.room;
    if (!room?.canUseTools || this.data.busy || this.pending) return;
    const toolType = e.currentTarget.dataset.kind;
    const toolSeats = ["vote", "quest"].includes(toolType)
      ? [...room.team]
      : [];
    this.toolStage = room.stage;
    this.setProcessData({
      toolType,
      toolTitle:
        {
          skills: "使用技能",
          conversion: "身份转换",
          fairy: "仙女查验",
        }[toolType] || "",
      toolDescription:
        {
          skills:
            "全员同时提交。再次发起会进入下一轮，新身份技能随之生效。",
          conversion: "抽取一张转换牌，按牌面决定兰斯洛特是否交换阵营。",
          fairy: "仅仙女持有者选择目标，私密查验并传递仙女。",
        }[toolType] || "",
      toolSeats,
      toolThreshold: 1,
      toolPlayers: room.players
        .filter((p) => toolType === "assassination" || p.alive !== false)
        .map((p) => ({
          ...p,
          selected: toolSeats.includes(p.seat),
        })),
    });
  },
  closeTool() {
    this.setData({ toolType: "" });
  },
  toggleToolSeat(e) {
    if (this.data.busy) return;
    const seat = Number(e.currentTarget.dataset.seat);
    const toolSeats =
      this.data.room.knights && this.data.toolType === "assassination"
        ? [seat]
        : this.data.toolSeats.includes(seat)
          ? this.data.toolSeats.filter((s) => s !== seat)
          : [...this.data.toolSeats, seat];
    this.setProcessData({
      toolSeats,
      toolPlayers: this.data.toolPlayers.map((p) => ({
        ...p,
        selected: toolSeats.includes(p.seat),
      })),
    });
  },
  pickToolThreshold(e) {
    if (this.data.busy) return;
    const value = Number(e.currentTarget.dataset.value);
    if ([1, 2].includes(value)) this.setProcessData({ toolThreshold: value });
  },
  async launchTool() {
    if (this.data.busy || this.pending) return;
    const room = this.data.room;
    if (!room || room.stage !== this.toolStage) {
      this.closeTool();
      this.setData({ error: "阶段已变化，请重新选择操作" });
      return;
    }
    const kind = this.data.toolType;
    const extra = {
      kind,
      team: [...this.data.toolSeats],
      threshold: this.data.toolThreshold,
      actor: this.data.toolSeats[0],
      replace: room.hasActiveOperation,
    };
    if (
      kind === "quest" &&
      (!extra.team.length || extra.threshold > extra.team.length)
    ) {
      this.setData({ error: "请选择任务队员，失败票门槛不能超过队员人数" });
      return;
    }
    if (
      room.hasActiveOperation &&
      !(await this.confirm(
        "作废当前操作并切换？",
        "当前尚未结算的提交将作废，已结算记录和玩家身份保留。",
      ))
    )
      return;
    if (!this.foreground || this.data.room?.stage !== room.stage) return;
    this.closeTool();
    this.cmd("beginActivity", extra);
  },
  async closeWaiting() {
    const policy = this.data.room?.closeWaiting;
    if (!policy) return;
    return this.confirmCommand(policy.title, policy.description, "closeWaiting", { confirm: true });
  },
  settleTool() {
    this.cmd("settleTool");
  },
  async cancelTool() {
    return this.confirmCommand(
      "作废当前操作？",
      "本次未结算的提交将作废，玩家身份和已结算记录保留。",
      "cancelActivity",
    );
  },
  finishTools() {
    if (!this.data.room?.canUseTools || this.data.busy || this.pending) return;
    this.resultStage = this.data.room.stage;
    this.setResultDraft({ resultDialog: true, resultStep: "reason", resultOther: false, resultChoice: "", resultReason: "", resultTarget: null, resultActor: null, resultRequiresTarget: false, resultReasonDraft: null, resultChoiceDraft: "", resultScrollTop: 0 });
  },
  closeResult() { if (!this.data.busy) this.setData({ resultDialog: false }); },
  setResultDraft(patch = {}) {
    const flow = resultFlow({ ...this.data, ...patch });
    const moved = flow.resultStep !== this.data.resultStep || flow.resultOther !== this.data.resultOther;
    this.setData({ ...patch, ...flow, ...(moved ? { resultScrollTop: this.data.resultScrollTop ? 0 : 1 } : {}) });
  },
  toggleResultOther() {
    if (this.data.busy || this.pending || !this.data.resultDialog) return;
    this.setResultDraft(resultRegistration.switchMode(this.data));
  },
  nextResult() {
    if (this.data.busy || this.pending || !this.data.resultDialog) return;
    if (this.data.room?.stage !== this.resultStage) { this.setData({ resultDialog: false, error: "阶段已变化，请重新登记胜负" }); return; }
    const flow = resultFlow(this.data);
    if (flow.resultNextEnabled && flow.resultStep !== "review") this.setResultDraft({ resultStep: flow.resultSteps[flow.resultStepIndex + 1].id });
  },
  backResult() {
    if (this.data.busy || this.pending) return;
    const flow = resultFlow(this.data);
    if (flow.resultStepIndex) this.setResultDraft({ resultStep: flow.resultSteps[flow.resultStepIndex - 1].id });
    else this.closeResult();
  },
  pickResult(e) {
    const value = e.currentTarget.dataset.value;
    if (value !== "none" && !this.data.room?.winnerOptions?.some(item => item.value === value)) return;
    this.setResultDraft({ resultOther: value !== "none", resultChoice: value, resultReason: "", resultRequiresTarget: false, resultTarget: null, resultActor: null });
  },
  pickScoreReason(e) {
    const room = this.data.room;
    const reason = resultRegistration.reasons(room).find(item => item.id === e.currentTarget.dataset.id);
    if (reason && reason.id !== this.data.resultReason) this.setResultDraft({ resultOther: false, resultReason: reason.id, resultChoice: "", resultRequiresTarget: !!reason.requiresTarget, resultTarget: null, resultActor: null });
  },
  pickScoreTarget(e) {
    const seat = Number(e.currentTarget.dataset.seat), room = this.data.room;
    if (seat !== 0 && !room?.players?.some(player => player.seat === seat && player.alive !== false)) return;
    if ((room?.settlementRequiresActor ?? room?.knights) && this.data.resultActor === seat) return;
    this.setResultDraft({ resultTarget: seat });
  },
  pickFunActor(e) {
    const seat = Number(e.currentTarget.dataset.seat);
    if (!this.data.room?.players?.some(player => player.seat === seat && player.alive !== false)) return;
    this.setResultDraft({ resultActor: seat, ...(seat === this.data.resultTarget ? { resultTarget: null } : {}) });
  },
  viewScoreRecord() { wx.navigateTo({ url: "/pages/scores/scores" }); },
  viewFunRecord() { wx.navigateTo({ url: "/pages/stats/stats?tab=fun" }); },
  viewReplay() {
    const room = this.data.room;
    if (!room?.replayId || !["ended", "terminated"].includes(room.phase) || !this.foreground ||
      this.openingReplay || this.data.busy || this.data.hasPendingRequest || this.pending) return;
    this.openingReplay = true;
    wx.navigateTo({ url: "/pages/replay/replay?id=" + encodeURIComponent(room.replayId),
      fail: () => { if (this.alive) wx.showToast({ title: "暂时无法打开，请重试", icon: "none" }); },
      complete: () => { this.openingReplay = false; } });
  },
  async saveResult() {
    const room = this.data.room, choice = this.data.resultChoice;
    const scoring = !!room?.scoreSettlement?.length;
    const reason = (scoring ? room.scoreSettlement : room?.funSettlement)?.find(item => item.id === this.data.resultReason);
    if (!this.data.resultDialog || this.data.resultStep !== "review" || !resultFlow(this.data).resultReady || (!choice && !reason) || this.data.busy || this.pending || this.resultConfirming) return;
    if (reason?.requiresTarget && !Number.isInteger(this.data.resultTarget)) return;
    if (reason?.requiresTarget && (room.settlementRequiresActor ?? (room.knights && room.funSettlement)) && !Number.isInteger(this.data.resultActor)) return;
    if (!room || room.stage !== this.resultStage) {
      this.setData({ resultDialog: false, error: "阶段已变化，请重新登记胜负" });
      return;
    }
    const option = (room.winnerOptions || []).find(o => o.value === choice);
    if (!reason && choice !== "none" && !option) return;
    const target = this.data.resultTarget;
    const details = reason ? { [scoring ? "scoreReason" : "funReason"]: reason.id, ...(reason.requiresTarget ? { [scoring ? "scoreTarget" : "funTarget"]: target, ...((room.settlementRequiresActor ?? (room.knights && room.funSettlement)) ? { funActor: this.data.resultActor } : {}) } : {}) }
      : { winner: choice === "none" ? null : choice };
    const flow = resultFlow(this.data), stage = room.stage;
    this.resultConfirming = true;
    try {
      const confirmed = await this.confirm("确认结束本局？", flow.resultSummary.map(row => row.label + "：" + row.value).join("\n") + "\n" + flow.resultNotice + "\n胜负确认后将归档，不能直接修改。" + (room.hasActiveOperation ? "当前未结算的操作将作废。" : ""));
      if (!confirmed) return;
      if (!this.foreground || this.data.room?.stage !== stage || this.data.busy || this.pending) { this.setData({ resultDialog: false, error: "阶段已变化，请重新登记胜负" }); return; }
      this.setData({ resultDialog: false });
      return this.cmd("finishTools", { replace: true, ...details });
    } finally { this.resultConfirming = false; }
  },

  async start() {
    return this.confirmCommand(
      "开始这一局？",
      "按当前人数随机分配身份，之后由房主按需发起投票、任务或刀人。",
      "start",
      { flexible: true },
    );
  },
  propose() {
    this.cmd("propose", { team: this.data.selected });
  },
  advance() {
    this.cmd("advance");
  },
  async terminate() {
    return this.confirmCommand(
      "终止本局？",
      "本局不判胜负。结束后可以在同一房间重新准备。",
      "terminate",
    );
  },
  async offline() {
    return this.confirmCommand(
      "转入线下结算？",
      "停止线上任务推进，在线下完成起刀、内奸及最终胜负。小程序不会代判。",
      "offline",
    );
  },
  async closeOffline() {
    return this.confirmCommand(
      "线下已结算完毕？",
      "记录线下操作完成，随后可继续发起其他操作。",
      "closeOffline",
      { keepPlaying: true },
    );
  },
  startHonors() {
    if (!this.data.honors?.canStart) return;
    return this.cmd("honorStart", { matchId: this.data.honors.matchId });
  },
  openHonors() {
    const h = this.data.honors;
    if (!h?.canVote || h.status !== "open" || this.data.busy || this.pending) return;
    const draft = h.ballot || { mvp: null, svp: null };
    this.setData({ honorDialog: true, honorMatchId: h.matchId, honorDraft: draft, ...honorPresentation.selection(h, draft) });
  },
  dismissHonors() {
    if (!this.data.busy && !this.pending) this.setData({ honorDialog: false, honorDismissed: this.data.honors?.matchId || "" });
  },
  chooseHonor(e) {
    const { key, seat } = e.currentTarget.dataset;
    if (!this.data.honorDialog || this.data.busy || this.pending) return;
    const group = this.data.honors?.groups.find(g => g.key === key);
    if (!group?.players.some(p => p.seat === Number(seat) && !p.disabled)) return;
    const draft = { ...this.data.honorDraft, [key]: Number(seat) };
    this.setData({ honorDraft: draft, ...honorPresentation.selection(this.data.honors, draft) });
  },
  submitHonors() {
    if (!this.data.honorDialog || !this.data.honorReady || this.data.busy || this.pending) return;
    const h = this.data.honors, draft = { ...this.data.honorDraft };
    h.groups.filter(g => g.skip).forEach(g => draft[g.key] = null);
    this.setData({ honorDialog: false, honorDismissed: h.matchId });
    return this.cmd("honorVote", { matchId: h.matchId, ...draft });
  },
  closeHonors() {
    const h = this.data.honors;
    if (!h?.canClose) return;
    return this.confirmCommand("结束本场票选？", `已收到 ${h.completed} / ${h.total} 人投票。至少 ${h.required} 人完成才颁奖，结束后不可修改。`, "honorClose", { matchId: h.matchId });
  },
  honorAvatarError(e) {
    const shownUrl = e.currentTarget.dataset.url;
    if (!shownUrl || !this.data.room?.honors) return;
    this.honorAvatarFailures ||= new Set();
    const h = this.data.room.honors;
    const players = [...(h.groups || []).flatMap(g => g.players), ...(h.mvp || []), ...(h.svp || [])];
    players.filter(p => p.avatarUrl && api.assetUrl(p.avatarUrl) === shownUrl).forEach(p => this.honorAvatarFailures.add(p.avatarUrl));
    const honors = honorPresentation.present(h, api.assetUrl, this.honorAvatarFailures);
    this.setData({ honors, ...honorPresentation.selection(honors, this.data.honorDraft) });
  },
  rematch() {
    if (this.data.honors?.status === "open") return this.confirmCommand("结束票选并开下一局？", "将按当前选票结算；未达到半数参与则不颁奖。投票和结果都会保留在本局记录中。", "rematch");
    return this.cmd("rematch");
  },
  async leave() {
    if (this.data.busy || this.pending || !this.data.room) return;
    const room = this.data.room;
    if (
      !(await this.confirm(
        "离开房间？",
        room.me.isHost
          ? "将释放你的座位，牌桌和房主权限保留。"
          : "将释放你的座位，牌桌保留。",
      ))
    )
      return;
    if (
      !this.foreground ||
      this.data.room?.code !== room.code ||
      this.data.room?.stage !== room.stage
    )
      return;
    this.cmd("leave", {}, "leave");
  },
  copyRoomCode() {
    const code = this.data.room?.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: "房间号已复制", icon: "success" }),
      fail: () =>
        this.handleError({ message: "复制失败，请再试一次", status: 400 }),
    });
  },
  connectionInfo() {
    const content =
      !this.data.network || this.data.needsLogin || !this.data.serverConnected
        ? "连接尚未确认，请检查网络或重试。"
        : this.data.busy || this.data.loading || this.data.roomsRefreshing || this.pending
          ? "正在确认操作，请稍候。"
          : "最近一次服务器请求成功。";
    dialog.show({ title: "连接状态", content, showCancel: false });
  },
  closeAction() {
    this.actionGeneration = (this.actionGeneration || 0) + 1;
    this.updateChangedData({
      actionDialog: false,
      actionSecret: null,
      actionLoading: false,
      actionLabel: "",
      actionChoices: [],
      hunterModes: false,
      hunterMode: "",
      hunterChoices: [],
      actionTargets: [],
      draftChoice: "",
      draftLabel: "",
      stagedChoice: false,
      skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
      skillTargetMode: "", skillTargetMeta: "", skillTargetCaption: "", skillEligibility: "", skillSummary: "", skillConsequence: "", skillConfirmLabel: "",
      swapOptions: [],
      swapSeats: [],
      swapPlayers: [],
    });
  },
  async openAction() {
    const room = this.data.room;
    if (
      this.pending ||
      !room?.needsSubmission ||
      room.me.submitted ||
      !this.foreground ||
      !this.data.network ||
      this.data.actionLoading
    )
      return;
    this.mask();
    const generation = this.actionGeneration;
    this.setProcessData({ actionLoading: true });
    try {
      const response = await api.request(
        "/api/rooms/" + this.roomCode + "/private",
      );
      if (
        !this.alive ||
        !this.foreground ||
        generation !== this.actionGeneration ||
        this.data.room?.stage !== room.stage ||
        response.stage !== room.stage ||
        this.data.room.me.submitted
      )
        return;
      if (!response.action) return;
      this.promptedActionStage = room.stage;
      this.actionDraftStage = room.stage;
      const swapOptions = (response.action.choices || []).filter((v) =>
        /^swap:\d+:\d+$/.test(v),
      );
      const swapSeats = new Set(
        swapOptions.flatMap((v) => v.split(":").slice(1).map(Number)),
      );
      // Identity is fetched separately only after an explicit reveal tap.
      const hunterChoices = response.action.hunterModes ? response.action.options : [];
      const finalTarget = !!room.knights && response.action.kind === "target";
      const actionChoices = finalTarget ? response.action.targets.map(t => ({ value: "target:" + t.seat, label: t.seat ? "最终盘刀 " + t.seat + "号" : "本次空刀" })) : response.action.hunterModes ? [{ value: "mode:detonate", label: "主动技能" }, { value: "mode:passive", label: "被动技能" }, { value: "pass", label: "本轮不开枪" }] : (response.action.choices || [])
          .filter((v) => !swapOptions.includes(v))
          .map((value) => ({
            value,
            label:
              response.action.options?.find((o) => o.value === value)?.label ||
              CHOICES[value] ||
              value,
          }));
      this.setProcessData({
        actionDialog: true,
        actionLabel: response.action.label,
        hunterModes: !!response.action.hunterModes,
        hunterMode: "",
        hunterChoices,
        stagedChoice: finalTarget || ["teamVote", "quest", "skillPrepare", "skillTurn", "paladinTurn", "hunterTurn", "fairy"].includes(room.phase),
        draftChoice: "",
        draftLabel: "",
        swapOptions,
        swapSeats: [],
        swapPlayers: (room.players || [])
          .filter((p) => swapSeats.has(p.seat))
          .map((p) => ({ seat: p.seat, name: p.name, selected: false })),
        actionChoices,
        ...skillView(room, actionChoices, !!response.action.hunterModes, "", swapOptions),
        actionTargets: response.action.targets || [],
      });
    } catch (e) {
      if (generation === this.actionGeneration && this.foreground)
        this.handleError(e);
    } finally {
      if (generation === this.actionGeneration)
        this.setProcessData({ actionLoading: false });
    }
  },
  async revealActionIdentity() {
    if (this.data.actionSecret) {
      this.setProcessData({ actionSecret: null });
      return;
    }
    const room = this.data.room;
    if (
      !this.data.actionDialog ||
      room?.phase !== "identity" ||
      room.me.submitted ||
      !this.foreground ||
      this.data.busy ||
      !this.data.network
    )
      return;
    const generation = this.actionGeneration;
    this.setProcessData({ busy: true, busyAction: "actionIdentity" });
    try {
      const secret = await api.request(
        "/api/rooms/" + this.roomCode + "/private",
      );
      if (
        this.alive &&
        this.foreground &&
        this.data.actionDialog &&
        generation === this.actionGeneration &&
        this.data.room?.stage === room.stage &&
        secret.stage === room.stage &&
        !this.data.room.me.submitted
      ) {
        this.setProcessData({
          actionSecret: {
            role: secret.role,
            faction: secret.faction,
            factionTone: factionTone(secret.faction),
            information: secret.information,
            skillStatus: secret.skillStatus,
            avoidance: avoidancePresentation.result(secret.avoidance),
          },
        });
      }
    } catch (e) {
      if (generation === this.actionGeneration && this.foreground)
        this.handleError(e);
    } finally {
      this.setProcessData({ busy: false, busyAction: "" });
    }
  },
  identityDealKey() {
    const room = this.data.room;
    if (!room?.flexible || !room.game || room.me.seat == null ||
      ["lobby", "ended", "terminated"].includes(room.phase)) return "";
    return `${room.code}:${room.game}:${room.me.seat}`;
  },
  identityReceipts() {
    if (!this.dealtIdentityReceipts) {
      const saved = wx.getStorageSync("dealtIdentityReceipts");
      this.dealtIdentityReceipts = Array.isArray(saved) ? saved : [];
    }
    return this.dealtIdentityReceipts;
  },
  rememberDealtIdentity() {
    const key = this.identityDealKey();
    if (!key) return;
    this.dealtIdentityReceipts = [...this.identityReceipts().filter(k => k !== key), key].slice(-50);
    // Only non-secret reminder receipts are persisted, never role/vision data.
    try { wx.setStorageSync("dealtIdentityReceipts", this.dealtIdentityReceipts); } catch (e) {}
  },
  identityOverlayBlocked() {
    return !this.alive || !this.foreground || !this.data.room || this.data.error ||
      this.grantNoticeOpen ||
      this.data.actionDialog || this.data.actionLoading || this.data.identityChange ||
      this.data.fairyResult || this.data.identityHistoryOpen || this.data.historyOpen || this.data.toolType || this.data.showRoomRules || this.data.showRoomSettings;
  },
  showDealtIdentity() {
    const key = this.identityDealKey();
    if (!key || this.data.room.me.identityRevision > 0 || this.identityOverlayBlocked()) return false;
    if (this.data.dealtIdentityDialog) return true;
    if (this.identityReceipts().includes(key)) return false;
    this.mask();
    this.setData({ dealtIdentityDialog: true });
    return true;
  },
  async revealDealtIdentity() {
    if (!this.data.dealtIdentityDialog || this.data.busy || !this.data.network || !this.foreground) return;
    const key = this.identityDealKey(), stage = this.data.room.stage;
    const generation = ++this.generation;
    this.setData({ busy: true, busyAction: "dealtIdentity" });
    try {
      const secret = await api.request("/api/rooms/" + this.roomCode + "/private");
      if (!this.alive || !this.foreground || generation !== this.generation ||
        !this.data.dealtIdentityDialog || key !== this.identityDealKey() ||
        this.data.room.stage !== stage || secret.stage !== stage) return;
      this.rememberDealtIdentity();
      this.setData({ dealtIdentitySecret: {
        role: secret.role, faction: secret.faction, factionTone: factionTone(secret.faction),
        portrait: portrait(secret.role, factionTone(secret.faction)).portrait,
        information: secret.information, skillStatus: secret.skillStatus,
        avoidance: avoidancePresentation.result(secret.avoidance),
      } });
    } catch (e) {
      if (generation === this.generation && this.foreground) this.handleError(e);
    } finally {
      this.setData({ busy: false, busyAction: "" });
    }
  },
  closeDealtIdentity() {
    if (!this.data.dealtIdentityDialog) return;
    this.rememberDealtIdentity();
    this.mask();
    if (!wx.getStorageSync("identityEntryHintSeen")) this.identityHintPending = this.identityDealKey();
    this.showIdentityHintWhenVisible();
  },
  showIdentityHintWhenVisible() {
    const key = this.identityHintPending;
    if (!key || key !== this.identityDealKey() || this.identityOverlayBlocked() ||
      this.data.dealtIdentityDialog || this.data.revealed || !wx.createSelectorQuery || this.identityHintChecking) return;
    this.identityHintChecking = true;
    wx.createSelectorQuery().in(this).select(".room-identity-anchor").boundingClientRect()
      .selectViewport().boundingClientRect().exec(([anchor, viewport]) => {
        this.identityHintChecking = false;
        if (!anchor || !viewport || anchor.height <= 0 || anchor.top < 0 || anchor.bottom > viewport.height ||
          key !== this.identityHintPending || key !== this.identityDealKey() || this.identityOverlayBlocked() ||
          this.data.dealtIdentityDialog || this.data.revealed) return;
        this.identityHintPending = "";
        try { wx.setStorageSync("identityEntryHintSeen", true); } catch (e) {}
        this.setData({ identityHintVisible: true });
      });
  },
  dismissIdentityHint() {
    this.identityHintPending = "";
    this.setData({ identityHintVisible: false });
  },
  async reveal() {
    this.dismissIdentityHint();
    if (this.data.revealed) {
      this.mask();
      return;
    }
    if (this.data.busy || !this.data.network) return;
    const generation = ++this.generation,
      stage = this.data.room.stage;
    this.setData({ busy: true, busyAction: "identity", error: "" });
    try {
      const secret = await api.request(
        "/api/rooms/" + this.roomCode + "/private",
      );
      if (
        this.foreground &&
        this.alive &&
        generation === this.generation &&
        secret.stage === stage &&
        this.data.room.stage === stage
      ) {
        secret.factionTone = factionTone(secret.faction);
        secret.avoidance = avoidancePresentation.result(secret.avoidance);
        secret.portrait = portrait(secret.role, secret.factionTone).portrait;
        secret.identityHistory = (secret.identityHistory || []).map(record => ({
          ...record, factionTone: factionTone(record.faction), portrait: portrait(record.role, factionTone(record.faction)).portrait,
        }));
        this.rememberDealtIdentity();
        this.setData({
          revealed: true,
          secret,
          choiceButtons: (secret.action?.choices || []).map((value) => ({
            value,
            label:
              secret.action.options?.find((o) => o.value === value)?.label ||
              CHOICES[value] ||
              value,
          })),
          targetButtons: secret.action?.targets || [],
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ busy: false, busyAction: "" });
    }
  },
  openIdentityHistory() {
    const history = this.data.secret?.identityHistory || [];
    if (!this.data.revealed || history.length < 2 || this.identityOverlayBlocked()) return;
    this.closePlayerCard();
    this.setProcessData({ identityHistoryOpen: true, identityHistoryExpandedId: history.find(record => !record.current)?.id ?? null });
  },
  closeIdentityHistory() {
    this.setData({ identityHistoryOpen: false, identityHistoryExpandedId: null });
  },
  toggleIdentityHistory(event) {
    const id = Number(event.currentTarget.dataset.id);
    if (!this.data.identityHistoryOpen || !this.data.secret?.identityHistory?.some(record => record.id === id && !record.current)) return;
    this.setProcessData({ identityHistoryExpandedId: this.data.identityHistoryExpandedId === id ? null : id });
  },
  hideIdentityHistory() {
    this.mask();
  },
  async showFairyResult() {
    const room = this.data.room;
    if (!room || this.fairyResultLoading) return;
    this.fairyResultLoading = true;
    const generation = this.generation;
    try {
      const secret = await api.request("/api/rooms/" + room.code + "/private");
      if (
        this.alive &&
        this.foreground &&
        this.generation === generation &&
        this.data.room?.code === room.code &&
        this.data.room?.stage === secret.stage &&
        this.data.room.me.fairyResultPending &&
        !this.data.identityChange &&
        secret.fairyResult
      ) {
        this.closeAction();
        this.setProcessData({
          fairyResult: roomSheet.presentFairyResult(secret.fairyResult),
          fairyResultRevealed: false,
          revealed: false,
          secret: null,
          identityHistoryOpen: false,
          identityHistoryExpandedId: null,
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.fairyResultLoading = false;
    }
  },
  hidePrivatePreview() {
    this.setProcessData({ fairyResultRevealed: false, identityChangeRevealed: false });
  },
  revealFairyResult() {
    if (this.data.busy || !this.foreground || !this.data.fairyResult) return;
    this.setProcessData({ fairyResultRevealed: true });
  },
  async acknowledgeFairyResult() {
    if (
      this.data.busy || this.fairyAckConfirm ||
      !this.data.fairyResultRevealed ||
      !this.data.fairyResult
    )
      return;
    const result = this.data.fairyResult;
    const generation = this.generation;
    this.fairyAckConfirm = true;
    try {
      if (!(await this.confirm("关闭查验结果？", "关闭后不会再显示本次查验结果，请确认已记住。"))) return;
      if (!this.alive || !this.foreground || generation !== this.generation || this.data.fairyResult !== result || !this.data.fairyResultRevealed) return;
      this.setData({ fairyResult: null, fairyResultRevealed: false });
      return this.cmd("ackFairyResult", { revision: result.revision });
    } finally {
      this.fairyAckConfirm = false;
    }
  },
  async showIdentityChange() {
    const room = this.data.room;
    if (!room || this.identityChangeLoading) return;
    this.identityChangeLoading = true;
    const generation = this.generation;
    try {
      const secret = await api.request("/api/rooms/" + room.code + "/private");
      if (
        this.foreground &&
        this.alive &&
        this.generation === generation &&
        this.data.room?.code === room.code &&
        this.data.room?.stage === secret.stage &&
        this.data.room.me.identityChanged
      ) {
        this.closeAction();
        secret.factionTone = factionTone(secret.faction);
        this.setProcessData({
          identityChange: roomSheet.presentPrivateIdentity(secret, secret.factionTone),
          identityChangeRevealed: false,
          revealed: false,
          secret: null,
          identityHistoryOpen: false,
          identityHistoryExpandedId: null,
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.identityChangeLoading = false;
    }
  },
  revealChangedIdentity() {
    if (this.data.busy || !this.foreground || !this.data.identityChange) return;
    this.setProcessData({ identityChangeRevealed: true });
  },
  acknowledgeIdentity() {
    if (this.data.busy || !this.data.identityChangeRevealed) return;
    const revision = this.data.identityChange?.identityRevision;
    if (revision === undefined) return;
    this.setData({ identityChange: null, identityChangeRevealed: false });
    this.cmd("ackIdentity", { revision });
  },
  toggleSwapSeat(e) {
    if (
      this.data.busy ||
      this.data.hasPendingRequest ||
      !this.data.network ||
      !this.foreground ||
      !this.data.actionDialog ||
      this.data.room?.me.submitted ||
      this.data.room?.stage !== this.actionDraftStage
    )
      return;
    const seat = Number(e.currentTarget.dataset.seat);
    if (!this.data.swapPlayers.some((p) => p.seat === seat && !p.disabledReason)) return;
    const selected = this.data.swapSeats.includes(seat)
      ? this.data.swapSeats.filter((s) => s !== seat)
      : this.data.swapSeats.length < 2
        ? [...this.data.swapSeats, seat]
        : this.data.swapSeats;
    const pair = selected.slice().sort((a, b) => a - b).join(":");
    const draft = this.data.swapOptions.find(v => v.split(":").slice(1).map(Number).sort((a, b) => a - b).join(":") === pair);
    this.setProcessData({
      ...(this.data.skillAction ? { draftChoice: draft || "", draftLabel: draft ? "交换 " + selected.slice().sort((a, b) => a - b).join(" 号与 ") + " 号" : "" } : {}),
      ...skillSelectionView(this.data.room, draft || "", this.data.skillTargetMode, selected),
      swapSeats: selected,
      swapPlayers: this.data.swapPlayers.map((p) => ({
        ...p,
        selected: selected.includes(p.seat),
      })),
    });
  },
  async confirmSwap() {
    if (
      this.data.busy ||
      !this.data.network ||
      !this.foreground ||
      !this.data.actionDialog ||
      this.data.room?.stage !== this.actionDraftStage ||
      this.data.swapSeats.length !== 2
    )
      return;
    const seats = [...this.data.swapSeats].sort((a, b) => a - b);
    const value = this.data.swapOptions.find(
      (v) =>
        v
          .split(":")
          .slice(1)
          .map(Number)
          .sort((a, b) => a - b)
          .join(":") === seats.join(":"),
    );
    if (!value) return;
    return this.confirmCommand(
      "确认秘密换号？",
      `交换 ${seats[0]} 号与 ${seats[1]} 号。提交后不可更改。`,
      "submit",
      { value },
    );
  },
  confirmChoice() {
    if (
      this.data.busy ||
      this.data.hasPendingRequest ||
      !this.foreground ||
      !this.data.actionDialog ||
      !this.data.stagedChoice ||
      this.data.room?.stage !== this.actionDraftStage ||
      this.data.room.me.submitted ||
      !this.data.network
    )
      return;
    const value = this.data.draftChoice;
    if (!value || value.startsWith("mode:") ||
      !(this.data.actionChoices.some(c => c.value === value) ||
        (this.data.skillAction && this.data.swapOptions.includes(value)))) return;
    this.cmd("submit", { value: this.data.skillTargetMode === "final" ? Number(value.split(":")[1]) : value });
  },
  async submitChoice(e) {
    const value = e.currentTarget.dataset.value;
    if (this.data.hunterModes && value.startsWith("mode:")) {
      if (this.data.busy || this.data.hasPendingRequest || !this.data.network || !this.foreground || !this.data.actionDialog || !this.data.room || this.data.room.me.submitted || this.data.room.stage !== this.actionDraftStage) return;
      if (!this.data.actionChoices.some(c => c.value === value)) return;
      const mode = value.split(":")[1];
      const actionChoices = mode ? this.data.hunterChoices.filter((o) => o.value.startsWith(mode + ":")).concat([{value: "mode:", label: "返回选择技能方式"}]) : [{value: "mode:detonate", label: "主动技能"}, {value: "mode:passive", label: "被动技能"}, {value: "pass", label: "本轮不开枪"}];
      this.setProcessData({ hunterMode: mode, actionChoices, draftChoice: "", draftLabel: "",
        ...skillView(this.data.room, actionChoices, true, mode, this.data.swapOptions) });
      return;
    }
    if (this.data.stagedChoice) {
      if (
        this.data.busy ||
        this.data.hasPendingRequest ||
        !this.data.network ||
        this.data.room.me.submitted ||
        !this.foreground ||
        !this.data.actionDialog ||
        this.data.room.stage !== this.actionDraftStage
      )
        return;
      const choice = this.data.actionChoices.find((c) => c.value === value);
      if (choice)
        this.setProcessData({ draftChoice: value, draftLabel: this.data.skillAction ? skillDraftLabel(choice, this.data.hunterModes, this.data.skillTargetMode) : choice.label,
          swapSeats: [], swapPlayers: this.data.swapPlayers.map(p => ({ ...p, selected: false })),
          ...skillSelectionView(this.data.room, value, this.data.skillTargetMode) });
      return;
    }
    if (
      ["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn", "fairy"].includes(
        this.data.room?.phase,
      )
    ) {
      const label =
        this.data.actionChoices.find((c) => c.value === value)?.label || value;
      return this.confirmCommand(
        "确认使用技能？",
        label + "。提交后不可更改。",
        "submit",
        { value },
      );
    }
    this.cmd("submit", { value });
  },
  async submitTarget(e) {
    const seat = Number(e.currentTarget.dataset.seat);
    return this.confirmCommand(
      "确认提交？",
      `提交 ${seat} 号为最终目标，确认后不可更改。`,
      "submit",
      { value: seat },
    );
  },
  prepareRoomShare() {
    const room = this.data.room;
    if (!this.shareCanvasReady || !room) return;
    const key = JSON.stringify([room.code, room.createdAt, room.boardName]);
    if (this.shareCover?.key === key) return;
    const previous = this.shareRenderPromise || Promise.resolve();
    const cover = { key, path: null };
    this.shareCover = cover;
    cover.promise = previous.then(() => this.alive && this.shareCover === cover ? roomShare.renderRoomCover(this, room) : null).then(path => {
      if (this.alive && this.shareCover === cover) cover.path = path;
      return path;
    }).catch(() => null);
    this.shareRenderPromise = cover.promise;
  },
  onShareAppMessage() {
    const room = this.data.room;
    const content = roomShare.shareContent(room, this.shareCover?.path || undefined);
    if (!room || !this.shareCover?.promise) return content;
    return { ...content, promise: this.shareCover.promise.then(path => roomShare.shareContent(room, path || undefined)) };
  },
}; };
