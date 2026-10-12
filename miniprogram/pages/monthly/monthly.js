const api = require("../../api");
const monthly = require("../../monthly-report");
const { initialPlayerCardData, playerCardMethods } = require("../../player-card");
const { backToMe } = require("../../profile");
Page({
  data: { ...initialPlayerCardData, month: "", maxMonth: monthly.monthAt(), minMonth: "2000-01", report: null, loading: true, error: "", detailsExpanded: false, entertainment: false, sort: "count", detailBoards: [], shareOpening: false },
  ...playerCardMethods(api),
  onLoad(options = {}) { this.alive = true; this.foreground = true; this.setData({ month: /^20\d{2}-(0[1-9]|1[0-2])$/.test(options.month || "") ? options.month : monthly.monthAt() }); },
  onShow() { this.foreground = true; return this.load(); },
  onHide() { this.foreground = false; this.closePlayerCard(); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; this.closePlayerCard(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(month = this.data.month) {
    this.closePlayerCard();
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ month, loading: true, error: "", report: null, detailBoards: [] });
    try {
      await api.login();
      const response = await api.request("/api/monthly-report?month=" + encodeURIComponent(month));
      if (!this.alive || sequence !== this.sequence || this.foreground === false) return;
      const report = monthly.presentReport(response);
      for (const board of [...report.mainBoards, ...report.funBoards]) for (const row of board.rows) row.avatarSrc = row.avatarUrl ? api.assetUrl(row.avatarUrl) : "";
      this.setData({ report, maxMonth: report.currentMonth, minMonth: report.firstMonth < month ? report.firstMonth : month,
        detailBoards: monthly.detailBoards(report, this.data.sort, this.data.entertainment) });
    } catch (error) {
      if (this.alive && sequence === this.sequence) this.setData({ error: error.status === 404 ? "当前服务尚未开放月度战报，请更新服务端后重试。" : error.message });
    } finally { if (this.alive && sequence === this.sequence) this.setData({ loading: false }); }
  },
  chooseMonth(e) { const month = e.detail.value; if (month !== this.data.month) return this.load(month); },
  retry() { return this.load(); },
  toggleDetails() { this.setData({ detailsExpanded: !this.data.detailsExpanded }); },
  chooseSort(e) { const sort = e.currentTarget.dataset.id; if (["count", "rate"].includes(sort) && this.data.report) this.setData({ sort, detailBoards: monthly.detailBoards(this.data.report, sort, this.data.entertainment) }); },
  chooseEdition(e) { const entertainment = e.currentTarget.dataset.id === "fun"; if (this.data.report) this.setData({ entertainment, detailBoards: monthly.detailBoards(this.data.report, this.data.sort, entertainment) }); },
  share() {
    if (!this.data.report?.canShare || this.data.loading || this.data.error || this.data.shareOpening) return;
    this.setData({ shareOpening: true });
    wx.navigateTo({ url: "/pages/share/share?kind=monthly&month=" + this.data.report.month + (this.data.entertainment ? "&edition=fun" : ""),
      fail: () => { if (this.alive) wx.showToast({ title: "分享页暂时无法打开，请重试", icon: "none" }); },
      complete: () => { if (this.alive) this.setData({ shareOpening: false }); } });
  },
  openMonthlyPlayer(e) {
    const id = e.currentTarget.dataset.id;
    const row = [...(this.data.report?.mainBoards || []), ...(this.data.report?.funBoards || [])].flatMap(board => board.rows).find(row => row.publicId === id);
    if (!row || this.data.loading || this.foreground === false) return;
    return this.loadPlayerCard({ scope: "leaderboard", id, name: row.nickname, avatarUrl: row.avatarUrl ? api.assetUrl(row.avatarUrl) : "", initial: row.initial }, "/api/leaderboard/players/" + encodeURIComponent(id) + "/stats", () => this.data.report?.month === this.data.month);
  },
  retryPlayerCard() { if (this.data.playerCard) return this.openMonthlyPlayer({ currentTarget: { dataset: { id: this.data.playerCard.id } } }); },
  blockScroll() {},
  back: backToMe,
});
