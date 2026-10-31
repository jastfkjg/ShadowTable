const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  newRoom,
  enter,
  command,
  privateView,
  publicView,
} = require("../server/engine");
const boards = require("../server/board-info");
const { presentIdentity } = require("../miniprogram/identity-vision");

function setup(board, capacity) {
  const room = newRoom("123456", "p1", "房主", board, capacity);
  for (let seat = 2; seat <= capacity; seat++)
    enter(room, "p" + seat, "玩家" + seat);
  for (const p of room.players)
    command(room, p.uid, { type: "ready", ready: true, stage: room.stage });
  command(room, "p1", { type: "start", flexible: true, stage: room.stage });
  return room;
}

test("所有人数的 A/B 角色：板子与实际私密身份共用完整说明，读取不改变游戏状态", () => {
  for (const [board, capacity] of [
    ["knights-10", 10],
    ["knights-11", 11],
    ["knights", 12],
    ["knights-13", 13],
  ]) {
    const room = setup(board, capacity);
    const sections = boards[board].byCapacity[capacity].sections.filter(
      (s) => s.kind === "roles",
    );
    const cards = sections.flatMap((s) => s.items);
    const initialRoles = new Set(Object.values(room.roles));
    const expected = new Set([...initialRoles, ...room.knights.deck]);
    assert.deepEqual(new Set(cards.map((c) => c.roleId)), expected);
    for (const card of cards) {
      room.roles.p1 = card.roleId;
      room.knights.players.p1.b = !initialRoles.has(card.roleId);
      const before = JSON.stringify(room),
        secret = privateView(room, "p1");
      const info = presentIdentity(secret);
      assert.equal(info.ability.brief, card.brief);
      assert.deepEqual(info.ability.lines, card.facts);
      assert.equal(info.ability.note, card.exception);
      assert.equal(
        card.text,
        info.ability.lines.map((f) => f.text).join("") + info.ability.note,
      );
      assert.deepEqual(
        presentIdentity(secret.identityHistory[0]).ability,
        info.ability,
      );
      assert.equal(JSON.stringify(room), before);
      assert.doesNotMatch(
        JSON.stringify(publicView(room, "p2")),
        /角色能力|roleHelp|identityHistory/,
      );
    }
  }
});

test("新版能力分区不吞掉先知结果、石像鬼多次记录和仙女结果，历史快照独立保留", () => {
  const room = setup("knights", 12),
    state = room.knights.players.p1;
  room.roles.p1 = "prophet";
  state.b = true;
  state.nightInfo = "第3轮B牌坏人：2、8号";
  const prophet = privateView(room, "p1"),
    shown = presentIdentity(prophet);
  assert.equal(shown.passive.result, "2、8号");
  assert.ok(shown.ability.brief.includes("红方 B 牌"));
  room.roles.p1 = "gargoyle";
  state.gargoyleHistory = [
    { number: 1, seat: 4, canKill: true, initial: true },
    { number: 2, seat: 9, canKill: false },
  ];
  const secret = privateView(room, "p1");
  const withFairy = {
    ...secret,
    information: secret.information.replace(
      "\n\n角色能力",
      " 7号查验结果：好人（第2轮）\n\n角色能力",
    ),
  };
  const info = presentIdentity(withFairy);
  assert.deepEqual(
    info.inspections.map((r) => r.seat),
    [4, 9],
  );
  assert.equal(info.fairy.seat, 7);
  assert.match(info.ability.note, /不代表对方还有技能次数/);
  assert.equal(presentIdentity(prophet).passive.result, "2、8号");
});
