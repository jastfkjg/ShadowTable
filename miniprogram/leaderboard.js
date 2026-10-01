const api = require("./api");
const groups = [{ id: "points", label: "积分" }, { id: "games", label: "局数" }, { id: "overall", label: "胜率" }];
const metrics = [{ id: "points", label: "积分" }, { id: "games", label: "局数" }, { id: "overall", label: "总胜率" }, { id: "good", label: "好人胜率" }, { id: "evil", label: "坏人胜率" }];
const isPointsUnavailable = error => error.status === 400 && /^排行榜参数无效/.test(error.message);
function presentLeaderboard(result) {
  const games = result.metric === "games", points = result.metric === "points";
  const value = row => points ? String(row.points || 0) : games ? String(row.total) : row.winRate === null ? "—" : row.winRate.toFixed(1);
  const unit = row => points ? "分" : games ? "局" : row.winRate === null ? "" : "%";
  const me = result.me;
  const statusLabel = me.rank ? "第 " + me.rank + " 名" : "";
  return { ...result,
    metricLabel: metrics.find(item => item.id === result.metric).label,
    rows: result.rows.map(row => ({ ...row, value: value(row), unit: unit(row), initial: (row.nickname || "友").slice(0, 1), avatarUrl: row.avatarUrl ? api.assetUrl(row.avatarUrl) : "" })),
    me: { ...me, value: value(me), unit: unit(me), statusLabel },
  };
}
module.exports = { groups, metrics, presentLeaderboard, isPointsUnavailable };
