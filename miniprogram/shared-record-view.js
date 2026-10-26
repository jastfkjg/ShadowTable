const { portrait } = require("./role-portraits");
const factions = { good: "好人阵营", evil: "坏人阵营", third: "盗贼阵营", unknown: "未知阵营" };
const labels = { stats: "战绩分享", match: "对局分享", fun: "趣味成绩分享" };
const value = number => Number.isFinite(number) ? String(number) : "—";
const rate = number => Number.isFinite(number) ? value(number) + "%" : "—";
const metric = (number, label) => ({ value: String(number), label });
function time(timestamp, short = false) {
  const date = new Date(timestamp + 8 * 3600000), pad = number => String(number).padStart(2, "0");
  if (!Number.isFinite(date.getTime())) return "时间未记录";
  return (short ? "" : date.getUTCFullYear() + ".") + pad(date.getUTCMonth() + 1) + "." + pad(date.getUTCDate())
    + " " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
}
function present(snapshot, assetUrl = path => path) {
  if (snapshot.version !== 1 || !labels[snapshot.kind] || !snapshot.player || !snapshot.data) throw new Error("分享内容暂不支持，请更新小程序后重试。");
  const data = snapshot.data, kind = snapshot.kind;
  const view = { kind, pageTitle: labels[kind], name: snapshot.player.name, initial: Array.from(snapshot.player.name)[0] || "友",
    avatar: snapshot.player.avatarUrl ? assetUrl(snapshot.player.avatarUrl) : "", asOf: time(snapshot.createdAt),
    ownerLabel: kind === "stats" ? "分享了阿瓦隆战绩" : kind === "match" ? "分享了一场对局" : "分享了一项趣味成绩" };
  if (kind === "stats") return { ...view, hero: value(data.winRate), unit: Number.isFinite(data.winRate) ? "%" : "", heroLabel: "总胜率", scope: "全部时间 · 全部玩法",
    metrics: [metric(data.total, "对局"), metric(data.wins + " / " + data.losses, "胜 / 负"), metric(data.scoreMonth, Number((data.scorePeriod || time(snapshot.createdAt).slice(0, 7)).split(".")[1]) + "月积分")],
    factions: data.factions.map(row => ({ ...row, label: factions[row.faction] || factions.unknown, rate: rate(row.winRate),
      bar: "width:" + Math.max(0, Math.min(100, row.winRate || 0)) + "%;" })),
    roles: data.roles.map(row => ({ ...row, ...portrait(row.role, row.faction), rate: rate(row.winRate) })) };
  if (kind === "match") return { ...view, ...portrait(data.role, data.faction), role: data.role,
    context: data.boardName.replace(/\s*[（(]\d+人[）)]\s*$/, "") + " · " + data.capacity + " 人",
    result: data.outcome === "excluded" ? "本局未计入战绩" : (factions[data.winner] || "胜方未登记") + (data.winner ? "获胜" : ""),
    endedAt: time(data.endedAt), roleContext: (factions[data.faction] || factions.unknown) + (data.seat ? " · " + data.seat + " 号位" : ""),
    metrics: [metric(({ win: "获胜", loss: "失利", excluded: "未计入" })[data.outcome] || "未记录", "本人结果"),
      metric(Number.isFinite(data.score) ? (data.score >= 0 ? "+" : "") + data.score : "未计分", "本局积分"),
      metric(data.questTotal ? data.questSuccess + " / " + data.questTotal : "—", "成功任务")],
    events: data.events.map((row, index) => ({ id: index, label: row.label, round: Number.isInteger(row.round) ? "第 " + row.round + " 轮" : /^任务/.test(row.label) ? "任务结果" : "终局" })) };
  return { ...view, hero: value(data.count), longHero: String(data.count).length > 6, unit: data.unit, heroLabel: data.label, roleLabel: data.roleLabel,
    icon: data.icon, portraitIcon: data.iconTone === "portrait", scope: "全部时间 · " + data.modeLabel,
    description: data.description,
    metrics: [...(!data.countOnly ? [metric(rate(data.rate), data.rateName), metric(data.opportunities, "有效机会")] : []), metric(data.knownGames, "有记录局数")],
    related: data.records.map((row, index) => ({ id: index, title: row.boardName + " · " + row.role,
      time: time(row.endedAt, true), value: row.count + " " + data.unit })) };
}
module.exports = { present, time };
