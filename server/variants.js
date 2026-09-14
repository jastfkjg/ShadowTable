"use strict";
// Variant metadata and anonymous quest aggregation. No player information here.
const roles = {
  blueWarlock: ["蓝术士", "good"],
  redWarlock: ["红术士", "evil"],
  gawain: ["高文", "good"],
  trickster: ["捣蛋鬼", "good"],
  blueThief: ["蓝盗贼", "third"],
  redThief: ["红盗贼", "third"],
  gareth: ["蓝刀客·加雷斯", "good"],
  gaheris: ["蓝刀客·加赫雷斯", "good"],
  blueLancelot: ["蓝兰斯洛特", "good"],
  redLancelot: ["红兰斯洛特", "evil"],
  redSwordsman: ["红刀客·奥伯伦", "evil"],
  blueAwakened: ["觉醒蓝刀客", "good"],
  redAwakened: ["觉醒红刀客", "evil"],
  blueKnight: ["蓝骑士", "good"],
  redKnight: ["红骑士", "evil"],
  blueHunter: ["蓝猎人", "good"],
  redHunter: ["红猎人", "evil"],
  blueGuard: ["蓝守卫", "good"],
  redGuard: ["红守卫", "evil"],
  paladin: ["圣骑士", "good"],
  magician: ["魔术师", "good"],
  prophet: ["月下先知", "good"],
  witch: ["女巫", "evil"],
};
const decks = {
  chaos: [
    "merlin",
    "percival",
    "servant",
    "blueWarlock",
    "gawain",
    "trickster",
    "mordred",
    "morgana",
    "redWarlock",
    "oberon",
    "blueThief",
    "redThief",
  ],
  knights: [
    "merlin",
    "percival",
    "servant",
    "servant",
    "gareth",
    "gaheris",
    "blueLancelot",
    "redSwordsman",
    "redLancelot",
    "assassin",
    "mordred",
    "morgana",
  ],
};
function chaosQuest(values, threshold) {
  const counts = Object.fromEntries(
    ["success", "fail", "thiefFail", "magic"].map((k) => [
      k,
      values.filter((v) => v === k).length,
    ]),
  );
  const fails = counts.fail + counts.thiefFail;
  let success = fails < threshold;
  if (counts.thiefFail && threshold === 1) success = false;
  else if (counts.magic % 2) success = !success;
  return { fails, success, counts };
}
module.exports = { roles, decks, chaosQuest };
