const api = require("./api");
function presentProfile(profile) {
  return { ...profile, avatarUrl: profile.avatarUrl ? api.assetUrl(profile.avatarUrl) : "",
    displayName: profile.nickname || "新朋友", initial: (profile.nickname || "友").slice(0, 1),
    identityLabel: ({ wx: "微信账号", guest: "游客账号", dev: "开发账号", test: "陪测账号" })[profile.identityType] || "玩家账号" };
}
function presentStats(stats) {
  const rate = row => ({ ...row, rateLabel: row.winRate === null ? "—" : row.winRate + "%" });
  return { ...rate(stats), byFaction: stats.byFaction.map(rate), byBoard: stats.byBoard.map(rate),
    recent: stats.recent.map(r => ({ ...r,
      dateLabel: new Date(r.endedAt).toLocaleString("zh-CN", { hour12: false }),
      outcomeLabel: r.outcome === "win" ? "胜" : r.outcome === "loss" ? "负" : "不计入",
      factionLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[r.faction],
      sourceLabel: r.source === "manual" ? "房主登记" : r.source === "system" ? "系统判定" : "未判定",
    })) };
}
function backToMe() {
  if (getCurrentPages().length > 1) wx.navigateBack();
  else wx.switchTab({ url: "/pages/me/me" });
}
module.exports = { presentProfile, presentStats, backToMe };
