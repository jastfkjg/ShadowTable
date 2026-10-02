// Explicit display projections: never pass whole profiles, matches or events to the renderer.
const SIZE = 1080;
const COLORS = { background: "#101c24", surface: "#1b2b35", text: "#f2eee5", muted: "#b1bfc6", accent: "#e5c68b", border: "#536570" };
const metricNames = { points: "积分榜", games: "局数榜", overall: "总胜率榜", good: "好人胜率榜", evil: "坏人胜率榜" };
const modeNames = { all: "全部玩法", classic: "经典", knights: "十二骑士", other: "扩展玩法" };
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const clean = value => String(value || "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
const number = value => Number.isFinite(value) ? String(value) : "—";
const percent = value => Number.isFinite(value) ? number(Math.round(value * 10) / 10) + "%" : "—";
function shanghaiTime(time, monthOnly = false) {
  const date = new Date(time + 8 * 3600000), pad = value => String(value).padStart(2, "0");
  const month = date.getUTCFullYear() + "." + pad(date.getUTCMonth() + 1);
  return monthOnly ? month : month + "." + pad(date.getUTCDate()) + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
}
function identity(profile) {
  return { name: clean(profile.nickname) || "新朋友", avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(profile.avatarUrl || "") ? profile.avatarUrl : "" };
}
function describe(card) {
  return [card.name, card.context, card.title, card.scope, card.hero, card.label, ...(card.details || []),
    ...(card.rows || []).map(row => `第 ${row.rank} 名，${row.name}，${row.value}，${row.sample}`), "截至 " + shanghaiTime(card.asOf)].filter(Boolean).join("，");
}
function statsCard(profile, stats, now) {
  if (!stats.total) throw new Error("还没有有效战绩，完成对局后再来分享。");
  return { kind: "stats", ...identity(profile), context: "阿瓦隆 · 总战绩", hero: percent(stats.winRate), label: "总胜率",
    details: [`${number(stats.wins)} 胜 / ${number(stats.total)} 局`, ...(stats.score?.games ? [`最高 ${number(stats.score.best)} 连胜 · 计分局`] : [])], asOf: now };
}
function funCard(profile, stats, cardId, metricId, now) {
  const group = stats.fun?.cards?.find(card => card.id === cardId);
  const metric = group?.metrics?.find(row => row.id === metricId && row.ranked);
  if (!metric || metric.value === null || !metric.knownGames) throw new Error("这项成绩还没有完整记录，暂时无法生成图片。");
  return { kind: "fun", ...identity(profile), context: clean(group.modeLabel) + " · " + clean(group.title),
    hero: number(metric.count), label: clean(metric.label) + " · " + clean(metric.unit),
    details: [metric.opportunities ? `${percent(metric.rate)} 成功率 · ${number(metric.opportunities)} 次机会` : "暂无有效机会",
      `${number(metric.knownGames)} 局有记录${metric.unknownGames ? ` · ${number(metric.unknownGames)} 局未记录` : ""}`], asOf: now };
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
function boardValue(board, row) {
  return board.fun ? board.sort === "rate" ? percent(row.rate) : number(row.count) + " " + clean(board.unit)
    : board.metric === "points" ? number(row.points) + " 分" : board.metric === "games" ? number(row.total) + " 局" : percent(row.winRate);
}
function boardSample(board, row) {
  return board.fun ? `${number(row.count)} / ${number(row.opportunities)} 次机会`
    : board.metric === "points" ? `${number(row.total)} 场计分局` : `${number(row.wins)} 胜 / ${number(row.total)} 局`;
}
function leaderboardCard(profile, board, mode) {
  const context = board.period === "month" ? shanghaiTime(board.periodStart, true).replace(".", " 年 ") + " 月" : "全部时间";
  const title = board.fun ? clean(board.metricLabel) + "榜" : metricNames[board.metric];
  const role = board.roleOptions?.find(row => row.id === board.role)?.label;
  const scope = board.fun ? [clean(board.title), modeNames[board.mode || "all"], role, board.sort === "rate" ? `至少 ${board.threshold} 次机会` : "累计次数"].filter(Boolean).join(" · ") : "";
  const base = { kind: mode === "top" ? "top" : "rank", context, title, scope, asOf: board.updatedAt };
  if (mode === "top") {
    if (!board.rows.length) throw new Error("这个榜单暂时没有玩家上榜。");
    return { ...base, rows: board.rows.slice(0, 3).map(row => ({ rank: row.rank, name: clean(row.nickname) || "新朋友",
      value: boardValue(board, row), sample: boardSample(board, row) })), note: "榜单前三位 · 并列保留实际名次" };
  }
  if (board.me.status !== "ranked" || !board.me.rank) throw new Error("当前未上榜，可以切换为分享榜单前三位。");
  return { ...base, ...identity(profile), hero: "第 " + board.me.rank + " 名", label: "当前名次",
    details: [boardValue(board, board.me), boardSample(board, board.me)] };
}

// Same renderer runs on a native Canvas 2D node and in visual verification.
function drawCard(ctx, card, avatar) {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const text = (value, x, y, size, color = COLORS.text, width = 920, align = "left", weight = 400) => {
    value = clean(value);
    ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`;
    // Long nicknames are shortened, rather than making every name microscopic.
    const chars = Array.from(value);
    while (chars.length && ctx.measureText(chars.join("") + (chars.length < Array.from(value).length ? "…" : "")).width > width) chars.pop();
    ctx.fillText(chars.join("") + (chars.length < Array.from(value).length ? "…" : ""), x, y);
  };
  const line = y => { ctx.fillStyle = COLORS.border; ctx.fillRect(80, y, 920, 1); };
  if (card.kind === "top") {
    text(card.context, 80, 120, 38, COLORS.muted);
    text(card.title, 80, 198, 52, COLORS.accent, 920, "left", 600);
    text(card.scope || "玩家 / 成绩", 80, 256, 32, COLORS.muted);
    card.rows.forEach((row, index) => {
      const y = 375 + index * 170;
      text(row.rank, 80, y + 12, 66, COLORS.accent, 100, "left", 600);
      text(row.name, 206, y, 52, COLORS.text, 460, "left", 600);
      text(row.value, 1000, y, 56, COLORS.text, 305, "right", 600);
      text(row.sample, 206, y + 62, 38, COLORS.muted, 794);
      if (index < card.rows.length - 1) line(y + 99);
    });
    text(card.note, 80, 900, 28, COLORS.muted);
  } else {
    ctx.save(); ctx.beginPath(); ctx.arc(118, 114, 38, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = COLORS.surface; ctx.fillRect(80, 76, 76, 76);
    if (avatar) {
      const side = Math.min(avatar.width, avatar.height);
      ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, 80, 76, 76, 76);
    } else text(Array.from(card.name)[0], 118, 130, 44, COLORS.accent, 70, "center", 600);
    ctx.restore();
    text(card.name, 182, 130, 56, COLORS.text, 818, "left", 600);
    text(card.context, 80, 238, 44, COLORS.muted);
    if (card.title) text(card.title, 80, 306, 46, COLORS.accent, 920, "left", 600);
    if (card.scope) text(card.scope, 80, 358, 30, COLORS.muted);
    let size = card.kind === "rank" ? 160 : 210;
    do { ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`; if (ctx.measureText(card.hero).width <= 850) break; size -= 4; } while (size > 76);
    text(card.hero, 540, card.kind === "rank" ? 585 : 520, size, COLORS.accent, 920, "center", 600);
    text(card.label, 540, card.kind === "rank" ? 653 : 610, 52, COLORS.text, 920, "center");
    card.details.forEach((detail, index) => text(detail, 540, 764 + index * 64, index ? 40 : 56, index ? COLORS.muted : COLORS.text, 920, "center"));
  }
  line(946);
  text("桌边助手", 80, 1009, 32, COLORS.muted, 220);
  text("截至 " + shanghaiTime(card.asOf), 1000, 1009, 30, COLORS.muted, 680, "right");
}
module.exports = { SIZE, COLORS, statsCard, funCard, leaderboardCard, boardSelection, parseSelection, queryString, describe, drawCard, shanghaiTime };
