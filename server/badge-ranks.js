"use strict";
const { RuleError } = require("./engine");
const { Leaderboard, periodRange } = require("./leaderboard");
const { monthlyAchievements } = require("./monthly-achievements");
const { catalogue, monthlyAward } = require("../miniprogram/badges");
const { settleMonthly } = require("./badge-awards");

const definitions = new Map(catalogue.map((b) => [b.id, b]));
const pageSize = 30;
const categoryOf = (b) => (b.category === "趣味徽章" ? "fun" : "honor");
const ranked = `WITH counts AS (SELECT uid, count(*) AS count FROM badge_earned WHERE category=? GROUP BY uid),
  ranked AS (SELECT uid,count,rank() OVER(ORDER BY count DESC) AS rank FROM counts)
  SELECT p.public_id AS publicId, coalesce(nullif(f.nickname,''),
    (SELECT json_extract(m.snapshot,'$.name') FROM match_players m WHERE m.uid=p.uid ORDER BY ended DESC LIMIT 1),'新朋友') AS nickname,
    CASE WHEN f.avatar_hash IS NOT NULL THEN '/api/avatars/'||f.avatar_hash END AS avatarUrl, r.count,r.rank
  FROM ranked r JOIN badge_rank_players p ON p.uid=r.uid LEFT JOIN profiles f ON f.uid=r.uid`;

class BadgeRanks {
  constructor(store) {
    this.store = store;
    const db = store.db;
    db.exec(`CREATE TABLE IF NOT EXISTS badge_rank_players(uid TEXT PRIMARY KEY,
        public_id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
        honor_visible INTEGER NOT NULL DEFAULT 1, fun_visible INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS badge_earned(uid TEXT NOT NULL,badge_id TEXT NOT NULL,category TEXT NOT NULL,
        best_rank INTEGER,PRIMARY KEY(uid,badge_id));
      CREATE INDEX IF NOT EXISTS badge_earned_category ON badge_earned(category,uid);
      CREATE TRIGGER IF NOT EXISTS badge_earned_player AFTER INSERT ON badge_earned BEGIN
        INSERT OR IGNORE INTO badge_rank_players(uid) VALUES(NEW.uid); END;`);
    this.insert =
      db.prepare(`INSERT INTO badge_earned(uid,badge_id,category,best_rank) VALUES(?,?,?,?)
      ON CONFLICT(uid,badge_id) DO UPDATE SET best_rank=excluded.best_rank
      WHERE excluded.best_rank IS NOT NULL AND (best_rank IS NULL OR excluded.best_rank<best_rank)`);
    // Both equipped and unequipped preferences were written only for badges actually owned.
    for (const row of db
      .prepare(
        "SELECT uid,badge_id FROM badge_awards UNION SELECT uid,badge_id FROM badge_preferences",
      )
      .iterate())
      this.record(row.uid, row.badge_id);
    this.captureMonthly();
  }
  record(uid, id, rank = null) {
    if (!/^(wx|guest|dev):/.test(uid)) return;
    const b = definitions.get(id) || monthlyAward(id);
    if (b)
      this.insert.run(
        uid,
        id,
        categoryOf(b),
        b.metric === "podium" && [1, 2, 3].includes(rank) ? rank : null,
      );
  }
  captureMonthly() {
    const { store } = this,
      now = store.clock(),
      { start, end } = periodRange("month", now);
    if (
      !store.db
        .prepare(
          "SELECT 1 FROM match_players WHERE ended>=? AND ended<? LIMIT 1",
        )
        .get(start, end)
    )
      return;
    // Capture all winners at commit, even when nobody opens a collection before the lead changes.
    const board = new Leaderboard(store);
    for (const id of ["points", "games", "overall"]) {
      for (const row of board.snapshot(id, "month", now).eligible) {
        if (row.rank !== 1) break;
        this.record(row.uid, id);
      }
    }
    for (const [uid, stats] of monthlyAchievements(store, now))
      for (const [id, rank] of stats.earned) this.record(uid, id, rank);
    // Same unfiltered count and eligibility as the individual monthly fun boards, in one scan.
    const winners = store.db
      .prepare(
        `WITH totals AS (
      SELECT s.metric,s.uid,sum(CASE WHEN s.status='known' THEN s.count ELSE 0 END) AS n
      FROM match_fun_stats s JOIN leaderboard_match_players m ON m.match_id=s.match_id AND m.uid=s.uid
      JOIN profiles f ON f.uid=s.uid WHERE s.ended>=? AND s.ended<? AND m.outcome IN ('win','loss')
      AND (s.uid LIKE 'wx:%' OR s.uid LIKE 'dev:%') AND f.leaderboard_visible AND f.public_id IS NOT NULL
      GROUP BY s.metric,s.uid), places AS (SELECT *,rank() OVER(PARTITION BY metric ORDER BY n DESC) AS place FROM totals)
      SELECT uid,metric FROM places WHERE place=1 AND n>0`,
      )
      .all(start, end);
    for (const { uid, metric } of winners)
      if (definitions.get(metric)?.metric === "fun_" + metric)
        this.record(uid, metric);
  }
  list(uid, kind, params) {
    const offset = params.get("offset") || "0",
      version = params.get("version");
    if (!/^\d{1,9}$/.test(offset) || (+offset && version === null))
      throw new RuleError("榜单分页无效", 400);
    settleMonthly(this.store);
    const db = this.store.db;
    const totals = db
      .prepare(
        "SELECT count(*) AS version,count(DISTINCT uid) AS total FROM badge_earned WHERE category=?",
      )
      .get(kind);
    if (version !== null && version !== String(totals.version))
      throw new RuleError("榜单已更新，请刷新", 409);
    const rows = db
      .prepare(ranked + " ORDER BY r.count DESC,p.public_id LIMIT ? OFFSET ?")
      .all(kind, pageSize, +offset);
    const me =
      db.prepare(ranked + " WHERE r.uid=?").get(kind, uid) ||
      this.unranked(uid);
    const next = +offset + rows.length;
    return {
      ...totals,
      rows,
      me,
      nextOffset: next < totals.total ? next : null,
    };
  }
  unranked(uid) {
    return {
      publicId: "self",
      nickname:
        this.store.db
          .prepare("SELECT nickname FROM profiles WHERE uid=?")
          .get(uid)?.nickname || "我",
      rank: null,
      count: 0,
    };
  }
  detail(viewer, kind, publicId) {
    settleMonthly(this.store);
    const db = this.store.db;
    const account =
      publicId === "self"
        ? db.prepare("SELECT * FROM badge_rank_players WHERE uid=?").get(viewer)
        : db
            .prepare("SELECT * FROM badge_rank_players WHERE public_id=?")
            .get(publicId);
    const isSelf = publicId === "self" || account?.uid === viewer;
    const player =
      account && db.prepare(ranked + " WHERE r.uid=?").get(kind, account.uid);
    if (!player && !isSelf) throw new RuleError("该玩家未上榜", 404);
    const visible = !account || !!account[kind + "_visible"];
    const badges =
      (isSelf || visible) && player
        ? db
            .prepare(
              "SELECT badge_id AS id,best_rank AS rank FROM badge_earned WHERE uid=? AND category=? ORDER BY badge_id",
            )
            .all(account.uid, kind)
        : [];
    return { player: player || this.unranked(viewer), visible, isSelf, badges };
  }
  setVisibility(uid, kind, input) {
    if (
      !input ||
      typeof input.visible !== "boolean" ||
      Object.keys(input).length !== 1
    )
      throw new RuleError("徽章展示设置无效", 400);
    const column = kind === "honor" ? "honor_visible" : "fun_visible";
    this.store.db
      .prepare(
        `INSERT INTO badge_rank_players(uid,${column}) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET ${column}=excluded.${column}`,
      )
      .run(uid, +input.visible);
    return { visible: input.visible };
  }
}
module.exports = { BadgeRanks };
