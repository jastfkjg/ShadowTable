(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.shadowtableRecordClearing = factory();
})(typeof window === "undefined" ? this : window, function () {
  const scope = "清除个人对局记录、战绩、积分及明细、趣味统计，并重新计算排行榜、月报和月榜徽章。";
  const retained = "同桌玩家的记录与共享对局过程仍保留。已发放的永久徽章、回避卡及累计奖励进度保留。";
  const timing = "按北京时间的对局结束月份清理，积分调整按发生月份清理。清除后无法自行恢复，之后的新对局继续正常累计。";
  function monthLabel(month) { return month ? Number(month.slice(0, 4)) + " 年 " + Number(month.slice(5)) + " 月" : ""; }
  const impacts = [
    { id: "records", icon: "/assets/record-list.svg", tone: "blue", title: "对局记录与战绩", description: "移除记录，重新计算胜率与角色统计" },
    { id: "fun", icon: "/assets/record-spark.svg", tone: "purple", title: "趣味记录与月榜荣誉", description: "移除趣味统计，更新月榜徽章资格" },
    { id: "points", icon: "/assets/record-coin.svg", tone: "gold", title: "积分、排名与月报", description: "清除该月积分，重新计算相关榜单" },
  ];
  const sheetLines = [
    { icon: "/assets/record-list.svg", text: "个人对局、复盘入口及角色战绩" },
    { icon: "/assets/record-spark.svg", text: "趣味统计、积分、排名与月报" },
    { icon: "/assets/record-medal.svg", text: "月榜徽章按清理后的资格更新" },
  ];
  const rules = timing + "\n" + scope + "\n" + retained;
  function present(preview, currentMonth) {
    if (!preview) return null;
    const s = preview.summary;
    const isCurrent = preview.month === currentMonth;
    return { ...preview, label: monthLabel(preview.month), shortLabel: Number(preview.month.slice(5)) + " 月", isCurrent,
      caption: s.funGames + " 场趣味记录 · " + s.scoredGames + " 场计分对局 · " + s.adjustments + " 条调整",
      metrics: [
        { id: "records", value: s.records, label: "对局记录" },
        { id: "valid", value: s.validGames, label: "有效战绩", accent: true },
        { id: "points", value: s.points, label: isCurrent ? "本月积分" : "该月积分", unit: "分", negative: s.points < 0 },
      ].map(row => ({ ...row, compact: String(row.value).length > 6 })), rows: [
      { label: "个人对局记录", value: s.records + " 条" },
      { label: "其中有效战绩", value: s.validGames + " 场" },
      { label: "有趣味事件的对局", value: s.funGames + " 场" },
      { label: "计分对局", value: s.scoredGames + " 场" },
      { label: "积分调整", value: s.adjustments + " 条" },
      { label: "该月积分合计", value: s.points + " 分" },
    ], canClear: s.records > 0 || s.adjustments > 0 };
  }
  function confirmation(preview) {
    return "将清除你在 " + monthLabel(preview.month) + " 的 " + preview.summary.records + " 条对局记录及 " + preview.summary.adjustments + " 条积分调整。\n" + scope + "\n" + retained + "\n清除后无法自行恢复。";
  }
  return { scope, retained, timing, rules, impacts, sheetLines, monthLabel, present, confirmation };
});
