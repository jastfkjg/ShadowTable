"use strict";
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, chmodSync } = require("node:fs");
const { dirname } = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { roomSummary, RuleError, roleName } = require("./engine");
const scoring = require("./scoring");
const fun = require("./fun");
const { migrate: migrateKnights } = require("./knights");
const adjustmentReason = (reason = "") => {
  if (typeof reason!=="string" || reason.length>200) throw new RuleError("操作备注最多200字");
  return reason.trim();
};
class Store {
  constructor(path, { clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.leaderboardRevision = 0;
    this.leaderboardDirty = false;
    this.inTransaction = false;
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.rebuildRoomEntries = !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='room_entries'").get();
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
      CREATE TABLE IF NOT EXISTS match_events(match_id TEXT NOT NULL,event_id TEXT NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(match_id,event_id));
      CREATE TABLE IF NOT EXISTS match_fun_stats(match_id TEXT NOT NULL,uid TEXT NOT NULL,mode TEXT NOT NULL,metric TEXT NOT NULL,role TEXT NOT NULL,role_label TEXT NOT NULL,count INTEGER NOT NULL,opportunities INTEGER NOT NULL,status TEXT NOT NULL,ended INTEGER NOT NULL,PRIMARY KEY(match_id,uid,metric,role));
      CREATE INDEX IF NOT EXISTS match_fun_user ON match_fun_stats(uid,mode,metric,ended);
      CREATE INDEX IF NOT EXISTS match_fun_rank ON match_fun_stats(mode,metric,ended,uid) WHERE status='known';
      CREATE INDEX IF NOT EXISTS match_fun_metric ON match_fun_stats(metric,ended,uid);
      CREATE TABLE IF NOT EXISTS score_versions(uid TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS score_adjustments(id TEXT PRIMARY KEY, uid TEXT NOT NULL, delta INTEGER NOT NULL, mode TEXT NOT NULL, before_points INTEGER NOT NULL, after_points INTEGER NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS score_adjustments_user ON score_adjustments(uid,created DESC);
      CREATE TABLE IF NOT EXISTS receipts(uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(uid, request));`);
    const profileColumns = this.db.prepare("PRAGMA table_info(profiles)").all();
    if (!profileColumns.some(column => column.name === "leaderboard_visible"))
      this.db.exec("ALTER TABLE profiles ADD COLUMN leaderboard_visible INTEGER NOT NULL DEFAULT 1");
    if (!profileColumns.some(column => column.name === "public_id"))
      this.db.exec("ALTER TABLE profiles ADD COLUMN public_id TEXT");
    if (!profileColumns.some(column => column.name === "nickname_confirmed")) this.transaction(() => {
      this.db.exec("ALTER TABLE profiles ADD COLUMN nickname_confirmed INTEGER NOT NULL DEFAULT 0");
      // Visibility-only saves used to persist the placeholder as a real nickname.
      // Explicit profile-save receipts distinguish intentional uses of that name;
      // ambiguous legacy placeholders remain unchanged until their owner confirms.
      const visibilityFingerprints = [false, true].map(leaderboardVisible => createHash("sha256")
        .update(JSON.stringify(["/api/me/leaderboard-visibility", { leaderboardVisible }])).digest("hex"));
      this.db.prepare(`UPDATE profiles SET nickname_confirmed=1 WHERE trim(nickname)<>'' AND
        (nickname<>'新朋友' OR EXISTS (SELECT 1 FROM receipts r WHERE r.uid=profiles.uid
          AND json_extract(r.result,'$.nickname')=profiles.nickname AND json_extract(r.result,'$.version') IS NOT NULL
          AND r.fingerprint NOT IN (?,?)))`).run(...visibilityFingerprints);
    });
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
      this.restoreFunRecords();
      for (const row of this.db.prepare("SELECT code, state FROM rooms").all()) {
        const room = JSON.parse(row.state);
        if (migrateKnights(room)) this.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(room), row.code);
      }
    });
    require("./retention").initialize(this);
  }
  restoreFunRecords() {
    const rows = this.db.prepare("SELECT DISTINCT m.id,m.snapshot FROM matches m JOIN match_players p ON p.match_id=m.id WHERE json_extract(p.snapshot,'$.fun.version') IS NULL OR json_extract(p.snapshot,'$.fun.version')<>? OR (json_extract(p.snapshot,'$.fun.status')='legacy' AND json_extract(m.snapshot,'$.board') IN ('classic','classic-court') AND json_extract(m.snapshot,'$.scoringFacts.reason') IS NOT NULL)").all(fun.VERSION);
    for (const row of rows) {
      const match = JSON.parse(row.snapshot), players = this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(row.id).map(p => ({ uid: p.uid, ...JSON.parse(p.snapshot) }));
      // Only classical frozen identities and explicit terminal facts can be recovered.
      if (!match.funFacts && fun.modeFor(match.board) === "classic" && match.scoringFacts && players.every(p => p.roleId)) {
        const room = { board: match.board, players, roles: Object.fromEntries(players.map(p => [p.uid,p.roleId])) };
        match.funFacts = { version: fun.VERSION, initialRoles: { ...room.roles }, events: [], attacksComplete: false,
          terminal: fun.terminal(room, match.scoringFacts, null, match.source) };
        this.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(match), match.id);
      }
      this.rebuildFun(match, players);
    }
    if (rows.length) this.syncScoreRooms();
  }
  writeFun(match, uid, projection) {
    this.db.prepare("DELETE FROM match_fun_stats WHERE match_id=? AND uid=?").run(match.id, uid);
    const insert = this.db.prepare("INSERT INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)");
    for (const row of projection.metrics) insert.run(match.id, uid, projection.mode, row.id, row.role, roleName(row.role) || "未知角色", row.count, row.opportunities, row.status, match.endedAt);
  }
  rebuildFun(match, players) {
    const projections = fun.project(match, players, roleName);
    for (const player of players) {
      player.fun = projections.find(p => p.uid === player.uid).fun;
      this.writeFun(match, player.uid, player.fun);
      const { uid, ...snapshot } = player;
      this.db.prepare("UPDATE match_players SET outcome=?,snapshot=? WHERE match_id=? AND uid=?").run(snapshot.outcome, JSON.stringify(snapshot), match.id, uid);
    }
    this.invalidateLeaderboard();
  }
  funFor(uid) {
    const rows = this.db.prepare("SELECT f.* FROM match_fun_stats f JOIN match_players p ON p.match_id=f.match_id AND p.uid=f.uid WHERE f.uid=? AND p.outcome IN ('win','loss') ORDER BY f.mode,f.metric,f.role").all(uid);
    const legacy = this.db.prepare("SELECT count(*) AS n FROM match_players WHERE uid=? AND json_extract(snapshot,'$.fun.status')='legacy'").get(uid).n;
    return fun.aggregate(rows, legacy);
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
    this.db.prepare("INSERT INTO room_entries(uid,code,snapshot) VALUES(?,?,?) ON CONFLICT(uid,code) DO UPDATE SET snapshot=excluded.snapshot,unavailable_since=0").run(uid, room.code, snapshot);
  }
  entry(uid, code) {
    return this.db.prepare("SELECT * FROM room_entries WHERE uid=? AND code=?").get(uid, code);
  }
  visitRoom(uid, code) {
    this.db.prepare("UPDATE room_entries SET hidden=0, entered=? WHERE uid=? AND code=?").run(this.clock(), uid, code);
    this.touchRoom(code);
  }
  personalRooms(uid) {
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
    room.updatedAt = this.clock();
    this.db
      .prepare(
        "INSERT INTO rooms VALUES(?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state",
      )
      .run(room.code, JSON.stringify(room));
    this.db.prepare("INSERT INTO room_lifecycle(code,phase,activity) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET phase=excluded.phase,activity=excluded.activity,pending_since=0").run(room.code, room.phase, this.clock());
    this.db.prepare("UPDATE room_entries SET unavailable_since=? WHERE code=? AND unavailable_since=0").run(this.clock(), room.code);
    for (const uid of new Set([room.host, ...room.players.map(p => p.uid), ...(room.spectators || []).map(p => p.uid)])) this.trackRoom(room, uid);
  }
  touchRoom(code) {
    // Polling keeps a viewed room active, but writes at most once per hour.
    this.db.prepare("UPDATE room_lifecycle SET activity=?,pending_since=0 WHERE code=? AND (activity<=? OR pending_since>0)").run(this.clock(), code, this.clock() - 3600000);
  }
  remove(code) {
    this.db.prepare("UPDATE room_entries SET unavailable_since=? WHERE code=? AND unavailable_since=0").run(this.clock(), code);
    this.db.prepare("DELETE FROM room_lifecycle WHERE code=?").run(code);
    this.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
  }
  archiveMatch(record) {
    const { players, ...match } = record;
    this.db.prepare("INSERT OR IGNORE INTO matches VALUES(?,?)").run(match.id, JSON.stringify(match));
    const projections = fun.project(record, players, roleName);
    for (const event of record.funFacts?.events || []) this.db.prepare("INSERT OR IGNORE INTO match_events VALUES(?,?,?)").run(match.id, event.id, JSON.stringify(event));
    const insert = this.db.prepare("INSERT OR IGNORE INTO match_players VALUES(?,?,?,?,?,?,?)");
    for (const { uid, ...player } of players) {
      player.fun = projections.find(p => p.uid === uid).fun;
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
        this.writeFun(match, uid, player.fun);
        if (player.score) this.db.prepare("INSERT INTO match_scores VALUES(?,?,?,?,?,?)").run(match.id, uid, player.score.status, player.score.total, match.endedAt, JSON.stringify(player.score));
        this.invalidateLeaderboard();
        this.touchScore(uid);
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
        const { scorePolicy, scoringFacts, scoreEligibilityReason, scoreExcludedReason, funFacts, ...game } = JSON.parse(row.game);
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
    const manual = this.db.prepare("SELECT coalesce(sum(delta),0) AS total, coalesce(sum(CASE WHEN created>=? AND created<? THEN delta ELSE 0 END),0) AS month, count(*) AS count FROM score_adjustments WHERE uid=?").get(monthStart,monthEnd,uid);
    return { identityType: uid.split(":")[0], ...summary(total), byFaction, byRole, byBoard, recent, fun: this.funFor(uid),
      score: { ...aggregate(scoreRows), total: aggregate(scoreRows).total + manual.total, month: aggregate(scoreRows.filter(row => row.ended >= monthStart && row.ended < monthEnd)).total + manual.month, manualAdjustment: manual, ...this.streakFor(uid) } };
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
    const option = scoring.optionsFor(match.board, match.scorePolicy).find(reason => reason.id === input.scoreReason);
    if (!option) throw new RuleError("计分结束原因无效");
    const players = this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(id).map(player => ({uid:player.uid,...JSON.parse(player.snapshot)}));
    if (!players.length || players.some(player => !player.roleId || player.faction === "unknown")) throw new RuleError("身份信息不完整，不能更正计分");
    if (option.requiresTarget && !scoring.validTarget(input.scoreTarget, players, match.board, match.scorePolicy)) throw new RuleError("请选择实际在场刺杀目标或空刀");
    const before = {winner:match.winner, facts:match.scoringFacts, revision:match.scoreRevision || 0};
    match.winner = scoring.resolveWinner(option, input.scoreTarget, players, match.board, match.scorePolicy);
    match.scoringFacts = {reason:option.id,...(option.requiresTarget ? {target:input.scoreTarget} : {})};
    match.source = "manual"; match.excludedReason = null; match.scoreExcludedReason = null;
    if (match.funFacts) {
      const knight = fun.modeFor(match.board) === "knights";
      const actor = input.funActor ?? (knight && option.requiresTarget && match.funFacts.terminal?.actor ? players.find(p => p.uid === match.funFacts.terminal.actor.uid)?.seat : undefined);
      const room = { players, roles: Object.fromEntries(players.map(p => [p.uid,p.roleId])),
        ...(fun.modeFor(match.board) === "knights" ? { knights: { players: Object.fromEntries(players.map(p => [p.uid,{ alive: p.alive !== false, faction: p.faction }])) } } : {}) };
      if (actor !== undefined && (!knight || !option.requiresTarget || !players.some(p => p.seat === actor && p.alive !== false) || actor === input.scoreTarget)) throw new RuleError("请选择实际在场带刀人且不能自刀");
      match.funFacts.terminal = fun.terminal(room, { ...match.scoringFacts, ...(actor !== undefined ? { actor } : {}) }, null, "manual");
    }
    match.scoreRevision = (match.scoreRevision || 0) + 1;
    this.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(match),id);
    for (const {uid,...player} of players) {
      player.outcome = player.faction === match.winner ? "win" : "loss";
      this.db.prepare("UPDATE match_players SET outcome=?,snapshot=? WHERE match_id=? AND uid=?").run(player.outcome,JSON.stringify(player),id,uid);
      this.db.prepare("UPDATE match_scores SET status='scored' WHERE match_id=? AND uid=?").run(id,uid);
      this.rebuildScores(uid);
    }
    this.rebuildFun(match, this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(id).map(p => ({ uid: p.uid, ...JSON.parse(p.snapshot) })));
    this.syncScoreRooms(id);
    this.invalidateLeaderboard();
    return {id,winner:match.winner,revision:match.scoreRevision,before,after:{winner:match.winner,facts:match.scoringFacts,revision:match.scoreRevision}};
  }
  correctFunMatch(id, input) {
    if (!this.inTransaction) throw Error("对局更正必须在事务中执行");
    const row = this.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id);
    if (!row) throw new RuleError("对局不存在",404);
    const match = JSON.parse(row.snapshot);
    if (!match.funFacts || match.excludedReason === "对局终止") throw new RuleError("本局无法更正趣味记录");
    if (match.scorePolicy && !match.scoreEligibilityReason) return this.correctMatch(id,{...input,scoreReason:input.funReason,scoreTarget:input.funTarget});
    if (!Number.isSafeInteger(input.revision) || input.revision !== (match.scoreRevision || 0)) throw new RuleError("对局已更新，请重新加载",409);
    const option = fun.settlementOptions(match.board).find(item=>item.id===input.funReason);
    if (!option) throw new RuleError("趣味结束原因无效");
    const players = this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(id).map(p=>({uid:p.uid,...JSON.parse(p.snapshot)}));
    if (!players.length || players.some(p=>!p.roleId || p.faction==='unknown')) throw new RuleError("身份信息不完整，不能更正");
    const knight = fun.modeFor(match.board)==='knights', rules = {targetModes: knight ? {[match.board]:"living_merlin"} : {}};
    if (option.requiresTarget && !scoring.validTarget(input.funTarget,players,match.board,rules)) throw new RuleError("请选择实际在场刺杀目标或空刀");
    const actor = input.funActor ?? (knight && option.requiresTarget ? players.find(p=>p.uid===match.funFacts.terminal?.actor?.uid)?.seat : undefined);
    if (actor!==undefined && (!knight || !option.requiresTarget || !players.some(p=>p.seat===actor && p.alive!==false) || actor===input.funTarget)) throw new RuleError("请选择实际在场带刀人且不能自刀");
    const before = {winner:match.winner,facts:match.funFacts.terminal,revision:match.scoreRevision || 0};
    const room = {players,roles:Object.fromEntries(players.map(p=>[p.uid,p.roleId])),...(knight ? {knights:{players:Object.fromEntries(players.map(p=>[p.uid,{alive:p.alive!==false,faction:p.faction}]))}} : {})};
    match.funFacts.terminal = fun.terminal(room,{reason:option.id,...(option.requiresTarget ? {target:input.funTarget,...(actor!==undefined ? {actor} : {})} : {})},null,"manual");
    match.winner = scoring.resolveWinner(option,input.funTarget,players,match.board,rules);
    match.source="manual";match.excludedReason=null;match.scoreRevision=(match.scoreRevision || 0)+1;
    this.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(match),id);
    players.forEach(p=>p.outcome=p.faction===match.winner ? "win" : "loss");
    this.rebuildFun(match,players);this.syncScoreRooms(id);this.invalidateLeaderboard();
    return {id,winner:match.winner,revision:match.scoreRevision,before,after:{winner:match.winner,facts:match.funFacts.terminal,revision:match.scoreRevision}};
  }
  syncScoreRooms(resultId = null) {
    // Synchronize any still-visible completed table, including later streak awards.
    for (const roomRow of this.db.prepare("SELECT code,state FROM rooms WHERE json_extract(state,'$.matchRecord.id') IS NOT NULL").all()) {
      const room = JSON.parse(roomRow.state), archived = this.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(room.matchRecord.id);
      if (!archived) continue;
      const saved = JSON.parse(archived.snapshot);
      room.matchRecord = {...saved,players:this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=?").all(saved.id).map(p=>({uid:p.uid,...JSON.parse(p.snapshot)}))};
      if (saved.id === resultId) {room.result={winner:saved.winner,source:"manual",reason:"管理员已更正本局结果。"};room.scoringFacts=saved.scoringFacts;}
      this.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(room),room.code);
    }
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
      const override = JSON.parse(row.score).manualOverride;
      if (override) {
        score.manualOverride = override;
        score.breakdown.push({id:"admin",label:"管理员调整",points:override.points-score.total});
        score.total = override.points;
      }
      player.score=score;
      this.db.prepare("UPDATE match_scores SET points=?,snapshot=? WHERE match_id=? AND uid=?").run(score.total,JSON.stringify(score),row.match_id,uid);
      this.db.prepare("UPDATE match_players SET snapshot=? WHERE match_id=? AND uid=?").run(JSON.stringify(player),row.match_id,uid);
    }
    this.touchScore(uid);
  }
  scoreRevision(uid) { return this.db.prepare("SELECT revision FROM score_versions WHERE uid=?").get(uid)?.revision || 0; }
  touchScore(uid) {
    this.db.prepare("INSERT INTO score_versions VALUES(?,1) ON CONFLICT(uid) DO UPDATE SET revision=revision+1").run(uid);
  }
  playerScore(uid) {
    const matchPoints = this.db.prepare("SELECT coalesce(sum(points),0) AS points,count(*) AS games FROM match_scores WHERE uid=? AND status='scored'").get(uid);
    const manual = this.db.prepare("SELECT coalesce(sum(delta),0) AS points FROM score_adjustments WHERE uid=?").get(uid).points;
    return {uid,points:matchPoints.points+manual,matchPoints:matchPoints.points,manualPoints:manual,games:matchPoints.games,revision:this.scoreRevision(uid)};
  }
  scoreAdjustments(uid, offset = 0, limit = 20) {
    const total = this.db.prepare("SELECT count(*) AS total FROM score_adjustments WHERE uid=?").get(uid).total;
    const records = this.db.prepare("SELECT id,delta,mode,before_points AS beforePoints,after_points AS afterPoints,reason,created FROM score_adjustments WHERE uid=? ORDER BY created DESC,rowid DESC LIMIT ? OFFSET ?").all(uid,limit,offset);
    return {records,total,hasMore:offset+records.length<total};
  }
  searchScorePlayers(query, offset = 0) {
    const sql = `WITH known AS (SELECT uid FROM profiles UNION SELECT uid FROM match_players UNION SELECT json_extract(p.value,'$.uid') FROM rooms r,json_each(r.state,'$.players') p),
      players AS (SELECT k.uid,f.public_id AS publicId,coalesce(nullif(f.nickname,''),
        (SELECT json_extract(p.snapshot,'$.name') FROM match_players p WHERE p.uid=k.uid ORDER BY p.ended DESC LIMIT 1),
        (SELECT json_extract(p.value,'$.name') FROM rooms r,json_each(r.state,'$.players') p WHERE json_extract(p.value,'$.uid')=k.uid LIMIT 1),k.uid) AS name
        FROM known k LEFT JOIN profiles f ON f.uid=k.uid)
      SELECT * FROM players WHERE instr(lower(name),lower(?))>0 OR uid=? OR publicId=? ORDER BY name,uid LIMIT 51 OFFSET ?`;
    const rows = this.db.prepare(sql).all(query,query,query,offset);
    return {players:rows.slice(0,50).map(player=>({...player,...this.playerScore(player.uid)})),hasMore:rows.length>50};
  }
  adjustPlayerScore(input) {
    if (!this.inTransaction) throw Error("积分调整必须在事务中执行");
    const reason=adjustmentReason(input.reason);
    const known = this.db.prepare("SELECT 1 FROM profiles WHERE uid=? UNION SELECT 1 FROM match_players WHERE uid=? UNION SELECT 1 FROM rooms r,json_each(r.state,'$.players') p WHERE json_extract(p.value,'$.uid')=? LIMIT 1").get(input.uid,input.uid,input.uid);
    if (!known) throw new RuleError("玩家不存在",404);
    if (!['delta','set'].includes(input.mode) || !Number.isSafeInteger(input.points) || Math.abs(input.points)>1000000) throw new RuleError("请输入-1000000至1000000的整数积分");
    const before = this.playerScore(input.uid);
    if (!Number.isSafeInteger(input.revision) || input.revision!==before.revision) throw new RuleError("玩家积分已变化，请重新查询",409);
    const delta = input.mode==='set' ? input.points-before.points : input.points;
    if (!delta) throw new RuleError("积分没有变化");
    const id=randomUUID(),created=Date.now(),after=before.points+delta;
    if (!Number.isSafeInteger(after)) throw new RuleError("积分超出有效范围");
    this.initializeLeaderboardProfile(input.uid);
    this.db.prepare("INSERT INTO score_adjustments VALUES(?,?,?,?,?,?,?,?)").run(id,input.uid,delta,input.mode,before.points,after,reason,created);
    this.touchScore(input.uid);this.invalidateLeaderboard();
    return {id,uid:input.uid,before:before.points,after,delta,revision:this.scoreRevision(input.uid)};
  }
  matchScoreData(id) {
    const row=this.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id);
    if (!row) throw new RuleError("对局不存在",404);
    const match=JSON.parse(row.snapshot);
    return {id,code:match.code,boardName:match.boardName,endedAt:match.endedAt,revision:match.scoreRevision || 0,
      players:this.db.prepare("SELECT uid,snapshot FROM match_players WHERE match_id=? ORDER BY json_extract(snapshot,'$.seat')").all(id).map(row=>{
        const player=JSON.parse(row.snapshot),score=player.score;
        return {uid:row.uid,name:player.name,seat:player.seat,editable:score?.status==='scored',score:score || null};
      })};
  }
  adjustMatchScores(id,input) {
    if (!this.inTransaction) throw Error("积分调整必须在事务中执行");
    const reason=adjustmentReason(input.reason);
    const data=this.matchScoreData(id);
    if (!Number.isSafeInteger(input.revision) || input.revision!==data.revision) throw new RuleError("对局已更新，请重新查询",409);
    if (!Array.isArray(input.scores) || !input.scores.length || input.scores.length>13 || input.scores.some(row=>!row || typeof row.uid!=="string") || new Set(input.scores.map(row=>row.uid)).size!==input.scores.length) throw new RuleError("请选择不同的玩家并填写积分");
    for (const change of input.scores) {
      const player=data.players.find(player=>player.uid===change.uid);
      if (!player?.editable) throw new RuleError("该玩家本局未计分，不能修改本局积分");
      if (change.points!==null && (!Number.isSafeInteger(change.points) || Math.abs(change.points)>1000000)) throw new RuleError("请输入-1000000至1000000的整数积分");
    }
    const before=[],created=Date.now();
    for (const change of input.scores) {
      const player=data.players.find(player=>player.uid===change.uid),score={...player.score};
      before.push({uid:player.uid,seat:player.seat,name:player.name,points:score.total,override:score.manualOverride || null});
      if (change.points===null) delete score.manualOverride;
      else score.manualOverride={points:change.points,reason,created};
      this.db.prepare("UPDATE match_scores SET snapshot=? WHERE match_id=? AND uid=?").run(JSON.stringify(score),id,change.uid);
      this.rebuildScores(change.uid);
    }
    const match=JSON.parse(this.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id).snapshot);
    match.scoreRevision=data.revision+1;
    this.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(match),id);
    this.syncScoreRooms();this.invalidateLeaderboard();
    const after=this.matchScoreData(id);
    return {id,code:data.code,revision:after.revision,before,after:after.players.filter(player=>input.scores.some(row=>row.uid===player.uid)).map(player=>({uid:player.uid,seat:player.seat,name:player.name,points:player.score.total,override:player.score.manualOverride || null}))};
  }
  matchesFor(uid, offset = 0, limit = 20, scoredOnly = false, funFilter = null) {
    let filter = scoredOnly ? " AND EXISTS (SELECT 1 FROM match_scores s WHERE s.match_id=p.match_id AND s.uid=p.uid AND s.status='scored')" : "";
    const args = [uid];
    if (funFilter) {
      filter += " AND EXISTS (SELECT 1 FROM match_fun_stats f WHERE f.match_id=p.match_id AND f.uid=p.uid AND f.metric=? AND f.mode=? AND f.status='known' AND f.count>0" + (funFilter.role ? " AND f.role=?" : "") + ")";
      args.push(funFilter.metric, funFilter.mode, ...(funFilter.role ? [funFilter.role] : []));
    }
    const total = this.db.prepare("SELECT count(*) AS total FROM match_players p WHERE uid=?" + filter).get(...args).total;
    const rows = this.db.prepare(`SELECT p.match_id, m.snapshot AS game, p.snapshot AS player
      FROM match_players p JOIN matches m ON m.id=p.match_id
      WHERE p.uid=? ${filter} ORDER BY p.ended DESC,p.match_id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const members = this.db.prepare("SELECT snapshot FROM match_players WHERE match_id=? ORDER BY json_extract(snapshot,'$.seat')");
    const records = rows.map(row => {
      const game = JSON.parse(row.game), player = JSON.parse(row.player);
      return {
        id: row.match_id, boardName: game.boardName, capacity: game.capacity,
        startedAt: game.startedAt, endedAt: game.endedAt, winner: game.winner,
        source: game.source, excludedReason: game.excludedReason,
        name: player.name, seat: player.seat, role: player.role,
        faction: player.faction, outcome: player.outcome,
        fun: player.fun || null,
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
      .get(hash, this.clock());
  }
  addSession(hash, uid) {
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(hash, uid, this.clock() + 30 * 86400000);
  }
  receipt(uid, id) {
    const cached = this.db.prepare("SELECT fingerprint,result FROM receipts WHERE uid=? AND request=?").get(uid, id);
    if (cached) return cached;
    if (this.db.prepare("SELECT 1 FROM receipt_tombstones WHERE uid=? AND request=?").get(uid, id))
      throw new RuleError("原请求已处理且回执已过期，请刷新并核对结果，不要重复提交", 410);
    // New clients embed a creation time; legacy IDs remain compatible and keep permanent tombstones.
    if (id.startsWith("v1_")) {
      const parts = /^v1_([a-z0-9]+)_[a-zA-Z0-9_-]+$/.exec(id), created = parts && parseInt(parts[1], 36);
      if (!Number.isSafeInteger(created) || created > this.clock() + 300000 || created < this.clock() - 30 * 86400000)
        throw new RuleError("请求已过期或设备时间不正确，请刷新并核对结果后重新操作", 410);
    }
    return undefined;
  }
  addReceipt(uid, id, fingerprint, result) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?,?,?)")
      .run(uid, id, fingerprint, JSON.stringify(result), this.clock());
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
