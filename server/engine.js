"use strict";
const { randomInt, randomUUID, createHash } = require("node:crypto");
const variants = require("./variants");
const knights = require("./knights");
const fairy = require("./fairy");
const KNIGHT_PHASES = ["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn"];
const SPECIAL_PHASES = [...KNIGHT_PHASES, "fairy"];
const assisted = (room) => ["shadow-assist", "chaos"].includes(room.board);
const COUNTS = {
  5: [3, 2],
  6: [4, 2],
  7: [4, 3],
  8: [5, 3],
  9: [6, 3],
  10: [6, 4],
  11: [7, 4],
  12: [7, 5],
};
const TEAMS = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
  11: [3, 4, 5, 6, 6],
  12: [3, 4, 5, 6, 6],
};
// 十二骑士系列板子共享技能、B牌、女巫、圣骑士等规则；10 人局仅 A 牌去红蓝兰斯洛特，
// 11 人局去红兰斯洛特且蓝兰斯洛特对梅林可见。
const KNIGHTS_BOARDS = ["knights", "knights-10", "knights-11"];
const isKnights = (board) => KNIGHTS_BOARDS.includes(board);
const BOARDS = [
  {
    id: "classic",
    name: "阿瓦隆 · 经典基础",
    available: true,
    counts: [5, 6, 7, 8, 9],
    namesByCapacity: { 9: "阿瓦隆 · 9人逆仆" },
    description: "按人数配置梅林、派西维尔及坏人角色；9人含逆仆",
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
    name: "阿瓦隆 · 影中执刃",
    available: true,
    mode: "assisted",
    counts: [12],
    description: "初始身份视野、组队与任务；含红蓝内奸",
  },
  {
    id: "chaos",
    mode: "assisted",
    name: "阿瓦隆 · 混沌契约",
    available: true,
    counts: [12],
    description: "初始身份视野、组队与魔法任务；含术士、高文与盗贼",
  },
  {
    id: "knights",
    name: "阿瓦隆 · 十二骑士",
    available: true,
    counts: [12],
    description:
      "同时秘密提交技能，同时生效，B牌复活；按需发起转换、仙女和夜晚",
  },
  {
    id: "knights-10",
    name: "阿瓦隆 · 十二骑士（10人）",
    available: true,
    counts: [10],
    description:
      "十二骑士10人局：A牌去掉红蓝兰斯洛特（6蓝4红），B牌堆与技能规则不变",
  },
  {
    id: "knights-11",
    name: "阿瓦隆 · 十二骑士（11人）",
    available: true,
    counts: [11],
    description:
      "十二骑士11人局：A牌去掉红兰斯洛特（7蓝4红），蓝兰斯洛特被梅林视为坏人，B牌堆与技能规则不变",
  },
];
const ROLES = {
  ...variants.roles,
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
  tools: "等待房主发起操作",
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
  const p = room.players.find((p) => p.uid === uid) ||
    room.spectators?.find((p) => p.uid === uid);
  requireRule(
    p,
    room.removedPlayers?.includes(uid) ? "你已被房主移出房间" : "你不在该房间",
    403,
  );
  return p;
}
function managementId(room, player) {
  // Old saved rooms have no membership token. Never expose account identifiers.
  return (
    player.membershipId ||
    createHash("sha256")
      .update(JSON.stringify([room.code, player.uid]))
      .digest("hex")
  );
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
    createdAt: Date.now(),
    host: uid,
    board: boardId,
    capacity,
    fairyEnabled: capacity >= 8,
    phase: "lobby",
    stage: randomUUID(),
    game: 0,
    players: [
      {
        uid,
        membershipId: randomUUID(),
        name: nickname(name),
        seat: 1,
        ready: false,
      },
    ],
    history: [],
  };
}
function enter(room, uid, name) {
  if ([...room.players, ...(room.spectators || [])].some((p) => p.uid === uid)) return;
  requireRule(room.phase === "lobby", "游戏已开始，无法加入");
  const seat = Array.from({ length: room.capacity }, (_, i) => i + 1).find(
    (s) => !room.players.some((p) => p.seat === s),
  ) ?? null;
  const player = {
    uid,
    membershipId: randomUUID(),
    name: nickname(name),
    seat,
    ready: false,
  };
  if (seat === null) (room.spectators ||= []).push(player);
  else room.players.push(player);
  if (room.removedPlayers)
    room.removedPlayers = room.removedPlayers.filter((id) => id !== uid);
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
function roleDeck(boardId, capacity) {
  if (variants.decks[boardId]) return [...variants.decks[boardId]];
  if (boardId === "classic" && capacity <= 9) {
    const goodRoles = [
      "merlin",
      "percival",
      ...Array(capacity === 5 ? 1 : capacity <= 7 ? 2 : 3).fill("servant"),
    ];
    const evilRoles = {
      5: ["morgana", "assassin"],
      6: ["morgana", "assassin"],
      7: ["morgana", "assassin", "oberon"],
      8: ["mordred", "morgana", "oberon"],
      9: ["mordred", "morgana", "assassin"],
    };
    return [
      ...goodRoles,
      ...(capacity === 9 ? ["reverse"] : []),
      ...evilRoles[capacity],
    ];
  }
  const [good, evil] = COUNTS[capacity];
  const courtRoles = [
    "merlin",
    "percival",
    ...Array(4).fill("servant"),
    "assassin",
    "morgana",
    "mordred",
    "oberon",
  ];
  return boardId === "classic-11"
    ? [...courtRoles, "reverse"]
    : boardId === "shadow-assist"
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
      : boardId === "classic-court"
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
          ];
}
function roleConfiguration(roles) {
  return [
    "good",
    "evil",
    ...(roles.some((r) => ROLES[r][1] === "third") ? ["third"] : []),
  ].map((faction) => {
    const ids = [
      "merlin",
      "percival",
      "servant",
      "reverse",
      "blueTraitor",
      "mordred",
      "morgana",
      "assassin",
      "oberon",
      "minion",
      "redTraitor",
      ...Object.keys(variants.roles),
    ].filter((id) => roles.includes(id) && ROLES[id][1] === faction);
    return {
      faction,
      label:
        faction === "good"
          ? "好人阵营"
          : faction === "third"
            ? "盗贼阵营"
            : "坏人阵营",
      roles: ids
        .map((id) => {
          const count = roles.filter((role) => role === id).length;
          const name = id === "servant" ? "忠臣" : ROLES[id][0];
          return name + (count > 1 ? `×${count}` : "");
        })
        .join("，"),
    };
  });
}
// Public composition only; never include player identities or seat assignments.
for (const b of BOARDS) {
  if (b.available)
    b.roleConfigurations = Object.fromEntries(
      b.counts.map((capacity) => [
        capacity,
        roleConfiguration(roleDeck(b.id, capacity)),
      ]),
    );
}
function start(room, flexible = false) {
  requireRule(
    room.players.length === room.capacity && room.players.every((p) => p.ready),
    "需要所有座位入座且全员准备",
  );
  board(room.board, room.capacity);
  room.fairyEnabled = fairy.enabled(room);
  room.players.sort((a, b) => a.seat - b.seat);
  const roles = shuffle(roleDeck(room.board, room.capacity));
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
  room.flexible = flexible;
  room.activity = null;
  room.toolSequence = 0;
  if (isKnights(room.board)) knights.init(room, shuffle);
  fairy.init(room);
  if (isKnights(room.board) || room.board === "chaos") room.flexible = true;
  stage(room, room.flexible ? "tools" : "identity");
}
function faction(room, uid) {
  if (room.knights) return knights.side(room, uid, ROLES);
  if (uid === room.convertedReverse) return "evil";
  return ROLES[room.roles[uid]][1];
}
function questChoices(room, uid) {
  const role = room.roles[uid];
  if (room.board === "chaos") {
    if (["blueWarlock", "redWarlock"].includes(role))
      return ["success", "magic"];
    if (role === "redThief") return ["thiefFail"];
    if (role === "oberon") return ["fail"];
    if (role === "blueThief") return ["success"];
  }
  if (
    room.knights &&
    (role === "redSwordsman" ||
      (["blueLancelot", "redLancelot"].includes(role) &&
        faction(room, uid) === "evil"))
  )
    return ["fail"];

  if (
    room.board === "shadow-assist" &&
    ["oberon", "redTraitor"].includes(room.roles[uid])
  )
    return ["fail"];
  return faction(room, uid) === "good" ? ["success"] : ["success", "fail"];
}
function identityRevision(room, uid) {
  const state = room.knights?.players[uid];
  return state?.identityRevision ?? (state?.availableRound > 1 ? 1 : 0);
}
function knightKnifeAllowed(room, uid) {
  const threeSuccesses =
    room.history.filter((h) => h.kind === "toolQuest" && h.success).length >= 3;
  return (
    faction(room, uid) === "evil" &&
    (threeSuccesses ||
      (room.knights.players[uid].alive &&
        ["mordred", "morgana", "assassin"].includes(room.roles[uid])))
  );
}
function actionSpec(room, uid) {
  const p = member(room, uid);
  if (p.seat === null) return null;
  if (room.phase === "fairy") return fairy.action(room, uid);
  if (room.knights && KNIGHT_PHASES.includes(room.phase))
    return knights.action(room, uid);
  if (
    room.knights &&
    !room.knights.players[uid].alive &&
    ["teamVote", "quest"].includes(room.phase)
  )
    return null;
  const targets = room.players.map((p) => ({ seat: p.seat, name: p.name }));
  switch (room.phase) {
    case "identity":
      return {
        kind: "confirm",
        label: "我已查看并记住身份与视野",
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
        : room.flexible
          ? null
          : {
              kind: "confirm",
              label: "本轮未上车，确认等待结算",
              choices: ["confirm"],
            };
    case "reverseStrike":
    case "assassination":
      if (room.knights)
        return room.activity.actor === p.seat && knightKnifeAllowed(room, uid)
          ? {
              kind: "target",
              label: "录入线下多数决议的梅林目标；0号表示空刀",
              targets: [
                { seat: 0, name: "空刀（场上没有梅林）" },
                ...knights
                  .living(room)
                  .map((t) => ({ seat: t.seat, name: t.name })),
              ],
            }
          : { kind: "confirm", label: "确认最终盘刀", choices: ["confirm"] };
      return room.roles[uid] === "assassin"
        ? {
            kind: "target",
            label:
              room.phase === "reverseStrike"
                ? "填入匪队线下决定的逆仆目标"
                : "填入匪队线下决定的梅林目标",
            targets: targets.filter((t) => t.seat !== p.seat),
          }
        : { kind: "confirm", label: "确认本次刀人操作", choices: ["confirm"] };
    default:
      return null;
  }
}
function privateView(room, uid) {
  requireRule(member(room, uid).seat !== null, "围观玩家没有身份", 403);
  requireRule(room.roles && room.phase !== "lobby", "身份尚未分配");
  const role = room.roles[uid],
    name = ROLES[role][0],
    side = faction(room, uid);
  let information = "没有视野。";
  const seats = (predicate) =>
    room.players
      .filter(
        (p) =>
          p.uid !== uid &&
          predicate(room.knights?.initialRoles[p.uid] || room.roles[p.uid]),
      )
      .map((p) => p.seat)
      .join("、");
  const namedInitialAllies = (allowed) =>
    room.players
      .filter(
        (p) =>
          p.uid !== uid &&
          allowed.includes(
            room.knights?.initialRoles[p.uid] || room.roles[p.uid],
          ),
      )
      .map((p) => {
        const initialRole =
          room.knights?.initialRoles[p.uid] || room.roles[p.uid];
        return `${p.seat}号（${ROLES[initialRole][0]}）`;
      })
      .join("、") || "无可见同伴";
  if (assisted(room)) {
    const visible = (allowed) => seats((r) => allowed.includes(r));
    if (role === "merlin")
      information = `你看见的坏人座位：${visible(room.board === "chaos" ? ["morgana", "redWarlock", "oberon", "redThief"] : ["morgana", "assassin", "oberon", "redTraitor"]) || "无"}号（不区分身份）。`;
    else if (role === "percival")
      information = `梅林与莫甘娜位于：${visible(["merlin", "morgana"])}号。你无法区分谁是梅林。`;
    else if (room.board === "shadow-assist" && role === "redTraitor")
      information = `你看见的坏人座位：${visible(["morgana", "assassin", "oberon"])}号（不区分身份）。`;
    else if (
      (room.board === "shadow-assist"
        ? ["mordred", "morgana", "assassin"]
        : ["mordred", "morgana", "redWarlock"]
      ).includes(role)
    )
      information =
        room.board === "shadow-assist"
          ? `你的坏人同伴：${visible(["mordred", "morgana", "assassin"])}号（不区分身份）。`
          : `你的坏人同伴：${namedInitialAllies(["mordred", "morgana", "redWarlock"])}。`;
    else if (room.board === "chaos" && role === "gawain")
      information = `蓝术士与红术士位于：${visible(["blueWarlock", "redWarlock"])}号（不区分身份）。`;
    else if (room.board === "chaos" && ["blueThief", "redThief"].includes(role))
      information = `你的盗贼同伴：${visible(["blueThief", "redThief"])}号。`;
    else if (role === "oberon") information = "没有视野。你与其他坏人不互认。";
  } else if (role === "reverse")
    information = `刺客位于：${seats((r) => r === "assassin")}号。${room.convertedReverse === uid ? "你已被命中，现随坏人阵营结算。" : "你只能投任务成功；被逆仆刀命中后转入坏人阵营。"}`;
  else if (role === "merlin")
    information = `你看见的举手座位：${seats((r) => (ROLES[r][1] === "evil" && r !== "mordred") || r === "reverse" || (room.board === "knights-11" && r === "blueLancelot"))}${room.board === "knights-11" ? "（蓝兰斯洛特对你可见，视为坏人；莫德雷德不在视野中）" : room.board !== "classic" ? "（莫德雷德不在视野中）" : ""}`;
  else if (role === "percival")
    information = `梅林与莫甘娜位于：${seats((r) => ["merlin", "morgana"].includes(r))}号。你无法区分谁是梅林。`;
  else if (role === "oberon")
    information = "你不知道其他坏人是谁，其他坏人也看不见你。";
  else if (side === "evil") {
    const allies = room.players
      .filter(
        (p) =>
          p.uid !== uid &&
          ROLES[room.roles[p.uid]][1] === "evil" &&
          room.roles[p.uid] !== "oberon",
      )
      .map((p) => `${p.seat}号（${ROLES[room.roles[p.uid]][0]}）`);
    information = `你的坏人同伴：${allies.join("、") || "无可见同伴"}`;
  }
  if (room.knights) {
    const state = room.knights.players[uid];
    if (
      [
        "redSwordsman",
        "redLancelot",
        "blueLancelot",
        "gareth",
        "gaheris",
      ].includes(role)
    )
      information = "没有视野。";
    else if (state.b) information = "没有视野。";
    else if (["assassin", "mordred", "morgana"].includes(role))
      information = `初始见面匪：${namedInitialAllies(["assassin", "mordred", "morgana"])}。`;

    const skillDescription = {
      blueGuard: "秘密守护一人，免疫一次出局才消耗。",
      gargoyle: "抽到时随机查验一名在场玩家；每轮可查验一人是否拥有主动击杀能力，不获知具体身份。",
      witch: "秘密指定替死者；替死者能被守护，不触发被动开枪。指定圣骑士替死时，圣骑士本轮反伤仍结算并直接出局。",
      magician:
        "秘密交换两个号码，本轮技能按换号结算；交换号码参与实际结算即消耗技能，不会连带出局。",
      paladin:
        "被动反伤：本轮以刀、决斗、枪击杀你的玩家全部反伤出局，你正常存活；触发后的后续技能环节失去技能。不能反伤红女巫，替女巫出局时本轮反伤仍正常结算。",
      blueKnight: "决斗坏人，刀错自己出局；莫德雷德视为好人。",
      redKnight: "决斗好人，刀错自己出局；莫德雷德视为好人。",
      blueAwakened: "可击杀任意一人一次。",
      redAwakened: "可击杀任意一人一次。",
      blueHunter: "主动自爆带走相邻一人；或预选场上其他一人，出局时被动开枪；也可不使用技能。主动与被动共用一次技能，替女巫出局不触发被动枪。",
      redHunter: "主动自爆带走相邻一人；或预选场上其他一人，出局时被动开枪；也可不使用技能。主动与被动共用一次技能，替女巫出局不触发被动枪。",
      prophet:
        "被动视野：每轮技能结束后自动更新存活B牌坏人座位，可随时在此查看。",
    }[role];
    if (skillDescription) information += " " + skillDescription;
    else if (
      [
        "gareth",
        "gaheris",
        "blueLancelot",
        "redLancelot",
        "redSwordsman",
        "assassin",
      ].includes(role)
    )
      information += " 可刀刀客或B角色一次；刀错不出局，仍消耗技能。";
    if (role === "gargoyle" && state.gargoyleInfo) {
      const result = state.gargoyleInfo;
      information += ` ${result.initial ? "抽牌随机查验" : `第${result.round}轮查验`}：${result.seat}号${result.canKill ? "拥有" : "没有"}主动击杀能力。`;
    }
    if (role === "prophet") {
      information = skillDescription;
      if (state.nightInfo) information += ` ${state.nightInfo}`;
      else information += " 等待技能结算后自动更新。";
    }
  }
  const fairyResult = fairy.result(room, uid);
  if (fairyResult?.fairyInfo) information += ` ${fairyResult.fairyInfo}`;
  return {
    game: room.game,
    stage: room.stage,
    identityRevision: identityRevision(room, uid),
    skillStatus: room.knights ? knights.skillStatus(room, uid) : null,
    passiveVision: !!room.knights && role === "prophet",
    fairyResult: fairyResult?.fairyInfo
      ? {
          revision: fairyResult.fairyRevision || 1,
          information: fairyResult.fairyInfo,
          summary: fairyResult.fairyInfo.replace(/（第\d+轮）$/, "").replace("号查验结果：", "号 · "),
        }
      : null,
    role: name,
    faction:
      side === "good" ? "好人阵营" : side === "third" ? "盗贼阵营" : "坏人阵营",
    information,
    outcome: room.result?.winner
      ? room.result.winner === side
        ? "本局你获胜"
        : "本局你失败"
      : null,
    action: actionSpec(room, uid),
  };
}
function offlineAssassination(room) {
  return (
    room.board === "classic" &&
    room.capacity === 8 &&
    (room.phase === "lobby" ||
      !room.roles ||
      !Object.values(room.roles).includes("assassin"))
  );
}
function boardName(room) {
  const b = BOARDS.find((b) => b.id === room.board);
  return b.namesByCapacity?.[room.capacity] || b.name;
}
function hasActiveOperation(room) {
  return [
    ...SPECIAL_PHASES,
    "teamVote",
    "quest",
    "assassination",
    "reverseStrike",
    "offlineFinal",
  ].includes(room.phase);
}
function canUseTools(room) {
  return !!room.roles && !["lobby", "ended", "terminated"].includes(room.phase);
}
function advanceKnightRound(room) {
  room.knights.round++;
  room.round = room.knights.round;
  room.leader = (room.leader % room.capacity) + 1;
  room.history.push({ kind: "variant", text: `进入第${room.round}轮` });
}
function convertKnights(room) {
  const k = room.knights;
  requireRule(k.conversions.length > 0, "转换牌已用完");
  const change = k.conversions.shift();
  if (change)
    for (const p of room.players) {
      if (["blueLancelot", "redLancelot"].includes(room.roles[p.uid]))
        k.players[p.uid].faction =
          faction(room, p.uid) === "good" ? "evil" : "good";
    }
  k.convertedRound = k.round;
  room.history.push({
    kind: "variant",
    text: change ? "本轮阵营转换" : "本轮不转换",
    resultType: "conversion",
  });
}
function beginActivity(room, input) {
  requireRule(canUseTools(room), "请先发放身份，结束后需重新开局");
  const kind = input.kind;
  requireRule(
    !SPECIAL_PHASES.includes(room.phase),
    "技能或查验进行中，请先结算或明确作废",
  );
  requireRule(
    [
      "vote",
      "quest",
      "assassination",
      "reverseStrike",
      "offline",
      "skills",
      "conversion",
      "fairy",
    ].includes(kind),
    "操作类型无效",
  );
  requireRule(
    !hasActiveOperation(room) || input.replace === true,
    "当前操作尚未结算，请先结算或确认作废",
    409,
  );
  if (kind === "fairy") {
    requireRule(fairy.enabled(room), "本房间未开启湖中仙女");
    requireRule(!hasActiveOperation(room), "请先完成或作废当前操作");
    requireRule(fairy.targets(room).length > 0, "没有可查验的仙女目标");
    room.flexible = true;
    room.toolSequence = (room.toolSequence || 0) + 1;
    room.activity = { kind, number: room.toolSequence, threshold: null, startedAt: Date.now() };
    room.team = [];
    stage(room, "fairy");
    return;
  }
  if (["skills", "conversion"].includes(kind)) {
    requireRule(isKnights(room.board), "当前板子不支持此操作");
    requireRule(!hasActiveOperation(room), "请先完成或作废当前操作");
    const k = room.knights;
    if (kind === "skills") {
      if (k.skillRound === k.round) advanceKnightRound(room);
      knights.begin(room, kind, requireRule);
      room.toolSequence++;
      room.activity = { kind, number: room.toolSequence, threshold: null, startedAt: Date.now() };
    } else {
      convertKnights(room);
      stage(room, "tools");
    }
    return;
  }
  const team = input.team || [];
  if (["vote", "quest"].includes(kind)) {
    requireRule(
      Array.isArray(team) &&
        new Set(team).size === team.length &&
        team.every((seat) =>
          room.players.some(
            (p) =>
              p.seat === seat &&
              (!room.knights || room.knights.players[p.uid].alive),
          ),
        ),
      "队伍座位不合法",
    );
    if (kind === "quest") {
      requireRule(team.length > 0, "请至少选择一位任务队员");
      requireRule(
        [1, 2].includes(input.threshold) && input.threshold <= team.length,
        "失败票门槛无效",
      );
    }
  }
  if (["assassination", "reverseStrike"].includes(kind)) {
    requireRule(!assisted(room), "本板子请在线下完成最终盘刀");
    requireRule(
      !!room.knights || Object.values(room.roles).includes("assassin"),
      "本配置请在线下刺梅林",
    );
    if (kind === "reverseStrike")
      requireRule(
        Object.values(room.roles).includes("reverse"),
        "当前配置没有逆仆",
      );
  }
  if (room.knights && kind === "assassination") {
    // Validate only public seat data here; an error must not become a faction oracle.
    requireRule(
      room.players.some((p) => p.seat === input.actor),
      "请选择线下决议的带刀人",
    );
  }
  if (kind === "offline")
    requireRule(
      assisted(room) || !!room.knights || offlineAssassination(room),
      "当前配置支持线上刀人",
    );
  // A new task opens the next round only after the previous skill cycle ended.
  // Validate before mutating so malformed or stale requests cannot advance time.
  if (
    kind === "quest" &&
    room.knights &&
    room.knights.skillRound === room.knights.round
  ) {
    advanceKnightRound(room);
  }
  if (hasActiveOperation(room)) {
    knights.cancel(room);
    room.history.push({ kind: "toolCanceled" });
  }
  room.flexible = true;
  room.toolSequence = (room.toolSequence || 0) + 1;
  room.activity = {
    kind,
    number: room.toolSequence,
    startedAt: Date.now(),
    threshold: kind === "quest" ? input.threshold : null,
    ...(room.knights && kind === "assassination" ? { actor: input.actor } : {}),
  };
  room.team = ["vote", "quest"].includes(kind)
    ? [...team].sort((a, b) => a - b)
    : [];
  room.result = null;
  stage(
    room,
    {
      vote: "teamVote",
      quest: "quest",
      assassination: "assassination",
      reverseStrike: "reverseStrike",
      offline: "offlineFinal",
    }[kind],
  );
}
function settleActivity(room) {
  requireRule(
    hasActiveOperation(room) && room.phase !== "offlineFinal",
    "当前没有可结算的线上操作",
  );
  const participants = room.players.filter((p) => actionSpec(room, p.uid));
  requireRule(
    participants.length > 0 &&
      participants.every((p) => Object.hasOwn(room.submissions, p.uid)),
    "操作尚未完成，请等待参与者提交",
    409,
  );
  const number = room.activity.number;
  if (room.phase === "fairy") {
    fairy.settle(room, faction);
    room.history.push({ kind: "variant", text: "仙女查验已完成", number });
    room.activity = null;
    room.team = [];
    stage(room, "tools");
    return;
  }
  if (KNIGHT_PHASES.includes(room.phase)) {
    if (!knights.settle(room, requireRule, ROLES)) return;
    if (room.activity.kind === "skills") knights.updateNight(room, ROLES);
    if (room.activity.kind === "skills")
      for (const text of room.knights.events || [])
        room.history.push({ kind: "skillDetail", number, text });
    if (room.activity.kind === "skills") {
      const result = room.knights.summary;
      const list = (seats) => (seats.length ? seats.join("、") + "号" : "无");
      room.history.push({
        kind: "skillResult",
        number,
        ...result,
        text: room.activity.earlyClosed
          ? "技能最终结果 · 含提前截止"
          : "技能最终结果",
        detail: `本轮出局：${list(result.eliminated)}；抽牌复活：${list(result.redrawn)}；原牌复活：${list(result.restored)}；最终仍出局：${list(result.out)}`,
      });
    }
    room.activity = null;
    room.team = [];
    stage(room, "tools");
    return;
  }
  if (room.phase === "teamVote") {
    const votes = participants.map((p) => ({
      seat: p.seat,
      approve:
        room.submissions[p.uid] === "abstain"
          ? null
          : room.submissions[p.uid] === "approve",
    }));
    room.history.push({
      kind: "toolVote",
      number,
      team: [...room.team],
      votes,
      approved: votes.filter((v) => v.approve).length > votes.length / 2,
      ...(room.activity.earlyClosed ? { earlyClosed: true } : {}),
    });
  } else if (room.phase === "quest") {
    const fails = participants.filter(
      (p) => room.submissions[p.uid] === "fail",
    ).length;
    room.history.push({
      kind: "toolQuest",
      number,
      team: [...room.team],
      fails,
      threshold: room.activity.threshold,
      success: fails < room.activity.threshold,
      ...(room.board === "chaos"
        ? variants.chaosQuest(
            participants.map((p) => room.submissions[p.uid]),
            room.activity.threshold,
          )
        : {}),
    });
  } else {
    const assassin = room.players.find((p) =>
      room.knights
        ? p.seat === room.activity.actor
        : room.roles[p.uid] === "assassin",
    );
    if (room.knights && room.submissions[assassin.uid] === "confirm") {
      room.history.push({
        kind: "variant",
        number,
        text: "未形成有效盘刀决定，请根据线下翻牌重新选择带刀人",
      });
      room.activity = null;
      room.team = [];
      stage(room, "tools");
      return;
    }
    const target = room.players.find(
      (p) => p.seat === room.submissions[assassin.uid],
    );
    if (room.phase === "reverseStrike") {
      if (room.roles[target.uid] === "reverse")
        room.convertedReverse = target.uid;
      room.history.push({ kind: "toolReverse", number });
    } else
      room.history.push({
        kind: "toolKnife",
        number,
        target: target?.seat ?? 0,
        hit: room.knights
          ? target
            ? room.roles[target.uid] === "merlin"
            : !knights.living(room).some((p) => room.roles[p.uid] === "merlin")
          : room.roles[target.uid] === "merlin",
      });
  }
  room.activity = null;
  room.team = [];
  stage(room, "tools");
}
// These policies depend only on the public phase, never on a secret role or choice.
function closeWaitingPolicy(room) {
  if (
    !room.flexible ||
    !room.activity ||
    !hasActiveOperation(room) ||
    room.phase === "offlineFinal"
  )
    return null;
  if (room.phase === "teamVote")
    return {
      mode: "abstain",
      label: "未交者记弃权并结算",
      title: "提前截止投票？",
      description:
        "未提交者记为弃权；赞成票仍需超过本次全部有投票资格玩家的一半才通过。已提交的票不会更改。",
    };
  if (["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn"].includes(room.phase))
    return {
      mode: "pass",
      label: "未交者跳过技能",
      title: "结束本阶段等待？",
      description:
        "本阶段未提交者按不使用技能／确认处理，不额外消耗技能次数；已提交的行动照常结算。后续如有追加行动，仍会等待新的提交。",
    };
  return {
    mode: "cancel",
    label: room.phase === "quest" ? "作废本次任务" : room.phase === "fairy" ? "作废本次查验" : "作废本次操作",
    title: "作废本次操作并结束等待？",
    description:
      room.phase === "quest"
        ? "本次任务作废，不补成功或失败票，不公布已提交票数，也不计入任务结果。可重新发起或在线下处理。"
        : "本次操作作废，不代选目标、不产生查验或命中结果。可重新发起或在线下处理。",
  };
}
function settleIfComplete(room) {
  // Legacy sequential games retain their original transitions; current clients use tools.
  if (!room.flexible || !room.activity || room.phase === "offlineFinal") return;
  const participants = room.players.filter((p) => actionSpec(room, p.uid));
  if (
    participants.length &&
    participants.every((p) => Object.hasOwn(room.submissions, p.uid))
  )
    settleActivity(room);
}
function phaseName(room) {
  if (SPECIAL_PHASES.includes(room.phase))
    return {
      skillPrepare: "同时秘密使用技能",
      skillTurn: "技能结算",
      hunterTurn: "出局技能确认",
      paladinTurn: "追加技能确认",
      fairy: "仙女查验",
    }[room.phase];
  if (room.flexible)
    return (
      {
        teamVote: "全员投票",
        quest: "任务出牌",
        assassination: "刀梅林",
        reverseStrike: "刀逆仆",
        offlineFinal: "线下刀人",
      }[room.phase] || PHASES[room.phase]
    );
  return room.phase === "offlineFinal" && offlineAssassination(room)
    ? "线下刺梅林"
    : PHASES[room.phase];
}
function roomSummary(room, uid) {
  const p = room.players.find((p) => p.uid === uid) ||
    room.spectators?.find((p) => p.uid === uid);
  requireRule(p || room.host === uid, "你不在该房间", 403);
  return {
    code: room.code,
    testRoom: room.testRoom === true,
    boardName: boardName(room),
    capacity: room.capacity,
    phaseName: phaseName(room),
    phase: room.phase,
    status: room.phase === "lobby" ? "lobby" : room.phase === "ended" ? "ended" : "playing",
    occupied: room.players.length,
    hostName: [...room.players, ...(room.spectators || [])].find(p => p.uid === room.host)?.name || "房主未入座",
    relation: room.host === uid ? "房主" : p?.seat != null ? "玩家" : "旁观者",
    canLeave: !!p && (room.phase === "lobby" || (p.seat === null && uid !== room.host)),
    createdAt: room.createdAt || 0,
    updatedAt: room.updatedAt || 0,
    game: room.game,
    seat: p?.seat ?? null,
    isMember: !!p,
    isHost: room.host === uid,
  };
}
function operationProgress(room, uid) {
  if (
    uid !== room.host ||
    ![
      ...SPECIAL_PHASES,
      "identity",
      "teamVote",
      "quest",
      "assassination",
      "reverseStrike",
    ].includes(room.phase)
  )
    return null;
  const players = room.players.map((p) => {
    const required = !!actionSpec(room, p.uid);
    return {
      seat: p.seat,
      name: p.name,
      required,
      completed: required && Object.hasOwn(room.submissions || {}, p.uid),
    };
  });
  return {
    players,
    total: players.filter((p) => p.required).length,
    completed: players.filter((p) => p.completed).length,
  };
}
function publicView(room, uid) {
  const p = member(room, uid);
  const action = actionSpec(room, uid);
  const fairyResult = fairy.result(room, uid);
  const awaiting = !!action && !Object.hasOwn(room.submissions || {}, uid);
  // Explicit allowlist only: never spread the authoritative room into a response.
  return {
    code: room.code,
    testRoom: room.testRoom === true,
    board: room.board,
    boardName:
      room.board === "classic" && room.capacity === 10
        ? "旧版10人配置（请更换板子）"
        : boardName(room),
    roleConfiguration: roleConfiguration(
      room.phase !== "lobby" && room.roles
        ? room.knights
          ? roleDeck(room.board, room.capacity)
          : Object.values(room.roles)
        : roleDeck(room.board, room.capacity),
    ),
    showSkillDetails: room.showSkillDetails === true,
    fairyEnabled: fairy.enabled(room),
    fairyHolder: fairy.holder(room),
    operationProgress: operationProgress(room, uid),
    closeWaiting: room.host === uid ? closeWaitingPolicy(room) : null,
    operationStatus:
      action || hasActiveOperation(room)
        ? {
            title: action
              ? awaiting
                ? "请完成本次操作"
                : "已提交，等待其他玩家"
              : "本次你无需操作",
            detail:
              ["paladinTurn", "hunterTurn"].includes(room.phase)
                ? "进入追加技能确认，上一阶段提交已完成。所有玩家均需再次操作；没有可用行动时请选择确认，收齐后继续结算。"
                : room.phase === "offlineFinal"
                ? "等待线下处理完成，由房主记录。"
                : room.flexible
                  ? "参与者全部提交后自动结算；下一项由房主发起。"
                  : "等待本阶段完成后由房主推进。",
          }
        : null,
    flexible: !!room.flexible,
    canUseTools: room.host === uid && canUseTools(room),
    canKick:
      room.host === uid &&
      ["lobby", "ended", "terminated"].includes(room.phase),
    hasActiveOperation: hasActiveOperation(room),
    activity: room.activity
      ? {
          kind: room.activity.kind,
          number: room.activity.number,
          threshold: room.activity.threshold,
        }
      : null,
    knifeOffline: assisted(room) || offlineAssassination(room),
    knights: room.knights
      ? {
          round: room.knights.round,
          fairy: fairy.holder(room),
          remainingCards: room.knights.deck.length,
        }
      : null,
    hasReverse: !!room.roles && Object.values(room.roles).includes("reverse"),
    assisted: assisted(room),
    offlineAssassination: offlineAssassination(room),
    capacity: room.capacity,
    phase: room.phase,
    phaseName: phaseName(room),
    stage: room.stage,
    game: room.game,
    me: {
      seat: p.seat,
      name: p.name,
      isHost: room.host === uid,
      ready: p.ready,
      submitted: Object.hasOwn(room.submissions || {}, uid),
      identityRevision: identityRevision(room, uid),
      fairyResultPending:
        !!fairyResult?.fairyInfo &&
        (fairyResult.fairyRevision || 1) >
          (fairyResult.fairyAcknowledged || 0),
      identityChanged:
        identityRevision(room, uid) >
        (room.knights?.players[uid]?.identityAcknowledged || 0),
    },
    players: room.players.map((p) => ({
      seat: p.seat,
      ...(room.host === uid ? { managementId: managementId(room, p) } : {}),
      name: p.name,
      ready: p.ready,
      isHost: p.uid === room.host,
      alive: room.knights
        ? (room.knights.snapshot?.players[p.uid] || room.knights.players[p.uid])
            .alive
        : true,
    })),
    leader: room.leader || null,
    round: room.round || null,
    team: room.team || [],
    teamSize: room.flexible
      ? (room.team || []).length
      : room.round
        ? TEAMS[room.capacity][room.round - 1]
        : null,
    rejects: room.rejects || 0,
    quests: room.quests || [],
    history: room.history.filter(
      (h) =>
        h.kind !== "toolCutoff" && (room.showSkillDetails === true ||
        !(
          h.kind === "skillDetail" ||
          (isKnights(room.board) &&
            h.kind === "variant" &&
            /^\d+号(?:使用技能|开枪|使用复活)/.test(h.text || ""))
        )),
    ),
    result: room.result || null,
    proposalSubmitted: !!room.proposalSubmitted,
    needsSubmission: p.seat !== null && (room.flexible
      ? !!actionSpec(room, uid)
      : [
          "identity",
          "teamVote",
          "quest",
          "assassination",
          "reverseStrike",
        ].includes(room.phase)),
    canAdvance:
      room.host === uid &&
      (room.flexible
        ? hasActiveOperation(room) && room.phase !== "offlineFinal"
        : !["lobby", "ended", "terminated", "offlineFinal"].includes(
            room.phase,
          )),
  };
}
function command(room, uid, input) {
  const previous = new Set(room.history);
  const startedAt = room.activity?.startedAt || Date.now();
  applyCommand(room, uid, input);
  for (const entry of room.history) {
    if (!previous.has(entry) && !entry.startedAt) entry.startedAt = startedAt;
  }
}
function applyCommand(room, uid, input) {
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
      "kick",
      "offline",
      "closeOffline",
      "beginActivity",
      "settleTool",
      "closeWaiting",
      "cancelActivity",
      "finishTools",
    ].includes(type)
  )
    requireRule(uid === room.host, "只有房主可以管理流程", 403);
  if (type === "updateSettings") {
    requireRule(uid === room.host, "只有房主可以管理流程", 403);
    requireRule(typeof input.visible === "boolean", "显示设置无效");
    const next = structuredClone(room);
    if (input.board !== room.board || input.capacity !== room.capacity)
      command(next, uid, {
        type: "configure",
        stage: next.stage,
        board: input.board,
        capacity: input.capacity,
      });
    if (isKnights(next.board)) next.showSkillDetails = input.visible;
    else requireRule(input.visible === false, "当前板子没有技能过程设置");
    if (input.fairyEnabled !== undefined) {
      requireRule(typeof input.fairyEnabled === "boolean", "湖中仙女设置无效");
      requireRule(next.capacity >= 7 || !input.fairyEnabled, "5、6人局不支持湖中仙女");
      if (input.fairyEnabled !== fairy.enabled(next)) {
        requireRule(next.phase !== "fairy", "请先完成或作废当前仙女查验");
        next.fairyEnabled = input.fairyEnabled;
        if (next.roles) fairy.init(next);
        if (next.phase === "lobby") {
          next.players.forEach((player) => (player.ready = false));
          stage(next, "lobby");
        }
      }
    }
    Object.assign(room, next);
    return;
  }
  if (type === "setSkillVisibility") {
    requireRule(uid === room.host, "只有房主可以管理流程", 403);
    requireRule(isKnights(room.board), "当前板子没有技能过程设置");
    requireRule(typeof input.visible === "boolean", "显示设置无效");
    room.showSkillDetails = input.visible;
    return;
  }
  if (type === "ackFairyResult") {
    const state = fairy.result(room, uid);
    requireRule(
      state?.fairyInfo && input.revision === (state.fairyRevision || 1),
      "查验结果已变化，请重新查看",
      409,
    );
    state.fairyAcknowledged = input.revision;
    return;
  }
  if (type === "ackIdentity") {
    const state = room.knights?.players[uid];
    requireRule(
      state && input.revision === identityRevision(room, uid),
      "身份已变化，请重新查看",
      409,
    );
    state.identityRevision = input.revision;
    state.identityAcknowledged = input.revision;
    return;
  }
  if (type === "closeWaiting") {
    const policy = closeWaitingPolicy(room);
    requireRule(policy, "当前操作不支持结束等待");
    requireRule(input.confirm === true, "请确认结束等待的处理规则");
    const next = structuredClone(room);
    const participants = next.players.filter((p) => actionSpec(next, p.uid));
    const missing = participants.filter(
      (p) => !Object.hasOwn(next.submissions, p.uid),
    );
    if (participants.length && !missing.length) settleIfComplete(next);
    else if (policy.mode === "cancel" || !participants.length) {
      knights.cancel(next);
      next.history.push({
        kind: "toolCanceled",
        number: next.activity.number,
        text: next.phase === "quest" ? "任务已作废" : "操作已作废",
        detail: participants.length
          ? policy.description
          : "本阶段没有参与者，操作已作废。",
      });
      next.activity = null;
      next.team = [];
      stage(next, "tools");
    } else {
      for (const player of missing) {
        if (policy.mode === "pass")
          requireRule(
            actionSpec(next, player.uid).choices.includes("pass"),
            "本阶段不支持跳过",
          );
        next.submissions[player.uid] = policy.mode;
      }
      next.activity.earlyClosed = true;
      settleIfComplete(next);
    }
    Object.assign(room, next);
    return;
  }
  if (type === "settleTool") {
    requireRule(
      canUseTools(room) &&
        hasActiveOperation(room) &&
        room.phase !== "offlineFinal",
      "当前没有可结算的线上操作",
    );
    // Validate settlement on a copy so a failed attempt leaves the original stage intact.
    const next = structuredClone(room);
    next.flexible = true;
    if (!next.activity) {
      next.toolSequence = (next.toolSequence || 0) + 1;
      next.activity = {
        kind: next.phase,
        number: next.toolSequence,
        threshold: next.capacity >= 7 && next.round === 4 ? 2 : 1,
      };
    }
    settleActivity(next);
    Object.assign(room, next);
    return;
  }
  if (type === "beginActivity") {
    beginActivity(room, input);
    return;
  }
  if (type === "cancelActivity") {
    requireRule(
      canUseTools(room) && hasActiveOperation(room),
      "当前没有进行中的操作",
    );
    knights.cancel(room);
    room.history.push({ kind: "toolCanceled" });
    room.flexible = true;
    room.activity = null;
    room.team = [];
    stage(room, "tools");
    return;
  }
  if (type === "finishTools") {
    requireRule(canUseTools(room), "当前没有已发牌的对局");
    requireRule(
      !hasActiveOperation(room) || input.replace === true,
      "请先结算或确认作废当前操作",
      409,
    );
    if (hasActiveOperation(room)) room.history.push({ kind: "toolCanceled" });
    room.flexible = true;
    room.activity = null;
    end(room, null, "房主已结束本局，以线下确认的胜负为准。");
    return;
  }
  if (type === "kick") {
    requireRule(
      ["lobby", "ended", "terminated"].includes(room.phase),
      "仅准备阶段或对局结束后可以移出玩家",
      409,
    );
    requireRule(input.confirm === true, "请确认移出玩家");
    const target = room.players.find((player) => player.seat === input.seat);
    requireRule(
      target && input.targetId === managementId(room, target),
      "该座位玩家已变化，请刷新后重新选择",
      409,
    );
    requireRule(target.uid !== room.host, "不能移出房主，请先移交房主");
    room.removedPlayers = [
      ...new Set([...(room.removedPlayers || []), target.uid]),
    ];
    room.players = room.players.filter((player) => player.uid !== target.uid);
    // Revoke stale submissions and management confirmations without changing the result.
    stage(room, room.phase);
    return;
  }
  if (type === "stand") {
    requireRule(room.phase === "lobby", "对局中不可站起");
    requireRule(p.seat !== null, "你已在围观");
    room.players = room.players.filter((player) => player.uid !== uid);
    p.seat = null;
    p.ready = false;
    (room.spectators ||= []).push(p);
    return;
  }
  if (type === "leave") {
    requireRule(room.phase === "lobby" || (p.seat === null && uid !== room.host), "对局中不可离开座位，请联系房主终止");
    room.players = room.players.filter((p) => p.uid !== uid);
    room.spectators = (room.spectators || []).filter((p) => p.uid !== uid);
    return;
  }
  if (type === "transfer") {
    const target = room.players.find((p) => p.seat === input.seat);
    requireRule(target, "目标座位无人");
    requireRule(target.uid !== uid, "不能转交给自己");
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
    if (p.seat === null) {
      room.spectators = room.spectators.filter((player) => player.uid !== uid);
      room.players.push(p);
    }
    p.seat = input.seat;
    p.ready = false;
    return;
  }
  if (type === "ready") {
    requireRule(p.seat !== null, "请先入座再准备");
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
    if (room.capacity !== input.capacity) room.fairyEnabled = input.capacity >= 8;
    room.board = input.board;
    room.capacity = input.capacity;
    room.players.forEach((p) => (p.ready = false));
    stage(room, "lobby");
    return;
  }
  if (type === "start") {
    requireRule(room.phase === "lobby", "对局已经开始");
    requireRule(
      input.flexible === undefined || typeof input.flexible === "boolean",
      "流程设置无效",
    );
    start(room, input.flexible === true);
    return;
  }
  if (type === "rematch") {
    requireRule(
      ["ended", "terminated"].includes(room.phase),
      "只能在结束后重开",
    );
    room.fairyEnabled = fairy.enabled(room);
    for (const key of [
      "roles",
      "knights",
      "fairy",
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
      "flexible",
      "activity",
      "toolSequence",
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
      (room.board === "shadow-assist" || offlineAssassination(room)) &&
        room.phase === "offlineFinal",
      "当前不是线下结算阶段",
    );
    if (room.flexible || input.keepPlaying === true) {
      room.flexible = true;
      room.history.push({ kind: "toolOffline", number: room.activity?.number });
      room.activity = null;
      stage(room, "tools");
      return;
    }
    end(
      room,
      null,
      offlineAssassination(room)
        ? "莫德雷德线下刺梅林已结算，以线下胜负为准。"
        : "线下特殊结算已完成。小程序未判定最终胜方。",
    );
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
    // Last submission and settlement commit together, including any hunter interruption.
    const next = room.flexible && room.activity ? structuredClone(room) : room;
    next.submissions[uid] = input.value;
    settleIfComplete(next);
    Object.assign(room, next);
    return;
  }
  requireRule(type === "advance", "未知操作");
  if (room.flexible) {
    settleActivity(room);
    return;
  }
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
          Object.values(room.roles).includes("reverse")
            ? "reverseStrike"
            : room.board === "shadow-assist" || offlineAssassination(room)
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
  roleName: (role) => ROLES[role]?.[0] || null,
};
