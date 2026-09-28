"use strict";
const { randomUUID } = require("node:crypto");
const { RuleError } = require("./engine");
const METRICS = { games: 1, overall: 20, good: 10, evil: 10 };
const PAGE_SIZE = 20, MAX_ROWS = 100, CACHE_MS = 30000;
function periodRange(period, now) {
  if (period === "all") return { start: 0, end: null };
  // Shanghai uses UTC+8; do not depend on the server's local timezone.
  const local = new Date(now + 8 * 3600000);
  return {
    start: Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 8 * 3600000,
    end: Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 8 * 3600000,
  };
}
function parseQuery(params) {
  const allowed = new Set(["metric", "period", "offset", "version"]);
  for (const key of params.keys())
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new RuleError("排行榜参数无效", 400);
  const metric = params.get("metric") ?? "games", period = params.get("period") ?? "all";
  const offset = params.get("offset") ?? "0", version = params.get("version");
  if (!Object.hasOwn(METRICS, metric) || !["all", "month"].includes(period) || !/^(0|20|40|60|80)$/.test(offset)
    || (version !== null && !/^[a-f0-9-]{36}$/.test(version)) || (Number(offset) > 0 && !version))
    throw new RuleError("排行榜参数无效，请刷新后重试", 400);
  return { metric, period, offset: Number(offset), version };
}
const summary = row => {
  const total = row?.total || 0, wins = row?.wins || 0;
  return { total, wins, losses: total - wins, winRate: total ? Math.round(wins / total * 1000) / 10 : null };
};
// Compare the original integer ratios, never their one-decimal display values.
function compare(a, b, metric) {
  if (metric === "games") return b.total - a.total;
  const delta = BigInt(b.wins) * BigInt(a.total) - BigInt(a.wins) * BigInt(b.total);
  return delta > 0n ? 1 : delta < 0n ? -1 : b.total - a.total;
}
class Leaderboard {
  constructor(store) { this.store = store; this.cache = new Map(); }
  snapshot(metric, period, now) {
    const range = periodRange(period, now), key = metric + ":" + period;
    const old = this.cache.get(key);
    if (old && old.revision === this.store.leaderboardRevision && old.start === range.start && now >= old.updatedAt && now - old.updatedAt < CACHE_MS) return old;
    const faction = ["good", "evil"].includes(metric) ? metric : null;
    const aggregates = this.store.db.prepare(`SELECT p.uid, count(*) AS total, sum(p.outcome='win') AS wins,
      f.nickname, f.avatar_hash, f.public_id, f.leaderboard_visible
      FROM match_players p LEFT JOIN profiles f ON f.uid=p.uid
      WHERE p.outcome IN ('win','loss') AND p.ended>=? ${range.end === null ? "" : "AND p.ended<?"}
      ${faction ? "AND p.faction=?" : ""} GROUP BY p.uid`)
      .all(range.start, ...(range.end === null ? [] : [range.end]), ...(faction ? [faction] : []));
    const eligible = aggregates.filter(row => row.uid.startsWith("wx:") && row.leaderboard_visible && row.public_id && row.total >= METRICS[metric]);
    eligible.sort((a, b) => compare(a, b, metric) || a.public_id.localeCompare(b.public_id));
    let rank = 0;
    eligible.forEach((row, index) => {
      if (!index || compare(eligible[index - 1], row, metric)) rank = index + 1;
      row.rank = rank;
    });
    // A cache refresh without data changes must not send a slow reader back to page one.
    const version = old && old.revision === this.store.leaderboardRevision && old.start === range.start ? old.version : randomUUID();
    const snapshot = { ...range, version, revision: this.store.leaderboardRevision, updatedAt: now,
      aggregates: new Map(aggregates.map(row => [row.uid, row])), eligible };
    this.cache.set(key, snapshot);
    return snapshot;
  }
  read(uid, params, now = Date.now()) {
    const { metric, period, offset, version } = parseQuery(params);
    const snapshot = this.snapshot(metric, period, now);
    if (version && version !== snapshot.version) throw new RuleError("榜单已更新，请刷新后继续查看", 409);
    const own = snapshot.aggregates.get(uid), ownStats = summary(own);
    // Profiles without games do not appear in the aggregation.
    const visible = own ? !!own.leaderboard_visible : !!this.store.db.prepare("SELECT leaderboard_visible FROM profiles WHERE uid=?").get(uid)?.leaderboard_visible;
    const status = !uid.startsWith("wx:") ? "unsupported" : !visible ? "hidden" : !ownStats.total ? "no_games" : ownStats.total < METRICS[metric] ? "insufficient" : "ranked";
    const end = Math.min(MAX_ROWS, snapshot.eligible.length), nextOffset = offset + PAGE_SIZE;
    return {
      metric, period, periodStart: snapshot.start, periodEnd: snapshot.end, timezone: "Asia/Shanghai",
      threshold: METRICS[metric], eligibleCount: snapshot.eligible.length, maxRows: MAX_ROWS,
      updatedAt: snapshot.updatedAt, version: snapshot.version,
      rows: snapshot.eligible.slice(offset, Math.min(nextOffset, end)).map(row => ({
        publicId: row.public_id, nickname: row.nickname, avatarUrl: row.avatar_hash ? "/api/avatars/" + row.avatar_hash : null,
        rank: row.rank, isSelf: row.uid === uid, ...summary(row),
      })),
      nextOffset: nextOffset < end ? nextOffset : null, hasMore: nextOffset < end,
      me: { ...ownStats, rank: own?.rank || null, status, remaining: Math.max(0, METRICS[metric] - ownStats.total) },
    };
  }
}
module.exports = { Leaderboard, periodRange };
