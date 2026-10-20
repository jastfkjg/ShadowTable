"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../server/store");
const { createApp } = require("../server/app");
const { newRoom, enter, command } = require("../server/engine");
const avoidance = require("../server/avoidance");
const rewards = require("../server/avoidance-rewards");
const uid = "wx:reward-1";
let nextCode = 100000;
const run = (room, type, extra = {}) => command(room, room.host, { type, stage: room.stage, ...extra });
function memory(t, options) {
  const store = new Store(":memory:", options);
  t.after(() => store.close());
  return store;
}
function start(store, { register = true, score = false, purpose = "normal", uids } = {}) {
  uids ||= Array.from({ length: 6 }, (_, i) => "wx:reward-" + (i + 1));
  const room = newRoom(String(nextCode++), uids[0], "玩家1", "classic", 6);
  for (let i = 1; i < uids.length; i++) enter(room, uids[i], "玩家" + (i + 1));
  enter(room, "wx:watcher", "旁观者");
  run(room, "updateSettings", { board: "classic", capacity: 6, visible: false, scoreEnabled: score, recordPurpose: purpose });
  room.players.forEach(p => p.ready = true);
  run(room, "start", { flexible: true });
  room.roles = Object.fromEntries(room.players.map((p, i) => [p.uid, ["merlin", "percival", "servant", "servant", "morgana", "assassin"][i]]));
  room.fun.initialRoles = { ...room.roles };
  store.transaction(() => {
    if (register) rewards.registerStart(store, room);
    store.save(room);
  });
  return room;
}
function finish(store, room, outcome = "loss") {
  const scored = room.scoreEnabled;
  run(room, "finishTools", outcome === "none" ? {} : scored
    ? { scoreReason: outcome === "win" ? "assassination" : "quest_fail", ...(outcome === "win" ? { scoreTarget: 3 } : {}) }
    : { funReason: outcome === "win" ? "assassination" : "quest_fail", ...(outcome === "win" ? { funTarget: 3 } : {}) });
  room.matchRecord.endedAt = store.clock();
  store.transaction(() => store.save(room));
  return room;
}
const play = (store, outcome = "loss", options) => finish(store, start(store, options), outcome);
const progress = (store, account = uid) => ({ ...store.db.prepare("SELECT wins,losses,issued FROM avoidance_reward_accounts WHERE uid=?").get(account) });
const grants = (store, account = uid) => store.db.prepare("SELECT * FROM avoidance_ledger WHERE uid=? AND source IN ('match_reward','loss_reward','win_reward') ORDER BY rowid").all(account);
function manage(store, action, ...rooms) {
  return store.transaction(() => store.manageMatches({ action, matches: rooms.map(room => ({ id: room.matchId, revision: store.matchScoreData(room.matchId).revision })) }));
}
function correct(store, room, outcome) {
  const input = { revision: store.matchScoreData(room.matchId).revision };
  return store.transaction(() => room.scoreEnabled
    ? store.correctMatch(room.matchId, { ...input, scoreReason: outcome === "win" ? "assassination" : "quest_fail", ...(outcome === "win" ? { scoreTarget: 3 } : {}) })
    : store.correctFunMatch(room.matchId, { ...input, funReason: outcome === "win" ? "assassination" : "quest_fail", ...(outcome === "win" ? { funTarget: 3 } : {}) }));
}

test("胜负独立累计：跨房间、跨月，失利2场和胜利4场各发1张，3胜不发", t => {
  let now = Date.parse("2026-10-31T23:59:00+08:00");
  const store = memory(t, { clock: () => now });
  const outcomes = ["loss", "win", "loss", "win", "win", "win", "loss", "loss"];
  const expected = [0, 0, 1, 1, 1, 2, 2, 3];
  outcomes.forEach((outcome, i) => {
    play(store, outcome);
    assert.equal(avoidance.balance(store, uid), expected[i]);
    now += 60000;
  });
  assert.deepEqual(progress(store), { wins: 4, losses: 4, issued: 3 });
  assert.equal(grants(store).length, 3);
  assert.deepEqual(grants(store).map(grant => grant.source), ["loss_reward", "win_reward", "loss_reward"]);
  assert.equal(store.statsFor(uid).total, 8);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM match_scores WHERE uid=? AND status='scored'").get(uid).n, 0);
});

test("首次启用不补历史或旧在途对局；重启保留新局资格、累计及已发记录", t => {
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-rewards-")), file = join(directory, "test.sqlite");
  let store = new Store(file);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const historical = [play(store, "loss", { register: false }), play(store, "loss", { register: false })];
  const oldOpen = start(store, { register: false });
  // Simulate an upgrade from a database that predates the reward tables.
  store.db.exec("DROP TABLE avoidance_reward_accounts; DROP TABLE avoidance_reward_matches;");
  store.close(); store = new Store(file);
  finish(store, store.get(oldOpen.code));
  correct(store, historical[0], "win");
  manage(store, "exclude", historical[1]); manage(store, "include", historical[1]);
  assert.equal(avoidance.balance(store, uid), 0);
  assert.deepEqual(progress(store), {});
  play(store);
  const newOpen = start(store);
  store.close(); store = new Store(file);
  finish(store, store.get(newOpen.code));
  assert.equal(avoidance.balance(store, uid), 1);
  assert.deepEqual(progress(store), { wins: 0, losses: 2, issued: 1 });
  store.close(); store = new Store(file);
  store.archiveMatch(store.get(newOpen.code).matchRecord);
  assert.equal(avoidance.balance(store, uid), 1);
  assert.equal(grants(store).length, 1);
  play(store);
  assert.equal(avoidance.balance(store, uid), 1);
  play(store);
  assert.equal(avoidance.balance(store, uid), 2);
});

test("测试局、终止、未登记胜负及身份不完整均不累计，恢复测试记录也不发卡", t => {
  const store = memory(t);
  for (let i = 0; i < 2; i++) {
    const testing = play(store, "loss", { purpose: "test" });
    manage(store, "include", testing);
    const terminated = start(store);
    run(terminated, "terminate"); store.save(terminated);
    play(store, "none");
    const incomplete = start(store);
    delete incomplete.roles[incomplete.players[0].uid];
    run(incomplete, "finishTools", { winner: "evil" }); store.save(incomplete);
  }
  assert.equal(avoidance.balance(store, uid), 0);
  assert.deepEqual(progress(store), { wins: 0, losses: 0, issued: 0 });
  assert.equal(grants(store).length, 0);
  play(store);
  assert.deepEqual(progress(store), { wins: 0, losses: 1, issued: 0 });
});

test("正式局中真实玩家及开发/游客账号可获奖，陪测账号和旁观者不获奖", t => {
  const store = memory(t);
  const uids = [uid, "dev:reward", "guest:reward", "test:reward", "wx:reward-5", "wx:reward-6"];
  play(store, "loss", { uids }); play(store, "loss", { uids });
  for (const account of uids.slice(0, 3)) {
    assert.equal(avoidance.balance(store, account), 1);
    assert.deepEqual(progress(store, account), { wins: 0, losses: 2, issued: 1 });
  }
  for (const account of ["test:reward", "wx:watcher"]) {
    assert.equal(avoidance.balance(store, account), 0);
    assert.deepEqual(progress(store, account), {});
    assert.equal(grants(store, account).length, 0);
  }
});

for (const score of [false, true]) test(`后台更正${score ? "计分" : "不计分"}对局重算胜负；已用卡不追扣，多发抵扣未来奖励`, t => {
  const store = memory(t);
  const first = play(store, "loss", { score }); play(store, "loss", { score });
  assert.equal(avoidance.balance(store, uid), 1);
  store.transaction(() => avoidance.settle(store, { matchId: randomUUID(), avoidanceResults: { [uid]: { role: "merlin", status: "effective" } } }));
  assert.equal(avoidance.balance(store, uid), 0);
  correct(store, first, "win");
  assert.deepEqual(progress(store), { wins: 1, losses: 1, issued: 1 });
  assert.equal(avoidance.balance(store, uid), 0);
  store.transaction(() => avoidance.grant(store, { scope: "player", uid, amount: 2 }));
  play(store, "loss", { score });
  assert.deepEqual(progress(store), { wins: 1, losses: 2, issued: 1 });
  assert.equal(avoidance.balance(store, uid), 2);
  play(store, "win", { score }); play(store, "win", { score });
  assert.equal(avoidance.balance(store, uid), 2);
  play(store, "win", { score });
  assert.deepEqual(progress(store), { wins: 4, losses: 2, issued: 2 });
  assert.equal(avoidance.balance(store, uid), 3);
  assert.equal(grants(store).length, 2);
  const ledger = avoidance.wallet(store, uid).history;
  assert.equal(ledger.filter(r => r.source === "admin").length, 1);
  const revision = store.matchScoreData(first.matchId).revision;
  assert.throws(() => store.transaction(() => store.correctFunMatch(first.matchId, { revision: revision - 1, funReason: "quest_fail" })), /已更新/);
  assert.equal(grants(store).length, 2);
});

test("后台批量不计战绩、删除及恢复重算资格，不追回或重复发卡", t => {
  const store = memory(t);
  const rooms = Array.from({ length: 4 }, () => play(store));
  assert.equal(avoidance.balance(store, uid), 2);
  manage(store, "exclude", ...rooms.slice(0, 2));
  assert.deepEqual(progress(store), { wins: 0, losses: 2, issued: 2 });
  manage(store, "delete", ...rooms.slice(0, 2));
  manage(store, "restore", ...rooms.slice(0, 2));
  assert.deepEqual(progress(store), { wins: 0, losses: 2, issued: 2 });
  manage(store, "include", ...rooms.slice(0, 2));
  assert.deepEqual(progress(store), { wins: 0, losses: 4, issued: 2 });
  manage(store, "delete", ...rooms.slice(0, 2));
  manage(store, "restore", ...rooms.slice(0, 2));
  assert.equal(avoidance.balance(store, uid), 2);
  manage(store, "delete", ...rooms.slice(0, 2));
  play(store); play(store);
  assert.equal(avoidance.balance(store, uid), 2);
  play(store); play(store);
  assert.equal(avoidance.balance(store, uid), 3);
  assert.deepEqual(progress(store), { wins: 0, losses: 6, issued: 3 });
});

test("批量恢复新有效局可补足应得奖励；历史未登记的局仍不参与", t => {
  const store = memory(t);
  const rooms = [];
  for (let i = 0; i < 4; i++) {
    const room = start(store);
    store.db.prepare("INSERT INTO match_controls(match_id,state,reason,updated) VALUES(?,'excluded','待核对',?)").run(room.matchId, store.clock());
    rooms.push(finish(store, room));
  }
  assert.equal(avoidance.balance(store, uid), 0);
  manage(store, "include", ...rooms);
  assert.equal(avoidance.balance(store, uid), 2);
  assert.equal(grants(store).length, 1);
  assert.equal(grants(store)[0].delta, 2);
  rooms.forEach(room => store.archiveMatch(room.matchRecord));
  assert.equal(avoidance.balance(store, uid), 2);
  play(store, "loss", { register: false }); play(store, "loss", { register: false });
  assert.equal(avoidance.balance(store, uid), 2);
});

test("奖励写入失败时整场归档、余额、累计和流水回滚，重试归档只发一次", t => {
  const store = memory(t);
  play(store);
  const room = start(store);
  run(room, "finishTools", { funReason: "quest_fail" });
  store.db.exec(`CREATE TRIGGER fail_reward BEFORE INSERT ON avoidance_ledger WHEN NEW.source IN ('match_reward','loss_reward','win_reward')
    BEGIN SELECT RAISE(ABORT,'simulate reward failure'); END;`);
  assert.throws(() => store.transaction(() => store.save(room)), /simulate reward failure/);
  assert.equal(store.db.prepare("SELECT 1 FROM matches WHERE id=?").get(room.matchId), undefined);
  assert.equal(store.db.prepare("SELECT 1 FROM match_players WHERE match_id=?").get(room.matchId), undefined);
  assert.equal(store.get(room.code).phase, "tools");
  assert.equal(avoidance.balance(store, uid), 0);
  assert.deepEqual(progress(store), { wins: 0, losses: 1, issued: 0 });
  assert.equal(grants(store).length, 0);
  store.db.exec("DROP TRIGGER fail_reward");
  store.save(room);
  for (let i = 0; i < 5; i++) store.archiveMatch(room.matchRecord);
  assert.equal(avoidance.balance(store, uid), 1);
  assert.equal(grants(store).length, 1);
  const pending = start(store, { register: false });
  assert.throws(() => store.transaction(() => { rewards.registerStart(store, pending); throw Error("rollback start"); }), /rollback start/);
  assert.equal(store.db.prepare("SELECT 1 FROM avoidance_reward_matches WHERE match_id=?").get(pending.matchId), undefined);
});

test("自动奖励复用收卡通知，与管理员赠卡合并；已读仅本人、保留并发新奖励", t => {
  const store = memory(t);
  play(store); play(store);
  store.transaction(() => avoidance.grant(store, { scope: "player", uid, amount: 3 }));
  const displayed = avoidance.grantNotice(store, uid);
  assert.equal(displayed.balance, 4);
  assert.equal(displayed.notice.amount, 4);
  assert.equal(displayed.notice.grants, 2);
  assert.equal(displayed.notice.kind, "generic");
  play(store); play(store);
  const newest = avoidance.grantNotice(store, uid).notice.through;
  assert.notEqual(newest, displayed.notice.through);
  assert.throws(() => avoidance.acknowledgeGrant(store, "wx:other", { through: newest }), /通知不存在/);
  avoidance.acknowledgeGrant(store, uid, { through: displayed.notice.through });
  assert.deepEqual(avoidance.grantNotice(store, uid), { balance: 5, notice: { through: newest, amount: 1, grants: 1, kind: "loss" } });
  avoidance.acknowledgeGrant(store, uid, { through: newest });
  avoidance.acknowledgeGrant(store, uid, { through: newest });
  assert.equal(avoidance.grantNotice(store, uid).notice, null);
  store.transaction(() => avoidance.settle(store, { matchId: randomUUID(), avoidanceResults: { [uid]: { role: "merlin", status: "effective" } } }));
  const spend = avoidance.wallet(store, uid).history.find(row => row.source === "spend");
  assert.throws(() => avoidance.acknowledgeGrant(store, uid, { through: spend.id }), /通知不存在/);
  assert.equal(avoidance.grantNotice(store, uid).notice, null);
});

test("奖励通知区分胜负来源，旧奖励及混合来源保持通用文案，确认包含所有来源", t => {
  const store = memory(t);
  for (let i = 0; i < 4; i++) play(store, "win");
  const victory = avoidance.grantNotice(store, uid);
  assert.equal(victory.notice.kind, "win");
  assert.equal(victory.notice.amount, 1);
  avoidance.acknowledgeGrant(store, uid, victory.notice);
  play(store); play(store);
  const loss = avoidance.grantNotice(store, uid);
  assert.equal(loss.notice.kind, "loss");
  assert.equal(loss.notice.amount, 1);
  avoidance.acknowledgeGrant(store, uid, loss.notice);
  store.transaction(() => avoidance.grant(store, { scope: "player", uid, amount: 1 }));
  assert.equal(avoidance.grantNotice(store, uid).notice.kind, "generic");
  play(store); play(store);
  const mixed = avoidance.grantNotice(store, uid);
  assert.equal(mixed.notice.kind, "generic");
  assert.equal(mixed.notice.amount, 2);
  avoidance.acknowledgeGrant(store, uid, mixed.notice);
  assert.equal(avoidance.grantNotice(store, uid).notice, null);
  const oldId = randomUUID();
  store.transaction(() => {
    store.db.prepare("UPDATE avoidance_accounts SET balance=balance+1 WHERE uid=?").run(uid);
    store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)")
      .run(oldId, uid, 1, avoidance.balance(store, uid), "match_reward", "旧版合并奖励", null, store.clock());
  });
  assert.equal(avoidance.grantNotice(store, uid).notice.kind, "generic");
  avoidance.acknowledgeGrant(store, uid, { through: oldId });
  assert.equal(avoidance.grantNotice(store, uid).notice, null);
});

test("真实HTTP开局与结算自动发奖，重试不重发，原有通知接口即可读取及确认", async t => {
  const app = createApp({ database: ":memory:", exchangeCode: async code => code });
  t.after(async () => { if (app.server.listening) await new Promise(resolve => app.server.close(resolve)); app.store.close(); });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
  const base = "http://127.0.0.1:" + app.server.address().port;
  const request = (path, token, data, id = randomUUID()) => new Promise((resolve, reject) => {
    const req = require("node:http").request(base + path, { method: data ? "POST" : "GET", headers: {
      Authorization: "Bearer " + (token || ""), "Content-Type": "application/json", "Idempotency-Key": id,
    } }, res => {
      let text = ""; res.on("data", chunk => text += chunk);
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on("error", reject); req.end(data ? JSON.stringify(data) : undefined);
  });
  const tokens = [];
  for (let i = 0; i < 6; i++) tokens.push((await request("/api/login", null, { code: "reward-http-" + i })).data.token);
  const created = await request("/api/rooms", tokens[0], { name: "玩家0", board: "classic", capacity: 6 });
  assert.equal(created.status, 200);
  const path = "/api/rooms/" + created.data.code;
  for (let i = 1; i < 6; i++) assert.equal((await request(path + "/join", tokens[i], { name: "玩家" + i })).status, 200);
  const cmd = async (type, extra = {}, token = tokens[0]) => {
    const view = (await request(path, token)).data;
    return request(path + "/commands", token, { type, stage: view.stage, ...extra });
  };
  const finalRequests = [];
  for (let i = 0; i < 2; i++) {
    for (const token of tokens) assert.equal((await cmd("ready", { ready: true }, token)).status, 200);
    const view = (await request(path, tokens[0])).data, startId = randomUUID();
    const body = { type: "start", stage: view.stage, flexible: true };
    assert.equal((await request(path + "/commands", tokens[0], body, startId)).status, 200);
    assert.equal((await request(path + "/commands", tokens[0], body, startId)).status, 200);
    const privateView = (await request(path + "/private", tokens[0])).data;
    const stage = (await request(path, tokens[0])).data.stage;
    const final = { type: "finishTools", stage, winner: privateView.faction === "好人阵营" ? "evil" : "good" }, id = randomUUID();
    assert.equal((await request(path + "/commands", tokens[0], final, id)).status, 200);
    assert.equal((await request(path + "/commands", tokens[0], final, id)).status, 200);
    finalRequests.push([final, id]);
    if (i === 0) assert.equal((await cmd("rematch")).status, 200);
  }
  const notice = (await request("/api/me/avoidance/notice", tokens[0])).data;
  assert.equal(notice.balance, 1); assert.equal(notice.notice.amount, 1);
  const account = app.store.get(created.data.code).host;
  assert.deepEqual(progress(app.store, account), { wins: 0, losses: 2, issued: 1 });
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM avoidance_reward_matches").get().n, 2);
  for (const [body, id] of finalRequests) assert.equal((await request(path + "/commands", tokens[0], body, id)).status, 200);
  assert.equal((await request("/api/me/avoidance/notice", tokens[0])).data.notice.amount, 1);
  assert.equal((await request("/api/me/avoidance/notice", tokens[0], { through: notice.notice.through })).status, 200);
  assert.equal((await request("/api/me/avoidance/notice", tokens[0])).data.notice, null);
  assert.equal((await cmd("rematch")).status, 200);
  const lobby = (await request(path, tokens[0])).data;
  assert.equal(lobby.me.avoidance.balance, 1);
  assert.equal((await cmd("avoidance", { role: "merlin" })).status, 200);
});
