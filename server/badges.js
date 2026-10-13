'use strict';
const { Leaderboard, periodRange } = require('./leaderboard');
const { RuleError } = require('./engine');
const fun = require('./fun');
const { catalogue, MAX_EQUIPPED } = require('../miniprogram/badges');
const boards = new WeakMap();
function boardFor(store) {
  if (!boards.has(store)) boards.set(store, new Leaderboard(store));
  return boards.get(store);
}
function readBadges(store, uid, now = store.clock()) {
  const range = periodRange('month', now);
  const version = store.db.prepare('SELECT version FROM badge_versions WHERE uid=?').get(uid)?.version || 0;
  const preferences = new Map(store.db.prepare('SELECT badge_id,equipped FROM badge_preferences WHERE uid=? AND period_start=?').all(uid, range.start).map(row => [row.badge_id, !!row.equipped]));
  const board = boardFor(store), badges = [];
  if (/^(wx|dev):/.test(uid)) for (const definition of catalogue) {
    const snapshot = definition.metric.startsWith('fun_')
      ? board.funSnapshot({ metric: definition.metric, period: 'month', funMetric: fun.metrics[definition.id], mode: 'all', role: null, sort: 'count' }, now)
      : board.snapshot(definition.metric, 'month', now);
    // Full snapshot, not the first page: every tied first-place player qualifies.
    const row = snapshot.aggregates.get(uid);
    if (row?.rank === 1) badges.push({ ...definition, equipped: false });
  }
  // Explicit choices take priority over newly awarded defaults, including legacy preferences.
  const selected = badges.filter(b => preferences.get(b.id) === true)
    .concat(badges.filter(b => !preferences.has(b.id))).slice(0, MAX_EQUIPPED);
  for (const badge of selected) badge.equipped = true;
  return { badges, equippedCount: selected.length, maxEquipped: MAX_EQUIPPED, version, period: 'month', periodStart: range.start, periodEnd: range.end, timezone: 'Asia/Shanghai' };
}
function equippedBadges(store, uid) {
  return readBadges(store, uid).badges.filter(badge => badge.equipped);
}
function saveBadge(store, uid, input) {
  if (!input || Object.keys(input).some(key => !['id','equipped','version','periodStart'].includes(key)) ||
    typeof input.id !== 'string' || !catalogue.some(b => b.id === input.id) || typeof input.equipped !== 'boolean' ||
    !Number.isSafeInteger(input.version) || input.version < 0 || !Number.isSafeInteger(input.periodStart))
    throw new RuleError('徽章佩戴参数无效', 400);
  const current = readBadges(store, uid);
  if (input.periodStart !== current.periodStart || input.version !== current.version)
    throw new RuleError('徽章状态已更新，请刷新后重试', 409);
  const target = current.badges.find(b => b.id === input.id);
  if (!target) throw new RuleError('当前已不持有这枚徽章，请刷新查看', 409);
  if (input.equipped && !target.equipped && current.equippedCount >= MAX_EQUIPPED)
    throw new RuleError('最多佩戴3枚徽章，请先摘下一枚', 400);
  // Save the whole selection so removing a default does not automatically fill its slot.
  const save = store.db.prepare('INSERT INTO badge_preferences(uid,badge_id,period_start,equipped) VALUES(?,?,?,?) ON CONFLICT(uid,badge_id,period_start) DO UPDATE SET equipped=excluded.equipped');
  for (const badge of current.badges)
    save.run(uid, badge.id, current.periodStart, (badge.id === input.id ? input.equipped : badge.equipped) ? 1 : 0);
  store.db.prepare('INSERT INTO badge_versions(uid,version) VALUES(?,1) ON CONFLICT(uid) DO UPDATE SET version=version+1').run(uid);
  return readBadges(store, uid);
}
module.exports = { readBadges, equippedBadges, saveBadge };
