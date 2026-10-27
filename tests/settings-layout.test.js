const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");

const root = path.resolve(__dirname, "../miniprogram");
const context = vm.createContext({ window: {}, global: {}, console });
const factory = vm.runInContext("(function(global){" + wxmlToJs(root) + "})(global)", context);
const render = factory("pages/settings/settings.wxml");
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...(node.children || []).flatMap(nodes)];
const handler = (tree, name) => nodes(tree).find(node => node.attr?.bindchange === name);

test("房间配置卡片保留准备阶段的原生选择器与进行中的只读状态", () => {
  const data = {
    loading: false, authorized: true, busy: false, refreshing: false, pendingSave: false,
    pendingTransfer: false, pendingKick: false, capacity: 6, capacityIndex: 0, boardIndex: 0,
    choices: [{ name: "阿瓦隆 · 经典基础" }], transferPlayers: [],
    room: { code: "514047", phase: "lobby", capacity: 6, boardName: "阿瓦隆 · 经典基础" },
  };
  const lobby = render(data);
  assert.equal(handler(lobby, "pickCapacity").attr.disabled, false);
  assert.equal(handler(lobby, "pickBoard").attr.disabled, false);
  const saving = render({ ...data, pendingSave: true });
  assert.equal(handler(saving, "pickCapacity").attr.disabled, true);
  assert.equal(handler(saving, "pickBoard").attr.disabled, true);
  const playing = render({ ...data, room: { ...data.room, phase: "tools" } });
  assert.equal(handler(playing, "pickCapacity"), undefined);
  assert.equal(handler(playing, "pickBoard"), undefined);
  assert.match(JSON.stringify(playing), /对局进行中/);
  assert.match(JSON.stringify(playing), /阿瓦隆 · 经典基础/);
});

test("自动保存状态始终位于房间信息内，不在配置区前插入或移除占位行", () => {
  const data = {
    loading: false, authorized: true, busy: false, refreshing: false, pendingSave: false,
    pendingTransfer: false, pendingKick: false, dirty: false, capacity: 6,
    choices: [{ name: "经典基础" }], boardIndex: 0, transferPlayers: [],
    room: { code: "514047", phase: "lobby", capacity: 6, boardName: "经典基础" },
  };
  const states = [
    [data, ""],
    [{ ...data, dirty: true }, "尚未保存"],
    [{ ...data, dirty: true, pendingSave: true, busy: true }, "正在保存…"],
    [{ ...data, dirty: true, pendingSave: true }, "保存未确认"],
  ];
  for (const [state, expected] of states) {
    const tree = render(state);
    const header = nodes(tree).find(node => node.attr?.class === "settings-header");
    const status = nodes(header).find(node => node.attr?.class === "settings-save-status");
    assert.ok(status);
    assert.equal(status.attr.role, "status");
    assert.equal(status.children.join(""), expected);
    const page = nodes(tree).find(node => node.attr?.class === "page settings-page");
    const pageChildren = nodes(page).find(node => node.children?.includes(header));
    const contents = pageChildren.children.filter(node => node && typeof node === "object");
    const headerIndex = contents.indexOf(header);
    assert.equal(contents[headerIndex + 1].attr.class, "settings-section-title");
  }
});
