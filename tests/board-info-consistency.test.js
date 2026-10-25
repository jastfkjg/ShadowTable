const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  BOARDS,
  TEAMS,
  newRoom,
  enter,
  command,
  privateView,
  roleName,
} = require("../server/engine");
const details = require("../server/board-info");
const { presentBoard } = require("../miniprogram/board-detail");

const configurations = BOARDS.filter((b) => b.available).flatMap((board) =>
  board.counts.map((capacity) => ({ board, capacity })),
);

test("全部已开放配置正文具有当前任务表、初始视野与湖仙规则，没有重复段落", () => {
  assert.equal(configurations.length, 17);
  for (const { board, capacity } of configurations) {
    const key = `${board.id}/${capacity}`;
    const detail = details[board.id].byCapacity[capacity];
    const view = presentBoard(
      { ...board, detail: details[board.id] },
      capacity,
    );
    const lines = detail.sections
      .filter((s) => s.kind !== "roles")
      .flatMap((s) => s.items);
    assert.equal(
      new Set(detail.sections.map((s) => s.title)).size,
      detail.sections.length,
      key,
    );
    assert.equal(new Set(lines).size, lines.length, `${key} 重复规则`);
    const tasks = lines.filter((line) => line.includes("五轮任务人数为"));
    assert.equal(tasks.length, 1, `${key} 任务配置缺失或重复`);
    assert.ok(tasks[0].includes(TEAMS[capacity].join(" / ")), key);
    assert.match(
      tasks[0],
      capacity < 7 ? /每轮一张失败/ : /第 4 轮需两张失败.*其余轮次一张失败/,
    );
    assert.equal(
      view.chapters.filter((c) => c.title === "初始视野").length,
      1,
      key,
    );
    const fairy = detail.sections.find((s) => s.title === "湖中仙女");
    if (capacity < 7)
      assert.deepEqual(fairy.items, [`${capacity} 人局不使用湖中仙女。`]);
    else
      assert.ok(
        fairy.items[0].startsWith(
          `${capacity} 人局默认${capacity === 7 ? "关闭" : "开启"}`,
        ),
        key,
      );
    assert.doesNotMatch(
      JSON.stringify(view),
      /三张(?:任务|成功|失败)|由房主结束本局|任务人数与两失败门槛由服务端|奥伯伦不强制失败/,
    );
  }
});

test("各人数骑士卡使用本人数猎人邻座，初始视野和转换只涉及当前角色", () => {
  for (const [id, capacity] of [
    ["knights-10", 10],
    ["knights-11", 11],
    ["knights", 12],
    ["knights-13", 13],
  ]) {
    const view = presentBoard(
      { ...BOARDS.find((b) => b.id === id), detail: details[id] },
      capacity,
    );
    const vision = view.chapters
      .find((s) => s.title === "初始视野")
      .items.join("");
    assert.equal(vision.includes("蓝兰斯洛特"), capacity !== 10);
    assert.equal(vision.includes("红兰斯洛特"), capacity >= 12);
    assert.equal(vision.includes("逆仆"), false);
    if (capacity === 11) assert.match(vision, /蓝兰斯洛特（视为坏人）/);
    if (capacity >= 12) assert.match(vision, /看不到莫德雷德和蓝兰斯洛特/);
    for (const role of view.roles.filter((r) => /^(蓝|红)猎人$/.test(r.name)))
      assert.ok(
        role.text.includes(`${capacity} 号邻座为 1 号与 ${capacity - 1} 号`),
      );
    for (const role of view.roles.filter((r) => /^觉醒/.test(r.name))) {
      assert.match(role.text, /不受 A 刀的目标身份限制/);
      assert.doesNotMatch(role.brief, /按 A 刀/);
    }
    const conversions = view.chapters
      .find((s) => s.title === "B 牌、复活与转换")
      .items.join("");
    if (capacity === 10) {
      assert.match(conversions, /没有兰斯洛特，无需进行兰斯阵营转换/);
      assert.doesNotMatch(conversions, /身份转换：/);
    } else assert.match(conversions, /按线下进度独立发起/);
    if (capacity === 11) assert.match(conversions, /蓝兰斯洛特切换阵营/);
    const supplements = view.chapters.find((s) => s.title === "补充约定").items;
    assert.equal(supplements.filter((s) => s.includes("提前起刀")).length, 1);
    assert.doesNotMatch(JSON.stringify(view), /第 2–5 轮|最多五轮|替代红守卫/);
  }
  assert.notEqual(details.knights.sections, details["knights-10"].sections);
  assert.notEqual(
    details.knights.sections.find((s) => s.title === "补充约定").items,
    details["knights-11"].sections.find((s) => s.title === "补充约定").items,
  );
});

function started(board, capacity) {
  const room = newRoom("123456", "p1", "房主", board, capacity);
  for (let seat = 2; seat <= capacity; seat++)
    enter(room, `p${seat}`, `玩家${seat}`);
  for (const player of room.players)
    command(room, player.uid, {
      type: "ready",
      stage: room.stage,
      ready: true,
    });
  command(room, "p1", { type: "start", stage: room.stage, flexible: true });
  return room;
}

test("全配置梅林视野与实际发牌一致，扩展板说明列出的可见身份与私密视野一致", () => {
  for (const { board, capacity } of configurations) {
    const room = started(board.id, capacity);
    const merlin = room.players.find((p) => room.roles[p.uid] === "merlin");
    const allowed =
      board.id === "shadow-assist"
        ? ["morgana", "assassin", "oberon", "redTraitor"]
        : board.id === "chaos"
          ? ["morgana", "redWarlock", "oberon", "redThief"]
          : board.id.startsWith("knights")
            ? [
                "assassin",
                "morgana",
                "redSwordsman",
                "redLancelot",
                ...(capacity === 11 ? ["blueLancelot"] : []),
              ]
            : ["morgana", "assassin", "oberon", "redLancelot", "reverse"];
    const seen = privateView(room, merlin.uid).information.match(
      /：([\d、]*)/,
    )[1];
    const expected = room.players.filter((p) =>
      allowed.includes(room.roles[p.uid]),
    );
    assert.equal(
      seen,
      expected.map((p) => p.seat).join("、"),
      `${board.id}/${capacity}`,
    );
    if (
      board.id.startsWith("knights") ||
      ["shadow-assist", "chaos", "lancelot"].includes(board.id)
    ) {
      const description = details[board.id].byCapacity[capacity].sections.find(
        (s) => s.title === "初始视野",
      ).items[0];
      const visibleDescription = description.split(/，(?:但)?看不到|；/)[0];
      for (const player of expected)
        assert.ok(
          visibleDescription.includes(roleName(room.roles[player.uid])),
          description,
        );
    }
  }
  assert.match(
    details.chaos.sections.find((s) => s.title === "初始视野").items[1],
    /互见同伴座位与具体身份/,
  );
  assert.match(
    details["shadow-assist"].sections.find((s) => s.title === "初始视野")
      .items[1],
    /互认但不区分身份/,
  );
  assert.doesNotMatch(
    details["shadow-assist"].sections
      .find((s) => s.title === "线上线下分工")
      .items.join(""),
    /初始互认.*在线下完成/,
  );
});
