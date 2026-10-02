"use strict";
const { DatabaseSync, backup } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { DAY } = require("./retention");
const filename = /^shadowtable-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)\.sqlite$/;
const timestamp = name => Date.parse(name.match(filename)[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, "T$1:$2:$3.$4Z"));

function verifyBackup(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const checks = db.prepare("PRAGMA integrity_check").all();
    if (checks.length !== 1 || Object.values(checks[0])[0] !== "ok") throw new Error("备份完整性校验失败");
    const tables = ["rooms", "profiles", "matches", "match_players", "match_scores", "match_events", "match_fun_stats", "score_adjustments", "receipts", "sessions"];
    return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  } finally { db.close(); }
}

// Keep newest snapshots for seven calendar days, four ISO weeks and three calendar months (UTC).
function retainedSnapshots(names, now) {
  const selected = new Set(), days = new Set(), weeks = new Set(), months = new Set();
  const sorted = names.filter(n => filename.test(n)).sort((a, b) => timestamp(b) - timestamp(a));
  for (const name of sorted) {
    const time = timestamp(name), d = new Date(time), day = d.toISOString().slice(0, 10);
    const week = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 4 * DAY) / (7 * DAY));
    const month = d.getUTCFullYear() * 12 + d.getUTCMonth(), current = new Date(now);
    const currentMonth = current.getUTCFullYear() * 12 + current.getUTCMonth();
    if (time >= now || (now - time < 7 * DAY && !days.has(day)) || (now - time < 28 * DAY && !weeks.has(week)) || (month >= currentMonth - 2 && !months.has(month))) selected.add(name);
    days.add(day); weeks.add(week); months.add(month);
  }
  if (sorted[0]) selected.add(sorted[0]);
  return selected;
}

async function createBackup(database, directory, now = Date.now()) {
  if (!fs.statSync(database).isFile()) throw new Error("备份源不存在");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, "shadowtable-" + new Date(now).toISOString().replace(/[:.]/g, "-") + ".sqlite");
  const temporary = destination + "." + process.pid + ".tmp";
  const db = new DatabaseSync(database, { readOnly: true });
  let ownsTemporary = false;
  try {
    if (fs.existsSync(destination)) throw new Error("备份文件已存在");
    fs.closeSync(fs.openSync(temporary, "wx", 0o600)); ownsTemporary = true;
    // Node >=22.16 supports incremental online backup; older supported runtimes use VACUUM INTO in this worker.
    if (typeof backup === "function") await backup(db, temporary, { rate: 100 });
    else db.exec("VACUUM INTO '" + temporary.replace(/'/g, "''") + "'");
    fs.chmodSync(temporary, 0o600);
    const counts = verifyBackup(temporary);
    const fd = fs.openSync(temporary, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, destination);
    const keep = retainedSnapshots(fs.readdirSync(directory), now);
    for (const name of fs.readdirSync(directory)) if (filename.test(name) && !keep.has(name)) fs.rmSync(path.join(directory, name), { force: true });
    return { file: destination, at: now, counts };
  } finally { db.close(); if (ownsTemporary) fs.rmSync(temporary, { force: true }); }
}

function backupInWorker(database, directory) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { database, directory } });
    let result;
    worker.on("message", message => { result = message; });
    worker.on("error", reject);
    worker.on("exit", code => code === 0 && result ? resolve(result) : reject(new Error("备份工作线程失败")));
  });
}

function startBackups(store, { database, directory, logger = console }) {
  let stopped = false, timer, running;
  const last = () => {
    const raw = store.db.prepare("SELECT value FROM maintenance_meta WHERE name='last-backup'").get();
    return raw ? JSON.parse(raw.value) : null;
  };
  const hasRecentBackup = () => { const value = last(); return !!value && value.at <= store.clock() && store.clock() - value.at < 2 * DAY && fs.existsSync(value.file); };
  const run = async () => {
    if (stopped) return;
    try {
      const value = last();
      if (!value || value.at > store.clock() || store.clock() - value.at >= DAY || !fs.existsSync(value.file)) {
        running = backupInWorker(database, directory);
        const result = await running;
        if (!stopped) store.db.prepare("INSERT OR REPLACE INTO maintenance_meta VALUES('last-backup',?)").run(JSON.stringify(result));
        logger.log(JSON.stringify({ event: "backup", ...result }));
      }
    } catch (error) { logger.error(JSON.stringify({ event: "backup-failed", error: error.message })); }
    finally { running = null; if (!stopped) { timer = setTimeout(run, 3600000); timer.unref?.(); } }
  };
  timer = setTimeout(run, 1000); timer.unref?.();
  return { hasRecentBackup, async stop() { stopped = true; clearTimeout(timer); if (running) await running.catch(() => {}); } };
}
if (!isMainThread) createBackup(workerData.database, workerData.directory).then(result => parentPort.postMessage(result)).catch(error => { throw error; });
else if (require.main === module) {
  const [command, source, destination] = process.argv.slice(2);
  if (command === "verify" && source) console.log(JSON.stringify({ ok: true, counts: verifyBackup(source) }));
  else if (command === "create" && source && destination) backupInWorker(path.resolve(source), path.resolve(destination)).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
  else { console.error("用法：node server/backup.js create <数据库> <备份目录> | verify <备份文件>"); process.exitCode = 1; }
}
module.exports = { createBackup, verifyBackup, retainedSnapshots, backupInWorker, startBackups };
