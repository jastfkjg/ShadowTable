"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const COUNTS = {
  6: [4, 2],
  7: [4, 3],
  8: [5, 3],
  9: [6, 3],
  10: [6, 4],
  11: [7, 4],
  12: [7, 5],
};
const TEAMS = {
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
  11: [3, 4, 5, 6, 6],
  12: [3, 4, 5, 6, 6],
};
const BOARDS = [
  {
    id: "classic",
    name: "阿瓦隆 · 经典基础",
    available: true,
    counts: [6, 7, 8, 9],
    description: "梅林、刺客与普通阵营角色；原版基础规则",
  },
  {
    id: "classic-court",
    name: "阿瓦隆 · 经典基础",
    available: true,
    counts: [10, 12],
    description: "梅林、派西、莫甘娜、莫德雷德、刺客、奥伯伦；12人双奥伯伦",
  },
  {
    id: "classic-11",
    name: "阿瓦隆 · 11人逆仆",
    available: true,
    counts: [11],
    description: "逆仆只投成功；先指认逆仆，再刺梅林；匪队在线下决策",
  },
  {
    id: "shadow-blade",
    name: "阿瓦隆 · 影中执刃",
    available: false,
    counts: [12],
    description: "待确认：初始互认、内奸挡刀及起刀结算",
  },
  {
    id: "shadow-assist",
    name: "影中执刃 · 线下结算辅助",
    available: true,
    mode: "assisted",
    counts: [12],
    description:
      "身份与组队/任务线上；初始互认、起刀及内奸胜负在线下，不自动判最终胜方",
  },
  {
    id: "chaos",
    name: "阿瓦隆 · 混沌契约",
    available: false,
    counts: [12],
    description: "待确认：初始视野、魔法票、盗贼共同行动及排名",
  },
  {
    id: "knights",
    name: "阿瓦隆 · 十二骑士",
    available: false,
    counts: [12],
    description: "待确认：换号、守护、连锁死亡与复活",
  },
];
const ROLES = {
  merlin: ["梅林", "good"],
  servant: ["亚瑟的忠臣", "good"],
  assassin: ["刺客", "evil"],
  minion: ["莫德雷德的爪牙", "evil"],
  percival: ["派西维尔", "good"],
  morgana: ["莫甘娜", "evil"],
  mordred: ["莫德雷德", "evil"],
  oberon: ["奥伯伦", "evil"],
  reverse: ["逆仆", "good"],
  blueTraitor: ["蓝内奸", "good"],
  redTraitor: ["红内奸", "evil"],
};
const PHASES = {
  lobby: "入座与准备",
  identity: "私密身份确认",
  proposal: "队长组队",
  teamVote: "组队表决",
  teamResult: "组队结果",
  quest: "秘密任务",
  questResult: "任务结果",
  assassination: "最终行动",
  reverseStrike: "最终行动 · 第一段",
  offlineFinal: "线下特殊结算",
  ended: "对局结束",
  terminated: "对局已终止",
};
class RuleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function requireRule(ok, message, status) {
  if (!ok) throw new RuleError(message, status);
}
function shuffle(xs) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
function member(room, uid) {
  const p = room.players.find((p) => p.uid === uid);
  requireRule(p, "你不在该房间", 403);
  return p;
}
function board(id, capacity) {
  const b = BOARDS.find((b) => b.id === id);
  requireRule(b?.available, "该板子规则尚未确认，暂不可用");
  requireRule(b.counts.includes(capacity), "人数不在板子支持范围");
  return b;
}
function nickname(value) {
  requireRule(
    typeof value === "string" &&
      value.trim().length >= 1 &&
      value.trim().length <= 16,
    "昵称需要1–16个字符",
  );
  return value.trim();
}
function newRoom(code, uid, name, boardId = "classic", capacity = 6) {
  board(boardId, capacity);
  return {
    code,
    host: uid,
    board: boardId,
    capacity,
    phase: "lobby",
    stage: randomUUID(),
    game: 0,
    players: [{ uid, name: nickname(name), seat: 1, ready: false }],
    history: [],
  };
}
function enter(room, uid, name) {
  if (room.players.some((p) => p.uid === uid)) return;
  requireRule(room.phase === "lobby", "游戏已开始，无法加入");
  requireRule(room.players.length < room.capacity, "房间已满");
  requireRule(
    uid === room.host ||
      room.players.some((p) => p.uid === room.host) ||
      room.players.length < room.capacity - 1,
    "请为未入座的房主保留一个座位",
  );
  const seat = Array.from({ length: room.capacity }, (_, i) => i + 1).find(
    (s) => !room.players.some((p) => p.seat === s),
  );
  room.players.push({ uid, name: nickname(name), seat, ready: false });
}
function stage(room, phase) {
  room.phase = phase;
  room.stage = randomUUID();
  room.submissions = {};
}
function end(room, winner, reason) {
  room.result = { winner, reason };
  stage(room, "ended");
}
function start(room) {
  requireRule(
    room.players.length === room.capacity && room.players.every((p) => p.ready),
    "需要所有座位入座且全员准备",
  );
  board(room.board, room.capacity);
  room.players.sort((a, b) => a.seat - b.seat);
  const [good, evil] = COUNTS[room.capacity];
  const courtRoles = [
    "merlin",
    "percival",
    ...Array(4).fill("servant"),
    "assassin",
    "morgana",
    "mordred",
    "oberon",
  ];
  const roles = shuffle(
    room.board === "classic-11"
      ? [...courtRoles, "reverse"]
      : room.board === "shadow-assist"
        ? [
            "merlin",
            "percival",
            ...Array(4).fill("servant"),
            "blueTraitor",
            "mordred",
            "morgana",
            "assassin",
            "oberon",
            "redTraitor",
          ]
        : room.board === "classic-court"
          ? [
              "merlin",
              "percival",
              ...Array(good - 2).fill("servant"),
              "assassin",
              "morgana",
              "mordred",
              ...Array(evil - 3).fill("oberon"),
            ]
          : [
              "merlin",
              ...Array(good - 1).fill("servant"),
              "assassin",
              ...Array(evil - 1).fill("minion"),
            ],
  );
  room.roles = Object.fromEntries(
    room.players.map((p, i) => [p.uid, roles[i]]),
  );
  room.game++;
  room.leader = randomInt(1, room.capacity + 1);
  room.round = 1;
  room.rejects = 0;
  room.quests = [];
  room.history = [];
  room.team = [];
  room.result = null;
  room.proposalSubmitted = false;
  room.convertedReverse = null;
  stage(room, "identity");
}
function faction(room, uid) {
  if (uid === room.convertedReverse) return "evil";
  return ROLES[room.roles[uid]][1];
}
function questChoices(room, uid) {
  if (
    room.board === "shadow-assist" &&
    ["oberon", "redTraitor"].includes(room.roles[uid])
  )
    return ["fail"];
  return faction(room, uid) === "good" ? ["success"] : ["success", "fail"];
}
function actionSpec(room, uid) {
  const p = member(room, uid);
  const targets = room.players.map((p) => ({ seat: p.seat, name: p.name }));
  switch (room.phase) {
    case "identity":
      return {
        kind: "confirm",
        label:
          room.board === "shadow-assist"
            ? "我已记住身份并在线下完成初始互认"
            : "我已查看并记住身份",
        choices: ["confirm"],
      };
    case "teamVote":
      return {
        kind: "vote",
        label: "是否同意这支队伍？",
        choices: ["approve", "reject"],
      };
    case "quest":
      return room.team.includes(p.seat)
        ? {
            kind: "quest",
            label: "选择本轮任务牌",
            choices: questChoices(room, uid),
          }
        : {
            kind: "confirm",
            label: "本轮未上车，确认等待结算",
            choices: ["confirm"],
          };
    case "reverseStrike":
    case "assassination":
      return room.roles[uid] === "assassin"
        ? {
            kind: "target",
            label:
              room.phase === "reverseStrike"
                ? "填入匪队线下决定的逆仆目标"
                : "填入匪队线下决定的梅林目标",
            targets: targets.filter((t) => t.seat !== p.seat),
          }
        : { kind: "confirm", label: "确认进入最终结算", choices: ["confirm"] };
    default:
      return null;
  }
}
function privateView(room, uid) {
  member(room, uid);
  requireRule(room.roles && room.phase !== "lobby", "身份尚未分配");
  const role = room.roles[uid],
    name = ROLES[role][0],
    side = faction(room, uid);
  let information = "你没有额外的初始视野";
  const seats = (predicate) =>
    room.players
      .filter((p) => p.uid !== uid && predicate(room.roles[p.uid]))
      .map((p) => p.seat)
      .join("、");
  if (room.board === "shadow-assist")
    information =
      "本模式不提供额外初始视野。请线下按你们的规则完成互认、起刀与内奸胜负；手机只负责身份、组队与任务。";
  else if (role === "reverse")
    information = `刺客位于：${seats((r) => r === "assassin")}号。${room.convertedReverse === uid ? "你已被命中，现随坏人阵营结算。" : "你只能投任务成功；被逆仆刀命中后转入坏人阵营。"}`;
  else if (role === "merlin")
    information = `你看见的举手座位：${seats((r) => (ROLES[r][1] === "evil" && r !== "mordred") || r === "reverse")}${room.board !== "classic" ? "（莫德雷德不在视野中）" : ""}`;
  else if (role === "percival")
    information = `梅林与莫甘娜位于：${seats((r) => ["merlin", "morgana"].includes(r))}号。你无法区分谁是梅林。`;
  else if (role === "oberon")
    information = "你不知道其他坏人是谁，其他坏人也看不见你。";
  else if (side === "evil")
    information = `你的坏人同伴座位：${seats((r) => ROLES[r][1] === "evil" && r !== "oberon")}（不知道具体身份${room.board === "classic-court" ? "；不包含奥伯伦" : ""}）`;
  return {
    game: room.game,
    stage: room.stage,
    role: name,
    faction: side === "good" ? "好人阵营" : "坏人阵营",
    information,
    outcome: room.result?.winner
      ? room.result.winner === side
        ? "本局你获胜"
        : "本局你失败"
      : null,
    action: actionSpec(room, uid),
  };
}
function roomSummary(room, uid) {
  const p = room.players.find((p) => p.uid === uid);
  requireRule(p || room.host === uid, "你不在该房间", 403);
  return {
    code: room.code,
    boardName: BOARDS.find((b) => b.id === room.board).name,
    phaseName: PHASES[room.phase],
    game: room.game,
    seat: p?.seat ?? null,
    isHost: room.host === uid,
  };
}
function publicView(room, uid) {
  const p = member(room, uid);
  // Explicit allowlist only: never spread the authoritative room into a response.
  return {
    code: room.code,
    board: room.board,
    boardName:
      room.board === "classic" && room.capacity === 10
        ? "旧版10人配置（请更换板子）"
        : BOARDS.find((b) => b.id === room.board).name,
    assisted: room.board === "shadow-assist",
    capacity: room.capacity,
    phase: room.phase,
    phaseName: PHASES[room.phase],
    stage: room.stage,
    game: room.game,
    me: {
      seat: p.seat,
      name: p.name,
      isHost: room.host === uid,
      ready: p.ready,
      submitted: Object.hasOwn(room.submissions || {}, uid),
    },
    players: room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      ready: p.ready,
      isHost: p.uid === room.host,
    })),
    leader: room.leader || null,
    round: room.round || null,
    team: room.team || [],
    teamSize: room.round ? TEAMS[room.capacity][room.round - 1] : null,
    rejects: room.rejects || 0,
    quests: room.quests || [],
    history: room.history,
    result: room.result || null,
    proposalSubmitted: !!room.proposalSubmitted,
    needsSubmission: [
      "identity",
      "teamVote",
      "quest",
      "assassination",
      "reverseStrike",
    ].includes(room.phase),
    canAdvance:
      room.host === uid &&
      !["lobby", "ended", "terminated", "offlineFinal"].includes(room.phase),
  };
}
function command(room, uid, input) {
  const p = member(room, uid);
  requireRule(input && typeof input === "object", "请求格式错误");
  requireRule(input.stage === room.stage, "阶段已变化，请刷新后重新操作", 409);
  const { type } = input;
  if (
    [
      "configure",
      "start",
      "advance",
      "terminate",
      "rematch",
      "transfer",
      "offline",
      "closeOffline",
    ].includes(type)
  )
    requireRule(uid === room.host, "只有房主可以管理流程", 403);
  if (type === "leave") {
    requireRule(room.phase === "lobby", "对局中不可离开座位，请联系房主终止");
    room.players = room.players.filter((p) => p.uid !== uid);
    return;
  }
  if (type === "transfer") {
    requireRule(room.phase === "lobby", "仅准备阶段可以转交房主");
    const target = room.players.find((p) => p.seat === input.seat);
    requireRule(target, "目标座位无人");
    room.host = target.uid;
    return;
  }
  if (type === "seat") {
    requireRule(room.phase === "lobby", "对局中不可换座");
    requireRule(
      Number.isInteger(input.seat) &&
        input.seat >= 1 &&
        input.seat <= room.capacity,
      "座位无效",
    );
    requireRule(
      !room.players.some(
        (other) => other.seat === input.seat && other.uid !== uid,
      ),
      "座位已被占用",
      409,
    );
    p.seat = input.seat;
    p.ready = false;
    return;
  }
  if (type === "ready") {
    requireRule(room.phase === "lobby", "当前不能准备");
    requireRule(typeof input.ready === "boolean", "准备状态无效");
    p.ready = input.ready;
    return;
  }
  if (type === "configure") {
    requireRule(room.phase === "lobby", "只能在准备阶段修改板子");
    board(input.board, input.capacity);
    requireRule(
      room.players.every((p) => p.seat <= input.capacity),
      "请先让超出新人数的玩家换座或离开",
    );
    room.board = input.board;
    room.capacity = input.capacity;
    room.players.forEach((p) => (p.ready = false));
    stage(room, "lobby");
    return;
  }
  if (type === "start") {
    requireRule(room.phase === "lobby", "对局已经开始");
    start(room);
    return;
  }
  if (type === "rematch") {
    requireRule(
      ["ended", "terminated"].includes(room.phase),
      "只能在结束后重开",
    );
    for (const key of [
      "roles",
      "submissions",
      "leader",
      "round",
      "quests",
      "team",
      "result",
      "proposalSubmitted",
      "rejects",
      "teamApproved",
      "convertedReverse",
    ])
      delete room[key];
    room.history = [];
    room.players.forEach((p) => (p.ready = false));
    stage(room, "lobby");
    return;
  }
  if (type === "terminate") {
    requireRule(
      !["lobby", "ended", "terminated"].includes(room.phase),
      "没有进行中的对局",
    );
    room.result = { winner: null, reason: "房主终止了对局，本局不判胜负" };
    stage(room, "terminated");
    return;
  }
  if (type === "offline") {
    requireRule(
      room.board === "shadow-assist" &&
        !["lobby", "ended", "terminated", "offlineFinal"].includes(room.phase),
      "当前不能转入线下结算",
    );
    stage(room, "offlineFinal");
    return;
  }
  if (type === "closeOffline") {
    requireRule(
      room.board === "shadow-assist" && room.phase === "offlineFinal",
      "当前不是线下结算阶段",
    );
    end(room, null, "线下特殊结算已完成。小程序未判定最终胜方。");
    return;
  }
  if (type === "propose") {
    requireRule(
      room.phase === "proposal" && p.seat === room.leader,
      "只有当前队长可组队",
      403,
    );
    requireRule(
      Array.isArray(input.team) &&
        input.team.length === TEAMS[room.capacity][room.round - 1] &&
        new Set(input.team).size === input.team.length &&
        input.team.every((s) => room.players.some((p) => p.seat === s)),
      "队伍人数或座位不合法",
    );
    room.team = [...input.team].sort((a, b) => a - b);
    room.proposalSubmitted = true;
    return;
  }
  if (type === "submit") {
    const spec = actionSpec(room, uid);
    requireRule(spec, "当前阶段没有秘密操作");
    requireRule(
      !Object.hasOwn(room.submissions, uid),
      "你已提交，不可修改",
      409,
    );
    requireRule(
      spec.kind === "target"
        ? spec.targets.some((t) => t.seat === input.value)
        : spec.choices.includes(input.value),
      "该操作或目标不合法",
    );
    room.submissions[uid] = input.value;
    return;
  }
  requireRule(type === "advance", "未知操作");
  if (
    [
      "identity",
      "teamVote",
      "quest",
      "assassination",
      "reverseStrike",
    ].includes(room.phase)
  ) {
    requireRule(
      room.players.every((p) => Object.hasOwn(room.submissions, p.uid)),
      "阶段尚未完成，请所有玩家在各自手机确认后再试",
      409,
    );
  }
  switch (room.phase) {
    case "identity":
      stage(room, "proposal");
      break;
    case "proposal":
      requireRule(room.proposalSubmitted, "请等待队长提交队伍");
      stage(room, "teamVote");
      break;
    case "teamVote": {
      const votes = room.players.map((p) => ({
        seat: p.seat,
        approve: room.submissions[p.uid] === "approve",
      }));
      const approved =
        votes.filter((v) => v.approve).length > room.capacity / 2;
      room.history.push({
        kind: "team",
        round: room.round,
        leader: room.leader,
        team: [...room.team],
        approved,
        votes,
      });
      room.teamApproved = approved;
      if (!approved) room.rejects++;
      else room.rejects = 0;
      if (room.rejects === 5) {
        if (room.board === "shadow-assist") stage(room, "offlineFinal");
        else end(room, "evil", "连续五次组队被否决，坏人获胜");
      } else stage(room, "teamResult");
      break;
    }
    case "teamResult":
      if (room.teamApproved) stage(room, "quest");
      else {
        room.leader = (room.leader % room.capacity) + 1;
        room.team = [];
        room.proposalSubmitted = false;
        stage(room, "proposal");
      }
      break;
    case "quest": {
      const fails = room.players.filter(
        (p) => room.team.includes(p.seat) && room.submissions[p.uid] === "fail",
      ).length;
      const threshold = room.capacity >= 7 && room.round === 4 ? 2 : 1;
      const result = {
        round: room.round,
        team: [...room.team],
        fails,
        success: fails < threshold,
        threshold,
      };
      room.quests.push(result);
      room.history.push({ kind: "quest", ...result });
      if (room.quests.filter((q) => !q.success).length === 3) {
        if (room.board === "shadow-assist") stage(room, "offlineFinal");
        else end(room, "evil", "三次任务失败，坏人获胜");
      } else stage(room, "questResult");
      break;
    }
    case "questResult":
      if (room.quests.filter((q) => q.success).length === 3)
        stage(
          room,
          room.board === "classic-11"
            ? "reverseStrike"
            : room.board === "shadow-assist"
              ? "offlineFinal"
              : "assassination",
        );
      else {
        room.round++;
        room.leader = (room.leader % room.capacity) + 1;
        room.team = [];
        room.proposalSubmitted = false;
        stage(room, "proposal");
      }
      break;
    case "reverseStrike": {
      const assassin = room.players.find(
        (p) => room.roles[p.uid] === "assassin",
      );
      const target = room.players.find(
        (p) => p.seat === room.submissions[assassin.uid],
      );
      if (room.roles[target.uid] === "reverse")
        room.convertedReverse = target.uid;
      // Do not publish target, hit, role or faction changes to the host/public view.
      stage(room, "assassination");
      break;
    }
    case "assassination": {
      const assassin = room.players.find(
        (p) => room.roles[p.uid] === "assassin",
      );
      const target = room.players.find(
        (p) => p.seat === room.submissions[assassin.uid],
      );
      const hit = room.roles[target.uid] === "merlin";
      room.history.push({ kind: "assassination", target: target.seat, hit });
      end(
        room,
        hit ? "evil" : "good",
        hit ? "刺杀命中梅林，坏人获胜" : "刺杀未命中梅林，好人获胜",
      );
      break;
    }
    default:
      throw new RuleError("当前阶段不可推进");
  }
}
module.exports = {
  BOARDS,
  COUNTS,
  TEAMS,
  RuleError,
  newRoom,
  enter,
  command,
  publicView,
  roomSummary,
  privateView,
  actionSpec,
};
