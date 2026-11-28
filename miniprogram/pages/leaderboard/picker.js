(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("../../leaderboard-presentation"), require("../../badges"));
  else root.shadowtableRankPicker = factory(root.shadowtableLeaderboard, root.shadowtableBadges);
})(typeof window === "object" ? window : this, function (ranks, badges) {
  const modes = [{ id: "metrics", label: "趣味指标" }, { id: "badges", label: "徽章查询" }];
  const badgeCategories = [{ id: "all", label: "全部" }, { id: "monthly", label: "月度" }, { id: "permanent", label: "永久" }];
  const featured = ["success_courier", "sabotage_courier", "five_wins", "ten_wins", "hundred_wins", "role_collector"];
  function badgeOptions(ids, assetUrl) {
    const options = ids.map(id => badges.presentPlayerBadge({ id }, assetUrl)).filter(Boolean);
    const priority = b => featured.includes(b.id) ? featured.indexOf(b.id) : featured.length + (b.achievement ? 0 : 1);
    return options.sort((a, b) => priority(a) - priority(b)).map(b => {
      const roleLabel = b.permanent ? "永久" : "月度", conditionLabel = badges.badgeCriteria(b).detailCondition;
      return { key: b.id, title: b.title, roleLabel, conditionLabel, imageUrl: b.imageUrl,
        category: b.permanent ? "permanent" : "monthly", holdersOnly: !!(b.permanent || b.metric === "monthlyGoal"),
        accessibilityLabel: [b.title, roleLabel, conditionLabel].join("，") };
    });
  }
  function create({ options, metric, request, assetUrl, update }) {
    const draft = key => ({ key, category: "all", query: "" });
    const drafts = { metrics: draft(metric), badges: draft("") };
    let mode = "metrics", catalogue = null, loading = false, error = "";
    function view() {
      const badgeMode = mode === "badges", choices = badgeMode ? catalogue || [] : options;
      const d = drafts[mode], term = d.query.trim().toLowerCase();
      const matches = ranks.filterFunOptions(choices, d.category).filter(item =>
        !term || [item.title, ...(badgeMode ? [] : [item.roleLabel, item.label])].some(s => s && s.toLowerCase().includes(term)));
      // Keep an explicitly chosen metric when browsing other categories. An active
      // search always confirms a visible match, and an empty list has no action.
      const candidates = term || badgeMode ? matches : choices;
      const selected = matches.length ? candidates.find(item => item.key === d.key) || matches[0] : null;
      const unit = badgeMode ? " 枚徽章" : " 项指标";
      return { pickerMode: mode, pickerModes: modes, pickerQuery: d.query, funCategory: d.category,
        funCategories: badgeMode ? badgeCategories : ranks.categories, filteredFunOptions: matches,
        pendingFunOption: selected, pendingFunMetric: selected?.key || "",
        pickerCount: "共 " + choices.length + unit + (term || d.category !== "all" ? " · 匹配 " + matches.length + (badgeMode ? " 枚" : " 项") : ""),
        pickerPlaceholder: badgeMode ? "搜索徽章名称" : "搜索称号或角色",
        pickerAction: badgeMode && selected?.holdersOnly ? "查看获得者" : "查看榜单",
        pickerLoading: badgeMode && loading, pickerError: badgeMode ? error : "" };
    }
    const publish = (resetScroll = true) => update(view(), resetScroll);
    async function loadBadges() {
      if (loading || catalogue || mode !== "badges") return;
      loading = true; error = ""; publish();
      try {
        const result = await request("/api/leaderboard/badges");
        catalogue = badgeOptions(result.ids, assetUrl);
        drafts.badges.key = catalogue[0]?.key || "";
      } catch (e) { error = e.message || "徽章读取失败"; }
      finally { loading = false; if (mode === "badges") publish(); }
    }
    return {
      view, loadBadges,
      switchMode(id) {
        if (mode === id || !modes.some(item => item.id === id)) return;
        mode = id;
        if (mode === "badges" && !catalogue && !loading) return loadBadges();
        publish();
      },
      category(id) {
        if (!view().funCategories.some(item => item.id === id)) return;
        drafts[mode].category = id; publish();
      },
      search(query) { drafts[mode].query = query; publish(); },
      select(key) {
        if (!view().filteredFunOptions.some(item => item.key === key)) return;
        drafts[mode].key = key; publish(false);
      },
    };
  }
  return { create };
});
