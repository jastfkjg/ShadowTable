const api = require("../../api");
const monthly = require("../../monthly-report");
const monthlyCard = require("../../monthly-report-card");
const { renderImage } = require("../../share-image");
const { initialPlayerCardData, playerCardMethods } = require("../../player-card");
const { backToMe } = require("../../profile");

Page({
  data: { ...initialPlayerCardData, month: "", maxMonth: monthly.monthAt(), minMonth: "2000-01", report: null,
    imagePath: "", targets: [], description: "", loading: true, error: "", shareOpening: false, rulesExpanded: false, roster: null, navTop: 64 },
  ...playerCardMethods(api),
  onLoad(options = {}) {
    this.alive = true;
    this.foreground = true;
    this.sequence = 0;
    const info = wx.getWindowInfo?.() || wx.getSystemInfoSync?.() || {}, status = info.statusBarHeight || 20, menu = wx.getMenuButtonBoundingClientRect?.();
    const gap = menu && menu.top > status ? menu.top - status : 6;
    const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(options.month || "") ? options.month : monthly.monthAt();
    this.setData({ month, navTop: status + (menu?.height ? menu.height + gap * 2 : 44) });
  },
  onReady() {
    this.canvasReady = true;
    if (this.pendingPoster) return this.paint(this.pendingPoster);
  },
  onShow() { this.foreground = true; return this.collectionReturn ? this.restoreCollectionCard() : this.load(); },
  onHide() { this.foreground = false; this.closePlayerCard(); this.closeRules(); this.closeRoster(); },
  onUnload() { this.alive = false; ++this.sequence; this.poster = this.pendingPoster = this.sharePoster = null; this.closePlayerCard(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  current(sequence) { return this.alive && this.foreground && sequence === this.sequence; },
  clearPoster() {
    this.poster = this.pendingPoster = this.sharePoster = null;
    this.players = this.posterReport = null;
    this.setData({ imagePath: "", description: "", targets: [], roster: null });
  },
  async load(month = this.data.month, forShare = false) {
    const sequence = ++this.sequence;
    this.closePlayerCard();
    if (this.data.report?.month !== month) { this.clearPoster(); this.setData({ report: null }); }
    this.setData({ month, loading: true, error: "", rulesExpanded: false, roster: null });
    try {
      await api.login();
      const response = await api.request("/api/monthly-report?month=" + encodeURIComponent(month));
      if (!this.current(sequence)) return;
      const report = monthly.presentReport(response);
      const { monthLabel, canShare, rules } = report;
      this.setData({ report: { month, monthLabel, canShare, rules }, maxMonth: report.currentMonth,
        minMonth: report.firstMonth < month ? report.firstMonth : month });
      if (!canShare) { this.clearPoster(); this.setData({ loading: false }); return; }
      if (this.poster?.version === response.version && this.poster?.month === month &&
          (forShare || this.poster.card.asOf === report.asOfLabel)) {
        this.setData({ loading: false }); return this.poster;
      }
      this.clearPoster();
      const card = monthlyCard.cardFromReport(report);
      this.posterReport = report;
      this.players = new Map(report.groups.flatMap(group => group.boards.flatMap(board => board.rows.map(row => [row.publicId, row]))));
      this.pendingPoster = { card, targets:monthlyCard.playerTargets(card, report), month, version: response.version, sequence };
      if (this.canvasReady) return await this.paint(this.pendingPoster);
    } catch (error) {
      if (!this.current(sequence)) return;
      if (error.status && error.status < 500 && error.status !== 429) {
        this.clearPoster(); this.setData({ report: null });
      }
      this.setData({ loading: false, error: error.status === 404 ? "当前服务尚未开放月度战报，请更新服务端后重试。" : error.message });
    }
  },
  paint(poster) {
    this.pendingPoster = null;
    // A month change can start while WeChat is exporting the previous canvas.
    this.renderQueue = (this.renderQueue || Promise.resolve()).then(async () => {
      if (!this.current(poster.sequence)) return;
      try {
        const path = await renderImage(this, poster.card);
        if (!path || !this.current(poster.sequence)) return;
        this.poster = { card:poster.card, month:poster.month, version:poster.version, path };
        this.setData({ loading: false, imagePath: path, targets: poster.targets,
          description: monthlyCard.describe(poster.card) });
        return this.poster;
      } catch (error) {
        if (this.current(poster.sequence)) this.setData({ error: error.message, loading: false });
      }
    });
    return this.renderQueue;
  },
  chooseMonth(e) {
    if (e.detail.value !== this.data.month) {
      wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
      return this.load(e.detail.value);
    }
  },
  retry() { return this.load(); },
  imageError(e) {
    if (e.currentTarget.dataset.path !== this.data.imagePath) return;
    this.clearPoster();
    this.setData({ error: "图片暂时无法显示，请重试。" });
  },
  openRules() { if (this.data.report) this.setData({ rulesExpanded: true }); },
  closeRules() { this.setData({ rulesExpanded: false }); },
  async share() {
    if (!this.poster || this.data.loading || this.data.error || this.data.shareOpening) return;
    this.setData({ shareOpening: true });
    const poster = await this.load(this.data.month, true);
    if (!poster || !this.foreground || !this.alive || poster !== this.poster) {
      if (this.alive) this.setData({ shareOpening: false });
      return;
    }
    this.sharePoster = poster;
    wx.navigateTo({ url: "/pages/share/share?kind=monthly&month=" + poster.month,
      fail: () => { this.sharePoster = null; if (this.alive) wx.showToast({ title: "分享页暂时无法打开，请重试", icon: "none" }); },
      complete: () => { if (this.alive) this.setData({ shareOpening: false }); } });
  },
  takeSharePoster(month) {
    const poster = this.sharePoster;
    this.sharePoster = null;
    return poster?.month === month ? poster : null;
  },
  openMonthlyTarget(e) {
    const { id, board, rank } = e.currentTarget.dataset;
    if (id) return this.openMonthlyPlayer(e);
    if (!board || !this.poster || this.data.loading || this.data.error || !this.foreground) return;
    const roster = monthlyCard.rosterFor(this.posterReport, board, rank);
    if (roster) this.setData({ roster: { ...roster, members: roster.members.map(row => ({
      ...row, avatar: row.avatar ? api.assetUrl(row.avatar) : "",
    })) } });
  },
  closeRoster() { if (this.data.roster) this.setData({ roster: null }); },
  rosterAvatarError(e) {
    const { index, src } = e.currentTarget.dataset;
    if (this.data.roster?.members[index]?.avatar === src) this.setData({ ["roster.members[" + index + "].avatar"]: "" });
  },
  openMonthlyPlayer(e) {
    const id = e.currentTarget.dataset.id, row = this.players?.get(id);
    if (!row || this.data.loading || !this.foreground) return;
    this.closeRoster();
    return this.loadPlayerCard({ scope: "leaderboard", id, name: row.nickname, avatarUrl: row.avatarUrl ? api.assetUrl(row.avatarUrl) : "", initial: row.initial },
      "/api/leaderboard/players/" + encodeURIComponent(id) + "/stats", () => this.data.report?.month === this.data.month);
  },
  retryPlayerCard() { if (this.data.playerCard) return this.openMonthlyPlayer({ currentTarget: { dataset: { id: this.data.playerCard.id } } }); },
  blockScroll() {},
  back: backToMe,
});
