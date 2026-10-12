const { monthRange } = require("../../miniprogram/monthly-report");
const identity = (nickname, index) => ({ publicId: "00000000-0000-4000-8000-" + String(index).padStart(12, "0"), nickname, avatarUrl: null });
function monthlyFixture() {
  const person = (name, index, fields) => ({ ...identity(name, index), tied: false, ...fields });
  const core = (id, title, unit, subtitle, rows, threshold = 1) => ({ id, title, unit, subtitle, rows, threshold, eligibleCount: rows.length });
  const fun = (metric, title, label, entries, positive = true) => ["count", "rate"].map(sort => ({ id: metric + ":" + sort, metric, title, label, positive, sort,
    rateLabel: positive ? "成功率" : "发生率", unit: sort === "count" ? "次" : "%", threshold: sort === "count" ? 1 : 5,
    subtitle: sort === "count" ? "按次数 · " + label : (positive ? "成功率" : "发生率") + " · 至少 5 次有效机会", eligibleCount: entries.length,
    rows: entries.map(([name, index, count, opportunities], rank) => person(name, index, { count, opportunities, rate: Math.round(count / opportunities * 1000) / 10, rank: rank + 1, knownGames: opportunities, unknownGames: 0 })) }));
  return { month: "2026-09", currentMonth: "2026-10", firstMonth: "2026-06", timezone: "Asia/Shanghai", ...{ periodStart: monthRange("2026-09").start, periodEnd: monthRange("2026-09").end },
    status: "complete", version: 1, rulesVersion: "monthly-2026-10-v1", generatedAt: 1791792000000, updatedAt: 1791792000000, asOf: Date.parse("2026-10-12T04:00:00Z"), overview: { games: 96, players: 34, activeDays: 18 },
    mainBoards: [
      core("points", "积分榜", "分", "本月积分 · 含积分调整", [person("北辰", 1, { rank: 1, points: 86, scoredGames: 40, adjustmentPoints: 0 }), person("小鹿", 2, { rank: 2, points: 78, scoredGames: 35, adjustmentPoints: 0 }), person("阿白", 3, { rank: 3, points: 72, scoredGames: 32, adjustmentPoints: 0 })]),
      core("overall", "战绩榜", "%", "按总胜率 · 至少 10 局", [person("小鹿", 2, { rank: 1, total: 45, wins: 33, losses: 12, winRate: 73.3 }), person("北辰", 1, { rank: 2, total: 44, wins: 30, losses: 14, winRate: 68.2 }), person("雾岛", 4, { rank: 3, total: 39, wins: 26, losses: 13, winRate: 66.7 })], 10),
      core("games", "桌边常驻王", "局", "按有效局数", [person("小鹿", 2, { rank: 1, total: 45, wins: 33, winRate: 73.3 })]),
      core("good", "好人胜率榜", "%", "至少 10 局好人战绩", [], 10), core("evil", "坏人胜率榜", "%", "至少 10 局坏人战绩", [], 10),
    ],
    funBoards: [...fun("merlin_evade", "梅林躲刀王", "成功躲刀", [["小鹿", 2, 8, 10], ["北辰", 1, 6, 8], ["阿白", 3, 5, 8]]),
      ...fun("assassin_hit", "刺客神刀手", "刺中梅林", [["阿白", 3, 7, 11], ["雾岛", 4, 6, 10], ["北辰", 1, 4, 8]]),
      ...fun("good_shield", "最佳护林员", "成功挡刀", [["雾岛", 4, 6, 15], ["小鹿", 2, 5, 13], ["阿白", 3, 3, 12]]),
      ...fun("assassin_miss", "刺客歪刀榜", "歪刀", [["北辰", 1, 4, 8], ["阿白", 3, 4, 11]], false)],
    featuredIds: ["merlin_evade:count", "assassin_hit:count", "good_shield:count"], highlights: ["小鹿以 73.3% 胜率登顶。", "阿白本月刺中梅林 7 次。"] };
}
module.exports = { monthlyFixture };
