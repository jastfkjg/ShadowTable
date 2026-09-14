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
    if (eligible(room, uid) && role === "paladin")
      options.push({
        value: "revive",
        label: "轮到我时复活上一位出局者（若合法）",
      });
    return {
      kind: "choice",
      label: "同时秘密提交技能；不使用技能请选择确认",
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
      if (role === "paladin") {
        const last = [...k.deaths]
          .reverse()
          .find((d) => !k.players[d.uid].alive);
        if (
          last &&
          last.uid !== uid &&
          (!last.substitute || last.round < k.round)
        )
          options.push({
            value: "revive",
            label: `复活 ${room.players.find((p) => p.uid === last.uid).seat}号`,
          });
      }
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
  if (room.phase === "fairy") {
    if (uid !== room.players.find((p) => p.seat === k.fairy)?.uid) return null;
    options = targets
      .filter((t) => t.seat !== k.fairy && !k.fairyVisited.includes(t.seat))
      .map((t) => ({
        value: `target:${t.seat}`,
        label: `查验 ${t.seat}号并传递仙女`,
      }));
    return {
      kind: "choice",
      label: "选择查验目标并传递仙女",
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
    k.order = room.players
      .slice()
      .sort(
        (a, b) =>
          ((a.seat - room.leader + 12) % 12) -
          ((b.seat - room.leader + 12) % 12),
      )
      .map((p) => p.uid);
    k.cursor = 0;
    resetStage(room, "skillPrepare");
  } else if (kind === "fairy") {
    check(
      living(room).some(
        (p) => p.seat !== k.fairy && !k.fairyVisited.includes(p.seat),
      ),
      "没有可查验的仙女目标",
    );
    resetStage(room, "fairy");
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
  const targetUid = (value) => {
    let seat = Number(value.split(":")[1]);
    if (k.swap?.seats.includes(seat)) {
      seat = k.swap.seats.find((s) => s !== seat);
    }
    return seatUid(seat);
  };
  const kill = (uid, substitute = false, visited = new Set()) => {
    if (!uid || !k.players[uid].alive || visited.has(uid)) return;
    visited.add(uid);
    if (k.swap?.seats.includes(room.players.find((p) => p.uid === uid).seat))
      k.swap.triggered = true;
    const guard = Object.keys(k.guards).find(
      (g) => !k.players[g].used && k.guards[g] === uid,
    );
    if (guard) {
      k.players[guard].used = true;
      return;
    }
    if (
      !substitute &&
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
    if (
      !substitute &&
      hunters.includes(room.roles[uid]) &&
      !k.players[uid].used &&
      k.players[uid].availableRound <= k.round
    )
      k.hunters.push(uid);
    if (
      k.swap &&
      k.swap.seats.includes(room.players.find((p) => p.uid === uid).seat) &&
      !k.swap.seats.includes(
        room.players.find((p) => p.uid === k.swap.uid).seat,
      )
    )
      kill(k.swap.uid, false, visited);
  };
  if (room.phase === "fairy") {
    const holder = seatUid(k.fairy),
      target = seatUid(Number(val(holder).split(":")[1]));
    k.players[holder].fairyRevision =
      (k.players[holder].fairyRevision ||
        (k.players[holder].fairyInfo ? 1 : 0)) + 1;
    k.players[holder].fairyInfo =
      `${room.players.find((p) => p.uid === target).seat}号查验结果：${side(room, target, allRoles) === "good" ? "好人" : "坏人"}（第${k.round}轮）`;
    k.fairyVisited.push(k.fairy);
    k.fairy = room.players.find((p) => p.uid === target).seat;
    k.fairyRound = k.round;
    return true;
  }
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
    room.phase = "skillTurn";
    room.submissions = k.planned;
    return settle(room, check, allRoles);
  }
  const hunter = room.phase === "hunterTurn";
  const actor = hunter ? k.hunters.shift() : k.order[k.cursor++];
  const role = room.roles[actor],
    value = hunter
      ? val(actor)
      : eligible(room, actor)
        ? k.planned[actor]
        : "pass";
  if (value === "revive") {
    const last = [...k.deaths].reverse().find((d) => !k.players[d.uid].alive);
    if (
      last &&
      last.uid !== actor &&
      (!last.substitute || last.round < k.round)
    ) {
      k.players[actor].used = true;
      k.players[last.uid].alive = true;
      k.cycleRestored.push(last.uid);
      k.events.push(
        `${room.players.find((p) => p.uid === actor).seat}号使用复活，${room.players.find((p) => p.uid === last.uid).seat}号恢复原身份（不公开角色）`,
      );
      k.hunters = k.hunters.filter((uid) => uid !== last.uid);
    }
  } else if (
    value.startsWith("target:") &&
    (hunter ||
      swords.includes(role) ||
      ["blueAwakened", "redAwakened", "blueKnight", "redKnight"].includes(role))
  ) {
    const aliveBefore = new Set(living(room).map((p) => p.uid));
    const target = targetUid(value),
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
        if (
          !k.players[target].used &&
          k.swap?.seats.includes(
            room.players.find((p) => p.uid === target).seat,
          )
        )
          k.swap.triggered = true;
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
  if (k.hunters.length) {
    resetStage(room, "hunterTurn");
    return false;
  }
  if (k.cursor < k.order.length) {
    room.phase = "skillTurn";
    room.submissions = k.planned;
    return settle(room, check, allRoles);
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
