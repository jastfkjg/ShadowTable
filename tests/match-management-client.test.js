"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function client(api) {
  const nodes = new Map();
  const node = (id) => ({
    id,
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    open: false,
    children: [],
    dataset: {},
    classList: { toggle() {} },
    events: {},
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    addEventListener(event, handler) {
      this.events[event] = handler;
    },
    setAttribute() {},
    focus() {},
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelectorAll() {
      return [];
    },
  });
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, node(id));
    return nodes.get(id);
  };
  const context = {
    $,
    api,
    el: (tag, text) => ({ ...node(tag), textContent: text }),
    window: {},
    document: { querySelectorAll: () => [], activeElement: null },
    scoreBusy: false,
    scoreWritePending: null,
    correctionBusy: false,
    correctionPending: null,
    correctionLoading: false,
    matchScoreLoading: false,
    matchScoreDetail: null,
    correctionMatches: [],
    selectedScorePlayer: null,
    crypto: { randomUUID: () => "same-request-id" },
    Date,
    URLSearchParams,
    matchScoreChanges: () => [],
    selectOptions() {},
    updateCorrectionMatch: async () => {},
    loadPlayerScore: async () => {},
  };
  const source = fs.readFileSync(
    require.resolve("../server/admin/matches.js"),
    "utf8",
  );
  vm.runInNewContext(
    source.replace(
      /\}\)\(\);\s*$/,
      `window.test={begin,submit,updateSelection,load,selected,locked,
   setup(data){rows=data;selection=new Set(data.map(row=>row.id));},state(){return {pending,busy,selection:[...selection]};}};})();`,
    ),
    context,
  );
  return { c: context.window.test, nodes, $, context };
}
const records = [
  {
    id: "a",
    state: "active",
    revision: 0,
    code: "123456",
    endedAt: 1,
    game: 1,
    boardName: "经典基础",
  },
  {
    id: "b",
    state: "excluded",
    revision: 2,
    code: "123456",
    endedAt: 2,
    game: 2,
    boardName: "经典基础",
  },
];

test("混合状态选择只能删除，已删除记录只能恢复；操作范围明确标注整局所有人", () => {
  const { c, $ } = client(async () => {});
  c.setup(records);
  c.updateSelection();
  assert.equal($("record-delete").disabled, false);
  assert.equal($("record-exclude").disabled, true);
  assert.equal($("record-include").disabled, true);
  assert.equal($("record-restore").disabled, true);
  assert.match($("record-selection").textContent, /2 场.*整局所有参与者/);
  c.setup([{ ...records[0], state: "deleted" }]);
  c.updateSelection();
  assert.equal($("record-delete").disabled, true);
  assert.equal($("record-restore").disabled, false);
});
test("网络结果未确认时冻结操作内容并复用请求编号，取消受阻，重试不受备注变化影响", async () => {
  let writes = 0;
  const sent = [];
  const { c, $ } = client(async (path, input) => {
    if (path.endsWith("preview"))
      return { matches: records, affectedPlayers: 0, players: [] };
    sent.push(JSON.parse(JSON.stringify(input)));
    writes++;
    if (writes === 1) throw Error("timeout");
    throw Object.assign(Error("对局已更新"), { status: 409 });
  });
  c.setup(records);
  await c.begin("delete");
  assert.equal($("record-confirm").open, true);
  assert.match($("record-confirm-description").textContent, /整局所有参与者/);
  $("record-note").value = "确认清理";
  await c.submit();
  assert.equal($("record-confirm-cancel").disabled, true);
  assert.equal($("record-reason").disabled, true);
  assert.equal(c.state().pending.submitted, true);
  $("record-note").value = "后来输入";
  await c.submit();
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[0].requestId, "same-request-id");
  assert.match(sent[0].reason, /确认清理/);
  assert.equal(c.state().pending, null);
  assert.equal($("record-confirm-cancel").disabled, false);
  assert.equal($("record-confirm-submit").disabled, true);
  assert.match($("record-confirm-error").textContent, /刷新后重新预览/);
});
test("管理登录过期后清空可见数据但保留待确认请求，重新登录可恢复同一请求", async () => {
  const { c, $, context } = client(async (path) => {
    if (path.endsWith("preview"))
      return { matches: records, affectedPlayers: 0, players: [] };
    context.window.MatchRecords.clear();
    throw Object.assign(Error("请先登录"), { status: 401 });
  });
  c.setup(records);
  await c.begin("delete");
  await c.submit();
  assert.equal($("record-confirm").open, false);
  assert.equal(c.state().pending.requestId, "same-request-id");
  assert.equal(c.selected().length, 0);
  context.window.MatchRecords.resume();
  assert.equal($("record-confirm").open, true);
  assert.equal($("record-confirm-submit").disabled, false);
  assert.equal(c.locked(), true);
});

test("小程序测试用途自动保存，网络未确认时锁定并复用原请求，发牌后与旧服务隐藏能力时不能更改", async () => {
  const { BOARDS } = require("../server/engine");
  let r = {
    code: "123456",
    board: "classic",
    boardName: "经典基础",
    capacity: 6,
    phase: "lobby",
    stage: "s1",
    players: [{ seat: 1 }],
    me: { isHost: true, seat: 1 },
    fairyEnabled: false,
    scoreSettings: {
      enabled: true,
      editable: true,
      defaultEnabledMinPlayers: 10,
    },
    recordSettings: { purpose: "normal", editable: true },
  };
  let definition,
    fail = true;
  const writes = [];
  const api = {
    login: async () => {},
    requestId: () => "same-purpose-request",
    request: async (url, method, data, id) => {
      if (method === "POST") {
        writes.push({ id, data: JSON.stringify(data) });
        if (fail) throw Error("网络未确认");
        if (r.recordSettings) r.recordSettings.purpose = data.recordPurpose;
        r.scoreSettings.enabled = data.scoreEnabled;
        return { accepted: true };
      }
      return url === "/api/boards" ? { boards: BOARDS } : structuredClone(r);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      require.resolve("../miniprogram/pages/settings/settings.js"),
      "utf8",
    ),
    {
      require: () => api,
      Page: (p) => (definition = p),
      wx: { showToast() {} },
    },
  );
  const p = {
    ...definition,
    data: structuredClone(definition.data),
    alive: true,
    foreground: true,
    code: r.code,
    setData(data) {
      Object.assign(this.data, data);
    },
  };
  await p.load();
  await p.toggleRecordPurpose({ detail: { value: true } });
  assert.equal(p.data.pendingSave, true);
  assert.equal(p.data.recordPurpose, "test");
  await p.toggleRecordPurpose({ detail: { value: false } });
  assert.equal(writes.length, 1);
  fail = false;
  await p.save();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(p.data.pendingSave, false);
  assert.equal(p.data.scoreEnabled, true);
  r.phase = "tools";
  r.recordSettings.editable = false;
  await p.load();
  await p.toggleRecordPurpose({ detail: { value: false } });
  assert.equal(writes.length, 2);
  delete r.recordSettings;
  await p.load();
  r.scoreSettings.editable = true;
  await p.toggleScoring({ detail: { value: false } });
  assert.equal(
    Object.hasOwn(JSON.parse(writes[2].data), "recordPurpose"),
    false,
  );
});
