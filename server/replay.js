"use strict";

// Observations only: replay never decides or changes a game's outcome.
const VERSION = 1;
const classic = board => ["classic", "classic-court", "classic-11"].includes(board);
const supported = board => classic(board) || /^knights(?:-|$)/.test(board || "");
const clone = value => structuredClone(value);
const cleanPlayer = p => p ? { seat: p.seat, name: p.name, role: p.role || null,
  roleId: p.roleId || null, faction: p.faction || "unknown", alive: p.alive !== false } : null;
function player(room, uid, roles, snapshot) {
  const member = room.players.find(p => p.uid === uid);
  if (!member) return null;
  const roleId = (snapshot?.roles || room.roles)[uid];
  const state = (snapshot?.players || room.knights?.players)?.[uid];
  return cleanPlayer({ seat: member.seat, name: member.name, roleId,
    role: roles[roleId]?.[0], faction: room.convertedReverse === uid ? "evil" : state?.faction || roles[roleId]?.[1], alive: state?.alive });
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
  if (!supported(room.board) || !room.roles || ["lobby", "ended", "terminated"].includes(room.phase)) return null;
  return { historyLength: room.history.length,
    activity: clone(room.activity), submissions: { ...room.submissions },
    players: room.players.map(p => player(room, p.uid, roles)),
    night: room.knights && Object.fromEntries(room.players.map(p => [p.uid, room.knights.players[p.uid].nightInfo || null])) };
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
  const entries = room.history.slice(before.historyLength);
  if (!entries.length && !room.knights) return;
  const after = room.players.map(p => player(room, p.uid, roles));
  const submissions = { ...before.submissions, ...(input.type === "submit" ? { [uid]: input.value } : {}) };
  // In flexible classic games room.round does not advance. Each settled quest
  // closes one round, while rejected votes and canceled tasks stay in that round.
  let completedQuests = !room.knights
    ? room.history.slice(0, before.historyLength).filter(e => ["quest", "toolQuest"].includes(e.kind)).length : 0;
  for (const entry of entries) {
    const finalAction = ["toolKnife", "assassination", "toolOffline"].includes(entry.kind);
    const round = entry.round || room.knights?.round || (finalAction
      ? Math.max(1, completedQuests, room.replay.events.at(-1)?.round || 0) : completedQuests + 1);
    const base = { round, number: entry.number || before.activity?.number || null,
      startedAt: entry.startedAt || before.activity?.startedAt || Date.now() };
    if (["toolVote", "team"].includes(entry.kind))
      append(room, roles, { ...base, kind: "vote", team: [...entry.team], votes: clone(entry.votes),
        approved: entry.approved, leader: entry.leader || null, earlyClosed: !!entry.earlyClosed });
    else if (["toolQuest", "quest"].includes(entry.kind)) {
      completedQuests++;
      append(room, roles, { ...base, kind: "quest", team: [...entry.team], success: entry.success,
        fails: entry.fails, threshold: entry.threshold, earlyClosed: !!entry.earlyClosed,
        cards: room.players.filter(p => entry.team.includes(p.seat)).map(p => {
          const actor = before.players.find(old => old.seat === p.seat);
          const defaulted = entry.earlyClosed && input.type === "closeWaiting" && actor?.alive && !submissions[p.uid];
          return { actor, value: submissions[p.uid] || (defaulted ? actor.faction === "good" ? "success" : "fail" : null),
            ...(defaulted ? { defaulted: true } : {}) };
        }) });
    } else if (entry.resultType === "conversion")
      append(room, roles, { ...base, kind: "conversion", converted: entry.text === "本轮阵营转换",
        changes: changes(before.players, after) });
    else if (entry.resultType === "fairy")
      append(room, roles, { ...base, kind: "fairy", actor: after.find(p => p.seat === entry.actor),
        target: after.find(p => p.seat === entry.target) });
    else if (entry.kind === "toolCanceled")
      append(room, roles, { ...base, kind: "canceled", operation: before.activity?.kind || null,
        text: entry.text || "操作已作废", detail: entry.detail || null });
    else if (["toolKnife", "assassination"].includes(entry.kind))
      append(room, roles, { ...base, kind: "knife", actor: (room.knights
        ? after.find(p => p.seat === before.activity?.actor) : after.find(p => p.roleId === "assassin")) || null,
        target: after.find(p => p.seat === entry.target) || null, targetSeat: entry.target, hit: entry.hit });
    else if (entry.resultType === "knifeUnavailable" && before.activity?.kind === "assassination")
      append(room, roles, { ...base, kind: "knife", actor: before.players.find(p => p.seat === before.activity.actor) || null,
        target: null, targetSeat: null, hit: null, decision: false, text: entry.text });
    else if (entry.kind === "toolOffline")
      append(room, roles, { ...base, kind: "offline", text: "线下操作已完成，具体过程未记录" });
  }
  if (!room.knights) return;
  for (const p of room.players) {
    const information = room.knights.players[p.uid].nightInfo;
    if (information && information !== before.night[p.uid])
      append(room, roles, { kind: "vision", round: room.knights.round,
        startedAt: Date.now(), actor: player(room, p.uid, roles), information });
  }
}
function snapshot(room) { return room.replay ? clone(room.replay) : null; }
function historicalClassicEvents(game, participants, roleName) {
  const quests = (game.funFacts?.events || []).filter(e => e.kind === "quest");
  const timeline = game.funFacts?.badgeTimeline || quests;
  let completed = 0;
  return timeline.flatMap((e, index) => {
    const base = { id: "legacy:" + index, round: completed + 1 };
    if (e.kind === "vote") return [{ ...base, kind: "vote", team: e.team, approved: e.approved,
      votes: e.votes.map(v => ({ seat: v.seat, approve: v.approve })) }];
    if (e.kind !== "quest") return [];
    const detail = quests[completed++];
    const quest = detail?.success === e.success && detail?.team?.length === e.team.length
      && detail.team.every((seat, i) => seat === e.team[i]) ? detail : null;
    const members = quest?.members || [];
    return [{ ...base, kind: "quest", team: e.team, success: e.success,
      fails: quest?.fails, threshold: quest?.threshold, cards: members.map(m => ({
        actor: cleanPlayer({ seat: m.seat, name: participants.find(p => p.seat === m.seat)?.name,
          roleId: m.role, role: roleName(m.role), faction: m.faction }),
        value: m.playedFailure === true ? "fail" : m.playedSuccess === true ? "success" : null,
      })) }];
  });
}
function historicalEvents(game, participants, roleName) {
  if (classic(game.board)) return historicalClassicEvents(game, participants, roleName);
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
    merlin: "good", percival: "good", servant: "good", reverse: "good",
    assassin: "evil", mordred: "evil", morgana: "evil", minion: "evil", oberon: "evil" };
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
