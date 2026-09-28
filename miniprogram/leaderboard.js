const api = require("./api");
const metrics = [{ id: "games", label: "局数" }, { id: "overall", label: "总胜率" }, { id: "good", label: "好人胜率" }, { id: "evil", label: "坏人胜率" }];
function presentLeaderboard(result) {
  const games = result.metric === "games";
  const value = row => games ? String(row.total) : row.winRate === null ? "—" : row.winRate.toFixed(1);
  const unit = row => games ? "局" : row.winRate === null ? "" : "%";
  const me = result.me;
  const statusLabel = {
    ranked: "第 " + me.rank + " 名", hidden: "尚未开启公开展示", unsupported: "仅微信账号可上榜",
    no_games: "当前周期暂无有效对局", insufficient: "距上榜还差 " + me.remaining + " 局",
  }[me.status];
  return { ...result,
    metricLabel: metrics.find(item => item.id === result.metric).label,
    ruleLabel: games ? "至少1局有效对局" : "满" + result.threshold + "局" + (result.metric === "overall" ? "有效对局" : "该阵营有效对局") + "上榜",
    updatedLabel: new Date(result.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }),
    rows: result.rows.map(row => ({ ...row, value: value(row), unit: unit(row), initial: (row.nickname || "友").slice(0, 1), avatarUrl: row.avatarUrl ? api.assetUrl(row.avatarUrl) : "" })),
    me: { ...me, value: value(me), unit: unit(me), statusLabel },
  };
}
module.exports = { metrics, presentLeaderboard };
