const api = require("../../api");
const monthly = require("../../monthly-report");
const { initialPlayerCardData, playerCardMethods } = require("../../player-card");
const { backToMe } = require("../../profile");
Page({
  data: { ...initialPlayerCardData, month: "", maxMonth: monthly.monthAt(), minMonth: "2000-01", report: null, loading: true, error: "", category: "overall", entertainment: false, detailBoards: [], shareOpening: false, rulesExpanded: false, navTop: 64 },
  ...playerCardMethods(api),
  onLoad(options = {}) {
    this.alive = true; this.foreground = true;
    const info = wx.getWindowInfo?.() || wx.getSystemInfoSync?.() || {}, status = info.statusBarHeight || 20, menu = wx.getMenuButtonBoundingClientRect?.();
    const gap = menu && menu.top > status ? menu.top - status : 6;
    this.setData({ month: /^20\d{2}-(0[1-9]|1[0-2])$/.test(options.month || "") ? options.month : monthly.monthAt(), navTop: status + (menu?.height ? menu.height + gap * 2 : 44) });
  },
  onShow() { this.foreground = true; return this.load(); },
  onHide() { this.foreground = false; this.closePlayerCard(); this.closeRules(); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; this.closePlayerCard(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(month = this.data.month) {
    this.closePlayerCard();
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ month, loading: true, error: "", rulesExpanded: false,
      ...(this.data.report?.month === month ? {} : { report: null, detailBoards: [] }) });
    try {
      await api.login();
      const response = await api.request("/api/monthly-report?month=" + encodeURIComponent(month));
      if (!this.alive || sequence !== this.sequence || this.foreground === false) return;
      const report = monthly.presentReport(response);
      for (const board of report.funBoards) {
        const role = /^percival_/.test(board.metric) ? "percival" : /^merlin_/.test(board.metric) ? "merlin" : /^assassin_/.test(board.metric) ? "assassin" : "";
        board.portrait = role ? "/assets/roles/" + role + ".png" : "";
      }
      for (const board of [...report.mainBoards, ...report.funBoards]) for (const row of board.rows) row.avatarSrc = row.avatarUrl ? api.assetUrl(row.avatarUrl) : "";
      this.setData({ report, maxMonth: report.currentMonth, minMonth: report.firstMonth < month ? report.firstMonth : month,
        detailBoards: monthly.detailBoards(report, "count", this.data.entertainment) });
    } catch (error) {
      if (this.alive && sequence === this.sequence) this.setData({ error: error.status === 404 ? "当前服务尚未开放月度战报，请更新服务端后重试。" : error.message,
        ...(error.status && error.status < 500 && ![401,429].includes(error.status) ? { report:null, detailBoards:[] } : {}) });
    } finally { if (this.alive && sequence === this.sequence) this.setData({ loading: false }); }
  },
  chooseMonth(e) { const month = e.detail.value; if (month !== this.data.month) return this.load(month); },
  retry() { return this.load(); },
  chooseCategory(e) {
    const category = e.currentTarget.dataset.id;
    if (!["overall", "honors", "fun"].includes(category) || !this.data.report) return;
    const entertainment = category === "fun";
    this.setData({ category, entertainment, detailBoards: monthly.detailBoards(this.data.report, "count", entertainment) });
  },
  chooseEdition(e) { return this.chooseCategory(e); },
  openRules() { if (this.data.report) this.setData({ rulesExpanded: true }); },
  closeRules() { this.setData({ rulesExpanded: false }); },
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
