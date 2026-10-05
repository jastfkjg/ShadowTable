// Shared display copy for the mini-program, browser and archived projections.
(function (root, factory) {
  const copy = factory();
  if (typeof module === "object" && module.exports) module.exports = copy;
  else root.shadowtableFunCopy = copy;
})(typeof window === "object" ? window : this, function () {
  const labels = {
    percival_green: "三绿车", percival_bust: "三炸车",
    knife_enemy: "刀中敌方", knife_ally: "刀中友方",
    duel_enemy: "决斗敌方", duel_ally: "决斗友方",
  };
  const titles = { percival: "派西维尔", knife: "刀客刀法", duel: "骑士" };
  function metric(row) {
    const id = row.id || row.key?.replace(/^fun_/, "");
    if (!labels[id]) return row;
    return { ...row, label: labels[id],
      ...(row.rankLabel !== undefined ? { rankLabel: labels[id] } : {}),
      ...(row.title !== undefined ? { title: titles[id.split("_")[0]] } : {}) };
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
    const teaserType = value.teaser?.startsWith("刀客刀法") ? "knife"
      : value.teaser?.startsWith("骑士") ? "duel" : "percival";
    const teaser = value.teaser?.replace(/三绿达成|三炸收场|命中敌方|命中同伴|命中友方/g,
      label => legacyLabel(label, teaserType)).replace(/骑士决斗/g, "骑士");
    return { ...value,
      ...(value.teaser !== undefined ? { teaser } : {}),
      ...(value.metrics ? { metrics: value.metrics.map(metric) } : {}),
      cards: value.cards.map(card => ({ ...card,
        title: titles[card.id.split(":").pop()] || card.title,
        metrics: card.metrics.map(metric) })) };
  }
  function story(value) {
    if (!value) return value;
    const types = [...new Set((value.metrics || []).map(row => row.id.split("_")[0])
      .filter(type => ["knife", "gun", "duel"].includes(type)))];
    return { ...value,
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
      ...(value.fun && labels[id] ? {
        title: titles[id.split("_")[0]],
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
  return { labels, titles, metric, summary, story, leaderboard, response };
});
