const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { BOARDS } = require("../server/engine");
function page(api) {
  let definition;
  vm.runInNewContext(
    fs.readFileSync(
      require.resolve("../miniprogram/pages/settings/settings.js"),
      "utf8",
    ),
    {
      require: () => api,
      Page: (p) => (definition = p),
      wx: {
        showToast: () => {},
        showModal: (o) => o.success({ confirm: true }),
      },
    },
  );
  return {
    ...definition,
    data: structuredClone(definition.data),
    alive: true,
    foreground: true,
    code: "123456",
    setData(d) {
      Object.assign(this.data, d);
    },
  };
}
const room = () => ({
  code: "123456",
  board: "knights",
  boardName: "十二骑士",
  capacity: 12,
  phase: "tools",
  stage: "s1",
  players: [{ seat: 1 }],
  me: { isHost: true },
  showSkillDetails: false,
});
test("设置页仅管理员可进入，不读取他人的设置表单", async () => {
  const p = page({
    login: async () => {},
    request: async () => ({ ...room(), me: { isHost: false } }),
  });
  await p.load();
  assert.equal(p.data.authorized, false);
  assert.ok(p.data.error.includes("仅房主管理员"));
  assert.equal(p.data.room, null);
});
test("开关先修改草稿，点击保存才原子提交；保存后显示服务端状态", async () => {
  let r = room();
  const writes = [];
  const p = page({
    login: async () => {},
    requestId: () => "id1",
    request: async (path, method, data) => {
      if (method === "POST") {
        writes.push(data);
        r = { ...r, showSkillDetails: data.visible };
        return { ok: true };
      }
      return path === "/api/boards" ? { boards: BOARDS } : r;
    },
  });
  await p.load();
  assert.equal(p.data.dirty, false);
  p.toggleVisibility({ detail: { value: true } });
  assert.equal(writes.length, 0);
  assert.equal(p.data.dirty, true);
  await p.save();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "updateSettings");
  assert.equal(writes[0].visible, true);
  assert.equal(p.data.dirty, false);
});
test("设置保存网络未确认时重试保持原请求，阶段变化后刷新而不反复失败", async () => {
  let failed = true;
  const ids = [];
  const p = page({
    login: async () => {},
    requestId: () => "same-id",
    request: async (path, method, data, id) => {
      if (method === "POST") {
        ids.push(id);
        if (failed) throw new Error("网络未确认");
        return { ok: true };
      }
      return path === "/api/boards" ? { boards: BOARDS } : room();
    },
  });
  await p.load();
  p.toggleVisibility({ detail: { value: true } });
  await p.save();
  assert.equal(p.data.pendingSave, true);
  failed = false;
  await p.save();
  assert.deepEqual(ids, ["same-id", "same-id"]);
  assert.equal(p.pending, null);
});

test("保存时阶段已变化会刷新设置，不重复提交旧阶段", async () => {
  let changed = false;
  const p = page({
    login: async () => {},
    requestId: () => "id",
    request: async (path, method) => {
      if (method === "POST") {
        changed = true;
        throw Object.assign(new Error("阶段已变化"), { status: 409 });
      }
      return path === "/api/boards"
        ? { boards: BOARDS }
        : { ...room(), stage: changed ? "s2" : "s1" };
    },
  });
  await p.load();
  p.toggleVisibility({ detail: { value: true } });
  await p.save();
  assert.equal(p.original.stage, "s2");
  assert.equal(p.data.dirty, false);
  assert.equal(p.pending, null);
  assert.ok(p.data.error.includes("重新修改"));
});
