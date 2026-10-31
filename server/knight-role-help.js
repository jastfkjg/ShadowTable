"use strict";

// Presentation only. Board details and private identity cards share this copy;
// eligibility, targeting and settlement remain in knights.js.
const fact = (label, text) => ({ label, text });
const attackNote = "实际出局仍按换号、守护、反伤和替死规则结算。";
const nextRound = "通过抽 B 牌获得后，从下一轮技能环节开始使用。";
const armor =
  "首次出局时，若 B 牌还有剩余，消耗一张 B 牌恢复原身份和初始视野；B 牌耗尽则不能复活。";
const names = {
  gareth: "蓝刀客·加雷斯",
  gaheris: "蓝刀客·加赫雷斯",
  blueLancelot: "蓝刀客 · 兰斯洛特",
  redLancelot: "红刀客 · 兰斯洛特",
  redSwordsman: "红刀客 · 奥伯伦",
  assassin: "刺客",
  merlin: "梅林",
  percival: "派西维尔",
  servant: "忠臣",
  mordred: "莫德雷德",
  morgana: "莫甘娜",
  paladin: "圣骑士",
  magician: "魔术师",
  prophet: "月下先知",
  blueAwakened: "觉醒蓝刀客",
  redAwakened: "觉醒红刀客",
  blueKnight: "蓝骑士",
  redKnight: "红骑士",
  blueGuard: "蓝守卫",
  gargoyle: "石像鬼",
  blueHunter: "蓝猎人",
  redHunter: "红猎人",
  witch: "女巫",
};
const sourceRoles = {
  "蓝刀客 · 加雷斯 / 加赫雷斯": ["gareth", "gaheris"],
  "梅林 / 派西维尔 / 忠臣": ["merlin", "percival", "servant"],
  "莫德雷德 / 莫甘娜": ["mordred", "morgana"],
  ...Object.fromEntries(
    Object.entries(names).map(([id, name]) => [name, [id]]),
  ),
};

function roleHelp(role, capacity = 12) {
  let brief,
    facts,
    exception = "",
    type = "主动 · 攻击";
  if (
    [
      "gareth",
      "gaheris",
      "blueLancelot",
      "redLancelot",
      "redSwordsman",
      "assassin",
    ].includes(role)
  ) {
    brief = "有一次开刀机会，能攻击刀客和 B 牌角色；刀错也会用掉技能。";
    facts = [
      fact(
        "怎么用",
        "技能环节选择场上其他 1 人开刀，不能选自己，也可以不使用。",
      ),
      fact(
        "攻击范围",
        "可击杀 A 牌刀客或 B 牌角色，不要求对方与你阵营不同；攻击其他 A 牌身份不能将其击杀。",
      ),
      fact(
        "使用次数",
        "每张身份牌限用一次；刀错不会因此让自己出局，但仍消耗技能。",
      ),
    ];
    exception =
      "A 牌刀攻击刺客时，刺客只失去技能，不会被这一刀击杀。" + attackNote;
    if (["blueLancelot", "redLancelot"].includes(role)) {
      facts.push(
        fact(
          "阵营转换",
          "抽到转换牌时切换好人／坏人阵营，角色卡和初始视野不变；当前为好人只能投成功，当前为坏人必须投失败。",
        ),
      );
      facts.push(fact("初始视野", "没有初始视野，不参与坏人互认。"));
      if (capacity === 11 && role === "blueLancelot")
        exception +=
          "11 人局发牌时，蓝兰斯洛特被梅林视为坏人；后续转换不改变初始视野。";
    } else if (role === "assassin") {
      facts.push(fact("初始视野", "与莫德雷德、莫甘娜互相知道座位和身份。"));
    } else {
      facts.push(fact("初始视野", "没有初始视野，不参与坏人互认。"));
      if (role === "redSwordsman")
        facts.push(fact("任务出牌", "上车执行任务时必须投失败。"));
    }
  } else if (
    ["merlin", "percival", "servant", "mordred", "morgana"].includes(role)
  ) {
    type = "无主动技能";
    const descriptions = {
      merlin: "能看到部分坏人的座位，需要隐藏身份，避免最终被刺中。",
      percival: "能看到梅林和莫甘娜的座位，但需要自己判断谁是梅林。",
      servant: "没有额外视野，通过发言和任务结果判断其他玩家。",
      mordred: "梅林看不到你，但你能与刺客、莫甘娜互认。",
      morgana: "在派西维尔眼中，你与梅林无法区分。",
    };
    brief = descriptions[role];
    facts = [fact("怎么操作", "没有主动技能，技能环节按提示确认即可。")];
    if (role === "merlin")
      facts.push(
        fact(
          "初始视野",
          `看见刺客、莫甘娜、红刀客·奥伯伦${capacity >= 12 ? "、红兰斯洛特" : ""}${capacity === 11 ? "、蓝兰斯洛特（视为坏人）" : ""}的座位，不区分具体身份；看不到莫德雷德${capacity >= 12 ? "和蓝兰斯洛特" : ""}。`,
        ),
      );
    if (role === "percival")
      facts.push(
        fact("初始视野", "看见梅林与莫甘娜的座位，但不知道谁对应哪个身份。"),
      );
    if (role === "servant") facts.push(fact("初始视野", "没有额外身份信息。"));
    if (["mordred", "morgana"].includes(role))
      facts.push(
        fact("初始视野", "刺客、莫德雷德、莫甘娜互相知道座位和身份。"),
      );
    if (["merlin", "percival", "morgana"].includes(role))
      facts.push(fact("首次复活", armor));
    if (role === "mordred")
      exception =
        "骑士决斗时，莫德雷德按好人判定；这不会改变你的真实坏人阵营。";
  } else if (role === "paladin") {
    type = "被动 · 反伤";
    brief =
      "受到刀、决斗或枪的致命攻击时，让攻击者出局，自己存活；女巫相关情况例外。";
    facts = [
      fact("怎么用", "自带被动反伤，无需选目标，技能环节只需确认。"),
      fact(
        "反伤效果",
        "同一技能环节中，所有用刀、成功决斗或枪击杀你的玩家都会被反伤出局，你正常存活。反伤优先于守护，不消耗你身上的守护。",
      ),
      fact(
        "何时用完",
        "未触发时保留技能；触发的这一轮仍能继续反伤，从后续技能环节起失去反伤能力。",
      ),
    ];
    exception =
      "不能反伤红女巫。女巫触发替死并指定你时，本轮反伤仍正常结算，但你在本轮最后直接出局，守护也无法阻止。";
  } else if (role === "magician") {
    type = "主动 · 换号";
    brief = "秘密交换两个号码，让本轮指向这些号码的技能改为指向另一人。";
    facts = [
      fact(
        "怎么用",
        "技能环节选择两名在场玩家的号码，可包含自己；交换的是号码，不是身份或阵营。",
      ),
      fact(
        "本轮效果",
        "攻击按换号后的号码寻找目标，同时设置的守护和替死目标也按换号确定；石像鬼查验直接查原号码，不受换号影响。",
      ),
      fact(
        "何时用完",
        "交换的号码参与实际攻击结算才消耗这一次技能；刀错、被守护或攻击已出局者也算。仅设置换号而未参与攻击结算不消耗，下轮可重选。",
      ),
      fact("何时可用", nextRound),
    ];
    exception = "换号不会让魔术师连带出局。";
  } else if (role === "prophet") {
    type = "被动 · 查看座位";
    brief = "每轮技能结束后，可以查看场上持有红方 B 牌的玩家座位。";
    facts = [
      fact("怎么查看", "无需选择目标，打开「我的身份」查看记录。"),
      fact(
        "何时更新",
        "每轮技能全部结算、并完成复活抽牌后，自动记录仍在场的 B 牌坏人座位。",
      ),
      fact(
        "信息范围",
        "只显示 B 牌坏人的座位，不包含仍持 A 牌的坏人；技能结算过程中不会刷新，需等整轮结束。",
      ),
    ];
  } else if (["blueAwakened", "redAwakened"].includes(role)) {
    brief = "有一次开刀机会，可以攻击其他任意身份的玩家。";
    facts = [
      fact("怎么用", "技能环节选择场上其他 1 人开刀，不能选自己。"),
      fact(
        "攻击范围",
        "不受 A 刀的目标身份限制，可攻击其他任意身份，也不要求对方与你阵营不同。",
      ),
      fact("使用次数", "每张身份牌限用一次，出刀即消耗。"),
      fact("何时可用", nextRound),
    ];
    exception = attackNote;
  } else if (["blueKnight", "redKnight"].includes(role)) {
    type = "主动 · 决斗";
    const target = role === "blueKnight" ? "坏人" : "好人",
      wrong = role === "blueKnight" ? "好人" : "坏人";
    brief = `与${target}决斗使对方出局，选到${wrong}则自己出局。`;
    facts = [
      fact("怎么用", "技能环节选择场上其他 1 人决斗，不能选自己。"),
      fact(
        "如何判断",
        `按目标当前阵营判断：目标是${target}，则对方出局；目标是${wrong}，则自己出局。`,
      ),
      fact("使用次数", "每张身份牌限用一次，发起决斗即消耗。"),
      fact("何时可用", nextRound),
    ];
    exception =
      `莫德雷德在决斗中按好人判定，因此${role === "blueKnight" ? "蓝骑士与其决斗时自己出局" : "红骑士与其决斗时莫德雷德出局"}。` +
      attackNote;
  } else if (role === "blueGuard") {
    type = "主动 · 守护";
    brief = "秘密保护一人，可保护自己；保护真正挡下出局时才用掉技能。";
    facts = [
      fact("怎么用", "技能环节选择一名在场玩家守护，可以选择自己。"),
      fact(
        "保护效果",
        "本轮为目标挡下一次可被守护的出局；一份守护仅挡一刀，也能保护女巫指定的替死者。",
      ),
      fact(
        "何时用完",
        "挡下出局才消耗这一次技能；未触发则保留，下轮可以重新选人。",
      ),
      fact("何时可用", nextRound),
    ];
    exception =
      "守护不能阻止猎人主动自爆、反伤导致的直接出局，或圣骑士替女巫出局。";
  } else if (role === "gargoyle") {
    type = "主动 · 查验";
    brief = "查一个人有没有主动击杀能力，但查不到具体身份。";
    facts = [
      fact(
        "首次获得",
        "这一批 B 牌全部发完后，自动随机查验一名在场玩家，可能查到自己。",
      ),
      fact(
        "之后每轮",
        "从下一轮技能环节起，可选择一名在场玩家查验，也可以选自己；每轮可用，不消耗一次性技能。",
      ),
      fact(
        "查到什么",
        "仅获知是否拥有主动击杀能力，包括刺客、刀客（含兰斯洛特）、觉醒刀客、骑士和猎人；不显示具体身份。",
      ),
      fact(
        "查看记录",
        "结果只有自己可见，在「我的身份」保留本次身份的历次查验结果；记录不会随目标后来换牌而改变。",
      ),
    ];
    exception =
      "判断的是角色能力，不代表对方还有技能次数。主动查验读取本轮提交时的身份，直接查所选号码，不参与攻击换号。";
  } else if (["blueHunter", "redHunter"].includes(role)) {
    type = "主动 / 被动 · 开枪";
    brief = "可主动自爆向邻座开枪，或提前选人，在自己本轮出局时自动开枪。";
    facts = [
      fact("怎么选", "技能环节从主动自爆、预选被动枪、不使用技能中三选一。"),
      fact(
        "主动用法",
        `自己自爆出局，向固定相邻座位的一名在场玩家开枪。首尾相邻（${capacity} 号邻座为 1 号与 ${capacity - 1} 号），不能跳过已出局的邻座。`,
      ),
      fact(
        "被动用法",
        "预选场上其他 1 人，自己本轮出局时自动向其开枪；没有出局则不消耗，下轮可重选。不使用技能则本轮不会自动开枪。",
      ),
      fact("使用次数", "主动和被动共用一次技能，用掉一种就不能再用另一种。"),
      fact("何时可用", nextRound),
    ];
    exception =
      "主动自爆无法被守护阻止；替女巫出局不触发被动枪，也不会取消已提交的主动枪。枪的目标仍按换号、守护、反伤和替死规则结算。";
  } else if (role === "witch") {
    type = "主动 · 指定替死";
    brief = "提前指定一人，在自己将出局时让其替死；也可以指定自己。";
    facts = [
      fact("怎么用", "技能环节秘密选择一名在场玩家作为替死者，可以选择自己。"),
      fact(
        "替死效果",
        "本轮自己将出局时，若替死触发，改由指定玩家承受；对方能被守卫保护。指定自己仍会出局。",
      ),
      fact(
        "何时用完",
        "替死触发才消耗这一次技能；未触发则保留，下轮可以重新选人。",
      ),
      fact("何时可用", nextRound),
    ];
    exception =
      "替死者是猎人时，不触发被动开枪；是圣骑士时，其本轮反伤仍正常结算，但本轮最后直接出局，不能用守护阻止。";
  } else return null;
  return {
    brief,
    type,
    facts,
    exception,
    exceptionTitle: "注意",
    text: facts.map((f) => f.text).join("") + exception,
  };
}

function boardRoles(role, capacity) {
  if (!sourceRoles[role.name]) return [role];
  return sourceRoles[role.name].map((id) => ({
    ...role,
    name: names[id],
    roleId: id,
    ...roleHelp(id, capacity),
  }));
}

// Readable even on older clients. The dedicated section also survives identity
// snapshots without mixing rules into private vision or inspection results.
function identityHelp(role, capacity) {
  const help = roleHelp(role, capacity);
  if (!help) return "";
  return (
    "\n\n角色能力\n" +
    [
      "一句话：" + help.brief,
      ...help.facts.map((f) => f.label + "：" + f.text),
      ...(help.exception ? ["注意：" + help.exception] : []),
    ].join("\n")
  );
}
module.exports = { roleHelp, boardRoles, identityHelp };
