"use strict";
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, chmodSync } = require("node:fs");
const { dirname } = require("node:path");
const { roomSummary } = require("./engine");
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
      CREATE TABLE IF NOT EXISTS receipts(uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(uid, request));`);
    const columns = this.db.prepare("PRAGMA table_info(admin_audit)").all();
    if (!columns.some((column) => column.name === "details"))
      this.db.exec(
        "ALTER TABLE admin_audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}'",
      );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS admin_audit_room ON admin_audit(code, id)",
    );
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
