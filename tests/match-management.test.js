"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { Store } = require("../server/store");
const { newRoom, enter, command, publicView } = require("../server/engine");
const { Leaderboard, periodRange } = require("../server/leaderboard");
const { createApp } = require("../server/app");

function game(
  store,
  {
    code = "123456",
    purpose = "normal",
    loss = false,
    ended = Date.now(),
    companion = false,
    score = true,
  } = {},
) {
  const room = newRoom(code, "wx:1", "林间", "classic", 6);
  for (let i = 2; i <= 6; i++)
    enter(
      room,
      companion && i === 6 ? "test:" + code + ":6" : "wx:" + i,
      "玩家" + i,
    );
  command(room, room.host, {
    type: "updateSettings",
    stage: room.stage,
    board: room.board,
    capacity: 6,
    visible: false,
    scoreEnabled: score,
    recordPurpose: purpose,
  });
  room.players.forEach((p) => (p.ready = true));
  command(room, room.host, {
    type: "start",
    stage: room.stage,
    flexible: true,
  });
  room.roles = Object.fromEntries(
    room.players.map((p, i) => [
      p.uid,
      ["merlin", "percival", "servant", "servant", "morgana", "assassin"][i],
    ]),
  );
  room.scorePolicy.streakBonus.enabled = true;
  command(room, room.host, {
    type: "finishTools",
    stage: room.stage,
    ...(score
      ? {
          scoreReason: loss ? "quest_fail" : "assassination",
          ...(!loss ? { scoreTarget: 3 } : {}),
        }
      : {
          funReason: loss ? "quest_fail" : "assassination",
          ...(!loss ? { funTarget: 3 } : {}),
        }),
  });
  room.matchRecord.endedAt = ended;
  store.transaction(() => store.save(room));
  return room;
}
function input(store, action, ...rooms) {
  return {
    action,
    matches: rooms.map((room) => ({
      id: room.matchId,
      revision: store.matchScoreData(room.matchId).revision,
    })),
    reason: "陪测清理",
  };
}
const manage = (store, action, ...rooms) =>
  store.transaction(() => store.manageMatches(input(store, action, ...rooms)));

test("删除及恢复同步个人明细、各类榜单、趣味、月份、连胜奖励，保留手动得分与独立调分；预览不写入", () => {
  const store = new Store(":memory:");
  try {
    const first = game(store, { ended: 100 }),
      second = game(store, { ended: 200 }),
      third = game(store, { ended: 300 });
    store.transaction(() =>
      store.adjustMatchScores(second.matchId, {
        revision: 0,
        scores: [{ uid: "wx:3", points: 12 }],
      }),
    );
    store.transaction(() =>
      store.adjustPlayerScore({
        uid: "wx:3",
        revision: store.scoreRevision("wx:3"),
        mode: "delta",
        points: 7,
      }),
    );
    const board = new Leaderboard(store),
      oldVersion = board.read(
        "wx:3",
        new URLSearchParams("metric=points"),
      ).version;
    const before = store.statsFor("wx:3"),
      scoreVersion = store.scoreRevision("wx:3"),
      revision = store.leaderboardRevision;
    const preview = store.transaction(() =>
      store.previewMatches(input(store, "delete", first)),
    );
    const impact = preview.players.find((p) => p.uid === "wx:3");
    assert.equal(impact.before.games, 3);
    assert.equal(impact.after.games, 2);
    assert.equal(impact.before.points - impact.after.points, 5);
    assert.deepEqual(store.statsFor("wx:3"), before);
    assert.equal(store.scoreRevision("wx:3"), scoreVersion);
    assert.equal(store.leaderboardRevision, revision);
    manage(store, "delete", first);
    assert.equal(store.matchesFor("wx:3").total, 2);
    assert.equal(store.statsFor("wx:3").total, 2);
    assert.equal(
      store.matchesFor("wx:3").records.find((r) => r.id === second.matchId)
        .score.total,
      12,
    );
    assert.equal(
      store.matchesFor("wx:3").records.find((r) => r.id === third.matchId).score
        .total,
      4,
    );
    assert.equal(store.scoreAdjustments("wx:3").total, 1);
    assert.deepEqual(store.streakFor("wx:3"), { current: 2, best: 2 });
    assert.equal(
      board.read("wx:3", new URLSearchParams("metric=games")).me.total,
      2,
    );
    assert.equal(
      board.read("wx:3", new URLSearchParams("metric=overall")).me.total,
      2,
    );
    assert.equal(
      board.read("wx:3", new URLSearchParams("metric=points")).me.points,
      23,
    );
    assert.throws(
      () =>
        board.read(
          "wx:3",
          new URLSearchParams("metric=points&version=" + oldVersion),
        ),
      (e) => e.status === 409,
    );
    assert.equal(
      store.statsFor("wx:3").fun.metrics.find((m) => m.id === "good_shield")
        .count,
      2,
    );
    assert.equal(
      board.read("wx:3", new URLSearchParams("metric=fun_good_shield")).me
        .count,
      2,
    );
    // Archiving a retained room cannot revive a deleted game.
    store.transaction(() => store.save(first));
    assert.equal(store.matchesFor("wx:3").total, 2);
    manage(store, "restore", first);
    assert.equal(store.matchesFor("wx:3").total, 3);
    assert.equal(store.statsFor("wx:3").score.total, before.score.total);
    assert.equal(
      store.statsFor("wx:3").fun.metrics.find((m) => m.id === "good_shield")
        .count,
      3,
    );
  } finally {
    store.close();
  }
});

test("不计战绩保留明细但排除所有统计，删除再恢复保留原排除状态和原因；重启不恢复旧测试标记", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-management-")),
    path = join(dir, "db.sqlite");
  let store = new Store(path);
  try {
    const room = game(store),
      before = store.playerScore("wx:3").points;
    manage(store, "exclude", room);
    assert.equal(store.statsFor("wx:3").total, 0);
    assert.equal(store.playerScore("wx:3").points, 0);
    const record = store.matchesFor("wx:3").records[0];
    assert.equal(record.outcome, "excluded");
    assert.equal(record.score.status, "excluded");
    assert.equal(record.fun.status, "excluded");
    assert.equal(store.matchesFor("wx:3", 0, 20, true).total, 0);
    assert.equal(
      store.matchesFor("wx:3", 0, 20, false, {
        metric: "good_shield",
        mode: "classic",
      }).total,
      0,
    );
    assert.equal(store.statsFor("wx:3").recent[0].outcome, "excluded");
    assert.equal(
      publicView(store.get(room.code), "wx:3").myScore.status,
      "excluded",
    );
    assert.throws(
      () =>
        store.transaction(() =>
          store.correctMatch(room.matchId, {
            revision: 1,
            scoreReason: "quest_fail",
          }),
        ),
      (e) => e.status === 409,
    );
    manage(store, "delete", room);
    // A legacy migration may restore the underlying outcomes, never the management state.
    const legacy = JSON.parse(
      store.db
        .prepare("SELECT snapshot FROM matches WHERE id=?")
        .get(room.matchId).snapshot,
    );
    legacy.excludedReason = "测试局";
    store.db
      .prepare("UPDATE matches SET snapshot=? WHERE id=?")
      .run(JSON.stringify(legacy), room.matchId);
    store.db.exec("UPDATE match_players SET outcome='excluded'");
    store.close();
    store = new Store(path);
    assert.equal(store.statsFor("wx:3").total, 0);
    assert.equal(store.matchesFor("wx:3").total, 0);
    manage(store, "restore", room);
    assert.equal(
      store.matchesFor("wx:3").records[0].excludedReason,
      "陪测清理",
    );
    assert.equal(store.playerScore("wx:3").points, 0);
    manage(store, "include", room);
    assert.equal(store.playerScore("wx:3").points, before);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("批量全量校验、过期版本、重复记录和事务失败不产生部分修改", () => {
  const store = new Store(":memory:");
  try {
    const first = game(store),
      second = game(store),
      request = input(store, "delete", first, second),
      before = store.statsFor("wx:3");
    request.matches[1].revision = 99;
    assert.throws(
      () => store.transaction(() => store.manageMatches(request)),
      (e) => e.status === 409,
    );
    assert.deepEqual(store.statsFor("wx:3"), before);
    assert.throws(() =>
      store.transaction(() => {
        store.manageMatches(input(store, "delete", first, second));
        throw Error("rollback");
      }),
    );
    assert.deepEqual(store.statsFor("wx:3"), before);
    for (const bad of [
      input(store, "delete", first, first),
      { action: "delete", matches: [null] },
      { action: "delete", matches: [] },
      { action: "clear-user", matches: [] },
      { ...input(store, "delete", first), reason: {} },
    ])
      assert.throws(
        () => store.transaction(() => store.previewMatches(bad)),
        (e) => e.status === 400,
      );
    manage(store, "delete", first, second);
    assert.equal(store.statsFor("wx:3").total, 0);
    assert.equal(store.statsFor("wx:3").recent.length, 0);
    assert.throws(
      () =>
        store.transaction(() =>
          store.manageMatches(input(store, "delete", first)),
        ),
      (e) => e.status === 409,
    );
  } finally {
    store.close();
  }
});

test("用户、日期、状态与陪测筛选和历史分页准确，删除房间不影响管理查询", () => {
  const store = new Store(":memory:");
  try {
    const range = periodRange("month", Date.now());
    for (let i = 0; i < 22; i++)
      game(store, {
        code: i === 21 ? "654321" : "123456",
        ended: range.start + i * 1000,
        companion: i === 1,
      });
    const read = (q) => store.managedMatches(new URLSearchParams(q));
    assert.equal(read("uid=wx%3A1").total, 22);
    assert.equal(read("uid=wx%3A1").matches.length, 20);
    assert.equal(read("uid=wx%3A1&offset=20").matches.length, 2);
    assert.equal(read("companion=1").total, 1);
    assert.equal(read("code=654321").total, 1);
    const d = new Date(range.start + 8 * 3600000).toISOString().slice(0, 10);
    assert.equal(read("from=" + d + "&to=" + d).total, 22);
    const one = read("companion=1").matches[0];
    store.transaction(() =>
      store.manageMatches({
        action: "delete",
        matches: [{ id: one.id, revision: one.revision }],
      }),
    );
    assert.equal(read("companion=1").total, 0);
    assert.equal(read("companion=1&state=deleted").total, 1);
    store.transaction(() => store.remove("123456"));
    assert.equal(read("code=123456&state=all").total, 21);
    assert.equal(read("uid=wx%3Aunknown").total, 0);
    for (const q of [
      "from=2026-02-30",
      "from=2026-10-03&to=2026-10-01",
      "offset=-1",
      "state=bad",
      "uid=wx:1&uid=wx:2",
      "unexpected=1",
      "companion=0",
    ])
      assert.throws(
        () => read(q),
        (e) => e.status === 400,
      );
    const monthly = store.statsFor("wx:3").score.month;
    assert.equal(monthly, store.playerScore("wx:3").points);
  } finally {
    store.close();
  }
});

test("开局用途独立于陪测和计分，发牌后固定，测试局可回查且默认排除，管理员可恢复原资格", () => {
  const store = new Store(":memory:");
  try {
    const normal = game(store, { companion: true });
    assert.equal(store.statsFor("wx:3").total, 1);
    const room = game(store, { purpose: "test", score: true });
    assert.equal(store.statsFor("wx:3").total, 1);
    assert.equal(store.matchesFor("wx:3").total, 2);
    assert.equal(
      store.matchesFor("wx:3").records.find((r) => r.id === room.matchId).score
        .status,
      "excluded",
    );
    assert.equal(
      publicView(store.get(room.code), "wx:3").recordSettings.purpose,
      "test",
    );
    assert.throws(
      () =>
        command(room, room.host, {
          type: "updateSettings",
          stage: room.stage,
          board: room.board,
          capacity: 6,
          visible: false,
          recordPurpose: "normal",
        }),
      (e) => e.status === 409,
    );
    manage(store, "include", room);
    assert.equal(store.statsFor("wx:3").total, 2);
    assert.match(
      publicView(store.get(room.code), "wx:3").recordNotice,
      /恢复计入战绩/,
    );
    const noScore = game(store, { purpose: "test", score: false });
    manage(store, "include", noScore);
    assert.equal(store.statsFor("wx:3").total, 3);
    assert.equal(store.statsFor("wx:3").score.games, 2);
    command(room, room.host, { type: "rematch", stage: room.stage });
    assert.equal(room.recordPurpose, "test");
    assert.equal(room.recordManagement, undefined);
    assert.equal(
      store
        .managedMatches(new URLSearchParams("state=all"))
        .matches.find((r) => r.id === normal.matchId).companion,
      true,
    );
  } finally {
    store.close();
  }
});

test("管理接口鉴权及来源校验，预览只读，跨登录幂等重试、版本冲突和逐局审计", async (t) => {
  const origin = "http://localhost:8910",
    key = "match-management-test-".repeat(3),
    app = createApp({
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
  const req = (path, data, headers = {}) =>
    new Promise((resolve, reject) => {
      const r = require("node:http").request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: "localhost:8910",
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
            ...headers,
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
  const login = async () => {
    const r = await req("/api/admin/login", { key });
    cookie = r.headers["set-cookie"][0].split(";")[0];
  };
  const first = game(app.store),
    second = game(app.store),
    body = {
      ...input(app.store, "delete", first, second),
      requestId: randomUUID(),
    };
  assert.equal((await req("/api/admin/match-records")).status, 401);
  await login();
  assert.equal(
    (
      await req("/api/admin/match-records/preview", body, {
        Origin: "https://evil.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (await req("/api/admin/match-records/preview", body)).status,
    200,
  );
  assert.equal(app.store.matchesFor("wx:1").total, 2);
  const applied = await req("/api/admin/match-records/manage", body);
  assert.equal(applied.status, 200);
  assert.equal(app.store.matchesFor("wx:1").total, 0);
  await login();
  assert.deepEqual(
    (await req("/api/admin/match-records/manage", body)).data,
    applied.data,
  );
  assert.equal(
    (
      await req("/api/admin/match-records/manage", {
        ...body,
        action: "restore",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req("/api/admin/match-records/manage", {
        ...body,
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    app.store.db
      .prepare(
        "SELECT count(*) AS n FROM admin_audit WHERE action='match-delete'",
      )
      .get().n,
    2,
  );
  const records = await req("/api/admin/match-records?state=deleted");
  assert.equal(records.data.total, 2);
  assert.doesNotMatch(
    JSON.stringify(records.data),
    /roleId|scoringFacts|funFacts/,
  );
});
