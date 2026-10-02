"use strict";
const configured = require("./scoring-rules.json");
const { createHash } = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const conditionKeys = new Set(["faction", "outcome", "roleId", "reason", "isTarget"]);
function validateRules(rules) {
  if (!rules.version || !rules.title || !rules.scopeLabel || !rules.boards || !Array.isArray(rules.awards)
    || !Array.isArray(rules.endReasons)) throw Error("积分规则配置不完整");
  if (!Number.isSafeInteger(rules.defaultEnabledMinPlayers) || rules.defaultEnabledMinPlayers < 0) throw Error("积分默认人数配置无效");
  if (rules.targetModes && Object.values(rules.targetModes).some(mode => mode !== "living_merlin")) throw Error("积分刺杀判定配置无效");
  if (rules.notes && (!Array.isArray(rules.notes) || rules.notes.some(note => typeof note !== "string"))) throw Error("积分说明配置无效");
  const ids = new Set();
  for (const award of rules.awards) {
    if (!award.id || ids.has(award.id) || !award.label || !Number.isSafeInteger(award.points) || award.points < -100 || award.points > 100
      || !award.when || Object.keys(award.when).some(key => !conditionKeys.has(key))) throw Error("积分奖励配置无效");
    ids.add(award.id);
  }
  ids.clear();
  for (const reason of rules.endReasons) {
    if (!reason.id || ids.has(reason.id) || !reason.label || (reason.requiresTarget !== true && !["good", "evil"].includes(reason.winner))) throw Error("积分结束原因无效");
    if (reason.boards && (!Array.isArray(reason.boards) || !reason.boards.length || reason.boards.some(board => !rules.boards[board]))) throw Error("积分结束原因板子配置无效");
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
function defaultEnabled(capacity) { return capacity >= configured.defaultEnabledMinPlayers; }
function enabled(room) {
  if (typeof room.scoreEnabled === "boolean") return room.scoreEnabled;
  // Existing games keep the scoring behavior they had when dealt.
  return room.phase !== "lobby" && !!room.scorePolicy || defaultEnabled(room.capacity);
}
function scopeExclusion(room, rules) {
  if (!rules) return "积分功能启用前开局";
  if (!rules.boards[room.board]?.includes(room.capacity)) return "本板子暂未参与计分";
  return null;
}
function exclusion(room, rules = room.scorePolicy) {
  return scopeExclusion(room, rules) || (!enabled(room) ? "本局未开启计分" : null);
}
function settings(room) {
  const rules = room.phase === "lobby" ? configured : room.scorePolicy;
  return { enabled: enabled(room), editable: room.phase === "lobby",
    defaultEnabledMinPlayers: rules?.defaultEnabledMinPlayers ?? configured.defaultEnabledMinPlayers,
    unavailableReason: scopeExclusion(room, rules) };
}
function settlementOptions(room) {
  return exclusion(room) ? [] : optionsFor(room.board, room.scorePolicy);
}
function optionsFor(board, rules) {
  return clone(rules.endReasons.filter(reason => !reason.boards || reason.boards.includes(board)));
}
function validTarget(target, players, board, rules) {
  return Number.isInteger(target) && (target === 0 || players.some(player => player.seat === target
    && (rules.targetModes?.[board] !== "living_merlin" || player.alive !== false)));
}
function resolveWinner(option, target, players, board, rules) {
  if (!option.requiresTarget) return option.winner;
  const livingMode = rules.targetModes?.[board] === "living_merlin";
  const hit = target === 0 && livingMode ? !players.some(player => player.alive !== false && player.roleId === "merlin")
    : players.some(player => player.seat === target && player.roleId === "merlin" && (!livingMode || player.alive !== false));
  return hit ? "evil" : "good";
}
function scorePlayer(player, facts, rules, excludedReason) {
  if (excludedReason) return { status: "excluded", total: 0, breakdown: [], reason: excludedReason, ruleVersion: rules?.version || null };
  const context = { ...player, reason: facts.reason, isTarget: player.seat === facts.target && player.alive !== false };
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
    notes: ["计分项目满足条件时叠加；0分对局也计入计分局数。", `房主可在准备阶段开启或关闭计分；${rules.defaultEnabledMinPlayers}人及以上默认开启，其他默认关闭。发牌后固定。`, "从积分功能启用后新开的对局开始；规则在开局时固定，历史积分保留。",
      "测试房间、陪测和开发账号参与的对局正常计分；终止及缺少计分依据的对局不计积分。", "连胜仅统计计分局；失利归零，不计分局不推进或打断。",
      rules.streakBonus.enabled ? `每段连胜首次达到${rules.streakBonus.threshold}连胜额外+${rules.streakBonus.points}分。` : "连胜先做荣誉展示，不额外加分。", ...(rules.notes || [])] };
}
module.exports = { policy, defaultEnabled, enabled, settings, exclusion, settlementOptions, optionsFor, validTarget, resolveWinner, scorePlayer, publicRules, validateRules };
