const api = require("../../api");
const { backToMe } = require("../../profile");

function present(row) {
  return { ...row, date: new Date(row.created).toLocaleString("zh-CN", { hour12: false }),
    replyDate: row.repliedAt ? new Date(row.repliedAt).toLocaleString("zh-CN", { hour12: false }) : "",
    images: Array.from({ length: row.photos }, (_, index) => index) };
}
Page({
  data: { items: [], expanded: 0, next: null, loading: true, error: "", imageBusy: false },
  back: backToMe,
  onLoad(options) { this.setData({ expanded: Number(options.id) || 0 }); },
  onShow() {
    this.active = true;
    this.setData({ imageBusy: false });
    return this.load(false);
  },
  onHide() { this.active = false; },
  onUnload() { this.active = false; },
  onPullDownRefresh() { return this.load(false).finally(() => wx.stopPullDownRefresh()); },
  toggle(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.setData({ expanded: this.data.expanded === id ? 0 : id });
  },
  more() { if (!this.data.loading && this.data.next) return this.load(true); },
  retry() { return this.load(this.failedMore); },
  async load(more) {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const current = () => this.active && sequence === this.sequence;
    if (this.account !== wx.getStorageSync("session")) {
      this.setData({ items: [], next: null });
      more = false;
    }
    this.setData({ loading: true, error: "" });
    try {
      await api.login();
      if (!current()) return;
      this.account = wx.getStorageSync("session");
      const page = await api.request("/api/me/feedback" + (more ? "?before=" + this.data.next : ""));
      if (current()) this.setData({ items: [...(more ? this.data.items : []), ...page.items.map(present)], next: page.next });
    } catch (e) { if (current()) { this.failedMore = more; this.setData({ error: e.message }); } }
    finally { if (current()) this.setData({ loading: false }); }
  },
  async preview(e) {
    if (this.data.imageBusy) return;
    const { id, index } = e.currentTarget.dataset;
    this.setData({ imageBusy: true });
    try {
      await api.login();
      const path = await new Promise((resolve, reject) => wx.downloadFile({
        url: api.assetUrl('/api/me/feedback/' + id + '/images/' + index),
        header: { Authorization: 'Bearer ' + wx.getStorageSync('session') },
        success: res => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error("截图暂时无法打开")),
        fail: () => reject(new Error("截图加载失败，请检查网络后重试")),
      }));
      if (this.active) wx.previewImage({ urls: [path] });
    } catch (e) { if (this.active) wx.showToast({ title: e.message, icon: "none" }); }
    finally { if (this.active) this.setData({ imageBusy: false }); }
  },
});
