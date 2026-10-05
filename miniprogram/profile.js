const api = require("./api");
const funCopy = require("./fun-copy");
const { canShareFun } = require("./share-card");
const { switchHomeTab } = require("./tab-navigation");
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
  const rate = row => ({ ...row, rateLabel: row.winRate === null ? "—" : row.winRate + "%",
    rateValue: row.winRate == null ? "—" : String(row.winRate), rateUnit: row.winRate == null ? "" : "%",
    scoreAverageLabel: row.score?.average == null ? "—" : row.score.average.toFixed(2) });
  const byRole = (stats.byRole || []).map(rate);
  const factionOrder = { good: 0, evil: 1, third: 2, unknown: 3 };
  return { ...rate(stats), fun: presentFun(stats.fun), score: stats.score || { total: 0, month: 0, games: 0, average: null, current: 0, best: 0 }, byFaction: stats.byFaction.filter(row => row.total > 0)
    .sort((a, b) => (factionOrder[a.faction] ?? 9) - (factionOrder[b.faction] ?? 9))
    .map(row => ({ ...rate(row), roles: byRole.filter(role => role.faction === row.faction), expanded: false })),
    byRole, roleCount: new Set(byRole.map(row => row.role)).size, byBoard: stats.byBoard.map(rate),
    recent: stats.recent.map(r => ({ ...r,
      dateLabel: new Date(r.endedAt).toLocaleString("zh-CN", { hour12: false }),
      outcomeLabel: r.outcome === "win" ? "胜" : r.outcome === "loss" ? "负" : "不计入",
      factionLabel: ({ good: "好人", evil: "坏人", third: "盗贼", unknown: "未知" })[r.faction],
      sourceLabel: r.source === "manual" ? "房主登记" : r.source === "system" ? "系统判定" : "未判定",
    })) };
}
function presentFun(value) {
  if (!value) return { available: false, cards: [], legacyGames: 0, teaser: "" };
  value = funCopy.summary(value);
  const cards = value.cards.map(card => {
    const metrics = card.metrics.filter(row => !row.id.endsWith("aim_enemy")).map(row => ({ ...row,
      valueLabel: row.value === null ? "—" : String(row.count), rateLabel: row.rate == null ? "暂无机会" : Number(row.rate.toFixed(1)) + "%",
      url: "/pages/matches/matches?fun=" + row.id + "&mode=" + row.mode,
      percent: row.opportunities ? Math.round(row.count / row.opportunities * 100) : 0,
      color: /_(ally|hit|bust|miss)$/.test(row.id) && !(row.positive ?? row.ranked) ? "evil" : row.id.endsWith("failed") ? "muted" : "good" }));
    const primary = metrics.find(row => row.positive ?? row.ranked) || metrics[0];
    const aim = card.metrics.find(row => row.id.endsWith("aim_enemy"));
    const roles = (primary?.byRole || []).map(role => ({ ...role,
      countLabel: role.value === null ? "—" : String(role.count),
      ally: metrics.find(row => row.id.endsWith("ally"))?.byRole.find(row => row.role === role.role)?.count || 0,
      failed: metrics.find(row => row.id.endsWith("failed"))?.byRole.find(row => row.role === role.role)?.count || 0,
      url: primary ? primary.url + "&role=" + role.role : "" }));
    return { ...card, metrics, roles, icon: card.id.endsWith(":shield") ? "/assets/record-shield.svg" : card.id.endsWith(":knife") ? "/assets/record-sword.svg" : "",
      rateAvailable: primary?.value != null && primary?.rate != null && primary.opportunities > 0,
      successFraction: primary?.value != null && primary?.opportunities > 0 ? `成功 ${primary.count} / ${primary.opportunities}` : "",
      shareMetric: primary?.ranked && primary.value !== null && primary.knownGames ? primary.id : "", shareLabel: primary?.label || "成绩", isCombat: ["knife","gun","duel"].some(group => card.id.endsWith(":"+group)),
      enemyLabel: metrics.find(row => row.id.endsWith("enemy"))?.label || "敌方", allyLabel: metrics.find(row => row.id.endsWith("ally"))?.label || "友方",
      coverage: primary ? `${primary.knownGames} 局有记录${primary.unknownGames ? ` · ${primary.unknownGames} 局未记录` : ""}` : "",
      sampleLabel: !primary || primary.value === null ? "暂无完整样本" : !primary.opportunities ? "暂无有效机会" : `共 ${primary.opportunities} ${["knife","gun","duel"].some(group => card.id.endsWith(":"+group)) ? "次出手" : "次机会"}`,
      opportunities: primary?.opportunities || 0, rateLabel: primary?.rateLabel || "暂无机会", aimLabel: aim?.rate == null ? "" : "选敌率 " + aim.rate.toFixed(1) + "%" };
  });
  return { ...value, available: true, cards, shareable: canShareFun(value) };
}
function presentMatches(records) {
  return records.map(record => {
    record = { ...record, fun: funCopy.story(record.fun) };
    const date = new Date(record.endedAt);
    const validDate = !Number.isNaN(date.getTime());
    const pad = value => String(value).padStart(2, "0");
    const hasFunEvents = !!record.fun?.events?.length;
    const funNote = record.fun?.status === "legacy" && !hasFunEvents ? "本局暂无过程记录" : record.fun?.reason || "";
    return {
      ...record,
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
      funLabel: record.fun?.highlights?.map(item => item.label + (item.count > 1 ? " ×" + item.count : "")).slice(0,2).join(" · ") || "",
      funHighlights: (record.fun?.highlights || []).slice(0, 2).map(item => ({ ...item,
        label: item.label + (item.count > 1 ? " ×" + item.count : ""),
        color: /_(ally|hit|bust|miss)$/.test(item.id) && !(item.positive ?? item.ranked) ? "evil" : item.id.endsWith("failed") ? "muted" : "good" })),
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
