"use strict";
const { randomUUID } = require("node:crypto");
const { RuleError, roleName } = require("./engine");
const { roles: variantRoles } = require("./variants");
const { readProfile } = require("./profile");
const fun = require("./fun");
const METRICS = { points: 1, games: 1, overall: 1, good: 1, evil: 1 };
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
  const allowed = new Set(["metric", "period", "offset", "version", "mode", "role", "sort"]);
  for (const key of params.keys())
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new RuleError("排行榜参数无效", 400);
  const metric = params.get("metric") ?? "games", period = params.get("period") ?? "all";
  const offset = params.get("offset") ?? "0", version = params.get("version");
  const funMetric = metric.startsWith("fun_") ? fun.metrics[metric.slice(4)] : null;
  const mode = params.get("mode") || "classic", role = params.get("role") || null, sort = params.get("sort") || "count";
  if ((!Object.hasOwn(METRICS, metric) && !funMetric?.ranked) || !["all", "month"].includes(period) || !/^(0|20|40|60|80)$/.test(offset)
    || (version !== null && !/^[a-f0-9-]{36}$/.test(version)) || (Number(offset) > 0 && !version))
    throw new RuleError("排行榜参数无效，请刷新后重试", 400);
  if (funMetric ? !Object.hasOwn(fun.modes, mode) || !["count", "rate"].includes(sort) || role && (fun.combatType(role) !== funMetric.group && funMetric.group !== "final") || role && !roleName(role)
    : ["mode", "role", "sort"].some(key => params.has(key))) throw new RuleError("排行榜参数无效",400);
  return { metric, period, offset: Number(offset), version, funMetric, mode, role, sort };
}
const summary = row => {
  const total = row?.total || 0, wins = row?.wins || 0;
  return { total, wins, losses: total - wins, winRate: total ? Math.round(wins / total * 1000) / 10 : null,
    ...(row?.points !== undefined ? { points: row.points } : {}) };
};
// Compare the original integer ratios, never their one-decimal display values.
function compare(a, b, metric) {
  if (metric === "points") return b.points - a.points;
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
      ${metric === "points" ? "sum(s.points) AS points," : ""}
      f.nickname, f.avatar_hash, f.public_id, f.leaderboard_visible
      FROM match_players p LEFT JOIN profiles f ON f.uid=p.uid
      ${metric === "points" ? "JOIN match_scores s ON s.match_id=p.match_id AND s.uid=p.uid AND s.status='scored'" : ""}
      WHERE p.outcome IN ('win','loss') AND p.ended>=? ${range.end === null ? "" : "AND p.ended<?"}
      ${faction ? "AND p.faction=?" : ""} GROUP BY p.uid`)
      .all(range.start, ...(range.end === null ? [] : [range.end]), ...(faction ? [faction] : []));
    if (metric === "points") {
      const adjustments=this.store.db.prepare(`SELECT a.uid,sum(a.delta) AS points,f.nickname,f.avatar_hash,f.public_id,f.leaderboard_visible
        FROM score_adjustments a LEFT JOIN profiles f ON f.uid=a.uid WHERE a.created>=? ${range.end===null?'':'AND a.created<?'} GROUP BY a.uid`)
        .all(range.start,...(range.end===null?[]:[range.end]));
      const byUid=new Map(aggregates.map(row=>[row.uid,row]));
      for (const adjustment of adjustments) {
        const row=byUid.get(adjustment.uid);
        if (row) row.points+=adjustment.points;
        else aggregates.push({...adjustment,total:0,wins:0});
      }
    }
    const eligible = aggregates.filter(row => /^(wx|dev):/.test(row.uid) && row.leaderboard_visible && row.public_id && row.total >= METRICS[metric]);
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
    while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
    return snapshot;
  }
  read(uid, params, now = Date.now()) {
    const selection = parseQuery(params);
    if (selection.funMetric) return this.readFun(uid, selection, now);
    const { metric, period, offset, version } = selection;
    const snapshot = this.snapshot(metric, period, now);
    if (version && version !== snapshot.version) throw new RuleError("榜单已更新，请刷新后继续查看", 409);
    const own = snapshot.aggregates.get(uid), ownStats = summary(own);
    if (metric === "points") ownStats.points = own?.points || 0;
    // Profiles without games do not appear in the aggregation.
    const visible = readProfile(this.store, uid).leaderboardVisible;
    const status = !/^(wx|dev):/.test(uid) ? "unsupported" : !visible ? "hidden" : !ownStats.total ? "no_games" : "ranked";
    const end = Math.min(MAX_ROWS, snapshot.eligible.length), nextOffset = offset + PAGE_SIZE;
    return {
      metric, period, availableMetrics: Object.keys(METRICS), periodStart: snapshot.start, periodEnd: snapshot.end, timezone: "Asia/Shanghai",
      availableFunMetrics: fun.publicMetrics(),
      threshold: METRICS[metric], eligibleCount: snapshot.eligible.length, maxRows: MAX_ROWS,
      updatedAt: snapshot.updatedAt, version: snapshot.version,
      rows: snapshot.eligible.slice(offset, Math.min(nextOffset, end)).map(row => ({
        publicId: row.public_id, nickname: row.nickname || "新朋友", avatarUrl: row.avatar_hash ? "/api/avatars/" + row.avatar_hash : null,
        rank: row.rank, isSelf: row.uid === uid, ...summary(row),
      })),
      nextOffset: nextOffset < end ? nextOffset : null, hasMore: nextOffset < end,
      me: { ...ownStats, rank: own?.rank || null, status, remaining: Math.max(0, METRICS[metric] - ownStats.total) },
    };
  }
  readFun(uid, selection, now) {
    const { metric, period, offset, version, funMetric: def, mode, role, sort } = selection;
    const range = periodRange(period, now), key = [metric,period,mode,role,sort].join(":"), old = this.cache.get(key);
    let snapshot = old;
    const comparator = (a,b) => {
      if (sort === "count") return b.count - a.count;
      const delta = BigInt(b.count) * BigInt(a.opportunities) - BigInt(a.count) * BigInt(b.opportunities);
      return delta > 0n ? 1 : delta < 0n ? -1 : b.opportunities - a.opportunities;
    };
    const threshold = sort === "rate" ? def.rateThreshold : 1;
    if (!old || old.revision !== this.store.leaderboardRevision || old.start !== range.start || now < old.updatedAt || now - old.updatedAt >= CACHE_MS) {
      const aggregates = this.store.db.prepare(`SELECT s.uid,
        sum(CASE WHEN s.status='known' THEN s.count ELSE 0 END) AS count,
        sum(CASE WHEN s.status='known' THEN s.opportunities ELSE 0 END) AS opportunities,
        count(DISTINCT CASE WHEN s.status='known' THEN s.match_id END) AS knownGames,
        count(DISTINCT CASE WHEN s.status='unknown' THEN s.match_id END) AS unknownGames,
        f.nickname,f.avatar_hash,f.public_id,f.leaderboard_visible
        FROM match_fun_stats s JOIN match_players p ON p.match_id=s.match_id AND p.uid=s.uid LEFT JOIN profiles f ON f.uid=s.uid
        WHERE p.outcome IN ('win','loss') AND s.metric=? AND s.mode=? AND s.ended>=? ${range.end === null ? "" : "AND s.ended<?"} ${role ? "AND s.role=?" : ""}
        GROUP BY s.uid`).all(def.id, mode, range.start, ...(range.end === null ? [] : [range.end]), ...(role ? [role] : []));
      const eligible = aggregates.filter(row => /^(wx|dev):/.test(row.uid) && row.leaderboard_visible && row.public_id && (sort === "rate" ? row.opportunities : row.count) >= threshold);
      eligible.sort((a,b) => comparator(a,b) || a.public_id.localeCompare(b.public_id));
      let rank = 0;
      eligible.forEach((row,i) => { if (!i || comparator(eligible[i-1],row)) rank = i+1; row.rank = rank; });
      snapshot = { ...range, revision: this.store.leaderboardRevision, updatedAt: now, eligible, aggregates: new Map(aggregates.map(row => [row.uid,row])),
        version: old && old.revision === this.store.leaderboardRevision && old.start === range.start ? old.version : randomUUID() };
      this.cache.set(key,snapshot);
      while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
    }
    if (version && version !== snapshot.version) throw new RuleError("榜单已更新，请刷新后继续查看",409);
    const present = row => {
      const count = Number(row?.count || 0), opportunities = Number(row?.opportunities || 0);
      const rate = opportunities ? Math.round(count / opportunities * 1000) / 10 : null;
      return { count, opportunities, rate, knownGames: row?.knownGames || 0, unknownGames: row?.unknownGames || 0, total: opportunities, wins: count, losses: opportunities-count, winRate: rate };
    };
    const own = snapshot.aggregates.get(uid), stats = present(own), visible = readProfile(this.store,uid).leaderboardVisible;
    const remaining = Math.max(0,threshold - (sort === "rate" ? stats.opportunities : stats.count));
    const status = !/^(wx|dev):/.test(uid) ? "unsupported" : !visible ? "hidden" : own?.rank ? "ranked" : !stats.knownGames ? "no_records" : remaining ? "not_enough" : "no_games";
    const end = Math.min(MAX_ROWS,snapshot.eligible.length), nextOffset = offset+PAGE_SIZE;
    return { metric, period, mode, role, sort, fun: true, metricLabel: def.label + (sort === "rate" ? "率" : "次数"), title: def.title,
      unit: sort === "rate" ? "%" : def.unit, threshold, availableMetrics: Object.keys(METRICS), availableFunMetrics: fun.publicMetrics(),
      roleOptions: ["merlin","percival","assassin","mordred","morgana","servant",...Object.keys(variantRoles)].filter((role,i,all)=>all.indexOf(role)===i && (def.group === "final" || fun.combatType(role)===def.group)).map(role=>({id:role,label:roleName(role)})),
      periodStart: range.start,periodEnd:range.end,timezone:"Asia/Shanghai",eligibleCount:snapshot.eligible.length,maxRows:MAX_ROWS,updatedAt:snapshot.updatedAt,version:snapshot.version,
      rows:snapshot.eligible.slice(offset,Math.min(nextOffset,end)).map(row=>({publicId:row.public_id,nickname:row.nickname || "新朋友",avatarUrl:row.avatar_hash ? "/api/avatars/"+row.avatar_hash : null,rank:row.rank,isSelf:row.uid===uid,...present(row)})),
      nextOffset:nextOffset<end ? nextOffset : null,hasMore:nextOffset<end,me:{...stats,rank:own?.rank || null,status,remaining} };
  }
}
module.exports = { Leaderboard, periodRange };
