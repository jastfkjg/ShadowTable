"use strict";
const { RuleError } = require("./engine");
const { monthAt, monthRange } = require("../miniprogram/monthly-report");

function readMonthlyReset(store, uid) {
  if (uid.startsWith("test:")) return null;
  const month = monthAt(store.clock()), { start } = monthRange(month);
  const seen = store.db.prepare("SELECT month FROM monthly_reset_visits WHERE uid=?").get(uid);
  if (seen?.month >= month) return null;
  // New accounts start at zero; their first month does not need a reset notice.
  const existing = store.db.prepare(`SELECT 1 FROM profiles WHERE uid=? AND updated<?
    UNION ALL SELECT 1 FROM match_players WHERE uid=? AND ended<?
    UNION ALL SELECT 1 FROM score_adjustments WHERE uid=? AND created<? LIMIT 1`).get(uid,start,uid,start,uid,start);
  if (!seen && !existing) {
    acknowledgeMonthlyReset(store, uid, month);
    return null;
  }
  const previousMonth = monthAt(start - 1), range = monthRange(previousMonth);
  const stats = store.db.prepare(`SELECT count(*) AS total,coalesce(sum(outcome='win'),0) AS wins
    FROM visible_match_players WHERE uid=? AND outcome IN ('win','loss') AND ended>=? AND ended<?`).get(uid,range.start,range.end);
  const score = store.scoreForMonth(uid, previousMonth);
  return { month, previousMonth, resetAt: start, timezone: "Asia/Shanghai", previous: {
    total: stats.total, wins: stats.wins, losses: stats.total - stats.wins,
    winRate: stats.total ? Math.round(stats.wins / stats.total * 1000) / 10 : null,
    points: score.points, scoredGames: score.games, adjustmentPoints: score.manualPoints,
  } };
}
function acknowledgeMonthlyReset(store, uid, month) {
  if (month !== monthAt(store.clock())) throw new RuleError("月份已更新，请重新打开我的页面", 409);
  store.db.prepare(`INSERT INTO monthly_reset_visits VALUES(?,?)
    ON CONFLICT(uid) DO UPDATE SET month=excluded.month WHERE month<excluded.month`).run(uid,month);
  return { month };
}
module.exports = { readMonthlyReset, acknowledgeMonthlyReset };
