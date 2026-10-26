const shares = require("../../records-share");
const api = require("../../api");
const { present } = require("../../shared-record-view");
module.exports = function createSharedPage() { return {
  data: { loading: true, error: "", sharedRecord: null, intro: null, singlePage: false, authoring: false, posterAvailable: false },
  onLoad(options = {}) {
    this.alive = true;
    this.foreground = true;
    this.singlePage = shares.isSinglePage();
    this.shareId = options.share;
    if (options.share == null && shares.introFor(options.intro)) {
      this.introTab = options.intro;
      this.setData({ loading: false, intro: shares.introFor(options.intro), singlePage: this.singlePage });
      wx.setNavigationBarTitle?.({ title: this.data.intro.label });
      if (!this.singlePage) wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      return;
    }
    if (!this.shareId && !this.singlePage && ["stats", "match", "fun"].includes(options.kind)) {
      this.selection = options.kind === "stats" ? { kind: "stats" } : options.kind === "match" ? { kind: "match", match: options.match }
        : { kind: "fun", metric: options.metric, mode: options.mode };
      this.setData({ authoring: true, posterAvailable: options.kind === "stats" });
    }
    return this.loadSharedRecord();
  },
  async loadSharedRecord() {
    if (this.fetching) return;
    this.fetching = true;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.snapshot = null;
    this.setData({ loading: true, error: "", sharedRecord: null });
    if (!this.singlePage) wx.hideShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
    try {
      const snapshot = this.selection ? await shares.create(this.selection) : await shares.read(this.shareId);
      if (!this.alive || sequence !== this.sequence) return;
      if (!shares.validId(snapshot?.id)) throw new Error("分享内容暂时不可用，请重试。");
      const sharedRecord = present(snapshot, api.assetUrl);
      this.snapshot = snapshot;
      this.setData({ sharedRecord });
      if (this.foreground) {
        wx.setNavigationBarTitle?.({ title: sharedRecord.pageTitle });
        if (!this.singlePage) wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      }
    } catch (error) {
      if (this.alive && sequence === this.sequence) this.setData({ error: error.message });
    } finally {
      this.fetching = false;
      if (this.alive && sequence === this.sequence) this.setData({ loading: false });
    }
  },
  retrySharedRecord() { if (!this.introTab) return this.loadSharedRecord(); },
  openPersonalRecords() {
    if (!this.alive || this.singlePage || !this.introTab || this.openingPersonal) return;
    this.openingPersonal = true;
    wx.redirectTo({ url: "/pages/stats/stats?tab=" + this.introTab,
      fail: () => { if (this.alive) wx.showToast?.({ title: "暂时无法打开，请重试", icon: "none" }); },
      complete: () => { this.openingPersonal = false; },
    });
  },
  onShow() {
    this.foreground = true;
    if (this.alive && (this.snapshot || this.introTab)) {
      wx.setNavigationBarTitle?.({ title: this.data.intro?.label || this.data.sharedRecord.pageTitle });
      if (!this.singlePage) wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
    }
  },
  onHide() { this.foreground = false; },
  sharedAvatarError() { if (this.data.sharedRecord) this.setData({ sharedRecord: { ...this.data.sharedRecord, avatar: "" } }); },
  sharedPoster() {
    if (this.data.authoring && this.data.posterAvailable && this.snapshot && !this.data.loading)
      wx.navigateTo({ url: "/pages/share/share?kind=stats" });
  },
  onShareAppMessage() { return shares.friendContent(this.introTab || "records", this.snapshot); },
  onShareTimeline() { return shares.timelineContent(this.introTab || "records", this.snapshot); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; this.snapshot = null; },
}; };
