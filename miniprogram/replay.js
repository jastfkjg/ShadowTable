const factions = { good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" };
const actions = { knife: "出刀", duel: "决斗", detonate: "主动自爆并开枪", passiveGun: "预选被动枪",
  gun: "开枪", guard: "守护", substitute: "指定替死", swap: "换号", inspect: "查验", reflect: "反伤" };
const effects = { eliminated: "目标出局", disarmed: "目标失去刀", guarded: "被守护挡下", reflected: "被反伤",
  duel_failed: "决斗失败", already_out: "目标已出局", already_used: "目标已失去刀", invalid_role: "目标不受此刀影响" };
const seats = list => list?.length ? list.map(n => n + "号").join("、") : "无";
const person = p => p ? p.seat + "号 " + (p.role || "身份未记录") : "未记录";
const side = faction => factions[faction] || "未知";
const player = (p, selfSeat) => ({ ...p, isSelf: p.seat === selfSeat,
  roleLabel: p.role || "未记录", factionLabel: side(p.faction) });
function actionRow(action, id) {
  const selected = action.targets || [], resolved = action.resolvedTargets || selected;
  const mapped = selected.map(p => p.seat).join(",") !== resolved.map(p => p.seat).join(",");
  let detail = action.kind === "swap" ? seats(selected.map(p => p.seat)).replace("、", " ↔ ")
    : "选择 " + selected.map(person).join("、");
  if (mapped) detail += "；换号后目标 " + resolved.map(person).join("、");
  if (action.recipient && !resolved.some(p => p.seat === action.recipient.seat))
    detail += "；实际承受者 " + person(action.recipient);
  let result = effects[action.effect] || "";
  if (action.inspection) result = action.inspection.canKill ? "拥有主动击杀能力" : "没有主动击杀能力";
  else if (action.status === "notTriggered") result = "未触发，技能未消耗";
  else if (action.status === "triggered") result = result || "已触发，技能已消耗";
  else if (action.kind === "reflect") result = "攻击者反伤出局";
  const relatedSeats = [action.actor?.seat, ...selected.map(p => p.seat), ...resolved.map(p => p.seat), action.recipient?.seat].filter(Boolean);
  return { id, headline: person(action.actor), actorSeat: action.actor?.seat,
    action: action.kind === "passiveGun" && action.status === "triggered" ? "被动开枪" : actions[action.kind] || "技能",
    detail, result, tone: action.actor?.faction || "unknown", relatedSeats };
}
function event(raw, initialPlayers) {
  let title = "", badge = "", tone = "neutral", summary = "", footer = "";
  let rows = [], drawRows = [], relatedSeats = [];
  if (raw.kind === "vote") {
    title = "组队与投票"; badge = raw.approved ? "组队通过" : "组队否决"; tone = raw.approved ? "good" : "evil";
    summary = (raw.leader ? raw.leader + "号带队 · " : "") + "队伍 " + seats(raw.team);
    rows = raw.votes.map((v, i) => ({ id: i, headline: v.seat + "号 " + (initialPlayers.find(p => p.seat === v.seat)?.name || ""),
      detail: v.approve === null ? "弃权" : v.approve ? "赞成" : "反对", tone: v.approve === null ? "neutral" : v.approve ? "good" : "evil", relatedSeats: [v.seat] }));
    footer = `${raw.votes.filter(v => v.approve === true).length} 赞成 · ${raw.votes.filter(v => v.approve === false).length} 反对 · ${raw.votes.filter(v => v.approve === null).length} 弃权`;
    if (raw.earlyClosed) footer += " · 含提前截止";
  } else if (raw.kind === "quest") {
    title = "任务结果"; badge = raw.success ? "任务成功" : "任务失败"; tone = raw.success ? "good" : "evil";
    summary = `${(raw.team || []).length - raw.fails}张成功 · ${raw.fails}张失败 · 失败门槛${raw.threshold}张`;
    rows = (raw.cards || []).map((card, i) => ({ id: i, headline: person(card.actor),
      detail: card.value === "success" ? "出成功" : card.value === "fail" ? "出失败" : "出牌未记录",
      tone: card.value === "fail" ? "evil" : "good", relatedSeats: [card.actor?.seat].filter(Boolean) }));
    footer = "队伍 " + seats(raw.team) + (!rows.length ? " · 逐人出牌未记录" : "");
    relatedSeats = raw.team || [];
  } else if (raw.kind === "conversion") {
    title = "身份转换"; badge = raw.converted ? "转换" : "不转换";
    rows = (raw.changes || []).map((c, i) => ({ id: i, headline: person(c.before),
      detail: side(c.before.faction) + " → " + side(c.after.faction), tone: c.after.faction, relatedSeats: [c.seat] }));
    summary = raw.converted ? "抽到转换牌" : "抽到不转换牌，阵营保持原状";
    if (raw.converted && !rows.length) footer = "本次没有发生身份或阵营变化";
  } else if (raw.kind === "skills") {
    title = "技能结算"; badge = raw.summary ? "同时提交" : "已有行动";
    rows = (raw.actions || []).map(actionRow);
    drawRows = (raw.draws || []).map((draw, i) => ({ id: i, headline: draw.after.seat + "号 · 第" + draw.order + "张",
      detail: draw.armor ? "复活甲：保留 " + draw.after.role + "，消耗1张B牌" : (draw.before.role || "未记录") + " → " + (draw.after.role || "未记录"),
      result: side(draw.after.faction) + " · 抽牌复活" + (draw.inspection ? "；随机查验" + draw.inspection.seat + "号：" + (draw.inspection.canKill ? "拥有" : "没有") + "主动击杀能力" : ""),
      tone: draw.after.faction, relatedSeats: [draw.after.seat] }));
    if (raw.summary) footer = "本轮出局 " + seats(raw.summary.eliminated) + "；抽牌复活 " + seats(raw.summary.redrawn)
      + (raw.summary.restored?.length ? "；原牌复活 " + seats(raw.summary.restored) : "") + "；最终仍出局 " + seats(raw.summary.out);
    else footer = "旧记录仅保留部分攻击结果，完整技能与抽牌过程未记录";
    if (raw.earlyClosed) footer += "；含提前截止，未提交者按不使用技能处理";
    if (!rows.length) summary = raw.summary ? "本轮无人使用技能" : "本轮没有技能行动记录";
  } else if (raw.kind === "fairy") {
    title = "仙女查验";
    rows = [{ id: 0, headline: person(raw.actor), detail: "查验 " + person(raw.target),
      result: "当时阵营：" + side(raw.target?.faction) + "；仙女传递给" + raw.target?.seat + "号",
      relatedSeats: [raw.actor?.seat, raw.target?.seat].filter(Boolean) }];
  } else if (raw.kind === "vision") {
    title = "月下先知视野";
    rows = [{ id: 0, headline: person(raw.actor), detail: raw.information, relatedSeats: [raw.actor?.seat].filter(Boolean) }];
  } else if (raw.kind === "knife") {
    title = "盘刀行动"; badge = raw.targetSeat === 0 ? "空刀" : raw.hit ? "命中" : "未命中"; tone = raw.hit ? "evil" : "good";
    if (raw.targetSeat === 0) footer = raw.hit ? "场上没有梅林" : "场上仍有梅林";
    rows = [{ id: 0, headline: raw.actor ? person(raw.actor) : "带刀人未记录",
      detail: raw.targetSeat === 0 ? "选择0号空刀" : "选择 " + person(raw.target),
      relatedSeats: [raw.actor?.seat, raw.target?.seat].filter(Boolean) }];
  } else if (raw.kind === "canceled") {
    title = "作废操作"; badge = "已作废"; summary = raw.text; footer = raw.detail || "本次未完成的操作不计入有效结果";
  } else { title = "线下操作"; summary = raw.text || "具体过程未记录"; }
  relatedSeats = [...new Set([...relatedSeats, ...rows.flatMap(r => r.relatedSeats || []), ...drawRows.flatMap(r => r.relatedSeats || [])])];
  return { ...raw, title, badge, tone, summary, rows, drawRows, footer, relatedSeats,
    confirmationsLabel: raw.confirmations?.length ? seats(raw.confirmations) + "：不使用技能 / 确认" : "" };
}
function trajectory(raw, seat) {
  const initial = raw.initialPlayers.find(p => p.seat === seat), final = raw.finalPlayers.find(p => p.seat === seat);
  if (!initial && !final) return null;
  const steps = [{ id: "initial", label: "开局 · 初始身份", text: person(initial), detail: initial?.role ? side(initial.faction) + "阵营" : "初始身份未记录", tone: initial?.faction || "unknown" }];
  for (const e of raw.events) {
    if (e.kind === "conversion") for (const c of e.changes || []) if (c.seat === seat)
      steps.push({ id: e.id, label: "第" + e.round + "轮 · 阵营转换", text: person(c.after), detail: side(c.before.faction) + " → " + side(c.after.faction), tone: c.after.faction });
    if (e.kind === "skills") {
      for (const a of e.actions || []) if (a.actor?.seat === seat) {
        const row = actionRow(a, steps.length);
        steps.push({ id: e.id + ":" + steps.length, label: (e.round ? "第" + e.round + "轮 · " : "") + row.action,
          text: row.detail, detail: row.result, tone: row.tone });
      }
      for (const draw of e.draws || []) if (draw.after.seat === seat)
        steps.push({ id: e.id + ":draw", label: "第" + e.round + "轮 · 抽牌复活", text: person(draw.after),
          detail: (draw.armor ? "复活甲保留原身份 · " : "新身份 · ") + side(draw.after.faction) + "阵营", tone: draw.after.faction });
    }
  }
  steps.push({ id: "final", label: "对局结束 · 最终身份", text: person(final),
    detail: final ? side(final.faction) + "阵营 · " + (final.alive ? "在场" : "已出局") : "最终身份未记录", tone: final?.faction || "unknown" });
  return { seat, name: initial?.name || final?.name || "", steps };
}
function presentReplay(raw, view = "global", expanded = []) {
  const selfSeat = raw.self.seat, initialPlayers = raw.initialPlayers.map(p => player(p, selfSeat));
  const allEvents = raw.events.map(e => event(e, initialPlayers));
  const rounds = [];
  for (const e of allEvents) {
    const id = Number.isInteger(e.round) && e.round > 0 ? "round-" + e.round : "round-unknown";
    let round = rounds.find(r => r.id === id);
    if (!round) { round = { id, number: e.round || null, title: e.round ? "第 " + e.round + " 轮" : "未记录轮次", events: [], expanded: expanded.includes(id) }; rounds.push(round); }
    if (view === "global" || e.relatedSeats.includes(selfSeat) || e.kind === "canceled") {
      round.events.push(view === "global" ? e : { ...e,
        rows: e.rows.filter(r => r.relatedSeats?.includes(selfSeat)),
        drawRows: e.drawRows.filter(r => r.relatedSeats?.includes(selfSeat)), confirmationsLabel: "" });
    }
  }
  for (const r of rounds) {
    const all = allEvents.filter(e => (e.round || null) === r.number), tasks = all.filter(e => e.kind === "quest");
    r.badge = tasks.length === 1 ? tasks[0].success ? "任务成功" : "任务失败" : tasks.length ? tasks.length + "次任务" : "技能与其他行动";
    r.tone = tasks.length === 1 ? tasks[0].success ? "good" : "evil" : "neutral";
    r.summary = all.map(e => e.title).filter((s, i, a) => a.indexOf(s) === i).join(" · ");
  }
  const quests = allEvents.filter(e => e.kind === "quest"), successes = quests.filter(e => e.success).length;
  const score = raw.self.score;
  const final = { ...raw.final, actorLabel: raw.final.actor ? person(raw.final.actor) : "带刀人未记录",
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
