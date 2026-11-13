(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.shadowtableRolePortraits = factory();
})(typeof window !== "undefined" ? window : this, function () {
// Named variants retain their own art even when their recorded faction changes.
const portraits = {
  "梅林": "merlin", "派西维尔": "percival", "派西": "percival",
  "亚瑟的忠臣": "servant", "忠臣": "servant", "逆仆": "servant",
  "刺客": "assassin", "莫甘娜": "morgana", "莫德雷德": "mordred", "奥伯伦": "oberon",
  "蓝兰斯洛特": "lancelot-blue", "红兰斯洛特": "lancelot-red", "兰斯洛特": "lancelot",
  "蓝刀客·兰斯洛特": "lancelot-blue", "红刀客·兰斯洛特": "lancelot-red",
  "蓝刀客·加雷斯": "gareth", "蓝刀客·加赫雷斯": "gaheris", "红刀客·奥伯伦": "oberon",
  "加雷斯": "gareth", "加赫雷斯": "gaheris",
  "觉醒蓝刀客": "awakened-blue", "觉醒红刀客": "awakened-red",
  "蓝骑士": "knight-blue", "红骑士": "knight-red", "高文": "paladin",
  "蓝猎人": "hunter-blue", "红猎人": "hunter-red", "猎人": "hunter",
  "蓝守卫": "guard-blue", "红守卫": "guard-red", "守卫": "guard", "守护者": "guard", "圣骑士": "paladin",
  "魔术师": "magician", "蓝术士": "magician-blue", "红术士": "magician-red",
  "月下先知": "prophet", "先知": "prophet", "女巫": "witch", "石像鬼": "gargoyle",
  "蓝盗贼": "thief-blue", "红盗贼": "thief-red", "盗贼": "thief", "捣蛋鬼": "thief",
  "蓝内奸": "spy-blue", "红内奸": "spy-red",
};
// Also retain the generic swordsman used by profession-only fun records.
const assetNames = Array.from(new Set([...Object.values(portraits), "swordsman"]));
const factionLabels = { good: "好人阵营", evil: "坏人阵营", third: "盗贼阵营", unknown: "未知阵营" };
function portrait(role, faction) {
  const name = String(role || "未知角色");
  const lookup = name.trim().replace(/\s*·\s*/g, "·");
  const split = name.indexOf("·");
  const art = (Object.prototype.hasOwnProperty.call(portraits, lookup) && portraits[lookup]) || ({ good: "servant", evil: "mordred", third: "thief" })[faction] || "guard";
  return {
    roleKey: String(faction || "unknown") + ":" + name,
    portrait: "/assets/roles/" + art + ".png",
    roleTitle: split > 0 ? name.slice(0, split) : name,
    roleSubtitle: split > 0 ? name.slice(split + 1) : "",
    factionLabel: factionLabels[faction] || factionLabels.unknown,
  };
}
return { portrait, assetNames };
});
