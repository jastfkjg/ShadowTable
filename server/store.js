"use strict";
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, chmodSync } = require("node:fs");
const { dirname } = require("node:path");
const { randomUUID } = require("node:crypto");
const { roomSummary, RuleError } = require("./engine");
const scoring = require("./scoring");
const { migrate: migrateKnights } = require("./knights");
class Store {
  constructor(path) {
    this.leaderboardRevision = 0;
    this.leaderboardDirty = false;
    this.inTransaction = false;
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY, action TEXT NOT NULL, code TEXT NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_entries(uid TEXT NOT NULL, code TEXT NOT NULL, snapshot TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', entered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(uid,code));
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, uid TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(uid TEXT PRIMARY KEY, nickname TEXT NOT NULL, avatar_hash TEXT, version INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS avatars(hash TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS match_players(match_id TEXT NOT NULL, uid TEXT NOT NULL, board TEXT NOT NULL, faction TEXT NOT NULL, outcome TEXT NOT NULL, ended INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(match_id,uid));
      CREATE INDEX IF NOT EXISTS match_players_user ON match_players(uid,ended DESC);
      CREATE TABLE IF NOT EXISTS match_scores(match_id TEXT NOT NULL, uid TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scored','excluded')), points INTEGER NOT NULL, ended INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(match_id,uid));
      CREATE INDEX IF NOT EXISTS match_scores_user ON match_scores(uid,ended);
      CREATE INDEX IF NOT EXISTS match_scores_rank ON match_scores(ended,uid,points) WHERE status='scored';
      CREATE TABLE IF NOT EXISTS receipts(uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(uid, request));`);
    const profileColumns = this.db.prepare("PRAGMA table_info(profiles)").all();
    if (!profileColumns.some(column => column.name === "leaderboard_visible"))
      this.db.exec("ALTER TABLE profiles ADD COLUMN leaderboard_visible INTEGER NOT NULL DEFAULT 1");
    if (!profileColumns.some(column => column.name === "public_id"))
      this.db.exec("ALTER TABLE profiles ADD COLUMN public_id TEXT");
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_id ON profiles(public_id) WHERE public_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS match_players_rank_time ON match_players(ended, faction, uid, outcome) WHERE outcome IN ('win','loss');`);
    const columns = this.db.prepare("PRAGMA table_info(admin_audit)").all();
    if (!columns.some((column) => column.name === "details"))
      this.db.exec(
        "ALTER TABLE admin_audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}'",
      );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS admin_audit_room ON admin_audit(code, id)",
    );
    this.transaction(() => {
      // A missing public ID marks legacy profiles that never saved a visibility choice.
      const initializePublicProfile = this.db.prepare("UPDATE profiles SET leaderboard_visible=1, public_id=? WHERE uid=?");
      for (const row of this.db.prepare("SELECT uid FROM profiles WHERE public_id IS NULL AND (uid LIKE 'wx:%' OR uid LIKE 'dev:%')").all())
        initializePublicProfile.run(randomUUID(), row.uid);
      // Older archives may contain players who never saved personal details.
      for (const row of this.db.prepare(`SELECT DISTINCT p.uid FROM match_players p LEFT JOIN profiles f ON f.uid=p.uid
        WHERE f.uid IS NULL AND (p.uid LIKE 'wx:%' OR p.uid LIKE 'dev:%')`).all())
        this.initializeLeaderboardProfile(row.uid);
      this.restoreCompanionMatches();
      for (const row of this.db.prepare("SELECT code, state FROM rooms").all()) {
        const room = JSON.parse(row.state);
        if (migrateKnights(room)) this.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(room), row.code);
      }
    });
  }
  restoreCompanionMatches() {
    const matches = this.db.prepare("SELECT id, snapshot FROM matches WHERE json_extract(snapshot, '$.excludedReason')='测试局'").all();
    const playersFor = this.db.prepare("SELECT uid, faction, snapshot FROM match_players WHERE match_id=?");
    const updatePlayer = this.db.prepare("UPDATE match_players SET outcome=?, snapshot=? WHERE match_id=? AND uid=?");
    const updateMatch = this.db.prepare("UPDATE matches SET snapshot=? WHERE id=?");
    for (const row of matches) {
      const match = JSON.parse(row.snapshot), players = playersFor.all(row.id);
      // Old test exclusions took precedence over missing results and roles.
      if (!["good", "evil", "third"].includes(match.winner) || !players.length
        || players.some(player => !["good", "evil", "third"].includes(player.faction)
          || !JSON.parse(player.snapshot).role || JSON.parse(player.snapshot).role === "未知角色")) continue;
      for (const player of players) {
        const outcome = player.faction === match.winner ? "win" : "loss";
        updatePlayer.run(outcome, JSON.stringify({ ...JSON.parse(player.snapshot), outcome }), row.id, player.uid);
      }
      updateMatch.run(JSON.stringify({ ...match, excludedReason: null }), row.id);
      this.invalidateLeaderboard();
    }
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    this.leaderboardDirty = false;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      if (this.leaderboardDirty) this.leaderboardRevision++;
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTransaction = false;
      this.leaderboardDirty = false;
    }
  }
  invalidateLeaderboard() {
    if (this.inTransaction) this.leaderboardDirty = true;
    else this.leaderboardRevision++;
  }
  initializeLeaderboardProfile(uid) {
    if (!/^(wx|dev):/.test(uid)) return;
    // Persist the default visibility and public ID without changing unsaved details
    // or overwriting an existing visibility choice, nickname, avatar or version.
    const result = this.db.prepare(`INSERT OR IGNORE INTO profiles(uid,nickname,version,updated,leaderboard_visible,public_id)
      VALUES(?,'',0,0,1,?)`).run(uid, randomUUID());
    if (result.changes) this.invalidateLeaderboard();
  }
  get(code) {
    const row = this.db
      .prepare("SELECT state FROM rooms WHERE code=?")
      .get(code);
    return row ? JSON.parse(row.state) : null;
  }
  roomsFor(uid) {
    return this.db
      .prepare(
        `SELECT state FROM rooms
      WHERE json_extract(state, '$.host') = ? OR EXISTS (SELECT 1 FROM json_each(rooms.state, '$.players')
        WHERE json_extract(value, '$.uid') = ?) OR EXISTS (SELECT 1 FROM json_each(rooms.state, '$.spectators')
        WHERE json_extract(value, '$.uid') = ?)
      ORDER BY code`,
      )
      .all(uid, uid, uid)
      .map((row) => JSON.parse(row.state));
  }
  trackRoom(room, uid) {
    const snapshot = JSON.stringify(roomSummary(room, uid));
    const old = this.entry(uid, room.code);
    if (old && JSON.parse(old.snapshot).createdAt !== (room.createdAt || 0))
      this.db.prepare("DELETE FROM room_entries WHERE uid=? AND code=?").run(uid, room.code);
    this.db.prepare("INSERT INTO room_entries(uid,code,snapshot) VALUES(?,?,?) ON CONFLICT(uid,code) DO UPDATE SET snapshot=excluded.snapshot").run(uid, room.code, snapshot);
  }
  entry(uid, code) {
    return this.db.prepare("SELECT * FROM room_entries WHERE uid=? AND code=?").get(uid, code);
  }
  visitRoom(uid, code) {
    this.db.prepare("UPDATE room_entries SET hidden=0, entered=? WHERE uid=? AND code=?").run(Date.now(), uid, code);
  }
  personalRooms(uid) {
    // Backfill existing memberships without changing gameplay state or hidden preferences.
    for (const room of this.roomsFor(uid)) this.trackRoom(room, uid);
    return this.db.prepare("SELECT * FROM room_entries WHERE uid=? AND hidden=0").all(uid).map(entry => {
      const snapshot = JSON.parse(entry.snapshot), room = this.get(entry.code);
      const member = room && (room.host === uid || [...room.players, ...(room.spectators || [])].some(p => p.uid === uid));
      const available = !!member && (room.createdAt || 0) === snapshot.createdAt;
      return { ...snapshot, note: entry.note, lastEnteredAt: entry.entered, available,
        ...(available ? {} : { status: "unavailable", phaseName: room && member ? "房间已失效" : room ? "已离开或被移出" : "房间已解散", canLeave: false, isHost: false }) };
    }).sort((a,b) => (["playing", "lobby", "ended", "unavailable"].indexOf(a.status) - ["playing", "lobby", "ended", "unavailable"].indexOf(b.status)) || b.lastEnteredAt - a.lastEnteredAt || a.code.localeCompare(b.code));
  }
  save(room) {
    if (room.matchRecord) this.archiveMatch(room.matchRecord);
    room.updatedAt = Date.now();
    this.db
      .prepare(
        "INSERT INTO rooms VALUES(?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state",
      )
      .run(room.code, JSON.stringify(room));
    for (const uid of new Set([room.host, ...room.players.map(p => p.uid), ...(room.spectators || []).map(p => p.uid)])) this.trackRoom(room, uid);
  }
  remove(code) {
    this.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
  }
  archiveMatch(record) {
    const { players, ...match } = record;
    this.db.prepare("INSERT OR IGNORE INTO matches VALUES(?,?)").run(match.id, JSON.stringify(match));
    const insert = this.db.prepare("INSERT OR IGNORE INTO match_players VALUES(?,?,?,?,?,?,?)");
    for (const { uid, ...player } of players) {
      this.initializeLeaderboardProfile(uid);
      if (player.score?.status === "scored" && !this.db.prepare("SELECT 1 FROM match_players WHERE match_id=? AND uid=?").get(match.id, uid)) {
        const streak = player.outcome === "win" ? this.streakFor(uid).current + 1 : 0;
        const bonus = record.scorePolicy?.streakBonus;
        player.score = { ...player.score, breakdown: [...player.score.breakdown], streak };
        if (bonus?.enabled && streak === bonus.threshold) {
          player.score.breakdown.push({ id: "streak", label: bonus.label, points: bonus.points });
          player.score.total += bonus.points;
        }
        players.find(p => p.uid === uid).score = player.score;
      }
      const result = insert.run(match.id, uid, match.board, player.faction, player.outcome, match.endedAt, JSON.stringify(player));
      if (result.changes) {
        if (player.score) this.db.prepare("INSERT INTO match_scores VALUES(?,?,?,?,?,?)").run(match.id, uid, player.score.status, player.score.total, match.endedAt, JSON.stringify(player.score));
        this.invalidateLeaderboard();
      }
    }
  }
  statsFor(uid) {
    const counts = `sum(outcome='win') AS wins, sum(outcome='loss') AS losses, sum(outcome='excluded') AS excluded`;
    const summary = row => {
      const wins = Number(row.wins || 0), losses = Number(row.losses || 0), total = wins + losses;
      return { total, wins, losses, excluded: Number(row.excluded || 0), winRate: total ? Math.round(wins / total * 1000) / 10 : null };
    };
    const total = this.db.prepare(`SELECT ${counts} FROM match_players WHERE uid=?`).get(uid);
    const byFaction = this.db.prepare(`SELECT faction, ${counts} FROM match_players WHERE uid=? GROUP BY faction ORDER BY faction`).all(uid)
      .map(row => ({ faction: row.faction, label: { good: "好人阵营", evil: "坏人阵营", third: "盗贼阵营", unknown: "未知阵营" }[row.faction], ...summary(row) }));
    const byRole = this.db.prepare(`SELECT faction, json_extract(snapshot,'$.role') AS role, ${counts}
      FROM match_players WHERE uid=? AND outcome IN ('win','loss')
      GROUP BY faction,role ORDER BY faction,wins + losses DESC,role`).all(uid)
      .map(row => ({ faction: row.faction, role: row.role || "未知角色", ...summary(row) }));
    const byBoard = this.db.prepare(`SELECT p.board, json_extract(m.snapshot,'$.capacity') AS capacity,
      json_extract(m.snapshot,'$.boardName') AS name, ${counts}
      FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.uid=?
      GROUP BY p.board,capacity ORDER BY p.board,capacity`).all(uid)
      .map(row => ({ board: row.board, capacity: row.capacity, key: row.board + ":" + row.capacity,
        label: row.name + " · " + row.capacity + "人", ...summary(row) }));
    const recent = this.db.prepare("SELECT m.snapshot AS game, p.snapshot AS player FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.uid=? ORDER BY p.ended DESC,p.match_id DESC LIMIT 20").all(uid)
      .map(row => {
        const { scorePolicy, scoringFacts, scoreEligibilityReason, scoreExcludedReason, ...game } = JSON.parse(row.game);
        const { roleId, ...player } = JSON.parse(row.player);
        return { ...game, ...player };
      });
    const scoreRows = this.db.prepare(`SELECT p.faction,json_extract(p.snapshot,'$.role') AS role,s.points,s.ended
      FROM match_scores s JOIN match_players p ON p.match_id=s.match_id AND p.uid=s.uid WHERE s.uid=? AND s.status='scored'`).all(uid);
    const aggregate = rows => ({ total: rows.reduce((sum,row) => sum + row.points,0), games: rows.length,
      average: rows.length ? Math.round(rows.reduce((sum,row) => sum + row.points,0) / rows.length * 100) / 100 : null });
    const now = new Date(Date.now() + 8 * 3600000);
    const monthStart = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1) - 8 * 3600000;
    const monthEnd = Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1) - 8 * 3600000;
    for (const row of byFaction) row.score = aggregate(scoreRows.filter(score => score.faction === row.faction));
    for (const row of byRole) row.score = aggregate(scoreRows.filter(score => score.faction === row.faction && score.role === row.role));
    return { identityType: uid.split(":")[0], ...summary(total), byFaction, byRole, byBoard, recent,
      score: { ...aggregate(scoreRows), month: aggregate(scoreRows.filter(row => row.ended >= monthStart && row.ended < monthEnd)).total, ...this.streakFor(uid) } };
  }
  streakFor(uid) {
    const rows = this.db.prepare(`SELECT p.outcome FROM match_scores s JOIN match_players p ON p.match_id=s.match_id AND p.uid=s.uid
      WHERE s.uid=? AND s.status='scored' ORDER BY s.ended,s.rowid`).all(uid);
    let current = 0, best = 0;
    for (const row of rows) { current = row.outcome === "win" ? current + 1 : 0; best = Math.max(best,current); }
    return { current, best };
  }
  correctMatch(id, input) {
    if (!this.inTransaction) throw Error("对局更正必须在事务中执行");
    const row = this.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id);
    if (!row) throw new RuleError("对局不存在",404);
    const match = JSON.parse(row.snapshot);
    if (!Number.isSafeInteger(input.revision) || input.revision !== (match.scoreRevision || 0)) throw new RuleError("对局已更新，请重新加载",409);
    if (!match.scorePolicy || match.scoreEligibilityReason) throw new RuleError("本局不在计分范围，不能补算积分");
    const option = match.scorePolicy.endReasons.find(reason => reason.id === input.scoreReason);
    if (!option) throw new RuleError("计分结束原因无效");
    const players = this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(id).map(player => ({uid:player.uid,...JSON.parse(player.snapshot)}));
    if (!players.length || players.some(player => !player.roleId || player.faction === "unknown")) throw new RuleError("身份信息不完整，不能更正计分");
    if (option.requiresTarget && (!Number.isInteger(input.scoreTarget) || input.scoreTarget !== 0 && !players.some(player => player.seat === input.scoreTarget))) throw new RuleError("请选择实际刺杀目标或空刀");
    const before = {winner:match.winner, facts:match.scoringFacts, revision:match.scoreRevision || 0};
    match.winner = option.requiresTarget ? players.find(player => player.seat === input.scoreTarget)?.roleId === "merlin" ? "evil" : "good" : option.winner;
    match.scoringFacts = {reason:option.id,...(option.requiresTarget ? {target:input.scoreTarget} : {})};
    match.source = "manual"; match.excludedReason = null; match.scoreExcludedReason = null;
    match.scoreRevision = (match.scoreRevision || 0) + 1;
    this.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(match),id);
    for (const {uid,...player} of players) {
      player.outcome = player.faction === match.winner ? "win" : "loss";
      this.db.prepare("UPDATE match_players SET outcome=?,snapshot=? WHERE match_id=? AND uid=?").run(player.outcome,JSON.stringify(player),id,uid);
      this.db.prepare("UPDATE match_scores SET status='scored' WHERE match_id=? AND uid=?").run(id,uid);
      this.rebuildScores(uid);
    }
    // Synchronize any still-visible completed table, including later streak awards.
    for (const roomRow of this.db.prepare("SELECT code,state FROM rooms WHERE json_extract(state,'$.matchRecord.id') IS NOT NULL").all()) {
      const room = JSON.parse(roomRow.state), archived = this.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(room.matchRecord.id);
      if (!archived) continue;
      const saved = JSON.parse(archived.snapshot);
      room.matchRecord = {...saved,players:this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(saved.id).map(p=>({uid:p.uid,...JSON.parse(p.snapshot)}))};
      if (saved.id === id) {room.result={winner:saved.winner,source:"manual",reason:"管理员已更正本局结果。"};room.scoringFacts=saved.scoringFacts;}
      this.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(room),room.code);
    }
    this.invalidateLeaderboard();
    return {id,winner:match.winner,revision:match.scoreRevision,before,after:{winner:match.winner,facts:match.scoringFacts,revision:match.scoreRevision}};
  }
  rebuildScores(uid) {
    const rows = this.db.prepare(`SELECT s.match_id,s.snapshot AS score,p.snapshot AS player,m.snapshot AS game FROM match_scores s
      JOIN match_players p ON p.match_id=s.match_id AND p.uid=s.uid JOIN matches m ON m.id=s.match_id
      WHERE s.uid=? AND s.status='scored' ORDER BY s.ended,s.rowid`).all(uid);
    let streak = 0;
    for (const row of rows) {
      const player=JSON.parse(row.player), game=JSON.parse(row.game);
      streak = player.outcome === "win" ? streak + 1 : 0;
      const score = {...scoring.scorePlayer(player,game.scoringFacts,game.scorePolicy,null),streak};
      const bonus = game.scorePolicy.streakBonus;
      if (bonus.enabled && streak === bonus.threshold) {score.breakdown.push({id:"streak",label:bonus.label,points:bonus.points});score.total+=bonus.points;}
      player.score=score;
      this.db.prepare("UPDATE match_scores SET points=?,snapshot=? WHERE match_id=? AND uid=?").run(score.total,JSON.stringify(score),row.match_id,uid);
      this.db.prepare("UPDATE match_players SET snapshot=? WHERE match_id=? AND uid=?").run(JSON.stringify(player),row.match_id,uid);
    }
  }
  matchesFor(uid, offset = 0, limit = 20, scoredOnly = false) {
    const filter = scoredOnly ? " AND EXISTS (SELECT 1 FROM match_scores s WHERE s.match_id=p.match_id AND s.uid=p.uid AND s.status='scored')" : "";
    const total = this.db.prepare("SELECT count(*) AS total FROM match_players p WHERE uid=?" + filter).get(uid).total;
    const rows = this.db.prepare(`SELECT p.match_id, m.snapshot AS game, p.snapshot AS player
      FROM match_players p JOIN matches m ON m.id=p.match_id
      WHERE p.uid=? ${filter} ORDER BY p.ended DESC,p.match_id DESC LIMIT ? OFFSET ?`).all(uid, limit, offset);
    const members = this.db.prepare("SELECT snapshot FROM match_players WHERE match_id=? ORDER BY json_extract(snapshot,'$.seat')");
    const records = rows.map(row => {
      const game = JSON.parse(row.game), player = JSON.parse(row.player);
      return {
        id: row.match_id, boardName: game.boardName, capacity: game.capacity,
        startedAt: game.startedAt, endedAt: game.endedAt, winner: game.winner,
        source: game.source, excludedReason: game.excludedReason,
        name: player.name, seat: player.seat, role: player.role,
        faction: player.faction, outcome: player.outcome,
        score: player.score || { status: "legacy", total: null, breakdown: [], reason: "积分功能启用前的记录" },
        scoreEndReason: game.scorePolicy?.endReasons.find(reason => reason.id === game.scoringFacts?.reason)?.label || null,
        members: members.all(row.match_id).map(member => {
          const { seat, name } = JSON.parse(member.snapshot);
          return { seat, name };
        }),
      };
    });
    return { records, total, hasMore: offset + records.length < total };
  }
  session(hash) {
    return this.db
      .prepare("SELECT uid FROM sessions WHERE hash=? AND expires>?")
      .get(hash, Date.now());
  }
  addSession(hash, uid) {
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(hash, uid, Date.now() + 30 * 86400000);
  }
  receipt(uid, id) {
    return this.db
      .prepare(
        "SELECT fingerprint,result FROM receipts WHERE uid=? AND request=?",
      )
      .get(uid, id);
  }
  addReceipt(uid, id, fingerprint, result) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?,?,?)")
      .run(uid, id, fingerprint, JSON.stringify(result), Date.now());
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
