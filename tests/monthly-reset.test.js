"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../server/store");
const { Leaderboard } = require("../server/leaderboard");
const { readMonthlyReset, acknowledgeMonthlyReset } = require("../server/monthly-reset");
const { createApp } = require("../server/app");
const at = value => Date.parse(value + "+08:00");
const archive = (store, endedAt, points, outcome = "win", uid = "wx:monthly") => store.transaction(() => store.archiveMatch({
  id: randomUUID(), board: "classic", boardName: "经典", capacity: 6, endedAt, winner: "good",
  players: [{ uid, name: "月度玩家", role: "忠臣", faction: "good", outcome,
    score: { status: "scored", total: points, breakdown: [] } }],
}));
const adjust = (store, points, mode = "delta", revision = store.scoreRevision("wx:monthly")) => store.transaction(() =>
  store.adjustPlayerScore({ uid: "wx:monthly", mode, points, revision }));

test("北京时间月初自动清零，积分榜拒绝跨月累加，其他榜默认本月且可查看全部", () => {
  let now = at("2026-10-31T23:59:59.999");
  const store = new Store(":memory:", { clock: () => now });
  try {
    archive(store, now, 9); adjust(store, -2);
    const board = new Leaderboard(store), read = q => board.read("wx:monthly", new URLSearchParams(q), now);
    const old = read("metric=points&period=all"), revision = store.scoreLedger("wx:monthly").revision;
    assert.equal(old.period, "month"); assert.equal(old.me.points, 7);
    now++;
    assert.equal(store.playerScore("wx:monthly").points, 0);
    assert.equal(store.statsFor("wx:monthly").score.total, 0);
    assert.equal(store.statsSummaryFor("wx:monthly").scoreTotal, 0);
    assert.equal(store.scoreLedger("wx:monthly").total, 0);
    assert.throws(() => store.scoreLedger("wx:monthly", 20, 20, revision), e => e.status === 409);
    assert.throws(() => adjust(store, 10, "set", revision), e => e.status === 409);
    const next = read("metric=points&period=all");
    assert.notEqual(old.version, next.version); assert.equal(next.me.points, 0); assert.equal(next.rows.length, 0);
    assert.equal(read("metric=games").me.total, 0);
    assert.equal(read("metric=games&period=all").me.total, 1);
    assert.throws(() => read("metric=points&period=invalid"), e => e.status === 400);
    archive(store, now, 3); adjust(store, 5, "set");
    assert.equal(store.playerScore("wx:monthly").points, 5);
    assert.equal(read("metric=points").me.points, 5);
    assert.equal(store.scoreLedger("wx:monthly").records.reduce((n, r) => n + r.points, 0), 5);
    // Late corrections still belong to the month in which the game ended.
    archive(store, now - 1, 100);
    assert.equal(store.playerScore("wx:monthly").points, 5);
    assert.equal(readMonthlyReset(store, "wx:monthly").previous.points, 107);
    assert.equal(store.matchesFor("wx:monthly").total, 3);
  } finally { store.close(); }
});

test("上月简报包含胜负、胜率和调分，按账号确认后跨重启不重弹，跨年重新提示", () => {
  let now = at("2026-12-31T23:59:59");
  const directory = mkdtempSync(join(tmpdir(), "shadow-monthly-")), file = join(directory, "store.sqlite");
  let store = new Store(file, { clock: () => now });
  try {
    archive(store, now, 8); archive(store, now, -2, "loss"); adjust(store, 3);
    now = at("2027-01-01T00:00:00");
    const notice = readMonthlyReset(store, "wx:monthly");
    assert.equal(notice.month, "2027-01"); assert.equal(notice.previousMonth, "2026-12");
    assert.deepEqual(notice.previous, { total: 2, wins: 1, losses: 1, winRate: 50, points: 9, scoredGames: 2, adjustmentPoints: 3 });
    assert.deepEqual(readMonthlyReset(store, "wx:monthly"), notice); // Reads never acknowledge a displayed notice.
    assert.equal(readMonthlyReset(store, "wx:new"), null);
    assert.equal(readMonthlyReset(store, "test:companion"), null);
    assert.throws(() => acknowledgeMonthlyReset(store, "wx:monthly", "2026-12"), e => e.status === 409);
    acknowledgeMonthlyReset(store, "wx:monthly", notice.month); acknowledgeMonthlyReset(store, "wx:monthly", notice.month);
    store.close(); store = new Store(file, { clock: () => now });
    assert.equal(readMonthlyReset(store, "wx:monthly"), null);
    now = at("2027-03-10T12:00:00");
    const empty = readMonthlyReset(store, "wx:monthly");
    assert.equal(empty.previousMonth, "2027-02"); assert.equal(empty.previous.total, 0); assert.equal(empty.previous.points, 0);
    assert.equal(empty.previous.winRate, null);
    assert.equal(readMonthlyReset(store, "wx:new").month, "2027-03");
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("月度提醒接口只读本人、确认幂等，错误月份和额外身份参数被拒绝", async t => {
  let now = at("2026-10-31T23:59:59");
  const app = createApp({ database: ":memory:", clock: () => now });
  archive(app.store, now, 9); now = at("2026-11-01T00:00:00");
  const token = "e".repeat(64); app.store.addSession(createHash("sha256").update(token).digest("hex"), "wx:monthly");
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.close(); });
  const base = "http://127.0.0.1:" + app.server.address().port;
  const request = (path, body, auth = true) => fetch(base + path, { method: body ? "POST" : "GET",
    headers: { ...(auth ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request("/api/me/monthly-reset", { month: "2026-11" }, false)).status, 401);
  const stats = await (await request("/api/me/stats")).json();
  assert.equal(stats.score.total, 0); assert.equal(stats.monthlyReset.previous.points, 9);
  assert.equal((await request("/api/me/monthly-reset", { month: "2026-11", uid: "wx:other" })).status, 400);
  assert.equal((await request("/api/me/monthly-reset", { month: "2026-10" })).status, 409);
  for (let i = 0; i < 2; i++) assert.equal((await request("/api/me/monthly-reset", { month: "2026-11" })).status, 200);
  assert.equal((await (await request("/api/me/stats")).json()).monthlyReset, null);
});
