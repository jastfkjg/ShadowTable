"use strict";
const { randomUUID, randomInt } = require("node:crypto");
const { roles } = require("./variants");
const swords = [
  "gareth",
  "gaheris",
  "blueLancelot",
  "redLancelot",
  "redSwordsman",
  "assassin",
];
const guards = ["blueGuard"];
const hunters = ["blueHunter", "redHunter"];
const bRoles = Object.keys(roles).slice(
  Object.keys(roles).indexOf("blueAwakened"),
);
const skillRoles = [...swords, ...bRoles.filter((r) => r !== "prophet")];
function init(room, shuffle) {
  const blue = shuffle(bRoles.filter((r) => roles[r][1] === "good"));
  const red = shuffle(bRoles.filter((r) => roles[r][1] === "evil"));
  room.knights = {
    rulesVersion: 2,
    initialRoles: { ...room.roles },
    deck: [
      ...shuffle([...red.splice(0, 2), ...blue.splice(0, 2)]),
      ...shuffle([...red.splice(0, 2), ...blue.splice(0, 3)]),
      ...shuffle([...red, ...blue]),
    ],
    conversions: shuffle([true, true, false, false, false, false, false]),
    round: 1,
    convertedRound: 0,
    skillRound: 0,
    deaths: [],
    fairy: room.leader,
    fairyVisited: [],
    fairyRound: 0,
    nightRound: 0,
    players: Object.fromEntries(
      room.players.map((p) => [
        p.uid,
        {
          alive: true,
          used: false,
          armor: ["merlin", "percival", "morgana"].includes(room.roles[p.uid]),
          availableRound: 1,
          faction: null,
          b: false,
        },
      ]),
    ),
  };
}
// Upgrade persisted games once. Unsettled old submissions cannot safely be
// reinterpreted as preselected passive guns; restore that cycle for resubmission.
function migrate(room) {
  const k = room.knights;
  if (!k || k.rulesVersion === 2) return false;
  if (
    ["skillPrepare", "skillTurn", "hunterTurn", "paladinTurn"].includes(
      room.phase,
    )
  ) {
    cancel(room);
    room.history.push({
      kind: "toolCanceled",
      text: "技能规则已更新，本轮旧提交已作废，请重新发起技能。",
    });
    room.activity = null;
    room.team = [];
    resetStage(room, "tools");
  }
  k.deck = k.deck.map((role) => (role === "redGuard" ? "gargoyle" : role));
  for (const [uid, role] of Object.entries(room.roles)) {
    if (role !== "redGuard") continue;
    room.roles[uid] = "gargoyle";
    const p = k.players[uid];
    p.used = false;
    p.identityRevision =
      (p.identityRevision ?? (p.availableRound > 1 ? 1 : 0)) + 1;
    if (p.alive) drawVision(room, uid);
  }
  k.rulesVersion = 2;
  return true;
}
function resetStage(room, phase) {
  room.phase = phase;
  room.stage = randomUUID();
  room.submissions = {};
}
function side(room, uid, allRoles) {
  return room.knights.players[uid].faction || allRoles[room.roles[uid]][1];
}
function living(room) {
  return room.players.filter((p) => room.knights.players[p.uid].alive);
}
function eligible(room, uid) {
  const p = room.knights.players[uid];
  return p.alive && !p.used && p.availableRound <= room.knights.round;
}
const killers = [
  ...swords,
  "blueAwakened",
  "redAwakened",
  "blueKnight",
  "redKnight",
  ...hunters,
];
function gargoyleHistory(state) {
  if (state.gargoyleHistory) return state.gargoyleHistory;
  if (!state.gargoyleInfo) return [];
  // Old saves kept only the latest result; its original inspection count is unknown.
  return [{ ...state.gargoyleInfo, number: state.gargoyleInfo.initial ? 1 : null }];
}
function inspect(room, uid, target, initial = false) {
  const state = room.knights.players[uid];
  const history = gargoyleHistory(state);
  const result = {
    number: history.filter((entry) => entry.number !== null).length + 1,
    seat: target.seat,
    canKill: killers.includes(room.roles[target.uid]),
    round: room.knights.round,
    initial,
  };
  state.gargoyleHistory = [...history, result];
  state.gargoyleInfo = result;
}
function drawVision(room, uid) {
  const targets = living(room);
  if (targets.length)
    inspect(room, uid, targets[randomInt(targets.length)], true);
}
// Private, caller-only status; never include this in public room state.
function skillStatus(room, uid) {
  const k = room.knights,
    p = k.players[uid],
    role = room.roles[uid];
  if (["ended", "terminated"].includes(room.phase))
    return { title: "本局已结束", detail: "" };
  if (room.phase === "hunterTurn" && k.hunters[0] === uid)
    return {
      title: "可使用出局技能",
      detail: "可开枪或跳过。",
    };
  if (!p.alive)
    return {
      title: "已出局",
      detail: "仍需参与技能确认。",
    };
  if (role === "prophet")
    return {
      title: "被动视野",
      detail: "",
    };
  if (!skillRoles.includes(role))
    return {
      title: "无主动技能",
      detail: "",
    };
  if (p.used)
    return {
      title: "技能已用完",
      detail: "",
    };
  if (role === "paladin")
    return {
      title: "被动反伤",
      detail: "",
    };
  if (p.availableRound > k.round)
    return {
      title: "新技能尚未启用",
      detail: "下次技能环节可用。",
    };
  return {
    title: "技能可用",
    detail: "",
  };
}
function action(room, uid) {
  const k = room.knights,
    p = k.players[uid],
    role = room.roles[uid];
  const targets = living(room).map((p) => ({ seat: p.seat, name: p.name }));
  const ownSeat = room.players.find((p) => p.uid === uid).seat;
  const attackTargets = targets.filter((t) => t.seat !== ownSeat);
  const pass = {
    value: "pass",
    label: role === "paladin" ? "确认" : "不使用技能 / 确认",
  };
  let options = [pass];
  if (room.phase === "skillPrepare") {
    if (eligible(room, uid)) {
      if ([...guards, "witch"].includes(role))
        options.push(
          ...targets.map((t) => ({
            value: `target:${t.seat}`,
            label: `${role === "witch" ? "指定替死者" : "秘密守护"} ${t.seat}号`,
          })),
        );
      if (role === "magician")
        for (let i = 0; i < targets.length; i++)
          for (let j = i + 1; j < targets.length; j++)
            options.push({
              value: `swap:${targets[i].seat}:${targets[j].seat}`,
              label: `秘密换号 ${targets[i].seat} ↔ ${targets[j].seat}`,
            });
    }
    if (
      eligible(room, uid) &&
      (swords.includes(role) ||
        ["blueAwakened", "redAwakened", "blueKnight", "redKnight"].includes(
          role,
        ))
    )
      options.push(
        ...attackTargets.map((t) => ({
          value: `target:${t.seat}`,
          label: `对 ${t.seat}号${["blueKnight", "redKnight"].includes(role) ? "决斗" : "开刀"}`,
        })),
      );
    if (eligible(room, uid) && hunters.includes(role)) {
      const seat = room.players.find((p) => p.uid === uid).seat;
      const size = room.players.length;
      const neighbors = [((seat + size - 2) % size) + 1, (seat % size) + 1];
      options.push(
        ...targets
          .filter((t) => neighbors.includes(t.seat))
          .map((t) => ({
            value: `detonate:${t.seat}`,
            label: `主动自爆并向 ${t.seat}号开枪`,
          })),
        ...targets
          .filter((t) => t.seat !== seat)
          .map((t) => ({
            value: `passive:${t.seat}`,
            label: `被动开枪：出局时向 ${t.seat}号开枪`,
          })),
      );
    }
    if (eligible(room, uid) && role === "gargoyle")
      options.push(
        ...targets.map((t) => ({
          value: `inspect:${t.seat}`,
          label: `查验 ${t.seat}号是否拥有主动击杀能力`,
        })),
      );
    return {
      kind: "choice",
      label: "同时秘密提交技能；不使用技能请选择确认",
      choices: options.map((o) => o.value),
      options,
      ...(eligible(room, uid) && hunters.includes(role)
        ? { hunterModes: true }
        : {}),
    };
  }
  if (["skillTurn", "hunterTurn"].includes(room.phase)) {
    const actor =
      room.phase === "hunterTurn" ? k.hunters[0] : k.order[k.cursor];
    if (uid === actor && (room.phase === "hunterTurn" || eligible(room, uid))) {
      if (
        room.phase === "hunterTurn" ||
        swords.includes(role) ||
        ["blueAwakened", "redAwakened", "blueKnight", "redKnight"].includes(
          role,
        )
      )
        options.push(
          ...attackTargets.map((t) => ({
            value: `target:${t.seat}`,
            label: `对 ${t.seat}号 ${room.phase === "hunterTurn" ? "开枪" : "使用刀 / 决斗"}`,
          })),
        );
    }
    return {
      kind: "choice",
      label:
        room.phase === "hunterTurn"
          ? "出局技能确认"
          : `轮到 ${room.players.find((p) => p.uid === actor).seat}号使用技能；其他玩家确认`,
      choices: options.map((o) => o.value),
      options,
    };
  }
  return null;
}
function begin(room, kind, check) {
  const k = room.knights;
  if (kind === "skills") {
    check(k.skillRound < k.round, "本轮技能已经执行");
    k.snapshot = {
      players: structuredClone(k.players),
      roles: { ...room.roles },
      deaths: structuredClone(k.deaths),
      deck: [...k.deck],
    };
    k.events = [];
    k.cycleEliminated = [];
    k.cycleRestored = [];
    k.guards = {};
    k.witches = {};
    k.swap = null;
    k.hunters = [];
    k.reflected = [];
    k.forcedPaladins = [];
    // Seat order only breaks ties for protection and card draws.
    // Committed skills use the initial snapshot, so mutual attacks both resolve.
    k.order = room.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.uid);
    k.cursor = 0;
    resetStage(room, "skillPrepare");
  }
}
function cancel(room) {
  const k = room.knights;
  if (!k?.snapshot) return;
  Object.assign(k, {
    players: k.snapshot.players,
    deaths: k.snapshot.deaths,
    deck: k.snapshot.deck,
  });
  room.roles = k.snapshot.roles;
  delete k.snapshot;
}
function settle(room, check, allRoles) {
  const k = room.knights;
  // Continue rooms whose skill cycle began before this version.
  k.cycleEliminated ||= room.players
    .filter((p) => k.snapshot?.players[p.uid].alive && !k.players[p.uid].alive)
    .map((p) => p.uid);
  k.cycleRestored ||= [];
  const val = (uid) => room.submissions[uid];
  const seatUid = (n) => room.players.find((p) => p.seat === n)?.uid;
  const targetUid = (value, resolving = false) => {
    let seat = Number(value.split(":")[1]);
    if (k.swap?.seats.includes(seat)) {
      seat = k.swap.seats.find((s) => s !== seat);
      if (resolving) {
        k.swap.triggered = true;
        k.players[k.swap.uid].used = true;
      }
    }
    return seatUid(seat);
  };
  const kill = (
    uid,
    substitute = false,
    visited = new Set(),
    selfDestruct = false,
    attacker = null,
  ) => {
    if (!uid || !k.players[uid].alive || visited.has(uid)) return;
    visited.add(uid);
    // A mapped protection/substitute target can be reached indirectly, too.
    if (
      !selfDestruct &&
      k.swap?.seats.includes(room.players.find((p) => p.uid === uid).seat)
    )
      k.swap.triggered = true;
    const paladinState = k.snapshot?.players[uid];
    if (!selfDestruct && room.roles[uid] === "paladin") {
      if (substitute) {
        // Witch substitution must eliminate the paladin, but only after all
        // committed attacks and passive guns have had their reflection resolved.
        if (!k.forcedPaladins.includes(uid)) {
          k.forcedPaladins.push(uid);
          // Reserve the substitution's position in the B-card draw order.
          k.deaths = k.deaths.filter((d) => d.uid !== uid);
          k.deaths.push({ uid, substitute: true, round: k.round });
        }
        return;
      }
      if (
        paladinState?.alive &&
        !paladinState.used &&
        attacker &&
        attacker !== uid &&
        room.roles[attacker] !== "witch"
      ) {
        if (!k.reflected.includes(uid)) k.reflected.push(uid);
        kill(attacker, false, new Set(), true);
        k.events.push(
          `${room.players.find((p) => p.uid === uid).seat}号反伤，${room.players.find((p) => p.uid === attacker).seat}号出局`,
        );
        return;
      }
    }
    const guard = Object.keys(k.guards).find(
      (g) => !k.players[g].used && k.guards[g] === uid,
    );
    if (guard && !selfDestruct) {
      k.players[guard].used = true;
      return;
    }
    if (
      !substitute &&
      !selfDestruct &&
      room.roles[uid] === "witch" &&
      k.witches[uid] &&
      !k.players[uid].used
    ) {
      k.players[uid].used = true;
      if (k.witches[uid] !== uid) {
        kill(k.witches[uid], true, visited);
        return;
      }
      substitute = true;
    }
    k.players[uid].alive = false;
    if (!k.cycleEliminated.includes(uid)) k.cycleEliminated.push(uid);
    if (!k.forcedPaladins.includes(uid)) {
      k.deaths = k.deaths.filter((d) => d.uid !== uid);
      k.deaths.push({ uid, substitute, round: k.round });
    }
    if (
      !substitute &&
      hunters.includes(room.roles[uid]) &&
      !k.players[uid].used &&
      k.players[uid].availableRound <= k.round &&
      k.planned?.[uid]?.startsWith("passive:")
    )
      k.hunters.push(uid);
  };
  if (room.phase === "skillPrepare") {
    const magician = room.players.find(
      (p) => room.roles[p.uid] === "magician" && val(p.uid).startsWith("swap:"),
    );
    if (magician)
      k.swap = {
        uid: magician.uid,
        seats: val(magician.uid).split(":").slice(1).map(Number),
        triggered: false,
      };
    for (const p of room.players)
      if (val(p.uid).startsWith("target:")) {
        const target = targetUid(val(p.uid));
        if (guards.includes(room.roles[p.uid])) k.guards[p.uid] = target;
        if (room.roles[p.uid] === "witch") k.witches[p.uid] = target;
      }
    for (const p of room.players) {
      const value = val(p.uid),
        role = room.roles[p.uid];
      if (value.startsWith("swap:"))
        k.events.push(
          `${p.seat}号换号：${value.split(":").slice(1).join("、")}号`,
        );
      else if (
        value.startsWith("target:") &&
        [...guards, "witch"].includes(role)
      )
        k.events.push(
          `${p.seat}号${role === "witch" ? "指定替死" : "设置守护"}，目标${value.split(":")[1]}号`,
        );
    }
    k.planned = { ...room.submissions };
    // Inspect the submitted seats directly, before simultaneous attacks/draws.
    for (const p of room.players)
      if (room.roles[p.uid] === "gargoyle" && val(p.uid).startsWith("inspect:"))
        inspect(
          room,
          p.uid,
          room.players.find((t) => t.seat === Number(val(p.uid).split(":")[1])),
        );
    // Reserve the shared hunter skill before any simultaneous deaths can queue
    // its passive shot. A committed active shot survives a witch substitution.
    for (const p of room.players)
      if (
        hunters.includes(room.roles[p.uid]) &&
        val(p.uid).startsWith("detonate:")
      )
        k.players[p.uid].used = true;
    room.phase = "skillTurn";
    room.submissions = k.planned;
    return settle(room, check, allRoles);
  }
  const hunter = room.phase === "hunterTurn";
  const actor = hunter ? k.hunters.shift() : k.order[k.cursor++];
  const role = room.roles[actor],
    value = hunter
      ? k.planned[actor].replace("passive:", "target:")
      : (
            k.snapshot?.players[actor]
              ? k.snapshot.players[actor].alive &&
                !k.snapshot.players[actor].used &&
                k.snapshot.players[actor].availableRound <= k.round
              : eligible(room, actor)
          )
        ? k.planned[actor]
        : "pass";
  if (hunters.includes(role) && value.startsWith("detonate:")) {
    k.players[actor].used = true;
    kill(actor, false, new Set(), true);
    const target = targetUid(value, true);
    kill(target, false, new Set(), false, actor);
    k.events.push(
      `${room.players.find((p) => p.uid === actor).seat}号主动自爆并开枪，目标${value.split(":")[1]}号`,
    );
  } else if (
    value.startsWith("target:") &&
    (hunter ||
      swords.includes(role) ||
      ["blueAwakened", "redAwakened", "blueKnight", "redKnight"].includes(role))
  ) {
    const aliveBefore = new Set(living(room).map((p) => p.uid));
    const target = targetUid(value, true),
      targetRole = room.roles[target];
    k.players[actor].used = true;
    if (hunter || ["blueAwakened", "redAwakened"].includes(role))
      kill(target, false, new Set(), false, actor);
    else if (["blueKnight", "redKnight"].includes(role))
      kill(
        side(room, actor, allRoles) ===
          (targetRole === "mordred" ? "good" : side(room, target, allRoles))
          ? actor
          : target,
        false,
        new Set(),
        false,
        actor,
      );
    else if (swords.includes(role)) {
      if (targetRole === "assassin") {
        k.players[target].used = true;
      } else if (swords.includes(targetRole) || k.players[target].b)
        kill(target, false, new Set(), false, actor);
    }
    const dead = room.players
      .filter((p) => aliveBefore.has(p.uid) && !k.players[p.uid].alive)
      .map((p) => p.seat);
    k.events.push(
      `${room.players.find((p) => p.uid === actor).seat}号${hunter ? "开枪" : "使用技能"}，目标${value.split(":")[1]}号：${dead.length ? dead.join("、") + "号出局" : "无人出局"}`,
    );
  }
  if (k.swap?.triggered) k.players[k.swap.uid].used = true;
  if (k.cursor < k.order.length) {
    room.phase = "skillTurn";
    room.submissions = k.planned;
    return settle(room, check, allRoles);
  }
  k.hunters = k.hunters.filter(
    (uid) => !k.players[uid].alive && !k.players[uid].used,
  );
  if (k.hunters.length) {
    room.phase = "hunterTurn";
    return settle(room, check, allRoles);
  }
  for (const uid of k.reflected) k.players[uid].used = true;
  for (const uid of k.forcedPaladins) kill(uid, true, new Set(), true);
  const drawn = [];
  // Draw once, in death order, only for players who remain dead.
  for (const death of k.deaths) {
    const p = k.players[death.uid];
    if (p.alive || !k.deck.length) continue;
    const card = k.deck.shift();
    drawn.push(death.uid);
    if (p.armor) {
      p.armor = false;
      p.used = true;
    } else {
      room.roles[death.uid] = card;
      p.used = false;
      p.faction = null;
      p.b = true;
      delete p.nightInfo;
      delete p.gargoyleInfo;
      delete p.gargoyleHistory;
    }
    p.identityRevision =
      (p.identityRevision ?? (p.availableRound > 1 ? 1 : 0)) + 1;
    p.alive = true;
    p.availableRound = k.round + 1;
  }
  for (const uid of drawn)
    if (room.roles[uid] === "gargoyle") drawVision(room, uid);
  k.deaths = k.deaths.filter((d) => !k.players[d.uid].alive);
  const seats = (ids) =>
    [...new Set(ids)]
      .map((uid) => room.players.find((p) => p.uid === uid).seat)
      .sort((a, b) => a - b);
  k.summary = {
    eliminated: seats(k.cycleEliminated),
    redrawn: seats(drawn),
    restored: seats(
      k.cycleRestored.filter(
        (uid) => k.players[uid].alive && !drawn.includes(uid),
      ),
    ),
    out: seats(
      room.players.filter((p) => !k.players[p.uid].alive).map((p) => p.uid),
    ),
  };
  k.skillRound = k.round;
  delete k.snapshot;
  delete k.planned;
  return true;
}
function updateNight(room, allRoles) {
  const k = room.knights;
  if (k.skillRound !== k.round) return;
  for (const p of living(room)) {
    if (room.roles[p.uid] === "prophet") {
      const seats = living(room)
        .filter(
          (t) => k.players[t.uid].b && side(room, t.uid, allRoles) === "evil",
        )
        .map((t) => t.seat);
      k.players[p.uid].nightInfo =
        `第${k.round}轮B牌坏人：${seats.length ? seats.join("、") + "号" : "无"}`;
    }
  }
  k.nightRound = k.round;
}
module.exports = {
  gargoyleHistory,
  migrate,
  skillStatus,
  updateNight,
  init,
  side,
  living,
  eligible,
  action,
  begin,
  cancel,
  settle,
  resetStage,
  skillRoles,
};
