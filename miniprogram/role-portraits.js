// Role art is shared by archetype; the full recorded role and faction stay visible.
const portraits = {
  "梅林": "merlin", "派西维尔": "percival", "派西": "percival",
  "亚瑟的忠臣": "servant", "忠臣": "servant", "逆仆": "servant",
  "刺客": "assassin", "莫甘娜": "morgana", "莫德雷德": "mordred", "奥伯伦": "oberon",
  "蓝兰斯洛特": "lancelot", "红兰斯洛特": "lancelot", "兰斯洛特": "lancelot",
  "蓝刀客·加雷斯": "swordsman", "蓝刀客·加赫雷斯": "swordsman", "红刀客·奥伯伦": "swordsman",
  "觉醒蓝刀客": "swordsman", "觉醒红刀客": "swordsman",
  "蓝骑士": "lancelot", "红骑士": "lancelot", "高文": "paladin",
  "蓝猎人": "hunter", "红猎人": "hunter", "猎人": "hunter",
  "蓝守卫": "guard", "守卫": "guard", "守护者": "guard", "圣骑士": "paladin",
  "魔术师": "magician", "蓝术士": "magician", "红术士": "magician",
  "月下先知": "prophet", "先知": "prophet", "女巫": "witch", "石像鬼": "mordred",
  "蓝盗贼": "thief", "红盗贼": "thief", "盗贼": "thief", "捣蛋鬼": "thief",
  "蓝内奸": "assassin", "红内奸": "assassin",
};
const factionLabels = { good: "好人阵营", evil: "坏人阵营", third: "盗贼阵营", unknown: "未知阵营" };
function portrait(role, faction) {
  const name = String(role || "未知角色");
  const split = name.indexOf("·");
  const art = portraits[name] || ({ good: "servant", evil: "mordred", third: "thief" })[faction] || "guard";
  return {
    roleKey: String(faction || "unknown") + ":" + name,
    portrait: "/assets/roles/" + art + ".png",
    roleTitle: split > 0 ? name.slice(0, split) : name,
    roleSubtitle: split > 0 ? name.slice(split + 1) : "",
    factionLabel: factionLabels[faction] || factionLabels.unknown,
  };
}
module.exports = { portrait };
