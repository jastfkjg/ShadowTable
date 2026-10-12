const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Store } = require("../server/store");
const { MonthlyReport } = require("../server/monthly-report");
const { readProfile, saveProfile } = require("../server/profile");
const { createApp } = require("../server/app");
const presentation = require("../miniprogram/monthly-report");
const cardRenderer = require("../miniprogram/monthly-report-card");
const cards = require("../miniprogram/share-card");
const NOW = Date.parse("2026-10-12T04:00:00Z"), SEPTEMBER = Date.parse("2026-09-15T04:00:00Z");
const read = (reports, month = "2026-09", now = NOW) => reports.read(new URLSearchParams("month=" + month), now);
function profile(store, uid, visible = true) {
  store.transaction(() => saveProfile(store, uid, { nickname: uid.split(":")[1], version: readProfile(store, uid).version, leaderboardVisible: visible }));
}
function match(store, entries, endedAt = SEPTEMBER) {
  const id = randomUUID();
  store.transaction(() => store.archiveMatch({ id, board: "classic", boardName: "经典", capacity: 6, winner: "good", endedAt,
    players: entries.map(entry => ({ name: "私密牌桌昵称", role: "忠臣", faction: "good", outcome: "win", ...entry,
      ...(entry.points === undefined ? {} : { score: { status: "scored", total: entry.points, breakdown: [] } }) })) }));
  return id;
}
function games(store, uid, total, wins, points, endedAt = SEPTEMBER) {
  return Array.from({ length: total }, (_, index) => match(store, [{ uid, outcome: index < wins ? "win" : "loss", points }], endedAt));
}
function funRecord(store, matchId, uid, metric, count, opportunities, status = "known") {
  store.transaction(() => {
    store.db.prepare("INSERT OR REPLACE INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)").run(matchId, uid, "classic", metric, "merlin", "梅林", count, opportunities, status, SEPTEMBER);
    store.invalidateLeaderboard();
  });
}
test("月报按北京时间半开区间统计，概览对对局、玩家及结算日去重", () => {
  const store = new Store(":memory:");
  try {
    const reports = new MonthlyReport(store), { start, end } = presentation.monthRange("2026-09");
    profile(store, "wx:a"); profile(store, "wx:b"); profile(store, "wx:hidden", false);
    match(store, [{ uid: "wx:a" }, { uid: "wx:b" }, { uid: "wx:hidden" }, { uid: "guest:c" }], start);
    match(store, [{ uid: "wx:a" }], end - 1);
    match(store, [{ uid: "wx:a" }], start - 1);
    match(store, [{ uid: "wx:a" }], end);
    match(store, [{ uid: "wx:a", outcome: "excluded" }], start + 1000);
    match(store, [{ uid: "test:companion" }], start + 1000);
    const report = read(reports);
    assert.deepEqual(report.overview, { games: 2, players: 4, activeDays: 2 });
    assert.equal(report.firstMonth, "2026-08"); assert.equal(report.status, "complete");
    assert.deepEqual(report.mainBoards.find(board => board.id === "games").rows.map(row => [row.nickname, row.total]), [["a", 2], ["b", 1]]);
    assert.doesNotMatch(JSON.stringify(report), /wx:|guest:|test:|私密牌桌昵称|hidden|roleId|snapshot/);
    assert.equal(read(reports, "2026-10").status, "preview");
    assert.equal(read(reports, "2026-08").overview.games, 1);
    for (const month of ["2026-00", "2026-13", "2026-9", "2026-11", "foo", "2026-09%26uid=wx:a"]) assert.throws(() => read(reports, month), /月份/);
    for (const query of ["month=2026-09&month=2026-10", "month=2026-09&uid=wx:a", "edition=fun"]) assert.throws(() => reports.read(new URLSearchParams(query), NOW), /参数/);
    assert.equal(presentation.monthRange("2026-02").end - presentation.monthRange("2026-02").start, 28 * 86400000);
    assert.equal(presentation.monthRange("2024-02").end - presentation.monthRange("2024-02").start, 29 * 86400000);
    assert.equal(presentation.monthAt(Date.parse("2026-12-31T16:00:00Z")), "2027-01");
  } finally { store.close(); }
});
test("积分含当月调整及零分计分局，胜率荣誉门槛10局，按原始比例与样本排名", () => {
  const store = new Store(":memory:");
  try {
    const reports = new MonthlyReport(store);
    for (const uid of ["wx:a", "wx:b", "wx:c", "wx:small", "wx:adjustment"]) profile(store, uid);
    games(store, "wx:a", 20, 15, 2); games(store, "wx:b", 12, 9, 3); games(store, "wx:c", 10, 6, 0);
    games(store, "wx:small", 1, 1, 5); games(store, "wx:adjustment", 10, 9);
    store.transaction(() => {
      store.adjustPlayerScore({ uid: "wx:b", mode: "delta", points: 10, revision: store.scoreRevision("wx:b") });
      // Adjustment dates belong to their operation month, independently of the original games.
      store.db.prepare("UPDATE score_adjustments SET created=? WHERE uid=?").run(SEPTEMBER, "wx:b");
      store.adjustPlayerScore({ uid: "wx:adjustment", mode: "delta", points: 100, revision: store.scoreRevision("wx:adjustment") });
      store.db.prepare("UPDATE score_adjustments SET created=? WHERE uid=?").run(SEPTEMBER, "wx:adjustment");
    });
    const report = read(reports), points = report.mainBoards[0], wins = report.mainBoards[1];
    assert.equal(points.rows[0].nickname, "b"); assert.equal(points.rows[0].points, 46); assert.equal(points.rows[0].adjustmentPoints, 10);
    assert.equal(points.eligibleCount, 4); assert.equal(points.rows.some(row => row.nickname === "adjustment"), false);
    assert.equal(wins.eligibleCount, 4); assert.equal(wins.rows.some(row => row.nickname === "small"), false);
    assert.deepEqual(wins.rows.map(row => [row.nickname, row.winRate]), [["adjustment", 90], ["a", 75], ["b", 75]]);
    assert.equal(wins.rows[1].rank, 2); assert.equal(wins.rows[2].rank, 3); assert.equal(wins.rows[1].tied, false);
  } finally { store.close(); }
});
test("趣味榜仅使用已知机会，次数和比例分开，精选正向榜与娱乐榜隔离", () => {
  const store = new Store(":memory:");
  try {
    const reports = new MonthlyReport(store);
    for (const uid of ["wx:a", "wx:b", "wx:c"]) profile(store, uid);
    const a = match(store, [{ uid: "wx:a" }]), b = match(store, [{ uid: "wx:b" }]), c = match(store, [{ uid: "wx:c" }]);
    funRecord(store, a, "wx:a", "merlin_evade", 3, 5); funRecord(store, b, "wx:b", "merlin_evade", 3, 6);
    funRecord(store, c, "wx:c", "merlin_evade", 1, 1);
    funRecord(store, a, "wx:a", "assassin_hit", 2, 5); funRecord(store, b, "wx:b", "good_shield", 1, 5);
    funRecord(store, b, "wx:b", "assassin_miss", 4, 5);
    const unknown = match(store, [{ uid: "wx:a" }]); funRecord(store, unknown, "wx:a", "merlin_evade", 100, 100, "unknown");
    const response = read(reports), report = presentation.presentReport(response);
    assert.deepEqual(report.featured.map(board => board.id), ["merlin_evade:count", "assassin_hit:count", "good_shield:count"]);
    const count = report.funBoards.find(board => board.id === "merlin_evade:count"), rate = report.funBoards.find(board => board.id === "merlin_evade:rate");
    assert.deepEqual(count.rows.map(row => [row.nickname, row.rank, row.count]).sort((a, b) => a[0].localeCompare(b[0])), [["a", 1, 3], ["b", 1, 3], ["c", 3, 1]]);
    assert.equal(count.rows.find(row => row.nickname === "a").unknownGames, 1); assert.equal(count.rows[0].tied, true);
    assert.deepEqual(rate.rows.map(row => [row.nickname, row.rate]), [["a", 60], ["b", 50]]);
    assert.equal(rate.threshold, 5);
    assert.equal(presentation.detailBoards(report, "count", true).find(board => board.metric === "assassin_miss").rows[0].count, 4);
    assert.ok(presentation.detailBoards(report, "rate", false).every(board => board.positive && board.sort === "rate"));
    const standard = JSON.stringify(cardRenderer.cards(response)), entertainment = JSON.stringify(cardRenderer.cards(response, true));
    assert.doesNotMatch(standard, /歪刀/); assert.match(entertainment, /刺客歪刀榜/);
  } finally { store.close(); }
});
test("前三名保留超过100人的并列，长图自动分张，公开投影不携带原始数据", () => {
  const store = new Store(":memory:");
  try {
    const reports = new MonthlyReport(store);
    for (let index = 0; index < 105; index++) { const uid = "wx:玩家" + String(index).padStart(3, "0"); profile(store, uid); match(store, [{ uid, points: 0 }]); }
    const report = read(reports);
    assert.equal(report.mainBoards[0].rows.length, 105); assert.ok(report.mainBoards[0].rows.every(row => row.rank === 1 && row.tied));
    const pages = cardRenderer.cards({ ...report, uid: "secret", matches: [{ secret: "should-not-export" }] });
    assert.ok(pages.length > 1); assert.ok(pages.every(page => cardRenderer.dimensions(page).height <= cardRenderer.MAX_HEIGHT));
    assert.equal(pages.flatMap(page => page.sections).filter(section => section.title.startsWith("积分榜")).flatMap(section => section.rows).length, 105);
    assert.doesNotMatch(JSON.stringify(pages), /secret|should-not-export|uid|publicId|matches/);
    assert.match(cards.describe(pages[0]), /月度战报/); assert.deepEqual(cards.dimensions(pages[0]), cardRenderer.dimensions(pages[0]));
    assert.deepEqual(cards.parseSelection({ kind: "monthly", month: "2026-09", edition: "fun" }), { kind: "monthly", month: "2026-09", edition: "fun" });
    assert.throws(() => cards.parseSelection({ kind: "monthly", month: "2026-13" }), /无效/);
    assert.throws(() => cards.parseSelection({ kind: "monthly", month: "2026-09", edition: "raw" }), /无效/);
  } finally { store.close(); }
});
test("记录状态、积分、公开设置改变后月报版本更新，重新启动保留版本且不保存旧身份", () => {
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-monthly-")), path = join(directory, "reports.sqlite");
  let store;
  try {
    store = new Store(path); profile(store, "wx:a"); const id = match(store, [{ uid: "wx:a", points: 3 }]);
    let reports = new MonthlyReport(store), original = read(reports);
    assert.equal(original.version, 1); assert.equal(read(reports).version, 1);
    store.transaction(() => { store.db.prepare("UPDATE match_scores SET points=4 WHERE match_id=?").run(id); store.invalidateLeaderboard(); });
    assert.equal(read(reports).version, 2);
    store.close(); store = new Store(path); reports = new MonthlyReport(store);
    assert.equal(read(reports).version, 2);
    store.transaction(() => saveProfile(store, "wx:a", { nickname: "关闭公开", version: readProfile(store, "wx:a").version, leaderboardVisible: false }));
    const hidden = read(reports); assert.equal(hidden.version, 3); assert.equal(hidden.mainBoards[0].rows.length, 0);
    assert.equal(hidden.overview.games, 1); assert.doesNotMatch(JSON.stringify(hidden), /关闭公开|wx:a/);
    assert.deepEqual(store.db.prepare("PRAGMA table_info(monthly_reports)").all().map(row => row.name), ["month", "version", "fingerprint", "generated", "updated"]);
    store.transaction(() => { store.db.prepare("INSERT INTO match_controls(match_id,state,updated) VALUES(?,'excluded',?)").run(id, NOW); store.invalidateLeaderboard(); });
    assert.equal(read(reports).overview.games, 0); assert.equal(read(reports).version, 4);
    store.transaction(() => { store.db.prepare("UPDATE match_controls SET state='deleted' WHERE match_id=?").run(id); store.invalidateLeaderboard(); });
    assert.equal(read(reports).overview.games, 0);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("月报HTTP鉴权、查询白名单，静态共享模块可在网页加载", async () => {
  const app = createApp({ database: ":memory:", clock: () => NOW, webOrigin: "http://127.0.0.1" });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port, token = "c".repeat(64);
  app.store.addSession(createHash("sha256").update(token).digest("hex"), "guest:viewer");
  const get = (path, auth = true) => fetch(base + path, { headers: auth ? { Authorization: "Bearer " + token } : {} });
  try {
    assert.equal((await get("/api/monthly-report", false)).status, 401);
    const response = await get("/api/monthly-report?month=2026-09"); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).month, "2026-09");
    for (const query of ["month=2026-13", "month=2026-11", "month=2026-09&uid=other", "month=2026-09&month=2026-10"]) assert.equal((await get("/api/monthly-report?" + query)).status, 400);
    for (const path of ["/monthly-report.js", "/monthly-report-card.js", "/monthly.css"]) assert.equal((await get(path, false)).status, 200);
    const artwork = await get("/assets/monthly-report-background.jpg", false);
    assert.equal(artwork.status, 200); assert.equal(artwork.headers.get("content-type"), "image/jpeg");
    assert.ok((await artwork.arrayBuffer()).byteLength > 1000);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
