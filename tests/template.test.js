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
  assert.ok(byHandler(shown, "submitChoice"));
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
