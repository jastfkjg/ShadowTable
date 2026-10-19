const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { createApp } = require("../server/app");
const { newRoom, enter } = require("../server/engine");
const { DAY, cleanup } = require("../server/retention");
const { completed } = require("./helpers/replay-fixtures");

async function launch(options = {}) {
  const app = createApp({ database: ":memory:", devAuth: true, ...options });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  return { ...app,
    async request(path, token, body, id = randomUUID()) {
      const response = await fetch("http://127.0.0.1:" + app.server.address().port + path, {
        method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + (token || ""), "Content-Type": "application/json", "Idempotency-Key": id },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json() };
    },
    async close() { await new Promise(resolve => app.server.close(resolve)); app.store.close(); },
  };
}
async function user(app) {
  const { token } = (await app.request("/api/dev-login", null, {})).data;
  const { code } = (await app.request("/api/rooms", token, { name: "玩家" })).data;
  return { token, uid: app.store.get(code).host };
}
function candidate(room) { return { code: room.code, createdAt: room.createdAt }; }

test("已结束房间满72小时自动从列表隐藏，旧入口不能续期，战绩复盘与个人条目保留", async () => {
  let now = Date.now(); const app = await launch({ clock: () => now });
  try {
    const token = "a".repeat(64), uid = "wx:replay-5", store = app.store;
    store.addSession(createHash("sha256").update(token).digest("hex"), uid);
    const room = completed(); store.save(room);
    const records = store.matchesFor(uid), replay = store.replayFor(uid, room.matchRecord.id), stats = store.statsFor(uid);
    now += 3 * DAY - 1;
    assert.equal((await app.request("/api/me/rooms", token)).data.rooms[0].available, true);
    now++;
    const list = (await app.request("/api/me/rooms", token)).data.rooms;
    assert.deepEqual(list, []);
    assert.equal(store.entry(uid, room.code).hidden, 0, "自动隐藏不删除或改写个人条目");
    assert.equal(store.personalRooms(uid)[0].available, false);
    for (const suffix of ["", "/private", "/management", "/invitation"])
      assert.equal((await app.request("/api/rooms/" + room.code + suffix, token)).status, 410);
    assert.equal((await app.request("/api/rooms/" + room.code + "/join", token, { name: "子龙" })).status, 410);
    assert.equal((await app.request("/api/rooms/" + room.code + "/commands", token, { type: "restart", stage: room.stage })).status, 410);
    assert.equal((await app.request("/api/me/rooms/" + room.code, token, { action: "visit" })).status, 410);
    assert.ok(store.get(room.code), "到期判定不依赖后台物理删除或备份任务");
    assert.deepEqual(store.replayFor(uid, room.matchRecord.id), replay);
    assert.equal(cleanup(store).rooms, 1); assert.equal(store.get(room.code), null);
    assert.deepEqual((await app.request("/api/me/rooms", token)).data.rooms, []);
    assert.deepEqual(store.matchesFor(uid), records); assert.deepEqual(store.statsFor(uid), stats);
    assert.deepEqual((await app.request("/api/me/matches/" + room.matchRecord.id + "/replay", token)).data.replay, replay);
  } finally { await app.close(); }
});

test("批量清理只隐藏本人确认的失效实例，跳过重新加入、房间号复用及他人记录；重试不追加删除", async () => {
  const app = await launch();
  try {
    const a = await user(app), b = await user(app), store = app.store;
    const expired = newRoom("111111", a.uid, "玩家"); enter(expired, b.uid, "同桌"); store.save(expired); store.remove(expired.code);
    store.db.prepare("UPDATE room_entries SET note='朋友牌桌' WHERE uid=? AND code=?").run(a.uid, expired.code);
    const rejoined = newRoom("222222", a.uid, "玩家"); store.save(rejoined); store.remove(rejoined.code);
    const reused = newRoom("333333", a.uid, "玩家"); store.save(reused); store.remove(reused.code);
    const other = newRoom("444444", b.uid, "同桌"); store.save(other); store.remove(other.code);
    const valid = newRoom("555555", a.uid, "玩家"); store.save(valid);
    const selected = [expired, rejoined, reused, other, valid].map(candidate);
    store.save(rejoined);
    const replacement = newRoom(reused.code, a.uid, "新房间"); replacement.createdAt = reused.createdAt + 1;
    store.save(replacement); store.remove(replacement.code);
    const before = store.statsFor(a.uid), id = randomUUID();
    const result = await app.request("/api/me/rooms/cleanup", a.token, { rooms: selected }, id);
    assert.equal(result.status, 200); assert.equal(result.data.removed, 1);
    assert.equal(store.entry(a.uid, expired.code).hidden, 1);
    assert.equal(store.entry(a.uid, expired.code).note, "朋友牌桌");
    assert.equal(store.entry(b.uid, expired.code).hidden, 0);
    for (const room of [rejoined, replacement, valid]) assert.equal(store.entry(a.uid, room.code).hidden, 0);
    assert.equal(store.entry(b.uid, other.code).hidden, 0);
    assert.deepEqual(store.statsFor(a.uid), before);
    store.remove(valid.code);
    assert.deepEqual((await app.request("/api/me/rooms/cleanup", a.token, { rooms: selected }, id)).data, result.data);
    assert.equal(store.entry(a.uid, valid.code).hidden, 0);
    assert.equal((await app.request("/api/me/rooms/cleanup", a.token, { rooms: [candidate(valid)] }, id)).status, 409);
  } finally { await app.close(); }
});
test("批量清理鉴权、校验输入且与回执原子提交，失败后可用原编号重试", async () => {
  const app = await launch();
  try {
    const a = await user(app), store = app.store, rooms = ["111111", "222222"].map(code => newRoom(code, a.uid, "玩家"));
    for (const room of rooms) { store.save(room); store.remove(room.code); }
    const body = { rooms: rooms.map(candidate) };
    assert.equal((await app.request("/api/me/rooms/cleanup", null, body)).status, 401);
    for (const invalid of [{}, { rooms: [] }, { rooms: [null] }, { rooms: [{ code: "111111", createdAt: "1" }] }])
      assert.equal((await app.request("/api/me/rooms/cleanup", a.token, invalid)).status, 400);
    store.db.exec("CREATE TRIGGER fail_bulk BEFORE UPDATE OF hidden ON room_entries WHEN NEW.code='222222' BEGIN SELECT RAISE(ABORT,'bulk failure'); END");
    const id = randomUUID();
    assert.equal((await app.request("/api/me/rooms/cleanup", a.token, body, id)).status, 500);
    for (const room of rooms) assert.equal(store.entry(a.uid, room.code).hidden, 0);
    store.db.exec("DROP TRIGGER fail_bulk");
    assert.equal((await app.request("/api/me/rooms/cleanup", a.token, body, id)).data.removed, 2);
  } finally { await app.close(); }
});
test("列表活动时间来自全房主动访问，详情轮询不续期，终止房间归入已结束", async () => {
  let now = Date.now();
  const app = await launch({ clock: () => now });
  try {
    const a = await user(app), b = await user(app), store = app.store;
    const room = newRoom("111111", a.uid, "玩家"); enter(room, b.uid, "同桌"); room.phase = "terminated"; store.save(room);
    const savedAt = now;
    // Emulate an existing summary from before terminated rooms were grouped with ended.
    const row = store.entry(a.uid, room.code), snapshot = JSON.parse(row.snapshot); snapshot.status = "playing";
    store.db.prepare("UPDATE room_entries SET snapshot=? WHERE uid=? AND code=?").run(JSON.stringify(snapshot), a.uid, room.code);
    now += 2 * DAY;
    await app.request("/api/rooms/" + room.code, a.token);
    await app.request("/api/rooms/" + room.code + "/private", a.token);
    let list = (await app.request("/api/me/rooms", a.token)).data;
    assert.equal(list.serverTime, now);
    assert.equal(list.rooms.find(r => r.code === room.code).lastActivityAt, savedAt);
    assert.equal(list.rooms.find(r => r.code === room.code).status, "ended");
    assert.equal((await app.request("/api/me/rooms/" + room.code, b.token, { action: "visit" })).status, 200);
    list = (await app.request("/api/me/rooms", a.token)).data;
    assert.equal(list.rooms.find(r => r.code === room.code).lastActivityAt, now);
    assert.equal(store.get(room.code).updatedAt, savedAt);
  } finally { await app.close(); }
});
