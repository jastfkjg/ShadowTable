'use strict';
const { Leaderboard } = require('./leaderboard');
const { RuleError } = require('./engine');
const CAMPAIGN = '2026-10-beta';
const START = Date.parse('2026-09-30T16:00:00Z');
const END = Date.parse('2026-10-31T16:00:00Z');
const rankedIds = ['october_2026_crown', 'october_2026_silver', 'october_2026_stag'];
const transaction = (store, fn) => store.inTransaction ? fn() : store.transaction(fn);

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
function grant(store, uid, id, rank = null, points = null) {
  const result = store.db.prepare(`INSERT OR IGNORE INTO badge_awards
    (uid,badge_id,campaign,granted_at,rank_at_grant,points_at_grant) VALUES(?,?,?,?,?,?)`)
    .run(uid, id, CAMPAIGN, store.clock(), rank, points);
  if (result.changes) store.db.prepare(`INSERT INTO badge_versions(uid,version) VALUES(?,1)
    ON CONFLICT(uid) DO UPDATE SET version=version+1`).run(uid);
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
      const rows = new Leaderboard(store).snapshot('points', 'month', Math.min(store.clock(), END - 1)).eligible
        .filter(row => row.rank <= 3).map(({ uid, rank, points }) => ({ uid, rank, points }));
      store.db.prepare('INSERT INTO badge_campaigns VALUES(?,?,?)').run(CAMPAIGN, store.clock(), JSON.stringify(rows));
      for (const row of rows) grant(store, row.uid, rankedIds[row.rank - 1], row.rank, row.points);
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
function notice(store, uid) {
  reconcileParticipants(store, uid);
  const rows = store.db.prepare('SELECT id,badge_id,granted_at FROM badge_awards WHERE uid=? AND seen=0 ORDER BY id').all(uid);
  const definitions = require('../miniprogram/badges').catalogue;
  const badges = rows.map(row => ({ ...definitions.find(b => b.id === row.badge_id), grantedAt: row.granted_at }));
  badges.sort((a,b) => (a.rank || 4) - (b.rank || 4));
  return { notice: badges.length ? { through: rows.at(-1).id, badges, campaign: CAMPAIGN } : null };
}
function acknowledge(store, uid, input) {
  if (!input || Object.keys(input).length !== 1 || !Number.isSafeInteger(input.through) || input.through < 1 ||
    !store.db.prepare('SELECT 1 FROM badge_awards WHERE uid=? AND id=?').get(uid, input.through))
    throw new RuleError('徽章通知参数无效，请刷新后重试', 400);
  store.db.prepare('UPDATE badge_awards SET seen=1 WHERE uid=? AND id<=?').run(uid, input.through);
  return { acknowledged: input.through };
}
module.exports = { initialize, activate, reconcileParticipants, notice, acknowledge, summary, CAMPAIGN, START, END };
