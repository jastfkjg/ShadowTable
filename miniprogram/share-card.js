// Explicit display projections: only personal summaries and requested public neighbors reach the renderer.
const SIZE = 1080;
const COLORS = { background: "#101c24", surface: "#192c36", text: "#f2eee5", muted: "#b1bfc6", accent: "#e5c68b", border: "#3d515d", good: "#80b4d7", evil: "#d88f91", self: "#30352f" };
const metricNames = { points: "积分榜", games: "局数榜", overall: "总胜率榜", good: "好人胜率榜", evil: "坏人胜率榜" };
const modeNames = { all: "全部玩法", classic: "经典", knights: "十二骑士", other: "扩展玩法" };
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
const number = value => Number.isFinite(value) ? String(value) : "—";
const decimal = value => Number.isFinite(value) ? number(Math.round(value * 10) / 10) : "—";
const percent = value => Number.isFinite(value) ? decimal(value) + "%" : "—";
const stat = (value, label) => ({ value: number(value), label });
function shanghaiTime(time, monthOnly = false) {
  const date = new Date(time + 8 * 3600000), pad = value => String(value).padStart(2, "0");
  const month = date.getUTCFullYear() + "." + pad(date.getUTCMonth() + 1);
  return monthOnly ? month : month + "." + pad(date.getUTCDate()) + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
}
function identity(profile) {
  return { name: clean(profile.nickname) || "新朋友", avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(profile.avatarUrl || "") ? profile.avatarUrl : "" };
}
function describe(card) {
  return [card.name, card.title, card.context, card.scope, card.label, card.hero == null ? "" : card.hero + card.unit, card.rank ? "第 " + card.rank + " 名" : card.rankLabel,
    ...(card.chart ? [card.chart.label + " " + card.chart.value] : []), ...(card.metrics || []).map(item => item.label + " " + item.value), ...(card.notes || []),
    ...(card.sections || []).flatMap(section => [section.title, ...section.metrics.map(item => item.label + " " + item.value)]),
    ...(card.factions || []).map(row => row.label + " " + recordDescription(row)),
    ...(card.roles || []).map(row => row.label + " " + recordDescription(row)),
    ...(card.otherRoles ? ["其他角色 " + recordDescription(card.otherRoles)] : []),
    ...(card.nearby || []).map(row => "第 " + row.rank + " 名 " + row.name + (row.isSelf ? "（我）" : "") + " " + row.value + card.unit), card.gap,
    "截至 " + shanghaiTime(card.asOf)].filter(Boolean).join("，");
}
const recordDescription = row => row.total + " 局，" + row.wins + " 胜 " + row.losses + " 负，胜率 " + row.rate;
function record(row) {
  if (!Number.isInteger(row.total) || !Number.isInteger(row.wins) || row.total < 1 || row.wins < 0 || row.wins > row.total) return null;
  return { total: row.total, wins: row.wins, losses: row.total - row.wins, ratio: row.wins / row.total, rate: percent(row.wins / row.total * 100) };
}
function breakdown(stats) {
  const labels = { good: "好人", evil: "坏人", third: "第三阵营", unknown: "未知阵营" };
  const factions = Object.keys(labels).flatMap(id => {
    const summary = record(stats.byFaction?.find(row => row.faction === id) || {});
    return summary ? [{ id, label: labels[id], ...summary }] : [];
  });
  const grouped = new Map(); let unknown = 0;
  // The same role may have different final factions. Merge its samples before sorting by games.
  for (const row of stats.byRole || []) {
    const summary = record(row), label = clean(row.role);
    if (!summary) continue;
    if (!label || label === "未知角色") { unknown += summary.total; continue; }
    const existing = grouped.get(label) || { label, total: 0, wins: 0 };
    existing.total += summary.total; existing.wins += summary.wins; grouped.set(label, existing);
  }
  const all = [...grouped.values()].sort((a, b) => b.total - a.total || b.wins - a.wins || a.label.localeCompare(b.label));
  const roles = all.slice(0, 4).map(row => ({ label: row.label, ...record(row) }));
  const remaining = all.slice(4).reduce((sum, row) => ({ total: sum.total + row.total, wins: sum.wins + row.wins }), { total: 0, wins: 0 });
  return { factions, roles, otherRoles: record(remaining), notes: unknown ? ["另有 " + unknown + " 局未记录角色"] : [] };
}
function statsCard(profile, stats, now) {
  if (!stats.total) throw new Error("还没有有效战绩，完成对局后再来分享。");
  return { kind: "stats", ...identity(profile), context: "阿瓦隆战绩 · 全部时间", scope: "",
    hero: decimal(stats.winRate), unit: "%", label: "总胜率",
    summary: { total: stats.total, wins: stats.wins, losses: stats.losses ?? stats.total - stats.wins },
    metrics: [stat(stats.total, "有效局数"), stat(stats.wins, "胜场"), stat(stats.losses ?? stats.total - stats.wins, "负场")],
    ...breakdown(stats), asOf: now };
}
function canShareFun(fun) {
  return !!fun?.cards?.some(group => group.metrics.some(row => !row.id.endsWith("aim_enemy") && Number.isFinite(row.value) && row.knownGames > 0));
}
function knifeMetrics(group) {
  const row = id => group.metrics.find(metric => metric.id === "knife_" + id);
  const known = metric => metric && Number.isFinite(metric.value) && metric.knownGames > 0;
  const enemy = row("enemy");
  return [
    { label: "出刀次数", value: known(enemy) ? number(enemy.opportunities) : "—", color: "accent" },
    { label: "未刀中次数", value: known(row("failed")) ? number(row("failed").count) : "—", color: "muted" },
    { label: "刀中敌方次数", value: known(enemy) ? number(enemy.count) : "—", color: "good" },
    { label: "刀中友方次数", value: known(row("ally")) ? number(row("ally").count) : "—", color: "evil" },
  ];
}
function funCard(profile, stats, cardId, metricId, now) {
  const group = stats.fun?.cards?.find(card => card.id === cardId);
  const metric = group?.metrics?.find(row => row.id === metricId && row.ranked);
  if (!metric || metric.value == null || !metric.knownGames) throw new Error("这项成绩还没有完整记录，暂时无法生成图片。");
  if (cardId.endsWith(":knife")) return { kind: "combat", ...identity(profile), context: "趣味成绩", scope: "", title: "刀客刀法", metrics: knifeMetrics(group), notes: [], asOf: now };
  return { kind: "fun", ...identity(profile), context: "趣味成绩", scope: metricId === "good_shield" ? "" : clean(group.title),
    hero: number(metric.count), unit: clean(metric.unit), label: clean(metric.label),
    chart: { ratio: metric.opportunities ? metric.count / metric.opportunities : null, value: percent(metric.rate), label: "成功率" },
    metrics: [stat(metric.opportunities, "有效机会"), stat(metric.knownGames, "有记录局数")],
    notes: !metric.opportunities ? ["暂无有效机会，成功率暂不计算"] : [], asOf: now };
}
function funSummaryCard(profile, stats, now) {
  if (!canShareFun(stats.fun)) throw new Error("还没有完整的趣味记录，完成相关对局后再来分享。");
  const groups = new Map();
  for (const group of stats.fun.cards) {
    const key = group.id.split(":").pop();
    const combined = groups.get(key) || { title: key === "knife" ? "刀客刀法" : key === "shield" ? "成功挡刀" : clean(group.title), metrics: new Map() };
    for (const metric of group.metrics) {
      if (metric.id.endsWith("aim_enemy")) continue;
      const item = combined.metrics.get(metric.id) || { id: metric.id, label: clean(metric.label), unit: clean(metric.unit), ranked: metric.ranked, count: 0, opportunities: 0, knownGames: 0, value: null };
      if (Number.isFinite(metric.value) && metric.knownGames > 0) {
        item.count += metric.count; item.opportunities += metric.opportunities; item.knownGames += metric.knownGames; item.value = item.count;
      }
      combined.metrics.set(metric.id, item);
    }
    groups.set(key, combined);
  }
  const sections = [...groups.entries()].filter(([, group]) => [...group.metrics.values()].some(row => row.knownGames > 0)).map(([key, group]) => {
    const rows = [...group.metrics.values()], primary = rows.find(row => row.ranked && row.knownGames > 0);
    return { title: group.title,
      metrics: key === "knife" ? knifeMetrics({metrics: rows}) : rows.map(row => ({label: row.label + (row.unit === "局" ? "局数" : "次数"), value: row.value == null ? "—" : number(row.count), color: /_(ally|hit|bust|miss|loss)$/.test(row.id) ? "evil" : row.id.endsWith("failed") ? "muted" : "good"})),
      caption: key !== "knife" && primary?.opportunities ? "成功率 " + percent(primary.count / primary.opportunities * 100) + " · " + number(primary.opportunities) + " 次机会" : "",
    };
  });
  return { kind: "funSummary", ...identity(profile), context: "完整趣味记录", scope: "", sections, metrics: [], notes: [], asOf: now };
}
function boardSelection(board) {
  return { kind: "leaderboard", metric: board.metric, period: board.period,
    ...(board.fun ? { mode: board.mode || "all", sort: board.sort || "count", ...(board.role ? { role: board.role } : {}) } : {}) };
}
function queryString(values) {
  return Object.entries(values).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
}
function parseSelection(options) {
  // Mini-program onLoad may retain the URI encoding from navigateTo.
  // Decode once before validating, and keep rejecting malformed/double-encoded IDs.
  let card = options.card;
  if (typeof card === "string") {
    try { card = decodeURIComponent(card); }
    catch { throw new Error("分享内容无效，请返回原页面重新生成。"); }
  }
  if (options.kind === "stats") return { kind: "stats" };
  if (options.kind === "funSummary") return { kind: "funSummary" };
  if (options.kind === "fun" && /^(classic|knights|other):[a-z]+$/.test(card || "") && /^[a-z_]+$/.test(options.metric || ""))
    return { kind: "fun", card, metric: options.metric };
  if (options.kind !== "leaderboard" || !["all", "month"].includes(options.period) ||
    !(hasOwn(metricNames, options.metric) || /^fun_[a-z_]+$/.test(options.metric || ""))) throw new Error("分享内容无效，请返回原页面重新生成。");
  const selection = { kind: "leaderboard", metric: options.metric, period: options.period };
  if (options.metric.startsWith("fun_")) {
    if (!hasOwn(modeNames, options.mode || "all") || !["count", "rate"].includes(options.sort || "count") || options.role && !/^[A-Za-z]{1,32}$/.test(options.role))
      throw new Error("榜单筛选无效，请返回排行榜重新生成。");
    Object.assign(selection, { mode: options.mode || "all", sort: options.sort || "count", ...(options.role ? { role: options.role } : {}) });
  }
  return selection;
}
function canShareLeaderboard(board) {
  const me = board?.me;
  if (!me) return false;
  return board.fun ? me.knownGames > 0 && (board.sort !== "rate" || me.opportunities > 0 && Number.isFinite(me.rate))
    : me.total > 0 || board.metric === "points" && Number.isFinite(me.points) && me.points !== 0;
}
function leaderboardShareError(board) {
  if (canShareLeaderboard(board)) return "";
  if (board?.fun && board.sort === "rate" && board.me?.knownGames > 0)
    return "暂无有效机会，可切换次数榜分享成绩。";
  return "当前榜单暂无本人成绩，完成相关对局后再来分享。";
}
function nearbyProjection(profile, board, rank) {
  const rows = board.nearby;
  const value = row => board.fun ? board.sort === "rate" ? row.rate : row.count : board.metric === "points" ? row.points : board.metric === "games" ? row.total : row.winRate;
  if (!rank || !Array.isArray(rows) || !rows.length || rows.length > 5 || rows.filter(row => row.isSelf === true).length !== 1 ||
    rows.some(row => !Number.isInteger(row.rank) || row.rank < 1 || !Number.isFinite(value(row)))) return { nearby: [], gap: "" };
  const index = rows.findIndex(row => row.isSelf === true), own = rows[index];
  if (own.rank !== rank || value(own) !== value(board.me)) return { nearby: [], gap: "" };
  const previous = rows[index - 1], count = board.fun ? board.sort === "count" : board.metric === "points" || board.metric === "games";
  const distance = previous && previous.rank < rank && count ? value(previous) - value(own) : 0;
  const unit = board.fun ? clean(board.unit) : board.metric === "points" ? "分" : "局";
  return { nearby: rows.map(row => ({ rank: row.rank, name: row.isSelf ? identity(profile).name : clean(row.nickname) || "新朋友", avatar: identity(row.isSelf ? profile : row).avatar, value: decimal(value(row)), isSelf: row.isSelf === true })),
    gap: distance > 0 ? "距上一位 " + decimal(distance) + " " + unit : "" };
}
function leaderboardCard(profile, board) {
  const error = leaderboardShareError(board);
  if (error) throw new Error(error);
  const me = board.me, points = board.metric === "points", games = board.metric === "games";
  const period = board.period === "month" ? shanghaiTime(board.periodStart, true).replace(".", " 年 ") + " 月" : "";
  const title = board.fun ? clean(board.metricLabel) + "榜" : metricNames[board.metric];
  const role = board.roleOptions?.find(row => row.id === board.role)?.label;
  const rank = me.status === "ranked" && me.rank > 0 ? me.rank : null;
  const rankLabel = rank ? "" : me.status === "hidden" ? "未公开" : me.status === "unsupported" ? "未参榜" : "未上榜";
  const notes = [];
  if (me.status === "hidden") notes.push("未公开排行榜 · 仅分享本人成绩");
  else if (me.status === "unsupported") notes.push("当前账号不参与排行榜");
  else if (!rank) notes.push("尚未达到上榜条件" + (me.remaining > 0 ? " · 还差 " + number(me.remaining) + (board.fun ? board.sort === "rate" ? " 次有效机会" : " 次" : " 局") : ""));
  if (board.fun && board.sort === "rate") notes.push("上榜需至少 " + number(board.threshold) + " 次有效机会");
  return { kind: "rank", ...identity(profile), title, context: period,
    scope: board.fun ? [board.metric === "fun_good_shield" ? "" : clean(board.title), board.mode && board.mode !== "all" ? modeNames[board.mode] : "", clean(role)].filter(Boolean).join(" · ") : "",
    hero: board.fun ? board.sort === "rate" ? decimal(me.rate) : number(me.count) : points ? number(me.points) : games ? number(me.total) : decimal(me.winRate),
    unit: board.fun ? clean(board.unit) : points ? "分" : games ? "局" : "%",
    label: board.fun ? clean(board.metricLabel) : points ? "我的积分" : games ? "有效局数" : title.replace(/榜$/, ""),
    rank, rankLabel, ...nearbyProjection(profile, board, rank),
    nearbyLabel: board.fun ? board.sort === "rate" ? "成功率" : "次数" : points ? "积分" : games ? "局数" : "胜率",
    metrics: board.fun ? [board.sort === "rate" ? stat(me.count, "成功次数") : { value: percent(me.rate), label: "成功率" }, stat(me.opportunities, "有效机会"), stat(me.knownGames, "有记录局数")]
      : points ? [stat(me.total, "计分局数"), stat(me.wins, "计分局胜场"), { value: percent(me.winRate), label: "计分局胜率" }]
      : games ? [stat(me.wins, "胜场"), stat(me.losses ?? me.total - me.wins, "负场"), { value: percent(me.winRate), label: "总胜率" }]
      : [stat(me.total, "有效局数"), stat(me.wins, "胜场"), stat(me.losses ?? me.total - me.wins, "负场")],
    notes, asOf: board.updatedAt };
}
function layout(card) {
  const heroTop = card.kind === "rank" ? (card.context || card.scope ? 332 : 292) : card.scope ? 284 : 232;
  if (card.kind === "stats") {
    let cursor = 508;
    const factionsTop = cursor;
    if (card.factions.length) cursor += 152 + card.factions.length * 184;
    const rolesTop = cursor;
    if (card.roles.length) cursor += 160 + card.roles.length * 96 + (card.otherRoles ? 56 : 0);
    const notesTop = cursor + 20;
    const footerTop = cursor + card.notes.length * 42 + 24;
    return { heroTop, factionsTop, rolesTop, notesTop, footerTop, height: footerTop + 100 };
  }
  if (card.kind === "combat") {
    const footerTop = heroTop + 500;
    return { heroTop, metricsTop: heroTop + 72, footerTop, height: footerTop + 100 };
  }
  if (card.kind === "funSummary") {
    let cursor = 232;
    const sectionTops = card.sections.map(section => { const top = cursor; cursor += 100 + Math.ceil(section.metrics.length / 2) * 164 + (section.caption ? 56 : 0) + 40; return top; });
    return { heroTop, sectionTops, footerTop: cursor, height: cursor + 100 };
  }
  if (card.kind === "rank") {
    const nearbyTop = heroTop + 258 + (card.gap ? 56 : 0);
    const metricsTop = nearbyTop + (card.nearby.length ? 132 + card.nearby.length * 96 : 0);
    const notesTop = metricsTop + 178, footerTop = notesTop + card.notes.length * 42 + 24;
    return { heroTop, nearbyTop, metricsTop, notesTop, footerTop, height: footerTop + 100 };
  }
  const metricsTop = heroTop + 234, notesTop = metricsTop + 180;
  const footerTop = notesTop + card.notes.length * 42 + 24;
  return { heroTop, metricsTop, notesTop, footerTop, height: footerTop + 100 };
}
const dimensions = card => ({ width: SIZE, height: layout(card).height });

// Same renderer runs on a native Canvas 2D node and in visual verification.
function drawCard(ctx, card, avatar, nearbyAvatars = new Map()) {
  const box = layout(card), { heroTop, footerTop, height } = box;
  const font = (size, weight = 400) => { ctx.font = weight + " " + size + "px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"; };
  const text = (value, x, y, size, color = COLORS.text, width = 936, align = "left", weight = 400) => {
    const original = Array.from(clean(value)), chars = original.slice();
    ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.fillStyle = color; font(size, weight);
    while (chars.length && ctx.measureText(chars.join("") + (chars.length < original.length ? "…" : "")).width > width) chars.pop();
    ctx.fillText(chars.join("") + (chars.length < original.length ? "…" : ""), x, y);
  };
  const fit = (value, maximum, width, minimum = 28) => {
    let size = maximum;
    for (; size > minimum; size -= 2) { font(size, 600); if (ctx.measureText(clean(value)).width <= width) break; }
    return size;
  };
  const line = (x1, y1, x2, y2, color = COLORS.border, width = 1) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  const rect = (x, y, width, height, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, width, height); };
  const bar = (x, y, width, ratio, color) => {
    rect(x, y, width, 12, COLORS.surface);
    if (Number.isFinite(ratio) && ratio > 0) rect(x, y, width * Math.min(1, ratio), 12, color);
  };
  const largeValue = (value, unit, x, y, width, size = 176, unitSize = 54, color = COLORS.accent) => {
    font(unitSize); const unitWidth = ctx.measureText(unit).width;
    const maximum = width - unitWidth - 12, fitted = fit(value, size, maximum, 48);
    font(fitted, 600); const mainWidth = Math.min(maximum, ctx.measureText(clean(value)).width);
    text(value, x, y, fitted, color, maximum, "left", 600);
    text(unit, x + mainWidth + 12, y - 4, unitSize, color, unitWidth + 2, "left", 500);
  };
  const emblem = (x, y, type, color, size = 42) => {
    const r = size / 2;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
    if (type === "shield") {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y - r * .55); ctx.lineTo(x + r * .8, y + r * .4);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r * .8, y + r * .4); ctx.lineTo(x - r, y - r * .55); ctx.closePath();
    } else if (type === "blade") {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * .25, y - r * .6); ctx.lineTo(x + r * .25, y + r * .35);
      ctx.lineTo(x - r * .25, y + r * .35); ctx.lineTo(x - r * .25, y - r * .6); ctx.closePath();
      ctx.moveTo(x - r * .6, y + r * .35); ctx.lineTo(x + r * .6, y + r * .35); ctx.moveTo(x, y + r * .35); ctx.lineTo(x, y + r);
    } else if (type === "mask") {
      ctx.moveTo(x - r, y - r); ctx.lineTo(x - r * .65, y - r * .15); ctx.lineTo(x, y + r);
      ctx.lineTo(x + r * .65, y - r * .15); ctx.lineTo(x + r, y - r);
      ctx.moveTo(x - r * .65, y - r * .15); ctx.lineTo(x + r * .65, y - r * .15);
    } else {
      for (let i = 0; i < 8; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / 4, length = i % 2 ? r * .36 : r;
        const px = x + Math.cos(angle) * length, py = y + Math.sin(angle) * length;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    }
    ctx.stroke();
  };
  const strip = top => {
    line(72, top, 1008, top);
    const column = 936 / card.metrics.length;
    card.metrics.forEach((item, index) => {
      const x = 72 + column * (index + .5);
      text(item.value, x, top + 68, fit(item.value, 56, column - 40), COLORS.text, column - 36, "center", 600);
      text(item.label, x, top + 116, 34, COLORS.muted, column - 36, "center");
      if (index) line(72 + column * index, top + 32, 72 + column * index, top + 120);
    });
  };
  const metricGrid = (metrics, top, cellHeight = 164) => {
    metrics.forEach((item, index) => {
      const col = index % 2, row = Math.floor(index / 2), x = 72 + col * 496, y = top + row * cellHeight;
      text(item.value, x, y + 84, fit(item.value, 96, 440, 48), COLORS[item.color] || COLORS.text, 440, "left", 600);
      text(item.label, x, y + 134, fit(item.label, 34, 440), COLORS.muted, 440);
    });
  };
  rect(0, 0, SIZE, height, COLORS.background);
  ctx.strokeStyle = COLORS.border; ctx.lineWidth = 1; ctx.strokeRect(24, 24, SIZE - 48, height - 48);
  line(24, 24, 116, 24, COLORS.accent, 3); line(24, 24, 24, 90, COLORS.accent, 3);
  line(SIZE - 116, height - 24, SIZE - 24, height - 24, COLORS.accent, 3);
  const ranked = card.kind === "rank";
  if (ranked) {
    text(card.title, 72, 112, fit(card.title, 64, 936, 40), COLORS.accent, 936, "left", 600);
    const context = [card.context, card.scope].filter(Boolean).join(" · ");
    if (context) text(context, 72, 170, 32, COLORS.muted);
  }
  const avatarX = ranked ? 108 : 124, avatarY = ranked ? heroTop - 94 : 112, radius = ranked ? 36 : 52;
  ctx.save(); ctx.beginPath(); ctx.arc(avatarX, avatarY, radius, 0, Math.PI * 2); ctx.clip();
  rect(avatarX - radius, avatarY - radius, radius * 2, radius * 2, COLORS.surface);
  if (avatar) {
    const side = Math.min(avatar.width, avatar.height);
    ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, avatarX - radius, avatarY - radius, radius * 2, radius * 2);
  } else text(Array.from(card.name)[0], avatarX, avatarY + (ranked ? 14 : 20), ranked ? 40 : 54, COLORS.accent, radius * 2 - 10, "center", 600);
  ctx.restore();
  if (ranked) {
    text(card.name, 168, heroTop - 78, 44, COLORS.text, 840, "left", 500);
    line(72, heroTop - 32, 1008, heroTop - 32);
  } else {
    text(card.name, 202, 110, 54, COLORS.text, 806, "left", 600);
    text(card.context, 202, 159, 32, COLORS.muted, 806);
    line(72, 196, 1008, 196);
    if (card.scope) text(card.scope, 72, 250, fit(card.scope, 34, 936), COLORS.muted);
  }

  if (card.kind === "stats") {
    text("总胜率", 72, heroTop + 32, 42, COLORS.text, 580, "left", 500);
    largeValue(card.hero, card.unit, 66, heroTop + 184, 590);
    line(680, heroTop + 44, 680, heroTop + 190);
    largeValue(number(card.summary.total), "局", 732, heroTop + 110, 276, 84, 40, COLORS.text);
    const result = card.summary.wins + " 胜 · " + card.summary.losses + " 负";
    text(result, 732, heroTop + 178, fit(result, 38, 276), COLORS.muted, 276);
    if (card.factions.length) {
      const top = box.factionsTop;
      line(72, top, 1008, top);
      text("阵营表现", 72, top + 64, 42, COLORS.text, 440, "left", 600);
      card.factions.forEach((row, index) => {
        const y = top + 104 + index * 184, color = COLORS[row.id] || COLORS.accent;
        emblem(98, y + 36, row.id === "good" ? "shield" : row.id === "evil" ? "mask" : "star", color, 42);
        text(row.label, 140, y + 50, 40, COLORS.text, 400, "left", 500);
        const result = row.wins + " 胜 · " + row.losses + " 负";
        text(result, 140, y + 100, fit(result, 34, 500), COLORS.muted, 500);
        text(row.rate, 1008, y + 76, fit(row.rate, 78, 300), color, 300, "right", 600);
        bar(140, y + 128, 868, row.ratio, color);
      });
    }
    if (card.roles.length) {
      const top = box.rolesTop;
      line(72, top, 1008, top);
      text("常玩角色", 72, top + 56, 42, COLORS.text, 440, "left", 600);
      text(card.otherRoles ? "按局数 · 前 4 位" : "按局数", 1008, top + 54, 30, COLORS.muted, 350, "right");
      text("角色", 72, top + 112, 30, COLORS.muted, 250);
      text("战绩", 512, top + 112, 30, COLORS.muted, 240, "center");
      text("胜率", 690, top + 112, 30, COLORS.muted, 250);
      line(72, top + 132, 1008, top + 132);
      card.roles.forEach((row, index) => {
        const y = top + 132 + index * 96;
        const type = ({ "梅林": "star", "派西维尔": "shield", "刺客": "blade", "莫甘娜": "mask" })[row.label] || "star";
        emblem(98, y + 42, type, COLORS.accent, 36);
        text(row.label, 136, y + 54, fit(row.label, 38, 250), COLORS.text, 250, "left", 500);
        const record = row.wins + " 胜 · " + row.losses + " 负";
        text(record, 512, y + 54, fit(record, 34, 234), COLORS.muted, 234, "center");
        bar(690, y + 36, 184, row.ratio, COLORS.accent);
        text(row.rate, 1008, y + 54, fit(row.rate, 36, 118), COLORS.text, 118, "right", 500);
        line(72, y + 96, 1008, y + 96);
      });
      if (card.otherRoles) text("其他角色：" + card.otherRoles.total + " 局 · " + card.otherRoles.wins + " 胜 · " + card.otherRoles.losses + " 负", 72, top + 132 + card.roles.length * 96 + 54, 32, COLORS.muted);
    }
  } else if (card.kind === "combat") {
    text(card.title, 72, heroTop + 40, 48, COLORS.text, 936, "left", 600);
    metricGrid(card.metrics, box.metricsTop, 192);
  } else if (card.kind === "funSummary") {
    card.sections.forEach((section, index) => {
      const top = box.sectionTops[index];
      if (index) line(72, top - 12, 1008, top - 12);
      text(section.title, 72, top + 48, 46, COLORS.text, 936, "left", 600);
      metricGrid(section.metrics, top + 72);
      if (section.caption) text(section.caption, 72, top + 96 + Math.ceil(section.metrics.length / 2) * 164, 32, COLORS.muted);
    });
  } else if (card.kind === "rank") {
    text(card.rank ? "我的排名" : "排名状态", 72, heroTop + 32, 42, COLORS.text, 506, "left", 500);
    const rank = card.rank ? "第 " + card.rank + " 名" : card.rankLabel;
    text(rank, 66, heroTop + 180, fit(rank, 138, 522, 48), card.rank ? COLORS.accent : COLORS.muted, 522, "left", 600);
    line(620, heroTop + 38, 620, heroTop + 182);
    text(card.label, 670, heroTop + 32, fit(card.label, 40, 338), COLORS.text, 338, "left", 500);
    largeValue(card.hero, card.unit, 668, heroTop + 175, 340, 128, 44);
    if (card.gap) text(card.gap, 72, heroTop + 238, 36, COLORS.accent);
    if (card.nearby.length) {
      const top = box.nearbyTop;
      line(72, top, 1008, top);
      text("名次 / 玩家", 72, top + 56, 30, COLORS.muted, 500);
      text(card.nearbyLabel, 1008, top + 56, 30, COLORS.muted, 300, "right");
      card.nearby.forEach((row, index) => {
        const y = top + 76 + index * 96, color = row.isSelf ? COLORS.accent : COLORS.text;
        if (row.isSelf) { rect(72, y, 936, 96, COLORS.self); rect(72, y, 5, 96, COLORS.accent); }
        else line(72, y, 1008, y);
        text(row.rank, 126, y + 63, fit(row.rank, 44, 96), color, 96, "center", 600);
        const rowAvatar = row.avatar && (row.avatar === card.avatar ? avatar : nearbyAvatars.get(row.avatar));
        if (rowAvatar) {
          ctx.save(); ctx.beginPath(); ctx.arc(234, y + 48, 32, 0, Math.PI * 2); ctx.clip();
          const side = Math.min(rowAvatar.width, rowAvatar.height);
          ctx.drawImage(rowAvatar, (rowAvatar.width - side) / 2, (rowAvatar.height - side) / 2, side, side, 202, y + 16, 64, 64);
          ctx.restore();
        } else text(Array.from(row.name)[0], 234, y + 61, 34, color, 56, "center");
        ctx.beginPath(); ctx.arc(234, y + 48, 32, 0, Math.PI * 2); ctx.strokeStyle = row.isSelf ? COLORS.accent : COLORS.border; ctx.lineWidth = 2; ctx.stroke();
        text(row.name, 292, y + 63, 40, color, row.isSelf ? 354 : 438, "left", row.isSelf ? 600 : 400);
        if (row.isSelf) {
          font(40, 600); const nameWidth = Math.min(354, ctx.measureText(clean(row.name)).width);
          text("我", 292 + nameWidth + 44, y + 62, 30, COLORS.accent, 48, "center", 500);
        }
        const value = row.value + (card.unit === "%" ? "%" : "");
        text(value, 982, y + 63, fit(value, 44, 230), color, 230, "right", row.isSelf ? 600 : 500);
      });
    }
    strip(box.metricsTop);
  } else {
    text(card.label, 72, heroTop + 32, 44, COLORS.text, 624, "left", 500);
    largeValue(card.hero, card.unit, 66, heroTop + 195, 636, 192, 60);
    const cx = 856, cy = heroTop + 104;
    ctx.lineWidth = 9; ctx.strokeStyle = COLORS.border; ctx.beginPath(); ctx.arc(cx, cy, 106, 0, Math.PI * 2); ctx.stroke();
    if (Number.isFinite(card.chart.ratio) && card.chart.ratio > 0) {
      ctx.strokeStyle = COLORS.accent; ctx.lineCap = "round"; ctx.beginPath();
      ctx.arc(cx, cy, 106, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, card.chart.ratio)); ctx.stroke(); ctx.lineCap = "butt";
    }
    text(card.chart.value, cx, cy + 8, fit(card.chart.value, 64, 172), COLORS.text, 184, "center", 600);
    text(card.chart.label, cx, cy + 57, 30, COLORS.muted, 184, "center");
    strip(box.metricsTop);
  }
  card.notes.forEach((note, index) => text(note, 72, box.notesTop + index * 42, 30, COLORS.muted));
  line(72, footerTop, 1008, footerTop);
  text("桌边助手", 72, footerTop + 57, 30, COLORS.muted, 220, "left", 500);
  text("截至 " + shanghaiTime(card.asOf), 1008, footerTop + 57, 28, COLORS.muted, 680, "right");
}
module.exports = { SIZE, COLORS, statsCard, funCard, funSummaryCard, canShareFun, leaderboardCard, canShareLeaderboard, leaderboardShareError, boardSelection, parseSelection, queryString, describe, drawCard, dimensions, shanghaiTime };
