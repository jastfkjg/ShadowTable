"use strict";

// Observations only: replay never decides or changes a game's outcome.
const VERSION = 1;
const supported = board => /^knights(?:-|$)/.test(board || "");
const clone = value => structuredClone(value);
const cleanPlayer = p => p ? { seat: p.seat, name: p.name, role: p.role || null,
  roleId: p.roleId || null, faction: p.faction || "unknown", alive: p.alive !== false } : null;
function player(room, uid, roles, snapshot) {
  const member = room.players.find(p => p.uid === uid);
  if (!member) return null;
  const roleId = (snapshot?.roles || room.roles)[uid];
  const state = (snapshot?.players || room.knights?.players)?.[uid];
  return cleanPlayer({ seat: member.seat, name: member.name, roleId,
    role: roles[roleId]?.[0], faction: state?.faction || roles[roleId]?.[1], alive: state?.alive });
}
function init(room, roles, complete = true) {
  if (!supported(room.board)) return;
  const initial = room.knights?.initialRoles || room.fun?.initialRoles || {};
  room.replay = { version: VERSION, complete, initialPlayers: room.players.map(p => {
    const roleId = initial[p.uid];
    return cleanPlayer({ seat: p.seat, name: p.name, roleId,
      role: roles[roleId]?.[0], faction: roles[roleId]?.[1] });
  }), events: [] };
}
function append(room, roles, event) {
  if (!supported(room.board)) return;
  if (!room.replay) init(room, roles, false);
  room.replay.events.push({ id: "replay:" + room.replay.events.length, ...clone(event) });
}
function capture(room, roles) {
  if (!room.knights || !room.roles || ["lobby", "ended", "terminated"].includes(room.phase)) return null;
  return { round: room.knights.round, historyLength: room.history.length,
    activity: clone(room.activity), submissions: { ...room.submissions },
    players: room.players.map(p => player(room, p.uid, roles)),
    night: Object.fromEntries(room.players.map(p => [p.uid, room.knights.players[p.uid].nightInfo || null])) };
}
function changes(before, after) {
  return after.flatMap(next => {
    const previous = before.find(p => p.seat === next.seat);
    return previous && (previous.roleId !== next.roleId || previous.faction !== next.faction)
      ? [{ seat: next.seat, before: previous, after: next }] : [];
  });
}
function skillActions(room, records, attacks, roles) {
  const snapshot = room.knights.snapshot;
  const bySeat = seat => player(room, room.players.find(p => p.seat === seat)?.uid, roles, snapshot);
  return records.map(record => {
    const attack = attacks.find(e => e.actor.uid === record.uid &&
      ({ knife: "knife", duel: "duel", detonate: "gun", passiveGun: "gun" })[record.kind] === e.type);
    const inspection = record.kind === "inspect" ? room.knights.players[record.uid].gargoyleInfo : null;
    return { kind: record.kind, actor: player(room, record.uid, roles, snapshot),
      targets: record.targets.map(bySeat).filter(Boolean),
      resolvedTargets: (record.resolvedTargets || record.targets).map(bySeat).filter(Boolean),
      status: record.status, effect: attack?.effect || null,
      recipient: attack?.recipient ? bySeat(attack.recipient.seat) : null,
      ...(inspection ? { inspection: clone(inspection) } : {}) };
  });
}
function skills(room, actions, drawn, roles) {
  const k = room.knights;
  const before = room.players.map(p => player(room, p.uid, roles, k.snapshot));
  const after = room.players.map(p => player(room, p.uid, roles));
  const draws = drawn.map((uid, order) => ({ order: order + 1,
    before: player(room, uid, roles, k.snapshot), after: player(room, uid, roles),
    armor: !!k.snapshot.players[uid].armor && !k.players[uid].armor,
    ...(room.roles[uid] === "gargoyle" && k.players[uid].gargoyleInfo
      ? { inspection: clone(k.players[uid].gargoyleInfo) } : {}),
  }));
  append(room, roles, { kind: "skills", round: k.round, number: room.activity?.number || null,
    startedAt: room.activity?.startedAt || Date.now(), earlyClosed: !!room.activity?.earlyClosed,
    actions, draws, changes: changes(before, after),
    confirmations: room.players.filter(p => !actions.some(a => a.actor.seat === p.seat)).map(p => p.seat),
    summary: clone(k.summary) });
}
function observe(room, before, input, uid, roles) {
  if (!before || !supported(room.board) || input.type === "rematch") return;
  if (!room.replay) init(room, roles, false);
  const after = room.players.map(p => player(room, p.uid, roles));
  const submissions = { ...before.submissions, ...(input.type === "submit" ? { [uid]: input.value } : {}) };
  for (const entry of room.history.slice(before.historyLength)) {
    const base = { round: entry.round || room.knights.round, number: entry.number || before.activity?.number || null,
      startedAt: entry.startedAt || before.activity?.startedAt || Date.now() };
    if (["toolVote", "team"].includes(entry.kind))
      append(room, roles, { ...base, kind: "vote", team: [...entry.team], votes: clone(entry.votes),
        approved: entry.approved, leader: entry.leader || null, earlyClosed: !!entry.earlyClosed });
    else if (["toolQuest", "quest"].includes(entry.kind))
      append(room, roles, { ...base, kind: "quest", team: [...entry.team], success: entry.success,
        fails: entry.fails, threshold: entry.threshold,
        cards: room.players.filter(p => entry.team.includes(p.seat)).map(p => ({
          actor: before.players.find(old => old.seat === p.seat), value: submissions[p.uid] || null,
        })) });
    else if (entry.resultType === "conversion")
      append(room, roles, { ...base, kind: "conversion", converted: entry.text === "本轮阵营转换",
        changes: changes(before.players, after) });
    else if (entry.resultType === "fairy")
      append(room, roles, { ...base, kind: "fairy", actor: after.find(p => p.seat === entry.actor),
        target: after.find(p => p.seat === entry.target) });
    else if (entry.kind === "toolCanceled")
      append(room, roles, { ...base, kind: "canceled", operation: before.activity?.kind || null,
        text: entry.text || "操作已作废", detail: entry.detail || null });
    else if (["toolKnife", "assassination"].includes(entry.kind))
      append(room, roles, { ...base, kind: "knife", actor: after.find(p => p.seat === before.activity?.actor) || null,
        target: after.find(p => p.seat === entry.target) || null, targetSeat: entry.target, hit: entry.hit });
    else if (entry.kind === "toolOffline")
      append(room, roles, { ...base, kind: "offline", text: "线下操作已完成，具体过程未记录" });
  }
  for (const p of room.players) {
    const information = room.knights.players[p.uid].nightInfo;
    if (information && information !== before.night[p.uid])
      append(room, roles, { kind: "vision", round: room.knights.round,
        startedAt: Date.now(), actor: player(room, p.uid, roles), information });
  }
}
function snapshot(room) { return room.replay ? clone(room.replay) : null; }
function historicalEvents(game, participants, roleName) {
  const entity = e => e ? cleanPlayer({ ...e, roleId: e.role, role: roleName(e.role),
    name: participants.find(p => p.uid === e.uid)?.name || "" }) : null;
  return (game.funFacts?.events || []).flatMap((e, index) => {
    const id = "legacy:" + index;
    if (e.kind === "quest") return [{ id, kind: "quest", round: e.round, team: e.team,
      success: e.success, fails: e.fails, threshold: e.threshold, cards: [] }];
    if (e.kind !== "attack") return [];
    return [{ id, kind: "skills", round: e.round, actions: [{
      kind: { knife: "knife", gun: "gun", duel: "duel" }[e.type], actor: entity(e.actor),
      targets: [entity(e.selected)].filter(Boolean), resolvedTargets: [entity(e.recipient)].filter(Boolean),
      recipient: entity(e.recipient), effect: e.effect, status: "used",
    }], draws: [], changes: [], confirmations: [], summary: null }];
  });
}
function present(game, participants, uid, self, roleName) {
  const saved = game.replay;
  const initialFactions = { ...Object.fromEntries(Object.entries(require("./variants").roles).map(([id, r]) => [id, r[1]])),
    merlin: "good", percival: "good", servant: "good", assassin: "evil", mordred: "evil", morgana: "evil" };
  const initialPlayers = saved?.initialPlayers || participants.map(p => {
    const roleId = game.funFacts?.initialRoles?.[p.uid];
    return cleanPlayer({ seat: p.seat, name: p.name, roleId,
      role: roleId ? roleName(roleId) : null, faction: initialFactions[roleId] });
  });
  const t = game.funFacts?.terminal;
  const reasons = { assassination: "三次任务成功后最终盘刀", early_assassination: "提前盘刀",
    final_action: "最终盘刀", quest_fail: "三次任务失败", five_rejections: "连续五次组队被否决" };
  const actor = t?.actor ? participants.find(p => p.uid === t.actor.uid) : null;
  const status = !saved ? "legacy" : saved.complete ? "complete" : "partial";
  return { id: game.id, boardName: game.boardName, capacity: game.capacity,
    startedAt: game.startedAt, endedAt: game.endedAt, winner: game.winner,
    excludedReason: game.excludedReason || null, status,
    message: status === "complete" ? "" : status === "partial" ? "本局在进行中启用复盘，仅展示已记录的过程。"
      : "旧对局未保存完整复盘，仅展示已有记录；缺失过程不作推测。",
    initialPlayers: initialPlayers.map(cleanPlayer), events: saved?.events || historicalEvents(game, participants, roleName),
    finalPlayers: participants.map(cleanPlayer),
    self: { seat: self.seat, name: self.name, role: self.role, faction: self.faction,
      outcome: self.outcome, score: clone(self.score || { status: "legacy", total: null, breakdown: [] }) },
    final: { reason: t?.reason || game.scoringFacts?.reason || null,
      label: reasons[t?.reason || game.scoringFacts?.reason] || (game.excludedReason === "对局终止" ? "对局终止" : "房主登记结果"),
      actor: cleanPlayer(actor), target: cleanPlayer(participants.find(p => p.seat === (t?.target ?? game.scoringFacts?.target))),
      targetSeat: t?.target ?? game.scoringFacts?.target ?? null, hit: t?.hit ?? null,
      emptyWin: t?.emptyWin ?? null, corrected: (game.scoreRevision || 0) > 0 } };
}
module.exports = { supported, init, capture, observe, skillActions, skills, snapshot, present };
