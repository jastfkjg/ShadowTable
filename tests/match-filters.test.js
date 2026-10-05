const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Store } = require("../server/store");
const { createApp } = require("../server/app");
const { parseMatchFilters } = require("../server/match-filters");
const now = Date.parse("2026-10-05T16:30:00+08:00");
const parse = query => parseMatchFilters(new URLSearchParams(query), now);
function archive(store, id, overrides = {}) {
  const { uid = "wx:me", role = "梅林", outcome = "win", scored = false, ...game } = overrides;
  store.archiveMatch({ id, code: "123456", game: 1, board: "classic", boardName: "经典基础", capacity: 6,
    startedAt: now - 3600000, endedAt: now, winner: "good", source: "manual", excludedReason: null, ...game,
    players: [{ uid, name: "本人", seat: 1, role, faction: "good", outcome,
      ...(scored ? { score: { status: "scored", total: 2, breakdown: [] } } : {}) }],
  });
}

test("历史筛选在分页前组合执行，选项仅来自本人可见记录，尊重管理员排除和删除", () => {
  const store = new Store(":memory:");
  try {
    for (let i = 0; i < 23; i++) archive(store, "win-" + String(i).padStart(2, "0"), { endedAt: now - i, scored: true });
    archive(store, "loss", { outcome: "loss", role: "派西维尔", board: "knights", boardName: "十二骑士" });
    archive(store, "old", { endedAt: Date.parse("2026-08-01T00:00:00+08:00") });
    archive(store, "excluded");
    store.db.prepare("INSERT INTO match_controls(match_id,state,updated) VALUES(?,'excluded',?)").run("excluded", now);
    archive(store, "deleted", { role: "删除角色", board: "deleted-only" });
    store.db.prepare("INSERT INTO match_controls(match_id,state,updated) VALUES(?,'deleted',?)").run("deleted", now);
    archive(store, "other", { uid: "wx:other", role: "他人角色", board: "other-only" });
    const filters = parse("period=month&board=classic&matchRole=梅林&outcome=win");
    const first = store.matchesFor("wx:me", 0, 20, true, null, filters);
    const last = store.matchesFor("wx:me", 20, 20, true, null, filters);
    assert.equal(first.total, 23); assert.equal(first.records.length, 20); assert.equal(first.hasMore, true);
    assert.equal(last.records.length, 3); assert.equal(last.hasMore, false);
    assert.equal(new Set([...first.records, ...last.records].map(row => row.id)).size, 23);
    assert.equal(store.matchesFor("wx:me", 0, 20, false, null, parse("outcome=excluded")).records[0].id, "excluded");
    assert.equal(store.matchesFor("wx:me", 0, 20, false, null, parse("outcome=loss&board=classic")).total, 0);
    const options = store.matchFilterOptions("wx:me");
    assert.deepEqual(options.boards.map(row => row.id).sort(), ["classic", "knights"]);
    assert.deepEqual(options.roles.map(row => row.id).sort(), ["梅林", "派西维尔"].sort());
    assert.doesNotMatch(JSON.stringify({ first, options }), /wx:|uid|他人角色|删除角色/);
    assert.deepEqual(store.matchFilterOptions("wx:stranger"), { boards: [], roles: [] });
  } finally { store.close(); }
});

test("时间筛选采用北京时间自然日边界，含当日，月底跨时区仍准确", () => {
  const store = new Store(":memory:");
  try {
    for (const period of ["month", "7d", "30d"]) {
      const filters = parse("period=" + period);
      archive(store, period + "-before", { endedAt: filters.from - 1 });
      archive(store, period + "-start", { endedAt: filters.from });
      archive(store, period + "-last", { endedAt: filters.to - 1 });
      archive(store, period + "-after", { endedAt: filters.to });
      const ids = store.matchesFor("wx:me", 0, 100, false, null, filters).records.map(row => row.id);
      assert.ok(ids.includes(period + "-start")); assert.ok(ids.includes(period + "-last"));
      assert.ok(!ids.includes(period + "-before")); assert.ok(!ids.includes(period + "-after"));
    }
    assert.equal(parse("period=7d").from, Date.parse("2026-09-29T00:00:00+08:00"));
    const boundary = parseMatchFilters(new URLSearchParams("period=month"), Date.parse("2026-09-30T16:01:00Z"));
    assert.equal(boundary.from, Date.parse("2026-10-01T00:00:00+08:00"));
    for (const query of ["period=year", "outcome=good", "board=../other", "matchRole=" + "长".repeat(81)])
      assert.throws(() => parse(query), /筛选无效/);
  } finally { store.close(); }
});

test("HTTP筛选兼容计分与趣味角色回查，拒绝重复和越权参数", async () => {
  const app = createApp({ database: ":memory:", clock: () => now, exchangeCode: async code => code });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const login = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "me" }) });
    const { token } = await login.json();
    const uid = app.store.session(createHash("sha256").update(token).digest("hex")).uid;
    const get = async query => {
      const response = await fetch(base + "/api/me/matches?" + query, { headers: { Authorization: "Bearer " + token } });
      return { status: response.status, body: await response.json() };
    };
    archive(app.store, "fun", { uid, scored: true, role: "魔术师", board: "knights", boardName: "十二骑士" });
    app.store.db.prepare("INSERT INTO match_fun_stats(match_id,uid,mode,metric,role,role_label,count,opportunities,status,ended) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("fun", uid, "knights", "knife_enemy", "gaheris", "加赫雷斯", 1, 1, "known", now);
    const query = "scored=1&fun=knife_enemy&mode=knights&role=gaheris&period=month&board=knights&matchRole=魔术师&outcome=win";
    const result = await get(query);
    assert.equal(result.status, 200); assert.equal(result.body.total, 1);
    assert.equal(result.body.records[0].role, "魔术师"); assert.equal(result.body.filterOptions.roles[0].id, "魔术师");
    assert.equal(result.body.adjustments, undefined);
    assert.equal((await get("offset=0")).status, 200);
    for (const invalid of ["period=month&period=7d", "outcome=draw", "uid=wx:other", "role=gaheris", "board=../other"])
      assert.equal((await get(invalid)).status, 400, invalid);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
