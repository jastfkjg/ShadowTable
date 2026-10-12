(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyReport = value;
})(typeof window === "object" ? window : this, function () {
  const pad = n => String(n).padStart(2, "0");
  function monthAt(time = Date.now()) {
    const date = new Date(time + 28800000);
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1);
  }
  function monthRange(month) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month || "")) throw new Error("月份无效");
    const [year, value] = month.split("-").map(Number);
    return { start: Date.UTC(year, value - 1, 1) - 28800000, end: Date.UTC(year, value, 1) - 28800000 };
  }
  function displayTime(time) {
    const date = new Date(time + 28800000);
    return date.getUTCFullYear() + "." + pad(date.getUTCMonth() + 1) + "." + pad(date.getUTCDate()) + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
  }
  function presentBoard(board) {
    const countUnit = board.sort === "rate" ? (/^percival_/.test(board.metric) ? "局" : "次") : board.unit;
    const rows = board.rows.map(row => {
      const value = board.sort ? board.sort === "rate" ? row.rate : row.count : board.id === "points" ? row.points : board.id === "games" ? row.total : row.winRate;
      return { ...row, initial: Array.from(row.nickname || "友")[0], value: String(value), valueCompact: String(value).length > 6,
        secondaryLabel: board.sort ? (board.sort === "count" ? board.rateLabel + " " + row.rate + "%" : board.label + " " + row.count + " " + countUnit) + " · " + row.opportunities + " 次机会"
          : board.id === "points" ? row.scoredGames + " 场计分局" + (row.adjustmentPoints ? " · 调整 " + (row.adjustmentPoints > 0 ? "+" : "") + row.adjustmentPoints + " 分" : "")
          : row.wins + " 胜 / " + row.total + " 局" };
    });
    return { ...board, subtitle: board.id === "points" ? "本月积分" : board.subtitle, rows, emptyHint: board.sort === "rate" ? "暂无满足 5 次有效机会的公开玩家" : board.threshold === 10 ? "暂无满足 10 局条件的公开玩家" : "暂无满足条件的公开记录" };
  }
  function presentReport(report) {
    const mainBoards = report.mainBoards.map(presentBoard), funBoards = report.funBoards.map(presentBoard);
    const featured = report.featuredIds.map(id => funBoards.find(board => board.id === id)).filter(Boolean);
    const range = monthRange(report.month);
    return { ...report, mainBoards, funBoards, featured, coreBoards: mainBoards.slice(0, 2), extraBoards: mainBoards.slice(2),
      monthLabel: report.month.replace("-", " 年 ") + " 月", monthTitle: report.month.replace("-", "."),
      statusLabel: report.status === "preview" ? "本月实时预览" : "完整月报",
      rangeLabel: displayTime(range.start).slice(0, 10) + "—" + displayTime(range.end - 1).slice(0, 10),
      asOfLabel: displayTime(report.asOf), versionLabel: "V" + report.version,
      canShare: report.overview.games > 0,
      rules: ["按北京时间自然月和对局结束时间统计。概览包含所有有效参赛记录，榜单仅展示已公开的微信、开发账号。",
        "活跃天数按有有效对局结算的自然日去重；同一对局和同一玩家分别去重统计。",
        "积分含本月有效计分局及本月积分调整，至少一场计分局才参与。总胜率和阵营胜率荣誉均至少 10 局；现有排行榜门槛保持原规则。",
        "趣味次数榜至少一条对应记录，比例榜至少 5 次有效机会；缺失记录不当作零次。",
        "同分、同次数并列；比例按未舍入值比较，同率时样本更多者优先。前三名次的所有并列玩家都会保留。",
        "本月为实时预览；月份结束后查看完整月报。更正结果、积分、记录状态或公开资料后重新查看，内容有变化时版本递增。已发送的图片不会同步更新。"] };
  }
  function detailBoards(report, sort = "count", entertainment = false) {
    return report.funBoards.filter(board => board.sort === sort && (entertainment ? !board.positive : board.positive));
  }
  return { monthAt, monthRange, displayTime, presentBoard, presentReport, detailBoards };
});
