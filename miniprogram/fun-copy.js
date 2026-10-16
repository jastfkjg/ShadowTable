// Shared display copy for the mini-program, browser and archived projections.
(function (root, factory) {
  const copy = factory();
  if (typeof module === "object" && module.exports) module.exports = copy;
  else root.shadowtableFunCopy = copy;
})(typeof window === "object" ? window : this, function () {
  const labels = {
    survival_revive: "复活", survival_knifed: "被刀",
    honor_mvp: "胜方最佳", honor_svp: "败方最佳",
    percival_green: "三蓝并保护梅林", percival_bust: "三红或梅林被刺",
    merlin_evade: "成功躲刀", merlin_hit: "被刺中",
    good_shield: "成功挡刀",
    assassin_hit: "刺中梅林", assassin_miss: "刺错梅林",
    defense_ally: "保护友方", defense_enemy: "保护对方",
    kill_enemy: "击杀对方", kill_ally: "击杀友方",
    knife_enemy: "刀中敌方", knife_ally: "刀中友方",
    duel_enemy: "决斗敌方", duel_ally: "决斗友方",
  };
  const titles = { survival: "生存趣事", honor: "本场最佳", percival: "派西维尔", knife: "刀客刀法", duel: "骑士", defense: "防御技能", kill: "击杀技能" };
  const honors = {
    survival_revive: { title: "我在阿瓦隆玩重生", description: "十二骑士中实际复活的次数，包含刀、决斗、猎人、魔术师换号、女巫替死及铠甲等导致的复活", countOnly: true },
    survival_knifed: { title: "全民公敌", description: "十二骑士中承受轮内刀和最终刀的次数，按换号及替死后的实际承受者统计；无论是否生效或复活都计入，不含枪和决斗", countOnly: true },
    honor_mvp: { title: "最强 MVP", description: "获得胜方最佳玩家的次数", countOnly: true },
    honor_svp: { title: "最强 SVP", description: "获得败方最佳玩家的次数", countOnly: true },
    percival_green: { title: "最强派西", description: "派西玩家带3蓝车并保护梅林次数最多" },
    percival_bust: { title: "竭尽全力", description: "派西玩家带3红车或梅林被刺次数最多" },
    merlin_evade: { title: "闪身步大神", description: "梅林玩家成功躲刀次数最多" },
    merlin_hit: { title: "舍我其谁", description: "梅林玩家被刺中次数最多" },
    good_shield: { title: "金牌替身", description: "终局时存活的非梅林好人被最终刀选中的次数最多，包含派西维尔" },
    assassin_hit: { title: "职业刺客", description: "刺客玩家刺中梅林次数最多" },
    assassin_miss: { title: "背锅侠", description: "刺客玩家刺错梅林次数最多" },
    defense_ally: { title: "绝对防御", description: "玩家有防御技能（适用于守卫、魔术师）并保护友方阵营次数最多" },
    defense_enemy: { title: "卧龙凤雏", description: "玩家有防御技能（适用于守卫、魔术师）并保护对方阵营次数最多" },
    kill_enemy: { title: "职业杀手", description: "玩家有击杀技能并击杀对方阵营次数最多" },
    kill_ally: { title: "痛击队友", description: "玩家有击杀技能并击杀友方阵营次数最多" },
  };
  const identities = { survival: "十二骑士全体玩家", honor: "玩家票选",
    percival: "派西维尔", merlin: "梅林", good: "非梅林好人", assassin: "刺客",
    defense: "蓝守卫／魔术师", kill: "刀客／骑士／猎人等",
  };
  const conditions = {
    survival_revive: "因各种原因实际复活的次数", survival_knifed: "被刀次数，无论是否生效或复活",
    honor_mvp: "获得胜方最佳玩家的次数", honor_svp: "获得败方最佳玩家的次数",
    percival_green: "三蓝且梅林未被刺的局数", percival_bust: "三红或梅林被刺的局数",
    merlin_evade: "成功躲过最终刺杀的次数", merlin_hit: "最终被刺中的次数",
    good_shield: "作为非梅林好人，最终刀落到本人身上的次数",
    assassin_hit: "最终刺中梅林的次数", assassin_miss: "最终刺杀未命中梅林的次数",
    defense_ally: "成功保护友方的次数", defense_enemy: "成功保护对方的次数",
    kill_enemy: "成功击杀对方的次数", kill_ally: "成功击杀友方的次数",
  };
  const killIdentities = "蓝刀客·加雷斯、蓝刀客·加赫雷斯、红刀客·奥伯伦、蓝兰斯洛特、红兰斯洛特、刺客、觉醒蓝刀客、觉醒红刀客、蓝骑士、红骑士、蓝猎人、红猎人";
  for (const [id, honor] of Object.entries(honors)) {
    honor.roleLabel = identities[id.split("_")[0]];
    honor.roleDetail = id.startsWith("kill_") ? killIdentities : honor.roleLabel;
    honor.conditionLabel = conditions[id];
  }
  const descriptions = {
    survival: "复活按实际回场计数；被刀包含轮内刀和最终刀，按换号、替死后的承受者统计，无论是否生效或复活。",
    assassin: "仅统计刺客的非空最终刺杀。",
  };
  function metric(row) {
    const id = row.id || row.key?.replace(/^fun_/, "");
    const title = row.key && honors[id] ? honors[id].title : titles[id?.split("_")[0]];
    return { ...row, ...(labels[id] ? { label: labels[id],
      ...(row.rankLabel !== undefined ? { rankLabel: labels[id] } : {}) } : {}),
      ...(row.title !== undefined && title ? { title } : {}),
      ...(honors[id] ? { countOnly: !!honors[id].countOnly, honorTitle: honors[id].title, description: honors[id].description,
        roleLabel: honors[id].roleLabel, roleDetail: honors[id].roleDetail, conditionLabel: honors[id].conditionLabel } : {}) };
  }
  function legacyLabel(label, type) {
    if (label === "三绿达成") return labels.percival_green;
    if (label === "三炸收场") return labels.percival_bust;
    if (label === "命中敌方") return labels[type + "_enemy"] || label;
    if (["命中同伴", "命中友方"].includes(label)) return labels[type + "_ally"] || label;
    return label;
  }
  function summary(value) {
    if (!value) return value;
    const cards = value.cards.filter(card => !card.id.endsWith(":final")).map(card => ({ ...card,
      title: titles[card.id.split(":").pop()] || card.title,
      ...(descriptions[card.id.split(":").pop()] ? { description: descriptions[card.id.split(":").pop()] } : {}),
      metrics: card.metrics.map(metric) }));
    const teaserType = value.teaser?.startsWith("刀客刀法") ? "knife"
      : value.teaser?.startsWith("骑士") ? "duel" : "percival";
    let teaser = value.teaser?.replace(/三绿达成|三炸收场|命中敌方|命中同伴|命中友方/g,
      label => legacyLabel(label, teaserType)).replace(/骑士决斗/g, "骑士");
    if (/^(最终带刀|十二骑士最终刺杀)\s*·/.test(teaser || "")) {
      const highlight = cards.flatMap(card => card.metrics
        .filter(row => (row.positive ?? row.ranked) && row.count > 0)
        .map(row => ({ ...row, title: card.title }))).sort((a, b) => b.count - a.count)[0];
      teaser = highlight ? `${highlight.title} · ${highlight.label} ${highlight.count} ${highlight.unit}` : "";
    }
    return { ...value,
      ...(value.teaser !== undefined ? { teaser } : {}),
      ...(value.metrics ? { metrics: value.metrics.filter(row => !row.id.startsWith("final_")).map(metric) } : {}),
      cards };
  }
  function story(value) {
    if (!value) return value;
    const types = [...new Set((value.metrics || []).map(row => row.id.split("_")[0])
      .filter(type => ["knife", "gun", "duel"].includes(type)))];
    return { ...value,
      hasEffectiveHighlights: (value.highlights || []).some(row =>
        row.count > 0 && !row.id.endsWith("_failed") && !row.id.endsWith("_aim_enemy")),
      ...(value.metrics ? { metrics: value.metrics.map(metric) } : {}),
      ...(value.highlights ? { highlights: value.highlights.map(metric) } : {}),
      ...(value.events ? { events: value.events.map(event => ({ ...event,
        label: legacyLabel(event.label, event.kind || event.type || (types.length === 1 ? types[0] : "")),
        ...(typeof event.detail === "string" ? { detail: event.detail.replace(/(\d+号)非梅林好人/g, "$1") } : {}) })) } : {}) };
  }
  function leaderboard(value) {
    const id = value.metric?.replace(/^fun_/, "");
    return { ...value,
      ...(value.availableFunMetrics ? { availableFunMetrics: value.availableFunMetrics.map(metric) } : {}),
      ...(value.fun && honors[id] ? {
        title: honors[id].title, description: honors[id].description,
        roleLabel: honors[id].roleLabel, roleDetail: honors[id].roleDetail, conditionLabel: honors[id].conditionLabel,
        countOnly: !!honors[id].countOnly,
        metricLabel: id.startsWith("honor_") ? "获奖次数" : (labels[id] || value.metricLabel?.replace(/次数$|率$/, "")) + (value.sort === "rate" ? "率" : "次数"),
      } : value.fun && labels[id] ? {
        title: titles[id.split("_")[0]] || value.title,
        metricLabel: labels[id] + (value.sort === "rate" ? "率" : "次数"),
      } : {}) };
  }
  function response(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const result = leaderboard(value);
    if (value.fun && typeof value.fun === "object") result.fun = value.fun.cards ? summary(value.fun) : story(value.fun);
    if (value.myFun) result.myFun = story(value.myFun);
    for (const key of ["records", "recent"])
      if (Array.isArray(value[key])) result[key] = value[key].map(record => record.fun
        ? { ...record, fun: story(record.fun) } : record);
    return result;
  }
  return { labels, titles, honors, metric, summary, story, leaderboard, response };
});
