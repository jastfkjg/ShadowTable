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
  function grantMessage(value) {
    return "当前可用 " + value.balance + " 张。\n\n入座后可在发牌前选择想避开的角色，生效才扣卡。";
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
        const confirmed = await options.show({ title: "收到回避卡", content: grantMessage(value), amount: value.notice.amount });
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
  return { groups, result, grantMessage, createGrantNotifier };
});
