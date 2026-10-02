const now = Date.UTC(2026, 9, 2, 12, 30);
const profile = { nickname: "小林", avatarUrl: null, uid: "must-not-export", leaderboardVisible: false };
const metric = { id: "merlin_evade", label: "成功躲刀", unit: "次", ranked: true, count: 8, value: 8, opportunities: 10, rate: 80, knownGames: 10, unknownGames: 2 };
const stats = { total: 48, wins: 30, winRate: 62.5, score: { games: 24, best: 5, total: 286, manualAdjustment: { reason: "must-not-export" } },
  recent: [{ roomCode: "must-not-export", members: ["must-not-export"] }],
  fun: { cards: [{ id: "classic:merlin", mode: "classic", modeLabel: "经典", title: "梅林", metrics: [metric] }] } };
const board = { metric: "points", period: "month", periodStart: Date.UTC(2026, 8, 30, 16), updatedAt: now, version: "private-version", rows: [
  { rank: 1, nickname: "晚风", publicId: "not-needed", points: 360, total: 30 },
  { rank: 1, nickname: "北川", publicId: "not-needed", points: 360, total: 28 },
  { rank: 3, nickname: "小林", publicId: "not-needed", points: 286, total: 24 },
  { rank: 4, nickname: "should-not-appear", points: 200, total: 15 },
], me: { status: "ranked", rank: 3, points: 286, total: 24 } };
module.exports = { now, profile, metric, stats, board };
