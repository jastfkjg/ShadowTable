"use strict";

const RuleError = require("./rule-error");

const fields = {
  knife: { label: "带刀方", options: { evil: "坏人带刀", traitor: "红内奸带刀" } },
  blueSolo: { label: "蓝内奸独赢判定", options: { no: "未达成独赢", yes: "上车条件已满足，刺中蓝内奸则独赢" } },
  thieves: { label: "盗贼结果", options: { win: "盗贼获胜", loss: "盗贼失败" } },
  trickster: { label: "捣蛋鬼归属", options: { good: "好人阵营", evil: "坏人阵营", third: "盗贼阵营", mixed: "绑定不同阵营，挡刀时成为第四方" } },
};
function validate(tables, boards) {
  for (const [board, table] of Object.entries(tables || {})) {
    if (!boards[board] || !["chaos", "shadow-assist"].includes(board) || !table.title || !table.note) throw Error("板子计分配置无效");
    const chaos = board === "chaos";
    const groups = ["merlinPercival", "good", "evil", ...(chaos ? ["third"] : ["redTraitor", "blueTraitor"])];
    const cases = ["red", ...(chaos ? ["win", "loss"] : ["evil", "traitor"]).flatMap(prefix =>
      ["miss", "hit", "shield"].map(result => prefix + "_" + result))];
    for (const id of cases) {
      const row = table.scenarios?.[id];
      const required = chaos && id.endsWith("_shield") ? [...groups, "fourth"] : groups;
      if (!row?.label || !required.every(key => table.groups?.[key] && Number.isSafeInteger(row.points?.[key]))) {
        throw Error("板子计分行缺少角色或分值：" + board + "/" + id);
      }
    }
  }
}
function registrationFields(board, assassination) {
  const keys = board === "chaos" ? (assassination ? ["thieves", "trickster"] : ["trickster"])
    : assassination ? ["knife", "blueSolo"] : [];
  return keys.map(id => ({ id, label: fields[id].label,
    options: Object.entries(fields[id].options).map(([value, label]) => ({ value, label })) }));
}
function settle(board, option, input, players, facts, winner) {
  const choices = {};
  for (const field of option.boardFields) {
    const value = input.boardChoices?.[field.id];
    if (!field.options.some(choice => choice.value === value)) throw new RuleError("请确认" + field.label);
    choices[field.id] = value;
  }
  const target = players.find(p => p.seat === facts.target)?.roleId;
  let scenario = "red";
  if (option.requiresTarget && board === "shadow-assist") {
    const hitBlue = target === "blueTraitor";
    scenario = choices.knife + "_" + (hitBlue ? "shield" : target === "merlin" ? "hit" : "miss");
    if (hitBlue && choices.blueSolo === "yes") winner = "blueTraitor";
    else if (choices.knife === "traitor" && target === "merlin") winner = "redTraitor";
  }
  if (option.requiresTarget && board === "chaos") {
    const shield = choices.trickster === "mixed" && target === "trickster";
    scenario = choices.thieves + "_" + (shield ? "shield" : target === "merlin" ? "hit" : "miss");
    if (choices.thieves === "win") winner = "third";
    else if (shield) winner = "fourth";
  }
  // A side can act collectively. Only the red traitor identifies an individual knife holder.
  const actor = choices.knife === "traitor" ? players.find(player => player.roleId === "redTraitor") : null;
  return { winner, facts: { ...facts, board, choices, scenario, ...(option.requiresTarget ? { actor: actor?.seat ?? null } : {}) } };
}
function faction(player, facts) {
  if (facts.board === "chaos" && player.roleId === "trickster") {
    if (facts.choices.trickster === "mixed") return facts.target === player.seat ? "fourth" : "good";
    return facts.choices.trickster;
  }
  if (facts.board === "shadow-assist") {
    if (player.roleId === "redTraitor") return facts.reason === "assassination" ? "redTraitor" : "evil";
    if (player.roleId === "blueTraitor") return facts.choices.blueSolo === "yes" && facts.target === player.seat ? "blueTraitor" : "good";
  }
  return player.faction;
}
function baseAward(player, facts, boardRule) {
  const scenario = boardRule.scenarios[facts.scenario];
  const group = ["merlin", "percival"].includes(player.roleId) ? "merlinPercival"
    : Object.hasOwn(boardRule.groups, player.roleId) ? player.roleId : player.faction;
  return { id: "board_base", label: scenario.label, points: scenario.points[group] };
}
function sections(rules) {
  return Object.entries(rules.boardScores || {}).map(([id, board]) => ({
    id, title: board.title, note: board.note,
    scenarios: Object.entries(board.scenarios).map(([key, scenario]) => ({
      id: key, label: scenario.label, scores: Object.entries(scenario.points).map(([group, points]) => ({
        label: board.groups[group], points,
      })),
    })),
  }));
}

module.exports = { validate, registrationFields, settle, faction, baseAward, sections };
