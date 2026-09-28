"use strict";
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, chmodSync } = require("node:fs");
const { dirname } = require("node:path");
const { roomSummary } = require("./engine");
const { migrate: migrateKnights } = require("./knights");
class Store {
  constructor(path) {
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
      CREATE TABLE IF NOT EXISTS receipts(uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(uid, request));`);
    const columns = this.db.prepare("PRAGMA table_info(admin_audit)").all();
    if (!columns.some((column) => column.name === "details"))
      this.db.exec(
        "ALTER TABLE admin_audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}'",
      );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS admin_audit_room ON admin_audit(code, id)",
    );
    this.transaction(() => {
      for (const row of this.db.prepare("SELECT code, state FROM rooms").all()) {
        const room = JSON.parse(row.state);
        if (migrateKnights(room)) this.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(room), row.code);
      }
    });
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
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
    for (const { uid, ...player } of players)
      insert.run(match.id, uid, match.board, player.faction, player.outcome, match.endedAt, JSON.stringify(player));
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
    const byBoard = this.db.prepare(`SELECT p.board, json_extract(m.snapshot,'$.capacity') AS capacity,
      json_extract(m.snapshot,'$.boardName') AS name, ${counts}
      FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.uid=?
      GROUP BY p.board,capacity ORDER BY p.board,capacity`).all(uid)
      .map(row => ({ board: row.board, capacity: row.capacity, key: row.board + ":" + row.capacity,
        label: row.name + " · " + row.capacity + "人", ...summary(row) }));
    const recent = this.db.prepare("SELECT m.snapshot AS game, p.snapshot AS player FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.uid=? ORDER BY p.ended DESC,p.match_id DESC LIMIT 20").all(uid)
      .map(row => ({ ...JSON.parse(row.game), ...JSON.parse(row.player) }));
    return { identityType: uid.split(":")[0], ...summary(total), byFaction, byBoard, recent };
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
