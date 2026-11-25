"use strict";

const lancelots = ["blueLancelot", "redLancelot"];
const oberons = ["oberon", "redSwordsman"];

function questMembers(room, team, faction, defaulted) {
  return room.players.filter(player => team.includes(player.seat)).map(player => {
    const { uid, seat } = player;
    const role = room.roles[uid];
    return { seat, role, faction: faction(room, uid),
      playedFailure: !defaulted.includes(uid) && ["fail", "thiefFail"].includes(room.submissions[uid]),
      playedSuccess: !defaulted.includes(uid) && room.submissions[uid] === "success",
    };
  });
}

function questFacts(record, players) {
  const isQuest = event => event.kind === "quest";
  const saved = (record.funFacts?.events || []).filter(isQuest);
  const replayed = (record.replay?.events || []).filter(isQuest);
  const replayByNumber = new Map(replayed.map(quest => [quest.number ?? quest.round, quest]));
  const bySeat = new Map(players.map(player => [player.seat, player]));
  return (saved.length ? saved : replayed).map(quest => {
    if (!Array.isArray(quest.team)) return quest;
    const replay = quest.cards ? quest : replayByNumber.get(Number(quest.id?.split(":")[1]));
    if (replay?.cards?.length === quest.team.length && replay.team?.every((seat, i) => seat === quest.team[i])) {
      const cards = new Map(replay.cards.map(card => [card.actor?.seat, card]));
      const members = quest.members || quest.team.map(seat => {
        const actor = cards.get(seat)?.actor;
        return { seat, role: actor?.roleId, faction: actor?.faction };
      });
      // Older replays did not distinguish submitted cards from defaults on early close.
      return { ...quest, members: members.map(member => {
        const value = cards.get(member.seat)?.value;
        if (replay.earlyClosed || value == null) return member;
        return { playedFailure: ["fail", "thiefFail"].includes(value), playedSuccess: value === "success", ...member };
      }) };
    }
    if (quest.members) return quest;
    if (/^knights(?:-|$)/.test(record.board)) return quest;
    return { ...quest, members: quest.team.map(seat => {
      const player = bySeat.get(seat);
      const role = player && (record.funFacts?.initialRoles?.[player.uid] || player.roleId);
      return { seat, role, faction: role === "reverse" ? "good" : lancelots.includes(role) ? null : player?.faction };
    }) };
  });
}

function completeQuestLog(record, quests) {
  if (!quests.length || quests.some(quest => !Array.isArray(quest.team) || !quest.team.length || typeof quest.success !== "boolean")) return false;
  const reason = record.funFacts?.terminal?.reason;
  if (reason === "early_assassination") return true;
  const success = quests.filter(quest => quest.success).length;
  const failed = quests.length - success;
  if (reason === "assassination" || record.winner === "good")
    return success === 3 && failed <= 2 && quests.at(-1).success;
  return record.winner === "evil" && failed === 3 && success <= 2 && !quests.at(-1).success;
}

function projectRoleRecords(record, quests, player, initial, add) {
  const terminal = record.funFacts?.terminal;
  const { seat } = player;
  const rides = quests.filter(quest => quest.team?.includes(seat));
  const member = quest => quest.members?.find(entry => entry.seat === seat);
  const complete = completeQuestLog(record, quests);
  const playedAs = (...roles) => roles.find(role => role === initial || role === player.roleId || rides.some(quest => member(quest)?.role === role));
  const rolesKnown = rides.every(quest => member(quest)?.role);

  if (playedAs("reverse")) {
    const first = record.reverseStrike;
    const finalKnown = Number.isInteger(terminal?.target) && typeof first?.hit === "boolean";
    const known = finalKnown || ["quest_fail", "five_rejections"].includes(terminal?.reason);
    add("reverse_guard", "reverse", finalKnown && !first.hit && player.faction === "good" && terminal.target === seat, known,
      "躲过逆仆刀 · 梅林刀落到本人身上");
    add("reverse_recruit", "reverse", finalKnown && first.hit && player.faction === "evil" && terminal.hit && record.winner === "evil", known,
      "转入红方 · 梅林被刺中 · 随红方获胜");
  }

  const lancelot = playedAs(...lancelots);
  if (lancelot) {
    const lance = rides.map(quest => ({ quest, self: member(quest) })).filter(({ self }) => lancelots.includes(self?.role));
    const green = lance.some(({ quest, self }) => quest.success && self.faction === "good");
    const red = lance.some(({ self }) => self.faction === "evil" && self.playedFailure === true);
    const known = complete && rolesKnown && lance.every(({ self }) =>
      self.faction === "good" || self.faction === "evil" && typeof self.playedFailure === "boolean");
    add("lancelot_both", lancelot, green && red, known, "以蓝方身份坐过绿车 · 以红方身份亲手交过失败牌");
  }

  if (playedAs("servant")) {
    const greens = rides.filter(quest => quest.success && member(quest)?.role === "servant");
    add("servant_all_green", "servant", greens.length >= 3, complete && rolesKnown, "三趟成功任务全勤");
    const win = record.winner === "good" && player.faction === "good";
    add("servant_bench_win", "servant", complete && win && !rides.length,
      complete || !win || rides.length > 0, "全局未参加任务 · 随蓝方获胜");
  }

  if (playedAs("morgana")) {
    const together = rides.filter(quest => member(quest)?.role === "morgana" && quest.members.some(entry => entry.role === "percival"));
    add("morgana_with_percival", "morgana", together.length >= 2,
      complete && rides.every(quest => quest.members?.every(entry => entry.role)), `与派西维尔同车 ${together.length} 次`);
  }

  if (playedAs("mordred")) {
    const failures = quests.filter(quest => quest.success === false);
    const third = failures.length === 3 && failures[2] === quests.at(-1) ? failures[2] : null;
    const crewKnown = third?.members?.every(entry => ["good", "evil", "third"].includes(entry.faction));
    const threeFailed = record.winner === "evil" && (!terminal || terminal.reason === "quest_fail");
    const achieved = !!(threeFailed && crewKnown && member(third)?.role === "mordred" && member(third).faction === "evil" &&
      third.members.filter(entry => entry.faction === "evil").length === 1);
    add("mordred_last_bust", "mordred", achieved, !threeFailed || complete && (!third || !!crewKnown),
      "第三次任务失败 · 本人是车上唯一红方", /^knights(?:-|$)/.test(record.board) ? third?.round : null);
  }

  const oberon = playedAs(...oberons);
  if (oberon) {
    const ownFailedRides = rides.filter(quest => !quest.success && oberons.includes(member(quest)?.role));
    const busts = ownFailedRides.filter(quest => member(quest).playedFailure === true);
    add("oberon_two_busts", oberon, busts.length >= 2,
      complete && rolesKnown && ownFailedRides.every(quest => typeof member(quest).playedFailure === "boolean"),
      `亲手交失败牌并炸车 ${busts.length} 次`);
  }
}

function questProgress(record, quests) {
  const valid = quests.every(quest => Array.isArray(quest.team) && quest.team.length && typeof quest.success === "boolean");
  const reason = record.funFacts?.terminal?.reason;
  const greens = quests.filter(quest => quest.success).length;
  const reds = quests.length - greens;
  const last = quests.at(-1);
  const stoppedEarly = ["early_assassination", "five_rejections"].includes(reason);
  const thirdGreen = valid && !stoppedEarly && reason !== "quest_fail" && greens === 3 && reds <= 2 && last.success;
  const thirdRed = valid && !stoppedEarly && !["assassination", "final_action"].includes(reason) && reds === 3 && greens <= 2 && !last.success;
  return {
    complete: valid && (thirdGreen || thirdRed || record.funFacts?.questsComplete === true),
    thirdGreen, thirdRed, decider: thirdGreen || thirdRed ? last : null,
  };
}

// A witnessed achievement can be counted even when other quests were played offline.
// Negative results require a complete log and known facts for the relevant rides.
function witnessed(checks, complete) {
  if (checks.includes(true)) return true;
  return complete && checks.every(result => result === false) ? false : undefined;
}

function lancelotConversionCount(record, player, initial, rides) {
  const saved = record.funFacts?.lancelotConversions?.[player.uid];
  if (Number.isInteger(saved)) return { count: saved, complete: true };
  const replay = record.replay;
  if (replay) {
    const count = replay.events.filter(event => event.kind === "conversion" && event.changes?.some(change =>
      change.seat === player.seat && lancelots.includes(change.before?.roleId) &&
      ["good", "evil"].includes(change.before.faction) && ["good", "evil"].includes(change.after?.faction) &&
      change.before.faction !== change.after.faction)).length;
    return { count, complete: replay.complete };
  }
  // On the fixed-role Lancelot board each change in observed faction proves at least one flip.
  if (record.board !== "lancelot" || !lancelots.includes(initial)) return { count: 0, complete: false };
  const sides = [initial === "blueLancelot" ? "good" : "evil", ...rides.map(({ self }) => self?.faction), player.faction]
    .filter(side => side === "good" || side === "evil");
  return { count: sides.filter((side, i) => i > 0 && side !== sides[i - 1]).length, complete: false };
}

function projectQuestTitles(record, quests, player, initial, add) {
  const { seat } = player;
  const roleAt = quest => quest.members?.find(entry => entry.seat === seat);
  const rides = quests.filter(quest => quest.team?.includes(seat)).map(quest => ({ quest, self: roleAt(quest) }));
  const eligible = (...roles) => roles.find(role => role === initial || role === player.roleId || rides.some(({ self }) => self?.role === role));
  const { complete, thirdGreen, thirdRed, decider } = questProgress(record, quests);
  const terminal = record.funFacts?.terminal;
  const terminalKnown = typeof terminal?.hit === "boolean" && Number.isInteger(terminal.target);
  const goodWin = record.winner === "good";
  const evilWin = record.winner === "evil";
  const observedRoles = rides.every(({ self }) => self?.role);
  const apply = (id, role, result, detail, quest) => add(id, role, result === true, result !== undefined, detail,
    /^knights(?:-|$)/.test(record.board) ? quest?.round : null);
  const fullLog = result => complete ? result : undefined;
  const blueMissions = result => thirdGreen ? result : complete || ["quest_fail", "five_rejections", "early_assassination"].includes(terminal?.reason) ? false : undefined;
  const factionKnown = member => ["good", "evil", "third"].includes(member.faction);
  const completeCrew = (quest, known) => quest.members?.length === quest.team.length && quest.members.every(known);

  if (eligible("merlin")) {
    const allMerlin = rides.length === quests.length && rides.every(({ self }) => self?.role === "merlin");
    const last = rides.at(-1);
    apply("merlin_all_rides", "merlin", goodWin && blueMissions(observedRoles ? allMerlin && !(terminal?.hit && terminal.target === seat) : undefined),
      "三趟蓝车 · 每趟任务均上车 · 未被刺中");
    apply("merlin_skip_decider", "merlin", goodWin && fullLog(!!decider && !decider.team.includes(seat)),
      "决胜任务未上车 · 蓝方获胜", decider);
    apply("merlin_bust_exit", "merlin", goodWin && fullLog(observedRoles
      ? last?.self?.role === "merlin" && last.quest.success === false && last.quest !== quests.at(-1) : undefined),
      "最后一趟上车的任务失败 · 之后再未上车 · 蓝方获胜", last?.quest);
  }

  if (eligible("percival")) {
    const streak = role => {
      const aboard = quests.map(quest => quest.members?.some(member => member.role === role) ? true
        : Array.isArray(quest.team) && completeCrew(quest, member => member.role) ? false : undefined);
      return witnessed(aboard.slice(2).map((_, i) => {
        const window = aboard.slice(i, i + 3);
        return window.includes(false) ? false : window.every(value => value === true) ? true : undefined;
      }), complete);
    };
    apply("percival_merlin_streak", "percival", goodWin && streak("merlin"), "连续三趟任务都有梅林上车 · 蓝方获胜");
    apply("percival_morgana_streak", "percival", streak("morgana"), "连续三趟任务都有莫甘娜上车");
    const shot = terminalKnown ? terminal.target === seat && player.roleId === "percival" :
      ["quest_fail", "five_rejections"].includes(terminal?.reason) ? false : undefined;
    apply("percival_assassinated", "percival", goodWin && shot, "最终刺杀落在本人身上 · 蓝方获胜");
  }

  if (eligible("servant")) {
    const asServant = rides.every(({ self }) => self?.role === "servant");
    const busted = rides.some(({ quest }) => quest.success === false);
    apply("servant_green_only", "servant", blueMissions(observedRoles ? rides.length > 0 && asServant && !busted : undefined),
      "只上过成功任务车 · 蓝方完成三蓝");
    apply("servant_all_with_bust", "servant", blueMissions(observedRoles ? rides.length === quests.length && asServant && busted : undefined),
      "全部任务均上车 · 至少一次炸车 · 蓝方完成三蓝");
    apply("servant_bench_three_green", "servant", blueMissions(!rides.length), "全局未上车 · 蓝方完成三蓝");
  }

  if (eligible("reverse")) {
    const strike = record.reverseStrike;
    const result = terminalKnown && typeof strike?.hit === "boolean"
      ? strike.hit && strike.target === seat && player.faction === "evil" && terminal.target > 0 && !terminal.hit
      : ["quest_fail", "five_rejections"].includes(terminal?.reason) ? false : undefined;
    apply("reverse_wrong_side", "reverse", goodWin && result, "被逆仆刀命中转红 · 红方刺杀失手 · 蓝方获胜");
  }

  if (eligible("mordred")) {
    const threeRides = rides.filter(({ self }) => self?.role === "mordred").length >= 3;
    apply("mordred_three_rides", "mordred", threeRides || fullLog(observedRoles ? false : undefined), "至少三趟任务上车");
    apply("mordred_bench_win", "mordred", evilWin && (rides.length ? false : fullLog(true)), "全局未上车 · 红方获胜");
    const onlyDecider = rides.length === 1 && rides[0].quest === decider;
    apply("mordred_decider_only", "mordred", evilWin && fullLog(!!thirdRed && onlyDecider &&
      (rides[0].self?.role ? rides[0].self.role === "mordred" : undefined)), "只上决胜车 · 红方完成三红并获胜", decider);
  }

  if (eligible("morgana")) {
    const threeRides = rides.filter(({ self }) => self?.role === "morgana").length >= 3;
    apply("morgana_three_rides", "morgana", threeRides || fullLog(observedRoles ? false : undefined), "至少三趟任务上车");
    apply("morgana_no_rides", "morgana", rides.length ? false : fullLog(true), "全局未上车");
  }

  if (eligible("assassin")) {
    const results = rides.map(({ quest, self }) => {
      if (quest.fails < 2 || (self?.role && self.role !== "assassin")) return false;
      if (self?.role !== "assassin" || !Number.isInteger(quest.fails)) return undefined;
      if (quest.members.some(member => oberons.includes(member.role))) return true;
      return completeCrew(quest, member => member.role) ? false : undefined;
    });
    apply("assassin_oberon_double", "assassin", witnessed(results, complete), "与奥伯伦同车 · 至少两张失败牌", rides[results.indexOf(true)]?.quest);
  }

  const oberon = eligible(...oberons);
  if (oberon) {
    const solo = rides.map(({ quest, self }) => {
      if (quest.success || self?.playedFailure === false || (self?.role && !oberons.includes(self.role))) return false;
      if (!self?.role || quest.success !== false || !completeCrew(quest, factionKnown)) return undefined;
      return self.faction === "evil" && quest.members.every(member => member.seat === seat || member.faction !== "evil")
        ? self.playedFailure : false;
    });
    const double = rides.map(({ quest, self }) => {
      if (quest.fails < 2 || (self?.role && !oberons.includes(self.role)) || (self?.faction && self.faction !== "evil")) return false;
      if (!self?.role || self.faction !== "evil" || !Number.isInteger(quest.fails)) return undefined;
      if (quest.members.some(member => member.seat !== seat && member.faction === "evil")) return true;
      return completeCrew(quest, factionKnown) ? false : undefined;
    });
    apply("oberon_solo_bust", oberon, witnessed(solo, complete), "车上唯一红方 · 亲手交失败牌并炸车", rides[solo.indexOf(true)]?.quest);
    apply("oberon_bench_win", oberon, evilWin && (rides.length ? false : fullLog(true)), "全局未上车 · 红方获胜");
    apply("oberon_double_bust", oberon, witnessed(double, complete), "与红方队友同车 · 至少两张失败牌", rides[double.indexOf(true)]?.quest);
  }

  const lance = eligible(...lancelots);
  if (lance) {
    const won = player.faction === record.winner;
    const conversions = lancelotConversionCount(record, player, initial || lance, rides);
    const switched = minimum => won && (conversions.count >= minimum || (conversions.complete ? false : undefined));
    apply("lancelot_double_agent", lance, switched(2), "至少两次阵营转换 · 随当前阵营获胜");
    apply("lancelot_switch_win", lance, switched(1), "至少一次阵营转换 · 随当前阵营获胜");
    if (lance === "redLancelot") {
      const greenVotes = rides.map(({ self }) => self?.role && self.faction
        ? self.role === lance && self.faction === "good" && self.playedSuccess : undefined);
      apply("lancelot_red_redemption", lance, goodWin && won && witnessed(greenVotes, complete),
        "转蓝后亲手提交成功牌 · 随蓝方获胜", rides[greenVotes.indexOf(true)]?.quest);
    } else {
      const self = decider && roleAt(decider);
      const result = !decider || !decider.team.includes(seat) ? false : self?.role && self.faction
        ? self.role === lance && self.faction === "evil" && self.playedFailure : undefined;
      apply("lancelot_blue_betrayal", lance, evilWin && won && fullLog(result), "转红后在决胜任务亲手提交失败牌 · 随红方获胜", decider);
    }
  }
}

module.exports = { questMembers, questFacts, projectRoleRecords, projectQuestTitles };
