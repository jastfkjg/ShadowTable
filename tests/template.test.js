const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs, wxssToJs } = require("miniprogram-compiler");
const root = path.resolve(__dirname, "../miniprogram");
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext(
  "(function(global){" + wxmlToJs(root) + "})(global)",
  context,
);
const render = factory("pages/table/table.wxml");
const base = {
  loading: false,
  busy: false,
  error: "",
  notice: "",
  room: null,
  entryMode: "join",
  boards: [],
  seats: [],
  history: [],
  revealed: false,
  secret: null,
  capacity: 6,
  boardId: "classic",
  network: true,
};
function nodes(node) {
  return typeof node === "string"
    ? []
    : [node, ...(node.children || []).flatMap(nodes)];
}
const byHandler = (tree, name) =>
  nodes(tree).find(
    (n) => n.attr?.bindtap === name || n.attr?.["data-action"] === name,
  );
test("初次发牌提醒默认遮盖，可稍后查看；关闭后只有身份入口气泡，不渲染旧秘密", () => {
  const data = { ...base, room: { phase: "tools", code: "123456", capacity: 6, team: [], me: { seat: 1 } }, dealtIdentityDialog: true };
  const hidden = render(data);
  assert.ok(byHandler(hidden, "revealDealtIdentity"));
  assert.ok(byHandler(hidden, "closeDealtIdentity"));
  assert.match(JSON.stringify(hidden), /稍后查看/);
  const secret = { role: "梅林", faction: "好人阵营", information: "秘密视野" };
  const shown = render({ ...data, dealtIdentitySecret: secret });
  assert.match(JSON.stringify(shown), /秘密视野/);
  assert.match(JSON.stringify(shown), /记住了，遮盖身份/);
  const closed = render({ ...data, dealtIdentityDialog: false, dealtIdentitySecret: secret, identityHintVisible: true });
  assert.ok(!JSON.stringify(closed).includes("秘密视野"));
  assert.match(JSON.stringify(closed), /随时点这里/);
  assert.ok(byHandler(closed, "dismissIdentityHint"));
  const covered = render({ ...data, identityHintVisible: true });
  assert.equal(byHandler(covered, "dismissIdentityHint"), undefined);
});
test("WXML入口加载/错误/禁用绑定为真实布尔条件", () => {
  const tree = render(base),
    text = JSON.stringify(tree);
  assert.ok(!text.includes("正在连接牌桌"));
  assert.equal(byHandler(tree, "join").attr.disabled, false);
  assert.equal(byHandler(tree, "retry"), undefined);
  const loading = render({ ...base, loading: true });
  assert.equal(byHandler(loading, "join").attr.disabled, true);
  assert.ok(JSON.stringify(loading).includes("正在连接牌桌"));
  assert.ok(
    byHandler(
      render({ ...base, error: "连接断开", recoverableError: true }),
      "retry",
    ),
  );
});
test("WXML私密卡被遮盖时不把角色和行动渲染到树，非房主无推进按钮", () => {
  const room = {
    phase: "quest",
    code: "123456",
    capacity: 6,
    me: { seat: 1, isHost: false, submitted: false },
    needsSubmission: true,
    canAdvance: false,
    team: [],
  };
  const secret = {
    role: "梅林",
    faction: "好人阵营",
    information: "坏人2号",
    skillStatus: { title: "技能已用完", detail: "私密技能原因" },
    action: { label: "选择任务牌" },
  };
  const hidden = render({ ...base, room, secret });
  assert.ok(!JSON.stringify(hidden).includes("梅林"));
  assert.ok(!JSON.stringify(hidden).includes("私密技能原因"));
  assert.equal(byHandler(hidden, "advance"), undefined);
  assert.equal(byHandler(hidden, "submitChoice"), undefined);
  const shown = render({
    ...base,
    room,
    secret,
    revealed: true,
    choiceButtons: [{ value: "success", label: "任务成功" }],
  });
  assert.ok(JSON.stringify(shown).includes("梅林"));
  assert.ok(JSON.stringify(shown).includes("私密技能原因"));
  assert.equal(byHandler(shown, "submitChoice"), undefined);
  const submitted = render({
    ...base,
    room: { ...room, me: { ...room.me, submitted: true } },
    secret,
    revealed: true,
    choiceButtons: [{ value: "success", label: "任务成功" }],
  });
  assert.equal(byHandler(submitted, "submitChoice"), undefined);
});
test("WXSS官方编译器封装可编译全局样式", () => {
  const output = wxssToJs(root);
  assert.ok(output.length > 100);
});

test("我的牌桌统一更多入口，只有房主菜单显示解散，非房主仍可移除记录", () => {
  const rooms = [{ code: "123456", isHost: true, available: true }, { code: "234567", isHost: false, available: true }];
  const data = { ...base, memberRooms: rooms, visibleMemberRooms: rooms };
  const tree = render(data);
  assert.ok(byHandler(tree, "join"));
  assert.equal(nodes(tree).filter(n => n.attr?.bindtap === "openRoomMenu").length, 2);
  assert.equal(byHandler(tree, "deleteRoom"), undefined);
  for (const room of rooms) {
    const menu = render({ ...data, roomMenu: room });
    const actions = nodes(menu).filter(n => n.attr?.bindtap === "roomMenuAction").map(n => n.attr["data-kind"]);
    assert.ok(actions.includes("hide"));
    assert.ok(!actions.includes("note"));
    assert.equal(actions.includes("delete"), room.isHost);
  }
  const empty = render({ ...base, memberRooms: [], visibleMemberRooms: [] });
  assert.ok(JSON.stringify(empty).includes("还没有牌桌"));
});

test("业务错误居中弹窗只提供关闭，连接错误才提供重试", () => {
  const tree = render({ ...base, error: "阶段尚未完成" });
  assert.ok(nodes(tree).some((n) => n.attr?.role === "dialog"));
  assert.ok(byHandler(tree, "dismissError"));
  assert.equal(byHandler(tree, "retry"), undefined);
  const recovery = render({
    ...base,
    error: "连接中断",
    recoverableError: true,
    hasPendingRequest: true,
  });
  assert.ok(byHandler(recovery, "retry"));
  assert.equal(byHandler(recovery, "returnHome"), undefined);
});

test("房间设置仅房主可见，普通玩家仍可准备和复制房间号", () => {
  const room = {
    code: "123456",
    phase: "lobby",
    players: [],
    me: { isHost: false, seat: 2 },
  };
  const guest = render({ ...base, room, showRoomSettings: true });
  assert.equal(byHandler(guest, "toggleRoomSettings"), undefined);
  assert.equal(
    nodes(guest).some((n) => n.attr?.bindchange === "configureCapacity"),
    false,
  );
  assert.equal(byHandler(guest, "start"), undefined);
  assert.ok(byHandler(guest, "ready"));
  assert.ok(byHandler(guest, "copyRoomCode"));
  const host = render({
    ...base,
    room: { ...room, me: { isHost: true, seat: 1 } },
    showRoomSettings: true,
  });
  assert.ok(byHandler(host, "toggleRoomSettings"));
  assert.ok(
    !nodes(host).some((n) => n.attr?.bindchange === "configureCapacity"),
  );
});

test("说明仅列阵营角色，房间内玩家可打开当前配置弹窗", () => {
  const { BOARDS } = require("../server/engine");
  const roles = BOARDS[0].roleConfigurations[6];
  const home = render({
    ...base,
    entryMode: "create",
    showRules: true,
    boardRoleConfiguration: roles,
    boardDescription: "不应显示的玩法描述",
  });
  assert.ok(JSON.stringify(home).includes("梅林，派西维尔，忠臣×2"));
  assert.ok(!JSON.stringify(home).includes("不应显示的玩法描述"));
  const room = {
    phase: "lobby",
    me: { isHost: false },
    roleConfiguration: roles,
  };
  assert.ok(byHandler(render({ ...base, room }), "openRoomRules"));
  assert.equal(
    byHandler(render({ ...base, room }), "closeRoomRules"),
    undefined,
  );
  const open = render({ ...base, room, showRoomRules: true });
  assert.ok(byHandler(open, "closeRoomRules"));
  assert.ok(JSON.stringify(open).includes("莫甘娜，刺客"));
});

test("投票和私密操作只在弹窗显示，已提交后弹窗消失且入口显示完成", () => {
  const room = {
    code: "123456",
    phase: "teamVote",
    team: [],
    me: { submitted: false },
    needsSubmission: true,
  };
  const data = {
    ...base,
    room,
    actionDialog: true,
    actionLabel: "是否同意",
    actionChoices: [
      { value: "approve", label: "赞成" },
      { value: "reject", label: "反对" },
    ],
    secret: { role: "测试私密身份", information: "不可见" },
  };
  const open = render(data);
  assert.ok(byHandler(open, "submitChoice"));
  assert.ok(byHandler(open, "closeAction"));
  assert.ok(!JSON.stringify(open).includes("测试私密身份"));
  const closed = render({ ...data, actionDialog: false });
  assert.equal(byHandler(closed, "submitChoice"), undefined);
  assert.ok(byHandler(closed, "openAction"));
  const done = render({ ...data, room: { ...room, me: { submitted: true } } });
  assert.equal(byHandler(done, "submitChoice"), undefined);
  assert.equal(byHandler(done, "openAction"), undefined);
  assert.ok(JSON.stringify(done).includes("已提交，等待其他玩家"));
});

test("房主工具入口覆盖任意发牌后阶段，普通玩家不能看见管理入口", () => {
  for (const phase of [
    "tools",
    "identity",
    "teamVote",
    "quest",
    "assassination",
  ]) {
    const room = {
      phase,
      flexible: true,
      canUseTools: true,
      hasActiveOperation: phase !== "tools",
      knifeOffline: false,
      hasReverse: true,
      team: [],
      me: { isHost: true },
    };
    const host = render({ ...base, room });
    assert.equal(
      nodes(host).filter((n) => n.attr?.bindtap === "openTool").length,
      3,
    );
    assert.equal(byHandler(host, "advance"), undefined);
    assert.ok(byHandler(host, "finishTools"));
    const guest = render({
      ...base,
      room: { ...room, canUseTools: false, me: { isHost: false } },
    });
    assert.equal(byHandler(guest, "openTool"), undefined);
    assert.equal(byHandler(guest, "finishTools"), undefined);
  }
  const room = {
    phase: "tools",
    flexible: true,
    canUseTools: true,
    team: [],
    me: { isHost: true },
  };
  const dialog = render({
    ...base,
    room,
    toolType: "quest",
    toolSeats: [],
    toolThreshold: 1,
    toolPlayers: [{ seat: 1, name: "甲" }],
  });
  assert.ok(byHandler(dialog, "toggleToolSeat"));
  assert.equal(byHandler(dialog, "launchTool").attr.disabled, true);
});

test("身份默认只显示一行入口，进度仅房主可见，结束按钮位于记录之后", () => {
  const room = {
    phase: "teamVote",
    canUseTools: true,
    hasActiveOperation: true,
    team: [1],
    me: { isHost: true },
    operationProgress: {
      total: 2,
      completed: 1,
      players: [
        { seat: 1, name: "甲", required: true, completed: true },
        { seat: 2, name: "乙", required: true, completed: false },
        { seat: 3, name: "丙", required: false, completed: false },
      ],
    },
  };
  const tree = render({
    ...base,
    room,
    operationProgressExpanded: true,
    history: [{ key: 0, text: "已有记录", detail: "已结算" }],
    secret: { role: "测试私密角色", information: "隐私" },
  });
  const serialized = JSON.stringify(tree);
  assert.ok(!serialized.includes("身份已遮盖"));
  assert.ok(!serialized.includes("测试私密角色"));
  assert.ok(byHandler(tree, "reveal"));
  assert.ok(serialized.includes("未完成"));
  assert.ok(!serialized.includes("无需操作"));
  assert.ok(!serialized.includes("丙"));
  const collapsed = render({ ...base, room, operationProgressExpanded: false });
  assert.ok(byHandler(collapsed, "toggleOperationProgress"));
  assert.equal(nodes(collapsed).filter(n => n.attr?.class === "progress-player").length, 0);
  assert.match(JSON.stringify(byHandler(collapsed, "toggleOperationProgress")), /展开/);
  assert.match(JSON.stringify(byHandler(tree, "toggleOperationProgress")), /收起/);
  const all = nodes(tree);
  const footerIndex = all.findIndex((n) => n.attr?.bindtap === "finishTools");
  assert.ok(
    footerIndex > all.findIndex((n) => n.attr?.class === "history-row"),
  );
  const guest = render({
    ...base,
    room: {
      ...room,
      canUseTools: false,
      operationProgress: null,
      me: { isHost: false },
    },
  });
  assert.ok(!JSON.stringify(guest).includes("当前操作进度"));
});

test("发身份弹窗默认隐藏，展开后在确认按钮前展示身份和视角", () => {
  const data = {
    ...base,
    room: {
      phase: "identity",
      needsSubmission: true,
      me: { submitted: false },
    },
    actionDialog: true,
    actionChoices: [{ value: "confirm", label: "确认" }],
  };
  const hidden = render(data);
  assert.ok(byHandler(hidden, "revealActionIdentity"));
  const shown = render({
    ...data,
    actionSecret: { role: "梅林", faction: "好人阵营", information: "坏人2号" },
  });
  const text = JSON.stringify(shown);
  assert.ok(text.includes("梅林"));
  assert.ok(text.includes("好人阵营"));
  assert.ok(text.includes("坏人2号"));
  assert.ok(text.includes("立即遮盖"));
  assert.ok(text.indexOf("坏人2号") < text.indexOf("submitChoice"));
  assert.ok(!JSON.stringify(hidden).includes("坏人2号"));
  const closed = render({
    ...data,
    actionDialog: false,
    actionSecret: { role: "梅林" },
  });
  assert.ok(!JSON.stringify(closed).includes("梅林"));
  const vote = render({ ...data, room: { ...data.room, phase: "teamVote" } });
  assert.equal(byHandler(vote, "revealActionIdentity"), undefined);
});

test("十二骑士不提供主动先知查验和刀梅林入口，新身份提醒默认遮盖，主动查看才显示新牌", () => {
  const room = {
    phase: "tools",
    canUseTools: true,
    knights: { round: 2 },
    team: [],
    me: { isHost: true },
  };
  const tree = render({ ...base, room });
  const kinds = nodes(tree)
    .filter((n) => n.attr?.bindtap === "openTool")
    .map((n) => n.attr["data-kind"]);
  assert.ok(!kinds.includes("assassination"));
  assert.ok(!kinds.includes("offline"));
  assert.ok(!kinds.includes("night"));
  assert.ok(!kinds.includes("nextRound"));
  const popupData = {
    ...base,
    room,
    identityChange: {
      role: "石像鬼",
      faction: "坏人阵营",
      information: "没有视野。",
    },
  };
  const hidden = render(popupData);
  for (const value of ["石像鬼", "坏人阵营", "没有视野。"])
    assert.ok(!JSON.stringify(hidden).includes(value));
  assert.ok(byHandler(hidden, "revealChangedIdentity"));
  assert.ok(!byHandler(hidden, "acknowledgeIdentity"));
  const popup = render({ ...popupData, identityChangeRevealed: true });
  assert.ok(JSON.stringify(popup).includes("石像鬼"));
  assert.ok(byHandler(popup, "acknowledgeIdentity"));
});

test("技能过程开关仅房主可见，默认不可见", () => {
  const room = {
    phase: "tools",
    board: "knights",
    canUseTools: true,
    knights: { round: 1 },
    showSkillDetails: false,
    team: [],
    me: { isHost: true },
  };
  assert.equal(
    byHandler(render({ ...base, room }), "toggleSkillVisibility"),
    undefined,
  );
  const tree = render({ ...base, room, showRoomSettings: true });
  assert.equal(byHandler(tree, "toggleSkillVisibility"), undefined);
  assert.ok(byHandler(tree, "toggleRoomSettings"));
  const guest = render({
    ...base,
    room: { ...room, canUseTools: false, me: { isHost: false } },
  });
  assert.equal(byHandler(guest, "toggleSkillVisibility"), undefined);
});

test("独立设置页使用原生开关自动保存，仅失败时显示重试", () => {
  const settingsRender = factory("pages/settings/settings.wxml");
  const data = {
    loading: false,
    authorized: true,
    busy: false,
    room: {
      code: "123456",
      boardName: "十二骑士",
      capacity: 12,
      phase: "tools",
    },
    boardId: "knights",
    visible: false,
    dirty: false,
    pendingTransfer: false,
    pendingKick: false,
  };
  const tree = settingsRender(data);
  assert.ok(
    nodes(tree).some(
      (n) => n.tag === "wx-switch" && n.attr.bindchange === "toggleVisibility",
    ),
  );
  assert.equal(byHandler(tree, "save"), undefined);
  assert.ok(!JSON.stringify(tree).includes("7人局默认关闭"));
  assert.ok(!JSON.stringify(tree).includes("开启后公开出手人"));
  const dirty = settingsRender({ ...data, dirty: true, error: "网络错误" });
  assert.equal(byHandler(dirty, "save").attr.disabled, false);
  assert.equal(
    byHandler(settingsRender({ ...data, authorized: false }), "save"),
    undefined,
  );
  assert.ok(!nodes(tree).some((n) => n.attr?.bindchange === "pickCapacity"));
});

test("仙女结果弹窗默认不渲染目标与阵营，点击查看后才显示", () => {
  const data = {
    ...base,
    fairyResult: { revision: 1, information: "4号查验结果：坏人" },
  };
  const hidden = render(data);
  assert.ok(!JSON.stringify(hidden).includes("4号查验结果：坏人"));
  assert.ok(byHandler(hidden, "revealFairyResult"));
  assert.ok(!byHandler(hidden, "acknowledgeFairyResult"));
  const shown = render({ ...data, fairyResultRevealed: true });
  assert.ok(JSON.stringify(shown).includes("4号查验结果：坏人"));
  assert.ok(byHandler(shown, "acknowledgeFairyResult"));
});

test("拓展板子不显示线下辅助提示，身份确认使用线上视野文案", () => {
  const tree = render({
    ...base,
    boardAssisted: true,
    room: {
      assisted: true,
      phase: "identity",
      me: { isHost: false },
      players: [],
    },
    actionDialog: true,
    actionChoices: [{ value: "confirm", label: "确认" }],
  });
  const text = JSON.stringify(tree);
  assert.ok(!text.includes("线下辅助"));
  assert.ok(!text.includes("互认、起刀与最终胜负在线下完成"));
  assert.ok(!text.includes("已完成互认，确认"));
});

test("换号显示12个座位而非66个组合，投票需要单独确认", () => {
  const room = { phase: "skillPrepare", needsSubmission: true, me: { submitted: false }, team: [] };
  const swapPlayers = Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, name: "玩家", selected: i < 2 }));
  const tree = render({ ...base, room, actionDialog: true, swapOptions: ["swap:1:2"], swapPlayers, swapSeats: [1, 2], actionChoices: [{ value: "pass", label: "不使用技能" }] });
  assert.equal(nodes(tree).filter((n) => n.attr?.bindtap === "toggleSwapSeat").length, 12);
  assert.equal(byHandler(tree, "confirmSwap").attr.disabled, false);
  const vote = { ...base, room: { ...room, phase: "teamVote" }, actionDialog: true, stagedChoice: true, actionChoices: [{ value: "approve", label: "赞成" }] };
  assert.equal(byHandler(render(vote), "confirmChoice").attr.disabled, true);
  assert.equal(byHandler(render({ ...vote, draftChoice: "approve", draftLabel: "赞成" }), "confirmChoice").attr.disabled, false);
});

test("房主开局与结算按钮未满足条件时禁用并展示等待人数", () => {
  const room = { phase: "lobby", me: { isHost: true }, team: [] };
  assert.equal(byHandler(render({ ...base, room, canStart: false, startHint: "还差 2 人准备" }), "start").attr.disabled, true);
  assert.equal(byHandler(render({ ...base, room, canStart: true }), "start").attr.disabled, false);
  const playing = { ...room, phase: "quest", canUseTools: true, hasActiveOperation: true };
  const waiting = render({ ...base, room: playing, canSettle: false, settleHint: "还差 2 人提交" });
  assert.equal(byHandler(waiting, "settleTool").attr.disabled, true);
  assert.ok(JSON.stringify(waiting).includes("还差 2 人提交"));
  assert.equal(byHandler(render({ ...base, room: playing, canSettle: true }), "settleTool").attr.disabled, false);
});

test("移交入口仅在管理员设置页显示，玩家列表按需弹出", () => {
  const renderSettings = factory("pages/settings/settings.wxml");
  for (const phase of ["lobby", "tools", "ended"]) {
    const data = { loading: false, authorized: true, busy: false, pendingSave: false, pendingTransfer: false, room: { phase }, transferPlayers: [{ seat: 2, name: "乙" }] };
    const closed = renderSettings(data);
    const button = byHandler(closed, "openTransfer");
    assert.ok(button);
    assert.equal(button.attr.disabled, false);
    assert.equal(byHandler(closed, "transfer"), undefined);
    const opened = renderSettings({ ...data, showTransferPicker: true });
    assert.ok(byHandler(opened, "transfer"));
    assert.ok(byHandler(opened, "closeTransfer"));
    assert.equal(byHandler(renderSettings({ ...data, authorized: false }), "openTransfer"), undefined);
    assert.equal(byHandler(renderSettings({ ...data, pendingTransfer: true }), "openTransfer").attr.disabled, true);
    assert.equal(byHandler(renderSettings({ ...data, transferPlayers: [] }), "openTransfer").attr.disabled, true);
  }
});

test("自动结算牌桌展示个人状态和持久结果，房主可结束等待而不需点结算", () => {
  const room = {
    phase: "quest", flexible: true, canUseTools: true, hasActiveOperation: true,
    closeWaiting: { mode: "cancel" },
    operationStatus: { title: "本次你无需操作", detail: "参与者全部提交后自动结算" },
    needsSubmission: false, team: [2, 3], me: { isHost: true, submitted: false },
  };
  const data = { ...base, room, settleHint: "还差 1 人提交", latestResult: { text: "投票通过 · 提前截止", detail: "4票赞成\n2票弃权" } };
  const tree = render(data);
  assert.equal(byHandler(tree, "settleTool"), undefined);
  assert.equal(byHandler(tree, "cancelTool"), undefined);
  assert.equal(byHandler(tree, "openAction"), undefined);
  assert.equal(byHandler(tree, "closeWaiting").attr.disabled, false);
  assert.ok(JSON.stringify(tree).includes("本次你无需操作"));
  assert.ok(!JSON.stringify(tree).includes("2票弃权"));
  const waiting = render({ ...data, room: { ...room, phase: "tools" } });
  assert.ok(JSON.stringify(waiting).includes("2票弃权"));
  assert.equal(byHandler(render({ ...data, network: false }), "closeWaiting").attr.disabled, true);
  const submitted = render({ ...data, room: { ...room, canUseTools: false, closeWaiting: null, needsSubmission: true, me: { submitted: true }, operationStatus: { title: "已提交，等待其他玩家" } } });
  assert.equal(byHandler(submitted, "closeWaiting"), undefined);
  assert.equal(byHandler(submitted, "openAction"), undefined);
  assert.ok(JSON.stringify(submitted).includes("已提交，等待其他玩家"));
});

test("房间设置仅在可移出阶段开放成员选择，对局中说明原因，待确认请求可重试", () => {
  const renderSettings = factory("pages/settings/settings.wxml");
  const data = { loading: false, authorized: true, room: { phase: "lobby", canKick: true }, transferPlayers: [{ seat: 2, name: "玩家2" }] };
  assert.equal(byHandler(renderSettings(data), "openKick").attr.disabled, false);
  const playing = renderSettings({ ...data, room: { phase: "tools", canKick: false } });
  assert.equal(byHandler(playing, "openKick").attr.disabled, true);
  assert.ok(JSON.stringify(playing).includes("对局进行中不能移出玩家"));
  const legacy = renderSettings({ ...data, room: { phase: "lobby" } });
  assert.equal(byHandler(legacy, "openKick").attr.disabled, true);
  assert.ok(JSON.stringify(legacy).includes("暂不支持移出玩家"));
  assert.ok(!JSON.stringify(legacy).includes("对局进行中不能移出玩家"));
  const picker = renderSettings({ ...data, showKickPicker: true });
  assert.equal(byHandler(picker, "kick").attr["data-seat"], 2);
  assert.ok(byHandler(picker, "closeKick"));
  const pending = renderSettings({ ...data, pendingKick: true });
  assert.equal(byHandler(pending, "openKick").attr.disabled, true);
  assert.equal(byHandler(pending, "openTransfer").attr.disabled, true);
  assert.ok(byHandler(pending, "sendKick"));
  assert.equal(byHandler(renderSettings({ ...data, authorized: false }), "openKick"), undefined);
});

test("创建页提供板子详情入口，目录采用文字链接", () => {
  const tree = render({ ...base, entryMode: "create", availableBoards: [{ id: "classic", name: "经典" }] });
  assert.ok(byHandler(tree, "openBoardDetails"));
  const detail = factory("pages/board-details/board-details.wxml")({ loading: false, hasDetail: true, directoryExpanded: true, sections: [{ title: "角色技能", navTitle: "B牌 · 蓝方", kind: "roles", items: [] }] });
  const link = byHandler(detail, "jumpSection");
  assert.equal(link.tag, "wx-view");
  assert.equal(link.attr.role, "link");
  assert.ok(JSON.stringify(detail).includes("返回"));
});

test("等待确认时禁用写入入口但允许遮盖身份，房主工具位于座位之前", () => {
  const room = { phase: "tools", code: "123456", capacity: 6, canUseTools: true, flexible: true, me: { seat: 1, isHost: true }, team: [] };
  const tree = render({ ...base, room, hasPendingRequest: true, busy: true, network: false, revealed: true, secret: { role: "梅林" } });
  assert.equal(byHandler(tree, "openTool").attr.disabled, true);
  assert.equal(byHandler(tree, "finishTools").attr.disabled, true);
  assert.ok(!byHandler(tree, "reveal").attr.disabled);
  const flat = nodes(tree);
  assert.ok(flat.indexOf(byHandler(tree, "openTool")) < flat.findIndex(n => n.attr?.class === "seats"));
});

test("普通玩家座位公开湖仙标记且随传递移动；关闭后无标记和查验入口", () => {
  const room = { phase: "tools", code: "123456", capacity: 8, flexible: true,
    me: { seat: 2, isHost: false }, fairyEnabled: true, fairyHolder: 1, team: [] };
  const seats = [1, 2].map(seat => ({ seat, name: `玩家${seat}`, occupied: true }));
  for (const holder of [1, 2, null]) {
    const tree = render({ ...base, room: { ...room, fairyHolder: holder }, seats });
    const marked = nodes(tree).filter(n => n.attr?.bindtap === "seat" && JSON.stringify(n).includes('seat-fairy'));
    assert.deepEqual(marked.map(n => n.attr["data-seat"]), holder ? [holder] : []);
  }
  const host = { ...room, canUseTools: true, me: { isHost: true }, fairyEnabled: false, fairyHolder: null };
  const disabled = render({ ...base, room: host, seats });
  assert.ok(!nodes(disabled).some(n => n.attr?.["data-kind"] === "fairy"));
  const enabled = render({ ...base, room: { ...host, fairyEnabled: true }, seats });
  assert.ok(nodes(enabled).some(n => n.attr?.["data-kind"] === "fairy"));
});

test("湖仙设置所有板子可见，5/6人及查验进行中禁用开关", () => {
  const settingsRender = factory("pages/settings/settings.wxml");
  for (const capacity of [5, 6, 7, 8, 12]) {
    for (const phase of ["lobby", "tools", "fairy"]) {
      const tree = settingsRender({ loading: false, authorized: true, capacity, boardId: "classic",
        room: { phase }, fairyEnabled: capacity >= 8 });
      const toggle = nodes(tree).find(n => n.attr?.bindchange === "toggleFairy");
      assert.ok(toggle);
      assert.equal(toggle.attr.disabled, capacity < 7 || phase === "fairy");
      assert.equal(toggle.attr.checked, capacity >= 8);
    }
  }
});

test("结果卡和表决展示队伍，座位可折叠，公开记录底部展开且没有冗余说明", () => {
  const entry = { key: 3, text: "投票通过", resultTone: "success", resultTeam: "1、4号", latestDetail: "2票赞成", timeLabel: "23:38", recordLabel: "记录 4" };
  const data = { ...base, room: { phase: "teamVote", team: [1, 4], me: { submitted: false }, needsSubmission: true }, teamText: "1、4", actionDialog: true, seatsExpanded: false, latestResult: entry, history: [entry, entry, entry, entry], visibleHistory: [entry], questTimeline: [{ key: 1, number: 2, text: "任务成功", questResult: "success" }] };
  const tree = render(data);
  const text = JSON.stringify(tree);
  assert.ok(text.includes("任务队伍：1、4号"));
  assert.ok(text.includes("共4条"));
  assert.ok(text.includes("23:38"));
  assert.ok(text.includes("第2次"));
  assert.ok(!text.includes("最近三条"));
  assert.ok(!nodes(tree).some(n => n.attr?.class === "seats"));
  assert.ok(byHandler(tree, "toggleSeats"));
  assert.ok(byHandler(tree, "toggleHistory"));
  assert.ok(nodes(tree).some(n => n.attr?.class?.includes("quest-result-icon success")));
});

test("查验结果突出座位阵营，仅保留一个关闭入口", () => {
  const tree = render({ ...base, fairyResult: { revision: 1, information: "6号查验结果：坏人（第1轮）", summary: "6号 · 坏人" }, fairyResultRevealed: true });
  const text = JSON.stringify(tree);
  assert.ok(text.includes("6号 · 坏人"));
  assert.ok(!text.includes("第1轮"));
  assert.ok(!text.includes("立即遮盖"));
  assert.ok(byHandler(tree, "acknowledgeFairyResult"));
});

test("牌桌阶段集中待办、结果可回看，任务进度与座位明确分区", () => {
  const room = { phase: "tools", phaseName: "等待房主发起操作", flexible: true, capacity: 12, me: { seat: 1 }, team: [] };
  const data = { ...base, room, seatsExpanded: false, questSummary: { total: 1, success: 1, failure: 0 }, questTimeline: [{ key: 1, number: 1, questResult: "success" }], latestResult: { text: "任务成功", detail: "成功1张" } };
  const tree = render(data), text = JSON.stringify(tree);
  assert.equal((text.match(/等待房主发起操作/g) || []).length, 1);
  assert.ok(byHandler(tree, "showLatestRecord"));
  const progress = nodes(tree).find(n => n.attr?.class === "task-progress");
  assert.ok(JSON.stringify(progress).includes("任务进度"));
  assert.ok(byHandler(progress, "toggleSeats"));
  assert.ok(byHandler(progress, "showQuestRecord"));
  assert.ok(!text.includes("我在1号"));
  assert.ok(!text.includes("本阶段你无需操作"));
  const located = render({ ...data, focusedHistoryKey: 0, visibleHistory: [{ key: 0, text: "任务成功" }] });
  const record = nodes(located).find(n => n.attr?.id === "history-record-0");
  assert.equal(record.attr.class, "history-row history-row-focused");
  const pending = render({ ...data, room: { ...room, phase: "quest", needsSubmission: true }, actionEntryLabel: "提交任务牌" });
  const phase = nodes(pending).find(n => n.attr?.class === "phase-strip");
  assert.ok(byHandler(phase, "openAction"));
  assert.equal(byHandler(phase, "openAction").attr.class, "primary");
});


test("动态区仅等待及结束时显示结果，操作中提交前后均隐藏旧结果", () => {
  const room = { code: "123456", phase: "tools", phaseName: "等待房主发起操作", team: [], me: { seat: 1 }, capacity: 6 };
  const latestResult = { key: 0, text: "任务成功" };
  for (const [phase, submitted] of [["tools", false], ["ended", false], ["quest", false], ["quest", true], ["skillPrepare", false], ["skillPrepare", true], ["fairy", false], ["identity", false]]) {
    const tree = render({ ...base, room: { ...room, phase, needsSubmission: phase === "quest", me: { seat: 1, submitted } }, latestResult });
    const dynamic = nodes(tree).find(n => n.attr?.class?.startsWith("table-dynamics "));
    const children = nodes(dynamic);
    const phaseIndex = children.findIndex(n => n.attr?.class === "phase-strip");
    const resultIndex = children.findIndex(n => n.attr?.class === "latest-result");
    if (["tools", "ended"].includes(phase)) assert.ok(resultIndex >= 0 && resultIndex < phaseIndex);
    else {
      assert.equal(resultIndex, -1);
      assert.ok(phaseIndex >= 0);
      assert.ok(!JSON.stringify(dynamic).includes("任务成功"));
    }
    const summary = nodes(tree).find(n => n.attr?.class === "room-summary");
    assert.ok(byHandler(summary, "reveal"));
  }
  const empty = render({ ...base, room });
  assert.ok(!nodes(empty).some(n => n.attr?.class === "latest-result"));
});

test("旧房间摘要缺少字段时不伪造房主、活动时间或离开限制", () => {
  const legacy = { code: "438671", isHost: true, isMember: true, capacity: 12, phaseName: "入座与准备" };
  const data = { ...base, memberRooms: [legacy], visibleMemberRooms: [legacy], roomMenu: legacy };
  const tree = render(data);
  const text = JSON.stringify(tree);
  assert.ok(!text.includes("房主：未知"));
  assert.ok(!text.includes("最近活动"));
  assert.ok(!text.includes("对局中不能离开"));
  assert.ok(text.includes("离开权限暂未同步"));
  const leave = nodes(tree).find(n => n.attr?.["data-kind"] === "leave");
  assert.equal(leave.attr.disabled, true);
  const current = { ...legacy, hostName: "小王", updatedAt: 123, activityLabel: "9/22 11:10", canLeave: true };
  const fresh = render({ ...data, visibleMemberRooms: [current], roomMenu: current });
  assert.ok(JSON.stringify(fresh).includes("小王"));
  assert.ok(JSON.stringify(fresh).includes("9/22 11:10"));
  assert.equal(nodes(fresh).find(n => n.attr?.["data-kind"] === "leave").attr.disabled, false);
});

test("读取身份只让身份入口加载，不触发提交或结算动画", () => {
  const data = { ...base, busy: true, busyAction: "identity", room: { phase: "tools", me: { seat: 1 }, canUseTools: true, hasActiveOperation: true }, canSettle: true };
  const tree = render(data);
  assert.equal(byHandler(tree, "reveal").attr.loading, true);
  const settle = byHandler(tree, "settleTool");
  assert.ok(settle);
  assert.equal(settle.attr.loading, false);
  const action = render({ ...data, busyAction: "actionIdentity", room: { phase: "identity", needsSubmission: true, me: { seat: 1 } }, actionDialog: true, stagedChoice: true, draftChoice: "confirm" });
  assert.equal(byHandler(action, "revealActionIdentity").attr.loading, true);
  assert.equal(byHandler(action, "confirmChoice").attr.loading, false);
});

test("技能网格独立选择，底部确认默认禁用并显示明确目标", () => {
  const data = { ...base, room: { phase: "skillPrepare", needsSubmission: true, me: { submitted: false }, team: [] },
    actionDialog: true, skillAction: true, skillTitle: "使用技能 · 开刀", skillHint: "请选择目标", skillBodyHeight: 164,
    skillTargets: [{ value: "target:2", label: "对 2号开刀", seat: 2, name: "玩家乙" }],
    skillOtherChoices: [{ value: "pass", label: "本轮不使用技能" }], swapOptions: [], swapPlayers: [], swapSeats: [],
  };
  const initial = render(data);
  assert.equal(nodes(initial).filter(n => n.attr?.bindtap === "submitChoice").length, 2);
  assert.equal(byHandler(initial, "confirmChoice").attr.disabled, true);
  assert.ok(!byHandler(initial, "confirmSwap"));
  const selected = render({ ...data, draftChoice: "target:2", draftLabel: "对 2号开刀" });
  assert.equal(byHandler(selected, "confirmChoice").attr.disabled, false);
  assert.match(JSON.stringify(byHandler(selected, "confirmChoice")), /确认对 2号开刀/);
  assert.ok(nodes(selected).some(n => n.attr?.class?.includes("skill-option is-selected")));
  const offline = render({ ...data, draftChoice: "target:2", network: false });
  assert.equal(byHandler(offline, "confirmChoice").attr.disabled, true);
});
