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
  const preferences = new Map(store.db.prepare('SELECT badge_id,equipped FROM badge_preferences WHERE uid=? AND period_start IN (?,0)').all(uid, range.start).map(row => [row.badge_id, !!row.equipped]));
  const board = boardFor(store), badges = [];
  if (/^(wx|dev):/.test(uid)) for (const definition of catalogue) {
    if (definition.permanent) continue;
    const snapshot = definition.metric.startsWith('fun_')
      ? board.funSnapshot({ metric: definition.metric, period: 'month', funMetric: fun.metrics[definition.id], mode: 'all', role: null, sort: 'count' }, now)
      : board.snapshot(definition.metric, 'month', now);
    // Full snapshot, not the first page: every tied first-place player qualifies.
    const row = snapshot.aggregates.get(uid);
    if (row?.rank === 1) badges.push({ ...definition, equipped: false });
  }
  const awarded = new Set(store.db.prepare('SELECT badge_id FROM badge_awards WHERE uid=?').all(uid).map(row => row.badge_id));
  for (const definition of catalogue) if (definition.permanent && awarded.has(definition.id)) badges.push({ ...definition, equipped: false });
  // Explicit choices take priority over newly awarded defaults, including legacy preferences.
  const selected = badges.filter(b => preferences.get(b.id) === true)
    .concat(badges.filter(b => !preferences.has(b.id))).slice(0, MAX_EQUIPPED);
  const positions = new Map(store.db.prepare('SELECT badge_id,position FROM badge_order WHERE uid=? AND period_start IN (?,0)').all(uid, range.start).map(row => [row.badge_id, row.position]));
  selected.sort((a,b) => (positions.get(a.id) ?? 1e9) - (positions.get(b.id) ?? 1e9));
  const slots = Array(MAX_EQUIPPED).fill(null);
  for (const badge of selected) {
    const position = positions.get(badge.id);
    if (Number.isInteger(position) && position >= 0 && position < MAX_EQUIPPED && !slots[position]) slots[position] = badge;
  }
  for (const badge of selected) if (!slots.includes(badge)) slots[slots.indexOf(null)] = badge;
  for (const badge of selected) { badge.equipped = true; badge.slotIndex = slots.indexOf(badge); }
  selected.sort((a,b) => a.slotIndex - b.slotIndex);
  badges.sort((a,b) => (selected.indexOf(a) < 0 ? 1e9 : selected.indexOf(a)) - (selected.indexOf(b) < 0 ? 1e9 : selected.indexOf(b)));
  return { badges, equippedCount: selected.length, maxEquipped: MAX_EQUIPPED, version, period: 'month', periodStart: range.start, periodEnd: range.end, timezone: 'Asia/Shanghai' };
}
function equippedBadges(store, uid) {
  return readBadges(store, uid).badges.filter(badge => badge.equipped);
}
function saveBadge(store, uid, input) {
  if (!input || Object.keys(input).some(key => !['id','equipped','version','periodStart','replaceId','slotIndex'].includes(key)) ||
    typeof input.id !== 'string' || !catalogue.some(b => b.id === input.id) || typeof input.equipped !== 'boolean' ||
    !Number.isSafeInteger(input.version) || input.version < 0 || !Number.isSafeInteger(input.periodStart))
    throw new RuleError('徽章佩戴参数无效', 400);
  const current = readBadges(store, uid);
  if (input.periodStart !== current.periodStart || input.version !== current.version)
    throw new RuleError('徽章状态已更新，请刷新后重试', 409);
  const target = current.badges.find(b => b.id === input.id);
  if (!target) throw new RuleError('当前已不持有这枚徽章，请刷新查看', 409);
  const replaced = input.replaceId === undefined ? null : current.badges.find(b => b.id === input.replaceId && b.equipped);
  if (input.replaceId !== undefined && (!replaced || !input.equipped || target.equipped || replaced.id === target.id)) throw new RuleError('替换徽章参数无效', 400);
  if (input.slotIndex !== undefined && (!Number.isInteger(input.slotIndex) || input.slotIndex < 0 || input.slotIndex >= MAX_EQUIPPED || !input.equipped || target.equipped || replaced || current.badges.some(b => b.equipped && b.slotIndex === input.slotIndex))) throw new RuleError('徽章位置不可用，请刷新后重试', 409);
  if (input.equipped && !target.equipped && current.equippedCount >= MAX_EQUIPPED && !replaced)
    throw new RuleError('最多佩戴3枚徽章，请先摘下一枚', 400);
  // Save the whole selection so removing a default does not automatically fill its slot.
  const save = store.db.prepare('INSERT INTO badge_preferences(uid,badge_id,period_start,equipped) VALUES(?,?,?,?) ON CONFLICT(uid,badge_id,period_start) DO UPDATE SET equipped=excluded.equipped');
  for (const badge of current.badges)
    save.run(uid, badge.id, badge.permanent ? 0 : current.periodStart, (badge.id === input.id ? input.equipped : badge.id === input.replaceId ? false : badge.equipped) ? 1 : 0);
  const slots = Array(MAX_EQUIPPED).fill(null);
  for (const badge of current.badges) if (badge.equipped && badge.id !== input.replaceId && (badge.id !== input.id || input.equipped)) slots[badge.slotIndex] = badge.id;
  if (input.equipped && !target.equipped) {
    const position = replaced ? replaced.slotIndex : input.slotIndex === undefined ? slots.indexOf(null) : input.slotIndex;
    slots[position] = input.id;
  }
  store.db.prepare('DELETE FROM badge_order WHERE uid=?').run(uid);
  const saveOrder = store.db.prepare('INSERT INTO badge_order(uid,badge_id,period_start,position) VALUES(?,?,?,?)');
  slots.forEach((id, position) => { if (id) saveOrder.run(uid, id, current.badges.find(b => b.id === id).permanent ? 0 : current.periodStart, position); });
  store.db.prepare('INSERT INTO badge_versions(uid,version) VALUES(?,1) ON CONFLICT(uid) DO UPDATE SET version=version+1').run(uid);
  return readBadges(store, uid);
}
module.exports = { readBadges, equippedBadges, saveBadge };
