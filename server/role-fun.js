"use strict";

const lancelots = ["blueLancelot", "redLancelot"];
const oberons = ["oberon", "redSwordsman"];

function questMembers(room, team, faction, defaulted) {
  return room.players.filter(player => team.includes(player.seat)).map(player => {
    const { uid, seat } = player;
    const role = room.roles[uid];
    return { seat, role, faction: faction(room, uid),
      ...(lancelots.includes(role) || oberons.includes(role) ? {
        playedFailure: !defaulted.includes(uid) && room.submissions[uid] === "fail",
      } : {}),
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
    if (quest.members || !Array.isArray(quest.team)) return quest;
    const replay = quest.cards ? quest : replayByNumber.get(Number(quest.id?.split(":")[1]));
    if (replay?.cards?.length === quest.team.length && replay.team?.every((seat, i) => seat === quest.team[i])) {
      return { ...quest, members: replay.cards.map(({ actor, value }) => ({
        seat: actor?.seat, role: actor?.roleId, faction: actor?.faction,
        // Older replays did not distinguish submitted cards from defaults on early close.
        playedFailure: !replay.earlyClosed && value != null ? value === "fail" : undefined,
      })) };
    }
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

module.exports = { questMembers, questFacts, projectRoleRecords };
