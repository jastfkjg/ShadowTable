(function (root, factory) {
  const value = factory(
    typeof module === "object" && module.exports ? require("./fun-copy") : root.shadowtableFunCopy,
    typeof module === "object" && module.exports ? require("./badges") : root.shadowtableBadges,
  );
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyReport = value;
})(typeof window === "object" ? window : this, function (funCopy, badges) {
  const badgeById = new Map(badges.catalogue.map(b => [b.id, b]));
  const pad = n => String(n).padStart(2, "0");
  function monthAt(time = Date.now()) {
    const date = new Date(time + 28800000);
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1);
  }
  function monthRange(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) throw new Error("月份无效");
    const [year, value] = month.split("-").map(Number);
    return { start: Date.UTC(year, value - 1, 1) - 28800000, end: Date.UTC(year, value, 1) - 28800000 };
  }
  function displayTime(time) {
    const date = new Date(time + 28800000);
    return date.getUTCFullYear() + "." + pad(date.getUTCMonth() + 1) + "." + pad(date.getUTCDate()) + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
  }
  function presentBoard(board) {
    const roleRecord = funCopy.roleRecords[board.metric], honor = roleRecord || funCopy.honors[board.metric];
    const label = roleRecord?.title || board.label;
    const rankingSubtitle = funCopy.currentTitleScope(board.rankingSubtitle || board.subtitle);
    const countUnit = board.sort === "rate" ? (/^percival_/.test(board.metric) ? "局" : "次") : board.unit;
    const rows = board.rows.map(row => {
      const value = board.countOnly ? row.count : board.sort ? board.sort === "rate" ? row.rate : row.count : board.id === "points" ? row.points : board.id === "games" ? row.total : row.winRate;
      return { ...row, rankLabel: pad(row.rank), initial: Array.from(row.nickname || "友")[0], value: String(value), valueCompact: String(value).length > 6,
        secondaryLabel: board.id === "points" ? row.scoredGames + " 场计分局"
          : board.sort === "rate" ? label + " " + row.count + " " + countUnit + " · " + row.opportunities + " 次机会"
          : board.countOnly || board.sort === "count" ? ""
          : row.wins + " 胜 / " + row.total + " 局" };
    });
    const icon = board.id === "points" ? "crown" : board.metric?.includes("shield") || board.metric?.startsWith("defense_") || board.id === "good" ? "shield" : board.metric?.includes("assassin") ? "moon" : "sword";
    return { ...board, ...(roleRecord ? { label, description: roleRecord.description } : {}),
      ...(honor ? { title: honor.title, roleLabel: honor.roleLabel, roleDetail: honor.roleDetail, conditionLabel: honor.conditionLabel } : {}),
      iconPath: "/assets/monthly-" + icon + ".svg", rankingSubtitle,
      subtitle: board.id === "points" ? "本月积分" : honor ? honor.roleLabel + " · " + rankingSubtitle : board.subtitle, rows };
  }
  function presentReport(report, assetUrl = path => path) {
    const mainBoards = report.mainBoards.map(presentBoard), funBoards = report.funBoards.map(presentBoard);
    const featured = report.featuredIds.map(id => funBoards.find(board => board.id === id)).filter(board => board?.rows.length);
    const range = monthRange(report.month);
    const spotlights = (report.spotlights || []).map(presentBoard);
    const roleBoards = [], pendingTitles = [], pendingAppearances = [], selected = new Set();
    const byId = new Map(funBoards.map(board => [board.id, board]));
    for (const role of report.roleTitles || []) {
      const earned = byId.get(role.boardId);
      if (earned?.rows.length) {
        roleBoards.push(earned);
        selected.add(earned.id);
      } else {
        if (role.appearance?.rows.length) roleBoards.push(presentBoard(role.appearance));
        if (role.signature) {
          const badge = badgeById.get(role.signature);
          pendingTitles.push({ role: role.role, title: role.title, condition: role.condition,
            badge: badge ? badges.badgeImageUrl(badge, assetUrl) : "" });
        } else if (!role.appearance?.rows.length) pendingAppearances.push(role.role);
      }
    }
    const remaining = { funBoards: funBoards.filter(board => !selected.has(board.id)) };
    const groups = [
      { title: "综合榜单", boards: mainBoards },
      { title: "玩家票选", boards: spotlights.filter(board => board.group === "玩家票选") },
      { title: "角色与牌桌高光", boards: spotlights.filter(board => board.group === "角色与牌桌高光") },
      { title: "本月角色称号", boards: roleBoards },
      { title: "趣味荣誉", boards: detailBoards(remaining) },
      { title: "娱乐榜", boards: detailBoards(remaining, "count", true) },
    ].map(group => ({ ...group, boards: group.boards.filter(board => board.rows.length) })).filter(group => group.boards.length);
    return { ...report, mainBoards, funBoards, spotlights, groups, pendingTitles, pendingAppearances: pendingAppearances.join("、"),
      featured, coreBoards: mainBoards.slice(0, 2).filter(board => board.rows.length), extraBoards: mainBoards.slice(2).filter(board => board.rows.length),
      hasFunBoards: funBoards.some(board => board.rows.length), hasDetails: mainBoards.slice(2).some(board => board.rows.length) || funBoards.some(board => board.rows.length),
      monthLabel: report.month.replace("-", " 年 ") + " 月", monthTitle: report.month.replace("-", "."),
      statusLabel: report.status === "preview" ? "本月实时预览" : "完整月报",
      rangeLabel: displayTime(range.start).slice(0, 10) + "—" + displayTime(range.end - 1).slice(0, 10),
      asOfLabel: displayTime(report.asOf), versionLabel: "V" + report.version,
      canShare: report.overview.games > 0,
      rules: ["按北京时间自然月和对局结束时间统计。概览包含所有有效参赛记录，榜单仅展示已公开的微信、开发账号。",
        ...(report.minPlayers ? ["月报榜单只统计 " + report.minPlayers + " 人及以上的有效对局。"] : []),
        "活跃天数按有有效对局结算的自然日去重；同一对局和同一玩家分别去重统计。",
        "积分含本月有效计分局及本月积分调整，至少一场计分局才参与。总胜率和阵营胜率荣誉均至少 10 局。",
        ...(report.roleTitles ? ["各角色优先展示当月已达成的专属称号。没有专属称号上榜时，角色常驻王按公开有效对局的结算身份统计出场局数，展示第一名及全部并列。"] : []),
        "趣味称号和娱乐称号在当月至少达成一次时上榜。角色称号按已知达成局数排名。缺失记录不计入，比例榜至少需要 5 次有效机会。",
        "MVP、SVP 按实际获奖局数排名。双面骑士按达成局数，十二骑士的复活和被刀按实际次数。月内最长连胜仅统计本月符合榜单条件的对局，至少两连胜。",
        "金牌替身适用于终局时存活的非梅林好人，包含派西维尔；最终刀落到本人时计一次，空刀不形成挡刀机会。",
        "绝对防御、卧龙凤雏适用于蓝守卫、魔术师。守卫实际挡下伤害、魔术师换号使原攻击目标实际避开伤害时计一次，按该目标在技能发生时的阵营区分友方与对方。",
        "职业杀手、痛击队友适用身份：" + funCopy.honors.kill_enemy.roleDetail + "。只统计刀、枪、决斗造成的实际出局，最终刺杀单独统计。",
        "同分、同次数并列；比例按未舍入值比较，同率时样本更多者优先。前三名次的所有并列玩家都会保留。",
        "本月为实时预览；月份结束后查看完整月报。更正结果、积分、记录状态或公开资料后重新查看，内容有变化时版本递增。已发送的图片不会同步更新。"] };
  }
  function detailBoards(report, sort = "count", entertainment = false) {
    return report.funBoards.filter(board => board.rows.length && board.sort === sort && (entertainment ? !board.positive : board.positive));
  }
  return { monthAt, monthRange, displayTime, presentBoard, presentReport, detailBoards };
});
