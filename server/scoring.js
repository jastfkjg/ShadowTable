"use strict";
const configured = require("./scoring-rules.json");
const { createHash } = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const conditionKeys = new Set(["faction", "outcome", "roleId", "reason", "isTarget"]);
function validateRules(rules) {
  if (!rules.version || !rules.title || !rules.scopeLabel || !rules.boards || !Array.isArray(rules.awards)
    || !Array.isArray(rules.endReasons) || !Array.isArray(rules.excludedIdentityPrefixes)) throw Error("积分规则配置不完整");
  const ids = new Set();
  for (const award of rules.awards) {
    if (!award.id || ids.has(award.id) || !award.label || !Number.isSafeInteger(award.points) || award.points < -100 || award.points > 100
      || !award.when || Object.keys(award.when).some(key => !conditionKeys.has(key))) throw Error("积分奖励配置无效");
    ids.add(award.id);
  }
  ids.clear();
  for (const reason of rules.endReasons) {
    if (!reason.id || ids.has(reason.id) || !reason.label || (reason.requiresTarget !== true && !["good", "evil"].includes(reason.winner))) throw Error("积分结束原因无效");
    ids.add(reason.id);
  }
  const bonus = rules.streakBonus;
  if (!bonus || typeof bonus.enabled !== "boolean" || !Number.isSafeInteger(bonus.threshold) || bonus.threshold < 2
    || !Number.isSafeInteger(bonus.points) || bonus.points < 0 || bonus.points > 100 || !bonus.label) throw Error("连胜奖励配置无效");
  return rules;
}
validateRules(configured);
function policy() {
  const rules = clone(configured);
  // Also identify the contents, so an accidentally reused version cannot rewrite history.
  rules.fingerprint = createHash("sha256").update(JSON.stringify(configured)).digest("hex");
  return rules;
}
function exclusion(room, rules = room.scorePolicy) {
  if (!rules) return "积分功能启用前开局";
  if (!rules.boards[room.board]?.includes(room.capacity)) return "本板子暂未参与计分";
  if (room.testRoom || room.players.some(p => rules.excludedIdentityPrefixes.some(prefix => p.uid.startsWith(prefix)))) return "测试或开发对局不计积分";
  return null;
}
function settlementOptions(room) {
  return exclusion(room) ? [] : clone(room.scorePolicy.endReasons);
}
function scorePlayer(player, facts, rules, excludedReason) {
  if (excludedReason) return { status: "excluded", total: 0, breakdown: [], reason: excludedReason, ruleVersion: rules?.version || null };
  const context = { ...player, reason: facts.reason, isTarget: player.seat === facts.target };
  const breakdown = rules.awards.filter(award => Object.entries(award.when).every(([key, value]) =>
    Array.isArray(value) ? value.includes(context[key]) : context[key] === value))
    .filter(award => award.points !== 0).map(({ id, label, points }) => ({ id, label, points }));
  return { status: "scored", total: breakdown.reduce((sum, item) => sum + item.points, 0), breakdown,
    ruleVersion: rules.version, ruleFingerprint: rules.fingerprint };
}
function publicRules(rules = policy()) {
  const roleNames = { merlin: "梅林", percival: "派西维尔" };
  const reasonNames = Object.fromEntries(rules.endReasons.map(reason => [reason.id, reason.label]));
  const names = { faction: { good: "好人", evil: "坏人", third: "第三方" },
    outcome: { win: "获胜", loss: "失利" }, roleId: roleNames, reason: reasonNames,
    isTarget: { true: "最终刺杀目标为本人", false: "最终刺杀目标不是本人" } };
  return { title: rules.title, scopeLabel: rules.scopeLabel, version: rules.version,
    items: rules.awards.map(award => {
      const details = Object.entries(award.when).map(([key, value]) =>
        [].concat(value).map(item => names[key]?.[item] || String(item)).join("／")).join(" · ") || "所有计分玩家";
      return { id: award.id, label: award.label, text: `${details}：${award.points >= 0 ? "+" : ""}${award.points} 分` };
    }),
    notes: ["计分项目满足条件时叠加；0分对局也计入计分局数。", "从积分功能启用后新开的对局开始；规则在开局时固定，历史积分保留。",
      "测试、开发、终止及缺少计分依据的对局不计积分。", "连胜仅统计计分局；失利归零，不计分局不推进或打断。",
      rules.streakBonus.enabled ? `每段连胜首次达到${rules.streakBonus.threshold}连胜额外+${rules.streakBonus.points}分。` : "连胜先做荣誉展示，不额外加分。"] };
}
module.exports = { policy, exclusion, settlementOptions, scorePlayer, publicRules, validateRules };
