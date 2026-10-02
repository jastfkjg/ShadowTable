const now = Date.UTC(2026, 9, 2, 12, 30);
const profile = { nickname: "小林", avatarUrl: null, uid: "must-not-export", leaderboardVisible: false };
const metric = { id: "merlin_evade", label: "成功躲刀", unit: "次", ranked: true, count: 8, value: 8, opportunities: 10, rate: 80, knownGames: 10, unknownGames: 2 };
const stats = { total: 48, wins: 30, losses: 18, winRate: 62.5, score: { games: 24, best: 5, total: 286, manualAdjustment: { reason: "must-not-export" } },
  byFaction: [{ faction: "good", total: 30, wins: 21 }, { faction: "evil", total: 18, wins: 9 }],
  byRole: [{ role: "梅林", faction: "good", total: 12, wins: 9 }, { role: "派西维尔", faction: "good", total: 10, wins: 7 },
    { role: "刺客", faction: "evil", total: 10, wins: 6 }, { role: "莫甘娜", faction: "evil", total: 8, wins: 3 },
    { role: "忠臣", faction: "good", total: 5, wins: 4 }, { role: "兰斯洛特", faction: "good", total: 3, wins: 1 }],
  recent: [{ roomCode: "must-not-export", members: ["must-not-export"] }],
  fun: { cards: [{ id: "classic:merlin", mode: "classic", modeLabel: "经典", title: "梅林", metrics: [metric] }] } };
const board = { metric: "points", period: "month", periodStart: Date.UTC(2026, 8, 30, 16), updatedAt: now, version: "private-version", rows: [
  { rank: 1, nickname: "晚风", publicId: "not-needed", points: 360, total: 30 },
  { rank: 1, nickname: "北川", publicId: "not-needed", points: 360, total: 28 },
  { rank: 3, nickname: "小林", publicId: "not-needed", points: 286, total: 24 },
  { rank: 4, nickname: "should-not-appear", points: 200, total: 15 },
], nearby: [
  { rank: 6, nickname: "晚风", publicId: "not-needed", points: 318, total: 30 },
  { rank: 7, nickname: "阿岚", publicId: "not-needed", points: 302, total: 28 },
  { rank: 8, nickname: "小林", publicId: "not-needed", points: 286, total: 24, isSelf: true },
  { rank: 9, nickname: "北川", publicId: "not-needed", points: 271, total: 22 },
  { rank: 10, nickname: "栗子", publicId: "not-needed", points: 260, total: 20 },
], me: { status: "ranked", rank: 8, points: 286, total: 24, wins: 15, losses: 9, winRate: 62.5 } };
module.exports = { now, profile, metric, stats, board };
