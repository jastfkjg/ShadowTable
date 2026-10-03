"use strict";
const { actionSpec, roomSummary, roleName } = require("./engine");
const fairy = require("./fairy");
const labels = {
  create: "创建房间",
  join: "加入房间",
  delete: "删除房间",
  updateSettings: "更新房间设置",
  setSkillVisibility: "设置技能过程展示",
  ackFairyResult: "确认查验结果",
  ackIdentity: "确认身份",
  settleTool: "结算当前操作",
  closeWaiting: "提前结束等待",
  beginActivity: "发起操作",
  cancelActivity: "作废当前操作",
  finishTools: "结束本局",
  leave: "离开房间",
  transfer: "转交房主",
  kick: "移出玩家",
  seat: "入座或换座",
  stand: "站起围观",
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
  thiefFail: "盗贼失败",
  pass: "不使用技能 / 确认",
};
// Snapshot only review-relevant fields; never persist credentials or arbitrary request fields.
function actionDetails(room, uid, type, input) {
  const player = [...room.players, ...(room.spectators || [])].find(
    (p) => p.uid === uid,
  );
  const spec = type === "submit" && player ? actionSpec(room, uid) : null;
  const details = {
    player: player
      ? {
          name: player.name,
          seat: player.seat,
          role: roleName(room.roles?.[uid]),
        }
      : null,
    stage: room.stage,
    activityStartedAt: room.activity?.startedAt || null,
    activityNumber: room.activity?.number || null,
    phaseKey: room.phase,
    participants: room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      role: roleName(room.roles?.[p.uid]),
      required:
        room.phase !== "lobby" &&
        (room.phase !== "quest" || room.team.includes(p.seat)) &&
        !!actionSpec(room, p.uid),
    })),
    auditVersion: 2,
    team: [...(room.team || [])],
    threshold:
      room.phase === "quest"
        ? (room.activity?.threshold ??
          (room.capacity >= 7 && room.round === 4 ? 2 : 1))
        : null,
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
    "fairyEnabled",
    "kind",
    "actor",
    "threshold",
    "replace",
    "flexible",
    "keepPlaying",
    "revision",
    "winner",
    "scoreReason",
    "scoreEnabled",
    "recordPurpose",
    "scoreTarget",
    "funReason",
    "funTarget",
    "funActor",
  ])
    if (input[field] !== undefined) details.parameters[field] = input[field];
  if (spec) {
    details.actionKind = spec.kind;
    details.value = input.value;
    const target =
      spec.kind === "target" &&
      room.players.find((p) => p.seat === input.value);
    details.choice =
      spec.options?.find((o) => o.value === input.value)?.label ||
      (target
        ? `${target.seat}号 ${target.name}`
        : spec.kind === "target" && input.value === 0
          ? "空刀"
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
  if (["kick", "transfer"].includes(type)) {
    const target = room.players.find((p) => p.seat === input.seat);
    if (target)
      details.choice = `${labels[type]}：${target.seat}号·${target.name}`;
  }
  return details;
}

const activities = {
  vote: "全员投票",
  quest: "任务出牌",
  skills: "放技能阶段",
  fairy: "湖仙查验",
  conversion: "阵营转换",
  assassination: "刀梅林",
  reverseStrike: "刀逆仆",
  offline: "线下刀人",
};
const snapshot = (room, seat) => {
  const player = room.players.find((p) => p.seat === seat);
  return player
    ? { seat, name: player.name, role: roleName(room.roles?.[player.uid]) }
    : { seat };
};
const seatLabel = (room, seat) => {
  const player = snapshot(room, seat);
  return `${seat}号${player.name ? "·" + player.name : ""}`;
};
const seatList = (room, seats) =>
  seats.length ? seats.map((seat) => seatLabel(room, seat)).join("、") : "无";
const namedText = (room, text) =>
  text.replace(/(\d+)号/g, (_, seat) => seatLabel(room, Number(seat)));

// Persist the actual committed result alongside the action. These snapshots stay
// in the administrator audit, never in public history or player responses.
function completeActionDetails(details, before, room) {
  if (!before) return details;
  const outcomes = [];
  const history = (room.history || []).slice(before.history?.length || 0);
  if (details.command === "start") details.game = room.game;
  if (details.command === "beginActivity" && room.activity) {
    const context = actionDetails(
      room,
      before.host,
      "beginActivity",
      details.parameters,
    );
    for (const field of [
      "stage",
      "phaseKey",
      "phase",
      "participants",
      "activityStartedAt",
      "activityNumber",
      "team",
      "threshold",
      "game",
      "round",
    ])
      details[field] = context[field];
    details.label = "发起" + (activities[room.activity.kind] || "操作");
  }
  if (
    details.command === "beginActivity" &&
    details.parameters.kind === "conversion"
  )
    details.label = "发起阵营转换";
  for (const result of history) {
    if (["toolQuest", "quest"].includes(result.kind)) {
      const counts = result.counts || {
        success: result.team.length - result.fails,
        fail: result.fails,
      };
      outcomes.push({
        kind: "quest",
        status: result.success ? "success" : "failure",
        text: `任务${result.success ? "成功" : "失败"}`,
        team: [...result.team],
        fails: result.fails,
        threshold: result.threshold,
        counts: { ...counts },
        success: result.success,
        lines: [
          `队伍：${seatList(before, result.team)}`,
          `成功牌 ${counts.success} 张 · 失败牌 ${counts.fail} 张${counts.magic !== undefined ? ` · 魔法牌 ${counts.magic} 张 · 盗贼失败牌 ${counts.thiefFail} 张` : ""} · 失败门槛 ${result.threshold} 张`,
          ...(counts.magic !== undefined
            ? [
                `计入失败 ${result.fails} 张${counts.thiefFail && result.threshold === 1 ? "；盗贼失败优先生效" : counts.magic % 2 ? "；奇数张魔法反转结果" : "；魔法未反转结果"}`,
              ]
            : []),
        ],
      });
    } else if (["toolVote", "team"].includes(result.kind)) {
      const approve = result.votes.filter(
        (vote) => vote.approve === true,
      ).length;
      const reject = result.votes.filter(
        (vote) => vote.approve === false,
      ).length;
      const abstain = result.votes.length - approve - reject;
      outcomes.push({
        kind: "vote",
        status: result.approved ? "success" : "failure",
        text: result.approved ? "组队通过" : "组队否决",
        approve,
        reject,
        abstain,
        earlyClosed: !!result.earlyClosed,
        lines: [
          `队伍：${seatList(before, result.team)}`,
          `赞成 ${approve} · 反对 ${reject} · 弃权 ${abstain} · 通过需至少 ${Math.floor(result.votes.length / 2) + 1} 票${result.earlyClosed ? "（提前截止）" : ""}`,
        ],
      });
    } else if (result.kind === "skillResult") {
      const effects = {
        eliminated: "出局",
        disarmed: "解除刺客技能",
        guarded: "被守卫挡下",
        reflected: "触发圣骑士反伤",
        duel_failed: "决斗判错，自身出局",
        invalid_role: "目标身份不在技能作用范围",
        already_out: "目标已出局",
        already_used: "目标技能已使用",
      };
      const entity = (value) =>
        value
          ? { ...snapshot(before, value.seat), role: roleName(value.role) }
          : null;
      const resolutions = (room.fun?.events || [])
        .slice(before.fun?.events?.length || 0)
        .filter((entry) => entry.kind === "attack")
        .map((entry) => ({
          actor: entity(entry.actor),
          selected: entity(entry.selected),
          recipient: entity(entry.recipient),
          effect: entry.effect,
          type: entry.type,
        }));
      const changes = room.players.flatMap((player) => {
        const previous = before.knights.players[player.uid],
          next = room.knights.players[player.uid];
        const beforeRole = roleName(before.roles[player.uid]),
          afterRole = roleName(room.roles[player.uid]);
        if (
          beforeRole === afterRole &&
          previous.alive === next.alive &&
          previous.used === next.used &&
          previous.armor === next.armor &&
          !result.redrawn.includes(player.seat)
        )
          return [];
        return [
          {
            seat: player.seat,
            name: player.name,
            beforeRole,
            afterRole,
            beforeAlive: previous.alive,
            beforeUsed: previous.used,
            beforeArmor: previous.armor,
            alive: next.alive,
            used: next.used,
            armor: next.armor,
            availableRound: next.availableRound,
          },
        ];
      });
      const inspections = room.players.flatMap((player) => {
        const previous = before.knights.players[player.uid],
          next = room.knights.players[player.uid];
        const lines = [];
        if (
          next.gargoyleInfo &&
          JSON.stringify(previous.gargoyleInfo) !==
            JSON.stringify(next.gargoyleInfo)
        )
          lines.push(
            `${seatLabel(room, player.seat)}石像鬼查验：${seatLabel(room, next.gargoyleInfo.seat)}${next.gargoyleInfo.canKill ? "有" : "无"}杀人能力${next.gargoyleInfo.initial ? "（抽牌初验）" : ""}`,
          );
        if (next.nightInfo && previous.nightInfo !== next.nightInfo)
          lines.push(
            `${seatLabel(room, player.seat)}先知结果：${namedText(room, next.nightInfo)}`,
          );
        return lines;
      });
      outcomes.push({
        kind: "skills",
        status: "settled",
        text: result.text || "技能结算完成",
        changes,
        resolutions,
        eliminated: [...result.eliminated],
        redrawn: [...result.redrawn],
        restored: [...result.restored],
        out: [...result.out],
        lines: [
          ...history
            .filter(
              (entry) =>
                entry.kind === "skillDetail" &&
                (!resolutions.length || !/使用技能|开枪/.test(entry.text)),
            )
            .map((entry) => namedText(before, entry.text)),
          ...resolutions.map(
            (entry) =>
              `${seatLabel(before, entry.actor.seat)}${{ gun: "开枪", knife: "开刀", duel: "决斗" }[entry.type] || "使用技能"} → ${seatLabel(before, entry.selected.seat)}：${effects[entry.effect] || entry.effect}${entry.recipient && entry.recipient.seat !== entry.selected.seat ? `（实际作用于 ${seatLabel(before, entry.recipient.seat)}）` : ""}`,
          ),
          `本轮出局：${seatList(before, result.eliminated)}`,
          `抽牌复活：${seatList(room, result.redrawn)}；原牌复活：${seatList(room, result.restored)}；最终仍出局：${seatList(room, result.out)}`,
          ...changes.map(
            (player) =>
              `${player.seat}号·${player.name}：` +
              [
                player.beforeRole !== player.afterRole
                  ? `${player.beforeRole} → ${player.afterRole}`
                  : player.afterRole,
                result.redrawn.includes(player.seat)
                  ? "抽牌复活"
                  : player.beforeAlive !== player.alive
                    ? player.alive
                      ? "复活"
                      : "出局"
                    : null,
                player.beforeRole !== player.afterRole && !player.used
                  ? `新技能第 ${player.availableRound} 轮起可用`
                  : player.beforeUsed !== player.used
                    ? `技能${player.used ? "已使用" : "未使用"}`
                    : null,
                player.beforeArmor !== player.armor
                  ? player.armor
                    ? "获得复活甲"
                    : "复活甲已消耗"
                  : null,
              ]
                .filter(Boolean)
                .join("；"),
          ),
          ...inspections,
        ],
      });
    } else if (["toolKnife", "assassination"].includes(result.kind)) {
      outcomes.push({
        kind: "assassination",
        status: result.hit ? "success" : "failure",
        target: snapshot(before, result.target),
        hit: result.hit,
        text:
          result.target === 0
            ? result.hit
              ? "空刀成立（场上无梅林）"
              : "空刀失利（场上仍有梅林）"
            : result.hit
              ? "刀人命中梅林"
              : "刀人未命中梅林",
        lines: [
          `目标：${result.target ? seatLabel(before, result.target) : "空刀"}`,
        ],
      });
    } else if (result.kind === "toolCanceled") {
      outcomes.push({
        kind: "cancel",
        status: "cancelled",
        text:
          details.command === "beginActivity"
            ? "上次未结算操作已作废"
            : "本次操作已作废",
        lines: [result.detail || "已提交行动保留供复盘，本次不产生结算结果。"],
      });
    } else if (result.kind === "toolOffline") {
      outcomes.push({
        kind: "offline",
        status: "offline",
        text: "转为线下结算",
        lines: ["线上未记录本次结算结果。"],
      });
    } else if (result.resultType === "conversion") {
      const changed = room.players.filter(
        (player) =>
          before.knights.players[player.uid].faction !==
          room.knights.players[player.uid].faction,
      );
      const side = (value) => ({ good: "好人", evil: "坏人" })[value];
      outcomes.push({
        kind: "conversion",
        status: "settled",
        text: result.text,
        lines: changed.map(
          (player) =>
            `${seatLabel(room, player.seat)}·${roleName(room.roles[player.uid])} → ${side(room.knights.players[player.uid].faction)}`,
        ),
      });
    }
  }
  if (
    before.phase === "fairy" &&
    fairy.holder(room) !== fairy.holder(before) &&
    !outcomes.some((outcome) => outcome.kind === "cancel")
  ) {
    const holder = before.players.find(
      (player) => player.seat === fairy.holder(before),
    );
    const result = fairy.result(room, holder.uid);
    outcomes.push({
      kind: "fairy",
      status: "settled",
      text: "湖仙查验完成",
      actor: snapshot(before, holder.seat),
      target: snapshot(before, fairy.holder(room)),
      result: result.fairyInfo,
      lines: [
        `${seatLabel(before, holder.seat)}查验：${namedText(before, result.fairyInfo)}`,
        `湖仙传递给 ${seatLabel(room, fairy.holder(room))}`,
      ],
    });
  }
  if (
    before.phase === "reverseStrike" &&
    before.stage !== room.stage &&
    !outcomes.some((outcome) => ["cancel", "offline"].includes(outcome.kind))
  ) {
    const actor = before.players.find(
      (player) => before.roles[player.uid] === "assassin",
    );
    const seat =
      details.command === "submit" && details.player?.seat === actor?.seat
        ? details.value
        : before.submissions[actor?.uid];
    if (typeof seat === "number") {
      const target = before.players.find((player) => player.seat === seat);
      const hit = room.convertedReverse === target?.uid;
      outcomes.push({
        kind: "reverseStrike",
        status: hit ? "success" : "failure",
        text: hit ? "命中逆仆，阵营转为坏人" : "未命中逆仆",
        target: snapshot(before, seat),
        hit,
        lines: [`目标：${seatLabel(before, seat)}`],
      });
    }
  }
  if (
    before.phase !== room.phase &&
    ["ended", "terminated"].includes(room.phase)
  ) {
    outcomes.push({
      kind: "game",
      status: "ended",
      text:
        room.phase === "terminated"
          ? "对局已终止"
          : { good: "好人获胜", evil: "坏人获胜", third: "盗贼阵营获胜" }[
              room.result?.winner
            ] || "对局结束，未登记胜负",
      winner: room.result?.winner || null,
      lines: [
        room.result?.reason,
        room.matchRecord?.excludedReason
          ? `不计战绩：${room.matchRecord.excludedReason}`
          : null,
      ].filter(Boolean),
    });
  }
  if (details.command === "closeWaiting") {
    const missing = details.participants.filter(
      (player) =>
        player.required &&
        !Object.hasOwn(
          before.submissions,
          before.players.find((p) => p.seat === player.seat).uid,
        ),
    );
    details.earlyClosed = true;
    details.skippedSeats = missing.map((player) => player.seat);
  }
  details.outcomes = outcomes;
  return details;
}
// Group before paginating so a phase is never split across pages.
function auditGroups(store, code, offset) {
  const args = code === null ? [] : [code];
  const cte = `WITH source AS (
    SELECT *, CASE
      WHEN json_extract(details, '$.command') IN ('start', 'rematch', 'finishTools')
        OR json_extract(details, '$.phaseKey') IN ('tools', 'ended', 'terminated')
        OR json_extract(details, '$.phase') IN ('等待房主发起操作', '对局结束', '对局已终止') THEN code || ':event:' || id
      WHEN json_extract(details, '$.stage') IS NOT NULL THEN code || ':stage:' || json_extract(details, '$.stage')
      WHEN json_extract(details, '$.phase') IS NOT NULL THEN code || ':legacy:' || json_extract(details, '$.game') || ':' || json_extract(details, '$.phase') || ':' || coalesce(json_extract(details, '$.round'), '')
      ELSE code || ':event:' || id END AS base_key
    FROM admin_audit WHERE action != 'actor'
      AND coalesce(json_extract(details, '$.command'), '') NOT IN ('ackIdentity', 'ackFairyResult') ${code === null ? "" : "AND code=?"}
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
module.exports = { actionDetails, completeActionDetails, auditGroups };
