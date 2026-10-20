const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { BOARDS } = require("../server/engine");
const details = require("../server/board-info");
const presentation = require("../miniprogram/board-detail");
const board = (id, capacity) =>
  presentation.presentBoard(
    { ...BOARDS.find((b) => b.id === id), detail: details[id] },
    capacity,
  );

test("所有可用板子与人数保留规则和当前角色配置；非技能板直接阅读规则", () => {
  for (const source of BOARDS.filter((b) => b.available))
    for (const capacity of source.counts) {
      const snapshot = JSON.stringify(details[source.id]);
      const view = board(source.id, capacity);
      assert.equal(view.capacity, capacity);
      assert.deepEqual(
        view.chapters
          .filter((c) => c.kind !== "configuration")
          .map((c) => c.items),
        details[source.id].sections
          .filter((c) => c.kind !== "roles")
          .map((c) => c.items),
      );
      if (!view.hasRoles) {
        assert.equal(view.defaultTab, "rules");
        assert.deepEqual(
          view.chapters[0].configuration,
          source.roleConfigurations[capacity],
        );
        assert.equal(
          view.chapters[0].configuration.reduce((sum, c) => sum + c.count, 0),
          capacity,
        );
      }
      assert.equal(JSON.stringify(details[source.id]), snapshot);
    }
  assert.equal(board("classic", 9).title, "9人逆仆");
  const fallback = presentation.presentBoard(
    {
      name: "未收录",
      roleConfigurations: { 6: [{ faction: "good", roles: "忠臣", count: 6 }] },
    },
    6,
  );
  assert.equal(fallback.hasDetail, false);
  assert.equal(fallback.chapters[0].configuration[0].count, 6);
});

test("骑士各人数独立展示 A 牌、特殊注记与对应的 B 牌层序，完整角色文字不丢失", () => {
  for (const [id, capacity, good, evil] of [
    ["knights", 12, 7, 5],
    ["knights-10", 10, 6, 4],
    ["knights-11", 11, 7, 4],
    ["knights-13", 13, 8, 5],
  ]) {
    const view = board(id, capacity),
      [a, b] = view.chapters[0].decks;
    assert.deepEqual([a.count, a.good, a.evil], [capacity, good, evil]);
    assert.deepEqual([b.count, b.good, b.evil], [12, 7, 5]);
    assert.deepEqual(
      b.layers.map((layer) => layer.text),
      capacity === 10
        ? ["1 红 + 2 蓝", "2 红 + 2 蓝", "2 红 + 3 蓝"]
        : ["2 红 + 3 蓝", "2 红 + 2 蓝", "1 红 + 2 蓝"],
    );
    assert.ok(b.note.includes(capacity === 10
      ? "第 1–3 张 2 好 1 坏，第 4–7 张 2 好 2 坏，第 8–12 张 3 好 2 坏"
      : "第 1–5 张 3 好 2 坏，第 6–9 张 2 好 2 坏，第 10–12 张 2 好 1 坏"));
    assert.deepEqual(
      view.groups.map((g) => g.id),
      ["b-good", "b-evil", "a"],
    );
    for (const role of view.roles)
      assert.equal(
        role.facts.map((f) => f.text).join("") + role.exception,
        role.text,
      );
    const original = details[id].sections
      .filter((s) => s.kind === "roles")
      .flatMap((s) => s.items);
    assert.deepEqual(
      view.roles.map((r) => r.text),
      original.map((r) => r.text),
    );
  }
  assert.match(
    board("knights-10", 10).chapters[0].decks[0].note,
    /无红蓝兰斯洛特/,
  );
  assert.match(
    board("knights-11", 11).chapters[0].decks[0].note,
    /被梅林视为坏人/,
  );
});

test("搜索跨越牌组并支持技能关键词，清空后回到所选牌组，展开状态不会串角色", () => {
  const view = board("knights", 12),
    first = presentation.visibleRoles(view, "b-good");
  assert.equal(first.length, 7);
  assert.ok(
    presentation
      .visibleRoles(view, "b-good", "女巫")
      .some((r) => r.name === "女巫"),
  );
  assert.deepEqual(
    presentation.visibleRoles(view, "b-good", "石像鬼 查验").map((r) => r.name),
    ["石像鬼"],
  );
  assert.equal(presentation.visibleRoles(view, "b-good", "不存在").length, 0);
  assert.equal(presentation.visibleRoles(view, "b-evil", "").length, 5);
  const expanded = presentation.visibleRoles(view, "b-good", "", {
    [first[0].id]: true,
  });
  assert.equal(expanded.filter((r) => r.expanded).length, 1);
  assert.match(expanded[0].exception, /不能反伤红女巫/);
});

function mini(request) {
  let definition, title, scrollTop;
  vm.runInNewContext(
    fs.readFileSync(
      require.resolve("../miniprogram/pages/board-details/board-details.js"),
      "utf8",
    ),
    {
      Page: (p) => {
        definition = p;
      },
      require: (name) =>
        name === "../../api"
          ? { request }
          : name === "../../board-detail"
            ? presentation
            : name === "../../board-detail-art"
              ? require("../miniprogram/board-detail-art")
            : { switchHomeTab() {} },
      wx: {
        setNavigationBarTitle: (value) => {
          title = value.title;
        },
        createSelectorQuery: () => ({
          select() {
            return this;
          },
          boundingClientRect() {
            return this;
          },
          selectViewport() {
            return this;
          },
          scrollOffset() {
            return this;
          },
          exec(fn) {
            fn([{ height: 48 }, { top: 280 }, { scrollTop: 100 }]);
          },
        }),
        pageScrollTo: (value) => {
          scrollTop = value.scrollTop;
        },
      },
    },
  );
  const page = {
    ...definition,
    alive: true,
    boardId: "knights",
    capacity: 12,
    data: structuredClone(definition.data),
    setData(values, cb) {
      Object.assign(this.data, values);
      cb?.();
    },
  };
  return { page, title: () => title, scrollTop: () => scrollTop };
}
const tap = (data) => ({ currentTarget: { dataset: data } });
test("角色插画覆盖各人数配置，数量与阵营不变，牌堆示意保持原始规则文字", () => {
  const { decorateBoard } = require("../miniprogram/board-detail-art");
  for (const source of BOARDS.filter(b => b.available)) for (const capacity of source.counts) {
    const original = board(source.id, capacity), snapshot = JSON.stringify(original), decorated = decorateBoard(original);
    assert.equal(JSON.stringify(original), snapshot);
    for (const role of decorated.roles) {
      assert.equal(role.text, original.roles.find(r => r.id === role.id).text);
      assert.ok(fs.existsSync(require("node:path").resolve(__dirname, "../miniprogram" + role.portrait)));
    }
    for (const chapter of decorated.chapters) {
      for (const faction of chapter.configuration || []) {
        assert.equal(faction.members.reduce((sum, member) => sum + member.count, 0), faction.count);
        for (const member of faction.members) assert.ok(fs.existsSync(require("node:path").resolve(__dirname, "../miniprogram" + member.portrait)));
      }
      for (const deck of chapter.decks || []) for (const layer of deck.layers || []) {
        assert.equal(layer.cards.filter(c => c.tone === "evil").length, Number(layer.text.match(/^(\d+)/)[1]));
        assert.equal(layer.cards.filter(c => c.tone === "good").length, Number(layer.text.match(/(\d+) 蓝$/)[1]));
      }
    }
  }
});
test("小程序搜索、切换、目录展开后定位和折叠状态一致；卸载与重试处理正常", async () => {
  const source = BOARDS.find((b) => b.id === "knights");
  const result = { boards: [{ ...source, detail: details.knights }] };
  const m = mini(async () => result);
  await m.page.load();
  assert.equal(m.title(), "阿瓦隆 · 十二骑士");
  m.page.toggleRole(tap({ id: "0:0" }));
  assert.equal(m.page.data.visibleRoles[0].expanded, true);
  m.page.searchRoles({ detail: { value: "女巫" } });
  assert.ok(m.page.data.visibleRoles.some((r) => r.name === "女巫"));
  m.page.selectGroup(tap({ group: "b-evil" }));
  assert.equal(m.page.data.query, "");
  assert.equal(m.page.data.visibleRoles.length, 5);
  m.page.toggleDirectory();
  m.page.jumpSection(tap({ index: 3 }));
  assert.equal(m.page.data.tab, "rules");
  assert.equal(m.page.data.directoryExpanded, false);
  assert.equal(m.page.data.chapters[3].expanded, true);
  assert.equal(m.scrollTop(), 256);
  m.page.toggleAll();
  assert.ok(m.page.data.chapters.every((c) => c.expanded));
  m.page.toggleAll();
  assert.ok(m.page.data.chapters.every((c) => !c.expanded));
  let release;
  const gone = mini(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const loading = gone.page.load();
  gone.page.onUnload();
  release(result);
  await loading;
  assert.equal(gone.page.data.board, null);
  let failed = true;
  const retry = mini(async () => {
    if (failed) throw new Error("网络失败");
    return result;
  });
  await retry.page.load();
  assert.equal(retry.page.data.error, "网络失败");
  failed = false;
  await retry.page.load();
  assert.equal(retry.page.data.error, "");
  assert.equal(retry.page.data.loading, false);
});
