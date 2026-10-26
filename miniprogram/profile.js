const api = require("./api");
const funCopy = require("./fun-copy");
const honorPresentation = require("./honors");
const { canShareFun } = require("./share-card");
const { switchHomeTab } = require("./tab-navigation");
const { portrait } = require("./role-portraits");
// Only reuse the immediately preceding personal page; never persist account data.
function personalPreview(kind) {
  const pages = getCurrentPages();
  const previous = pages[pages.length - 2];
  if (typeof previous?.getPersonalPreview === "function") {
    const value = previous.getPersonalPreview(kind);
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }
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
  stats = funCopy.response(stats);
  const rate = row => ({ ...row, rateLabel: row.winRate == null ? "—" : row.winRate + "%",
    rateValue: row.winRate == null ? "—" : String(row.winRate), rateUnit: row.winRate == null ? "" : "%",
    scoreAverageLabel: row.score?.average == null ? "—" : row.score.average.toFixed(2) });
  const factionOrder = { good: 0, evil: 1, third: 2, unknown: 3 };
  const byRole = (stats.byRole || []).map(row => ({ ...rate(row), ...portrait(row.role, row.faction) }))
    .sort((a, b) => (factionOrder[a.faction] ?? 9) - (factionOrder[b.faction] ?? 9) || b.total - a.total);
  return { ...rate(stats), fun: presentFun(stats.fun), score: stats.score || { total: 0, month: 0, games: 0, average: null }, byFaction: stats.byFaction.filter(row => row.total > 0)
    .sort((a, b) => (factionOrder[a.faction] ?? 9) - (factionOrder[b.faction] ?? 9))
    .map(row => ({ ...rate(row), shortLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[row.faction] || row.label,
      roles: byRole.filter(role => role.faction === row.faction), expanded: false })),
    byRole, roleCount: new Set(byRole.map(row => row.role)).size, byBoard: stats.byBoard.map(rate),
    recent: stats.recent.map(r => ({ ...r,
      dateLabel: new Date(r.endedAt).toLocaleString("zh-CN", { hour12: false }),
      outcomeLabel: r.outcome === "win" ? "胜" : r.outcome === "loss" ? "负" : "不计入",
      factionLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[r.faction],
      sourceLabel: r.source === "manual" ? "房主登记" : r.source === "system" ? "系统判定" : "未判定",
    })) };
}
function presentFun(value) {
  if (!value) return { available: false, cards: [], legacyGames: 0, teaser: "", ...funCopy.records(null) };
  value = funCopy.summary(value);
  return { ...value, available: true, ...funCopy.records(value), shareable: canShareFun(value) };
}
function presentMatches(records) {
  return records.map(record => {
    record = { ...record, fun: funCopy.story(record.fun) };
    const date = new Date(record.endedAt);
    const validDate = !Number.isNaN(date.getTime());
    const pad = value => String(value).padStart(2, "0");
    const hasFunEvents = !!record.fun?.events?.length;
    const funNote = record.fun?.status === "legacy" && !hasFunEvents ? "本局暂无过程记录" : record.fun?.reason || "";
    const funHighlights = (record.fun?.highlights || [])
      .filter(item => item.id !== "final_miss" && !String(item.id || "").endsWith("_failed")
        && !["最终歪刀", "未生效"].includes(item.label))
      .slice(0, 2).map(item => ({ ...item,
        label: item.label + (item.count > 1 ? " ×" + item.count : ""),
        color: /_(ally|hit|bust|miss)$/.test(item.id) && !(item.positive ?? item.ranked) ? "evil" : "good" }));
    return {
      ...record,
      rolePortrait: portrait(record.role, record.faction).portrait,
      honors: honorPresentation.present(record.honorResult, api.assetUrl),
      boardTitle: (record.boardName || "").replace(/\s*[（(]\s*(\d+)\s*人\s*[）)]\s*$/, (suffix, count) => Number(count) === Number(record.capacity) ? "" : suffix),
      expanded: false,
      membersExpanded: false,
      dayKey: validDate ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : "unknown",
      dayLabel: validDate ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` : "日期未知",
      dayShortLabel: validDate ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : "日期未知",
      yearLabel: validDate ? String(date.getFullYear()) : "",
      timeLabel: validDate ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : "—",
      hasFunEvents,
      showInitialRole: !!record.fun?.initialRole && record.fun.initialRole !== record.role,
      funNote: funNote === record.excludedReason || funNote === record.score?.reason ? "" : funNote,
      funLabel: funHighlights.map(item => item.label).join(" · "),
      funHighlights,
      scoreLabel: record.score?.status === "scored" ? (record.score.total >= 0 ? "+" : "") + record.score.total + " 分" : "未计分",
      dateLabel: validDate ? date.toLocaleString("zh-CN", { hour12: false }) : "日期未知",
      outcomeLabel: record.outcome === "win" ? "胜利" : record.outcome === "loss" ? "失利" : "不计入战绩",
      factionLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[record.faction] || "未知",
      winnerLabel: ({ good: "好人", evil: "坏人", third: "盗贼" })[record.winner] || "未登记",
      sourceLabel: record.source === "manual" ? "房主登记" : record.source === "system" ? "系统判定" : "未判定",
      members: record.members.map(member => ({ ...member, isSelf: member.seat === record.seat })),
    };
  });
}
function backToMe() {
  if (getCurrentPages().length > 1) wx.navigateBack();
  else switchHomeTab(1);
}
const presentAdjustments = records => records.map(record=>({...record,dateLabel:new Date(record.created).toLocaleString("zh-CN",{hour12:false}),pointsLabel:(record.delta>=0?'+':'')+record.delta+' 分'}));
module.exports = { presentProfile, presentStats, presentMatches, presentFun, presentAdjustments, backToMe, personalPreview };
