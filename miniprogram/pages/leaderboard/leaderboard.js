const api = require("../../api");
const { metrics, presentLeaderboard } = require("../../leaderboard");
const { backToMe } = require("../../profile");
Page({
  data: { metrics, metric: "games", period: "all", loading: true, loadingMore: false, error: "", moreError: false, notice: "", board: null },
  onLoad() { this.alive = true; },
  onShow() { return this.load(); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(more = false, selection = {}) {
    if (more && (this.data.loading || this.data.loadingMore || !this.data.board?.hasMore)) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const { metric, period, board } = { ...this.data, ...selection };
    this.failedSelection = null;
    // Keep the rendered snapshot mounted until the replacement is ready.
    this.setData({ ...selection, loading: !more, loadingMore: more, error: "", moreError: more, notice: "" });
    try {
      await api.login();
      const query = "?metric=" + metric + "&period=" + period + (more ? "&offset=" + board.nextOffset + "&version=" + board.version : "");
      const result = presentLeaderboard(await api.request("/api/leaderboard" + query));
      if (!this.alive || sequence !== this.sequence) return;
      if (more) result.rows = board.rows.concat(result.rows);
      this.setData({ board: result, loading: false, loadingMore: false });
    } catch (e) {
      if (!this.alive || sequence !== this.sequence) return;
      if (more && e.status === 409) {
        await this.load();
        if (this.alive && sequence + 1 === this.sequence && !this.data.error)
          this.setData({ notice: "榜单已更新，已重新加载。" });
      } else {
        this.failedSelection = { metric, period };
        this.setData({ error: e.message, loading: false, loadingMore: false,
          ...(!more && board ? { metric: board.metric, period: board.period } : {}) });
      }
    }
  },
  chooseMetric(e) {
    const metric = e.currentTarget.dataset.id;
    if (!metrics.some(item => item.id === metric) || metric === this.data.metric) return;
    return this.load(false, { metric });
  },
  choosePeriod(e) {
    const period = e.currentTarget.dataset.id;
    if (!["all", "month"].includes(period) || period === this.data.period) return;
    return this.load(false, { period });
  },
  loadMore() { return this.load(true); },
  retry() { return this.load(this.data.moreError, this.failedSelection || {}); },
  editProfile() { wx.navigateTo({ url: "/pages/profile/profile" }); },
  back: backToMe,
});
