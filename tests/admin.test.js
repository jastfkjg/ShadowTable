"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app");
const { Companion } = require("../server/dev-panel/panel");
const key = "test-admin-key-" + "a".repeat(40);
const origin = "https://admin.example.com";
async function setup(t, opts = {}) {
  const app = createApp({
    database: ":memory:",
    adminOrigin: origin,
    adminKey: key,
    exchangeCode: async (code) => code,
    ...opts,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
  });
  let cookie = "";
  async function raw(path, data, extra = {}) {
    const r = await new Promise((resolve, reject) => {
      const request = require("node:http").request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: "admin.example.com",
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            ...extra,
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              ok: response.statusCode < 400,
              headers: {
                get(name) {
                  const value = response.headers[name];
                  return Array.isArray(value) ? value[0] : value;
                },
              },
              json: async () => JSON.parse(text),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(data ? JSON.stringify(data) : undefined);
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  async function api(path, data, extra) {
    const r = await raw(path, data, extra);
    const b = await r.json();
    if (!r.ok) throw Object.assign(new Error(b.error), { status: r.status });
    return b;
  }
  const login = () => api("/api/admin/login", { key });
  const player = async (name) =>
    (await api("/api/login", { code: name })).token;
  const auth = (token) => ({ Authorization: "Bearer " + token });
  const room = async () => {
    const token = await player(randomUUID());
    const { code } = await api("/api/rooms", { name: "真人" }, auth(token));
    return { code, token };
  };
  const action = (code, type, extra = {}) =>
    api("/api/admin/rooms/" + code, {
      action: type,
      stage: app.store.get(code)?.stage,
      ...(["test-on", "clear-testers"].includes(type) ? {} : { confirm: true }),
      reason: "验证管理操作",
      ...extra,
    });
  return { app, raw, api, login, player, auth, room, action };
}
test("管理平台默认关闭，生产配置要求 HTTPS 和长密钥", async (t) => {
  const a = await setup(t, { adminKey: "" });
  assert.equal((await a.raw("/admin")).status, 404);
  assert.throws(
    () =>
      createApp({
        database: ":memory:",
        adminOrigin: origin,
        adminKey: "short",
      }),
    /至少32/,
  );
});
test("管理员认证、来源校验、安全 Cookie、退出失效；玩家令牌不能访问管理接口", async (t) => {
  const a = await setup(t);
  assert.equal((await a.raw("/admin")).status, 200);
  assert.equal((await a.raw("/api/admin/rooms")).status, 401);
  assert.equal(
    (
      await a.raw(
        "/api/admin/login",
        { key },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal((await a.raw("/api/admin/login", { key: "wrong" })).status, 401);
  const r = await a.raw("/api/admin/login", { key });
  assert.match(
    r.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict.*Secure/,
  );
  assert.equal((await a.raw("/api/admin/rooms")).status, 200);
  assert.equal(
    (await a.raw("/api/admin/rooms", undefined, { Host: "evil.example" }))
      .status,
    403,
  );
  assert.equal((await a.raw("/admin/companion")).status, 200);
  assert.equal(
    (await a.raw("/api/admin/logout", {}, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  await a.api("/api/admin/logout", {});
  assert.equal((await a.raw("/api/admin/rooms")).status, 401);
  const token = await a.player("human");
  assert.equal(
    (await a.raw("/api/admin/rooms", undefined, a.auth(token))).status,
    401,
  );
});
test("现有房间开启陪测，绑定房间与管理员，关闭/退出阻止继续使用", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code, token } = await a.room();
  const other = await a.room();
  await assert.rejects(
    a.api("/api/admin/actors", { code }),
    (e) => e.status === 403,
  );
  await a.action(code, "test-on");
  assert.equal(
    (await a.api("/api/rooms/" + code, undefined, a.auth(token))).testRoom,
    true,
  );
  const request = (path, actorToken, data, id) =>
    a.api(path === "/api/dev-login" ? "/api/admin/actors" : path, data, {
      ...a.auth(actorToken),
      ...(id ? { "Idempotency-Key": id } : {}),
    });
  const c = new Companion({ request });
  await c.add(code);
  await c.fill();
  assert.equal(c.actors.length, 5);
  await c.batch("ready");
  assert.equal(
    (await a.api("/api/rooms/" + code, undefined, a.auth(token))).me.ready,
    false,
  );
  const bot = c.actors[0].token;
  await assert.rejects(
    a.api(
      "/api/rooms/" + other.code + "/join",
      { name: "跨房间" },
      a.auth(bot),
    ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    a.api("/api/rooms", { name: "新房" }, a.auth(bot)),
    (e) => e.status === 403,
  );
  await assert.rejects(
    a.api("/api/rooms/" + code, undefined, { ...a.auth(bot), Cookie: "" }),
    (e) => e.status === 401,
  );
  await assert.rejects(a.action(code, "test-off"), (e) => e.status === 409);
  const hostCommand = (type, extra = {}) =>
    a.api(
      "/api/rooms/" + code + "/commands",
      { type, stage: a.app.store.get(code).stage, ...extra },
      a.auth(token),
    );
  await hostCommand("ready", { ready: true });
  await hostCommand("start");
  await c.refresh();
  assert.ok(c.actors.every((actor) => actor.secret));
  await c.batch("confirm");
  assert.equal(
    (await a.api("/api/rooms/" + code, undefined, a.auth(token))).me.submitted,
    false,
  );
  await assert.rejects(
    a.api("/api/admin/actors", { code }),
    (e) => e.status === 403,
  );
  await a.api("/api/admin/logout", {});
  await assert.rejects(
    a.api("/api/rooms/" + code, undefined, a.auth(bot)),
    (e) => e.status === 401,
  );
  await a.login();
  await assert.rejects(
    a.api("/api/rooms/" + code, undefined, a.auth(bot)),
    (e) => e.status === 403,
  );
  await assert.rejects(
    a.action(code, "clear-testers"),
    (e) => e.status === 409,
  );
  await a.action(code, "terminate");
  await a.action(code, "rematch");
  await a.action(code, "clear-testers");
  await a.action(code, "test-off");
  assert.equal(a.app.store.get(code).players.length, 1);
  assert.equal(a.app.store.get(code).players[0].uid.startsWith("wx:"), true);
});
test("在线陪测能读取完整个人数据和榜单，仍绑定管理会话与测试房间", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code, token } = await a.room();
  await a.action(code, "test-on");
  const panel = new Companion({ request: (path, actorToken, data, id) =>
    a.api(path === "/api/dev-login" ? "/api/admin/actors" : path, data,
      { ...a.auth(actorToken), ...(id ? { "Idempotency-Key": id } : {}) }) });
  await panel.add(code);await panel.fill();
  const hostCommand = (type, extra = {}) => a.api("/api/rooms/" + code + "/commands",
    {type, stage:a.app.store.get(code).stage, ...extra}, a.auth(token));
  await hostCommand("updateSettings", {board:"classic",capacity:6,visible:false,scoreEnabled:true});
  await panel.refresh();await panel.batch("ready");await hostCommand("ready",{ready:true});
  await hostCommand("start",{flexible:true});
  const room=a.app.store.get(code);
  room.roles=Object.fromEntries(room.players.map((p,i)=>[p.uid,["morgana","merlin","percival","servant","servant","assassin"][i]]));
  room.fun.initialRoles={...room.roles};a.app.store.save(room);
  const body={type:"finishTools",stage:room.stage,scoreReason:"assassination",scoreTarget:4},id=randomUUID();
  for(let i=0;i<2;i++) await a.api("/api/rooms/"+code+"/commands",body,{...a.auth(token),"Idempotency-Key":id});
  for(const [i,actor] of panel.actors.entries()) {
    const auth=a.auth(actor.token),uid=room.players[i+1].uid;
    const profile=await a.api("/api/me/profile",undefined,auth);
    assert.equal(profile.identityType,"test");assert.equal(profile.leaderboardVisible,true);
    await a.api("/api/me/profile",{nickname:actor.name,version:profile.version},auth);
    const stats=await a.api("/api/me/stats",undefined,auth);
    const matches=await a.api("/api/me/matches?scored=1",undefined,auth);
    assert.equal(stats.total,1);assert.equal(stats.score.games,1);
    assert.ok(stats.byRole.length);assert.ok(stats.byFaction.length);assert.ok(stats.byBoard.length);
    assert.equal(matches.total,1);assert.equal(matches.records[0].fun.status,"recorded");
    assert.equal(matches.records[0].score.status,"scored");
    assert.deepEqual(stats,JSON.parse(JSON.stringify(a.app.store.statsFor(uid))));
    for(const metric of ["points","games","overall"]) {
      const board=await a.api("/api/leaderboard?metric="+metric+"&nearby=1",undefined,auth);
      assert.equal(board.me.status,"unsupported");assert.equal(board.me.rank,null);
      assert.equal(board.me.total,stats.total);assert.ok(board.rows.every(row=>!row.isSelf));
      assert.equal(board.eligibleCount,1);assert.deepEqual(board.nearby,[]);
    }
    for(const metric of stats.fun.metrics.filter(row=>row.ranked&&row.count>0)) {
      const board=await a.api("/api/leaderboard?metric=fun_"+metric.id+"&nearby=1",undefined,auth);
      assert.equal(board.me.status,"unsupported");assert.equal(board.me.count,metric.count);
      assert.equal(board.me.rank,null);assert.ok(board.rows.every(row=>!row.isSelf));
      assert.deepEqual(board.nearby,[]);
      const filtered=await a.api("/api/me/matches?fun="+metric.id+"&mode="+metric.mode,undefined,auth);
      assert.equal(filtered.total,1);assert.ok(filtered.records[0].fun.highlights.length);
    }
    assert.equal((await a.api("/api/me/rooms",undefined,auth)).rooms.length,1);
    assert.equal((await a.api("/api/me/score-adjustments",undefined,auth)).total,0);
    assert.doesNotMatch(JSON.stringify({stats,matches}),/test:|wx:|"uid"/);
  }
  const bot=panel.actors[0],auth=a.auth(bot.token);
  await a.api("/api/me/leaderboard-visibility",{leaderboardVisible:false},auth);
  assert.equal((await a.api("/api/me/profile",undefined,auth)).leaderboardVisible,false);
  assert.equal((await a.api("/api/leaderboard",undefined,auth)).me.status,"unsupported");
  await a.api("/api/me/leaderboard-visibility",{leaderboardVisible:true},auth);
  assert.equal((await a.api("/api/me/profile",undefined,auth)).leaderboardVisible,true);
  assert.equal((await a.api("/api/leaderboard",undefined,auth)).me.status,"unsupported");
  await hostCommand("rematch");
  assert.equal((await a.api("/api/me/matches",undefined,auth)).total,1);
  const other=await a.room();
  await assert.rejects(a.api("/api/rooms/"+other.code,undefined,auth),e=>e.status===403);
  await assert.rejects(a.api("/api/rooms",{name:"越界创建"},auth),e=>e.status===403);
  await assert.rejects(a.api("/api/me/stats",undefined,{...auth,Cookie:""}),e=>e.status===401);
  await a.api("/api/admin/logout",{});await a.login();
  await assert.rejects(a.api("/api/me/stats",undefined,auth),e=>e.status===403);
  await a.action(code,"clear-testers");
  assert.equal(a.app.store.matchesFor(room.players[1].uid).total,1);
  assert.equal(a.app.store.statsFor(room.players[1].uid).fun.metrics.find(row=>row.id==="merlin_evade").count,1);
  await assert.rejects(a.api("/api/me/matches",undefined,auth),e=>e.status===401);
});
test("管理写操作原因选填，保留状态冲突检查与概览身份隔离", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code } = await a.room();
  await assert.rejects(
    a.action(code, "delete", { confirm: "wrong" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    a.action(code, "delete", { reason: "x".repeat(201) }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    a.action(code, "delete", { stage: "old" }),
    (e) => e.status === 409,
  );
  const room = a.app.store.get(code);
  room.phase = "identity";
  room.roles = { [room.host]: "SECRET_ROLE" };
  room.submissions = { [room.host]: "SECRET_VOTE" };
  a.app.store.save(room);
  await assert.rejects(a.action(code, "test-on"), (e) => e.status === 409);
  const list = await a.api("/api/admin/rooms");
  assert.doesNotMatch(JSON.stringify(list), /SECRET|wx:|token|openid/);
  await a.action(code, "terminate", { reason: "" });
  assert.equal(a.app.store.get(code).phase, "terminated");
  await a.action(code, "rematch", { reason: undefined });
  assert.equal(a.app.store.get(code).phase, "lobby");
  await a.action(code, "delete");
  assert.equal(a.app.store.get(code), null);
  const audit = await a.api("/api/admin/audit");
  assert.ok(
    audit.entries.some((e) => e.action === "delete" && e.code === code),
  );
  assert.ok(audit.entries.some((e) => e.action === "terminate"));
});
test("管理登录暴力尝试限流", async (t) => {
  const a = await setup(t);
  for (let i = 0; i < 10; i++)
    assert.equal((await a.raw("/api/admin/login", { key: "bad" })).status, 401);
  assert.equal((await a.raw("/api/admin/login", { key })).status, 429);
});

test("生产可用管理平台，开发入口仍关闭", async (t) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let a;
  try {
    assert.throws(
      () =>
        createApp({
          database: ":memory:",
          adminOrigin: "http://127.0.0.1",
          adminKey: key,
        }),
      /HTTPS/,
    );
    a = await setup(t, { devAuth: true, devPanel: true });
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
  await a.login();
  assert.equal((await a.raw("/admin/companion")).status, 200);
  assert.equal((await a.raw("/dev")).status, 404);
  assert.equal((await a.raw("/api/dev-login", {})).status, 404);
});

test("操作记录按房间分页，保存玩家操作快照，重试不重复记账", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code, token } = await a.room();
  const other = await a.room();
  await a.action(code, "test-on", { reason: " " });
  const actor = await a.api("/api/admin/actors", { code });
  await a.api(
    `/api/rooms/${code}/join`,
    { name: "陪测甲" },
    a.auth(actor.token),
  );
  const room = a.app.store.get(code);
  room.phase = "teamVote";
  room.stage = randomUUID();
  room.submissions = {};
  room.game = 2;
  room.round = 3;
  a.app.store.save(room);
  const request = {
    type: "submit",
    stage: room.stage,
    value: "reject",
    token: "DO_NOT_LOG",
  };
  const headers = { ...a.auth(token), "Idempotency-Key": randomUUID() };
  await a.api(`/api/rooms/${code}/commands`, request, headers);
  await a.api(`/api/rooms/${code}/commands`, request, headers);
  await a.api(
    `/api/rooms/${code}/commands`,
    { type: "submit", stage: room.stage, value: "approve" },
    a.auth(actor.token),
  );
  await assert.rejects(
    a.api(`/api/rooms/${code}/commands`, request, a.auth(token)),
  );
  const audit = await a.api(`/api/admin/audit?code=${code}`);
  assert.ok(audit.entries.every((entry) => entry.code === code));
  assert.ok(audit.rooms.includes(other.code));
  const grouped = await a.api(`/api/admin/audit?grouped=1&code=${code}`);
  assert.equal(grouped.pageSize, 20);
  assert.equal(grouped.groups[0].entries.length, 2);
  assert.equal(grouped.groups[0].active, true);
  const votes = audit.entries.filter(
    (entry) => entry.details.command === "submit",
  );
  assert.equal(votes.length, 2);
  assert.equal(votes[0].action, "companion");
  assert.equal(votes[0].details.player.name, "陪测甲");
  assert.equal(votes[1].details.player.name, "真人");
  assert.equal(votes[1].details.player.seat, 1);
  assert.equal(votes[1].details.choice, "反对");
  assert.equal(votes[1].details.game, 2);
  assert.equal(votes[1].details.round, 3);
  assert.doesNotMatch(JSON.stringify(audit), /DO_NOT_LOG|wx:|test:/);
  const next = await a.api(`/api/admin/audit?code=${code}&offset=1`);
  assert.equal(next.entries[0].id, audit.entries[1].id);
  const platform = await a.api("/api/admin/audit?code=");
  assert.ok(platform.entries.every((entry) => entry.code === ""));
  await a.action(code, "delete", { reason: undefined });
  assert.ok(
    (await a.api(`/api/admin/audit?code=${code}`)).entries.some(
      (entry) => entry.details.choice === "反对",
    ),
  );
});

test("操作记录只列出现有房间，创建陪测账号不计入明细和分组分页", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code } = await a.room();
  const other = await a.room();
  await a.action(code, "test-on");
  const insert = a.app.store.db.prepare(
    "INSERT INTO admin_audit(action,code,reason,created) VALUES(?,?,'',1)",
  );
  for (let i = 0; i < 25; i++) insert.run("actor", code);
  // A room without audit history must still be selectable.
  a.app.store.db
    .prepare("DELETE FROM admin_audit WHERE code=?")
    .run(other.code);
  const flat = await a.api(`/api/admin/audit?code=${code}`);
  assert.ok(flat.entries.length > 0);
  assert.ok(flat.entries.every((entry) => entry.action !== "actor"));
  assert.equal(flat.total, flat.entries.length);
  assert.ok(flat.rooms.includes(other.code));
  const grouped = await a.api(`/api/admin/audit?grouped=1&code=${code}`);
  assert.ok(
    grouped.groups.every((group) =>
      group.entries.every((entry) => entry.action !== "actor"),
    ),
  );
  assert.equal(grouped.total, grouped.groups.length);
  const next = await a.api(`/api/admin/audit?grouped=1&code=${code}&offset=20`);
  assert.deepEqual(next.groups, []);
  await a.action(code, "delete");
  const remaining = await a.api("/api/admin/audit?grouped=1");
  assert.ok(!remaining.rooms.includes(code));
  assert.ok(remaining.rooms.includes(other.code));
  assert.ok(
    remaining.groups.every((group) =>
      group.entries.every((entry) => entry.action !== "actor"),
    ),
  );
});

test("陪测开启与清理无需确认；终止、重开、删除和关闭陪测必须明确确认", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code } = await a.room();
  await a.action(code, "test-on");
  assert.equal(a.app.store.get(code).testRoom, true);
  await a.action(code, "clear-testers");
  for (const action of ["terminate", "rematch", "delete", "test-off"]) {
    const before = a.app.store.get(code);
    for (const confirm of [undefined, false, "true"])
      await assert.rejects(a.action(code, action, { confirm }), e => e.status === 400);
    assert.deepEqual(a.app.store.get(code), before);
  }
  // Cached older admin clients remain compatible during a rolling update.
  await a.action(code, "test-off", { confirm: code });
  assert.equal(a.app.store.get(code).testRoom, false);
  await a.action(code, "delete", { confirm: true });
  assert.equal(a.app.store.get(code), null);
});

test('管理员更正计分结果鉴权、幂等和版本校验，并保留整局更正记录',async t=>{
  const a=await setup(t),{newRoom,enter,command}=require('../server/engine');
  const room=newRoom('123456','wx:score-1','房主','classic',6);
  for(let i=2;i<=6;i++)enter(room,'wx:score-'+i,'玩家'+i);
  command(room,room.host,{type:'updateSettings',stage:room.stage,board:room.board,capacity:room.capacity,visible:false,scoreEnabled:true});
  room.players.forEach(p=>p.ready=true);
  command(room,room.host,{type:'start',stage:room.stage,flexible:true});
  room.roles=Object.fromEntries(room.players.map((p,i)=>[p.uid,['merlin','percival','servant','servant','morgana','assassin'][i]]));
  command(room,room.host,{type:'finishTools',stage:room.stage,scoreReason:'assassination',scoreTarget:3});
  a.app.store.transaction(()=>a.app.store.save(room));
  assert.equal((await a.raw('/api/admin/matches?code=123456')).status,401);
  await a.login();
  const records=await a.api('/api/admin/matches?code=123456');assert.equal(records.matches.length,1);assert.doesNotMatch(JSON.stringify(records),/"uid"|roleId/);
  const path='/api/admin/matches/'+room.matchId+'/correct',body={requestId:randomUUID(),revision:0,scoreReason:'quest_fail'};
  const first=await a.api(path,body);assert.equal(first.winner,'evil');
  assert.deepEqual(await a.api(path,body),first);
  assert.equal(a.app.store.statsFor('wx:score-3').score.total,0);assert.equal(a.app.store.statsFor('wx:score-3').wins,0);
  assert.equal(a.app.store.db.prepare("SELECT count(*) AS n FROM admin_audit WHERE action='correct-result'").get().n,1);
  assert.equal((await a.raw(path,{...body,requestId:randomUUID()})).status,409);
  assert.equal((await a.raw(path,{...body,requestId:randomUUID(),revision:1,reason:{}})).status,400);
  assert.equal(a.app.store.db.prepare("SELECT reason FROM admin_audit WHERE action='correct-result'").get().reason,'');
});

test("自动结算与行动审计同事务提交，重试只记录一次且秘密结果仅管理员可读", async (t) => {
  const a = await setup(t);
  await a.login();
  const { code, token } = await a.room();
  const { enter, command } = require("../server/engine");
  const room = a.app.store.get(code);
  const host = room.host;
  for (let seat = 2; seat <= room.capacity; seat++)
    enter(room, `review:${seat}`, `队员${seat}`);
  for (const player of room.players)
    command(room, player.uid, {
      type: "ready",
      ready: true,
      stage: room.stage,
    });
  command(room, host, { type: "start", flexible: true, stage: room.stage });
  room.roles[host] = "servant";
  a.app.store.save(room);
  await a.api(
    `/api/rooms/${code}/commands`,
    {
      type: "beginActivity",
      stage: room.stage,
      kind: "quest",
      team: [1],
      threshold: 1,
    },
    a.auth(token),
  );
  const stage = a.app.store.get(code).stage;
  const input = {
    type: "submit",
    stage,
    value: "success",
    secret: "DO_NOT_LOG",
  };
  const headers = { ...a.auth(token), "Idempotency-Key": randomUUID() };
  await a.api(`/api/rooms/${code}/commands`, input, headers);
  await a.api(`/api/rooms/${code}/commands`, input, headers);
  const result = await a.api(`/api/admin/audit?grouped=1&code=${code}`);
  const group = result.groups.find((group) =>
    group.entries.some((entry) => entry.details.phaseKey === "quest"),
  );
  assert.equal(group.entries.length, 2);
  assert.equal(group.active, false);
  const outcome = group.entries.flatMap(
    (entry) => entry.details.outcomes || [],
  );
  assert.equal(outcome.length, 1);
  assert.equal(outcome[0].text, "任务成功");
  assert.equal(outcome[0].counts.success, 1);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_LOG|review:/);
  const publicData = await a.api(
    `/api/rooms/${code}`,
    undefined,
    a.auth(token),
  );
  assert.doesNotMatch(
    JSON.stringify(publicData),
    /outcomes|participants|auditVersion/,
  );
  assert.equal(
    (
      await a.raw(`/api/admin/audit?grouped=1&code=${code}`, undefined, {
        Cookie: "",
        ...a.auth(token),
      })
    ).status,
    401,
  );
});
