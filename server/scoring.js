"use strict";
const configured = require("./scoring-rules.json");
const { createHash } = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const conditionKeys = new Set(["faction", "outcome", "roleId", "roleIdNot", "reason", "isTarget", "honor"]);
function validateRules(rules) {
  if (!rules.version || !rules.title || !rules.scopeLabel || !rules.boards || !Array.isArray(rules.awards)
    || !Array.isArray(rules.endReasons)) throw Error("积分规则配置不完整");
  if (!rules.defaultEnabledBoards || typeof rules.defaultEnabledBoards !== "object" || Array.isArray(rules.defaultEnabledBoards)
    || Object.entries(rules.defaultEnabledBoards).some(([board, counts]) => !Array.isArray(counts) || !counts.length
      || counts.some(count => !Number.isSafeInteger(count) || !rules.boards[board]?.includes(count)))) throw Error("积分默认板子配置无效");
  if (rules.targetModes && Object.values(rules.targetModes).some(mode => mode !== "living_merlin")) throw Error("积分刺杀判定配置无效");
  if (rules.notes && (!Array.isArray(rules.notes) || rules.notes.some(note => typeof note !== "string"))) throw Error("积分说明配置无效");
  const ids = new Set();
  for (const award of rules.awards) {
    if (!award.id || ids.has(award.id) || !award.label || !Number.isSafeInteger(award.points) || award.points < -100 || award.points > 100
      || !award.when || Object.keys(award.when).some(key => !conditionKeys.has(key))) throw Error("积分奖励配置无效");
    if (Object.hasOwn(award.when, "roleIdNot") && (![].concat(award.when.roleIdNot).length
      || [].concat(award.when.roleIdNot).some(role => typeof role !== "string" || !role))) throw Error("积分排除角色配置无效");
    if (Object.hasOwn(award.when, "honor") && !["mvp", "svp"].includes(award.when.honor)) throw Error("积分票选奖励配置无效");
    ids.add(award.id);
  }
  ids.clear();
  for (const reason of rules.endReasons) {
    if (!reason.id || ids.has(reason.id) || !reason.label || (reason.requiresTarget !== true && !["good", "evil"].includes(reason.winner))) throw Error("积分结束原因无效");
    if (reason.boards && (!Array.isArray(reason.boards) || !reason.boards.length || reason.boards.some(board => !rules.boards[board]))) throw Error("积分结束原因板子配置无效");
    ids.add(reason.id);
  }
  return rules;
}
validateRules(configured);
function policy() {
  const rules = clone(configured);
  // Also identify the contents, so an accidentally reused version cannot rewrite history.
  rules.fingerprint = createHash("sha256").update(JSON.stringify(configured)).digest("hex");
  return rules;
}
function defaultEnabled(board, capacity) { return configured.defaultEnabledBoards[board]?.includes(capacity) === true; }
function enabled(room) {
  if (typeof room.scoreEnabled === "boolean") return room.scoreEnabled;
  // Existing games keep the scoring behavior they had when dealt.
  return room.phase !== "lobby" && !!room.scorePolicy || defaultEnabled(room.board, room.capacity);
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
    defaultEnabledBoards: clone(configured.defaultEnabledBoards),
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
function scorePlayer(player, facts, rules, excludedReason, honorResult = null) {
  if (excludedReason) return { status: "excluded", total: 0, breakdown: [], reason: excludedReason, ruleVersion: rules?.version || null };
  const honorKey = player.outcome === "win" ? "mvp" : "svp";
  const honor = honorResult?.status === "settled" && honorResult[honorKey]?.some(winner => winner.seat === player.seat) ? honorKey : null;
  const context = { ...player, reason: facts.reason, isTarget: player.seat === facts.target && player.alive !== false, honor };
  const breakdown = rules.awards.filter(award => Object.entries(award.when).every(([key, value]) =>
    key === "roleIdNot" ? ![].concat(value).includes(context.roleId)
      : Array.isArray(value) ? value.includes(context[key]) : context[key] === value))
    .filter(award => award.points !== 0).map(({ id, label, points }) => ({ id, label, points }));
  return { status: "scored", total: breakdown.reduce((sum, item) => sum + item.points, 0), breakdown,
    ruleVersion: rules.version, ruleFingerprint: rules.fingerprint };
}
function publicRules(rules = policy()) {
  const roleNames = { merlin: "梅林", percival: "派西维尔" };
  const reasonNames = Object.fromEntries(rules.endReasons.map(reason => [reason.id, reason.label]));
  const names = { faction: { good: "好人", evil: "坏人", third: "第三方" },
    outcome: { win: "获胜", loss: "失利" }, roleId: roleNames, reason: reasonNames, honor: { mvp: "公投 MVP", svp: "公投 SVP" },
    isTarget: { true: "最终刺杀目标为本人", false: "最终刺杀目标不是本人" } };
  const columns = [
    { id: "evade", label: "未刺中梅林", caption: "蓝队胜", reason: "assassination", winner: "good" },
    { id: "hit", label: "刺中梅林", caption: "红队胜", reason: "assassination", winner: "evil" },
    { id: "quest_fail", label: "3红车", caption: "红队胜", reason: "quest_fail", winner: "evil" },
  ];
  const rows = [
    { id: "merlin", label: "梅林", faction: "good" },
    { id: "percival", label: "派西维尔", faction: "good" },
    { id: "servant", label: "其他好人", faction: "good" },
    { id: "evil", label: "红队全员", faction: "evil" },
  ].map(row => ({ ...row, scores: columns.map(column => scorePlayer(
    { seat: 2, roleId: row.id, faction: row.faction, outcome: row.faction === column.winner ? "win" : "loss" },
    { reason: column.reason, target: 1 }, rules, null).total) }));
  const bonusDescriptions = {
    shield: "蓝队获胜时，被最终刺杀的其他好人额外加分，梅林、派西除外。空刀或刺到红队不加分。",
    honor_mvp: "有效计分局中，胜方公投最佳额外加分。",
    honor_svp: "有效计分局中，败方公投最佳额外加分。",
  };
  return { title: rules.title, scopeLabel: rules.scopeLabel, version: rules.version,
    table: { columns: columns.map(({ id, label, caption }) => ({ id, label, caption })), rows,
      note: "前两列适用：蓝队3蓝车，或红队提前起刀。表内为每人基础积分，额外奖励另计。" },
    bonuses: rules.awards.filter(award => Object.hasOwn(bonusDescriptions, award.id)).map(award => ({
      id: award.id, label: award.label, points: award.points, text: bonusDescriptions[award.id],
    })),
    items: rules.awards.map(award => {
      const details = Object.entries(award.when).map(([key, value]) => {
        const labels = [].concat(value).map(item => (key === "roleIdNot" ? roleNames[item] : names[key]?.[item]) || String(item)).join("／");
        return key === "roleIdNot" ? `${labels}除外` : labels;
      }).join(" · ") || "所有计分玩家";
      return { id: award.id, label: award.label, text: `${details}：${award.points >= 0 ? "+" : ""}${award.points} 分` };
    }),
    notes: ["计分项目满足条件时叠加；0分对局也计入计分局数。", "房主可在准备阶段开启或关闭计分；更换板子或人数时应用默认值，同房重开保留选择。发牌后固定。", "从积分功能启用后新开的对局开始；规则在开局时固定，单局计分记录保留；积分仅当月有效，每月 1 日北京时间零点清零。",
      "测试房间及有陪测参与的对局中，真实玩家和开发账号正常计分；陪测账号不保存个人战绩、积分及趣味记录。终止及缺少计分依据的对局不计积分。", ...(rules.notes || [])] };
}
module.exports = { policy, defaultEnabled, enabled, settings, exclusion, settlementOptions, optionsFor, validTarget, resolveWinner, scorePlayer, publicRules, validateRules };
