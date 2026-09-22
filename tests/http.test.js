const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createApp } = require("../server/app");
async function launch(opts = {}) {
  const app = createApp({ database: ":memory:", devAuth: true, ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  return {
    ...app,
    async close() {
      await new Promise((r) => app.server.close(r));
      app.store.close();
    },
    async req(path, token, body, id = randomUUID()) {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + (token || ""),
          "Content-Type": "application/json",
          "Idempotency-Key": id,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json() };
    },
  };
}
async function users(app, n = 6) {
  const result = [];
  for (let i = 0; i < n; i++)
    result.push((await app.req("/api/dev-login", null, {})).data.token);
  return result;
}
test("HTTP完整创建/加入/并发准备/开始/确认/终止/同房再开，跨房拒绝", async () => {
  const a = await launch();
  try {
    const tokens = await users(a, 7);
    const c = await a.req("/api/rooms", tokens[0], {
      name: "房主",
      capacity: 6,
      board: "classic",
    });
    assert.equal(c.status, 200);
    const path = "/api/rooms/" + c.data.code;
    for (let i = 1; i < 6; i++)
      assert.equal(
        (await a.req(path + "/join", tokens[i], { name: "玩家" + i })).status,
        200,
      );
    assert.equal((await a.req(path, tokens[6])).status, 403);
    assert.equal((await a.req(path + "/private", tokens[6])).status, 403);
    let view = (await a.req(path, tokens[0])).data;
    await Promise.all(
      tokens.slice(0, 6).map((token) =>
        a.req(path + "/commands", token, {
          type: "ready",
          stage: view.stage,
          ready: true,
        }),
      ),
    );
    const start = { type: "start", stage: view.stage },
      id = randomUUID();
    const responses = await Promise.all([
      a.req(path + "/commands", tokens[0], start, id),
      a.req(path + "/commands", tokens[0], start, id),
    ]);
    assert.ok(responses.every((r) => r.status === 200));
    view = (await a.req(path, tokens[0])).data;
    assert.equal(view.game, 1);
    assert.equal(view.phase, "identity");
    assert.equal(
      (
        await a.req(path + "/commands", tokens[1], {
          type: "advance",
          stage: view.stage,
        })
      ).status,
      403,
    );
    const before = JSON.stringify({ ...view, operationProgress: null });
    await a.req(path + "/commands", tokens[1], {
      type: "submit",
      stage: view.stage,
      value: "confirm",
    });
    assert.equal(
      JSON.stringify({
        ...(await a.req(path, tokens[0])).data,
        operationProgress: null,
      }),
      before,
    );
    await a.req(path + "/commands", tokens[0], {
      type: "terminate",
      stage: view.stage,
    });
    view = (await a.req(path, tokens[0])).data;
    assert.equal(view.phase, "terminated");
    await a.req(path + "/commands", tokens[0], {
      type: "rematch",
      stage: view.stage,
    });
    assert.equal((await a.req(path, tokens[0])).data.phase, "lobby");
    assert.equal((await a.req(path + "/private", tokens[0])).status, 400);
  } finally {
    await a.close();
  }
});
test("重试创建只生成同一个房间，请求编号不可用于不同载荷", async () => {
  const a = await launch();
  try {
    const [t] = await users(a, 1),
      id = randomUUID(),
      data = { name: "房主", capacity: 6 };
    const first = await a.req("/api/rooms", t, data, id);
    assert.deepEqual(await a.req("/api/rooms", t, data, id), first);
    assert.equal(
      (await a.req("/api/rooms", t, { name: "另外", capacity: 7 }, id)).status,
      409,
    );
    assert.equal(
      (
        await a.req("/api/rooms", t, {
          name: "甲",
          board: "shadow-blade",
          capacity: 12,
        })
      ).status,
      400,
    );
  } finally {
    await a.close();
  }
});
test("SQLite重启保留会话、房间和请求回执", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shadowtable-"));
  const database = join(dir, "test.sqlite");
  let a = await launch({ database });
  try {
    const [token] = await users(a, 1),
      id = randomUUID(),
      body = { name: "玩家", capacity: 6 };
    const result = await a.req("/api/rooms", token, body, id);
    await a.close();
    a = await launch({ database });
    assert.deepEqual(await a.req("/api/rooms", token, body, id), result);
    assert.equal(
      (await a.req("/api/rooms/" + result.data.code, token)).data.me.name,
      "玩家",
    );
  } finally {
    await a.close();
    rmSync(dir, { recursive: true });
  }
});
test("真实微信身份由服务端换取，禁用开发登录，客户端openid不可伪造", async () => {
  const a = await launch({
    devAuth: false,
    exchangeCode: async (code) => {
      assert.equal(code, "wx-code");
      return "trusted-openid";
    },
  });
  try {
    assert.equal((await a.req("/api/dev-login", null, {})).status, 404);
    const first = (
      await a.req("/api/login", null, { code: "wx-code", openid: "fake" })
    ).data.token;
    const room = (await a.req("/api/rooms", first, { name: "甲" })).data.code;
    const second = (await a.req("/api/login", null, { code: "wx-code" })).data
      .token;
    assert.equal((await a.req("/api/rooms/" + room, second)).status, 200);
    assert.equal(
      (await a.req("/api/rooms/" + room, "a".repeat(64))).status,
      401,
    );
  } finally {
    await a.close();
  }
});

test("我的房间列表只返回本人成员关系，无他人房间、身份或行动状态", async () => {
  const a = await launch();
  try {
    const [first, second, outsider] = await users(a, 3);
    const owned = (await a.req("/api/rooms", first, { name: "甲" })).data.code;
    const shared = (await a.req("/api/rooms", second, { name: "乙" })).data
      .code;
    await a.req("/api/rooms/" + shared + "/join", first, { name: "甲" });
    const list = (await a.req("/api/me/rooms", first)).data.rooms;
    assert.deepEqual(list.map((r) => r.code).sort(), [owned, shared].sort());
    assert.deepEqual(
      Object.keys(list[0]).sort(),
      [
        "code",
        "boardName",
        "capacity",
        "phaseName",
        "game",
        "seat",
        "testRoom",
        "isHost",
        "isMember", "phase", "status", "occupied", "hostName", "relation", "canLeave", "createdAt", "updatedAt", "note", "lastEnteredAt", "available",
      ].sort(),
    );
    assert.deepEqual((await a.req("/api/me/rooms", outsider)).data.rooms, []);
    assert.equal((await a.req("/api/me/rooms", second)).data.rooms.length, 1);
    const room = (await a.req("/api/rooms/" + shared, first)).data;
    await a.req("/api/rooms/" + shared + "/commands", first, {
      type: "leave",
      stage: room.stage,
    });
    assert.equal((await a.req("/api/me/rooms", first)).data.rooms.filter(r => r.available).length, 1);
    assert.equal((await a.req("/api/me/rooms", null)).status, 401);
  } finally {
    await a.close();
  }
});

test("删除牌桌仅当前房主可执行，检查阶段且重试幂等", async () => {
  const a = await launch();
  try {
    const [host, guest, outsider] = await users(a, 3);
    const code = (await a.req("/api/rooms", host, { name: "房主" })).data.code;
    const path = "/api/rooms/" + code;
    await a.req(path + "/join", guest, { name: "玩家" });
    const room = (await a.req(path, host)).data;
    const body = { stage: room.stage };
    for (const token of [guest, outsider])
      assert.equal((await a.req(path + "/delete", token, body)).status, 403);
    assert.equal(
      (await a.req(path + "/delete", host, { stage: -1 })).status,
      409,
    );
    const id = randomUUID();
    const result = await a.req(path + "/delete", host, body, id);
    assert.equal(result.status, 200);
    assert.deepEqual(await a.req(path + "/delete", host, body, id), result);
    assert.equal((await a.req(path, guest)).status, 404);
    assert.equal((await a.req(path + "/private", host)).status, 404);
    for (const token of [host, guest])
      assert.equal((await a.req("/api/me/rooms", token)).data.rooms[0].status, "unavailable");
  } finally {
    await a.close();
  }
});

test("空牌桌跨重启保留归属，离席房主可管理但无私密视图", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shadowtable-empty-"));
  const database = join(dir, "test.sqlite");
  let a = await launch({ database });
  try {
    const [host, guest] = await users(a, 2);
    const code = (await a.req("/api/rooms", host, { name: "房主" })).data.code;
    const path = "/api/rooms/" + code;
    const room = (await a.req(path, host)).data;
    await a.req(path + "/commands", host, { type: "leave", stage: room.stage });
    await a.close();
    a = await launch({ database });
    const list = (await a.req("/api/me/rooms", host)).data.rooms;
    assert.equal(list[0].code, code);
    assert.equal(list[0].seat, null);
    assert.equal(list[0].isHost, true);
    assert.equal((await a.req(path + "/private", host)).status, 403);
    assert.equal((await a.req(path + "/management", guest)).status, 403);
    assert.equal(
      (await a.req(path + "/join", guest, { name: "成员" })).status,
      200,
    );
    const g = (await a.req(path, guest)).data;
    assert.equal(g.me.isHost, false);
    assert.equal(
      (
        await a.req(path + "/commands", guest, {
          type: "configure",
          stage: g.stage,
          board: "classic",
          capacity: 6,
        })
      ).status,
      403,
    );
    assert.equal(
      (await a.req(path + "/join", host, { name: "房主" })).status,
      200,
    );
    const h = (await a.req(path, host)).data;
    assert.equal(h.me.isHost, true);
    assert.equal(
      (await a.req(path + "/commands", host, { type: "leave", stage: h.stage }))
        .status,
      200,
    );
    const management = (await a.req(path + "/management", host)).data;
    assert.equal(
      (await a.req(path + "/delete", host, { stage: management.stage })).status,
      200,
    );
    assert.equal((await a.req(path, guest)).status, 404);
  } finally {
    await a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("同IP十二人正常轮询不互相限流，单账号仍限流并返回冷却时间", async () => {
  let now = 0;
  const a = await launch({ clock: () => now });
  try {
    const tokens = await users(a, 12);
    for (let n = 0; n < 60; n++)
      for (const t of tokens)
        assert.equal((await a.req("/api/me/rooms", t)).status, 200);
    for (let n = 0; n < 120; n++)
      assert.equal((await a.req("/api/me/rooms", tokens[0])).status, 200);
    const url = "http://127.0.0.1:" + a.server.address().port + "/api/me/rooms";
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + tokens[0] },
    });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("Retry-After"), "60");
    await r.json();
    assert.equal((await a.req("/api/me/rooms", tokens[1])).status, 200);
    now = 60000;
    assert.equal((await a.req("/api/me/rooms", tokens[0])).status, 200);
  } finally {
    await a.close();
  }
});

test("HTTP移出成员撤销访问与房间列表，重试只执行一次且不影响重新加入", async () => {
  const a = await launch();
  try {
    const [host, guest, other] = await users(a, 3);
    const created = await a.req("/api/rooms", host, { name: "房主", board: "classic", capacity: 6 });
    const path = "/api/rooms/" + created.data.code;
    await a.req(path + "/join", guest, { name: "玩家" });
    await a.req(path + "/join", other, { name: "玩家" });
    const room = (await a.req(path, host)).data;
    const input = { type: "kick", stage: room.stage, seat: 2, targetId: room.players[1].managementId, confirm: true };
    assert.equal((await a.req(path + "/commands", other, input)).status, 403);
    const id = randomUUID();
    const results = await Promise.all([a.req(path + "/commands", host, input, id), a.req(path + "/commands", host, input, id)]);
    assert.ok(results.every(r => r.status === 200));
    assert.equal((await a.req(path, host)).data.players.length, 2);
    for (const url of [path, path + "/private"]) {
      const res = await a.req(url, guest);
      assert.equal(res.status, 403);
      assert.equal(res.data.error, "你已被房主移出房间");
    }
    assert.equal((await a.req("/api/me/rooms", guest)).data.rooms.filter(r => r.available).length, 0);
    assert.equal((await a.req(path + "/commands", guest, { type: "ready", stage: room.stage, ready: true })).status, 403);
    assert.equal(a.store.get(created.data.code).players.length, 2);
    assert.equal((await a.req(path + "/join", guest, { name: "重新加入" })).status, 200);
    assert.equal((await a.req(path + "/commands", host, input, id)).status, 200);
    assert.equal((await a.req(path, guest)).status, 200);
    const current = (await a.req(path, host)).data;
    assert.equal((await a.req(path + "/commands", host, { ...input, stage: current.stage })).status, 409);
    assert.equal((await a.req(path, host)).data.players.length, 3);
  } finally { await a.close(); }
});

test("围观成员可恢复房间，抢同一空位只成功一人，重复站起请求幂等", async () => {
  const a = await launch();
  try {
    const [host, first, second] = await users(a, 3);
    const code = (await a.req("/api/rooms", host, { name: "房主" })).data.code;
    const path = "/api/rooms/" + code;
    await a.req(path + "/join", first, { name: "甲" });
    await a.req(path + "/join", second, { name: "乙" });
    const stage = (await a.req(path, host)).data.stage;
    const id = randomUUID();
    const stand = { type: "stand", stage };
    assert.equal((await a.req(path + "/commands", first, stand, id)).status, 200);
    assert.equal((await a.req(path + "/commands", first, stand, id)).status, 200);
    assert.equal((await a.req(path + "/commands", second, stand)).status, 200);
    const summaries = (await a.req("/api/me/rooms", first)).data.rooms;
    assert.equal(summaries[0].seat, null);
    assert.equal(summaries[0].isMember, true);
    const results = await Promise.all([first, second].map(token =>
      a.req(path + "/commands", token, { type: "seat", seat: 2, stage })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const view = (await a.req(path, host)).data;
    assert.equal(view.players.filter(p => p.seat === 2).length, 1);
    const loser = results[0].status === 409 ? first : second;
    assert.equal((await a.req(path, loser)).data.me.seat, null);
    assert.equal((await a.req(path + "/private", loser)).status, 403);
  } finally { await a.close(); }
});

test("个人牌桌隐藏、备注和撤销不改变房间及座位，重试幂等且不能修改他人记录", async () => {
  const a = await launch();
  try {
    const [host, guest, outsider] = await users(a, 3);
    const code = (await a.req('/api/rooms', host, { name: '房主' })).data.code;
    const path = '/api/rooms/' + code, personal = '/api/me/rooms/' + code;
    await a.req(path + '/join', guest, { name: '成员' });
    const before = structuredClone(a.store.get(code));
    assert.equal((await a.req(personal, outsider, { action: 'hide' })).status, 404);
    assert.equal((await a.req(personal, guest, { action: 'note', note: '周五朋友局' })).status, 200);
    assert.equal((await a.req(personal, guest, { action: 'note', note: '字'.repeat(31) })).status, 400);
    const id = randomUUID();
    await a.req(personal, guest, { action: 'hide' }, id);
    assert.deepEqual((await a.req('/api/me/rooms', guest)).data.rooms, []);
    assert.equal((await a.req('/api/me/rooms', host)).data.rooms[0].note, '');
    assert.deepEqual(a.store.get(code), before);
    assert.equal((await a.req(path, guest)).status, 200);
    await a.req(personal, guest, { action: 'restore' });
    await a.req(personal, guest, { action: 'hide' }, id); // replay cannot undo the later restore
    assert.equal((await a.req('/api/me/rooms', guest)).data.rooms[0].note, '周五朋友局');
    await a.req(personal, guest, { action: 'hide' });
    await a.req(path + '/join', guest, { name: '成员' });
    const restored = (await a.req('/api/me/rooms', guest)).data.rooms[0];
    assert.equal(restored.available, true);
    assert.equal(restored.seat, 2);
    assert.equal(restored.note, '周五朋友局');
    assert.equal(restored.hostName, '房主');
    assert.ok(restored.lastEnteredAt > 0);
    await a.req(personal, guest, { action: 'note', note: '' });
    assert.equal((await a.req('/api/me/rooms', guest)).data.rooms[0].note, '');
  } finally { await a.close(); }
});

test("个人记录跨重启保存，解散后可清理且无法进入，不返回其他房间或私密信息", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-entries-'));
  let a = await launch({ database: join(dir, 'rooms.sqlite') });
  try {
    const [host, guest] = await users(a, 2);
    const code = (await a.req('/api/rooms', host, { name: '甲' })).data.code;
    const path = '/api/rooms/' + code, personal = '/api/me/rooms/' + code;
    await a.req(path + '/join', guest, { name: '乙' });
    await a.req(personal, guest, { action: 'note', note: '我的备注' });
    await a.req(personal, guest, { action: 'hide' });
    await a.close();
    a = await launch({ database: join(dir, 'rooms.sqlite') });
    assert.deepEqual((await a.req('/api/me/rooms', guest)).data.rooms, []);
    await a.req(personal, guest, { action: 'restore' });
    assert.equal((await a.req('/api/me/rooms', guest)).data.rooms[0].note, '我的备注');
    const room = (await a.req(path, host)).data;
    await a.req(path + '/delete', host, { stage: room.stage });
    const entries = (await a.req('/api/me/rooms', guest)).data.rooms;
    assert.equal(entries[0].available, false);
    assert.equal(entries[0].status, 'unavailable');
    assert.equal(entries[0].canLeave, false);
    assert.equal((await a.req(personal, guest, { action: 'visit' })).status, 404);
    assert.ok(!JSON.stringify(entries).includes('membershipId'));
    await a.req(personal, guest, { action: 'hide' });
    assert.deepEqual((await a.req('/api/me/rooms', guest)).data.rooms, []);
  } finally { await a.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("列表进行中优先，同状态按最近进入排列，房间活动不改变访问排序", async () => {
  const a = await launch();
  try {
    const [host] = await users(a, 1);
    const codes = [];
    for (let i=0; i<3; i++) codes.push((await a.req('/api/rooms', host, { name: '房主' })).data.code);
    const uid = a.store.get(codes[0]).host;
    codes.forEach((code,i) => a.store.db.prepare('UPDATE room_entries SET entered=? WHERE uid=? AND code=?').run(100+i, uid, code));
    const room = a.store.get(codes[0]); room.phase='tools'; a.store.save(room);
    const list = () => a.req('/api/me/rooms', host);
    assert.deepEqual((await list()).data.rooms.map(r=>r.code), [codes[0],codes[2],codes[1]]);
    a.store.save(a.store.get(codes[1]));
    assert.deepEqual((await list()).data.rooms.map(r=>r.code), [codes[0],codes[2],codes[1]]);
    await a.req('/api/me/rooms/'+codes[1], host, {action:'visit'});
    assert.deepEqual((await list()).data.rooms.map(r=>r.code), [codes[0],codes[1],codes[2]]);
  } finally { await a.close(); }
});

test("旧数据库自动补齐个人记录，不改变旧房间阶段和座位", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-entry-migration-'));
  let a = await launch({database:join(dir,'rooms.sqlite')});
  try {
    const [host] = await users(a,1);
    const code = (await a.req('/api/rooms',host,{name:'旧房主'})).data.code;
    const legacy = a.store.get(code);
    delete legacy.createdAt; delete legacy.updatedAt;
    a.store.db.prepare('UPDATE rooms SET state=? WHERE code=?').run(JSON.stringify(legacy),code);
    a.store.db.exec('DROP TABLE room_entries');
    await a.close();
    a = await launch({database:join(dir,'rooms.sqlite')});
    const list=(await a.req('/api/me/rooms',host)).data.rooms;
    assert.equal(list[0].code,code);
    assert.equal(list[0].available,true);
    assert.equal(list[0].seat,1);
    assert.deepEqual(a.store.get(code),legacy);
    await a.req('/api/me/rooms/'+code,host,{action:'hide'});
    assert.deepEqual((await a.req('/api/me/rooms',host)).data.rooms,[]);
    assert.deepEqual(a.store.get(code),legacy);
  } finally { await a.close(); rmSync(dir,{recursive:true,force:true}); }
});
