const { backToMe } = require("../../profile");
// Keep old links working while all match details use the retained records UI.
Page({
  data: { error: "" },
  onLoad(options = {}) { this.alive = true; this.id = options.id || ""; return this.openRecords(); },
  onUnload() { this.alive = false; },
  openRecords() {
    if (this.opening || !this.alive) return;
    if (!this.id) { this.setData({ error: "对局记录不存在或已移除" }); return; }
    this.opening = true; this.setData({ error: "" });
    wx.redirectTo({ url: "/pages/matches/matches?match=" + encodeURIComponent(this.id),
      fail: () => { if (this.alive) this.setData({ error: "暂时无法打开，请重试" }); },
      complete: () => { this.opening = false; } });
  },
  back: backToMe,
});
