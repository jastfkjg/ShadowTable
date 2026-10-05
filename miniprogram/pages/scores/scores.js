const api = require("../../api");
const { backToMe } = require("../../profile");
const { presentEntries, signed } = require("./presentation");
Page({
  data: { loading: true, loadingMore: false, loaded: false, error: "", moreError: "", notice: "", records: [], summary: null, total: 0, hasMore: false },
  onLoad() { this.alive = true; return this.load(); },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    this.fetching = true;
    this.setData({ loading: true, error: "", moreError: "" });
    try {
      await api.login();
      const result = await api.request("/api/me/score-ledger?offset=0");
      if (this.alive) this.applyResult(result, false);
    } catch (error) { if (this.alive) this.setData({ error: error.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  applyResult(result, append) {
    this.revision = result.revision;
    this.setData({ records: (append ? this.data.records : []).concat(presentEntries(result.records)),
      summary: { ...result.summary, adjustmentLabel: signed(result.summary.adjustmentPoints) },
      total: result.total, hasMore: result.hasMore, loaded: true });
  },
  async loadMore() {
    if (this.fetching || !this.data.hasMore || this.data.moreError || this.data.error) return;
    this.fetching = true;
    this.setData({ loadingMore: true });
    let changed = false;
    try {
      const result = await api.request(`/api/me/score-ledger?offset=${this.data.records.length}&revision=${this.revision}`);
      if (this.alive) this.applyResult(result, true);
    } catch (error) {
      if (this.alive) {
        changed = error.status === 409;
        this.setData(changed ? { notice: "积分明细有更新，已重新读取。" } : { moreError: error.message });
      }
    } finally { this.fetching = false; if (this.alive) this.setData({ loadingMore: false }); }
    if (changed && this.alive) {
      this.setData({ records: [], loaded: false, hasMore: false, summary: null });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      return this.load();
    }
  },
  retryMore() { this.setData({ moreError: "" }); return this.loadMore(); },
  onReachBottom() { return this.loadMore(); },
  async onPullDownRefresh() {
    this.setData({ notice: "" });
    try { await this.load(); } finally { wx.stopPullDownRefresh(); }
  },
  openMatch(event) {
    if (this.opening) return;
    const record = this.data.records.find(row => row.id === event.currentTarget.dataset.id && row.isMatch);
    if (!record) return;
    this.opening = true;
    wx.navigateTo({ url: "/pages/match-detail/match-detail?id=" + encodeURIComponent(record.matchId),
      fail: () => { if (this.alive) wx.showToast({ title: "暂时无法打开，请重试", icon: "none" }); },
      complete: () => { this.opening = false; } });
  },
  showExplanation() {
    wx.showModal({ title: "积分说明", content: "当前总积分 = 对局积分 + 积分调整。\n\n对局积分按最新结算结果展示；更正或移除对局后会同步更新。积分调整保留操作时的总积分。\n\n日期和时间均为北京时间。", showCancel: false, confirmText: "知道了" });
  },
  back: backToMe,
});
