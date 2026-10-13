"use strict";
// Facts remain server-only. Projections below expose only the authenticated player's story.
const VERSION = "fun-2026-10-v4";
const { labels, titles, honors } = require("../miniprogram/fun-copy");
const { roles: variantRoles } = require("./variants");
const bRoles = new Set(Object.keys(variantRoles).slice(Object.keys(variantRoles).indexOf("blueAwakened")));
const modes = { voted: "玩家票选", classic: "经典", knights: "十二骑士", other: "扩展玩法" };
const modeFor = (board) =>
  /^knights(?:-|$)/.test(board)
    ? "knights"
    : ["classic", "classic-court"].includes(board)
      ? "classic"
      : "other";
const extraRankings = {
  percival_bust: { rateThreshold: 1 },
  merlin_hit: { rateThreshold: 1 },
  assassin_miss: { rateThreshold: 1 },
  knife_ally: { rateThreshold: 1 },
  duel_ally: { rateThreshold: 1 },
  defense_enemy: { rateThreshold: 1 },
  kill_ally: { rateThreshold: 1 },
};
const definitions = [
  ["survival_revive", labels.survival_revive, "survival", titles.survival, "次", true],
  ["survival_knifed", labels.survival_knifed, "survival", titles.survival, "次", true],
  ["honor_mvp", "胜方最佳", "honor", "本场最佳", "次", true],
  ["honor_svp", "败方最佳", "honor", "本场最佳", "次", true],
  ["percival_green", labels.percival_green, "percival", titles.percival, "局", true, 1],
  ["percival_bust", labels.percival_bust, "percival", titles.percival, "局", false],
  ["merlin_evade", labels.merlin_evade, "merlin", "梅林", "次", true, 1],
  ["merlin_hit", labels.merlin_hit, "merlin", "梅林", "次", false],
  ["good_shield", "成功挡刀", "shield", "好人", "次", true, 1],
  ["assassin_hit", labels.assassin_hit, "assassin", "刺客", "次", true, 1],
  ["assassin_miss", labels.assassin_miss, "assassin", "刺客", "次", false],
  ["defense_ally", labels.defense_ally, "defense", titles.defense, "次", true, 1],
  ["defense_enemy", labels.defense_enemy, "defense", titles.defense, "次", false],
  ["kill_enemy", labels.kill_enemy, "kill", titles.kill, "次", true, 1],
  ["kill_ally", labels.kill_ally, "kill", titles.kill, "次", false],
  ["final_hit", "最终刺中梅林", "final", "最终带刀", "次", true, 1],
  ["final_miss", "最终歪刀", "final", "最终带刀", "次", false],
  ["final_empty_win", "空刀获胜", "final", "最终带刀", "次", false],
  ["final_empty_loss", "空刀失利", "final", "最终带刀", "次", false],
  ...["knife", "gun", "duel"].flatMap((type) => [
    [
      type + "_enemy",
      labels[type + "_enemy"] || "命中敌方",
      type,
      titles[type] || "猎人枪法",
      "次",
      true,
      1,
    ],
    [
      type + "_ally",
      labels[type + "_ally"] || "命中同伴",
      type,
      titles[type] || "猎人枪法",
      "次",
      false,
    ],
    [
      type + "_failed",
      "未生效",
      type,
      titles[type] || "猎人枪法",
      "次",
      false,
    ],
    [
      type + "_aim_enemy",
      "刀口选敌",
      type,
      titles[type] || "猎人枪法",
      "次",
      false,
    ],
  ]),
].map(([id, label, group, title, unit, positive, rateThreshold]) => ({
  id,
  countOnly: !!honors[id]?.countOnly,
  label,
  group,
  title,
  unit,
  positive,
  ranked: positive || Object.hasOwn(extraRankings, id),
  rankLabel: extraRankings[id]?.label || label,
  rateLabel: Object.hasOwn(extraRankings, id) ? "发生率" : "成功率",
  rateThreshold: rateThreshold || extraRankings[id]?.rateThreshold || 0,
  ...(honors[id] ? { honorTitle: honors[id].title, description: honors[id].description } : {}),
}));
const metrics = Object.fromEntries(definitions.map((item) => [item.id, item]));
const combatType = (role) =>
  ["blueHunter", "redHunter"].includes(role)
    ? "gun"
    : ["blueKnight", "redKnight"].includes(role)
      ? "duel"
      : [
            "gareth",
            "gaheris",
            "blueLancelot",
            "redLancelot",
            "redSwordsman",
            "assassin",
            "blueAwakened",
            "redAwakened",
          ].includes(role)
        ? "knife"
        : null;
const effects = {
  eliminated: "目标出局",
  disarmed: "目标失去刀",
  guarded: "被守护挡下",
  reflected: "被反伤",
  duel_failed: "决斗失败",
  already_out: "目标已出局",
  already_used: "目标已失去刀",
  invalid_role: "目标不受此刀影响",
};
// Test the original target, before a magician redirects the skill.
function canHarm(actor, target, state = {}) {
  if (!target || target.alive === false || state.alive === false) return false;
  const type = combatType(actor.role);
  if (type === "gun" || ["blueAwakened", "redAwakened"].includes(actor.role)) return true;
  if (type === "duel") return actor.faction !== (target.role === "mordred" ? "good" : target.faction);
  if (type !== "knife") return false;
  if (target.role === "assassin") return false;
  return combatType(target.role) === "knife" || state.b === true ||
    bRoles.has(target.role);
}
function defenseFacts(record, players) {
  const state = record.funFacts;
  if (state?.defensesComplete)
    return { complete: !!state.attacksComplete, events: (state.events || []).filter(e => e.kind === "defense") };
  // Full replays retain defensive actors and targets. Older attack-only facts do not.
  if (!record.replay?.complete || !state?.attacksComplete) return { complete: false, events: [] };
  const events = [];
  const entity = p => ({ uid: players.find(player => player.seat === p.seat)?.uid,
    seat: p.seat, role: p.roleId, faction: p.faction, alive: p.alive });
  const add = (cycle, actor, protectedPlayer) => {
    const defender = entity(actor), protectedTarget = entity(protectedPlayer);
    if (!defender.uid || !protectedTarget.uid) return;
    events.push({ id: `defense:legacy:${cycle.id}:${events.length}`, kind: "defense", round: cycle.round,
      actor: defender, protected: protectedTarget,
      outcome: defender.faction === protectedTarget.faction ? "ally" : "enemy" });
  };
  for (const cycle of record.replay.events.filter(e => e.kind === "skills")) {
    const actions = cycle.actions || [], swap = actions.find(a => a.kind === "swap" && a.actor?.roleId === "magician");
    const out = new Set(actions.flatMap(a => [a.actor, ...(a.targets || [])]).filter(p => p?.alive === false).map(p => p.seat));
    for (const action of actions) {
      if (action.kind === "guard" && action.status === "triggered" && action.actor?.roleId === "blueGuard" && action.resolvedTargets?.[0])
        add(cycle, action.actor, action.resolvedTargets[0]);
      const target = action.targets?.[0], resolved = action.resolvedTargets?.[0];
      if (swap && ["knife", "duel", "detonate", "passiveGun", "gun"].includes(action.kind) && target && resolved &&
          target.seat !== resolved.seat && swap.targets.some(p => p.seat === target.seat) && !out.has(target.seat) &&
          action.recipient?.seat !== target.seat && canHarm(entity(action.actor), entity(target)))
        add(cycle, swap.actor, target);
      if (action.effect === "eliminated" && action.recipient) out.add(action.recipient.seat);
      if (action.effect === "reflected") out.add(action.actor.seat);
    }
  }
  return { complete: true, events };
}
function init(room) {
  room.fun = {
    version: VERSION,
    defensesComplete: true,
    initialRoles: { ...room.roles },
    events: [],
    terminal: null,
  };
}
function settlementOptions(board) {
  if (modeFor(board) === "other") return [];
  return [
    {
      id: "assassination",
      label: "三绿，已完成最终刺杀",
      requiresTarget: true,
    },
    ...(modeFor(board) === "knights"
      ? [{ id: "early_assassination", label: "提前盘刀", requiresTarget: true }]
      : []),
    { id: "quest_fail", label: "三次任务失败", winner: "evil" },
    { id: "five_rejections", label: "连续五次组队被否决", winner: "evil" },
  ];
}
function terminal(room, facts, roles, source) {
  if (!facts) return null;
  const final = [
    "assassination",
    "early_assassination",
    "final_action",
  ].includes(facts.reason);
  const living = (player) =>
    !room.knights || room.knights.players[player.uid].alive;
  const merlins = room.players
    .filter((p) => room.roles[p.uid] === "merlin" && living(p))
    .map((p) => p.uid);
  const target = room.players.find((p) => p.seat === facts.target);
  const actor =
    facts.actor !== undefined
      ? room.players.find((p) => p.seat === facts.actor)
      : !room.knights
        ? room.players.find((p) => room.roles[p.uid] === "assassin")
        : null;
  return {
    reason: facts.reason,
    source,
    ...(final
      ? {
          target: facts.target,
          hit:
            !!target && living(target) && room.roles[target.uid] === "merlin",
          merlins,
          actor: actor
            ? {
                uid: actor.uid,
                role: room.roles[actor.uid],
                faction: room.knights
                  ? room.knights.players[actor.uid].faction ||
                    roles?.[room.roles[actor.uid]]?.[1] ||
                    actor.faction
                  : roles?.[room.roles[actor.uid]]?.[1] || actor.faction,
              }
            : null,
          emptyWin: facts.target === 0 && merlins.length === 0,
        }
      : {}),
  };
}
function recordQuest(room, result) {
  if (!room.fun) return;
  room.fun.events.push({
    id: "quest:" + (result.number ?? result.round),
    kind: "quest",
    round: result.round ?? room.knights?.round ?? room.round,
    success: result.success,
    threshold: result.threshold,
    fails: result.fails,
    team: [...result.team],
  });
}
function project(record, players, roles) {
  const state = record.funFacts;
  const mode = modeFor(record.board),
    t = state?.terminal;
  const defenses = mode === "knights" ? defenseFacts(record, players) : null;
  const excluded = !!record.excludedReason;
  const labelRole = (id) =>
    (typeof roles === "function" ? roles(id) : roles[id]?.[0]) || "未知角色";
  return players.map((player) => {
    const initial =
      state?.initialRoles?.[player.uid] ||
      (mode === "classic" ? player.roleId : null);
    const rows = [],
      events = [];
    const add = (id, role, count, opportunities, known) =>
      rows.push({
        id,
        role: role || "unknown",
        count,
        opportunities,
        status: excluded ? "excluded" : known ? "known" : "unknown",
      });
    if (record.honorResult?.status === "settled" && !player.uid.startsWith("test:") && ["win", "loss"].includes(player.outcome)) {
      for (const key of ["mvp", "svp"]) {
        const award = record.honorResult[key].find(p => p.seat === player.seat);
        add("honor_" + key, "all", award ? 1 : 0, 0, true);
        if (award) events.push({ id: "honor_" + key, label: "最强 " + key.toUpperCase(), detail: `${award.votes} 票 · 玩家匿名票选${record.honorResult[key].length > 1 ? " · 并列获奖" : ""}` });
      }
    }
    if (initial === "percival") {
      const known = !!t && t.reason !== "final_action";
      add(
        "percival_green",
        initial,
        t?.reason === "assassination" && !t.hit && t.merlins?.length ? 1 : 0,
        known ? 1 : 0,
        known,
      );
      add(
        "percival_bust",
        initial,
        t?.reason === "quest_fail" || t?.hit ? 1 : 0,
        known || t?.hit ? 1 : 0,
        known || !!t?.hit,
      );
    }
    // Classical identities do not change. In knights only the living endgame Merlin has this opportunity.
    if (player.roleId === "merlin") {
      const known = !!t;
      const opportunity = t?.merlins?.includes(player.uid) ? 1 : 0;
      const hit = t?.hit && t.target === player.seat;
      add(
        "merlin_evade",
        "merlin",
        opportunity && !hit ? 1 : 0,
        opportunity,
        known,
      );
      add(
        "merlin_hit",
        "merlin",
        opportunity && hit ? 1 : 0,
        opportunity,
        known,
      );
    }
    // Use the final identity and faction, including knights' faction changes.
    const shieldEligible =
      player.roleId !== "merlin" && player.faction === "good";
    const shieldOpportunity =
      shieldEligible &&
      player.alive !== false &&
      Number.isInteger(t?.target) &&
      t.target > 0
        ? 1
        : 0;
    const shieldHit = shieldOpportunity && t.target === player.seat ? 1 : 0;
    if (shieldEligible) {
      add("good_shield", player.roleId, shieldHit, shieldOpportunity, !!t);
      if (shieldHit)
        events.push({
          id: "final-shield",
          role: labelRole(player.roleId),
          label: "成功挡刀",
          detail: `最终刀落到本人（${player.seat}号） · ${t.source === "system" ? "系统结算" : "房主登记"}`,
        });
    }
    if (
      player.roleId === "assassin" ||
      (t?.actor?.uid === player.uid && t.actor.role === "assassin")
    ) {
      const opportunity =
        t?.actor?.uid === player.uid && t.target !== 0 ? 1 : 0;
      const known = !!t && (!t.merlins || !!t.actor);
      add(
        "assassin_hit",
        "assassin",
        opportunity && t.hit ? 1 : 0,
        opportunity,
        known,
      );
      add(
        "assassin_miss",
        "assassin",
        opportunity && !t.hit ? 1 : 0,
        opportunity,
        known,
      );
    }
    if (mode === "knights" && t?.actor?.uid === player.uid) {
      const actual = t.target !== 0 ? 1 : 0;
      add("final_hit", t.actor.role, actual && t.hit ? 1 : 0, actual, true);
      add("final_miss", t.actor.role, actual && !t.hit ? 1 : 0, actual, true);
      add(
        "final_empty_win",
        t.actor.role,
        t.target === 0 && t.emptyWin ? 1 : 0,
        t.target === 0 ? 1 : 0,
        true,
      );
      add(
        "final_empty_loss",
        t.actor.role,
        t.target === 0 && !t.emptyWin ? 1 : 0,
        t.target === 0 ? 1 : 0,
        true,
      );
    }
    if (mode === "knights") {
      // Draws are actual returns to play, including armor and all indirect causes.
      const revivals = (record.replay?.events || []).filter(e => e.kind === "skills")
        .flatMap(cycle => (cycle.draws || []).filter(draw => draw.after?.seat === player.seat)
          .map((draw, index) => ({ id: `${cycle.id}:revive:${index}`, round: cycle.round, draw })));
      const received = (state?.events || []).filter(e => e.kind === "attack" && e.type === "knife" &&
        (e.recipient || e.selected)?.uid === player.uid);
      const finalKnife = Number.isInteger(t?.target) && t.target > 0 && t.target === player.seat;
      add("survival_revive", "all", revivals.length, 0, !!record.replay?.complete);
      add("survival_knifed", "all", received.length + Number(finalKnife), 0, !!state?.attacksComplete);
      for (const e of revivals)
        events.push({ id: e.id, round: e.round, kind: "revive", label: labels.survival_revive,
          detail: e.draw.armor ? "消耗铠甲，保留原身份复活" : "抽取新身份复活" });
      for (const e of received)
        events.push({ id: e.id + ":received", round: e.round, kind: "receivedKnife", label: labels.survival_knifed,
          detail: `${e.actor.seat}号出刀 · ${effects[e.effect] || e.effect}` });
      if (finalKnife) events.push({ id: "final-received", label: labels.survival_knifed, detail: "最终刀落到本人" });
      const attacks = (state?.events || []).filter(
        (e) => e.kind === "attack" && e.actor.uid === player.uid,
      );
      const roleSet = new Set(attacks.map((e) => e.actor.role));
      if (combatType(player.roleId)) roleSet.add(player.roleId);
      if (combatType(initial)) roleSet.add(initial);
      for (const role of roleSet) {
        const type = combatType(role),
          own = attacks.filter((e) => e.actor.role === role);
        if (!type) continue;
        for (const outcome of ["enemy", "ally"])
          add("kill_" + outcome, role,
            own.filter(e => e.effect === "eliminated" && e.outcome === outcome).length,
            own.length, !!state?.attacksComplete);
        for (const outcome of ["enemy", "ally", "failed", "aim_enemy"])
          add(
            type + "_" + outcome,
            role,
            own.filter((e) =>
              outcome === "aim_enemy"
                ? e.selected.faction !== e.actor.faction
                : e.outcome === outcome,
            ).length,
            own.length,
            !!state?.attacksComplete,
          );
      }
      const ownDefenses = defenses.events.filter(e => e.actor.uid === player.uid);
      const defenseRoles = new Set(ownDefenses.map(e => e.actor.role));
      for (const role of [initial, player.roleId])
        if (["blueGuard", "magician"].includes(role)) defenseRoles.add(role);
      for (const cycle of record.replay?.events || [])
        for (const action of cycle.actions || [])
          if (action.actor?.seat === player.seat && ["blueGuard", "magician"].includes(action.actor.roleId))
            defenseRoles.add(action.actor.roleId);
      for (const role of defenseRoles) {
        const own = ownDefenses.filter(e => e.actor.role === role);
        for (const outcome of ["ally", "enemy"])
          add("defense_" + outcome, role, own.filter(e => e.outcome === outcome).length,
            own.length, defenses.complete);
      }
      for (const e of ownDefenses)
        events.push({ id: e.id, round: e.round, role: labelRole(e.actor.role), kind: "defense",
          label: metrics["defense_" + e.outcome].label,
          detail: `${e.protected.seat}号${e.outcome === "ally" ? "同阵营" : "对方阵营"} · ${e.actor.role === "magician" ? "换号避开伤害" : "守护挡下伤害"}` });
      for (const e of attacks)
        events.push({
          id: "attack-" + events.length,
          round: e.round,
          role: labelRole(e.actor.role),
          kind: e.type,
          label: metrics[e.type + "_" + e.outcome].label,
          detail: `${e.selected.seat}号${e.selected.faction === e.actor.faction ? "同阵营" : "对方阵营"} · ${effects[e.effect] || e.effect}${e.recipient && e.recipient.seat !== e.selected.seat ? ` · 实际承受者${e.recipient.seat}号` : ""}`,
        });
    }
    if (initial === "percival" && t && t.reason !== "final_action")
      events.push({
        id: "task-outcome",
        role: labelRole(initial),
        label:
          {
            assassination: t.hit ? metrics.percival_bust.label : t.merlins?.length ? metrics.percival_green.label : "三蓝后梅林已出局",
            quest_fail: metrics.percival_bust.label,
            five_rejections: "五次否决结束",
            early_assassination: "提前盘刀",
          }[t.reason] || "任务阶段已登记",
        detail: t.source === "system" ? "系统结算" : "房主登记",
      });
    if (t?.merlins?.includes(player.uid) || t?.actor?.uid === player.uid) {
      const actor = t.actor?.uid === player.uid;
      const label = actor
        ? t.target === 0
          ? t.emptyWin
            ? "空刀获胜"
            : "空刀失利"
          : t.hit
            ? "刺中梅林"
            : metrics.assassin_miss.label
        : t.hit && t.target === player.seat
          ? metrics.merlin_hit.label
          : t.target === 0
            ? "成功躲刀（对方空刀）"
            : "成功躲刀";
      events.push({
        id: "final",
        role: labelRole(player.roleId),
        label,
        detail: `最终目标：${t.target === 0 ? "空刀" : t.target + "号"} · ${t.source === "system" ? "系统结算" : "房主登记"}`,
      });
    }
    return {
      uid: player.uid,
      fun: {
        version: VERSION,
        mode,
        initialRole: initial ? labelRole(initial) : null,
        status: excluded
          ? "excluded"
          : !state
            ? "legacy"
            : !t || t.reason === "final_action"
              ? "partial"
              : "recorded",
        reason: excluded
          ? record.excludedReason
          : !state
            ? "旧对局未记录完整过程"
            : t?.reason === "final_action"
              ? "任务阶段结果未登记；最终刀已记录"
              : !t
                ? "最终结果未记录；已完成的技能仍可查看"
                : null,
        metrics: rows,
        events,
        highlights: excluded
          ? []
          : rows
              .filter((row) => row.count > 0 && !row.id.endsWith("aim_enemy"))
              .map((row) => ({
                id: row.id,
                label: metrics[row.id].label,
                count: row.count,
                unit: metrics[row.id].unit,
              })),
      },
    };
  });
}
function aggregate(rows, legacyGames = 0) {
  const buckets = new Map();
  for (const row of rows) {
    const def = metrics[row.metric];
    if (!def || row.status === "excluded") continue;
    const key = row.mode + ":" + row.metric;
    const bucket = buckets.get(key) || {
      ...def,
      mode: row.mode,
      count: 0,
      opportunities: 0,
      knownMatches: new Set(),
      unknownMatches: new Set(),
      roles: new Map(),
    };
    const role = bucket.roles.get(row.role) || {
      role: row.role,
      label: row.role_label,
      count: 0,
      opportunities: 0,
      knownMatches: new Set(),
      unknownMatches: new Set(),
    };
    if (row.status === "known") {
      bucket.count += row.count;
      bucket.opportunities += row.opportunities;
      bucket.knownMatches.add(row.match_id);
      role.count += row.count;
      role.opportunities += row.opportunities;
      role.knownMatches.add(row.match_id);
    } else {
      bucket.unknownMatches.add(row.match_id);
      role.unknownMatches.add(row.match_id);
    }
    bucket.roles.set(row.role, role);
    buckets.set(key, bucket);
  }
  const list = [...buckets.values()]
    .sort(
      (a, b) =>
        Object.keys(modes).indexOf(a.mode) -
          Object.keys(modes).indexOf(b.mode) ||
        definitions.findIndex((d) => d.id === a.id) -
          definitions.findIndex((d) => d.id === b.id),
    )
    .map(({ knownMatches, unknownMatches, roles, ...row }) => ({
      ...row,
      knownGames: knownMatches.size,
      unknownGames: unknownMatches.size,
      value: knownMatches.size ? row.count : null,
      rate: row.opportunities
        ? Math.round((row.count / row.opportunities) * 1000) / 10
        : null,
      byRole: [...roles.values()].map(
        ({ knownMatches, unknownMatches, ...role }) => ({
          ...role,
          value: knownMatches.size ? role.count : null,
          knownGames: knownMatches.size,
          unknownGames: unknownMatches.size,
        }),
      ),
    }));
  const cards = new Map();
  for (const row of list) {
    const key = row.mode + ":" + row.group;
    const card = cards.get(key) || {
      id: key,
      mode: row.mode,
      modeLabel: modes[row.mode],
      title: row.title,
      metrics: [],
    };
    card.metrics.push(row);
    cards.set(key, card);
  }
  const highlights = list
    .filter((row) => row.positive && row.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    version: VERSION,
    cards: [...cards.values()],
    metrics: list,
    legacyGames,
    teaser: highlights.length
      ? `${highlights[0].title} · ${highlights[0].label} ${highlights[0].count} ${highlights[0].unit}`
      : "",
  };
}
function publicMetrics() {
  return definitions
    .filter((item) => honors[item.id])
    .sort((a,b) => Number(a.countOnly) - Number(b.countOnly))
    .map((item) => ({ ...item, title: item.honorTitle, label: labels[item.id] || item.rankLabel, key: "fun_" + item.id }));
}
module.exports = {
  VERSION,
  modes,
  metrics,
  combatType,
  canHarm,
  modeFor,
  init,
  settlementOptions,
  terminal,
  recordQuest,
  project,
  aggregate,
  publicMetrics,
};
