"use strict";
const DAY = 86400000;
const ROOM_IDLE_DAYS = 7;
const roomActivityCutoff = now => now - ROOM_IDLE_DAYS * DAY;
const defaults = Object.freeze({ entryDays: 90, receiptDays: 90, batchSize: 100 });

function initialize(store) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS maintenance_meta(name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS room_lifecycle(code TEXT PRIMARY KEY, phase TEXT NOT NULL, activity INTEGER NOT NULL, pending_since INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS room_lifecycle_recent ON room_lifecycle(activity DESC,code ASC);
    CREATE TABLE IF NOT EXISTS receipt_tombstones(uid TEXT NOT NULL, request TEXT NOT NULL, PRIMARY KEY(uid,request));
    CREATE INDEX IF NOT EXISTS room_entries_code ON room_entries(code);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE INDEX IF NOT EXISTS receipts_created ON receipts(created);`);
  if (!db.prepare("PRAGMA table_info(room_entries)").all().some(c => c.name === "unavailable_since"))
    db.exec("ALTER TABLE room_entries ADD COLUMN unavailable_since INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS room_entries_expiry ON room_entries(unavailable_since) WHERE unavailable_since>0 AND note=''");
  store.transaction(() => {
    const migrated = db.prepare("SELECT 1 FROM maintenance_meta WHERE name='room-entries-v1'").get();
    for (const row of db.prepare("SELECT state FROM rooms").all()) {
      const room = JSON.parse(row.state);
      const lastEntered = db.prepare("SELECT max(entered) AS at FROM room_entries WHERE code=?").get(room.code).at;
      const recorded = Math.max(room.updatedAt || room.createdAt || 0, lastEntered || 0);
      // Only give an undated legacy room a starting time on its first migration.
      const activity = recorded || (db.prepare("SELECT activity FROM room_lifecycle WHERE code=?").get(room.code)?.activity ?? store.clock());
      db.prepare(`INSERT INTO room_lifecycle(code,phase,activity) VALUES(?,?,?)
        ON CONFLICT(code) DO UPDATE SET phase=excluded.phase,activity=max(activity,excluded.activity),
        pending_since=CASE WHEN excluded.activity>activity THEN 0 ELSE pending_since END`).run(room.code, room.phase, activity);
      if (!migrated || store.rebuildRoomEntries) for (const uid of new Set([room.host, ...room.players.map(p => p.uid), ...(room.spectators || []).map(p => p.uid)])) store.trackRoom(room, uid);
    }
    db.prepare("INSERT OR IGNORE INTO maintenance_meta VALUES('room-entries-v1',?)").run(String(store.clock()));
    db.prepare("UPDATE room_entries SET unavailable_since=? WHERE unavailable_since=0 AND code NOT IN (SELECT code FROM rooms)").run(store.clock());
  });
}

// Small transactions run on the existing writer. No archive, score, audit or profile is deleted.
function cleanup(store, options = {}) {
  const policy = { ...defaults, ...options }, now = store.clock(), db = store.db;
  for (const key of Object.keys(defaults)) if (!Number.isSafeInteger(policy[key]) || policy[key] < 1 || policy[key] > (key === "batchSize" ? 1000 : 3650)) throw new Error("无效清理配置：" + key);
  return store.transaction(() => {
    const result = { sessions: 0, receipts: 0, rooms: 0, entries: 0 };
    const limit = policy.batchSize;
    result.sessions = db.prepare("DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE expires<=? ORDER BY expires LIMIT ?)").run(now, limit).changes;
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_sessions'").get()) {
      result.sessions += db.prepare("DELETE FROM web_sessions WHERE hash IN (SELECT hash FROM web_sessions WHERE expires<=? ORDER BY expires LIMIT ?)").run(now, limit).changes;
      db.prepare("DELETE FROM web_login_requests WHERE id IN (SELECT id FROM web_login_requests WHERE expires<=? ORDER BY expires LIMIT ?)").run(now, limit);
    }
    const receipts = db.prepare("SELECT uid,request FROM receipts WHERE created<? ORDER BY created LIMIT ?").all(now - policy.receiptDays * DAY, limit);
    for (const row of receipts) {
      db.prepare("INSERT OR IGNORE INTO receipt_tombstones VALUES(?,?)").run(row.uid, row.request);
      db.prepare("DELETE FROM receipts WHERE uid=? AND request=?").run(row.uid, row.request);
      result.receipts++;
    }
    const rooms = db.prepare(`SELECT code FROM room_lifecycle WHERE activity<=?
      ORDER BY activity, code LIMIT ?`).all(roomActivityCutoff(now), limit);
    for (const { code } of rooms) {
      const room = store.get(code);
      if (room?.matchRecord) store.archiveMatch(room.matchRecord);
      store.remove(code);
      result.rooms++;
    }
    result.entries = db.prepare(`DELETE FROM room_entries WHERE rowid IN
      (SELECT rowid FROM room_entries WHERE unavailable_since>0 AND unavailable_since<? AND note='' ORDER BY unavailable_since LIMIT ?)`)
      .run(now - policy.entryDays * DAY, limit).changes;
    require("./avatar-uploads").cleanup(store, { batchSize: limit, retentionMs: policy.receiptDays * DAY });
    db.prepare("INSERT OR REPLACE INTO maintenance_meta VALUES('last-cleanup',?)").run(JSON.stringify({ at: now, ...result }));
    return result;
  });
}

function startMaintenance(store, { intervalMs = 3600000, logger = console, canCleanup = () => true, ...policy } = {}) {
  let stopped = false, timer;
  const run = () => {
    if (stopped) return;
    try { logger.log(JSON.stringify(canCleanup() ? { event: "maintenance", ...cleanup(store, policy) } : { event: "maintenance-skipped", reason: "no-recent-verified-backup" })); }
    catch (error) { logger.error(JSON.stringify({ event: "maintenance-failed", error: error.message })); }
    timer = setTimeout(run, intervalMs); timer.unref?.();
  };
  timer = setTimeout(run, 60000); timer.unref?.();
  return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { initialize, cleanup, startMaintenance, defaults, DAY, ROOM_IDLE_DAYS, roomActivityCutoff };
