'use strict';
const { createHash } = require('node:crypto');
const { RuleError } = require('./engine');
const { settleMonthly } = require('./badge-awards');
const { monthlyAchievements, achievementStandings } = require('./monthly-achievements');
const { catalogue, monthlyAward } = require('../miniprogram/badges');
const { badgeLeaderboard } = require('./leaderboard');
const fun = require('./fun');

const pageSize = 30;
const gameCounts = new Set(['win_streak', 'loss_streak', 'alternating_streak', 'triple_sabotage', 'overall', 'headwind_navigator']);
function lookupCatalogue(store, now) {
  settleMonthly(store, now);
  const months = store.db.prepare("SELECT id FROM badge_campaigns WHERE id GLOB 'monthly-points-????-??' ORDER BY id DESC").all();
  const placements = months.flatMap(({id}) => [1, 2, 3, '4-12'].map(place => monthlyAward('monthly_points_' + id.slice(-7) + '_' + place)));
  return [...catalogue, ...placements];
}

function standings(store, board, badge, now) {
  const { metric, id } = badge;
  if (badge.permanent) {
    const rows = store.db.prepare('SELECT uid,rank_at_grant AS rank FROM badge_awards WHERE badge_id=?').all(id);
    return rows.map(row => ({ uid: row.uid, rank: row.rank ?? badge.rank ?? null, earned: true }));
  }
  if (metric === 'monthlyGoal') {
    return [...monthlyAchievements(store, now)].filter(([, s]) => s.earned.has(id))
      .map(([uid]) => ({ uid, rank: null, earned: true }));
  }
  let rows, unit;
  if (metric === 'leader' || metric === 'podium') {
    rows = achievementStandings(monthlyAchievements(store, now), badge);
    unit = metric === 'podium' ? '%' : gameCounts.has(id) ? '局' : '次';
  } else if (metric.startsWith('fun_')) {
    const def = fun.metrics[id];
    rows = board.funSnapshot({ metric, period: 'month', funMetric: def, mode: 'all', role: null, sort: 'count' }, now).eligible;
    unit = def.unit;
  } else {
    rows = board.snapshot(metric, 'month', now).eligible;
    unit = { points: '分', games: '局', overall: '%' }[metric];
  }
  return rows.map(row => ({
    uid: row.uid, rank: row.rank, earned: row.rank <= (metric === 'podium' ? 3 : 1),
    value: unit === '%' ? (100 * row.wins / row.total).toFixed(1) : row.count ?? row.points ?? row.total, unit,
  }));
}

function read(store, id, params, now) {
  const offset = params.get('offset') ?? '0', version = params.get('version');
  if ([...params.keys()].some(k => !id || !['offset','version'].includes(k) || params.getAll(k).length !== 1)
    || !/^(0|[1-9]\d{0,8})$/.test(offset) || (+offset && !version))
    throw new RuleError('徽章榜分页无效', 400);
  const badges = lookupCatalogue(store, now);
  if (!id) return { ids: badges.map(b => b.id) };
  const badge = badges.find(b => b.id === id);
  if (!badge) throw new RuleError('没有这枚徽章', 404);

  // Preserve the actual award ranks when a player hides their badge details.
  const visibleColumn = badge.category === '趣味徽章' ? 'fun_visible' : 'honor_visible';
  const candidates = standings(store, badgeLeaderboard(store), badge, now);
  const profiles = store.db.prepare(`SELECT f.uid,f.public_id AS publicId,f.nickname,f.avatar_hash
    FROM profiles f LEFT JOIN badge_rank_players b ON b.uid=f.uid
    WHERE f.uid IN (SELECT value FROM json_each(?)) AND (f.uid LIKE 'wx:%' OR f.uid LIKE 'dev:%') AND f.leaderboard_visible AND f.public_id IS NOT NULL
    AND coalesce(b.${visibleColumn},1)`).all(JSON.stringify(candidates.map(row => row.uid)));
  const publicPlayers = new Map(profiles.map(p => [p.uid, p]));
  const rows = [];
  for (const { uid, ...result } of candidates) {
    const p = publicPlayers.get(uid);
    if (p) rows.push({ publicId: p.publicId, nickname: p.nickname || '新朋友',
      avatarUrl: p.avatar_hash ? '/api/avatars/' + p.avatar_hash : null, ...result });
  }
  rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.publicId.localeCompare(b.publicId));
  const snapshot = createHash('sha256').update(id).update(JSON.stringify(rows)).digest('hex');
  if (version !== null && version !== snapshot) throw new RuleError('徽章榜已更新，请刷新', 409);
  const next = +offset + pageSize;
  return { id, holdersOnly: badge.permanent || badge.metric === 'monthlyGoal', total: rows.length,
    rows: rows.slice(+offset, next), version: snapshot, nextOffset: next < rows.length ? next : null };
}
module.exports = { read };
