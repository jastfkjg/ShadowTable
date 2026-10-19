"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store } = require("../server/store");
const { createApp } = require("../server/app");
const engine = require("../server/engine");
const avoidance = require("../server/avoidance");

async function setup(t) {
  const origin = "https://admin.example.com", key = "avoidance-admin-test-" + "a".repeat(32);
  const app = createApp({ database: ":memory:", exchangeCode: async code => code, adminOrigin: origin, adminKey: key });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.close(); });
  const base = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "";
  async function request(path, token, data, id = randomUUID(), admin = false) {
    return new Promise((resolve, reject) => {
      const req = require("node:http").request(base + path, { method: data ? "POST" : "GET", headers: {
        Authorization: "Bearer " + (token || ""), "Content-Type": "application/json", "Idempotency-Key": id,
        ...(admin ? { Host: "admin.example.com", Origin: origin, Cookie: cookie } : {}),
      } }, response => {
        let text = ""; response.on("data", chunk => text += chunk);
        response.on("end", () => {
          if (response.headers["set-cookie"]) cookie = response.headers["set-cookie"][0].split(";")[0];
          resolve({ status: response.statusCode, data: JSON.parse(text) });
        });
      });
      req.on("error", reject); req.end(data ? JSON.stringify(data) : undefined);
    });
  }
  const login = async name => (await request("/api/login", null, { code: name })).data.token;
  const admin = (data, id) => request("/api/admin/avoidance", null, data, id, true);
  async function room(tokens) {
    const { data } = await request("/api/rooms", tokens[0], { name: "玩家0", board: "classic", capacity: 6 });
    const path = "/api/rooms/" + data.code;
    for (let i = 1; i < 6; i++) assert.equal((await request(path + "/join", tokens[i], { name: "玩家" + i })).status, 200);
    return path;
  }
  async function cmd(path, token, type, extra = {}, id) {
    const view = await request(path, token);
    return request(path + "/commands", token, { type, stage: view.data.stage, ...extra }, id);
  }
  const ready = async (path, tokens) => { for (const token of tokens) assert.equal((await cmd(path, token, "ready", { ready: true })).status, 200); };
  return { ...app, request, login, admin, room, cmd, ready, adminLogin: () => request("/api/admin/login", null, { key }, undefined, true) };
}
const tokensFor = (a, prefix = "player") => Promise.all(Array.from({ length: 6 }, (_, i) => a.login(prefix + i)));

test("每账号仅赠1张，重登、服务重启和重复初始化不重新赠送", () => {
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-avoidance-")), file = join(directory, "test.sqlite");
  let store;
  try {
    store = new Store(file); store.addSession("token1", "wx:one");
    assert.equal(avoidance.balance(store, "wx:one"), 1);
    store.db.prepare("UPDATE avoidance_accounts SET balance=0 WHERE uid=?").run("wx:one");
    store.addSession("token2", "wx:one"); store.close(); store = new Store(file);
    assert.equal(avoidance.balance(store, "wx:one"), 0);
    assert.equal(avoidance.wallet(store, "wx:one").history.filter(h => h.source === "welcome").length, 1);
    assert.equal(avoidance.balance(store, "guest:new"), 1);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("最优随机发牌保留重复牌，能满足时全部满足，无法满足时最少失败", () => {
  const players = Array.from({ length: 5 }, (_, i) => ({ uid: "p" + i })), cards = ["m", "p", "s", "s", "a"];
  const preferences = [Object.fromEntries(players.map(p => [p.uid, "m"])), Object.fromEntries(players.map(p => [p.uid, "s"])), { p0: "m", p1: "m", p2: "s" }];
  const expected = [1, 2, 0];
  for (let pattern = 0; pattern < preferences.length; pattern++) for (let iteration = 0; iteration < 30; iteration++) {
    const result = avoidance.deal(players, cards, preferences[pattern], () => { throw Error("不应忽略约束"); });
    assert.deepEqual(result.slice().sort(), cards.slice().sort());
    assert.equal(result.filter((role, i) => preferences[pattern][players[i].uid] === role).length, expected[pattern]);
  }
  let originalShuffle = false;
  avoidance.deal(players, cards, {}, value => { originalShuffle = true; return value; });
  assert.equal(originalShuffle, true);
});
test("选择和结果仅本人可读；准备锁定、旁观及非法角色被拒绝，取消不扣卡", async t => {
  const a = await setup(t), tokens = await tokensFor(a), outsider = await a.login("outsider"), path = await a.room(tokens);
  const before = (await a.request(path, tokens[0])).data;
  assert.equal((await a.cmd(path, tokens[1], "avoidance", { role: "merlin" })).status, 200);
  assert.deepEqual((await a.request(path, tokens[0])).data, before);
  assert.equal((await a.request(path + "/avoidance", tokens[1])).data.selected, "merlin");
  assert.equal((await a.request(path + "/avoidance", tokens[0])).data.selected, null);
  assert.equal((await a.request(path + "/avoidance", outsider)).status, 403);
  assert.equal((await a.request(path + "/join", outsider, { name: "围观" })).status, 200);
  assert.equal((await a.cmd(path, outsider, "avoidance", { role: "merlin" })).status, 400);
  assert.equal((await a.cmd(path, tokens[1], "avoidance", { role: "witch" })).status, 400);
  await a.cmd(path, tokens[1], "ready", { ready: true });
  assert.equal((await a.cmd(path, tokens[1], "avoidance", { role: null })).status, 409);
  await a.cmd(path, tokens[1], "ready", { ready: false });
  assert.equal((await a.cmd(path, tokens[1], "avoidance", { role: null })).status, 200);
  assert.equal((await a.request("/api/me/avoidance", tokens[1])).data.balance, 1);
  const audits = a.store.db.prepare("SELECT details FROM admin_audit").all().map(r => JSON.parse(r.details));
  assert.ok(audits.every(row => row.command !== "avoidance"));
});
test("全员回避梅林只失败1人，成功才扣，重复发牌不多扣，终止不退，重开清空", async t => {
  const a = await setup(t), tokens = await tokensFor(a), path = await a.room(tokens);
  for (const token of tokens) await a.cmd(path, token, "avoidance", { role: "merlin" });
  assert.equal((await a.cmd(path, tokens[0], "start")).status, 400);
  for (const token of tokens) assert.equal((await a.request("/api/me/avoidance", token)).data.balance, 1);
  await a.ready(path, tokens); const id = randomUUID(), stage = (await a.request(path, tokens[0])).data.stage;
  const body = { type: "start", stage, flexible: true };
  assert.equal((await a.request(path + "/commands", tokens[0], body, id)).status, 200);
  assert.equal((await a.request(path + "/commands", tokens[0], body, id)).status, 200);
  let successes = 0;
  for (const token of tokens) {
    const secret = (await a.request(path + "/private", token)).data;
    const effective = secret.role !== "梅林"; successes += effective;
    assert.equal(secret.avoidance.status, effective ? "effective" : "ineffective");
    assert.equal(secret.avoidance.balance, effective ? 0 : 1);
    const publicView = (await a.request(path, token)).data;
    assert.ok(publicView.players.every(p => !("avoidance" in p)));
    assert.equal(JSON.stringify(publicView).includes('"avoidanceResults"'), false);
  }
  assert.equal(successes, 5);
  assert.equal(a.store.db.prepare("SELECT count(*) AS n FROM avoidance_ledger WHERE source='spend'").get().n, 5);
  assert.equal((await a.cmd(path, tokens[0], "start")).status, 400);
  await a.cmd(path, tokens[0], "terminate");
  assert.equal(a.store.db.prepare("SELECT count(*) AS n FROM avoidance_ledger WHERE source='spend'").get().n, 5);
  await a.cmd(path, tokens[0], "rematch");
  for (const token of tokens) assert.equal((await a.request(path + "/avoidance", token)).data.selected, null);
});
test("另一房间先耗尽余额时不重复扣卡，本房间发牌成功并私密说明未生效", async t => {
  const a = await setup(t), tokens = await tokensFor(a), first = await a.room(tokens), second = await a.room(tokens);
  for (const path of [first, second]) {
    assert.equal((await a.cmd(path, tokens[0], "avoidance", { role: "merlin" })).status, 200);
    await a.ready(path, tokens);
  }
  assert.equal((await a.cmd(second, tokens[0], "start", { flexible: true })).status, 200);
  assert.equal((await a.request("/api/me/avoidance", tokens[0])).data.balance, 0);
  assert.equal((await a.cmd(first, tokens[0], "start", { flexible: true })).status, 200);
  assert.equal((await a.request(first + "/private", tokens[0])).data.avoidance.status, "unavailable");
  assert.equal((await a.request("/api/me/avoidance", tokens[0])).data.history.filter(h => h.source === "spend").length, 1);
});
test("发牌保存失败时余额、发牌及回执一起回滚，原编号可安全重试", async t => {
  const a = await setup(t), tokens = await tokensFor(a), path = await a.room(tokens);
  await a.cmd(path, tokens[0], "avoidance", { role: "merlin" }); await a.ready(path, tokens);
  const stage = (await a.request(path, tokens[0])).data.stage, id = randomUUID(), body = { type: "start", stage, flexible: true };
  const save = a.store.save; a.store.save = () => { throw Error("测试存储失败"); };
  assert.equal((await a.request(path + "/commands", tokens[0], body, id)).status, 500);
  a.store.save = save;
  assert.equal((await a.request(path, tokens[0])).data.phase, "lobby");
  assert.equal((await a.request("/api/me/avoidance", tokens[0])).data.balance, 1);
  assert.equal((await a.request(path + "/commands", tokens[0], body, id)).status, 200);
  assert.equal((await a.request("/api/me/avoidance", tokens[0])).data.balance, 0);
});
test("管理员定向及全员发放有权限校验、人数确认、审计与幂等，玩家不能伪造发放", async t => {
  const a = await setup(t), tokens = await tokensFor(a);
  assert.equal((await a.admin()).status, 401);
  assert.equal((await a.request("/api/admin/avoidance", tokens[0], null, undefined, true)).status, 401);
  await a.adminLogin();
  const page = (await a.admin()).data; assert.equal(page.total, 6);
  const uid = page.players[0].uid, id = randomUUID(), input = { scope: "player", uid, amount: 3, reason: "活动赠送", requestId: id };
  const first = await a.admin(input); assert.equal(first.status, 200);
  assert.deepEqual((await a.admin(input)).data, first.data);
  assert.equal(avoidance.balance(a.store, uid), 4);
  assert.equal((await a.admin({ ...input, amount: 4 })).status, 409);
  assert.equal((await a.admin({ ...input, amount: 0, requestId: randomUUID() })).status, 400);
  assert.equal((await a.admin({ scope: "all", amount: 2, reason: "全员福利", expectedCount: 5, requestId: randomUUID() })).status, 409);
  a.store.addSession("test-session", "test:room:actor");
  const all = { scope: "all", amount: 2, reason: "全员福利", expectedCount: 6, requestId: randomUUID() };
  assert.equal((await a.admin(all)).data.recipients, 6);
  assert.equal((await a.admin(all)).data.recipients, 6);
  for (const p of page.players) assert.equal(avoidance.balance(a.store, p.uid), p.uid === uid ? 6 : 3);
  assert.equal(avoidance.balance(a.store, "test:room:actor"), 1);
  assert.equal(a.store.db.prepare("SELECT count(*) AS n FROM admin_audit WHERE action='grant-avoidance'").get().n, 2);
  const raw = (await a.request("/api/me/avoidance", tokens[0])).data;
  assert.ok(raw.history.some(h => h.note === "全员福利"));
});
test("站起、移出和修改板子清除回避；所有板子仅提供初始牌", () => {
  for (const b of engine.BOARDS.filter(b => b.available)) for (const capacity of b.counts) {
    const room = engine.newRoom("123456", "wx:host", "房主", b.id, capacity);
    const options = engine.avoidanceOptions(room);
    assert.equal(options.reduce((n, o) => n + o.count, 0), capacity);
    assert.ok(!options.some(o => ["witch", "prophet", "blueHunter"].includes(o.id)));
  }
  const room = engine.newRoom("123456", "wx:host", "房主", "classic", 6);
  const cmd = (type, extra) => engine.command(room, "wx:host", { stage: room.stage, type, ...extra });
  cmd("avoidance", { role: "merlin" }); cmd("stand"); assert.equal(room.avoidanceChoices["wx:host"], undefined);
  cmd("seat", { seat: 1 }); cmd("avoidance", { role: "merlin" }); cmd("configure", { board: "classic", capacity: 5 }); assert.equal(room.avoidanceChoices, undefined);
});
