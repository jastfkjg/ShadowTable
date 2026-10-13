"use strict";
const { createHash } = require("node:crypto");
const { RuleError } = require("./engine");
const fun = require("./fun");
const { honors } = require("../miniprogram/fun-copy");
const { monthAt, monthRange } = require("../miniprogram/monthly-report");
const RULES_VERSION = "monthly-2026-10-v2";
const WIN_THRESHOLD = 10, FUN_RATE_THRESHOLD = 5;
function rankTop(rows, compare) {
  rows.sort((a, b) => compare(a, b) || a.publicId.localeCompare(b.publicId));
  let rank = 0;
  rows.forEach((row, index) => {
    if (!index || compare(rows[index - 1], row)) rank = index + 1;
    row.rank = rank;
  });
  rows.forEach((row, index) => { row.tied = rows[index - 1]?.rank === row.rank || rows[index + 1]?.rank === row.rank; });
  // Include every player in a tied top-three place, including ties beyond the usual 100-row limit.
  return { eligibleCount: rows.length, rows: rows.filter(row => row.rank <= 3) };
}
function ratioCompare(numerator, denominator) {
  return (a, b) => {
    const difference = BigInt(b[numerator]) * BigInt(a[denominator]) - BigInt(a[numerator]) * BigInt(b[denominator]);
    return difference > 0n ? 1 : difference < 0n ? -1 : b[denominator] - a[denominator];
  };
}
const identity = row => ({ publicId: row.public_id, nickname: row.nickname || "新朋友", avatarUrl: row.avatar_hash ? "/api/avatars/" + row.avatar_hash : null });
const percent = (count, total) => total ? Math.round(count / total * 1000) / 10 : null;
function parseMonth(params, now) {
  for (const key of params.keys()) if (key !== "month" || params.getAll(key).length !== 1) throw new RuleError("月报参数无效", 400);
  const month = params.get("month") ?? monthAt(now);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || month > monthAt(now)) throw new RuleError("请选择有效月份，不能查看未来月报", 400);
  return month;
}
class MonthlyReport {
  constructor(store) {
    this.store = store; this.cache = new Map();
    store.db.exec(`CREATE TABLE IF NOT EXISTS monthly_reports(
      month TEXT PRIMARY KEY, version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
      generated INTEGER NOT NULL, updated INTEGER NOT NULL)`);
  }
  build(month, now) {
    const db = this.store.db, { start, end } = monthRange(month);
    const valid = "p.outcome IN ('win','loss') AND p.ended>=? AND p.ended<?";
    const publicPlayers = "f.leaderboard_visible=1 AND f.public_id IS NOT NULL AND (p.uid LIKE 'wx:%' OR p.uid LIKE 'dev:%')";
    const overview = db.prepare(`SELECT count(DISTINCT p.match_id) AS games, count(DISTINCT p.uid) AS players,
      count(DISTINCT CAST((p.ended+28800000)/86400000 AS INTEGER)) AS activeDays
      FROM visible_match_players p WHERE ${valid}`).get(start, end);
    const first = db.prepare("SELECT min(ended) AS ended FROM visible_match_players WHERE outcome IN ('win','loss')").get().ended;
    const aggregates = db.prepare(`SELECT p.uid, count(*) AS total, sum(p.outcome='win') AS wins,
      sum(p.faction='good') AS goodTotal, sum(p.faction='good' AND p.outcome='win') AS goodWins,
      sum(p.faction='evil') AS evilTotal, sum(p.faction='evil' AND p.outcome='win') AS evilWins,
      f.public_id,f.nickname,f.avatar_hash FROM visible_match_players p JOIN profiles f ON f.uid=p.uid
      WHERE ${valid} AND ${publicPlayers} GROUP BY p.uid`).all(start, end);
    const scores = new Map(db.prepare(`SELECT s.uid,count(*) AS games,sum(s.points) AS points
      FROM active_match_scores s JOIN visible_match_players p ON p.match_id=s.match_id AND p.uid=s.uid
      WHERE ${valid} AND s.status='scored' GROUP BY s.uid`).all(start, end).map(row => [row.uid, row]));
    const adjustments = new Map(db.prepare("SELECT uid,sum(delta) AS points FROM score_adjustments WHERE created>=? AND created<? GROUP BY uid").all(start, end).map(row => [row.uid, row.points]));
    const players = aggregates.map(row => ({ ...identity(row), total: row.total, wins: row.wins, losses: row.total - row.wins,
      winRate: percent(row.wins, row.total), goodTotal: row.goodTotal, goodWins: row.goodWins, evilTotal: row.evilTotal, evilWins: row.evilWins,
      scoredGames: scores.get(row.uid)?.games || 0, points: (scores.get(row.uid)?.points || 0) + (adjustments.get(row.uid) || 0), adjustmentPoints: adjustments.get(row.uid) || 0 }));
    const main = (id, title, threshold, eligible, compare, unit, subtitle) => ({ id, title, threshold, unit, subtitle, ...rankTop(eligible, compare) });
    const record = row => ({ publicId: row.publicId, nickname: row.nickname, avatarUrl: row.avatarUrl,
      total: row.total, wins: row.wins, losses: row.losses, winRate: row.winRate });
    const faction = id => players.filter(row => row[id + "Total"] >= WIN_THRESHOLD).map(row => ({ ...record(row),
      total: row[id + "Total"], wins: row[id + "Wins"], losses: row[id + "Total"] - row[id + "Wins"], winRate: percent(row[id + "Wins"], row[id + "Total"]) }));
    const mainBoards = [
      main("points", "积分榜", 1, players.filter(row => row.scoredGames > 0).map(row => ({ ...record(row), scoredGames: row.scoredGames, points: row.points, adjustmentPoints: row.adjustmentPoints })), (a, b) => b.points - a.points, "分", "本月积分 · 含积分调整"),
      main("overall", "战绩榜", WIN_THRESHOLD, players.filter(row => row.total >= WIN_THRESHOLD).map(record), ratioCompare("wins", "total"), "%", "按总胜率 · 至少 10 局"),
      main("games", "桌边常驻王", 1, players.map(record), (a, b) => b.total - a.total, "局", "按有效局数"),
      main("good", "好人胜率榜", WIN_THRESHOLD, faction("good"), ratioCompare("wins", "total"), "%", "至少 10 局好人战绩"),
      main("evil", "坏人胜率榜", WIN_THRESHOLD, faction("evil"), ratioCompare("wins", "total"), "%", "至少 10 局坏人战绩"),
    ];
    const funRows = db.prepare(`SELECT s.metric,s.uid,
      sum(CASE WHEN s.status='known' THEN s.count ELSE 0 END) AS count,
      sum(CASE WHEN s.status='known' THEN s.opportunities ELSE 0 END) AS opportunities,
      count(DISTINCT CASE WHEN s.status='known' THEN s.match_id END) AS knownGames,
      count(DISTINCT CASE WHEN s.status='unknown' THEN s.match_id END) AS unknownGames,
      f.public_id,f.nickname,f.avatar_hash FROM match_fun_stats s
      JOIN visible_match_players p ON p.match_id=s.match_id AND p.uid=s.uid JOIN profiles f ON f.uid=s.uid
      WHERE ${valid} AND ${publicPlayers} GROUP BY s.metric,s.uid`).all(start, end);
    const funBoards = Object.values(fun.metrics).filter(def => honors[def.id] && !def.countOnly).flatMap(def => {
      const rows = funRows.filter(row => row.metric === def.id).map(row => ({ ...identity(row),
        count: row.count, opportunities: row.opportunities, rate: percent(row.count, row.opportunities), knownGames: row.knownGames, unknownGames: row.unknownGames }));
      return ["count", "rate"].map(sort => ({ id: def.id + ":" + sort, metric: def.id, title: honors[def.id].title, description: honors[def.id].description,
        label: def.label, positive: def.positive, sort, rateLabel: def.rateLabel, unit: sort === "count" ? def.unit : "%",
        threshold: sort === "count" ? 1 : FUN_RATE_THRESHOLD,
        subtitle: sort === "count" ? "按" + def.unit + "数 · " + def.label : def.rateLabel + " · 至少 5 次有效机会",
        ...rankTop(rows.filter(row => sort === "count" ? row.count >= 1 : row.opportunities >= FUN_RATE_THRESHOLD).map(row => ({ ...row })), sort === "count" ? (a, b) => b.count - a.count : ratioCompare("count", "opportunities")) }));
    });
    const priority = ["merlin_evade", "assassin_hit", "defense_ally", "percival_green", "kill_enemy"];
    const featuredIds = priority.map(id => funBoards.find(board => board.id === id + ":count" && board.rows.length)).filter(Boolean).slice(0, 3).map(board => board.id);
    const highlights = [];
    const describeWinner = board => board.rows[0] && (board.rows.filter(row => row.rank === 1).length > 1 ? board.rows[0].nickname + "等 " + board.rows.filter(row => row.rank === 1).length + " 人并列" : board.rows[0].nickname);
    const winner = mainBoards[1];
    if (winner.rows.length) highlights.push(describeWinner(winner) + "以 " + winner.rows[0].winRate + "% 胜率登顶。");
    const starred = funBoards.find(board => board.id === "assassin_hit:count" && board.rows.length) || funBoards.find(board => board.id === featuredIds[0]);
    if (starred) highlights.push(describeWinner(starred) + "本月" + starred.label + " " + starred.rows[0].count + " " + starred.unit + "。");
    if (!highlights.length && mainBoards[2].rows.length) highlights.push(describeWinner(mainBoards[2]) + "本月参赛 " + mainBoards[2].rows[0].total + " 局。");
    return { month, currentMonth: monthAt(now), firstMonth: first == null ? monthAt(now) : monthAt(first),
      periodStart: start, periodEnd: end, timezone: "Asia/Shanghai", status: now < end ? "preview" : "complete",
      rulesVersion: RULES_VERSION, overview: { ...overview }, mainBoards, funBoards, featuredIds, highlights };
  }
  read(params, now = Date.now()) {
    const month = parseMonth(params, now), old = this.cache.get(month);
    if (old && old.revision === this.store.leaderboardRevision && old.currentMonth === monthAt(now) && now >= old.at && now - old.at < 30000) return { ...old.report, asOf: now };
    const report = this.build(month, now);
    // Persist the content version, not old public identities. Every read applies today's visibility choice.
    const fingerprint = createHash("sha256").update(JSON.stringify({ ...report, currentMonth: undefined, firstMonth: undefined })).digest("hex");
    const saved = this.store.transaction(() => {
      const previous = this.store.db.prepare("SELECT * FROM monthly_reports WHERE month=?").get(month);
      if (previous?.fingerprint === fingerprint) return previous;
      const next = { version: (previous?.version || 0) + 1, generated: previous?.generated ?? now, updated: now };
      this.store.db.prepare("INSERT INTO monthly_reports VALUES(?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET version=excluded.version,fingerprint=excluded.fingerprint,updated=excluded.updated")
        .run(month, next.version, fingerprint, next.generated, next.updated);
      return next;
    });
    Object.assign(report, { version: saved.version, generatedAt: saved.generated, updatedAt: saved.updated, asOf: now });
    this.cache.set(month, { report, revision: this.store.leaderboardRevision, currentMonth: monthAt(now), at: now });
    while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    return report;
  }
}
module.exports = { MonthlyReport, WIN_THRESHOLD, FUN_RATE_THRESHOLD, RULES_VERSION, parseMonth };
