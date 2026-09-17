"use strict";
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync, chmodSync } = require("node:fs");
const { dirname } = require("node:path");
class Store {
  constructor(path) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY, action TEXT NOT NULL, code TEXT NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, uid TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(uid, request));`);
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
        WHERE json_extract(value, '$.uid') = ?)
      ORDER BY code`,
      )
      .all(uid, uid)
      .map((row) => JSON.parse(row.state));
  }
  save(room) {
    this.db
      .prepare(
        "INSERT INTO rooms VALUES(?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state",
      )
      .run(room.code, JSON.stringify(room));
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
