'use strict';
const { Leaderboard } = require('./leaderboard');
const { RuleError } = require('./engine');
const { monthAt, monthRange } = require('../miniprogram/monthly-report');
const { awardDefinition } = require('../miniprogram/badges');
const CAMPAIGN = '2026-10-beta';
const FIRST_MONTH = '2026-11';
const monthlyCampaign = month => 'monthly-points-' + month;
const START = Date.parse('2026-09-30T16:00:00Z');
const END = Date.parse('2026-10-31T16:00:00Z');
const rankedIds = ['october_2026_crown', 'october_2026_silver', 'october_2026_stag'];
const transaction = (store, fn) => store.inTransaction ? fn() : store.transaction(fn);
const pointsPodium = (board, now) => board.snapshot('points', 'month', now).eligible
  .filter(row => row.rank <= 3).map(({ uid, rank, points }) => ({ uid, rank, points }));

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS badge_campaigns(
    id TEXT PRIMARY KEY, activated_at INTEGER NOT NULL, ranking_snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS badge_awards(
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, badge_id TEXT NOT NULL,
      campaign TEXT NOT NULL, granted_at INTEGER NOT NULL, rank_at_grant INTEGER,
      points_at_grant INTEGER, seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1)),
      UNIQUE(uid,badge_id));
    CREATE INDEX IF NOT EXISTS badge_awards_notice ON badge_awards(uid,seen,id);`);
}
function grant(store, uid, id, { rank = null, points = null, campaign = CAMPAIGN, grantedAt = store.clock() } = {}) {
  const result = store.db.prepare(`INSERT OR IGNORE INTO badge_awards
    (uid,badge_id,campaign,granted_at,rank_at_grant,points_at_grant) VALUES(?,?,?,?,?,?)`)
    .run(uid, id, campaign, grantedAt, rank, points);
  if (result.changes) store.db.prepare(`INSERT INTO badge_versions(uid,version) VALUES(?,1)
    ON CONFLICT(uid) DO UPDATE SET version=version+1`).run(uid);
  if (result.changes) store.badgeRanks?.record(uid, id);
  return result.changes > 0;
}
function grantContributor(store, uid) {
  return grant(store, uid, 'feedback_contributor', { campaign: 'feedback' });
}
// Evaluate in the transaction that changes eligibility so a later correction
// or personal record removal cannot revoke an already earned milestone.
function reconcileMilestones(store, uids) {
  const candidates = uids || store.db.prepare("SELECT DISTINCT uid FROM match_players").all().map(row => row.uid);
  const outcomes = store.db.prepare(`SELECT outcome FROM visible_match_players
    WHERE uid=? AND outcome IN ('win','loss') ORDER BY ended,match_id`);
  const existing = store.db.prepare("SELECT badge_id FROM badge_awards WHERE uid=? AND campaign='milestones'");
  for (const uid of new Set(candidates)) {
    if (!/^(wx|dev|guest):/.test(uid)) continue;
    const owned = new Set(existing.all(uid).map(row => row.badge_id));
    if (owned.size === 3) continue;
    let wins = 0, run = 0, longest = 0;
    for (const row of outcomes.iterate(uid)) {
      if (row.outcome === 'win') { wins++; run++; longest = Math.max(longest, run); }
      else run = 0;
    }
    for (const [id, qualifies] of [['five_wins', longest >= 5], ['ten_wins', longest >= 10], ['hundred_wins', wins >= 100]])
      if (qualifies && !owned.has(id)) grant(store, uid, id, { campaign: 'milestones' });
  }
}
// Participation is independent of public leaderboard visibility and winning.
// Spectators have no match_players row. Companion/test/deleted/excluded records
// never qualify. Ordinary non-scored archived games still earn the round table.
function reconcileParticipants(store, uid = null) {
  if (!store.db.prepare('SELECT 1 FROM badge_campaigns WHERE id=?').get(CAMPAIGN)) return;
  return transaction(store, () => {
    const rows = store.db.prepare(`SELECT p.uid,
      max(CASE WHEN s.status='scored' THEN 1 ELSE 0 END) AS scored
      FROM match_players p JOIN matches m ON m.id=p.match_id
      LEFT JOIN match_controls c ON c.match_id=p.match_id
      LEFT JOIN match_scores s ON s.match_id=p.match_id AND s.uid=p.uid
      WHERE p.ended>=? AND p.ended<? AND p.ended<=?
        AND coalesce(c.state,'active')='active'
        AND coalesce(json_extract(m.snapshot,'$.recordPurpose'),'normal')='normal'
        AND (p.uid LIKE 'wx:%' OR p.uid LIKE 'dev:%' OR p.uid LIKE 'guest:%')
        ${uid === null ? '' : 'AND p.uid=?'} GROUP BY p.uid`)
      .all(START, END, store.clock(), ...(uid === null ? [] : [uid]));
    for (const row of rows) {
      grant(store, row.uid, 'october_2026_table');
      if (row.scored) grant(store, row.uid, 'october_2026_book');
    }
  });
}
// Called only by the real server entry point, after schema initialization.
// One transaction durably freezes the first release's ranking and awards;
// restarts and later corrections cannot move already awarded rank badges.
function activate(store) {
  if (store.clock() < START) return null;
  return transaction(store, () => {
    if (!store.db.prepare('SELECT 1 FROM badge_campaigns WHERE id=?').get(CAMPAIGN)) {
      const rows = pointsPodium(new Leaderboard(store), Math.min(store.clock(), END - 1));
      store.db.prepare('INSERT INTO badge_campaigns VALUES(?,?,?)').run(CAMPAIGN, store.clock(), JSON.stringify(rows));
      for (const { uid, rank, points } of rows) grant(store, uid, rankedIds[rank - 1], { rank, points });
    }
    reconcileParticipants(store);
    return summary(store);
  });
}
function summary(store) {
  const campaign = store.db.prepare('SELECT activated_at FROM badge_campaigns WHERE id=?').get(CAMPAIGN);
  return campaign ? { campaign: CAMPAIGN, activatedAt: campaign.activated_at,
    counts: store.db.prepare('SELECT badge_id AS id,count(*) AS count FROM badge_awards WHERE campaign=? GROUP BY badge_id').all(CAMPAIGN) } : null;
}
function settleMonthly(store, now = store.clock()) {
  const currentMonth = monthAt(now);
  if (currentMonth <= FIRST_MONTH) return;
  const lastClosedMonth = monthAt(monthRange(currentMonth).start - 1);
  const first = monthlyCampaign(FIRST_MONTH), latest = monthlyCampaign(lastClosedMonth);
  const lastSettled = store.db.prepare('SELECT id FROM badge_campaigns WHERE id BETWEEN ? AND ? ORDER BY id DESC LIMIT 1');
  if (lastSettled.get(first, latest)?.id === latest) return;

  // The write lock covers the snapshot and every grant, including an empty month.
  transaction(store, () => {
    const last = lastSettled.get(first, latest)?.id;
    let month = last ? monthAt(monthRange(last.slice(-7)).end) : FIRST_MONTH;
    const board = new Leaderboard(store);
    const freeze = store.db.prepare('INSERT INTO badge_campaigns VALUES(?,?,?)');
    while (month <= lastClosedMonth) {
      const { end } = monthRange(month), campaign = monthlyCampaign(month);
      const rows = pointsPodium(board, end - 1);
      freeze.run(campaign, now, JSON.stringify(rows));
      for (const { uid, rank, points } of rows)
        grant(store, uid, `monthly_points_${month}_${rank}`, { rank, points, campaign, grantedAt: end });
      month = monthAt(end);
    }
  });
}
function startMonthlyAwards(store, logger = console) {
  let timer;
  function run() {
    const now = store.clock();
    let delay = Math.min(monthRange(monthAt(now)).end - now, 2147483647);
    try { settleMonthly(store, now); }
    catch (error) {
      logger.error('Monthly badge settlement failed:', error.message);
      delay = Math.min(delay, 60000);
    }
    timer = setTimeout(run, delay);
    timer.unref();
  }
  run();
  return () => clearTimeout(timer);
}
function notice(store, uid) {
  settleMonthly(store);
  reconcileParticipants(store, uid);
  const rows = store.db.prepare('SELECT id,badge_id,granted_at,campaign FROM badge_awards WHERE uid=? AND seen=0 ORDER BY id').all(uid);
  const badges = rows.map(row => ({ ...awardDefinition(row.badge_id), grantedAt: row.granted_at }));
  badges.sort((a,b) => (b.month || '').localeCompare(a.month || '') || (a.rank || 4) - (b.rank || 4));
  return { notice: badges.length ? { through: rows.at(-1).id, badges, campaign: rows.at(-1).campaign } : null };
}
function acknowledge(store, uid, input) {
  if (!input || Object.keys(input).length !== 1 || !Number.isSafeInteger(input.through) || input.through < 1 ||
    !store.db.prepare('SELECT 1 FROM badge_awards WHERE uid=? AND id=?').get(uid, input.through))
    throw new RuleError('徽章通知参数无效，请刷新后重试', 400);
  store.db.prepare('UPDATE badge_awards SET seen=1 WHERE uid=? AND id<=?').run(uid, input.through);
  return { acknowledged: input.through };
}
module.exports = { initialize, activate, reconcileMilestones, settleMonthly, startMonthlyAwards, reconcileParticipants, grantContributor, notice, acknowledge, summary, CAMPAIGN, START, END, FIRST_MONTH };
