function presentMonthlyReset(notice) {
  if (!notice) return null;
  const [year, month] = notice.previousMonth.split("-").map(Number);
  return { ...notice, monthLabel: Number(notice.month.slice(5)) + " 月", previousLabel: year + " 年 " + month + " 月",
    previous: { ...notice.previous, rateLabel: notice.previous.winRate == null ? "—" : notice.previous.winRate + "%" } };
}
module.exports = { presentMonthlyReset };
