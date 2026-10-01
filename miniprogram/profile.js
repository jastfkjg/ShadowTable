const api = require("./api");
// Only reuse the immediately preceding personal page; never persist account data.
function personalPreview(kind) {
  const pages = getCurrentPages();
  const previous = pages[pages.length - 2];
  if (previous?.route !== "pages/me/me") return null;
  const value = kind === "matches" ? previous.matchesPreview : previous.data?.[kind];
  return value ? JSON.parse(JSON.stringify(value)) : null;
}
function presentProfile(profile) {
  return { ...profile, avatarUrl: profile.avatarUrl ? api.assetUrl(profile.avatarUrl) : "",
    displayName: profile.nickname || "新朋友", initial: (profile.nickname || "友").slice(0, 1),
    identityLabel: ({ wx: "微信账号", guest: "游客账号", dev: "开发账号", test: "陪测账号" })[profile.identityType] || "玩家账号" };
}
function presentStats(stats) {
  const rate = row => ({ ...row, rateLabel: row.winRate === null ? "—" : row.winRate + "%",
    scoreAverageLabel: row.score?.average == null ? "—" : row.score.average.toFixed(2) });
  const byRole = (stats.byRole || []).map(rate);
  const factionOrder = { good: 0, evil: 1, third: 2, unknown: 3 };
  return { ...rate(stats), score: stats.score || { total: 0, month: 0, games: 0, average: null, current: 0, best: 0 }, byFaction: stats.byFaction.filter(row => row.total > 0)
    .sort((a, b) => (factionOrder[a.faction] ?? 9) - (factionOrder[b.faction] ?? 9))
    .map(row => ({ ...rate(row), roles: byRole.filter(role => role.faction === row.faction), expanded: false })),
    byRole, byBoard: stats.byBoard.map(rate),
    recent: stats.recent.map(r => ({ ...r,
      dateLabel: new Date(r.endedAt).toLocaleString("zh-CN", { hour12: false }),
      outcomeLabel: r.outcome === "win" ? "胜" : r.outcome === "loss" ? "负" : "不计入",
      factionLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[r.faction],
      sourceLabel: r.source === "manual" ? "房主登记" : r.source === "system" ? "系统判定" : "未判定",
    })) };
}
function presentMatches(records) {
  return records.map(record => ({
    ...record,
    scoreLabel: record.score?.status === "scored" ? (record.score.total >= 0 ? "+" : "") + record.score.total + " 分" : record.score?.status === "excluded" ? "不计积分" : "积分未启用",
    dateLabel: new Date(record.endedAt).toLocaleString("zh-CN", { hour12: false }),
    outcomeLabel: record.outcome === "win" ? "胜利" : record.outcome === "loss" ? "失利" : "不计入战绩",
    factionLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[record.faction] || "未知",
    winnerLabel: ({ good: "好人", evil: "坏人", third: "盗贼" })[record.winner] || "未登记",
    sourceLabel: record.source === "manual" ? "房主登记" : record.source === "system" ? "系统判定" : "未判定",
    members: record.members.map(member => ({ ...member, isSelf: member.seat === record.seat })),
  }));
}
function backToMe() {
  if (getCurrentPages().length > 1) wx.navigateBack();
  else wx.switchTab({ url: "/pages/me/me" });
}
module.exports = { presentProfile, presentStats, presentMatches, backToMe, personalPreview };
