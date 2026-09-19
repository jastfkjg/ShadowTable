const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { newRoom, enter, command, privateView } = require("../server/engine");
async function launch(opts = {}) {
  const app = createApp({ database: ":memory:", devAuth: true, ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  return {
    ...app,
    async close() {
      await new Promise((r) => app.server.close(r));
      app.store.close();
    },
    async boards() {
      const response = await fetch(base + "/api/boards");
      return { status: response.status, data: await response.json() };
    },
  };
}
const KINDS = new Set(["lines", "blocks", "roles"]);
function isValidSection(section) {
  return (
    typeof section.title === "string" &&
    section.title.length > 0 &&
    KINDS.has(section.kind) &&
    Array.isArray(section.items) &&
    section.items.length > 0 &&
    section.items.every((item) => {
      if (section.kind === "roles")
        return (
          item &&
          typeof item.name === "string" &&
          item.name.length > 0 &&
          typeof item.text === "string" &&
          item.text.length > 0 &&
          (item.meta === undefined || typeof item.meta === "string")
        );
      return typeof item === "string" && item.length > 0;
    })
  );
}
test("每个可用板子都带符合契约的板子详情，未收录板子为 null", async () => {
  const a = await launch();
  try {
    const { status, data } = await a.boards();
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.boards) && data.boards.length > 0);
    for (const board of data.boards) {
      assert.equal(typeof board.id, "string");
      assert.equal(typeof board.name, "string");
      if (!board.available) {
        assert.equal(board.detail, null);
        continue;
      }
      assert.ok(board.detail, `板子 ${board.id} 缺板子详情`);
      assert.equal(typeof board.detail.summary, "string");
      assert.ok(board.detail.summary.length > 0);
      assert.ok(
        Array.isArray(board.detail.sections) &&
          board.detail.sections.length > 0,
        `板子 ${board.id} 缺章节`,
      );
      for (const section of board.detail.sections)
        assert.ok(isValidSection(section), `板子 ${board.id} 章节不合法`);
    }
  } finally {
    await a.close();
  }
});
test("板子详情回归：可用板子仍保留角色配置，十二骑士技能卡与猎人规则齐全", async () => {
  const a = await launch();
  try {
    const { data } = await a.boards();
    const available = data.boards.filter((b) => b.available);
    for (const board of available) {
      assert.ok(board.roleConfigurations, `板子 ${board.id} 丢失角色配置`);
      assert.equal(
        Object.keys(board.roleConfigurations).length,
        board.counts.length,
      );
    }
    const knights = data.boards.find((b) => b.id === "knights");
    const roleSections = knights.detail.sections.filter(
      (s) => s.kind === "roles",
    );
    assert.ok(
      roleSections.length >= 4,
      "十二骑士的角色技能未按 A/B 牌堆与阵营分组",
    );
    assert.ok(
      roleSections[0].title.includes("A牌") &&
        roleSections[0].title.includes("好人"),
      "角色技能首组应为 A牌好人",
    );
    assert.ok(
      roleSections[roleSections.length - 1].title.includes("B牌") &&
        roleSections[roleSections.length - 1].title.includes("坏人"),
      "角色技能末组应为 B牌坏人",
    );
    const cards = roleSections.flatMap((s) => s.items);
    assert.ok(cards.length >= 10, "十二骑士技能卡少于 10 张");
    const hunter = cards.find((item) => item.name.includes("猎人"));
    assert.ok(hunter, "十二骑士缺少猎人技能卡");
    assert.ok(hunter.text.includes("自爆"), "猎人卡未说明主动自爆");
    assert.ok(hunter.text.includes("复活"), "猎人卡未说明复活后再出局不能开枪");
    const hunters = cards.filter((item) => item.name.includes("猎人"));
    assert.equal(hunters.length, 2, "蓝/红猎人应拆分到各自阵营分组");
    const bGood = roleSections.find(
      (s) => s.title.includes("B牌") && s.title.includes("好人"),
    );
    assert.ok(
      bGood.items.some((item) => item.name === "圣骑士"),
      "圣骑士应归入 B牌好人组",
    );
  } finally {
    await a.close();
  }
});
test("十二骑士10人局开局：A牌去红蓝兰斯洛特为6蓝4红，B牌堆不变，共用骑士技能模式", () => {
  const room = newRoom("654321", "p1", "房主", "knights-10", 10);
  for (let i = 2; i <= 10; i++) enter(room, `p${i}`, `玩家${i}`);
  room.players.forEach((p) =>
    command(room, p.uid, {
      type: "ready",
      stage: room.stage,
      ready: true,
    }),
  );
  command(room, "p1", { type: "start", stage: room.stage, flexible: true });
  assert.equal(room.phase, "tools");
  assert.ok(room.knights, "10人局应进入骑士技能模式");
  assert.equal(room.knights.deck.length, 12, "B牌堆应与12人局一致（12张）");
  assert.equal(room.knights.conversions.length, 7, "转换牌堆不变");
  assert.equal(
    room.knights.players[room.players[0].uid].armor,
    ["merlin", "percival", "morgana"].includes(room.roles[room.players[0].uid]),
  );
  const display = room.players.map((p) => privateView(room, p.uid).role);
  assert.equal(new Set(display).size, 9, "两位忠臣显示名相同，去重后应为 9 种");
  assert.equal(
    display.filter((r) => r === "亚瑟的忠臣").length,
    2,
    "应有两位忠臣",
  );
  assert.ok(!display.includes("蓝兰斯洛特") && !display.includes("红兰斯洛特"), "A牌应无兰斯洛特");
  const roles = new Set(display);
  for (const expected of [
    "梅林",
    "派西维尔",
    "亚瑟的忠臣",
    "蓝刀客·加雷斯",
    "蓝刀客·加赫雷斯",
    "红刀客·奥伯伦",
    "刺客",
    "莫德雷德",
    "莫甘娜",
  ])
    assert.ok(roles.has(expected), `缺少初始身份 ${expected}`);
});
test("/api/boards 提供 knights-10 板子与详情，A牌描述与技能卡均无兰斯洛特", async () => {
  const a = await launch();
  try {
    const { data } = await a.boards();
    const board = data.boards.find((b) => b.id === "knights-10");
    assert.ok(board, "缺少 knights-10 板子");
    assert.equal(board.available, true);
    assert.deepEqual(board.counts, [10]);
    assert.ok(board.roleConfigurations && board.roleConfigurations[10]);
    assert.ok(board.detail, "knights-10 缺板子详情");
    const deck = board.detail.sections
      .find((s) => s.title === "AB 牌堆与身份构成")
      .items.join("");
    assert.ok(deck.startsWith("A 牌 10 张"), "knights-10 A牌应为 10 张");
    assert.ok(deck.includes("无红蓝兰斯洛特"), "A牌描述未说明去掉兰斯洛特");
    const roleSections = board.detail.sections.filter((s) => s.kind === "roles");
    assert.ok(roleSections.length >= 4, "knights-10 角色技能未分组");
    assert.ok(
      roleSections
        .flatMap((s) => s.items)
        .every((i) => !i.name.includes("兰斯洛特")),
      "knights-10 技能卡仍含兰斯洛特",
    );
    const team = board.detail.sections
      .find((s) => s.title === "组队与表决")
      .items[0];
    assert.ok(team.includes("3 / 4 / 4 / 5 / 5"), "knights-10 任务人数表应为10人标准");
    assert.equal(
      data.boards.find((b) => b.id === "knights").counts[0],
      12,
      "12人骑士板子不受影响",
    );
  } finally {
    await a.close();
  }
});