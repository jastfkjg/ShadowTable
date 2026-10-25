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
  function grantCopy(value) {
    const kind = value.notice?.kind;
    const reasons = Array.isArray(value.notice?.reasons) ? value.notice.reasons.filter(reason => typeof reason === "string").map(reason => reason.trim()).filter(Boolean) : [];
    // Keep combined/migrated grants neutral; the win message describes one card.
    const lead = kind === "loss" ? "加油，下局试试避开不想玩的角色！"
      : kind === "win" && value.notice.amount === 1 ? "累计四场胜利达成，送你一张回避卡！" : [...new Set(reasons)].join("\n\n");
    return { lead, content: "入座后可在发牌前选择想避开的角色，生效才扣卡。" };
  }
  function grantMessage(value) {
    const copy = grantCopy(value);
    return [copy.lead, copy.content].filter(Boolean).join("\n\n");
  }
  function createGrantNotifier(options) {
    let active = false, running = false, timer, epoch = 0, pending = null;
    const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    function schedule() { cancel(timer); if (active) timer = later(check, 10000); }
    async function check() {
      if (!active || running) { schedule(); return; }
      const account = options.account(), turn = epoch;
      const valid = () => active && turn === epoch && account === options.account();
      if (!account || !options.canShow()) { schedule(); return; }
      running = true;
      try {
        if (pending && pending.account !== account) pending = null;
        if (pending) { await options.ack(pending.through); if (valid()) pending = null; }
        if (!valid()) return;
        const value = await options.read();
        if (!valid()) return;
        options.update?.(value);
        if (!value.notice || !options.canShow()) return;
        const confirmed = await options.show(options.present ? options.present(value.notice) : { title: "收到回避卡", ...grantCopy(value), amount: value.notice.amount });
        if (!confirmed || !valid()) return;
        pending = { account, through: value.notice.through };
        await options.ack(pending.through);
        if (valid()) pending = null;
      } catch (_) { /* Keep unread grants and retry quietly when connectivity returns. */ }
      finally { running = false; schedule(); }
    }
    return {
      start() { if (active) return; active = true; epoch++; return check(); },
      stop() { active = false; epoch++; cancel(timer); },
      check,
    };
  }
  return { groups, result, grantCopy, grantMessage, createGrantNotifier };
});
