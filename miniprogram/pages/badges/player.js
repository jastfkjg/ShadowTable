const api = require("../../api");
const { measureBadgeDetail } = require("./detail-layout");
const { playerCollectionPath, presentPlayerCollection } = require("../../badges");

Page({
  data: { collection: null, loading: true, error: "", avatarFailed: false, selectedBadge: null, badgeDetailHeight: 0 },
  onLoad(options) {
    this.path = playerCollectionPath(options.scope, options.id);
    this.sequence = 0;
  },
  onShow() { this.alive = true; return this.load(); },
  onHide() { this.alive = false; this.sequence++; this.closeBadgeDetail(); },
  onUnload() { this.alive = false; this.sequence++; },
  async onPullDownRefresh() {
    try { await this.load(); } finally { wx.stopPullDownRefresh(); }
  },
  async load() {
    const sequence = ++this.sequence;
    this.setData({ loading: true, error: "", collection: null, avatarFailed: false, selectedBadge: null, badgeDetailHeight: 0 });
    try {
      if (!this.path) throw new Error("玩家徽章链接无效");
      await api.login();
      const result = await api.request(this.path);
      if (sequence === this.sequence) this.setData({ collection: presentPlayerCollection(result, api.assetUrl) });
    } catch (e) {
      if (sequence === this.sequence) this.setData({ error: e.message || "徽章读取失败，请重试" });
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  showBadgeDetail(e) {
    const { id } = e.currentTarget.dataset;
    const badge = this.data.collection?.groups.flatMap(group => group.items).find(item => item.id === id);
    if (badge) this.setData({ selectedBadge: badge, badgeDetailHeight: 0 }, () => this.measureBadgeDetail());
  },
  closeBadgeDetail() { this.setData({ selectedBadge: null, badgeDetailHeight: 0 }); },
  measureBadgeDetail,
  onResize() { this.measureBadgeDetail(); },
  blockScroll() {},
  avatarError() { this.setData({ avatarFailed: true }); },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/lobby/lobby" }) }); },
});
