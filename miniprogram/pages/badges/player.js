const api = require("../../api");
const { playerCollectionPath, presentPlayerCollection } = require("../../badges");

Page({
  data: { collection: null, loading: true, error: "", avatarFailed: false },
  onLoad(options) {
    this.path = playerCollectionPath(options.scope, options.id);
    this.sequence = 0;
  },
  onShow() { return this.load(); },
  onHide() { this.sequence++; },
  onUnload() { this.sequence++; },
  async onPullDownRefresh() {
    try { await this.load(); } finally { wx.stopPullDownRefresh(); }
  },
  async load() {
    const sequence = ++this.sequence;
    this.setData({ loading: true, error: "", collection: null, avatarFailed: false });
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
  avatarError() { this.setData({ avatarFailed: true }); },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/lobby/lobby" }) }); },
});
