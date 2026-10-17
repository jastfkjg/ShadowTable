const { portrait } = require("./role-portraits");
const factions = { good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" };
const actions = { knife: "出刀", duel: "决斗", detonate: "主动自爆并开枪", passiveGun: "预选被动枪",
  gun: "开枪", guard: "守护", substitute: "指定替死", swap: "换号", inspect: "查验", reflect: "反伤" };
const effects = { eliminated: "目标出局", disarmed: "目标失去刀", guarded: "被守护挡下", reflected: "被反伤",
  duel_failed: "决斗失败", already_out: "目标已出局", already_used: "目标已失去刀", invalid_role: "目标不受此刀影响" };
const seats = list => list?.length ? list.map(n => n + "号").join("、") : "无";
const person = p => p ? p.seat + "号 " + (p.role || "身份未记录") : "未记录";
const side = faction => factions[faction] || "未知";
const player = (p, selfSeat) => ({ ...p, isSelf: p.seat === selfSeat,
  rolePortrait: p.role ? portrait(p.role, p.faction).portrait : "",
  roleLabel: p.role || "未记录", factionLabel: side(p.faction) });
const actorFields = p => ({ actorSeat: p?.seat || null, actorLabel: p?.role || "身份未记录" });
const statistic = (id, value, label, tone = "neutral", unit = "张") => ({ id, value, label, tone, unit });
function actionRow(action, id) {
  const selected = action.targets || [], resolved = action.resolvedTargets || selected;
  const mapped = selected.map(p => p.seat).join(",") !== resolved.map(p => p.seat).join(",");
  let detail = action.kind === "swap" ? seats(selected.map(p => p.seat)).replace("、", " ↔ ")
    : selected.length ? "选择 " + selected.map(person).join("、") : "目标未记录";
  const targetLabel = detail.replace(/^选择 /, "");
  const extra = [];
  if (mapped) extra.push("换号后目标 " + resolved.map(person).join("、"));
  if (action.recipient && !resolved.some(p => p.seat === action.recipient.seat))
    extra.push("实际承受者 " + person(action.recipient));
  if (extra.length) detail += "；" + extra.join("；");
  let result = effects[action.effect] || "";
  if (action.inspection) result = action.inspection.canKill ? "拥有主动击杀能力" : "没有主动击杀能力";
  else if (action.status === "notTriggered") result = "未触发，技能未消耗";
  else if (action.status === "triggered") result = result || "已触发，技能已消耗";
  else if (action.kind === "reflect") result = "攻击者反伤出局";
  const relatedSeats = [action.actor?.seat, ...selected.map(p => p.seat), ...resolved.map(p => p.seat), action.recipient?.seat].filter(Boolean);
  return { id, headline: person(action.actor), ...actorFields(action.actor),
    action: action.kind === "passiveGun" && action.status === "triggered" ? "被动开枪" : actions[action.kind] || "技能",
    detail, targetLabel, extraDetail: extra.join("；"), result, resultTone: "accent",
    tone: action.actor?.faction || "unknown", relatedSeats };
}
function event(raw, initialPlayers) {
  let title = "", badge = "", tone = "neutral", summary = "", footer = "";
  let rows = [], drawRows = [], relatedSeats = [], stats = [], settlements = [], teamLabel = "";
  if (raw.kind === "vote") {
    title = "组队与投票"; badge = raw.approved ? "组队通过" : "组队否决"; tone = raw.approved ? "good" : "evil";
    summary = (raw.leader ? raw.leader + "号带队 · " : "") + "队伍 " + seats(raw.team);
    const votes = raw.votes || [];
    stats = [statistic("approve", votes.filter(v => v.approve === true).length, "赞成", "good", "票"),
      statistic("reject", votes.filter(v => v.approve === false).length, "反对", "evil", "票"),
      statistic("abstain", votes.filter(v => v.approve === null).length, "弃权", "neutral", "票")];
    teamLabel = seats(raw.team);
    rows = votes.map((v, i) => ({ id: i, headline: v.seat + "号 " + (initialPlayers.find(p => p.seat === v.seat)?.name || ""),
      detail: v.approve === null ? "弃权" : v.approve ? "赞成" : "反对", tone: v.approve === null ? "neutral" : v.approve ? "good" : "evil", relatedSeats: [v.seat] }));
    if (raw.earlyClosed) footer = "提前截止，未提交者记为弃权";
  } else if (raw.kind === "quest") {
    title = "任务结果"; badge = raw.success ? "任务成功" : "任务失败"; tone = raw.success ? "good" : "evil";
    summary = `${(raw.team || []).length - raw.fails}张成功 · ${raw.fails}张失败 · 失败门槛${raw.threshold}张`;
    stats = [statistic("success", (raw.team || []).length - raw.fails, "成功票", "good"),
      statistic("fail", raw.fails, "失败票", "evil"), statistic("threshold", raw.threshold, "失败门槛")];
    teamLabel = seats(raw.team);
    rows = (raw.cards || []).map((card, i) => ({ id: i,
      headline: card.actor ? card.actor.seat + "号 " + (card.actor.name || card.actor.role || "") : "玩家未记录",
      detail: card.value === "success" ? "成功" : card.value === "fail" ? "失败" : "未记录",
      tone: card.value === "fail" ? "evil" : card.value === "success" ? "good" : "neutral", relatedSeats: [card.actor?.seat].filter(Boolean) }));
    relatedSeats = raw.team || [];
  } else if (raw.kind === "conversion") {
    title = "阵营转换"; badge = raw.converted ? "转换" : "不转换"; tone = raw.converted ? "accent" : "neutral";
    rows = (raw.changes || []).map((c, i) => ({ id: i, headline: person(c.before), ...actorFields(c.before),
      detail: side(c.before.faction) + " → " + side(c.after.faction),
      beforeLabel: side(c.before.faction) + "阵营", beforeTone: c.before.faction,
      afterLabel: side(c.after.faction) + "阵营", tone: c.after.faction, relatedSeats: [c.seat] }));
    summary = raw.converted ? "抽到转换牌" : "抽到不转换牌，阵营保持原状";
    if (raw.converted && !rows.length) footer = "本次没有发生身份或阵营变化";
  } else if (raw.kind === "skills") {
    title = "技能结算";
    rows = (raw.actions || []).map(actionRow);
    badge = rows.length ? rows.length + " 次行动" : "";
    drawRows = (raw.draws || []).map((draw, i) => ({ id: i, headline: draw.after.seat + "号 · 第" + draw.order + "张",
      detail: draw.armor ? "复活甲：保留 " + draw.after.role + "，消耗1张B牌" : (draw.before.role || "未记录") + " → " + (draw.after.role || "未记录"),
      result: side(draw.after.faction) + " · 抽牌复活" + (draw.inspection ? "；随机查验" + draw.inspection.seat + "号：" + (draw.inspection.canKill ? "拥有" : "没有") + "主动击杀能力" : ""),
      tone: draw.after.faction, relatedSeats: [draw.after.seat] }));
    if (raw.summary) {
      settlements = [["eliminated", "本轮出局"], ["redrawn", "抽牌复活"], ["restored", "原牌复活"], ["out", "仍然出局"]]
        .filter(([key]) => raw.summary[key]?.length)
        .map(([key, label]) => ({ id: key, label, text: seats(raw.summary[key]), tone: key === "out" ? "evil" : "neutral" }));
      if (!settlements.length) footer = "本轮无人出局";
    }
    if (raw.earlyClosed) footer += (footer ? " · " : "") + "提前截止，未提交者按不使用技能处理";
    if (!rows.length) summary = raw.summary ? "本轮无人使用技能" : "本轮没有技能行动记录";
  } else if (raw.kind === "fairy") {
    title = "湖仙查验";
    rows = [{ id: 0, headline: person(raw.actor), ...actorFields(raw.actor), action: "查验",
      tone: raw.actor?.faction || "unknown",
      detail: "查验 " + person(raw.target), targetLabel: person(raw.target),
      result: "当时阵营：" + side(raw.target?.faction) + (raw.target ? "；湖仙传递给" + raw.target.seat + "号" : ""),
      resultLabel: "当时阵营：" + side(raw.target?.faction), resultTone: raw.target?.faction || "unknown",
      relatedSeats: [raw.actor?.seat, raw.target?.seat].filter(Boolean) }];
    if (raw.target) footer = "湖仙传递给 " + raw.target.seat + "号";
  } else if (raw.kind === "vision") {
    title = "月下先知视野";
    rows = [{ id: 0, headline: person(raw.actor), ...actorFields(raw.actor), tone: raw.actor?.faction || "unknown",
      detail: raw.information, relatedSeats: [raw.actor?.seat].filter(Boolean) }];
  } else if (raw.kind === "knife") {
    title = "盘刀行动"; badge = raw.decision === false ? "未形成决定" : raw.targetSeat === 0 ? "空刀" : raw.hit === true ? "命中" : raw.hit === false ? "未命中" : "结果未记录";
    tone = raw.hit === true ? "evil" : raw.hit === false ? "good" : "neutral";
    if (raw.targetSeat === 0 && raw.hit !== null && raw.hit !== undefined) footer = raw.hit ? "场上没有梅林" : "场上仍有梅林";
    rows = [{ id: 0, headline: raw.actor ? person(raw.actor) : "带刀人未记录", ...actorFields(raw.actor),
      actorLabel: raw.actor?.role || "带刀人未记录", tone: raw.actor?.faction || "unknown", action: "盘刀",
      detail: raw.targetSeat === 0 ? "选择0号空刀" : "选择 " + person(raw.target),
      targetLabel: raw.targetSeat === 0 ? "0号空刀" : person(raw.target),
      relatedSeats: [raw.actor?.seat, raw.target?.seat].filter(Boolean) }];
    if (raw.decision === false) {
      summary = raw.text || "本次未形成有效盘刀决定";
      rows[0].detail = "本次没有提交有效目标"; rows[0].targetLabel = "";
    }
  } else if (raw.kind === "canceled") {
    title = "作废操作"; badge = "已作废"; summary = raw.text; footer = raw.detail || "本次未完成的操作不计入有效结果";
  } else { title = raw.kind === "offline" ? "线下操作" : "其他操作"; summary = raw.text || "具体过程未记录"; }
  relatedSeats = [...new Set([...relatedSeats, ...rows.flatMap(r => r.relatedSeats || []), ...drawRows.flatMap(r => r.relatedSeats || [])])];
  return { ...raw, title, badge, tone, summary, rows, drawRows, stats, settlements, teamLabel, footer, relatedSeats,
    confirmationsLabel: raw.confirmations?.length ? seats(raw.confirmations) + "：不使用技能 / 确认" : "" };
}
// Older archives store each attack separately. Merge adjacent fragments only;
// complete skill cycles and operations between them keep their chronology.
function displayEvents(events) {
  const result = [];
  for (const e of events) {
    const previous = result[result.length - 1];
    if (e.kind === "skills" && !e.summary && previous?.kind === "skills" && !previous.summary && previous.round === e.round)
      result[result.length - 1] = { ...previous, actions: [...(previous.actions || []), ...(e.actions || [])],
        draws: [...(previous.draws || []), ...(e.draws || [])],
        confirmations: [...new Set([...(previous.confirmations || []), ...(e.confirmations || [])])],
        earlyClosed: !!previous.earlyClosed || !!e.earlyClosed };
    else result.push(e);
  }
  return result;
}
function trajectory(raw, seat) {
  const initial = raw.initialPlayers.find(p => p.seat === seat), final = raw.finalPlayers.find(p => p.seat === seat);
  if (!initial && !final) return null;
  const roleArt = p => p?.role ? portrait(p.role, p.faction).portrait : "";
  const stage = round => Number.isInteger(round) && round > 0 ? "第" + round + "轮" : "过程";
  const initialDetail = initial?.role ? side(initial.faction) + "阵营" : "初始身份未记录";
  const steps = [{ id: "initial", label: "开局 · 初始身份", stageLabel: "开局", actionLabel: "初始身份",
    text: person(initial), detail: initialDetail, contextLabel: initialDetail,
    rolePortrait: roleArt(initial), tone: initial?.faction || "unknown" }];
  for (const e of raw.events) {
    if (e.kind === "conversion") for (const c of e.changes || []) if (c.seat === seat)
      steps.push({ id: e.id, label: stage(e.round) + " · 阵营转换", stageLabel: stage(e.round), actionLabel: "阵营转换",
        text: person(c.after), detail: side(c.before.faction) + " → " + side(c.after.faction),
        contextLabel: side(c.before.faction) + " → " + side(c.after.faction), rolePortrait: roleArt(c.after), tone: c.after.faction });
    if (e.kind === "skills") {
      for (const a of e.actions || []) if (a.actor?.seat === seat) {
        const row = actionRow(a, steps.length);
        const target = a.targets?.length === 1 ? a.targets[0] : null;
        steps.push({ id: e.id + ":" + steps.length, label: (e.round ? "第" + e.round + "轮 · " : "") + row.action,
          stageLabel: stage(e.round), actionLabel: row.action, isAction: true,
          text: row.detail, detail: row.result, contextLabel: row.result, tone: row.tone,
          textTone: target?.faction || "neutral", rolePortrait: roleArt(target) });
      }
      for (const draw of e.draws || []) if (draw.after.seat === seat)
        steps.push({ id: e.id + ":draw:" + steps.length, label: stage(e.round) + " · 抽牌复活", stageLabel: stage(e.round), actionLabel: "抽牌复活",
          text: person(draw.after), rolePortrait: roleArt(draw.after),
          detail: (draw.armor ? "复活甲保留原身份 · " : "新身份 · ") + side(draw.after.faction) + "阵营",
          contextLabel: (draw.armor ? "复活甲保留原身份 · " : "新身份 · ") + side(draw.after.faction) + "阵营", tone: draw.after.faction });
    }
  }
  const statusLabel = final ? final.alive ? "在场" : "已出局" : "";
  steps.push({ id: "final", label: "对局结束 · 最终身份", stageLabel: "终局", actionLabel: "最终身份", text: person(final),
    detail: final ? side(final.faction) + "阵营 · " + statusLabel : "最终身份未记录",
    contextLabel: final ? side(final.faction) + "阵营" : "最终身份未记录", rolePortrait: roleArt(final),
    statusLabel, alive: !!final?.alive, tone: final?.faction || "unknown" });
  return { seat, name: initial?.name || final?.name || "", isSelf: seat === raw.self.seat,
    finalPlayer: final ? player(final, raw.self.seat) : null, steps };
}
function presentReplay(raw, view = "global", expanded = []) {
  const selfSeat = raw.self.seat, initialPlayers = raw.initialPlayers.map(p => player(p, selfSeat));
  const allEvents = displayEvents(raw.events).map(e => event(e, initialPlayers));
  const rounds = [];
  for (const e of allEvents) {
    const id = Number.isInteger(e.round) && e.round > 0 ? "round-" + e.round : "round-unknown";
    let round = rounds.find(r => r.id === id);
    if (!round) { round = { id, number: e.round || null, title: e.round ? "第 " + e.round + " 轮" : "未记录轮次", events: [], expanded: expanded.includes(id) }; rounds.push(round); }
    if (view === "global" || e.relatedSeats.includes(selfSeat) || e.kind === "canceled") {
      round.events.push(view === "global" ? { ...e } : { ...e,
        rows: e.rows.filter(r => r.relatedSeats?.includes(selfSeat)),
        drawRows: e.drawRows.filter(r => r.relatedSeats?.includes(selfSeat)), confirmationsLabel: "" });
    }
  }
  for (const r of rounds) {
    const all = allEvents.filter(e => (e.round || null) === r.number), tasks = all.filter(e => e.kind === "quest");
    r.badge = tasks.length === 1 ? tasks[0].success ? "任务成功" : "任务失败" : tasks.length ? tasks.length + "次任务"
      : all.length === 1 ? all[0].badge || "已记录" : all.length + "项操作";
    r.tone = tasks.length === 1 ? tasks[0].success ? "good" : "evil" : all.length === 1 ? all[0].tone : "neutral";
    r.summary = all.map(e => e.title).filter((s, i, a) => a.indexOf(s) === i).join(" · ");
    for (const e of r.events) {
      e.hideBadge = e.badge === r.badge && (all.length === 1 || e.kind === "quest" && tasks.length === 1);
      if (e.kind === "skills") e.badge = e.rows.length ? e.rows.length + " 次行动" : "";
    }
  }
  const quests = allEvents.filter(e => e.kind === "quest"), successes = quests.filter(e => e.success).length;
  const score = raw.self.score;
  const final = { ...raw.final, actor: raw.final.actor ? player(raw.final.actor, selfSeat) : null,
    target: raw.final.target ? player(raw.final.target, selfSeat) : null,
    hasKnife: Number.isInteger(raw.final.targetSeat) && raw.final.targetSeat >= 0,
    summaryLabel: raw.final.reason === "assassination" ? "三次任务成功" : raw.final.label,
    actorLabel: raw.final.actor ? person(raw.final.actor) : "带刀人未记录",
    targetLabel: raw.final.targetSeat === 0 ? "0号空刀" : raw.final.target ? person(raw.final.target) : "目标未记录" };
  final.resultLabel = raw.final.hit === true ? "刺中梅林" : raw.final.hit === false && raw.final.targetSeat !== 0 ? "未刺中梅林"
    : raw.final.targetSeat === 0 ? raw.final.emptyWin === true ? "空刀，场上没有梅林" : raw.final.emptyWin === false ? "空刀，场上仍有梅林" : "最终空刀" : "";
  const date = new Date(raw.endedAt), pad = n => String(n).padStart(2, "0");
  return { replay: { ...raw, final, dateLabel: Number.isNaN(date.getTime()) ? "结束时间未记录" : `${date.getMonth()+1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    winnerLabel: raw.winner ? side(raw.winner) + "获胜" : "胜方未登记", winnerTone: raw.winner || "neutral",
    outcomeLabel: raw.self.outcome === "win" ? "胜利" : raw.self.outcome === "loss" ? "失利" : "不计战绩",
    selfFactionLabel: side(raw.self.faction), initialSelf: initialPlayers.find(p => p.isSelf),
    scoreLabel: score.status === "scored" ? (score.total >= 0 ? "+" : "") + score.total : "未计分",
    score: { ...score, breakdown: (score.breakdown || []).map(a => ({ ...a, pointsLabel: (a.points >= 0 ? "+" : "") + a.points })) },
    goodCount: initialPlayers.filter(p => p.faction === "good").length, evilCount: initialPlayers.filter(p => p.faction === "evil").length,
    unknownCount: initialPlayers.filter(p => p.faction === "unknown").length },
    initialPlayers: view === "mine" ? initialPlayers.filter(p => p.isSelf) : initialPlayers,
    finalPlayers: raw.finalPlayers.map(p => player(p, selfSeat)), rounds,
    questLabel: quests.length ? successes + " 成功 / " + (quests.length - successes) + " 失败" : "任务结果未记录",
    taskPips: quests.map((q, i) => ({ id: q.id, number: i + 1, success: q.success })),
    selfTrajectory: trajectory(raw, selfSeat), view };
}
module.exports = { presentReplay, trajectory };
