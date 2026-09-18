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
  return details;
}
module.exports = { actionDetails };
