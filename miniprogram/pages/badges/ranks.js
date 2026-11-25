const { measureBadgeDetail } = require("./detail-layout");
const api = require("../../api");
const { create } = require("./rank-controller");
Page({
  data: { rank: null, badgeDetailHeight: 0 },
  onLoad(options) {
    const kind = options.kind === "fun" ? "fun" : "honor";
    const player = /^(self|[a-f0-9]{32})$/.test(options.player || "")
      ? options.player
      : "";
    this.controller = create(
      {
        request: async (...args) => {
          await api.login();
          return api.request(...args);
        },
        assetUrl: api.assetUrl,
        update: (rank) => {
          const opened = rank.selectedBadge && rank.selectedBadge.id !== this.data.rank?.selectedBadge?.id;
          this.setData({ rank, ...(opened ? { badgeDetailHeight: 0 } : {}) }, opened ? () => this.measureBadgeDetail() : undefined);
        },
      },
      kind,
      player,
    );
  },
  onShow() {
    this.alive = true;
    if (this.controller.state.player || !this.controller.state.board)
      return this.controller.load();
  },
  onHide() {
    this.alive = false;
    this.controller.pause();
  },
  onUnload() {
    this.alive = false;
    this.controller.pause();
  },
  async onPullDownRefresh() {
    try {
      if (!this.controller.state.saving) await this.controller.load();
    } finally {
      wx.stopPullDownRefresh();
    }
  },
  select(e) {
    if (e.currentTarget.dataset.kind !== this.controller.state.kind) {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      return this.controller.select(e.currentTarget.dataset.kind);
    }
  },
  more() {
    return this.controller.load(true);
  },
  onReachBottom() {
    if (!this.controller.state.player && !this.controller.state.error)
      return this.more();
  },
  retry() {
    return this.controller.load();
  },
  open(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url:
        "/pages/badges/ranks?kind=" +
        this.controller.state.kind +
        "&player=" +
        id,
    });
  },
  openBadge(e) { this.controller.openBadge(e.currentTarget.dataset.id); },
  closeBadgeDetail() { this.controller.closeBadge(); },
  measureBadgeDetail,
  onResize() { this.measureBadgeDetail(); },
  blockScroll() {},
  toggle(e) {
    return this.controller.visibility(e.detail.value);
  },
  back() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: "/pages/badges/badges" }),
    });
  },
});
