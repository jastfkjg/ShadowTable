const signed = value => (value > 0 ? "+" : "") + value;
function presentEntries(records) {
  return records.map(record => {
    // The ledger uses the same Beijing calendar day on every device.
    const date = new Date(record.occurredAt + 8 * 3600000), pad = n => String(n).padStart(2, "0");
    const valid = !Number.isNaN(date.getTime());
    const isMatch = record.type === "match";
    return { ...record, isMatch,
      title: isMatch ? record.boardName : "积分调整",
      pointsLabel: signed(record.points), negative: record.points < 0,
      dayKey: valid ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` : "unknown",
      dayLabel: valid ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日` : "日期未知",
      timeLabel: valid ? `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : "—",
      detail: isMatch ? `${record.role} · ${record.outcome === "win" ? "胜利" : record.outcome === "loss" ? "失利" : "不计入战绩"}` : "管理员调整",
    };
  });
}
module.exports = { presentEntries, signed };
