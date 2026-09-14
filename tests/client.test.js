const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app");
function page(api, storage = new Map()) {
  let definition;
  const wx = {
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, v),
    removeStorageSync: (k) => storage.delete(k),
    showModal: (o) => o.success({ confirm: true }),
  };
  vm.runInNewContext(
    fs.readFileSync(
      require.resolve("../miniprogram/pages/table/table.js"),
      "utf8",
    ),
    {
      require: () => api,
      Page: (p) => (definition = p),
      wx,
      setTimeout,
      clearTimeout,
    },
  );
  const p = {
    ...definition,
    data: structuredClone(definition.data),
    alive: true,
    foreground: true,
    generation: 0,
    setData(data) {
      Object.assign(this.data, data);
    },
  };
  p.schedule = () => {};
  return p;
}
async function server() {
  const a = createApp({ database: ":memory:", devAuth: true });
  await new Promise((r) => a.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + a.server.address().port;
  return {
    async actor(storage) {
      let token;
      const api = {
        login: async () => {},
        requestId: randomUUID,
        async request(path, method = "GET", body, id) {
          const r = await fetch(base + path, {
            method,
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
              ...(id ? { "Idempotency-Key": id } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          const data = await r.json();
          if (!r.ok) {
            const e = new Error(data.error);
            e.status = r.status;
            throw e;
          }
          return data;
        },
      };
      token = (await api.request("/api/dev-login", "POST", {})).token;
      return page(api, storage);
    },
    async close() {
      await new Promise((r) => a.server.close(r));
      a.store.close();
    },
  };
}
async function settle(p) {
  while (p.data.busy) await new Promise((r) => setTimeout(r, 1));
  assert.equal(p.data.error, "");
}
async function cmd(p, type, extra = {}) {
  p.cmd(type, extra);
  await settle(p);
}
test("六个小程序页面控制器经真实HTTP完成一局并同房重开", async () => {
  const a = await server();
  try {
    const ps = [];
    for (let i = 0; i < 6; i++) ps.push(await a.actor());
    ps[0].setData({ name: "房主", loading: false });
    ps[0].create();
    await settle(ps[0]);
    const code = ps[0].roomCode;
    for (let i = 1; i < 6; i++) {
      ps[i].setData({ name: "玩家" + i, code, loading: false });
      ps[i].join();
      await settle(ps[i]);
    }
    const refresh = () => Promise.all(ps.map((p) => p.refresh()));
    await refresh();
    await Promise.all(ps.map((p) => cmd(p, "ready", { ready: true })));
    await cmd(ps[0], "start");
    await refresh();
    for (const p of ps) {
      assert.equal(p.data.revealed, false);
      await p.reveal();
      assert.ok(p.data.secret.role);
      await cmd(p, "submit", { value: "confirm" });
      assert.equal(p.data.secret, null);
    }
    await cmd(ps[0], "advance");
    await refresh();
    for (let q = 0; q < 3; q++) {
      const r = ps[0].data.room,
        leader = ps.find((p) => p.data.room.me.seat === r.leader);
      await cmd(leader, "propose", {
        team: Array.from({ length: r.teamSize }, (_, i) => i + 1),
      });
      await cmd(ps[0], "advance");
      await refresh();
      await Promise.all(ps.map((p) => cmd(p, "submit", { value: "approve" })));
      await cmd(ps[0], "advance");
      await cmd(ps[0], "advance");
      await refresh();
      for (const p of ps) {
        await p.reveal();
        const value = p.data.choiceButtons.some((b) => b.value === "success")
          ? "success"
          : "confirm";
        await cmd(p, "submit", { value });
      }
      await cmd(ps[0], "advance");
      await cmd(ps[0], "advance");
      await refresh();
    }
    assert.equal(ps[0].data.room.phase, "assassination");
    const roles = [];
    for (const p of ps) {
      await p.reveal();
      roles.push({ p, role: p.data.secret.role });
    }
    const target = roles.find((r) => r.role === "亚瑟的忠臣").p.data.room.me
      .seat;
    for (const { p, role } of roles)
      await cmd(p, "submit", { value: role === "刺客" ? target : "confirm" });
    await cmd(ps[0], "advance");
    await refresh();
    for (const p of ps) assert.equal(p.data.room.result.winner, "good");
    await cmd(ps[0], "rematch");
    await refresh();
    assert.ok(
      ps.every((p) => p.data.room.phase === "lobby" && !p.data.revealed),
    );
  } finally {
    await a.close();
  }
});
test("身份请求延迟到切后台之后，不能重新揭牌", async () => {
  let resolve;
  const p = page({ request: () => new Promise((r) => (resolve = r)) });
  p.roomCode = "123456";
  p.setData({ room: { stage: "s" }, network: true });
  const request = p.reveal();
  p.onHide();
  resolve({ stage: "s", role: "梅林", action: { choices: ["confirm"] } });
  await request;
  assert.equal(p.data.secret, null);
  assert.equal(p.data.revealed, false);
});
test("服务器已落库但确认丢失：保留编号并重试，不提前报成功", async () => {
  let attempts = 0;
  const ids = [];
  const p = page({
    login: async () => {},
    requestId: () => "fixed-request-12345",
    request: async (path, method, data, id) => {
      ids.push(id);
      if (++attempts === 1) throw new Error("连接中断");
      return { code: "123456" };
    },
  });
  p.refresh = async () => {};
  await p.mutate("/api/rooms", { name: "甲" }, "enter");
  assert.equal(p.data.notice, "");
  assert.ok(p.pending);
  await p.retry();
  assert.equal(p.pending, null);
  assert.equal(ids[0], ids[1]);
  assert.equal(p.data.notice, "");
  assert.equal(p.data.serverConnected, true);
});
test("后台旧公共响应不能覆盖较新阶段", async () => {
  const resolves = [];
  const p = page({ request: () => new Promise((r) => resolves.push(r)) });
  p.roomCode = "123456";
  const old = p.refresh(),
    fresh = p.refresh();
  const view = (stage) => ({
    stage,
    capacity: 6,
    players: [],
    team: [],
    history: [],
    me: { seat: 1 },
  });
  resolves[1](view("new"));
  await fresh;
  resolves[0](view("old"));
  await old;
  assert.equal(p.data.room.stage, "new");
});

test("确认弹窗期间阶段变化，不把旧确认提交到新阶段", async () => {
  const p = page({});
  let resolve;
  let called = false;
  p.setData({ room: { stage: "old" } });
  p.confirm = () => new Promise((r) => (resolve = r));
  p.cmd = () => (called = true);
  const pending = p.terminate();
  p.setData({ room: { stage: "new" } });
  resolve(true);
  await pending;
  assert.equal(called, false);
  assert.ok(p.data.error.includes("阶段已变化"));
});

test("应用重启可恢复未确认的建房请求，且不持久化秘密动作", async () => {
  const storage = new Map();
  const ids = [];
  let first = true;
  const api = {
    login: async () => {},
    requestId: () => "restart-safe-request",
    request: async (path, method, data, id) => {
      if (path === "/api/boards") return { boards: [] };
      ids.push(id);
      if (first) {
        first = false;
        throw new Error("响应丢失");
      }
      return { code: "123456" };
    },
  };
  const p = page(api, storage);
  p.refresh = async () => {};
  await p.mutate("/api/rooms", { name: "甲" }, "enter");
  assert.ok(storage.has("pendingEntry"));
  const resumed = page(api, storage);
  resumed.refresh = async () => {};
  await resumed.bootstrap();
  assert.equal(ids[0], ids[1]);
  assert.equal(resumed.roomCode, "123456");
  assert.equal(storage.has("pendingEntry"), false);
  const secret = page(
    {
      ...api,
      request: async () => {
        throw new Error("响应丢失");
      },
    },
    storage,
  );
  await secret.mutate("/api/rooms/123456/commands", {
    type: "submit",
    value: "fail",
  });
  assert.equal(storage.has("pendingEntry"), false);
});

for (const [board, count] of [
  ["classic-11", 11],
  ["shadow-assist", 12],
]) {
  test(`${count}个页面经HTTP贯通${board}至结算和重开`, async () => {
    const a = await server();
    try {
      const ps = [];
      for (let i = 0; i < count; i++) ps.push(await a.actor());
      ps[0].setData({
        name: "房主",
        loading: false,
        boardId: board,
        capacity: count,
      });
      ps[0].create();
      await settle(ps[0]);
      for (let i = 1; i < count; i++) {
        ps[i].setData({
          name: "玩家" + i,
          code: ps[0].roomCode,
          loading: false,
        });
        ps[i].join();
        await settle(ps[i]);
      }
      const refresh = () => Promise.all(ps.map((p) => p.refresh()));
      await refresh();
      await Promise.all(ps.map((p) => cmd(p, "ready", { ready: true })));
      await cmd(ps[0], "start");
      await refresh();
      const cards = [];
      for (const p of ps) {
        await p.reveal();
        cards.push({
          p,
          role: p.data.secret.role,
          side: p.data.secret.faction,
        });
        await cmd(p, "submit", { value: "confirm" });
      }
      await cmd(ps[0], "advance");
      await refresh();
      const good = cards
        .filter((c) => c.side === "好人阵营")
        .map((c) => c.p.data.room.me.seat);
      for (let q = 0; q < 3; q++) {
        const r = ps[0].data.room,
          leader = ps.find((p) => p.data.room.me.seat === r.leader);
        await cmd(leader, "propose", { team: good.slice(0, r.teamSize) });
        await cmd(ps[0], "advance");
        await refresh();
        await Promise.all(
          ps.map((p) => cmd(p, "submit", { value: "approve" })),
        );
        await cmd(ps[0], "advance");
        await cmd(ps[0], "advance");
        await refresh();
        for (const p of ps) {
          await p.reveal();
          const value = p.data.choiceButtons.some((b) => b.value === "success")
            ? "success"
            : "confirm";
          await cmd(p, "submit", { value });
        }
        await cmd(ps[0], "advance");
        await cmd(ps[0], "advance");
        await refresh();
      }
      if (board === "classic-11") {
        assert.equal(ps[0].data.room.phase, "reverseStrike");
        const reverse = cards.find((c) => c.role === "逆仆");
        const assassin = cards.find((c) => c.role === "刺客");
        for (const p of ps)
          await cmd(p, "submit", {
            value: p === assassin.p ? reverse.p.data.room.me.seat : "confirm",
          });
        await cmd(ps[0], "advance");
        await refresh();
        await reverse.p.reveal();
        assert.equal(reverse.p.data.secret.faction, "坏人阵营");
        const merlin = cards.find((c) => c.role === "梅林");
        for (const p of ps)
          await cmd(p, "submit", {
            value: p === assassin.p ? merlin.p.data.room.me.seat : "confirm",
          });
        await cmd(ps[0], "advance");
        assert.equal(ps[0].data.room.result.winner, "evil");
      } else {
        assert.equal(ps[0].data.room.phase, "offlineFinal");
        await cmd(ps[0], "closeOffline");
        assert.equal(ps[0].data.room.result.winner, null);
      }
      await cmd(ps[0], "rematch");
      await refresh();
      assert.ok(
        ps.every((p) => p.data.room.phase === "lobby" && !p.data.revealed),
      );
    } finally {
      await a.close();
    }
  });
}

test("新邀请不会被本地旧房间覆盖，仍可从成员列表恢复旧房间", async () => {
  const storage = new Map([["roomCode", "111111"]]);
  const paths = [];
  const p = page(
    {
      login: async () => {},
      request: async (path) => {
        paths.push(path);
        if (path === "/api/boards") return { boards: [] };
        if (path === "/api/me/rooms")
          return { rooms: [{ code: "111111", seat: 1 }] };
        throw new Error("不应自动进入旧房间");
      },
    },
    storage,
  );
  p.inviteCode = "222222";
  await p.bootstrap();
  assert.equal(p.roomCode, undefined);
  assert.equal(p.data.memberRooms[0].code, "111111");
  assert.ok(!paths.includes("/api/rooms/111111"));
});

test("先选人数：自动匹配可用板子，切板不改变人数", async () => {
  const a = await server();
  try {
    const p = await a.actor();
    await p.bootstrap();
    assert.deepEqual(Array.from(p.data.capacities), [6, 7, 8, 9, 10, 11, 12]);
    assert.equal(p.data.availableBoards.length, 1);
    p.pickCapacity({ currentTarget: { dataset: { capacity: 12 } } });
    assert.deepEqual(
      Array.from(p.data.availableBoards, (b) => b.id),
      ["classic-court", "shadow-assist", "chaos", "knights"],
    );
    p.pickBoard({ currentTarget: { dataset: { index: 1 } } });
    assert.equal(p.data.capacity, 12);
    assert.equal(p.data.boardAssisted, true);
    p.pickCapacity({ currentTarget: { dataset: { capacity: 6 } } });
    assert.equal(p.data.boardId, "classic");
    assert.equal(p.data.boardAssisted, false);
    p.pickCapacity({ currentTarget: { dataset: { capacity: 11 } } });
    assert.equal(p.data.boardId, "classic-11");
  } finally {
    await a.close();
  }
});

test("微信昵称以表单最终值建房并记住，清空后不复用旧昵称", async () => {
  const a = await server();
  try {
    const storage = new Map();
    const p = await a.actor(storage);
    await p.bootstrap();
    p.setData({ name: "旧昵称", entryMode: "create" });
    p.submitEntry({ detail: { value: { nickname: "" } } });
    assert.equal(p.data.error, "请填写昵称");
    assert.equal(p.roomCode, undefined);
    p.submitEntry({ detail: { value: { nickname: "微信昵称" } } });
    await settle(p);
    assert.equal(p.data.room.players[0].name, "微信昵称");
    assert.equal(storage.get("nickname"), "微信昵称");
    // Changing capacity in a lobby must choose a compatible board in the same command.
    p.configureCapacity({
      detail: { value: p.data.roomCapacities.indexOf(12) },
    });
    await settle(p);
    assert.equal(p.data.room.capacity, 12);
    assert.equal(p.data.room.board, "classic-court");
    p.configureBoard({ detail: { value: 1 } });
    await settle(p);
    assert.equal(p.data.room.board, "shadow-assist");
    assert.equal(p.data.room.capacity, 12);
  } finally {
    await a.close();
  }
});

test("离开后刷新列表，空桌保留并可重新入座", async () => {
  const a = await server();
  try {
    const storage = new Map();
    const p = await a.actor(storage);
    await p.bootstrap();
    assert.equal(p.data.entryMode, "join");
    p.setData({ name: "房主" });
    p.create();
    await settle(p);
    const code = p.roomCode;
    await p.loadRooms();
    assert.equal(p.data.memberRooms.length, 1);
    await p.leave();
    await settle(p);
    assert.equal(p.roomCode, null);
    assert.equal(storage.has("roomCode"), false);
    assert.equal(p.data.memberRooms.length, 1);
    assert.equal(p.data.memberRooms[0].seat, null);
    await p.openRoom({ currentTarget: { dataset: { code } } });
    await settle(p);
    assert.equal(p.roomCode, code);
    assert.equal(p.data.room.me.isHost, true);
    assert.equal(p.data.room.me.ready, false);
  } finally {
    await a.close();
  }
});

test("失效房间403/404停止请求；退出后旧错误不污染新界面", async () => {
  for (const status of [403, 404]) {
    let calls = 0;
    const p = page({
      request: async (path) => {
        calls++;
        if (path === "/api/me/rooms") return { rooms: [] };
        throw Object.assign(new Error("旧错误"), { status });
      },
    });
    p.roomCode = "123456";
    await p.refresh();
    await p.refresh();
    assert.equal(calls, 2); // one room request and one list refresh
    assert.equal(p.roomCode, null);
    assert.equal(p.data.error, "");
  }
  let reject;
  const p = page({
    request: () =>
      new Promise((_, r) => {
        reject = r;
      }),
  });
  p.roomCode = "123456";
  const pending = p.refresh();
  p.clearRoom();
  reject(Object.assign(new Error("延迟失败"), { status: 404 }));
  await pending;
  assert.equal(p.data.error, "");
});

test("房主删除后双方回到入口，成员不再轮询已删牌桌", async () => {
  const a = await server();
  try {
    const host = await a.actor(),
      guest = await a.actor();
    await host.bootstrap();
    await guest.bootstrap();
    host.setData({ name: "房主" });
    host.create();
    await settle(host);
    const code = host.roomCode;
    guest.setData({ name: "成员", code });
    guest.join();
    await settle(guest);
    await host.returnHome();
    await host.deleteRoom({ currentTarget: { dataset: { code } } });
    assert.equal(host.data.notice, "牌桌已删除");
    assert.equal(host.data.memberRooms.length, 0);
    await guest.refresh();
    assert.equal(guest.roomCode, null);
    assert.equal(guest.data.room, null);
    assert.equal(guest.data.error, "");
    assert.equal(guest.data.memberRooms.length, 0);
  } finally {
    await a.close();
  }
});

test("10人自动选经典基础；关闭业务提示不离开当前房间", async () => {
  const a = await server();
  try {
    const p = await a.actor();
    await p.bootstrap();
    p.selectCapacity(10);
    assert.equal(p.data.availableBoards.length, 1);
    assert.equal(p.data.boardId, "classic-court");
    assert.equal(p.data.boardName, "阿瓦隆 · 经典基础");
    p.roomCode = "123456";
    p.handleError(Object.assign(new Error("阶段尚未完成"), { status: 400 }));
    assert.equal(p.data.recoverableError, false);
    p.dismissError();
    assert.equal(p.data.error, "");
    assert.equal(p.roomCode, "123456");
  } finally {
    await a.close();
  }
});

test("离开须确认，取消或确认期间切房不退出座位", async () => {
  const p = page({});
  p.data.room = {
    code: "123456",
    stage: 1,
    me: { isHost: false },
    players: [{}, {}],
  };
  let commands = 0;
  p.cmd = () => commands++;
  p.confirm = async () => false;
  await p.leave();
  assert.equal(commands, 0);
  p.confirm = async () => {
    p.data.room = { ...p.data.room, code: "234567" };
    return true;
  };
  await p.leave();
  assert.equal(commands, 0);
  p.confirm = async () => true;
  await p.leave();
  assert.equal(commands, 1);
});

test("业务拒绝仍表示连接正常，网络失败不能显示绿色确认", () => {
  const p = page({});
  p.handleError(Object.assign(new Error("阶段未完成"), { status: 400 }));
  assert.equal(p.data.serverConnected, true);
  p.handleError(new Error("网络失败"));
  assert.equal(p.data.serverConnected, false);
});

test("玩法说明随人数和板子更新，房间配置弹窗可关闭且退出时重置", () => {
  const { BOARDS } = require("../server/engine");
  const p = page({});
  p.setData({ boards: BOARDS });
  p.selectCapacity(6);
  assert.equal(
    p.data.boardRoleConfiguration[0].roles,
    "梅林，派西维尔，忠臣×2",
  );
  p.toggleRules();
  p.selectCapacity(12);
  assert.equal(p.data.showRules, false);
  assert.equal(
    p.data.boardRoleConfiguration[1].roles.includes("奥伯伦×2"),
    true,
  );
  const index = p.data.availableBoards.findIndex(
    (b) => b.id === "shadow-assist",
  );
  p.pickBoard({ detail: { value: index } });
  assert.equal(p.data.boardRoleConfiguration[0].roles.includes("蓝内奸"), true);
  p.openRoomRules();
  assert.equal(p.data.showRoomRules, true);
  p.closeRoomRules();
  assert.equal(p.data.showRoomRules, false);
  p.openRoomRules();
  p.clearRoom();
  assert.equal(p.data.showRoomRules, false);
});

test("无变化轮询不重复渲染，进入表决一次更新阶段且清除旧身份", async () => {
  let room = {
    code: "123456",
    phase: "proposal",
    stage: "proposal-stage",
    capacity: 6,
    players: [{ seat: 1, name: "甲" }],
    me: { seat: 1 },
    team: [1, 2],
    history: [],
  };
  const p = page({ request: async () => structuredClone(room) });
  p.roomCode = room.code;
  p.setData({ loading: false });
  await p.refresh();
  const patches = [];
  const originalSetData = p.setData;
  p.setData = (patch) => {
    patches.push(patch);
    originalSetData.call(p, patch);
  };
  await p.refresh();
  assert.equal(patches.length, 0);
  p.setData({
    revealed: true,
    secret: { role: "刺客" },
    selected: [1, 2],
    choiceButtons: [{ value: "confirm" }],
  });
  patches.length = 0;
  room = { ...room, stage: "vote-stage", phase: "teamVote" };
  await p.refresh();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].room.phase, "teamVote");
  assert.equal(patches[0].revealed, false);
  assert.equal(patches[0].secret, null);
  assert.equal(p.data.selected.length, 0);
  assert.equal(p.data.room.code, "123456");
  assert.equal(p.data.loading, false);
  assert.equal(patches[0].history, undefined);
  patches.length = 0;
  await p.refresh();
  assert.equal(patches.length, 0);
});

test("小程序经HTTP发身份后自由发起任务、投票、刀梅林，并由房主结束", async () => {
  const a = await server();
  try {
    const ps = [];
    for (let i = 0; i < 6; i++) ps.push(await a.actor());
    const host = ps[0];
    host.setData({ name: "房主", loading: false });
    host.create();
    await settle(host);
    for (let i = 1; i < 6; i++) {
      ps[i].setData({ name: "玩家" + i, code: host.roomCode, loading: false });
      ps[i].join();
      await settle(ps[i]);
    }
    const refresh = () => Promise.all(ps.map((p) => p.refresh()));
    await refresh();
    for (const p of ps) await cmd(p, "ready", { ready: true });
    await host.start();
    await settle(host);
    await refresh();
    assert.ok(ps.every((p) => p.data.room.phase === "tools"));
    host.openTool({ currentTarget: { dataset: { kind: "quest" } } });
    for (const seat of [1, 2])
      host.toggleToolSeat({ currentTarget: { dataset: { seat } } });
    await host.launchTool();
    await settle(host);
    await refresh();
    for (const p of ps.slice(0, 2))
      await cmd(p, "submit", { value: "success" });
    assert.equal(ps[2].data.room.needsSubmission, false);
    host.settleTool();
    await settle(host);
    assert.equal(host.data.room.phase, "tools");
    assert.ok(host.data.history.at(-1).text.includes("任务成功"));
    host.openTool({ currentTarget: { dataset: { kind: "vote" } } });
    await host.launchTool();
    await settle(host);
    await refresh();
    for (const p of ps) await cmd(p, "submit", { value: "approve" });
    host.settleTool();
    await settle(host);
    assert.ok(host.data.history.at(-1).text.includes("投票通过"));
    host.openTool({ currentTarget: { dataset: { kind: "assassination" } } });
    await host.launchTool();
    await settle(host);
    await refresh();
    for (const p of ps) await p.reveal();
    const assassin = ps.find((p) => p.data.secret.role === "刺客");
    const merlin = ps.find((p) => p.data.secret.role === "梅林");
    await cmd(assassin, "submit", { value: merlin.data.room.me.seat });
    for (const p of ps.filter((p) => p !== assassin))
      await cmd(p, "submit", { value: "confirm" });
    host.settleTool();
    await settle(host);
    assert.equal(host.data.room.result, null);
    assert.ok(host.data.history.at(-1).detail.includes("命中梅林"));
    await host.finishTools();
    await settle(host);
    assert.equal(host.data.room.phase, "ended");
  } finally {
    await a.close();
  }
});

test("操作配置过期不发起请求，替换当前操作取消确认时保留提交", async () => {
  const p = page({});
  p.setData({
    room: {
      stage: "a",
      canUseTools: true,
      hasActiveOperation: true,
      team: [],
      players: [],
    },
    busy: false,
  });
  p.openTool({ currentTarget: { dataset: { kind: "vote" } } });
  let called = false;
  p.cmd = () => {
    called = true;
  };
  p.confirm = async () => false;
  await p.launchTool();
  assert.equal(called, false);
  assert.equal(p.data.toolType, "vote");
  p.data.room.stage = "b";
  await p.launchTool();
  assert.equal(called, false);
  assert.ok(p.data.error.includes("阶段已变化"));
});

test("新操作自动弹窗但不展示身份，同阶段关闭后不反复弹出，可手动重开", async () => {
  let room = {
    code: "123456",
    phase: "quest",
    stage: "q1",
    capacity: 6,
    players: [],
    team: [1],
    history: [],
    me: { seat: 1, submitted: false },
    needsSubmission: true,
  };
  let privateReads = 0;
  const p = page({
    request: async (path) => {
      if (path.endsWith("/private")) {
        privateReads++;
        return {
          stage: room.stage,
          role: "莫甘娜",
          information: "同伴5号",
          action: { label: "选择任务牌", choices: ["success", "fail"] },
        };
      }
      return structuredClone(room);
    },
  });
  p.roomCode = room.code;
  await p.refresh();
  assert.equal(p.data.actionDialog, true);
  assert.equal(p.data.revealed, false);
  assert.equal(p.data.secret, null);
  assert.equal(p.data.actionChoices.length, 2);
  p.closeAction();
  await p.refresh();
  assert.equal(privateReads, 1);
  assert.equal(p.data.actionDialog, false);
  await p.openAction();
  assert.equal(p.data.actionDialog, true);
  assert.equal(privateReads, 2);
  room = { ...room, me: { ...room.me, submitted: true } };
  await p.refresh();
  assert.equal(p.data.actionDialog, false);
  assert.equal(privateReads, 2);
});

test("操作请求晚于切后台或阶段切换返回时，不弹出旧操作", async () => {
  let resolve;
  const p = page({ request: () => new Promise((r) => (resolve = r)) });
  p.roomCode = "123456";
  p.setData({
    room: { stage: "old", needsSubmission: true, me: { submitted: false } },
    network: true,
  });
  const pending = p.openAction();
  p.onHide();
  resolve({ stage: "old", action: { label: "任务", choices: ["fail"] } });
  await pending;
  assert.equal(p.data.actionDialog, false);
  assert.equal(p.data.actionChoices.length, 0);
  p.foreground = true;
  const second = p.openAction();
  p.data.room.stage = "new";
  resolve({ stage: "old", action: { label: "任务", choices: ["fail"] } });
  await second;
  assert.equal(p.data.actionDialog, false);
});

test("发身份弹窗点击才显示身份视角，遮盖及重开不泄露到页面身份卡", async () => {
  const secret = {
    stage: "i1",
    role: "梅林",
    faction: "好人阵营",
    information: "坏人2号",
    action: { label: "确认身份", choices: ["confirm"] },
  };
  const p = page({ request: async () => secret });
  p.roomCode = "123456";
  p.setData({
    room: {
      stage: "i1",
      phase: "identity",
      needsSubmission: true,
      me: { submitted: false },
    },
  });
  await p.openAction();
  assert.equal(p.data.actionSecret, null);
  await p.revealActionIdentity();
  assert.equal(p.data.actionSecret.role, "梅林");
  assert.equal(p.data.actionSecret.information, "坏人2号");
  assert.equal(p.data.secret, null);
  assert.equal(p.data.revealed, false);
  assert.equal(p.data.actionDialog, true);
  await p.revealActionIdentity();
  assert.equal(p.data.actionSecret, null);
  await p.revealActionIdentity();
  p.closeAction();
  assert.equal(p.data.actionSecret, null);
  await p.openAction();
  assert.equal(p.data.actionSecret, null);
  await p.revealActionIdentity();
  p.onHide();
  assert.equal(p.data.actionSecret, null);
});

for (const cancel of ["close", "background", "stage", "submitted"]) {
  test(`弹窗身份延迟响应在${cancel}后不能显示`, async () => {
    let resolve;
    const p = page({
      request: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    p.roomCode = "123456";
    p.setData({
      actionDialog: true,
      room: { stage: "i1", phase: "identity", me: { submitted: false } },
    });
    const pending = p.revealActionIdentity();
    if (cancel === "close") p.closeAction();
    if (cancel === "background") p.onHide();
    if (cancel === "stage") p.data.room.stage = "i2";
    if (cancel === "submitted") p.data.room.me.submitted = true;
    resolve({ stage: "i1", role: "梅林", information: "坏人2号" });
    await pending;
    assert.equal(p.data.actionSecret, null);
    assert.equal(p.data.busy, false);
  });
}

test("十二骑士手机端经HTTP同时提交技能、结算复活并进入下一轮", async () => {
  const a = await server();
  try {
    const ps = [];
    for (let i = 0; i < 12; i++) ps.push(await a.actor());
    const host = ps[0];
    host.setData({
      name: "房主",
      loading: false,
      boardId: "knights",
      capacity: 12,
    });
    host.create();
    await settle(host);
    for (let i = 1; i < 12; i++) {
      ps[i].setData({ name: "玩家" + i, code: host.roomCode, loading: false });
      ps[i].join();
      await settle(ps[i]);
    }
    const refresh = () => Promise.all(ps.map((p) => p.refresh()));
    await refresh();
    for (const p of ps) await cmd(p, "ready", { ready: true });
    await host.start();
    await settle(host);
    await refresh();
    assert.ok(host.data.room.knights);
    host.openTool({ currentTarget: { dataset: { kind: "skills" } } });
    assert.equal(host.data.toolTitle, "使用技能");
    await host.launchTool();
    await settle(host);
    await refresh();
    for (const p of ps) {
      await p.openAction();
      assert.equal(p.data.actionChoices[0].label, "不使用技能 / 确认");
      assert.ok(
        p.data.actionChoices.every(
          (c) => c.label && !c.label.startsWith("target:"),
        ),
      );
      await cmd(p, "submit", { value: "pass" });
    }
    host.settleTool();
    await settle(host);
    await refresh();
    assert.equal(host.data.room.phase, "tools");
    assert.ok(host.data.history.at(-1).text.includes("技能与复活"));
    host.openTool({ currentTarget: { dataset: { kind: "quest" } } });
    host.toggleToolSeat({ currentTarget: { dataset: { seat: 1 } } });
    await host.launchTool();
    await settle(host);
    await refresh();
    assert.equal(host.data.room.knights.round, 2);
  } finally {
    await a.close();
  }
});

test("技能二次确认：取消和过期不提交，确认才提交", async () => {
  const p = page({});
  p.data.room = { stage: "s1", phase: "skillPrepare" };
  p.data.actionChoices = [{ value: "target:2", label: "对2号开刀" }];
  const calls = [];
  p.cmd = (...v) => calls.push(v);
  p.confirm = async () => false;
  await p.submitChoice({ currentTarget: { dataset: { value: "target:2" } } });
  assert.equal(calls.length, 0);
  p.confirm = async () => {
    p.data.room.stage = "s2";
    return true;
  };
  await p.submitChoice({ currentTarget: { dataset: { value: "target:2" } } });
  assert.equal(calls.length, 0);
  p.confirm = async () => true;
  await p.submitChoice({ currentTarget: { dataset: { value: "target:2" } } });
  assert.equal(calls[0][0], "submit");
  assert.equal(calls[0][1].value, "target:2");
});
test("新身份弹窗使用当前私密牌，后台不显示，确认使用看到的版本", async () => {
  const secret = {
    stage: "s1",
    role: "红守卫",
    identityRevision: 2,
    information: "没有视野。",
  };
  const p = page({ request: async () => secret });
  p.data.room = { code: "123456", stage: "s1", me: { identityChanged: true } };
  await p.showIdentityChange();
  assert.equal(p.data.identityChange.role, "红守卫");
  const sent = [];
  p.cmd = (...v) => sent.push(v);
  p.acknowledgeIdentity();
  assert.equal(sent[0][1].revision, 2);
  assert.equal(p.data.identityChange, null);
  p.foreground = false;
  await p.showIdentityChange();
  assert.equal(p.data.identityChange, null);
});
