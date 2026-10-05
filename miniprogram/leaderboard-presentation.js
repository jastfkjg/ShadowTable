// Shared display metadata. Ranking and eligibility remain server-authoritative.
(function (root, factory) {
  const presentation = factory();
  if (typeof module === "object" && module.exports) module.exports = presentation;
  else root.shadowtableLeaderboard = presentation;
})(typeof window === "object" ? window : this, function () {
  const categories = [{ id: "good", label: "好人" }, { id: "evil", label: "坏人" }, { id: "more", label: "更多" }];
  function funOptions(definitions = [], { includeFinal = false } = {}) {
    const first = ["fun_good_shield", "fun_merlin_evade", "fun_percival_green", "fun_merlin_hit", "fun_percival_bust"];
    return definitions.filter(item => includeFinal || item.key !== "fun_final_hit").map(item => {
      const title = item.key === "fun_good_shield" ? "好人" : item.title;
      const category = /^fun_(good_shield|merlin_|percival_)/.test(item.key) ? "good"
        : /^fun_assassin_/.test(item.key) ? "evil" : "more";
      return { ...item, title, category, tabLabel: title + " · " + item.label };
    }).sort((a, b) => (first.includes(a.key) ? first.indexOf(a.key) : first.length) - (first.includes(b.key) ? first.indexOf(b.key) : first.length));
  }
  function markTies(rows = []) {
    const ranks = new Map();
    rows.forEach(row => ranks.set(row.rank, (ranks.get(row.rank) || 0) + 1));
    return rows.map(row => ({ ...row, tied: !!row.tied || ranks.get(row.rank) > 1 }));
  }
  const percent = n => Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, "") : "—";
  function presentBoard(board) {
    if (!board) return null;
    const options = funOptions(board.availableFunMetrics, { includeFinal: true }), selected = options.find(item => item.key === board.metric);
    const games = board.metric === "games", points = board.metric === "points";
    const metricLabel = board.fun ? board.metricLabel : ({ points: "积分", games: "局数", overall: "总胜率", good: "好人胜率", evil: "坏人胜率" })[board.metric];
    const rateLabel = board.rateLabel || selected?.rateLabel || "成功率";
    const countUnit = selected?.unit || (board.unit === "%" ? "次" : board.unit) || "次";
    const rateThreshold = selected?.rateThreshold || (board.sort === "rate" ? board.threshold : 0);
    const describe = row => {
      const value = board.fun ? !row.knownGames ? "—" : board.sort === "count" ? String(row.count) : Number.isFinite(row.rate) ? row.rate.toFixed(1) : "—"
        : points ? String(row.points || 0) : games ? String(row.total || 0) : Number.isFinite(row.winRate) ? row.winRate.toFixed(1) : "—";
      const unit = value === "—" ? "" : board.fun ? board.sort === "count" ? countUnit : "%" : points ? "分" : games ? "局" : "%";
      const sampleLabel = board.fun ? !row.knownGames ? "暂无完整样本" : (rateLabel === "发生率" ? "发生 " : "成功 ") + row.count + " " + countUnit + " · 共 " + row.opportunities + " 次机会" : "";
      return { ...row, value, unit, sampleLabel, valueCompact: value.length > 6, secondaryLabel: board.fun ? sampleLabel : points ? (row.total || 0) + " 场计分局"
        : games ? (row.wins || 0) + " 胜 · 胜率 " + percent(row.winRate) + (Number.isFinite(row.winRate) ? "%" : "") : (row.wins || 0) + " 胜 · " + (row.total || 0) + " 局" };
    };
    const me = describe(board.me || {});
    const statusLabel = me.rank ? "第 " + me.rank + " 名" : me.status === "hidden" ? "未公开" : me.status === "unsupported" ? "暂不参与排名"
      : me.status === "not_enough" ? "还差 " + me.remaining + (board.fun && board.sort === "rate" ? " 次机会" : board.fun ? " " + countUnit : " 局") + "上榜"
      : me.status === "no_records" ? "尚无完整记录" : me.status === "no_games" ? "暂无有效对局" : "未上榜";
    const ruleLines = [board.period === "month" ? "本月按北京时间统计，从每月 1 日零点起计算。" : "全部榜统计历史有效记录。"];
    if (board.fun) {
      ruleLines.push("次数榜按对应记录排名；" + rateLabel + "榜按有效机会统计。",
        "次数相同则并列；比例按未舍入值排序，相同比例时机会数多者优先，两者相同则并列。",
        board.metric === "fun_good_shield" ? "挡刀率 = 挡刀次数 / 面对最终非空刀的有效机会数。空刀单列，缺失记录不按零次计算。" : "只统计已完整记录的对应机会；缺失记录不按零次计算。");
    } else {
      ruleLines.push(points ? "积分包含有效计分局成绩和积分调整；至少有 1 场有效计分局才参与排名。积分相同则并列。"
        : games ? "只统计已登记胜负的有效对局；有效局数相同则并列。"
        : "至少有 1 场当前统计范围内的有效对局才参与排名。按未舍入胜率排序，胜率相同时局数多者优先，两者相同则并列。",
        "未登记胜负或已终止的对局不计入榜单。");
    }
    ruleLines.push("仅展示已开启公开展示的玩家。榜单最多展示前 " + (board.maxRows || 100) + " 位玩家，我的排名仍按全部上榜玩家计算。");
    const rows = markTies(board.rows).map(describe), count = board.eligibleCount ?? rows.length;
    const endLabel = count > rows.length ? "已展示前 " + rows.length + " 位 · 共 " + count + " 位玩家上榜" : "已展示全部 " + count + " 位上榜玩家";
    return { ...board, rows, metricLabel, rateLabel, valueHeading: games ? "有效局数" : metricLabel,
      currentFunOption: selected || null, rateThreshold, ruleLines, endLabel,
      emptyTitle: "暂无公开排名", emptyHint: board.fun ? (board.sort === "rate" ? "有有效机会且已公开的玩家将出现在这里。" : "有对应记录且已公开的玩家将出现在这里。") : "完成有效对局并开启公开展示后，即可参与排名。",
      me: { ...me, statusLabel, placeLabel: me.rank ? "第 " + me.rank + " 名" : me.status === "hidden" ? "未公开" : "未上榜" } };
  }
  return { categories, funOptions, markTies, presentBoard };
});
