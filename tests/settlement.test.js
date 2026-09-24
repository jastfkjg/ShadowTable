const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  newRoom,
  enter,
  command,
  publicView,
  privateView,
} = require("../server/engine");
const { createApp } = require("../server/app");
const { randomUUID } = require("node:crypto");

const run = (room, uid, type, extra = {}) =>
  command(room, uid, { type, stage: room.stage, ...extra });
function setup(board = "classic", capacity = 6) {
  const room = newRoom("123456", "p1", "房主", board, capacity);
  for (let i = 2; i <= capacity; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach((p) => run(room, p.uid, "ready", { ready: true }));
  run(room, "p1", "start", { flexible: true });
  return room;
}
const begin = (room, kind, extra = {}) =>
  run(room, "p1", "beginActivity", { kind, ...extra });
const cutoff = (room) => run(room, "p1", "closeWaiting", { confirm: true });
function submitAll(room, values = {}) {
  const stage = room.stage;
  for (const p of room.players) {
    const action = privateView(room, p.uid).action;
    if (action)
      command(room, p.uid, {
        type: "submit",
        stage,
        value: values[p.uid] ?? action.choices[0],
      });
  }
}
function knightsRoom() {
  const room = setup("knights", 12);
  room.leader = 1;
  room.knights.deck = [];
  for (const p of room.players) {
    room.roles[p.uid] = "servant";
    Object.assign(room.knights.players[p.uid], {
      armor: false,
      used: false,
      b: false,
    });
  }
  return room;
}

test("收齐即结算：无需房主请求，旧阶段无法重复提交或截止，下一项不自动发起", () => {
  const room = setup();
  begin(room, "quest", { team: [2, 3], threshold: 1 });
  const stage = room.stage;
  assert.equal(publicView(room, "p1").operationStatus.title, "本次你无需操作");
  assert.equal(publicView(room, "p2").operationStatus.title, "请完成本次操作");
  run(room, "p2", "submit", { value: "success" });
  assert.equal(
    publicView(room, "p2").operationStatus.title,
    "已提交，等待其他玩家",
  );
  assert.equal(room.history.length, 0);
  run(room, "p3", "submit", { value: "success" });
  assert.equal(room.phase, "tools");
  assert.equal(room.activity, null);
  assert.equal(room.result, null);
  const result = structuredClone(publicView(room, "p2").history);
  for (const input of [
    { type: "submit", value: "success" },
    { type: "closeWaiting", confirm: true },
  ])
    assert.throws(() => command(room, "p1", { stage, ...input }), /阶段已变化/);
  assert.equal(room.history.length, 1);
  begin(room, "vote");
  assert.deepEqual(publicView(room, "p3").history, result);
});

test("提前截止投票明确记弃权，门槛按全部有资格玩家计算", () => {
  for (const approvals of [0, 3, 4]) {
    const room = setup();
    begin(room, "vote");
    for (let i = 1; i <= approvals; i++)
      run(room, `p${i}`, "submit", { value: "approve" });
    const original = structuredClone(room);
    assert.equal(publicView(room, "p2").closeWaiting, null);
    assert.throws(
      () => run(room, "p2", "closeWaiting", { confirm: true }),
      /只有房主/,
    );
    assert.throws(() => run(room, "p1", "closeWaiting"), /请确认/);
    assert.deepEqual(room, original);
    cutoff(room);
    const result = room.history.at(-1);
    assert.equal(result.earlyClosed, true);
    assert.equal(result.approved, approvals > 3);
    assert.equal(
      result.votes.filter((v) => v.approve === null).length,
      6 - approvals,
    );
    assert.equal(result.votes.filter((v) => v.approve === false).length, 0);
    assert.equal(room.phase, "tools");
  }
  const room = knightsRoom();
  room.knights.players.p12.alive = false;
  begin(room, "vote");
  for (let i = 1; i <= 6; i++)
    run(room, `p${i}`, "submit", { value: "approve" });
  cutoff(room);
  assert.equal(room.history.at(-1).votes.length, 11);
  assert.equal(room.history.at(-1).approved, true);
});

test("任务提前结束只作废，不补秘密票，不产生成功失败结果", () => {
  for (const board of ["classic", "chaos", "knights"]) {
    const room = setup(board, board === "classic" ? 6 : 12);
    begin(room, "quest", { team: [1, 2], threshold: 1 });
    run(room, "p1", "submit", {
      value: privateView(room, "p1").action.choices[0],
    });
    cutoff(room);
    assert.equal(room.phase, "tools");
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].kind, "toolCanceled");
    for (const key of ["votes", "fails", "success", "counts"])
      assert.equal(room.history[0][key], undefined);
    assert.deepEqual(room.submissions, {});
    assert.equal(room.quests.length, 0);
  }
});

test("截止技能只补pass，猎人未选被动不触发，已选被动自动结算", () => {
  for (const selected of [false, true]) {
    const room = knightsRoom();
    Object.assign(room.roles, {p1: "blueAwakened", p2: "redHunter", p3: "blueHunter", p4: "blueGuard"});
    begin(room, "skills");
    run(room, "p1", "submit", {value: "target:2"});
    if (selected) run(room, "p2", "submit", {value: "passive:3"});
    cutoff(room);
    assert.equal(room.phase, "tools");
    assert.equal(room.knights.players.p2.used, selected);
    assert.equal(room.knights.players.p3.used, false);
    assert.equal(room.knights.players.p4.used, false);
    assert.deepEqual(room.history.at(-1).eliminated, selected ? [2, 3] : [2]);
    assert.ok(!JSON.stringify(publicView(room, "p1").history).includes("passive:"));
  }
});

test("整轮技能全员秘密提交，收齐后被动枪自动完成，不暴露中途状态", () => {
  const room = knightsRoom();
  Object.assign(room.roles, { p1: "blueAwakened", p2: "redHunter" });
  begin(room, "skills");
  run(room, "p2", "submit", { value: "passive:3" });
  assert.equal(publicView(room, "p1").operationProgress.total, 12);
  assert.ok(!JSON.stringify(publicView(room, "p1")).includes("passive:"));
  for (const p of room.players.filter(p => p.uid !== "p2")) run(room, p.uid, "submit", {value: p.uid === "p1" ? "target:2" : "pass"});
  assert.equal(room.phase, "tools");
  assert.deepEqual(room.history.at(-1).eliminated, [2, 3]);
});

test("仙女自动完成且结果私密；提前结束不代选目标，不消耗传递", () => {
  const room = knightsRoom();
  begin(room, "fairy");
  const holder = room.knights.fairy;
  cutoff(room);
  assert.equal(room.knights.fairy, holder);
  assert.deepEqual(room.knights.fairyVisited, []);
  assert.equal(room.knights.players[`p${holder}`].fairyInfo, undefined);
  begin(room, "fairy");
  const uid = `p${holder}`;
  run(room, uid, "submit", { value: holder === 2 ? "target:3" : "target:2" });
  assert.equal(room.phase, "tools");
  assert.equal(publicView(room, uid).me.fairyResultPending, true);
  for (const p of room.players)
    assert.ok(!JSON.stringify(publicView(room, p.uid)).includes("好人（第"));
  assert.ok(privateView(room, uid).fairyResult);
});

test("HTTP并发最后提交及原请求重试只结算一次，下一次操作保留记录", async () => {
  const app = createApp({ database: ":memory:", devAuth: true });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, token, body, id = randomUUID()) {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": id,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  }
  try {
    const tokens = [];
    for (let i = 0; i < 6; i++)
      tokens.push((await request("/api/dev-login", "", {})).data.token);
    const created = await request("/api/rooms", tokens[0], {
      name: "房主",
      board: "classic",
      capacity: 6,
    });
    const path = `/api/rooms/${created.data.code}`;
    for (let i = 1; i < 6; i++)
      assert.equal(
        (await request(path + "/join", tokens[i], { name: `玩家${i}` })).status,
        200,
      );
    let view = (await request(path, tokens[0])).data;
    for (const token of tokens)
      await request(path + "/commands", token, {
        type: "ready",
        stage: view.stage,
        ready: true,
      });
    await request(path + "/commands", tokens[0], {
      type: "start",
      stage: view.stage,
      flexible: true,
    });
    view = (await request(path, tokens[0])).data;
    await request(path + "/commands", tokens[0], {
      type: "beginActivity",
      stage: view.stage,
      kind: "vote",
    });
    view = (await request(path, tokens[0])).data;
    const submit = { type: "submit", stage: view.stage, value: "approve" };
    for (const token of tokens.slice(0, 4))
      assert.equal(
        (await request(path + "/commands", token, submit)).status,
        200,
      );
    const id = randomUUID();
    const responses = await Promise.all([
      request(path + "/commands", tokens[4], submit),
      request(path + "/commands", tokens[5], submit, id),
      request(path + "/commands", tokens[5], submit, id),
    ]);
    assert.ok(responses.every((r) => r.status === 200));
    view = (await request(path, tokens[2])).data;
    assert.equal(view.phase, "tools");
    assert.equal(view.history.length, 1);
    assert.equal(view.history[0].approved, true);
    await request(path + "/commands", tokens[0], {
      type: "beginActivity",
      stage: view.stage,
      kind: "quest",
      team: [1],
      threshold: 1,
    });
    assert.equal(
      (await request(path + "/commands", tokens[5], submit)).status,
      409,
    );
    const restored = (await request(path, tokens[2])).data;
    assert.equal(restored.history.length, 1);
    assert.equal(restored.phase, "quest");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
  }
});

test("没有合资格投票者时结束等待作废操作，不制造投票结果", () => {
  const room = knightsRoom();
  for (const p of Object.values(room.knights.players)) p.alive = false;
  begin(room, "vote");
  cutoff(room);
  assert.equal(room.phase, "tools");
  assert.equal(room.history.at(-1).kind, "toolCanceled");
});

test("SQLite重新打开后保留待提交及已结算状态，不重复结算", () => {
  const { Store } = require("../server/store");
  const { mkdtempSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-settlement-"));
  let store;
  try {
    const file = join(directory, "room.sqlite");
    store = new Store(file);
    let room = setup();
    begin(room, "quest", { team: [2, 3], threshold: 1 });
    run(room, "p2", "submit", { value: "success" });
    store.save(room);
    store.close();
    store = new Store(file);
    room = store.get(room.code);
    assert.equal(
      publicView(room, "p2").operationStatus.title,
      "已提交，等待其他玩家",
    );
    run(room, "p3", "submit", { value: "success" });
    store.save(room);
    store.close();
    store = new Store(file);
    room = store.get(room.code);
    assert.equal(room.phase, "tools");
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].success, true);
    assert.throws(
      () => run(room, "p3", "submit", { value: "success" }),
      /没有秘密操作/,
    );
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("必选目标行动提前结束时不代选也不公开已提交的秘密目标", () => {
  const room = setup("classic", 9);
  const assassin = room.players.find((p) => room.roles[p.uid] === "assassin");
  const reverse = room.players.find((p) => room.roles[p.uid] === "reverse");
  begin(room, "reverseStrike");
  run(room, assassin.uid, "submit", { value: reverse.seat });
  cutoff(room);
  assert.equal(room.phase, "tools");
  assert.equal(room.convertedReverse, null);
  assert.equal(room.history.length, 1);
  assert.equal(room.history[0].kind, "toolCanceled");
  assert.equal(room.history[0].target, undefined);
  assert.equal(room.history[0].hit, undefined);
});


test("本人技能状态随技能资格变化，其他玩家与房主公共响应不泄露", () => {
  const room = knightsRoom();
  room.roles.p2 = "blueGuard";
  const state = room.knights.players.p2;
  const before = JSON.stringify(publicView(room, "p1"));
  assert.equal(privateView(room, "p2").skillStatus.title, "技能可用");
  state.used = true;
  assert.equal(privateView(room, "p2").skillStatus.title, "技能已用完");
  assert.equal(JSON.stringify(publicView(room, "p1")), before);
  assert.equal(privateView(room, "p1").skillStatus.title, "无主动技能");
  state.used = false;
  state.availableRound = room.knights.round + 1;
  assert.equal(privateView(room, "p2").skillStatus.title, "新技能尚未启用");
  begin(room, "skills");
  submitAll(room);
  begin(room, "skills");
  assert.equal(privateView(room, "p2").skillStatus.title, "技能可用");
});

test("猎人预选技能与圣骑士被动状态仅本人可见", () => {
  const room = knightsRoom();
  Object.assign(room.roles, {p1: "paladin", p2: "blueHunter"});
  begin(room, "skills");
  assert.equal(privateView(room, "p1").skillStatus.title, "被动反伤");
  assert.deepEqual(privateView(room, "p1").action.choices, ["pass"]);
  assert.equal(privateView(room, "p2").action.hunterModes, true);
  for (const p of room.players) assert.ok(!JSON.stringify(publicView(room, p.uid)).includes("hunterModes"));
});

test("SQLite重启保留预选被动枪，反伤与开枪原子结算且不重复消耗", () => {
  const { Store } = require("../server/store");
  const { mkdtempSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-revival-"));
  let store;
  try {
    const file = join(directory, "room.sqlite");
    store = new Store(file);
    let room = knightsRoom();
    Object.assign(room.roles, { p1: "blueAwakened", p2: "redHunter", p3: "paladin" });
    begin(room, "skills");
    run(room, "p1", "submit", {value: "target:2"});
    run(room, "p2", "submit", {value: "passive:3"});
    store.save(room);
    store.close();
    store = new Store(file);
    room = store.get(room.code);
    assert.equal(publicView(room, "p2").me.submitted, true);
    for (const p of room.players.filter(p => !["p1", "p2"].includes(p.uid))) run(room, p.uid, "submit", {value: "pass"});
    assert.equal(room.phase, "tools");
    assert.equal(room.knights.players.p3.used, true);
    assert.equal(room.knights.players.p3.alive, true);
    assert.equal(room.knights.players.p2.used, true);
    store.save(room);
    store.close();
    store = new Store(file);
    room = store.get(room.code);
    assert.equal(room.phase, "tools");
    assert.deepEqual(room.knights.summary.eliminated, [2]);
    assert.equal(room.history.filter(h => h.kind === "skillResult").length, 1);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("旧房间重启迁移红守卫为石像鬼，作废旧技能恢复快照且随机结果只生成一次", () => {
  const { Store } = require("../server/store");
  const { mkdtempSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const directory = mkdtempSync(join(tmpdir(), "shadowtable-rules-"));
  let store;
  try {
    const file = join(directory, "room.sqlite");
    store = new Store(file);
    let room = knightsRoom();
    Object.assign(room.roles, {p1: "blueAwakened", p2: "redGuard", p3: "paladin"});
    room.knights.deck = ["redGuard", "redHunter"];
    room.knights.players.p2.used = true;
    delete room.knights.rulesVersion;
    begin(room, "skills");
    room.phase = "paladinTurn"; // Old release persisted an interrupted revival.
    room.knights.players.p4.alive = false;
    store.save(room);
    store.close();
    store = new Store(file);
    room = store.get(room.code);
    assert.equal(room.phase, "tools");
    assert.equal(room.roles.p2, "gargoyle");
    assert.equal(room.knights.players.p4.alive, true);
    assert.equal(room.knights.players.p2.used, false);
    assert.deepEqual(room.knights.deck, ["gargoyle", "redHunter"]);
    assert.match(room.history.at(-1).text, /规则已更新/);
    assert.equal(publicView(room, "p2").me.identityChanged, true);
    const info = privateView(room, "p2").information;
    store.close();
    store = new Store(file);
    assert.equal(privateView(store.get(room.code), "p2").information, info);
  } finally {
    store?.close();
    rmSync(directory, {recursive: true, force: true});
  }
});
