const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store } = require("../server/store");
const { createApp } = require("../server/app");
const clearing = require("../server/record-clearing");
const { Leaderboard } = require("../server/leaderboard");
const { MonthlyReport } = require("../server/monthly-report");
const { readProfile, saveProfile } = require("../server/profile");
const { readBadges } = require("../server/badges");
const { readRoomPlayerStats, playerStatsId } = require("../server/player-stats");
const { monthRange } = require("../miniprogram/monthly-report");
const NOW = Date.parse("2026-10-26T04:00:00Z"), { start, end } = monthRange("2026-10");
function game(store, endedAt = NOW, { points = 3, outcome = "win", uid = "wx:me" } = {}) {
  const record = { id: randomUUID(), code: "123456", board: "classic", boardName: "经典", capacity: 6, startedAt: endedAt - 3600000, endedAt,
    winner: "good", source: "manual", excludedReason: null,
    players: [{ uid, name: "我", seat: 1, role: "梅林", roleId: "merlin", faction: "good", outcome, score: { status: "scored", total: points, breakdown: [] } },
      { uid: "wx:friend", name: "朋友", seat: 2, role: "刺客", roleId: "assassin", faction: "evil", outcome: "loss", score: { status: "scored", total: 1, breakdown: [] } }] };
  store.archiveMatch(record);
  store.db.prepare("INSERT OR REPLACE INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)").run(record.id, uid, "classic", "merlin_evade", "merlin", "梅林", 1, 1, "known", endedAt);
  store.invalidateLeaderboard();
  return record;
}
function profile(store, uid) { store.transaction(() => saveProfile(store, uid, { nickname: uid.slice(3), version: readProfile(store, uid).version, leaderboardVisible: true })); }
function adjust(store, uid = "wx:me", created = NOW) {
  const id = randomUUID();
  store.db.prepare("INSERT INTO score_adjustments VALUES(?,?,?,?,?,?,?,?)").run(id, uid, 4, "delta", 0, 4, "调整", created);
  return id;
}
function remove(store, uid = "wx:me", month = "2026-10") {
  const preview = clearing.preview(store, uid, month);
  return store.transaction(() => clearing.clear(store, uid, { month, version: preview.version }));
}
test("按玩家按月清除全部统计，保留同桌对局并同步刷新榜单、月报、徽章和名片", () => {
  const store = new Store(":memory:", { clock: () => NOW });
  try {
    profile(store, "wx:me"); profile(store, "wx:friend");
    const old = game(store, start - 1), current = game(store); adjust(store);
    const board = new Leaderboard(store), report = new MonthlyReport(store);
    const beforeBoard = board.read("wx:me", new URLSearchParams("metric=games"), NOW);
    const beforeReport = report.read(new URLSearchParams("month=2026-10"), NOW);
    assert.ok(readBadges(store, "wx:me").badges.some(b => b.id === "games"));
    const preview = clearing.preview(store, "wx:me", "2026-10");
    assert.deepEqual(preview.summary, { records: 1, validGames: 1, funGames: 1, scoredGames: 1, adjustments: 1, points: 7 });
    assert.doesNotMatch(JSON.stringify(preview), /wx:|snapshot|match_id/);
    remove(store);
    assert.deepEqual(store.matchesFor("wx:me").records.map(r => r.id), [old.id]);
    assert.equal(store.statsFor("wx:me").total, 1);
    assert.equal(store.playerScore("wx:me").points, 0);
    assert.equal(store.scoreLedger("wx:me").total, 0);
    assert.equal(store.scoreAdjustments("wx:me").total, 0);
    assert.throws(() => store.matchFor("wx:me", current.id), /不存在或已移除/);
    assert.throws(() => store.replayFor("wx:me", current.id), /不存在或已移除/);
    assert.equal(store.matchesFor("wx:friend").total, 2);
    assert.equal(store.matchFor("wx:friend", current.id).members.length, 2);
    assert.equal(store.playerScore("wx:friend").points, 1);
    assert.equal(store.funFor("wx:me").cards.flatMap(c => c.metrics).find(m => m.id === "merlin_evade").count, 1);
    const afterBoard = board.read("wx:me", new URLSearchParams("metric=games"), NOW);
    assert.equal(afterBoard.me.rank, null); assert.notEqual(afterBoard.version, beforeBoard.version);
    assert.equal(board.read("wx:me", new URLSearchParams("metric=games&period=all"), NOW).me.total, 1);
    assert.equal(board.read("wx:me", new URLSearchParams("metric=points"), NOW).me.points, 0);
    assert.equal(board.read("wx:me", new URLSearchParams("metric=fun_merlin_evade"), NOW).me.count, 0);
    const afterReport = report.read(new URLSearchParams("month=2026-10"), NOW);
    assert.ok(afterReport.version > beforeReport.version);
    assert.equal(afterReport.mainBoards.find(b => b.id === "games").rows.length, 1);
    assert.equal(afterReport.overview.games, 1);
    assert.equal(readBadges(store, "wx:me").badges.filter(b => !b.permanent).length, 0);
    const room = { code: "123456", players: [{ uid: "wx:me", seat: 1 }, { uid: "wx:friend", seat: 2 }] };
    assert.equal(readRoomPlayerStats(store, room, "wx:friend", playerStatsId(room, room.players[0])).stats.total, 1);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM match_players WHERE uid='wx:me'").get().n, 2);
  } finally { store.close(); }
});
test("北京时间月界、积分调整单独清理及无效月份校验", () => {
  const store = new Store(":memory:", { clock: () => NOW });
  try {
    const previous = game(store, start - 1), first = game(store, start), last = game(store, end - 1), next = game(store, end);
    adjust(store, "wx:me", start - 1); adjust(store); adjust(store, "wx:me", end);
    assert.deepEqual(clearing.months(store, "wx:me").months, ["2026-10", "2026-09"]);
    remove(store);
    assert.deepEqual(new Set(store.matchesFor("wx:me").records.map(r => r.id)), new Set([previous.id, next.id]));
    assert.equal(store.scoreAdjustments("wx:me").total, 2);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM player_record_clears WHERE record_id IN (?,?)").get(first.id, last.id).n, 2);
    for (const month of [null, "2026-1", "2026-13", "2026-11", "../2026-10"]) assert.throws(() => clearing.preview(store, "wx:me", month), /有效月份/);
    adjust(store, "wx:only-adjustments");
    assert.equal(clearing.preview(store, "wx:only-adjustments", "2026-10").summary.records, 0);
    remove(store, "wx:only-adjustments");
    assert.equal(store.playerScore("wx:only-adjustments").points, 0);
    assert.deepEqual(clearing.months(store, "wx:only-adjustments").months, []);
  } finally { store.close(); }
});
test("新对局和积分更正使预览过期，预览绑定本人且失败事务不留清理痕迹", () => {
  const store = new Store(":memory:", { clock: () => NOW });
  try {
    const record = game(store), preview = clearing.preview(store, "wx:me", "2026-10");
    const input = { month: preview.month, version: preview.version };
    assert.throws(() => store.transaction(() => clearing.clear(store, "wx:friend", input)), /数据已变化/);
    store.db.prepare("UPDATE match_scores SET points=8 WHERE match_id=? AND uid=?").run(record.id, "wx:me");
    assert.throws(() => store.transaction(() => clearing.clear(store, "wx:me", input)), /数据已变化/);
    const fresh = clearing.preview(store, "wx:me", "2026-10"); game(store);
    assert.throws(() => store.transaction(() => clearing.clear(store, "wx:me", { month: fresh.month, version: fresh.version })), /数据已变化/);
    const revision = store.leaderboardRevision, scoreRevision = store.scoreRevision("wx:me");
    assert.throws(() => store.transaction(() => { clearing.clear(store, "wx:me", { month: "2026-10", version: clearing.preview(store, "wx:me", "2026-10").version }); throw Error("写入失败"); }), /写入失败/);
    assert.equal(store.leaderboardRevision, revision); assert.equal(store.scoreRevision("wx:me"), scoreRevision);
    assert.equal(store.matchesFor("wx:me").total, 2);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM player_data_clears").get().n, 0);
    assert.throws(() => store.transaction(() => clearing.clear(store, "wx:me", { ...input, uid: "wx:friend" })), /先预览/);
  } finally { store.close(); }
});
test("重复归档、管理员删除后恢复、趣味重建和重启不会恢复已清理记录，新对局继续计入", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadowtable-clear-")), path = join(dir, "test.sqlite");
  let store = new Store(path, { clock: () => NOW });
  try {
    const record = game(store);
    store.db.prepare("INSERT INTO match_controls VALUES(?,'deleted','active','','',?)").run(record.id, NOW);
    remove(store);
    store.db.prepare("UPDATE match_controls SET state='active' WHERE match_id=?").run(record.id);
    store.archiveMatch(record);
    const match = JSON.parse(store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(record.id).snapshot);
    store.transaction(() => store.rebuildFun(match, store.matchParticipants(match)));
    assert.equal(store.matchesFor("wx:me").total, 0);
    store.close(); store = new Store(path, { clock: () => NOW });
    assert.equal(store.statsFor("wx:me").total, 0);
    assert.equal(store.matchesFor("wx:friend").total, 1);
    const fresh = game(store);
    assert.equal(store.statsFor("wx:me").total, 1);
    assert.equal(store.matchesFor("wx:me").records[0].id, fresh.id);
    assert.equal(store.playerScore("wx:me").points, 3);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("永久徽章、回避卡余额及累计奖励进度保留", () => {
  const store = new Store(":memory:", { clock: () => NOW });
  try {
    game(store); require("../server/badge-awards").activate(store);
    require("../server/avoidance").ensureAccount(store, "wx:me");
    store.db.prepare("UPDATE avoidance_accounts SET balance=5 WHERE uid='wx:me'").run();
    store.db.prepare("INSERT INTO avoidance_reward_accounts VALUES('wx:me',4,2,2)").run();
    const permanent = readBadges(store, "wx:me").badges.filter(b => b.permanent).map(b => b.id);
    const rewards = store.db.prepare("SELECT * FROM avoidance_reward_accounts WHERE uid='wx:me'").get();
    remove(store);
    assert.deepEqual(readBadges(store, "wx:me").badges.filter(b => b.permanent).map(b => b.id), permanent);
    assert.equal(require("../server/avoidance").balance(store, "wx:me"), 5);
    assert.deepEqual(store.db.prepare("SELECT * FROM avoidance_reward_accounts WHERE uid='wx:me'").get(), rewards);
  } finally { store.close(); }
});
test("清理后完成旧局荣誉票选仍更新同桌结果，但本人积分和趣味记录不会重新出现", () => {
  const store = new Store(":memory:", { clock: () => NOW });
  const { newRoom, enter, command } = require("../server/engine"), honors = require("../server/honors");
  try {
    const room = newRoom("123456", "wx:me", "我", "classic", 6);
    room.scoreEnabled = true;
    for (let i = 2; i <= 6; i++) enter(room, "wx:" + i, "玩家" + i);
    room.players.forEach(p => p.ready = true);
    command(room, room.host, { type: "start", stage: room.stage, flexible: true });
    room.roles = Object.fromEntries(room.players.map((p, i) => [p.uid, ["merlin", "percival", "servant", "servant", "morgana", "assassin"][i]]));
    room.fun.initialRoles = { ...room.roles };
    command(room, room.host, { type: "finishTools", stage: room.stage, replace: true, scoreReason: "assassination", scoreTarget: 3 });
    room.matchRecord.endedAt = NOW;
    store.save(room);
    const act = (uid, type, extra = {}) => store.transaction(() => honors.handle(store, room, uid, { type, stage: room.stage, matchId: room.matchRecord.id, ...extra }));
    act("wx:me", "honorStart"); remove(store);
    for (const p of room.players) act(p.uid, "honorVote", { mvp: p.uid === "wx:me" ? 2 : 1, svp: p.seat === 5 ? 6 : 5 });
    store.save(room);
    assert.equal(store.statsFor("wx:me").total, 0);
    assert.equal(store.scoreForMonth("wx:me").points, 0);
    assert.equal(store.matchesFor("wx:2").total, 1);
    assert.equal(store.matchFor("wx:2", room.matchRecord.id).honorResult.status, "settled");
    assert.equal(new Leaderboard(store).read("wx:me", new URLSearchParams("metric=fun_honor_mvp"), NOW).me.count, 0);
  } finally { store.close(); }
});
test("HTTP清理鉴权、参数校验、事务回滚及幂等重试不清除后来新局", async () => {
  const app = createApp({ database: ":memory:", devAuth: true, clock: () => NOW, logger: { error() {} } });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  async function request(path = "", token = "", data, id) {
    const res = await fetch(base + "/api/me/record-clearing" + path, { method: data ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(id ? { "Idempotency-Key": id } : {}) }, body: data ? JSON.stringify(data) : undefined });
    return { status: res.status, data: await res.json() };
  }
  try {
    const token = "a".repeat(64), friend = "b".repeat(64), { createHash } = require("node:crypto");
    app.store.addSession(createHash("sha256").update(token).digest("hex"), "wx:me");
    app.store.addSession(createHash("sha256").update(friend).digest("hex"), "wx:friend");
    game(app.store);
    assert.equal((await request()).status, 401);
    assert.equal((await request("?uid=wx:friend", token)).status, 400);
    assert.equal((await request("?month=2026-10&month=2026-09", token)).status, 400);
    const preview = (await request("?month=2026-10", token)).data;
    const body = { month: preview.month, version: preview.version }, id = randomUUID();
    assert.equal((await request("", token, body)).status, 400);
    assert.equal((await request("", friend, body, randomUUID())).status, 409);
    const receipt = app.store.addReceipt;
    app.store.addReceipt = () => { throw Error("写入失败"); };
    assert.equal((await request("", token, body, id)).status, 500);
    assert.equal(app.store.matchesFor("wx:me").total, 1);
    app.store.addReceipt = receipt;
    const result = await request("", token, body, id);
    assert.equal(result.status, 200); assert.equal(result.data.summary.records, 1);
    game(app.store);
    assert.deepEqual(await request("", token, body, id), result);
    assert.equal(app.store.matchesFor("wx:me").total, 1);
    assert.equal((await request("", token, { ...body, month: "2026-09" }, id)).status, 409);
    assert.equal(app.store.matchesFor("wx:friend").total, 2);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
