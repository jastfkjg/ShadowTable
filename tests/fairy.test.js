const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  BOARDS,
  newRoom,
  enter,
  command,
  publicView,
  privateView,
} = require("../server/engine");
const run = (r, uid, type, extra = {}) =>
  command(r, uid, { type, stage: r.stage, ...extra });
const settings = (r, fairyEnabled, uid = r.host, extra = {}) =>
  run(r, uid, "updateSettings", {
    board: r.board,
    capacity: r.capacity,
    visible: false,
    fairyEnabled,
    ...extra,
  });
function setup(board = "classic", capacity = 8, enabled) {
  const r = newRoom("123456", "p1", "房主", board, capacity);
  if (enabled !== undefined) settings(r, enabled);
  for (let i = 2; i <= capacity; i++) enter(r, `p${i}`, `玩家${i}`);
  r.players.forEach((p) => run(r, p.uid, "ready", { ready: true }));
  run(r, "p1", "start", { flexible: true });
  return r;
}
const begin = (r) => run(r, r.host, "beginActivity", { kind: "fairy" });

test("所有板子按人数默认启用湖仙，7人可开，5/6人不可绕过开启", () => {
  for (const board of BOARDS.filter((b) => b.available)) {
    for (const capacity of board.counts) {
      const r = setup(board.id, capacity);
      assert.equal(
        publicView(r, "p1").fairyEnabled,
        capacity >= 8,
        `${board.id}/${capacity}`,
      );
      if (capacity < 7) {
        const before = structuredClone(r);
        assert.throws(() => settings(r, true), /不支持湖中仙女/);
        assert.throws(() => begin(r), /未开启/);
        assert.deepEqual(r, before);
      } else {
        if (capacity === 7) settings(r, true);
        assert.equal(publicView(r, "p1").fairyHolder, r.leader);
        begin(r);
        const holder = publicView(r, "p1").fairyHolder;
        const uid = `p${holder}`;
        const target = r.players.find((p) => p.seat !== holder);
        const action = privateView(r, uid).action;
        assert.ok(action.choices.includes(`target:${target.seat}`));
        run(r, uid, "submit", { value: `target:${target.seat}` });
        assert.equal(r.phase, "tools");
        assert.ok(privateView(r, uid).fairyResult);
        for (const p of r.players)
          assert.equal(publicView(r, p.uid).fairyHolder, target.seat);
      }
    }
  }
});

test("查验仅持有者可交，排除自己和历任；结果和确认权限仅本人，取消不传递", () => {
  const r = setup();
  const holder = publicView(r, "p1").fairyHolder;
  const uid = `p${holder}`;
  const target = r.players.find((p) => p.seat !== holder);
  begin(r);
  assert.equal(privateView(r, target.uid).action, null);
  assert.throws(
    () => run(r, target.uid, "submit", { value: `target:${holder}` }),
    /没有秘密操作/,
  );
  assert.throws(
    () => run(r, uid, "submit", { value: `target:${holder}` }),
    /不合法/,
  );
  const before = structuredClone(r);
  assert.throws(() => settings(r, false), /完成或作废/);
  assert.deepEqual(r, before);
  run(r, r.host, "closeWaiting", { confirm: true });
  assert.equal(publicView(r, uid).fairyHolder, holder);
  assert.equal(privateView(r, uid).fairyResult, null);
  begin(r);
  r.roles[target.uid] = "mordred";
  run(r, uid, "submit", { value: `target:${target.seat}` });
  assert.match(privateView(r, uid).fairyResult.information, /查验结果：坏人/);
  const restored = structuredClone(r);
  assert.equal(publicView(restored, uid).me.fairyResultPending, true);
  for (const p of r.players) {
    assert.ok(
      !JSON.stringify(publicView(restored, p.uid)).includes("查验结果："),
    );
    if (p.uid !== uid) {
      assert.equal(privateView(restored, p.uid).fairyResult, null);
      assert.equal(publicView(restored, p.uid).me.fairyResultPending, false);
      assert.throws(
        () => run(restored, p.uid, "ackFairyResult", { revision: 1 }),
        /结果已变化/,
      );
    }
  }
  run(restored, uid, "ackFairyResult", { revision: 1 });
  assert.equal(publicView(restored, uid).me.fairyResultPending, false);
  settings(r, false);
  assert.equal(publicView(r, uid).fairyHolder, null);
  assert.throws(() => begin(r), /未开启/);
  settings(r, true);
  assert.equal(publicView(r, uid).fairyHolder, target.seat);
  begin(r);
  assert.ok(
    !privateView(r, target.uid).action.choices.includes(`target:${holder}`),
  );
  assert.ok(
    !privateView(r, target.uid).action.choices.includes(
      `target:${target.seat}`,
    ),
  );
});

test("配置权限、人数默认值、原子性、准备状态和同房重开", () => {
  const r = newRoom("123456", "p1", "房主", "classic", 8);
  enter(r, "p2", "玩家");
  assert.throws(() => settings(r, false, "p2"), /只有房主/);
  assert.throws(() => settings(r, "true"), /设置无效/);
  run(r, "p1", "ready", { ready: true });
  settings(r, false);
  assert.equal(r.players[0].ready, false);
  settings(r, false, "p1", { board: "classic-court", capacity: 10 });
  assert.equal(publicView(r, "p1").fairyEnabled, false);
  run(r, "p1", "configure", { board: "classic", capacity: 7 });
  assert.equal(publicView(r, "p1").fairyEnabled, false);
  settings(r, true);
  const before = structuredClone(r);
  assert.throws(() => settings(r, true, "p1", { capacity: 6 }), /不支持/);
  assert.deepEqual(r, before);
  run(r, "p1", "configure", { board: "classic", capacity: 6 });
  assert.equal(publicView(r, "p1").fairyEnabled, false);
  run(r, "p1", "configure", { board: "classic", capacity: 8 });
  assert.equal(publicView(r, "p1").fairyEnabled, true);
  for (const enabled of [true, false]) {
    const active = setup("classic", 8, enabled);
    run(active, "p1", "terminate");
    run(active, "p1", "rematch");
    assert.equal(publicView(active, "p1").fairyEnabled, enabled);
    assert.equal(publicView(active, "p1").fairyHolder, null);
    assert.equal(active.fairy, undefined);
    active.players.forEach((p) => run(active, p.uid, "ready", { ready: true }));
    run(active, "p1", "start", { flexible: true });
    assert.equal(
      publicView(active, "p1").fairyHolder,
      enabled ? active.leader : null,
    );
    assert.deepEqual(active.fairy.fairyVisited, []);
  }
});

test("旧存档保持原开关及骑士查验结果；普通局可开启，新准备房按人数默认", () => {
  const old = setup();
  delete old.fairyEnabled;
  delete old.fairy;
  assert.equal(publicView(old, "p1").fairyEnabled, false);
  settings(old, true);
  begin(old);
  assert.equal(old.phase, "fairy");
  const knights = setup("knights", 12);
  delete knights.fairyEnabled;
  const holder = knights.knights.fairy;
  knights.knights.players[`p${holder}`].fairyInfo = "2号查验结果：坏人";
  assert.equal(publicView(knights, "p2").fairyHolder, holder);
  assert.equal(publicView(knights, `p${holder}`).me.fairyResultPending, true);
  const lobby = newRoom("123456", "p1", "房主", "classic", 8);
  delete lobby.fairyEnabled;
  assert.equal(publicView(lobby, "p1").fairyEnabled, true);
});

test("普通局查验使用当前阵营，混沌盗贼返回第三阵营，所有目标用尽后不可再开", () => {
  const r = setup("chaos", 12);
  r.fairy.fairy = 1;
  r.roles.p2 = "blueThief";
  begin(r);
  run(r, "p1", "submit", { value: "target:2" });
  assert.match(privateView(r, "p1").fairyResult.information, /盗贼阵营/);
  for (let i = 3; i <= 12; i++) {
    begin(r);
    run(r, `p${i - 1}`, "submit", { value: `target:${i}` });
  }
  const before = structuredClone(r);
  assert.throws(() => begin(r), /没有可查验/);
  assert.deepEqual(r, before);
});
