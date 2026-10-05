const api = require("./api");
const funCopy = require("./fun-copy");
const presentation = require("./leaderboard-presentation");
const groups = [{ id: "points", label: "积分" }, { id: "games", label: "局数" }, { id: "overall", label: "胜率" }, { id: "fun", label: "趣味" }];
const metrics = [{ id: "points", label: "积分" }, { id: "games", label: "局数" }, { id: "overall", label: "总胜率" }, { id: "good", label: "好人胜率" }, { id: "evil", label: "坏人胜率" }];
const isPointsUnavailable = error => error.status === 400 && /^排行榜参数无效/.test(error.message);
function presentLeaderboard(result) {
  const board = presentation.presentBoard(funCopy.leaderboard(result));
  return { ...board, rows: board.rows.map(row => ({ ...row, initial: Array.from(row.nickname || "友")[0], avatarUrl: row.avatarUrl ? api.assetUrl(row.avatarUrl) : "" })) };
}
module.exports = { groups, metrics, presentLeaderboard, isPointsUnavailable };
