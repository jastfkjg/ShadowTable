const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { BOARDS } = require("../server/engine");
function page(api, wxOverrides = {}) {
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
        navigateBack: () => {},
        redirectTo: () => {},
        showModal: (o) => o.success({ confirm: true }),
        ...wxOverrides,
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

test("设置保存401后重新登录并沿用原请求编号与内容恢复", async () => {
  let authenticated = true,
    expired = false,
    logins = 0;
  const writes = [];
  const p = page({
    login: async () => {
      logins++;
      authenticated = true;
    },
    requestId: () => "original-save",
    request: async (path, method, data, id) => {
      if (method === "POST") {
        writes.push({ id, data: JSON.stringify(data), authenticated });
        if (!expired) {
          expired = true;
          authenticated = false;
          throw Object.assign(new Error("登录已过期"), { status: 401 });
        }
        if (!authenticated)
          throw Object.assign(new Error("登录已过期"), { status: 401 });
        return { ok: true };
      }
      return path === "/api/boards" ? { boards: BOARDS } : room();
    },
  });
  await p.load();
  p.toggleVisibility({ detail: { value: true } });
  await p.save();
  assert.equal(p.data.pendingSave, true);
  const beforeRetry = logins;
  await p.save();
  assert.ok(logins > beforeRetry);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].authenticated, true);
  assert.equal(writes[1].id, writes[0].id);
  assert.equal(writes[1].data, writes[0].data);
  assert.equal(p.pending, null);
  assert.equal(p.data.pendingSave, false);
});

const transferRoom = () => ({
  ...room(),
  players: [
    { seat: 1, name: "甲" },
    { seat: 2, name: "乙" },
  ],
  me: { isHost: true, seat: 1 },
});
test("设置页在各阶段可移交，成功后退出管理页面", async () => {
  for (const phase of ["lobby", "tools", "ended", "terminated"]) {
    const writes = [];
    let returned = false;
    const p = page(
      {
        login: async () => {},
        requestId: () => "transfer-id",
        request: async (path, method, data) => {
          if (method === "POST") {
            writes.push(data);
            return { ok: true };
          }
          return path === "/api/boards"
            ? { boards: BOARDS }
            : { ...transferRoom(), phase };
        },
      },
      {
        navigateBack: () => {
          returned = true;
        },
      },
    );
    await p.load();
    assert.equal(p.data.transferPlayers.length, 1);
    await p.transfer({ currentTarget: { dataset: { seat: 1 } } });
    assert.equal(writes.length, 0);
    await p.transfer({ currentTarget: { dataset: { seat: 2 } } });
    assert.equal(writes[0].type, "transfer");
    assert.equal(writes[0].seat, 2);
    assert.equal(p.data.authorized, false);
    assert.equal(returned, true);
  }
});
test("移交取消不提交，网络未确认时沿用原请求重试", async () => {
  const writes = [];
  let confirmed = false;
  const p = page(
    {
      login: async () => {},
      requestId: () => "transfer-id",
      request: async (path, method, data, id) => {
        if (method === "POST") {
          writes.push({ id, data: JSON.stringify(data) });
          if (writes.length === 1) throw new Error("网络未确认");
          return { ok: true };
        }
        return path === "/api/boards" ? { boards: BOARDS } : transferRoom();
      },
    },
    { showModal: (o) => o.success({ confirm: confirmed }) },
  );
  await p.load();
  const event = { currentTarget: { dataset: { seat: 2 } } };
  await p.transfer(event);
  assert.equal(writes.length, 0);
  confirmed = true;
  await p.transfer(event);
  assert.equal(p.data.pendingTransfer, true);
  await p.save();
  assert.equal(writes.length, 1);
  await p.sendTransfer();
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(p.data.pendingTransfer, false);
});
test("移交阶段冲突刷新，权限撤销后禁止继续移交", async () => {
  for (const status of [409, 403]) {
    let changed = false;
    const p = page({
      login: async () => {},
      requestId: () => "transfer-id",
      request: async (path, method) => {
        if (method === "POST") {
          changed = true;
          throw Object.assign(new Error("请求失效"), { status });
        }
        return path === "/api/boards"
          ? { boards: BOARDS }
          : { ...transferRoom(), stage: changed ? "s2" : "s1" };
      },
    });
    await p.load();
    await p.transfer({ currentTarget: { dataset: { seat: 2 } } });
    assert.equal(p.transferPending, null);
    assert.equal(p.data.busy, false);
    if (status === 409) assert.equal(p.original.stage, "s2");
    else assert.equal(p.data.authorized, false);
  }
});

test("移交选择弹窗按需打开，取消不提交，空房或保存中不可打开", () => {
  const p = page({});
  p.data.authorized = true;
  p.openTransfer();
  assert.equal(p.data.showTransferPicker, false);
  p.data.transferPlayers = [{ seat: 2, name: "乙" }];
  p.openTransfer();
  assert.equal(p.data.showTransferPicker, true);
  p.closeTransfer();
  assert.equal(p.data.showTransferPicker, false);
  assert.equal(p.transferPending, undefined);
  p.pending = { id: "saving" };
  p.openTransfer();
  assert.equal(p.data.showTransferPicker, false);
});

function kickRoom() {
  return { ...room(), phase: "lobby", canKick: true, me: { isHost: true, seat: 1 }, players: [{ seat: 1, name: "房主", managementId: "m1" }, { seat: 2, name: "同名玩家", managementId: "m2" }, { seat: 3, name: "同名玩家", managementId: "m3" }] };
}
const chooseKick = p => p.kick({ currentTarget: { dataset: { seat: 2 } } });
test("设置页移出需确认，取消无请求，进行中不打开选择列表", async () => {
  const writes = [];
  let prompt;
  const p = page({ login: async () => {}, request: async (path, method, data) => {
    if (method === "POST") writes.push(data);
    return path === "/api/boards" ? { boards: BOARDS } : kickRoom();
  } }, { showModal: options => { prompt = options; options.success({ confirm: false }); } });
  await p.load();
  p.openKick();
  assert.equal(p.data.showKickPicker, true);
  await chooseKick(p);
  assert.match(prompt.content, /2号 · 同名玩家/);
  assert.equal(prompt.confirmText, "移出");
  assert.equal(writes.length, 0);
  p.closeKick();
  p.data.room.canKick = false;
  p.openKick();
  await chooseKick(p);
  assert.equal(p.data.showKickPicker, false);
  assert.equal(writes.length, 0);
});
test("移出请求丢失响应时重试原编号和成员，成功保留未保存设置", async () => {
  let r = kickRoom(), dropped = true;
  const writes = [];
  const p = page({ login: async () => {}, requestId: () => "kick-request", request: async (path, method, data, id) => {
    if (method === "POST") {
      writes.push({ id, data });
      r = { ...r, stage: "s2", players: r.players.filter(p => p.seat !== 2) };
      if (dropped) { dropped = false; throw new Error("响应丢失"); }
      return { accepted: true };
    }
    return path === "/api/boards" ? { boards: BOARDS } : r;
  } });
  await p.load();
  p.toggleVisibility({ detail: { value: true } });
  await chooseKick(p);
  assert.equal(p.data.pendingKick, true);
  p.openTransfer();
  assert.equal(p.data.showTransferPicker, false);
  await p.save();
  assert.equal(writes.length, 1);
  await p.sendKick();
  assert.equal(p.data.pendingKick, false);
  assert.equal(p.data.visible, true);
  assert.equal(p.data.dirty, true);
  assert.equal(p.data.transferPlayers.length, 1);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].data.targetId, "m2");
  assert.equal(writes[0].data.stage, "s1");
});
test("移出确认后房间变化时刷新列表，不自动重试新成员", async () => {
  let r = kickRoom(), count = 0;
  const p = page({ login: async () => {}, requestId: () => "kick-request", request: async (path, method) => {
    if (method === "POST") { count++; r = { ...r, stage: "s2", phase: "tools", canKick: false }; throw Object.assign(new Error("状态变化"), { status: 409 }); }
    return path === "/api/boards" ? { boards: BOARDS } : r;
  } });
  await p.load();
  await chooseKick(p);
  assert.equal(count, 1);
  assert.equal(p.data.pendingKick, false);
  assert.equal(p.data.room.canKick, false);
  assert.match(p.data.error, /房间或座位已变化/);
});
