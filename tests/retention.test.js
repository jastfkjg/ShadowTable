const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, statSync, writeFileSync, readdirSync, copyFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../server/store");
const { newRoom, enter, command } = require("../server/engine");
const { cleanup, startMaintenance, DAY } = require("../server/retention");
const { createBackup, verifyBackup, retainedSnapshots, backupInWorker, startBackups } = require("../server/backup");
const run = (room, type, extra = {}) => command(room, room.host, { type, stage: room.stage, ...extra });
function endedRoom() {
  const room = newRoom("111111", "wx:host", "房主");
  for (let i = 2; i <= 6; i++) enter(room, "wx:p" + i, "玩家" + i);
  room.players.forEach(p => p.ready = true); room.scoreEnabled = true;
  run(room, "start", { flexible: true });
  run(room, "finishTools", { scoreReason: "assassination", scoreTarget: 0 });
  return room;
}
test("缺少近期已验证备份时停止自动清理，恢复后继续分批执行", t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now=Date.now(), ready=false;const store=new Store(':memory:',{clock:()=>now}), logs=[];
  store.addSession('old','user');now+=31*DAY;
  const stop=startMaintenance(store,{intervalMs:2000,canCleanup:()=>ready,logger:{log:value=>logs.push(JSON.parse(value)),error:assert.fail}});
  try {
    t.mock.timers.tick(60000);assert.equal(logs[0].event,'maintenance-skipped');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
    ready=true;t.mock.timers.tick(2000);assert.equal(logs[1].sessions,1);
  } finally {stop();store.close();}
});
test("清理仅删除过期临时数据，归档、积分、趣味记录和进行中牌桌保留", () => {
  let now = Date.now(); const store = new Store(":memory:", { clock: () => now });
  try {
    const ended = endedRoom(); store.save(ended);
    const active = newRoom("222222", "wx:host", "房主"); active.phase = "tools"; store.save(active);
    const stats = store.statsFor("wx:host"), matches = store.matchesFor("wx:host");
    store.addSession("expired", "wx:host");
    store.addReceipt("wx:host", "legacy-request-001", "fingerprint", { accepted: true });
    now += 91 * DAY;
    store.addSession("fresh", "wx:host");
    const result = cleanup(store);
    assert.equal(result.rooms, 1); assert.equal(result.sessions, 1); assert.equal(result.receipts, 1);
    assert.equal(store.get(ended.code), null); assert.equal(store.get(active.code).phase, "tools");
    assert.ok(store.session("fresh")); assert.equal(store.session("expired"), undefined);
    assert.deepEqual(store.statsFor("wx:host"), stats); assert.deepEqual(store.matchesFor("wx:host"), matches);
    assert.throws(() => store.receipt("wx:host", "legacy-request-001"), e => e.status === 410);
  } finally { store.close(); }
});
test("准备房间有72小时宽限，访问/重开取消过期，失效条目90天后清理且备注保留", () => {
  let now = Date.now(); const store = new Store(":memory:", { clock: () => now });
  try {
    for (const code of ["111111", "222222", "333333"]) store.save(newRoom(code, "host", "房主"));
    store.db.prepare("UPDATE room_entries SET note='周五朋友局' WHERE code='333333'").run();
    now += 8 * DAY; assert.equal(cleanup(store).candidates, 3);
    now += 2 * DAY; assert.equal(cleanup(store).rooms, 0);
    store.touchRoom("111111"); now += DAY;
    assert.equal(cleanup(store).rooms, 2); assert.ok(store.get("111111"));
    assert.equal(store.personalRooms("host").find(r => r.code === "222222").available, false);
    const active = store.get("111111"); active.phase = "tools"; store.save(active);
    now += 91 * DAY; assert.equal(cleanup(store).entries, 1);
    assert.ok(store.entry("host", "333333")); assert.ok(store.entry("host", "111111"));
    assert.equal(store.entry("host", "222222"), undefined);
  } finally { store.close(); }
});
test("清理分批且可重复，回执标记与删除同事务回滚，旧编号跨重启仍拒绝重放", () => {
  let now = Date.now(); const dir = mkdtempSync(join(tmpdir(), "shadow-retention-")), file = join(dir, "store.sqlite");
  let store = new Store(file, { clock: () => now });
  try {
    for (let n = 0; n < 5; n++) store.addReceipt("user", "request-number-" + n, "fp", { n });
    now += 91 * DAY;
    store.db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.throws(() => cleanup(store), /test failure/);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM receipt_tombstones").get().n, 0);
    store.db.exec("DROP TRIGGER fail_cleanup");
    assert.equal(cleanup(store, { batchSize: 2 }).receipts, 2);
    assert.equal(cleanup(store, { batchSize: 2 }).receipts, 2);
    assert.equal(cleanup(store, { batchSize: 2 }).receipts, 1);
    assert.equal(cleanup(store, { batchSize: 2 }).receipts, 0);
    store.close(); store = new Store(file, { clock: () => now });
    assert.throws(() => store.receipt("user", "request-number-0"), e => e.status === 410);
    assert.equal(store.receipt("other", "request-number-0"), undefined);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("新编号拒绝30天前未执行请求与未来时间，已有成功回执仍可核对", () => {
  let now = Date.now(); const store = new Store(":memory:", { clock: () => now });
  try {
    const old = "v1_" + now.toString(36) + "_unique_request";
    store.addReceipt("cached", old, "fp", { accepted: true });
    now += 31 * DAY;
    assert.throws(() => store.receipt("new", old), e => e.status === 410);
    assert.ok(store.receipt("cached", old));
    assert.throws(() => store.receipt("new", "v1_" + (now + DAY).toString(36) + "_unique_request"), e => e.status === 410);
    assert.equal(store.receipt("new", "v1_" + now.toString(36) + "_unique_request"), undefined);
  } finally { store.close(); }
});
test("个人列表使用已有索引，不再扫描所有房间；离开/重新加入维护失效时间", () => {
  const store = new Store(":memory:");
  try {
    const room = newRoom("111111", "host", "房主"); enter(room, "guest", "访客"); store.save(room);
    store.roomsFor = () => { throw Error("unexpected full scan"); };
    assert.equal(store.personalRooms("guest").length, 1);
    room.players = room.players.filter(p => p.uid !== "guest"); store.save(room);
    assert.ok(store.entry("guest", room.code).unavailable_since);
    enter(room, "guest", "回来"); store.save(room);
    assert.equal(store.entry("guest", room.code).unavailable_since, 0);
  } finally { store.close(); }
});
test("WAL在线快照完整可恢复，保留会话、归档、资料、回执；不覆写已有备份", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-backup-")), file = join(dir, "live.sqlite"), destination = join(dir, "backups");
  const store = new Store(file); let restored;
  try {
    store.save(endedRoom()); store.addSession("session", "wx:host"); store.addReceipt("wx:host", "test-request-number", "fp", { accepted: true });
    const result = await backupInWorker(file, destination);
    assert.equal(result.counts.matches, 1); assert.equal(statSync(result.file).mode & 0o777, 0o600);
    assert.deepEqual(verifyBackup(result.file), result.counts);
    const restoredFile = join(dir, "restored.sqlite"); copyFileSync(result.file, restoredFile);
    restored = new Store(restoredFile);
    assert.deepEqual(restored.statsFor("wx:host"), store.statsFor("wx:host"));
    assert.ok(restored.session("session")); assert.ok(restored.receipt("wx:host", "test-request-number"));
    await assert.rejects(createBackup(file, destination, result.at), /已存在/);
    assert.ok(verifyBackup(result.file));
    const service = startBackups(store, { database: file, directory: destination });
    assert.equal(service.hasRecentBackup(), false);
    store.db.prepare("INSERT OR REPLACE INTO maintenance_meta VALUES('last-backup',?)").run(JSON.stringify(result));
    assert.equal(service.hasRecentBackup(), true); await service.stop();
  } finally { restored?.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("快照分日/周/月保留，外来文件与冲突临时文件不被删除", async () => {
  const now = Date.UTC(2026, 9, 2, 3), name = time => "shadowtable-" + new Date(time).toISOString().replace(/[:.]/g, "-") + ".sqlite";
  const names = Array.from({ length: 120 }, (_, n) => name(now - n * DAY));
  const keep = retainedSnapshots(names, now);
  for (let n = 0; n < 7; n++) assert.ok(keep.has(names[n]));
  assert.ok(keep.size <= 14); assert.equal(keep.has(names.at(-1)), false);
  const dir = mkdtempSync(join(tmpdir(), "shadow-backup-collision-")), source = join(dir, "live.sqlite"), store = new Store(source);
  try {
    const output = join(dir, name(now)), tmp = output + "." + process.pid + ".tmp";
    writeFileSync(tmp, "do not remove"); writeFileSync(join(dir, "unrelated.sqlite"), "keep");
    await assert.rejects(createBackup(source, dir, now), /EEXIST/);
    assert.ok(readdirSync(dir).includes(tmp.split("/").at(-1)));
    await createBackup(source, dir, now + 1);
    assert.ok(readdirSync(dir).includes("unrelated.sqlite"));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
