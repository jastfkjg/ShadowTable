"use strict";
const { actionSpec, roomSummary } = require("./engine");
const labels = {
  create: "创建房间",
  join: "加入房间",
  delete: "删除房间",
  updateSettings: "更新房间设置",
  setSkillVisibility: "设置技能过程展示",
  ackFairyResult: "确认查验结果",
  ackIdentity: "确认身份",
  settleTool: "结算当前操作",
  beginActivity: "发起操作",
  cancelActivity: "作废当前操作",
  finishTools: "结束本局",
  leave: "离开座位",
  transfer: "转交房主",
  kick: "移出玩家",
  seat: "更换座位",
  ready: "准备",
  configure: "修改板子",
  start: "开始对局",
  rematch: "同房重开",
  terminate: "终止对局",
  offline: "转线下结算",
  closeOffline: "完成线下结算",
  propose: "提交队伍",
  submit: "提交操作",
  advance: "推进流程",
};
const values = {
  confirm: "确认",
  approve: "赞成",
  reject: "反对",
  success: "成功",
  fail: "失败",
  magic: "魔法（反转结果）",
  pass: "不使用技能 / 确认",
};
// Snapshot only review-relevant fields; never persist credentials or arbitrary request fields.
function actionDetails(room, uid, type, input) {
  const player = room.players.find((p) => p.uid === uid);
  const spec = type === "submit" && player ? actionSpec(room, uid) : null;
  const details = {
    player: player ? { name: player.name, seat: player.seat } : null,
    stage: room.stage,
    phaseKey: room.phase,
    participants: room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      required: room.phase !== "lobby" && !!actionSpec(room, p.uid),
    })),
    game: room.game,
    round: room.round,
    phase: roomSummary(room, room.host).phaseName,
    command: type,
    label: spec?.label || labels[type] || type,
    parameters: {},
  };
  for (const field of [
    "seat",
    "team",
    "ready",
    "board",
    "capacity",
    "visible",
    "kind",
    "actor",
    "threshold",
    "replace",
    "flexible",
    "keepPlaying",
    "revision",
  ])
    if (input[field] !== undefined) details.parameters[field] = input[field];
  if (spec) {
    details.value = input.value;
    const target =
      spec.kind === "target" &&
      room.players.find((p) => p.seat === input.value);
    details.choice =
      spec.options?.find((o) => o.value === input.value)?.label ||
      (target
        ? `${target.seat}号 ${target.name}`
        : values[input.value] || String(input.value));
  }
  if (details.choice && spec?.options) {
    details.choice = details.choice.replace(/(\d+)号/g, (match, seat) => {
      const target = room.players.find((p) => p.seat === Number(seat));
      return target ? `${seat}号·${target.name}` : match;
    });
    if (String(input.value).startsWith("swap:")) {
      const targets = String(input.value)
        .split(":")
        .slice(1)
        .map((seat) => {
          const target = room.players.find((p) => p.seat === Number(seat));
          return `${seat}号${target ? "·" + target.name : ""}`;
        });
      details.choice = "秘密换号 " + targets.join(" ↔ ");
    }
  }
  return details;
}
// Group before paginating so a phase is never split across pages.
function auditGroups(store, code, offset) {
  const args = code === null ? [] : [code];
  const cte = `WITH source AS (
    SELECT *, CASE
      WHEN json_extract(details, '$.stage') IS NOT NULL THEN code || ':stage:' || json_extract(details, '$.stage')
      WHEN json_extract(details, '$.phase') IS NOT NULL THEN code || ':legacy:' || json_extract(details, '$.game') || ':' || json_extract(details, '$.phase') || ':' || coalesce(json_extract(details, '$.round'), '')
      ELSE code || ':event:' || id END AS base_key
    FROM admin_audit WHERE action != 'actor' ${code === null ? "" : "AND code=?"}
  ), boundaries AS (
    SELECT *, CASE WHEN base_key = lag(base_key) OVER (ORDER BY id) THEN 0 ELSE 1 END AS boundary FROM source
  ), numbered AS (
    SELECT *, sum(boundary) OVER (ORDER BY id) AS segment FROM boundaries
  ), grouped AS (
    SELECT *, CASE WHEN json_extract(details, '$.stage') IS NOT NULL THEN base_key ELSE base_key || ':' || segment END AS group_key FROM numbered
  ) `;
  const total = store.db
    .prepare(cte + "SELECT count(DISTINCT group_key) AS n FROM grouped")
    .get(...args).n;
  const rows = store.db
    .prepare(
      cte +
        `SELECT * FROM grouped WHERE group_key IN (
    SELECT group_key FROM grouped GROUP BY group_key ORDER BY max(id) DESC LIMIT 20 OFFSET ?
  ) ORDER BY id DESC`,
    )
    .all(...args, offset);
  const groups = new Map();
  for (const row of rows) {
    const entry = {
      id: row.id,
      action: row.action,
      code: row.code,
      reason: row.reason,
      created: row.created,
      details: JSON.parse(row.details),
    };
    if (!groups.has(row.group_key))
      groups.set(row.group_key, {
        key: row.group_key,
        entries: [],
        active:
          !!entry.details.stage &&
          store.get(row.code)?.stage === entry.details.stage,
      });
    groups.get(row.group_key).entries.push(entry);
  }
  return { groups: [...groups.values()], total, pageSize: 20 };
}
module.exports = { actionDetails, auditGroups };
