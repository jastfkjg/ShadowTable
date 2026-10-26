const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../server/store");
const { saveProfile } = require("../server/profile");
const shares = require("../server/record-shares");
const { createApp } = require("../server/app");
const NOW = Date.UTC(2026, 9, 26, 10), UID = "wx:share-owner";
function seed(store, id = randomUUID(), options = {}) {
  store.archiveMatch({ id, board: options.board || "classic", boardName: "阿瓦隆 · 经典基础", capacity: 6,
    winner: options.outcome === "loss" ? "evil" : options.outcome === "excluded" ? null : "good", startedAt: NOW - 60000, endedAt: options.endedAt ?? NOW,
    replay: { complete: true, initialPlayers: [], events: [
      { kind: "quest", round: 1, success: true, cards: [{ actor: { uid: "private-player" }, value: "success" }] },
      { kind: "vision", round: 1, information: "PRIVATE-VISION", actor: { uid: UID } },
      { kind: "quest", round: 2, success: false },
    ] },
    players: [{ uid: UID, name: "private-table-alias", role: options.role || "梅林", faction: "good", outcome: options.outcome || "win", seat: 1,
      score: { status: "scored", total: 3, breakdown: [{ label: "PRIVATE-REASON", points: 3 }] } },
    { uid: "wx:another-player", name: "PRIVATE-OTHER-NAME", role: "刺客", faction: "evil", outcome: "loss", seat: 2 }],
  });
  return id;
}
function setup(database = ":memory:") {
  const store = new Store(database, { clock: () => NOW });
  shares.initialize(store);
  saveProfile(store, UID, { nickname: "子龙", version: 0, avatar: "builtin:crayon-07" });
  return store;
}
test("公开分享只保存选定的本人统计投影，相同内容去重，原数据变化不改旧快照", () => {
  const store = setup();
  try {
    seed(store);
    const first = shares.create(store, UID, { kind: "stats" });
    assert.equal(first.data.total, 1); assert.equal(first.data.scoreMonth, 3);
    assert.equal(first.player.name, "子龙"); assert.match(first.player.avatarUrl, /^\/api\/avatars\/[a-f0-9]{64}$/);
    assert.equal(shares.create(store, UID, { kind: "stats" }).id, first.id);
    assert.doesNotMatch(JSON.stringify(first), /private-|PRIVATE-|uid|members|manualAdjustment|identityType|avoidance|leaderboardVisible/);
    seed(store);
    const next = shares.create(store, UID, { kind: "stats" });
    assert.notEqual(next.id, first.id); assert.equal(next.data.total, 2);
    assert.equal(shares.read(store, first.id).data.total, 1);
    assert.throws(() => shares.create(store, UID, { kind: "stats", total: 999 }), /分享参数无效/);
    assert.throws(() => shares.create(store, UID, { kind: ["stats"] }), /分享参数无效/);
  } finally { store.close(); }
});
test("对局概览对完整筛选范围计数，只展示最近五局且不导出成员与内部记录标识",()=>{
  const store=setup();
  try{
    for(let i=0;i<9;i++)seed(store,randomUUID(),{outcome:i<6?'win':i<8?'loss':'excluded',endedAt:NOW-i*86400000});
    const summary=shares.create(store,UID,{kind:'matches'});
    assert.deepEqual([summary.data.total,summary.data.wins,summary.data.losses,summary.data.excluded],[9,6,2,1]);
    assert.equal(summary.data.records.length,5);
    assert.doesNotMatch(JSON.stringify(summary),/PRIVATE-|private-|uid|members|match_id|information|cards|breakdown/);
    const filtered=shares.create(store,UID,{kind:'matches',filters:{period:'7d',matchRole:'梅林',outcome:'win'}});
    assert.equal(filtered.data.total,6);assert.equal(filtered.data.records.length,5);assert.match(filtered.data.scope,/近7天.*梅林.*胜利/);
    const loss=shares.create(store,UID,{kind:'matches',filters:{outcome:'loss'}});
    assert.deepEqual([loss.data.total,loss.data.wins,loss.data.losses],[2,0,2]);
    assert.equal(shares.read(store,summary.id).data.total,9);
    for(const patch of [{filters:{uid:UID}},{filters:{period:['all']}},{scored:'1'},{fun:{metric:['merlin_evade'],mode:'classic'}},{filters:{outcome:'bad'}}])
      assert.throws(()=>shares.create(store,UID,{kind:'matches',...patch}),/筛选无效/);
    assert.throws(()=>shares.create(store,'wx:stranger',{kind:'matches'}),/没有可分享/);
  }finally{store.close();}
});
test("趣味概览保留真实零与未知，筛选有次数时不混入其他项目且拒绝伪造内容",()=>{
  const store=setup();
  try{
    const id=seed(store);
    store.db.prepare("INSERT OR REPLACE INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,UID,'classic','merlin_evade','merlin','梅林',0,2,'known',NOW);
    store.db.prepare("INSERT OR REPLACE INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,UID,'classic','merlin_hit','merlin','梅林',1,2,'known',NOW);
    const all=shares.create(store,UID,{kind:'funSummary',filter:'all'});
    assert.equal(all.data.items.find(row=>row.label==='闪身步大神').count,0);
    assert.ok(all.data.items.some(row=>!row.known&&row.count===null));
    const counted=shares.create(store,UID,{kind:'funSummary',filter:'counted'});
    assert.ok(counted.data.items.length>0);assert.ok(counted.data.items.every(row=>row.count>0));
    assert.doesNotMatch(JSON.stringify(all),/PRIVATE-|private-|uid|members|match_id/);
    assert.throws(()=>shares.create(store,UID,{kind:'funSummary',filter:'unknown'}),/筛选无效/);
    assert.throws(()=>shares.create(store,UID,{kind:'funSummary',items:[]}),/分享参数无效/);
  }finally{store.close();}
});
test("单局分享校验记录归属，仅投影本人身份、公开任务结果和积分数值", () => {
  const store = setup();
  try {
    const id = seed(store), shared = shares.create(store, UID, { kind: "match", match: id });
    assert.equal(shared.data.role, "梅林"); assert.equal(shared.data.score, 3);
    assert.equal(shared.data.questSuccess, 1); assert.equal(shared.data.questTotal, 2);
    assert.deepEqual(shared.data.events.map(row => row.label), ["任务成功", "任务失败"]);
    assert.doesNotMatch(JSON.stringify(shared), /PRIVATE-|private-|uid|members|information|actor|cards|breakdown/);
    assert.throws(() => shares.create(store, "wx:stranger", { kind: "match", match: id }), error => error.status === 404);
    assert.throws(() => shares.create(store, UID, { kind: "match", match: "live-room-code" }), error => error.status === 404);
  } finally { store.close(); }
});
test("月份也保存在快照中，跨月相同的零分数据不会复用上个月的分享", () => {
  const store = setup();
  try {
    seed(store);
    store.db.prepare("UPDATE match_scores SET points=0,snapshot=? WHERE uid=?").run(JSON.stringify({status:"scored",total:0,breakdown:[]}),UID);
    const october = shares.create(store, UID, {kind:"stats"});
    store.clock = () => Date.UTC(2026,10,1);
    const november = shares.create(store, UID, {kind:"stats"});
    assert.equal(october.data.scoreMonth,0);assert.equal(november.data.scoreMonth,0);
    assert.equal(october.data.scorePeriod,"2026.10");assert.equal(november.data.scorePeriod,"2026.11");
    assert.notEqual(october.id,november.id);
  } finally {store.close();}
});
test("趣味分享沿用真实次数和分母，保留零值、忽略未知样本，相关对局不泄露其他成员", () => {
  const store = setup();
  try {
    const id = seed(store);
    const write = (count, opportunities, status) => store.db.prepare("INSERT OR REPLACE INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, UID, "classic", "merlin_evade", "merlin", "梅林", count, opportunities, status, NOW);
    write(0, 2, "known");
    const zero = shares.create(store, UID, { kind: "fun", metric: "merlin_evade", mode: "classic" });
    assert.equal(zero.data.count, 0); assert.equal(zero.data.rate, 0); assert.equal(zero.data.records.length, 0);
    write(2, 3, "known");
    const shared = shares.create(store, UID, { kind: "fun", metric: "merlin_evade", mode: "classic" });
    assert.equal(shared.data.count, 2); assert.equal(shared.data.opportunities, 3); assert.equal(shared.data.rate, 66.7);
    assert.equal(shared.data.records[0].count, 2);
    assert.doesNotMatch(JSON.stringify(shared), /PRIVATE-|private-|uid|members|information|actor/);
    write(0, 0, "unknown");
    assert.throws(() => shares.create(store, UID, { kind: "fun", metric: "merlin_evade", mode: "classic" }), /没有完整记录/);
    assert.equal(shares.read(store, shared.id).data.count, 2);
  } finally { store.close(); }
});
test("分享快照随数据库重启保留，无效令牌不能读取其他资源", () => {
  const directory = mkdtempSync(join(tmpdir(), "shadow-shares-")), database = join(directory, "db.sqlite");
  let store = setup(database);
  try {
    seed(store); const shared = shares.create(store, UID, { kind: "stats" });
    store.close(); store = new Store(database, { clock: () => NOW }); shares.initialize(store);
    assert.deepEqual(shares.read(store, shared.id), shared);
    for (const id of ["../profiles", "0".repeat(48), "invalid", "a".repeat(49)])
      assert.throws(() => shares.read(store, id), error => error.status === 404);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("HTTP 创建要求登录，持有分享链接可匿名读取，普通个人接口仍需登录", async () => {
  const app = createApp({ database: ":memory:", clock: () => NOW, devAuth: true });
  const token = "1".repeat(64);
  app.store.addSession(createHash("sha256").update(token).digest("hex"), UID);
  saveProfile(app.store, UID, { nickname: "子龙", version: 0 });const matchId=seed(app.store);
  app.store.db.prepare("INSERT OR REPLACE INTO match_fun_stats VALUES(?,?,?,?,?,?,?,?,?,?)").run(matchId,UID,'classic','merlin_evade','merlin','梅林',0,1,'known',NOW);
  try {
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    const base = "http://127.0.0.1:" + app.server.address().port;
    const post = (payload, authenticated = true) => fetch(base + "/api/me/shares", { method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(payload) });
    assert.equal((await post({ kind: "stats" }, false)).status, 401);
    const response = await post({ kind: "stats" }); assert.equal(response.status, 200);
    const shared = await response.json(), read = await fetch(base + "/api/shares/" + shared.id);
    assert.equal(read.status, 200); assert.deepEqual(await read.json(), shared);
    assert.equal((await fetch(base + "/api/me/stats")).status, 401);
    assert.equal((await fetch(base + "/api/shares/" + "0".repeat(48))).status, 404);
    assert.equal((await fetch(base + "/api/shares/" + shared.id + "?uid=another")).status, 404);
    assert.equal((await post({ kind: "match", match: "unknown" })).status, 404);
    assert.equal((await post({ kind: "stats", player: "forged" })).status, 400);
    for(const kind of ['matches','funSummary']){
      const created=await post({kind});assert.equal(created.status,200);
      const snapshot=await created.json();assert.equal(snapshot.kind,kind);
      const anonymous=await fetch(base+'/api/shares/'+snapshot.id);
      assert.equal(anonymous.status,200);assert.deepEqual(await anonymous.json(),snapshot);
    }
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
