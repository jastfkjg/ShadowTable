(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.shadowtableAvoidance = factory();
})(typeof window !== "undefined" ? window : this, function () {
  const factionNames = { good: "好人阵营", evil: "坏人阵营", third: "第三方阵营" };
  const factionIcons = { good: "/assets/record-shield-good.svg", evil: "/assets/faction-mask-evil.svg" };
  function needsCardTotal(room) {
    const card = room.me?.avoidance;
    return room.phase === "lobby" && room.me?.seat != null && card && card.totalBalance == null;
  }
  async function roomWithCardTotal(room, request) {
    // Older room summaries only count avoidance cards. The private card sheet
    // includes factionBalance on every server that supports faction cards.
    try {
      const detail = await request("/api/rooms/" + room.code + "/avoidance");
      if (detail.code === room.code && detail.stage === room.stage && detail.phase === "lobby" && Number.isSafeInteger(detail.balance)) {
        const totalBalance = detail.balance + (detail.factionBalance ?? 0);
        return { ...room, me: { ...room.me, avoidance: { ...room.me.avoidance, balance: detail.balance, totalBalance } } };
      }
    } catch (_) { /* The table stays usable and the next poll retries the count. */ }
    return room;
  }
  function groups(options, selected) {
    return ["good", "evil", "third"].map(faction => ({ faction,
      label: factionNames[faction],
      entries: options.filter(o => o.faction === faction).map(o => ({ ...o, selected: o.id === selected, countLabel: o.count > 1 ? "×" + o.count : "" })),
    })).filter(g => g.entries.length);
  }
  function panel(value, tab, draft) {
    if (!tab) {
      const preferFaction = value.factionBalance !== undefined && (value.factionBalance > 0 || !value.balance);
      tab = value.selectedFaction || (!value.selected && preferFaction) ? "faction" : "avoidance";
    }
    const faction = tab === "faction";
    const selected = faction ? value.selectedFaction : value.selected;
    const id = draft ?? selected ?? "";
    const roleGroups = groups(value.options, faction ? "" : id);
    const factions = roleGroups.map(group => ({ id: group.faction, name: factionNames[group.faction].replace("阵营", ""), icon: factionIcons[group.faction] || "" }));
    const group = roleGroups.find(g => g.faction === id);
    const examples = faction && group ? group.entries.slice(0, 2) : [];
    const priorRole = value.options.find(o => o.id === value.selected);
    const replaces = faction && priorRole ? "回避" + priorRole.name : !faction && value.selectedFaction ? factionNames[value.selectedFaction] : "";
    return {
      avoidance: { ...value, tab, factions, examples, replaces, exampleText: examples.length ? group.label + "包含" + examples.map(o => o.name).join("、") + (group.entries.length > examples.length ? "等角色" : "") : "" },
      avoidanceGroups: roleGroups, avoidanceDraft: id,
      avoidanceDraftName: faction ? factionNames[id] || "" : value.options.find(o => o.id === id)?.name || "",
    };
  }
  function choose(value, id) {
    if (!value?.editable) return null;
    const faction = value.tab === "faction";
    if ((faction ? value.factionBalance : value.balance) < 1 || !value.options.some(o => (faction ? o.faction : o.id) === id)) return null;
    return panel(value, value.tab, id);
  }
  function result(value) {
    if (!value) return null;
    const effective = value.status === "effective";
    const spent = (value.refunded ? "本局不计战绩，已退还 1 张" : "已消耗 1 张") + (value.faction ? "阵营卡" : "回避卡");
    if (value.faction) return { ...value, effective,
      title: effective ? "已分到" + factionNames[value.faction] : "本局阵营卡未生效",
      detail: effective ? spent : value.status === "unavailable" ? "发牌时阵营卡不足，本次未扣卡" : "未分到所选阵营，本次未扣卡",
    };
    return { ...value, effective,
      title: effective ? "已回避「" + value.roleName + "」" : "本局回避未生效",
      detail: effective ? spent : value.status === "unavailable" ? "发牌时回避卡不足，本次未扣卡" : "需保留完整角色配置，本次未扣卡",
    };
  }
  function grantCopy(value) {
    const kind = value.notice?.kind;
    const reasons = Array.isArray(value.notice?.reasons) ? value.notice.reasons.filter(reason => typeof reason === "string").map(reason => reason.trim()).filter(Boolean) : [];
    const factionAmount = value.notice?.factionAmount || 0;
    if (factionAmount) {
      const avoidanceAmount = value.notice.amount - factionAmount;
      const summary = "阵营卡 ×" + factionAmount + (avoidanceAmount ? "、回避卡 ×" + avoidanceAmount : "");
      return { title: avoidanceAmount ? "收到本局用卡" : "收到阵营卡", lead: [summary, ...new Set(reasons)].join("\n\n"),
        content: "入座后点「用卡」选择初始阵营或回避角色。每局限用 1 张，生效才扣卡。" };
    }
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
  return { needsCardTotal, roomWithCardTotal, groups, panel, choose, result, grantCopy, grantMessage, createGrantNotifier };
});
