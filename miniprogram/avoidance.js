(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.shadowtableAvoidance = factory();
})(typeof window !== "undefined" ? window : this, function () {
  function groups(options, selected) {
    return ["good", "evil", "third"].map(faction => ({ faction,
      label: ({ good: "好人阵营", evil: "坏人阵营", third: "第三阵营" })[faction],
      entries: options.filter(o => o.faction === faction).map(o => ({ ...o, selected: o.id === selected, countLabel: o.count > 1 ? "×" + o.count : "" })),
    })).filter(g => g.entries.length);
  }
  function result(value) {
    if (!value) return null;
    const effective = value.status === "effective";
    return { ...value, effective,
      title: effective ? "已回避「" + value.roleName + "」" : "本局回避未生效",
      detail: effective ? "已消耗 1 张回避卡" : value.status === "unavailable" ? "发牌时回避卡不足，本次未扣卡" : "需保留完整角色配置，本次未扣卡",
    };
  }
  function wallet(value) {
    return { ...value, history: (value.history || []).map(row => ({ ...row,
      label: ({ welcome: "账号赠送", admin: "管理员发放", spend: "回避生效" })[row.source] || "回避卡变动",
      amountLabel: (row.delta > 0 ? "+" : "") + row.delta,
      dateLabel: new Date(row.created).toLocaleString("zh-CN", { hour12: false }),
    })) };
  }
  function measureSheet(page) {
    if (!page.alive || !page.foreground || !page.data.avoidanceOpen && !page.data.avoidanceWalletOpen || typeof wx === "undefined" || !wx.createSelectorQuery) return;
    const run = () => {
      if (!page.alive || !page.foreground || !page.data.avoidanceOpen && !page.data.avoidanceWalletOpen) return;
      const query = wx.createSelectorQuery();
      for (const selector of [".avoidance-backdrop", ".avoidance-top", ".avoidance-fields", ".avoidance-footer"]) query.select(selector).boundingClientRect();
      query.exec(rects => {
        if (!page.alive || !page.foreground || !page.data.avoidanceOpen && !page.data.avoidanceWalletOpen || !rects || rects.length !== 4 || rects.some(r => !r)) return;
        const [backdrop, top, fields, footer] = rects;
        const clearance = backdrop.width > backdrop.height && backdrop.height <= 500 ? 20 : 72;
        page.setData({ avoidanceBodyHeight: Math.max(1, Math.floor(Math.min(fields.height, backdrop.height - top.height - footer.height - clearance))) });
      });
    };
    if (wx.nextTick) wx.nextTick(run); else run();
  }
  function grantNotice(value, seen) {
    const history = value?.history || [], ids = Array.isArray(seen) ? seen : [];
    const latest = history[0];
    return { message: latest?.delta > 0 && !ids.includes(latest.id) ? "获得回避卡 ×" + latest.delta : "",
      seen: [...new Set([...history.filter(row => row.delta > 0).map(row => row.id), ...ids])].slice(0, 100) };
  }
  return { groups, result, wallet, measureSheet, grantNotice };
});
