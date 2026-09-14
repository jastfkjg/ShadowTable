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
    action: { label: "选择任务牌" },
  };
  const hidden = render({ ...base, room, secret });
  assert.ok(!JSON.stringify(hidden).includes("梅林"));
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

test("默认加入且标语移除，牌桌删除仅房主可见", () => {
  const tree = render({
    ...base,
    memberRooms: [
      { code: "123456", isHost: true },
      { code: "234567", isHost: false },
    ],
  });
  assert.equal(byHandler(tree, "create"), undefined);
  assert.ok(byHandler(tree, "join"));
  assert.equal(JSON.stringify(tree).includes("面对面，暗中行事"), false);
  const buttons = nodes(tree).filter((n) => n.attr?.bindtap === "deleteRoom");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].attr["data-code"], "123456");
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
    nodes(host).some((n) => n.attr?.bindchange === "configureCapacity"),
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
  assert.ok(JSON.stringify(done).includes("本轮操作已提交"));
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
      4,
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
    history: [{ key: 0, text: "已有记录", detail: "已结算" }],
    secret: { role: "测试私密角色", information: "隐私" },
  });
  const serialized = JSON.stringify(tree);
  assert.ok(!serialized.includes("身份已遮盖"));
  assert.ok(!serialized.includes("测试私密角色"));
  assert.ok(byHandler(tree, "reveal"));
  assert.ok(serialized.includes("未完成"));
  assert.ok(serialized.includes("无需操作"));
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
