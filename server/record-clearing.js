"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { RuleError } = require("./engine");
const { monthAt, monthRange } = require("../miniprogram/monthly-report");

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS player_data_clears(
    id TEXT PRIMARY KEY, uid TEXT NOT NULL, month TEXT NOT NULL, summary TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS player_record_clears(
      uid TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('match','adjustment')), record_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, PRIMARY KEY(uid,kind,record_id));`);
}
function validateMonth(store, month) {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || month > monthAt(store.clock()))
    throw new RuleError("请选择有效月份，不能清除未来月份", 400);
}
function months(store, uid) {
  const rows = store.db.prepare(`SELECT DISTINCT month FROM (
    SELECT strftime('%Y-%m',p.ended/1000,'unixepoch','+8 hours') AS month FROM match_players p
      WHERE p.uid=? AND NOT EXISTS(SELECT 1 FROM player_record_clears c WHERE c.uid=p.uid AND c.kind='match' AND c.record_id=p.match_id)
    UNION SELECT strftime('%Y-%m',created/1000,'unixepoch','+8 hours') FROM visible_score_adjustments WHERE uid=?
    ) WHERE month>= '2000-01' AND month<=? ORDER BY month DESC`).all(uid, uid, monthAt(store.clock()));
  return { months: rows.map(row => row.month), currentMonth: monthAt(store.clock()), timezone: "Asia/Shanghai" };
}
function targets(store, uid, month) {
  validateMonth(store, month);
  const { start, end } = monthRange(month);
  // Raw participant rows include administratively hidden games: restoring a
  // shared game later must never restore a player's cleared personal record.
  const matches = store.db.prepare(`SELECT p.match_id,p.outcome,p.snapshot,m.snapshot AS game,
    coalesce(c.state,'active') AS state,s.status,s.points,s.snapshot AS score
    FROM match_players p JOIN matches m ON m.id=p.match_id
    LEFT JOIN match_controls c ON c.match_id=p.match_id
    LEFT JOIN match_scores s ON s.match_id=p.match_id AND s.uid=p.uid
    WHERE p.uid=? AND p.ended>=? AND p.ended<? AND NOT EXISTS(
      SELECT 1 FROM player_record_clears x WHERE x.uid=p.uid AND x.kind='match' AND x.record_id=p.match_id)
    ORDER BY p.match_id`).all(uid, start, end);
  const adjustments = store.db.prepare(`SELECT * FROM visible_score_adjustments
    WHERE uid=? AND created>=? AND created<? ORDER BY id`).all(uid, start, end);
  const fun = store.db.prepare(`SELECT f.* FROM match_fun_stats f JOIN match_players p ON p.match_id=f.match_id AND p.uid=f.uid
    WHERE p.uid=? AND p.ended>=? AND p.ended<? AND NOT EXISTS(
      SELECT 1 FROM player_record_clears x WHERE x.uid=p.uid AND x.kind='match' AND x.record_id=p.match_id)
    ORDER BY f.match_id,f.metric,f.role`).all(uid, start, end);
  return { matches, adjustments, fun };
}
function describe(uid, month, data) {
  const active = data.matches.filter(row => row.state === "active");
  const valid = active.filter(row => ["win", "loss"].includes(row.outcome));
  const scored = active.filter(row => row.status === "scored");
  const validIds = new Set(valid.map(row => row.match_id));
  return { month, timezone: "Asia/Shanghai", version: createHash("sha256").update(JSON.stringify([uid, month, data])).digest("hex"),
    summary: { records: data.matches.length, validGames: valid.length,
      funGames: new Set(data.fun.filter(row => validIds.has(row.match_id) && row.status === "known" && row.count > 0).map(row => row.match_id)).size,
      scoredGames: scored.length, adjustments: data.adjustments.length,
      points: scored.reduce((sum, row) => sum + row.points, 0) + data.adjustments.reduce((sum, row) => sum + row.delta, 0) } };
}
function preview(store, uid, month) { return describe(uid, month, targets(store, uid, month)); }
function clear(store, uid, input) {
  if (!store.inTransaction) throw Error("个人战绩清理必须在事务中执行");
  if (!input || Object.keys(input).some(key => !["month", "version"].includes(key)) || typeof input.version !== "string" || !/^[a-f0-9]{64}$/.test(input.version))
    throw new RuleError("请先预览需要清除的月份", 400);
  const data = targets(store, uid, input.month), current = describe(uid, input.month, data);
  if (input.version !== current.version) throw new RuleError("该月数据已变化，请重新预览后确认清除", 409);
  if (!data.matches.length && !data.adjustments.length) throw new RuleError("该月暂无可清除的数据", 409);
  const id = randomUUID(), clearedAt = store.clock();
  store.db.prepare("INSERT INTO player_data_clears VALUES(?,?,?,?,?)").run(id, uid, input.month, JSON.stringify(current.summary), clearedAt);
  const insert = store.db.prepare("INSERT INTO player_record_clears VALUES(?,?,?,?)");
  for (const row of data.matches) insert.run(uid, "match", row.match_id, id);
  for (const row of data.adjustments) insert.run(uid, "adjustment", row.id, id);
  store.touchScore(uid);
  store.db.prepare("INSERT INTO badge_versions VALUES(?,1) ON CONFLICT(uid) DO UPDATE SET version=version+1").run(uid);
  store.invalidateLeaderboard();
  return { operationId: id, month: input.month, summary: current.summary, clearedAt };
}
module.exports = { initialize, months, preview, clear };
