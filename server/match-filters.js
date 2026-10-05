"use strict";
const { RuleError } = require("./engine");

// Calendar periods follow the same Shanghai day boundary as the monthly board.
function parseMatchFilters(params, now) {
  const period = params.get("period") || "all";
  const board = params.get("board") || "";
  const role = params.get("matchRole") || "";
  const outcome = params.get("outcome") || "";
  if (!["all", "month", "7d", "30d"].includes(period)
    || board && !/^[a-z0-9-]{1,64}$/.test(board)
    || role.length > 80 || /[\u0000-\u001f]/.test(role)
    || !["", "win", "loss", "excluded"].includes(outcome))
    throw new RuleError("对局记录筛选无效", 400);
  const filters = { period, board, role, outcome };
  if (period !== "all") {
    const local = new Date(now + 8 * 3600000);
    const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000;
    filters.from = period === "month"
      ? Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 8 * 3600000
      : today - (period === "7d" ? 6 : 29) * 86400000;
    filters.to = today + 86400000;
  }
  return filters;
}
module.exports = { parseMatchFilters };
