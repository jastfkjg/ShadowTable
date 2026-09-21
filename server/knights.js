"use strict";
const { randomUUID } = require("node:crypto");
const { roles } = require("./variants");
const swords = [
  "gareth",
  "gaheris",
  "blueLancelot",
  "redLancelot",
  "redSwordsman",
  "assassin",
];
const guards = ["blueGuard", "redGuard"];
const hunters = ["blueHunter", "redHunter"];
const bRoles = Object.keys(roles).slice(
  Object.keys(roles).indexOf("blueAwakened"),
);
const skillRoles = [...swords, ...bRoles.filter((r) => r !== "prophet")];
function init(room, shuffle) {
  const blue = shuffle(bRoles.filter((r) => roles[r][1] === "good"));
  const red = shuffle(bRoles.filter((r) => roles[r][1] === "evil"));
  room.knights = {
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
function revivalTargets(room, uid) {
  return room.knights.deaths
    .filter(
      (d) =>
        d.uid !== uid &&
        !d.substitute &&
        d.round === room.knights.round &&
        !room.knights.players[d.uid].alive,
    )
    .map((d) => room.players.find((p) => p.uid === d.uid));
}
// Private, caller-only status; never include this in public room state.
function skillStatus(room, uid) {
  const k = room.knights,
    p = k.players[uid],
    role = room.roles[uid];
  if (["ended", "terminated"].includes(room.phase))
    return { title: "本局已结束", detail: "本局不再使用技能。" };
  if (room.phase === "hunterTurn" && k.hunters[0] === uid)
    return {
      title: "可使用出局技能",
      detail: "本次可选择开枪目标，或选择不使用技能。",
    };
  if (room.phase === "paladinTurn" && k.paladin === uid)
    return {
      title: "可选择复活",
      detail:
        "选择一名本轮出局玩家恢复原身份，或暂不复活；不能复活女巫替死者。",
    };
  if (!p.alive)
    return {
      title: "已出局",
      detail: "当前不能主动使用技能；仍需参与统一确认。",
    };
  if (role === "prophet")
    return {
      title: "被动视野",
      detail: "技能全部结算后自动更新，无需主动释放。",
    };
  if (!skillRoles.includes(role))
    return {
      title: "无主动技能",
      detail: "本身份没有技能阶段的主动动作，按提示确认即可。",
    };
  if (p.used)
    return {
      title: "技能已用完",
      detail: "当前身份的技能次数已消耗，按提示确认即可。",
    };
  if (p.availableRound > k.round)
    return {
      title: "新技能尚未启用",
      detail: "下一技能周期可用，本次按提示确认即可。",
    };
  if (hunters.includes(role))
    return {
      title: "技能可用",
      detail:
        "可主动自爆并开枪，或保留被动出局开枪；两者共用一次机会。替女巫出局不触发被动开枪。",
    };
  if (role === "paladin")
    return {
      title: "等待出局触发",
      detail: "有人出局后优先获得选人复活机会；不能复活自己或女巫替死者。",
    };
  return {
    title: "技能可用",
    detail: "可在技能提交阶段选择使用；守护、替死、换号按各自触发规则消耗。",
  };
}
function action(room, uid) {
  const k = room.knights,
    p = k.players[uid],
    role = room.roles[uid];
  const targets = living(room).map((p) => ({ seat: p.seat, name: p.name }));
  const pass = { value: "pass", label: "不使用技能 / 确认" };
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
        ...targets.map((t) => ({
          value: `target:${t.seat}`,
          label: `对 ${t.seat}号${["blueKnight", "redKnight"].includes(role) ? "决斗" : "开刀"}`,
        })),
      );
    if (eligible(room, uid) && hunters.includes(role))
      options.push(
        ...targets
          .filter(
            (t) => t.seat !== room.players.find((p) => p.uid === uid).seat,
          )
          .map((t) => ({
            value: `detonate:${t.seat}`,
            label: `主动自爆出局，并向 ${t.seat}号开枪（消耗唯一技能）`,
          })),
      );
    return {
      kind: "choice",
      label: "同时秘密提交技能；不使用技能请选择确认",
      choices: options.map((o) => o.value),
      options,
    };
  }
  if (room.phase === "paladinTurn") {
    if (uid === k.paladin && eligible(room, uid))
      options.push(
        ...revivalTargets(room, uid).map((t) => ({
          value: `revive:${t.seat}`,
          label: `复活 ${t.seat}号，保留原身份与技能使用状态`,
        })),
      );
    return {
      kind: "choice",
      label: "追加技能确认",
      choices: options.map((o) => o.value),
      options,
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
          ...targets.map((t) => ({
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
    k.deathRevision = 0;
    k.revivalOffered = {};
    delete k.paladin;
    // Seat order only breaks ties for protection, revival and card draws.
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
  ) => {
    if (!uid || !k.players[uid].alive || visited.has(uid)) return;
    visited.add(uid);
    // A mapped protection/substitute target can be reached indirectly, too.
    if (
      !selfDestruct &&
      k.swap?.seats.includes(room.players.find((p) => p.uid === uid).seat)
    )
      k.swap.triggered = true;
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
    k.deaths = k.deaths.filter((d) => d.uid !== uid);
    k.deaths.push({ uid, substitute, round: k.round });
    k.deathRevision = (k.deathRevision || 0) + 1;
    if (
      !substitute &&
      hunters.includes(room.roles[uid]) &&
      !k.players[uid].used &&
      k.players[uid].availableRound <= k.round
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
  const paladin = room.phase === "paladinTurn";
  const actor = paladin
    ? k.paladin
    : hunter
      ? k.hunters.shift()
      : k.order[k.cursor++];
  const role = room.roles[actor],
    value =
      hunter || paladin
        ? val(actor)
        : (
              k.snapshot?.players[actor]
                ? k.snapshot.players[actor].alive &&
                  !k.snapshot.players[actor].used &&
                  k.snapshot.players[actor].availableRound <= k.round
                : eligible(room, actor)
            )
          ? k.planned[actor]
          : "pass";
  if (paladin && value.startsWith("revive:") && eligible(room, actor)) {
    // Revival choices refer to actual eliminated players, not attack numbers.
    const target = revivalTargets(room, actor).find(
      (p) => p.seat === Number(value.split(":")[1]),
    );
    if (target) {
      k.players[actor].used = true;
      k.players[target.uid].alive = true;
      k.cycleRestored.push(target.uid);
      k.events.push(
        `${room.players.find((p) => p.uid === actor).seat}号使用复活，${target.seat}号恢复原身份（不公开角色）`,
      );
      k.hunters = k.hunters.filter((uid) => uid !== target.uid);
    }
  } else if (hunters.includes(role) && value.startsWith("detonate:")) {
    k.players[actor].used = true;
    kill(actor, false, new Set(), true);
    const target = targetUid(value, true);
    kill(target);
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
    if (hunter || ["blueAwakened", "redAwakened"].includes(role)) kill(target);
    else if (["blueKnight", "redKnight"].includes(role))
      kill(
        side(room, actor, allRoles) ===
          (targetRole === "mordred" ? "good" : side(room, target, allRoles))
          ? actor
          : target,
      );
    else if (swords.includes(role)) {
      if (targetRole === "assassin") {
        k.players[target].used = true;
      } else if (swords.includes(targetRole) || k.players[target].b)
        kill(target);
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
  // Offer revival once per new death batch, always before the next hunter shot.
  // Passing retains the skill but cannot cause an endless confirmation loop.
  k.revivalOffered ||= {};
  const revision = k.deathRevision || k.deaths.length;
  const reviver = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .find(
      (p) =>
        room.roles[p.uid] === "paladin" &&
        eligible(room, p.uid) &&
        k.revivalOffered[p.uid] !== revision &&
        revivalTargets(room, p.uid).length,
    );
  if (reviver) {
    k.paladin = reviver.uid;
    k.revivalOffered[reviver.uid] = revision;
    resetStage(room, "paladinTurn");
    return false;
  }
  delete k.paladin;
  k.hunters = k.hunters.filter(
    (uid) => !k.players[uid].alive && !k.players[uid].used,
  );
  if (k.hunters.length) {
    resetStage(room, "hunterTurn");
    return false;
  }
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
    }
    p.identityRevision =
      (p.identityRevision ?? (p.availableRound > 1 ? 1 : 0)) + 1;
    p.alive = true;
    p.availableRound = k.round + 1;
  }
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
