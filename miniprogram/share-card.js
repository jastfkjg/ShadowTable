// Explicit display projections: never pass whole profiles, matches or events to the renderer.
const SIZE = 1080;
const COLORS = { background: "#101c24", surface: "#192c36", text: "#f2eee5", muted: "#b1bfc6", accent: "#e5c68b", border: "#3d515d" };
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
  return [card.name, card.context, card.scope, card.label, card.hero + card.unit, card.rank ? "第 " + card.rank + " 名" : card.rankLabel,
    ...(card.chart ? [card.chart.label + " " + card.chart.value] : []), ...card.metrics.map(item => item.label + " " + item.value), ...(card.notes || []),
    ...(card.highlight ? [card.highlight.label, card.highlight.value, ...card.highlight.details] : []),
    "截至 " + shanghaiTime(card.asOf)].filter(Boolean).join("，");
}
function personalHighlight(stats) {
  // A role can appear in multiple final factions: combine its real samples before comparing.
  const roles = new Map();
  for (const row of stats.byRole || []) {
    const role = clean(row.role);
    if (!role || role === "未知角色" || !Number.isFinite(row.total) || !Number.isFinite(row.wins) || row.total < 1 || row.wins < 0 || row.wins > row.total) continue;
    const aggregate = roles.get(role) || { role, total: 0, wins: 0 };
    aggregate.total += row.total; aggregate.wins += row.wins; roles.set(role, aggregate);
  }
  const best = [...roles.values()].filter(row => row.total >= 10 && row.wins / row.total >= .5)
    .sort((a, b) => b.wins * a.total - a.wins * b.total || b.total - a.total || a.role.localeCompare(b.role))[0];
  if (best) return { label: "角色亮点", value: best.role, details: [percent(best.wins / best.total * 100) + " 胜率", best.wins + " 胜 / " + best.total + " 局"] };
  if (stats.score?.games && stats.score.best >= 2) return { label: "连胜纪录", value: number(stats.score.best) + " 连胜", details: ["计分局口径", "全部时间"] };
  return null;
}
function statsCard(profile, stats, now) {
  if (!stats.total) throw new Error("还没有有效战绩，完成对局后再来分享。");
  return { kind: "stats", ...identity(profile), context: "阿瓦隆战绩 · 全部时间", scope: "",
    hero: decimal(stats.winRate), unit: "%", label: "总胜率",
    chart: { ratio: stats.wins / stats.total, value: number(stats.wins), label: "胜场" },
    metrics: [stat(stats.total, "有效局数"), stat(stats.wins, "胜场"), stat(stats.losses ?? stats.total - stats.wins, "负场")],
    highlight: personalHighlight(stats), notes: [], asOf: now };
}
function recordNotes(row) {
  return row.unknownGames ? ["另有 " + number(row.unknownGames) + " 局未记录，不计入本项"] : [];
}
function funCard(profile, stats, cardId, metricId, now) {
  const group = stats.fun?.cards?.find(card => card.id === cardId);
  const metric = group?.metrics?.find(row => row.id === metricId && row.ranked);
  if (!metric || metric.value == null || !metric.knownGames) throw new Error("这项成绩还没有完整记录，暂时无法生成图片。");
  return { kind: "fun", ...identity(profile), context: "趣味成绩 · 全部时间", scope: clean(group.modeLabel) + " · " + clean(group.title),
    hero: number(metric.count), unit: clean(metric.unit), label: clean(metric.label),
    chart: { ratio: metric.opportunities ? metric.count / metric.opportunities : null, value: percent(metric.rate), label: "成功率" },
    metrics: [stat(metric.opportunities, "有效机会"), stat(metric.knownGames, "有记录局数")],
    notes: [...(!metric.opportunities ? ["暂无有效机会，成功率暂不计算"] : []), ...recordNotes(metric)], asOf: now };
}
function boardSelection(board) {
  return { kind: "leaderboard", metric: board.metric, period: board.period,
    ...(board.fun ? { mode: board.mode || "all", sort: board.sort || "count", ...(board.role ? { role: board.role } : {}) } : {}) };
}
function queryString(values) {
  return Object.entries(values).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
}
function parseSelection(options) {
  if (options.kind === "stats") return { kind: "stats" };
  if (options.kind === "fun" && /^(classic|knights|other):[a-z]+$/.test(options.card || "") && /^[a-z_]+$/.test(options.metric || ""))
    return { kind: "fun", card: options.card, metric: options.metric };
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
function leaderboardCard(profile, board) {
  if (!canShareLeaderboard(board)) throw new Error("当前范围还没有可分享的本人成绩，完成相关对局后再来。");
  const me = board.me, points = board.metric === "points", games = board.metric === "games";
  const period = board.period === "month" ? shanghaiTime(board.periodStart, true).replace(".", " 年 ") + " 月" : "全部时间";
  const title = board.fun ? clean(board.metricLabel) + "榜" : metricNames[board.metric];
  const role = board.roleOptions?.find(row => row.id === board.role)?.label;
  const rank = me.status === "ranked" && me.rank > 0 ? me.rank : null;
  const rankLabel = rank ? "" : me.status === "hidden" ? "未公开" : me.status === "unsupported" ? "未参榜" : "未上榜";
  const notes = [];
  if (me.status === "hidden") notes.push("未公开排行榜 · 仅分享本人成绩");
  else if (me.status === "unsupported") notes.push("当前账号不参与排行榜");
  else if (!rank) notes.push("尚未达到上榜条件" + (me.remaining > 0 ? " · 还差 " + number(me.remaining) + (board.fun ? " 次" : " 局") : ""));
  if (board.fun && board.sort === "rate") notes.push("上榜需至少 " + number(board.threshold) + " 次有效机会");
  if (board.fun) notes.push(...recordNotes(me));
  return { kind: "rank", ...identity(profile), context: period + " · " + title,
    scope: board.fun ? [clean(board.title), modeNames[board.mode || "all"], clean(role)].filter(Boolean).join(" · ") : "",
    hero: board.fun ? board.sort === "rate" ? decimal(me.rate) : number(me.count) : points ? number(me.points) : games ? number(me.total) : decimal(me.winRate),
    unit: board.fun ? clean(board.unit) : points ? "分" : games ? "局" : "%",
    label: board.fun ? clean(board.metricLabel) : points ? "我的积分" : games ? "有效局数" : title.replace(/榜$/, ""),
    rank, rankLabel,
    metrics: board.fun ? [board.sort === "rate" ? stat(me.count, "成功次数") : { value: percent(me.rate), label: "成功率" }, stat(me.opportunities, "有效机会"), stat(me.knownGames, "有记录局数")]
      : points ? [stat(me.total, "计分局数"), stat(me.wins, "计分局胜场"), { value: percent(me.winRate), label: "计分局胜率" }]
      : games ? [stat(me.wins, "胜场"), stat(me.losses ?? me.total - me.wins, "负场"), { value: percent(me.winRate), label: "总胜率" }]
      : [stat(me.total, "有效局数"), stat(me.wins, "胜场"), stat(me.losses ?? me.total - me.wins, "负场")],
    notes, asOf: board.updatedAt };
}
function layout(card) {
  const heroTop = card.scope ? 302 : 250, metricsTop = heroTop + 234;
  const notesTop = metricsTop + 180, highlightTop = notesTop + (card.notes?.length || 0) * 42;
  const footerTop = highlightTop + (card.highlight ? 156 : 0) + 24;
  return { heroTop, metricsTop, notesTop, highlightTop, footerTop, height: footerTop + 100 };
}
const dimensions = card => ({ width: SIZE, height: layout(card).height });

// Same renderer runs on a native Canvas 2D node and in visual verification.
function drawCard(ctx, card, avatar) {
  const { heroTop, metricsTop, notesTop, highlightTop, footerTop, height } = layout(card);
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
  ctx.fillStyle = COLORS.background; ctx.fillRect(0, 0, SIZE, height);
  ctx.strokeStyle = COLORS.border; ctx.lineWidth = 1; ctx.strokeRect(24, 24, SIZE - 48, height - 48);
  line(24, 24, 116, 24, COLORS.accent, 3); line(24, 24, 24, 90, COLORS.accent, 3);
  line(SIZE - 116, height - 24, SIZE - 24, height - 24, COLORS.accent, 3);
  // Player identity leads the composition.
  ctx.save(); ctx.beginPath(); ctx.arc(124, 112, 52, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = COLORS.surface; ctx.fillRect(72, 60, 104, 104);
  if (avatar) {
    const side = Math.min(avatar.width, avatar.height);
    ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, 72, 60, 104, 104);
  } else text(Array.from(card.name)[0], 124, 132, 54, COLORS.accent, 94, "center", 600);
  ctx.restore();
  text(card.name, 202, 110, 54, COLORS.text, 806, "left", 600);
  text(card.context, 202, 159, 32, COLORS.muted, 806);
  line(72, 196, 1008, 196);
  if (card.scope) text(card.scope, 72, 250, fit(card.scope, 34, 936), COLORS.muted);
  text(card.label, 72, heroTop + 20, 44, COLORS.text, 624, "left", 500);
  let heroSize = 192;
  font(60); const unitWidth = ctx.measureText(card.unit).width;
  while (heroSize > 76) { font(heroSize, 600); if (ctx.measureText(card.hero).width + unitWidth + 14 <= 636) break; heroSize -= 4; }
  font(heroSize, 600); const heroWidth = ctx.measureText(card.hero).width;
  text(card.hero, 66, heroTop + 195, heroSize, COLORS.accent, 636, "left", 600);
  text(card.unit, 80 + heroWidth, heroTop + 190, 60, COLORS.accent, unitWidth + 4, "left", 500);
  const cx = 856, cy = heroTop + 96;
  if (card.kind === "rank") {
    ctx.beginPath(); ctx.moveTo(cx, cy - 122); ctx.lineTo(cx + 112, cy - 80); ctx.lineTo(cx + 98, cy + 57);
    ctx.quadraticCurveTo(cx + 80, cy + 102, cx, cy + 132); ctx.quadraticCurveTo(cx - 80, cy + 102, cx - 98, cy + 57);
    ctx.lineTo(cx - 112, cy - 80); ctx.closePath(); ctx.fillStyle = COLORS.surface; ctx.fill();
    ctx.strokeStyle = card.rank ? COLORS.accent : COLORS.border; ctx.lineWidth = 2; ctx.stroke();
    if (card.rank) {
      text("榜单名次", cx, cy - 46, 30, COLORS.muted, 196, "center");
      text(card.rank, cx, cy + 40, fit(card.rank, 94, 184), COLORS.accent, 196, "center", 600);
      text("名", cx, cy + 88, 28, COLORS.muted, 190, "center");
    } else text(card.rankLabel, cx, cy + 16, 42, COLORS.muted, 196, "center", 500);
  } else {
    ctx.lineWidth = 9; ctx.strokeStyle = COLORS.border; ctx.beginPath(); ctx.arc(cx, cy, 106, 0, Math.PI * 2); ctx.stroke();
    if (Number.isFinite(card.chart.ratio) && card.chart.ratio > 0) {
      ctx.strokeStyle = COLORS.accent; ctx.lineCap = "round"; ctx.beginPath();
      ctx.arc(cx, cy, 106, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, card.chart.ratio)); ctx.stroke(); ctx.lineCap = "butt";
    }
    text(card.chart.value, cx, cy + 8, fit(card.chart.value, 64, 172), COLORS.text, 184, "center", 600);
    text(card.chart.label, cx, cy + 57, 30, COLORS.muted, 184, "center");
  }
  // One shared statistics strip; avoid a stack of nested cards.
  line(72, metricsTop, 1008, metricsTop);
  const column = 936 / card.metrics.length;
  card.metrics.forEach((item, index) => {
    const x = 72 + column * (index + .5);
    text(item.value, x, metricsTop + 78, fit(item.value, 58, column - 40), COLORS.text, column - 36, "center", 600);
    text(item.label, x, metricsTop + 128, 34, COLORS.muted, column - 36, "center");
    if (index) line(72 + column * index, metricsTop + 38, 72 + column * index, metricsTop + 134);
  });
  (card.notes || []).forEach((note, index) => text(note, 72, notesTop + index * 42, 30, COLORS.muted));
  if (card.highlight) {
    ctx.fillStyle = COLORS.surface; ctx.fillRect(72, highlightTop, 936, 132);
    ctx.fillStyle = COLORS.accent; ctx.fillRect(72, highlightTop, 4, 132);
    text(card.highlight.label, 104, highlightTop + 44, 30, COLORS.muted, 420);
    text(card.highlight.value, 104, highlightTop + 102, fit(card.highlight.value, 52, 440), COLORS.accent, 450, "left", 600);
    card.highlight.details.forEach((detail, index) => text(detail, 976, highlightTop + 46 + index * 51, 32, COLORS.text, 414, "right"));
  }
  line(72, footerTop, 1008, footerTop);
  text("桌边助手", 72, footerTop + 57, 30, COLORS.muted, 220, "left", 500);
  text("截至 " + shanghaiTime(card.asOf), 1008, footerTop + 57, 28, COLORS.muted, 680, "right");
}
module.exports = { SIZE, COLORS, statsCard, funCard, leaderboardCard, canShareLeaderboard, boardSelection, parseSelection, queryString, describe, drawCard, dimensions, shanghaiTime };
