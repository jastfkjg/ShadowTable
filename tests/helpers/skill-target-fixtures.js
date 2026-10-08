const { newRoom, enter, command, publicView, privateView } = require("../../server/engine");

const cases = [
  ["blueKnight", "duel", "target:7", false],
  ["redKnight", "duel", "target:7", false],
  ["gargoyle", "inspect", "inspect:7", true],
  ["blueGuard", "guard", "target:7", true],
  ["witch", "substitute", "target:7", true],
  ["magician", "swap", "swap:2:7", true],
  ["blueHunter", "detonate", "detonate:1", false],
  ["redHunter", "passive", "passive:7", false],
  ["blueAwakened", "sword", "target:7", false],
  ["redAwakened", "sword", "target:7", false],
  ["assassin", "final", "target:0", false],
];

function fixture(role, mode) {
  const source = newRoom("628421", "p1", "林间", "knights", 12);
  for (let i = 2; i <= 12; i++) enter(source, "p" + i, "玩家" + i);
  for (const player of source.players) command(source, player.uid, { type: "ready", ready: true, stage: source.stage });
  command(source, source.host, { type: "start", flexible: true, stage: source.stage });
  for (const player of source.players) {
    source.roles[player.uid] = "servant";
    Object.assign(source.knights.players[player.uid], { used: false, armor: false, availableRound: 1 });
  }
  source.roles.p2 = role;
  source.players[6].name = "<小鱼>";
  source.knights.players.p5.alive = false;
  command(source, source.host, { type: "beginActivity", kind: mode === "final" ? "assassination" : "skills", actor: 2, stage: source.stage });
  return { source, room: publicView(source, "p2"), secret: privateView(source, "p2") };
}

module.exports = { cases, fixture };
