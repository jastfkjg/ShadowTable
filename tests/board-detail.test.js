const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
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