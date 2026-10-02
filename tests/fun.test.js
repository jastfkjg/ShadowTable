const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  newRoom,
  enter,
  command,
  privateView,
  publicView,
} = require("../server/engine");
const { Store } = require("../server/store");
const { Leaderboard } = require("../server/leaderboard");
const { saveProfile, readProfile } = require("../server/profile");
const { roles } = require("../server/variants");
const { createApp } = require("../server/app");
const run = (r, type, extra = {}, uid = r.host) =>
  command(r, uid, { type, stage: r.stage, ...extra });
function deal(knight = false, uid = "wx:1") {
  const r = newRoom(
    "123456",
    uid,
    "我",
    knight ? "knights" : "classic",
    knight ? 12 : 6,
  );
  for (let i = 2; i <= r.capacity; i++) enter(r, "wx:" + i, "玩家" + i);
  r.players.forEach((p) => (p.ready = true));
  run(r, "start", { flexible: true });
  r.roles = Object.fromEntries(
    r.players.map((p, i) => [
      p.uid,
      knight
        ? "servant"
        : ["merlin", "percival", "servant", "servant", "morgana", "assassin"][
            i
          ],
    ]),
  );
  r.fun.initialRoles = { ...r.roles };
  if (knight) {
    r.knights.deck = [];
    for (const p of r.players)
      Object.assign(r.knights.players[p.uid], {
        alive: true,
        used: false,
        b: false,
        armor: false,
        faction: null,
      });
  }
  return r;
}
function configure(r, map) {
  Object.assign(r.roles, map);
  r.fun.initialRoles = { ...r.roles };
  for (const p of r.players)
    r.knights.players[p.uid].b =
      !!roles[r.roles[p.uid]] &&
      ![
        "gareth",
        "gaheris",
        "blueLancelot",
        "redLancelot",
        "redSwordsman",
        "assassin",
      ].includes(r.roles[p.uid]);
}
function skills(r, actions = {}) {
  run(r, "beginActivity", { kind: "skills" });
  for (let n = 0; n < 8 && r.phase !== "tools"; n++) {
    for (const p of r.players) {
      const a = privateView(r, p.uid).action;
      if (a && !Object.hasOwn(r.submissions, p.uid))
        run(
          r,
          "submit",
          {
            value:
              actions[p.uid] ||
              (a.choices.includes("pass") ? "pass" : "confirm"),
          },
          p.uid,
        );
    }
  }
  assert.equal(r.phase, "tools");
}
const row = (r, uid, id) =>
  r.matchRecord.players
    .find((p) => p.uid === uid)
    .fun.metrics.find((m) => m.id === id);
function finish(r, extra = { funReason: "assassination", funTarget: 3 }) {
  run(r, "finishTools", { replace: true, ...extra });
}
test("非梅林好人挡刀按实际最终目标计数，每位在场非梅林好人形成一次非空刀机会", () => {
  for (const target of [1, 2, 3, 5]) {
    const r = deal();
    finish(r, { funReason: "assassination", funTarget: target });
    assert.equal(row(r, "wx:2", "good_shield").count, target === 2 ? 1 : 0);
    assert.equal(row(r, "wx:3", "good_shield").count, target === 3 ? 1 : 0);
    assert.equal(row(r, "wx:2", "good_shield").opportunities, 1);
    assert.equal(row(r, "wx:3", "good_shield").opportunities, 1);
    assert.equal(row(r, "wx:1", "good_shield"), undefined);
    assert.equal(row(r, "wx:5", "good_shield"), undefined);
    if (target === 3) {
      const story = r.matchRecord.players[2].fun;
      assert.ok(story.events.some((e) => e.label === "成功挡刀"));
      assert.ok(story.highlights.some((e) => e.id === "good_shield"));
    }
  }
  for (const reason of ["quest_fail", "five_rejections"]) {
    const r = deal();
    finish(r, { funReason: reason });
    assert.equal(row(r, "wx:3", "good_shield").count, 0);
    assert.equal(row(r, "wx:3", "good_shield").opportunities, 0);
    assert.equal(row(r, "wx:3", "good_shield").status, "known");
  }
  const unknown = deal();
  finish(unknown, { winner: "good" });
  assert.equal(row(unknown, "wx:3", "good_shield").status, "unknown");
});
test("骑士挡刀使用终局当前阵营与存活状态，排除空刀、梅林和已出局玩家", () => {
  const r = deal(true);
  configure(r, {
    "wx:1": "merlin",
    "wx:2": "blueLancelot",
    "wx:3": "redLancelot",
    "wx:6": "assassin",
  });
  r.knights.players["wx:2"].faction = "evil";
  r.knights.players["wx:3"].faction = "good";
  r.knights.players["wx:4"].alive = false;
  finish(r, { funReason: "early_assassination", funTarget: 3, funActor: 6 });
  assert.equal(row(r, "wx:2", "good_shield"), undefined);
  assert.equal(row(r, "wx:3", "good_shield").count, 1);
  assert.equal(row(r, "wx:4", "good_shield").opportunities, 0);
  assert.equal(row(r, "wx:1", "good_shield"), undefined);
  const empty = deal(true);
  configure(empty, { "wx:1": "merlin", "wx:6": "assassin" });
  finish(empty, {
    funReason: "early_assassination",
    funTarget: 0,
    funActor: 6,
  });
  assert.equal(row(empty, "wx:3", "good_shield").count, 0);
  assert.equal(row(empty, "wx:3", "good_shield").opportunities, 0);
});
test("挡刀榜跨板子合并次数和原始分母，成功率门槛跨板子累积且旧玩法参数兼容", () => {
  const store = new Store(":memory:");
  try {
    for (let i = 0; i < 5; i++) {
      const knight = i >= 3,
        r = deal(knight, "wx:shield");
      r.roles["wx:shield"] = "servant";
      r.roles["wx:3"] = "merlin";
      r.roles["wx:6"] = "assassin";
      r.fun.initialRoles = { ...r.roles };
      finish(r, {
        funReason: knight ? "early_assassination" : "assassination",
        funTarget: i === 2 ? 3 : 1,
        ...(knight ? { funActor: 6 } : {}),
      });
      store.transaction(() => store.save(r));
    }
    const board = new Leaderboard(store),
      read = (query) => board.read("wx:shield", new URLSearchParams(query));
    const all = read("metric=fun_good_shield&sort=rate");
    assert.equal(all.mode, "all");
    assert.equal(all.me.count, 4);
    assert.equal(all.me.opportunities, 5);
    assert.equal(all.me.rate, 80);
    assert.equal(all.me.status, "ranked");
    assert.equal(all.threshold, 5);
    assert.equal(read("metric=fun_good_shield&mode=all").me.count, 4);
    assert.equal(read("metric=fun_good_shield&mode=classic").me.count, 2);
    assert.equal(read("metric=fun_good_shield&mode=knights").me.count, 2);
    assert.equal(
      read("metric=fun_good_shield&mode=classic&sort=rate").me.remaining,
      2,
    );
    assert.ok(all.availableFunMetrics.some((m) => m.key === "fun_good_shield"));
    assert.doesNotMatch(JSON.stringify(all), /wx:|"uid"|target|events/);
    assert.throws(
      () => read("metric=fun_good_shield&role=servant"),
      /参数无效/,
    );
  } finally {
    store.close();
  }
});
test("管理员更正刀口同步挡刀记录与对局回查，重复归档不累计", () => {
  const store = new Store(":memory:");
  try {
    const r = deal();
    r.scoreEnabled = false;
    finish(r);
    store.transaction(() => store.save(r));
    assert.equal(
      store.funFor("wx:3").metrics.find((m) => m.id === "good_shield").count,
      1,
    );
    assert.equal(
      store.matchesFor("wx:3", 0, 20, false, {
        metric: "good_shield",
        mode: "classic",
      }).records.length,
      1,
    );
    store.transaction(() =>
      store.correctFunMatch(r.matchRecord.id, {
        revision: 0,
        funReason: "assassination",
        funTarget: 1,
      }),
    );
    assert.equal(
      store.funFor("wx:3").metrics.find((m) => m.id === "good_shield").count,
      0,
    );
    assert.equal(
      store.matchesFor("wx:3", 0, 20, false, {
        metric: "good_shield",
        mode: "classic",
      }).records.length,
      0,
    );
    store.transaction(() =>
      store.correctFunMatch(r.matchRecord.id, {
        revision: 1,
        funReason: "assassination",
        funTarget: 2,
      }),
    );
    assert.equal(
      store.funFor("wx:2").metrics.find((m) => m.id === "good_shield").count,
      1,
    );
    store.transaction(() => store.archiveMatch(r.matchRecord));
    assert.equal(
      store.funFor("wx:2").metrics.find((m) => m.id === "good_shield").count,
      1,
    );
    assert.equal(
      store.funFor("wx:2").metrics.find((m) => m.id === "good_shield")
        .opportunities,
      1,
    );
  } finally {
    store.close();
  }
});
test("v1对局启动时从已保存终局事实补算挡刀，未知不补零，结束牌桌同步且重启幂等", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-shield-migrate-")),
    path = join(dir, "data.sqlite");
  let store = new Store(path);
  try {
    const known = deal();
    finish(known);
    store.transaction(() => store.save(known));
    const unknown = deal();
    unknown.code = "123457";
    finish(unknown, { winner: "good" });
    store.transaction(() => store.save(unknown));
    store.db.exec(
      "DELETE FROM match_fun_stats WHERE metric='good_shield'; UPDATE match_players SET snapshot=json_set(snapshot,'$.fun.version','fun-2026-10-v1')",
    );
    store.close();
    store = new Store(path);
    const shield = store
      .funFor("wx:3")
      .metrics.find((m) => m.id === "good_shield");
    assert.equal(shield.count, 1);
    assert.equal(shield.opportunities, 1);
    assert.equal(shield.knownGames, 1);
    assert.equal(shield.unknownGames, 1);
    assert.ok(
      publicView(store.get(known.code), "wx:3").myFun.highlights.some(
        (m) => m.id === "good_shield",
      ),
    );
    const before = JSON.stringify(store.funFor("wx:3"));
    store.close();
    store = new Store(path);
    assert.equal(JSON.stringify(store.funFor("wx:3")), before);
    assert.equal(
      store.db
        .prepare(
          "SELECT count(*) AS n FROM match_fun_stats WHERE metric='good_shield' AND uid='wx:3'",
        )
        .get().n,
      2,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("关闭积分仍记录三绿和终局机会，三炸、否决与提前盘刀互不混淆", () => {
  for (const reason of ["assassination", "quest_fail", "five_rejections"]) {
    const r = deal();
    r.scoreEnabled = false;
    finish(r, {
      funReason: reason,
      ...(reason === "assassination" ? { funTarget: 3 } : {}),
    });
    assert.equal(
      row(r, "wx:2", "percival_green").count,
      reason === "assassination" ? 1 : 0,
    );
    assert.equal(
      row(r, "wx:2", "percival_bust").count,
      reason === "quest_fail" ? 1 : 0,
    );
    assert.equal(
      row(r, "wx:1", "merlin_evade").opportunities,
      reason === "assassination" ? 1 : 0,
    );
    assert.equal(r.matchRecord.players[0].score.status, "excluded");
  }
  const r = deal(true);
  configure(r, { "wx:1": "merlin", "wx:2": "percival", "wx:6": "assassin" });
  finish(r, {
    scoreReason: "early_assassination",
    scoreTarget: 1,
    funActor: 6,
  });
  assert.equal(row(r, "wx:2", "percival_green").count, 0);
  assert.equal(row(r, "wx:1", "merlin_hit").count, 1);
  assert.equal(row(r, "wx:6", "assassin_hit").count, 1);
  assert.equal(row(r, "wx:6", "final_hit").count, 1);
});
test("没有实际刺杀的胜利不是躲刀，未知与零分开；手动只记胜方不产生推测数据", () => {
  const r = deal();
  finish(r, { winner: "good" });
  assert.equal(row(r, "wx:1", "merlin_evade").status, "unknown");
  assert.equal(row(r, "wx:6", "assassin_miss").status, "unknown");
  const store = new Store(":memory:");
  try {
    store.save(r);
    const m = store.funFor("wx:1").metrics[0];
    assert.equal(m.value, null);
    assert.equal(m.opportunities, 0);
    assert.equal(m.unknownGames, 1);
  } finally {
    store.close();
  }
});
test("空刀单列且不增加刺中梅林或歪刀；只归给实际带刀人", () => {
  for (const alive of [true, false]) {
    const r = deal(true);
    configure(r, { "wx:1": "merlin", "wx:6": "redSwordsman" });
    r.knights.players["wx:1"].alive = alive;
    finish(r, { funReason: "early_assassination", funTarget: 0, funActor: 6 });
    assert.equal(row(r, "wx:6", "final_hit").opportunities, 0);
    assert.equal(
      row(r, "wx:6", alive ? "final_empty_loss" : "final_empty_win").count,
      1,
    );
    assert.equal(row(r, "wx:1", "merlin_evade").opportunities, alive ? 1 : 0);
    assert.equal(r.result.winner, alive ? "good" : "evil");
  }
});
test("十二骑士转阵营后按当前阵营记录，互刀同时计数，抽B不改写出刀角色", () => {
  const r = deal(true);
  configure(r, { "wx:1": "blueLancelot", "wx:2": "gaheris" });
  r.knights.players["wx:1"].faction = "evil";
  r.knights.deck = ["blueHunter", "redAwakened"];
  skills(r, { "wx:1": "target:2", "wx:2": "target:1" });
  assert.equal(r.fun.events.length, 2);
  assert.ok(r.fun.events.every((e) => e.outcome === "enemy"));
  assert.equal(r.fun.events[0].actor.role, "blueLancelot");
  assert.equal(r.roles["wx:1"], "redAwakened");
  finish(r, { winner: "good" });
  assert.equal(row(r, "wx:1", "knife_enemy").role, "blueLancelot");
  assert.equal(row(r, "wx:1", "knife_enemy").count, 1);
});
test("刀口与实际换号后的同伴命中分别记录", () => {
  const r = deal(true);
  configure(r, {
    "wx:1": "gareth",
    "wx:2": "redSwordsman",
    "wx:3": "gaheris",
    "wx:4": "magician",
  });
  skills(r, { "wx:1": "target:2", "wx:4": "swap:2:3" });
  const event = r.fun.events[0];
  assert.equal(event.selected.seat, 2);
  assert.equal(event.recipient.seat, 3);
  assert.equal(event.outcome, "ally");
  finish(r, { winner: "good" });
  assert.equal(row(r, "wx:1", "knife_ally").count, 1);
  assert.equal(row(r, "wx:1", "knife_aim_enemy").count, 1);
});
test("一次守护挡第一刀，第二刀生效；被挡不是同伴命中", () => {
  const r = deal(true);
  configure(r, {
    "wx:1": "gareth",
    "wx:2": "redSwordsman",
    "wx:3": "blueGuard",
    "wx:4": "blueAwakened",
  });
  skills(r, { "wx:1": "target:2", "wx:3": "target:2", "wx:4": "target:2" });
  assert.deepEqual(
    r.fun.events.map((e) => [e.effect, e.outcome]),
    [
      ["guarded", "failed"],
      ["eliminated", "enemy"],
    ],
  );
});
test("女巫替死按直接承受者阵营归属，反伤不误记为刀同伴", () => {
  let r = deal(true);
  configure(r, { "wx:1": "blueAwakened", "wx:2": "witch" });
  skills(r, { "wx:1": "target:2", "wx:2": "target:3" });
  assert.equal(r.fun.events[0].recipient.seat, 3);
  assert.equal(r.fun.events[0].outcome, "ally");
  r = deal(true);
  configure(r, { "wx:1": "blueAwakened", "wx:2": "paladin" });
  skills(r, { "wx:1": "target:2" });
  assert.equal(r.fun.events[0].effect, "reflected");
  assert.equal(r.fun.events[0].outcome, "failed");
  assert.equal(r.knights.players["wx:1"].alive, false);
});
test("刺客失去尚未使用的刀算生效，攻击不受刀角色和决斗失败有明确原因", () => {
  let r = deal(true);
  configure(r, { "wx:1": "gareth", "wx:2": "assassin" });
  skills(r, { "wx:1": "target:2" });
  assert.equal(r.fun.events[0].effect, "disarmed");
  assert.equal(r.fun.events[0].outcome, "enemy");
  r = deal(true);
  configure(r, { "wx:1": "gareth" });
  skills(r, { "wx:1": "target:2" });
  assert.equal(r.fun.events[0].effect, "invalid_role");
  r = deal(true);
  configure(r, { "wx:1": "blueKnight", "wx:2": "mordred" });
  skills(r, { "wx:1": "target:2" });
  assert.equal(r.fun.events[0].type, "duel");
  assert.equal(r.fun.events[0].effect, "duel_failed");
});
test("猎人枪与轮内刀分开，不使用、作废和未提交不算失败", () => {
  let r = deal(true);
  configure(r, { "wx:1": "blueHunter", "wx:2": "redSwordsman" });
  skills(r, { "wx:1": "detonate:2" });
  assert.equal(r.fun.events[0].type, "gun");
  r = deal(true);
  configure(r, { "wx:1": "blueAwakened", "wx:2": "redHunter" });
  skills(r, { "wx:1": "target:2", "wx:2": "passive:3" });
  assert.deepEqual(
    r.fun.events.map((e) => e.type),
    ["knife", "gun"],
  );
  finish(r, { winner: "good" });
  assert.equal(row(r, "wx:2", "gun_enemy").opportunities, 1);
  r = deal(true);
  configure(r, { "wx:1": "gareth" });
  run(r, "beginActivity", { kind: "skills" });
  run(r, "submit", { value: "target:2" });
  finish(r, { winner: "good" });
  assert.equal(r.fun.events.length, 0);
  assert.equal(row(r, "wx:1", "knife_failed").opportunities, 0);
  r = deal(true);
  configure(r, { "wx:1": "gareth" });
  skills(r);
  assert.equal(r.fun.events.length, 0);
});
test("归档、事件与投影同事务，重试不加次数；重启、重开、删房保留，并且本人接口不泄露内部身份", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-fun-")),
    path = join(dir, "db.sqlite");
  let store = new Store(path);
  try {
    const r = deal(true);
    configure(r, { "wx:1": "gareth", "wx:2": "redSwordsman" });
    skills(r, { "wx:1": "target:2" });
    assert.equal(publicView(r, "wx:3").myFun, null);
    assert.doesNotMatch(
      JSON.stringify(publicView(r, "wx:3")),
      /initialRoles|funEvents|actor|recipient/,
    );
    finish(r, { winner: "good" });
    assert.throws(() =>
      store.transaction(() => {
        store.save(r);
        throw Error("rollback");
      }),
    );
    assert.equal(store.funFor("wx:1").metrics.length, 0);
    store.transaction(() => store.save(r));
    store.transaction(() => store.save(r));
    assert.equal(
      store.funFor("wx:1").metrics.find((m) => m.id === "knife_enemy").count,
      1,
    );
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM match_events").get().n,
      1,
    );
    const list = store.matchesFor("wx:1", 0, 20, false, {
      metric: "knife_enemy",
      mode: "knights",
    });
    assert.equal(list.total, 1);
    assert.equal(
      store.matchesFor("wx:3", 0, 20, false, {
        metric: "knife_enemy",
        mode: "knights",
      }).total,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(store.statsFor("wx:1")),
      /wx:|"uid"|initialRoles|recipient|actor/,
    );
    run(r, "rematch");
    store.save(r);
    store.remove(r.code);
    store.close();
    store = new Store(path);
    assert.equal(
      store.funFor("wx:1").metrics.find((m) => m.id === "knife_enemy").count,
      1,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("管理员更正同时更新终局趣味数据、战绩和榜单，关闭积分不补积分", () => {
  const store = new Store(":memory:");
  try {
    const r = deal();
    r.scoreEnabled = false;
    finish(r);
    store.transaction(() => store.save(r));
    store.transaction(() =>
      store.correctFunMatch(r.matchRecord.id, {
        revision: 0,
        funReason: "assassination",
        funTarget: 1,
      }),
    );
    assert.equal(
      store.funFor("wx:1").metrics.find((m) => m.id === "merlin_hit").count,
      1,
    );
    assert.equal(store.statsFor("wx:1").losses, 1);
    assert.equal(store.statsFor("wx:1").score.games, 0);
    assert.throws(
      () =>
        store.transaction(() =>
          store.correctFunMatch(r.matchRecord.id, {
            revision: 0,
            funReason: "quest_fail",
          }),
        ),
      /已更新/,
    );
    const scored = deal();
    scored.scoreEnabled = true;
    finish(scored, { scoreReason: "assassination", scoreTarget: 3 });
    store.transaction(() => store.save(scored));
    store.transaction(() =>
      store.correctMatch(scored.matchRecord.id, {
        revision: 0,
        scoreReason: "quest_fail",
      }),
    );
    assert.equal(
      store.funFor("wx:2").metrics.find((m) => m.id === "percival_bust").count,
      1,
    );
    assert.equal(
      store.funFor("wx:2").metrics.find((m) => m.id === "percival_green").count,
      1,
    );
  } finally {
    store.close();
  }
});
test("趣味榜次数并列、比例门槛与分母排序、模式隔离和隐藏开关", () => {
  const store = new Store(":memory:");
  try {
    for (const [uid, total, hits] of [
      ["wx:a", 5, 4],
      ["wx:b", 10, 8],
      ["wx:c", 1, 1],
      ["wx:d", 5, 4],
    ]) {
      for (let i = 0; i < total; i++) {
        const r = deal(false, uid);
        finish(r, { funReason: "assassination", funTarget: i < hits ? 3 : 1 });
        store.transaction(() => store.save(r));
      }
    }
    const board = new Leaderboard(store),
      read = (query) => board.read("wx:c", new URLSearchParams(query));
    const count = read("metric=fun_merlin_evade");
    const nearby = read("metric=fun_merlin_evade&nearby=1");
    assert.deepEqual(nearby.nearby,count.rows);
    assert.equal(nearby.nearby.filter(row=>row.isSelf).length,1);
    assert.deepEqual(read("metric=fun_merlin_evade&sort=rate&nearby=1").nearby,[]);
    assert.deepEqual(read("metric=fun_merlin_evade&mode=knights&nearby=1").nearby,[]);
    assert.deepEqual(
      count.rows.map((r) => r.rank),
      [1, 2, 2, 4],
    );
    const rate = read("metric=fun_merlin_evade&sort=rate");
    assert.deepEqual(
      rate.rows.map((r) => r.rank),
      [1, 2, 2],
    );
    assert.equal(rate.rows[0].opportunities, 10);
    assert.equal(rate.me.remaining, 4);
    assert.equal(read("metric=fun_merlin_evade&mode=knights").rows.length, 0);
    store.transaction(() =>
      saveProfile(store, "wx:b", {
        nickname: "玩家B",
        version: readProfile(store, "wx:b").version,
        leaderboardVisible: false,
      }),
    );
    assert.equal(read("metric=fun_merlin_evade&sort=rate").rows.length, 2);
    assert.equal(read("metric=fun_merlin_evade&nearby=1").nearby.length,3);
    assert.deepEqual(board.read("wx:b",new URLSearchParams("metric=fun_merlin_evade&nearby=1")).nearby,[]);
    assert.doesNotMatch(JSON.stringify(rate), /wx:|"uid"|target|events/);
    for (const q of [
      "metric=fun_knife_ally",
      "metric=fun_merlin_evade&mode=bad",
      "metric=games&sort=rate",
      "metric=fun_knife_enemy&role=merlin",
    ])
      assert.throws(() => read(q), /参数无效/);
  } finally {
    store.close();
  }
});
test("多个梅林只给实际被刺者记中刀；对方空刀在梅林本人故事中是躲刀", () => {
  const r = deal(true);
  configure(r, { "wx:1": "merlin", "wx:2": "merlin", "wx:6": "assassin" });
  finish(r, { funReason: "early_assassination", funTarget: 1, funActor: 6 });
  assert.equal(row(r, "wx:1", "merlin_hit").count, 1);
  assert.equal(row(r, "wx:2", "merlin_hit").count, 0);
  assert.equal(row(r, "wx:2", "merlin_evade").count, 1);
  const empty = deal(true);
  configure(empty, { "wx:1": "merlin", "wx:6": "assassin" });
  finish(empty, {
    funReason: "early_assassination",
    funTarget: 0,
    funActor: 6,
  });
  assert.match(empty.matchRecord.players[0].fun.events[0].label, /成功躲刀/);
  assert.equal(row(empty, "wx:6", "assassin_miss").opportunities, 0);
});
test("旧客户端仅登记胜方可保留实际线上终局刀，但不推断派西三绿", () => {
  const r = deal();
  run(r, "beginActivity", { kind: "assassination" });
  for (const p of r.players) {
    const action = privateView(r, p.uid).action;
    if (action)
      run(
        r,
        "submit",
        { value: p.uid === "wx:6" ? 3 : action.choices[0] },
        p.uid,
      );
  }
  finish(r, { winner: "good" });
  assert.equal(row(r, "wx:1", "merlin_evade").count, 1);
  assert.equal(row(r, "wx:6", "assassin_miss").count, 1);
  assert.equal(row(r, "wx:2", "percival_green").status, "unknown");
  assert.equal(row(r, "wx:2", "percival_green").opportunities, 0);
  assert.match(r.matchRecord.players[1].fun.reason, /任务阶段结果未登记/);
});
test("任务阈值按实际判定记录，取消预选猎人开枪和未完成技能不形成有效次数", () => {
  let r = deal();
  run(r, "beginActivity", { kind: "quest", team: [1, 6], threshold: 2 });
  run(r, "submit", { value: "success" }, "wx:1");
  run(r, "submit", { value: "fail" }, "wx:6");
  assert.equal(r.fun.events[0].kind, "quest");
  assert.equal(r.fun.events[0].success, true);
  assert.equal(r.fun.events[0].threshold, 2);
  assert.equal(r.fun.events[0].fails, 1);
  r = deal(true);
  configure(r, { "wx:1": "blueAwakened", "wx:2": "redHunter" });
  run(r, "beginActivity", { kind: "skills" });
  run(r, "submit", { value: "target:2" }, "wx:1");
  run(r, "submit", { value: "passive:3" }, "wx:2");
  assert.equal(r.phase, "skillPrepare");
  assert.equal(r.fun.events.length, 0);
  run(r, "cancelActivity");
  assert.equal(r.knights.players["wx:2"].alive, true);
  assert.equal(r.fun.events.length, 0);
  finish(r, { winner: "good" });
  assert.equal(row(r, "wx:1", "knife_failed").opportunities, 0);
});
test("旧经典明确刺杀事实可回填，只有胜方或旧骑士过程保持未知，重启不会重复", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-fun-legacy-")),
    path = join(dir, "legacy.sqlite");
  let store = new Store(path);
  try {
    const reliable = deal();
    reliable.scoreEnabled = true;
    finish(reliable, { scoreReason: "assassination", scoreTarget: 3 });
    const unknown = deal();
    finish(unknown, { winner: "good" });
    const knight = deal(true);
    configure(knight, { "wx:1": "gareth", "wx:2": "redSwordsman" });
    skills(knight, { "wx:1": "target:2" });
    finish(knight, { scoreReason: "quest_fail" });
    for (const r of [reliable, unknown, knight]) {
      delete r.matchRecord.funFacts;
      r.matchRecord.players.forEach((p) => delete p.fun);
      store.transaction(() => store.save(r));
    }
    store.db.exec(
      "DELETE FROM match_fun_stats; UPDATE match_players SET snapshot=json_remove(snapshot,'$.fun')",
    );
    store.close();
    store = new Store(path);
    const classic = store
      .funFor("wx:1")
      .metrics.find((m) => m.id === "merlin_evade" && m.mode === "classic");
    assert.equal(classic.count, 1);
    assert.equal(classic.opportunities, 1);
    assert.equal(classic.unknownGames, 1);
    const knife = store
      .funFor("wx:1")
      .metrics.find((m) => m.id === "knife_enemy");
    assert.equal(knife.value, null);
    assert.equal(knife.byRole[0].value, null);
    const before = JSON.stringify(store.funFor("wx:1"));
    store.close();
    store = new Store(path);
    assert.equal(JSON.stringify(store.funFor("wx:1")), before);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("趣味榜北京时间月界、分页版本、回滚不失效以及实际出刀角色筛选", () => {
  const store = new Store(":memory:"),
    boundary = Date.UTC(2026, 9, 1) - 8 * 3600000;
  try {
    for (let i = 0; i < 22; i++) {
      const r = deal(false, "wx:rank-" + i);
      finish(r);
      r.matchRecord.endedAt = boundary + (i === 0 ? -1 : 1);
      store.transaction(() => store.archiveMatch(r.matchRecord));
    }
    const board = new Leaderboard(store),
      read = (q) =>
        board.read("wx:rank-0", new URLSearchParams(q), boundary + 10000);
    const first = read("metric=fun_merlin_evade");
    assert.equal(first.rows.length, 20);
    assert.equal(first.nextOffset, 20);
    assert.equal(first.rows[0].rank, 1);
    const next = read(
      "metric=fun_merlin_evade&offset=20&version=" + first.version,
    );
    assert.equal(next.rows.length, 2);
    assert.equal(
      new Set([...first.rows, ...next.rows].map((r) => r.publicId)).size,
      22,
    );
    const month = read("metric=fun_merlin_evade&period=month");
    assert.equal(month.eligibleCount, 21);
    assert.equal(month.me.status, "no_records");
    assert.equal(month.periodStart, boundary);
    assert.throws(() =>
      store.transaction(() => {
        const r = deal(false, "wx:rolled");
        finish(r);
        store.archiveMatch(r.matchRecord);
        throw Error("rollback");
      }),
    );
    assert.equal(read("metric=fun_merlin_evade").version, first.version);
    const r = deal(true);
    configure(r, { "wx:1": "gareth", "wx:2": "redSwordsman" });
    skills(r, { "wx:1": "target:2" });
    finish(r, { winner: "good" });
    store.transaction(() => store.save(r));
    assert.throws(
      () => read("metric=fun_merlin_evade&offset=20&version=" + first.version),
      (e) => e.status === 409,
    );
    assert.equal(
      read("metric=fun_knife_enemy&mode=knights&role=gareth").rows.length,
      1,
    );
    assert.equal(
      read("metric=fun_knife_enemy&mode=knights&role=gaheris").rows.length,
      0,
    );
    assert.equal(read("metric=fun_knife_enemy&mode=classic").rows.length, 0);
    assert.equal(
      board.read(
        "guest:1",
        new URLSearchParams("metric=fun_merlin_evade"),
        boundary + 10000,
      ).me.status,
      "unsupported",
    );
  } finally {
    store.close();
  }
});
test("HTTP趣味登记鉴权、幂等和本人过滤；管理员更正同步记录并留审计", async (t) => {
  const origin = "http://localhost:8911",
    key = "fun-management-key-".repeat(3);
  const app = createApp({
    database: ":memory:",
    adminOrigin: origin,
    adminKey: key,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
  });
  let cookie = "";
  const req = async (path, data, token, extra = {}) =>
    new Promise((resolve, reject) => {
      const r = require("node:http").request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: "localhost:8911",
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...extra,
          },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: JSON.parse(text),
            }),
          );
        },
      );
      r.on("error", reject);
      if (data) r.write(JSON.stringify(data));
      r.end();
    });
  const token = "f".repeat(64),
    other = "e".repeat(64);
  app.store.addSession(
    createHash("sha256").update(token).digest("hex"),
    "wx:1",
  );
  app.store.addSession(
    createHash("sha256").update(other).digest("hex"),
    "wx:3",
  );
  const r = deal(true);
  r.scoreEnabled = false;
  configure(r, { "wx:1": "gareth", "wx:2": "merlin", "wx:6": "assassin" });
  app.store.transaction(() => app.store.save(r));
  const path = "/api/rooms/123456/commands",
    body = {
      type: "finishTools",
      stage: r.stage,
      funReason: "early_assassination",
      funTarget: 2,
      funActor: 6,
    },
    headers = { "Idempotency-Key": randomUUID() };
  assert.equal((await req(path, body, null, headers)).status, 401);
  assert.equal((await req(path, body, other, headers)).status, 403);
  assert.equal(
    (
      await req(path, { ...body, funActor: 2 }, token, {
        "Idempotency-Key": randomUUID(),
      })
    ).status,
    400,
  );
  assert.equal(app.store.get(r.code).phase, "tools");
  const result = await req(path, body, token, headers);
  assert.equal(result.status, 200);
  assert.deepEqual((await req(path, body, token, headers)).data, result.data);
  assert.equal(
    app.store.funFor("wx:6").metrics.find((m) => m.id === "final_hit").count,
    1,
  );
  const mine = await req(
    "/api/me/matches?fun=final_hit&mode=knights&role=assassin",
    null,
    token,
  );
  assert.equal(mine.data.total, 0);
  assert.equal(
    (
      await req(
        "/api/me/matches?fun=final_hit&mode=knights&uid=wx:6",
        null,
        token,
      )
    ).status,
    400,
  );
  assert.doesNotMatch(
    JSON.stringify((await req("/api/me/stats", null, token)).data),
    /wx:|initialRoles|"actor"|"recipient"/,
  );
  const correction = "/api/admin/matches/" + r.matchId + "/correct",
    change = {
      revision: 0,
      funReason: "early_assassination",
      funTarget: 3,
      funActor: 6,
      reason: "现场核对刺杀目标",
      requestId: randomUUID(),
    };
  assert.equal((await req(correction, change)).status, 401);
  const login = await req("/api/admin/login", { key });
  cookie = login.headers["set-cookie"][0].split(";")[0];
  assert.equal(
    (await req(correction, change, null, { Origin: "https://evil.test" }))
      .status,
    403,
  );
  const corrected = await req(correction, change);
  assert.equal(corrected.status, 200);
  assert.deepEqual((await req(correction, change)).data, corrected.data);
  const relogin = await req("/api/admin/login", { key });
  cookie = relogin.headers["set-cookie"][0].split(";")[0];
  assert.deepEqual((await req(correction, change)).data, corrected.data);
  assert.equal(
    app.store.funFor("wx:6").metrics.find((m) => m.id === "final_miss").count,
    1,
  );
  assert.equal(
    app.store.funFor("wx:2").metrics.find((m) => m.id === "merlin_evade").count,
    1,
  );
  assert.equal(app.store.statsFor("wx:2").wins, 1);
  assert.equal(app.store.statsFor("wx:2").score.games, 0);
  assert.equal(
    app.store.db
      .prepare(
        "SELECT count(*) AS n FROM admin_audit WHERE action='correct-result'",
      )
      .get().n,
    1,
  );
});
