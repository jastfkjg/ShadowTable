const api = require("../../api");
const { create } = require("./rank-controller");
Page({
  data: { rank: null },
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
        update: (rank) => this.setData({ rank }),
      },
      kind,
      player,
    );
  },
  onShow() {
    if (this.controller.state.player || !this.controller.state.board)
      return this.controller.load();
  },
  onHide() {
    this.controller.pause();
  },
  onUnload() {
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
  toggle(e) {
    return this.controller.visibility(e.detail.value);
  },
  back() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: "/pages/badges/badges" }),
    });
  },
});
