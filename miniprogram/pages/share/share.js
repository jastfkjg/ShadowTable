const api = require("../../api");
const cards = require("../../share-card");
const { renderImage } = require("../../share-image");
const { backToMe } = require("../../profile");
Page({
  data: { loading: true, rendering: false, acting: false, error: "", actionError: "", imagePath: "", description: "", albumDenied: false, imageMenu: true },
  onLoad(options = {}) {
    this.alive = true;
    this.setData({ imageMenu: typeof wx.showShareImageMenu === "function" && (!wx.canIUse || wx.canIUse("showShareImageMenu")) });
    try { this.selection = cards.parseSelection(options); }
    catch (error) { this.setData({ loading: false, error: error.message }); return; }
    return this.load();
  },
  onReady() { this.canvasReady = true; if (this.card) return this.render(); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; this.card = null; },
  async load() {
    if (!this.selection || this.fetching || this.data.rendering || this.data.acting) return;
    this.fetching = true;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.card = null;
    this.setData({ loading: true, imagePath: "", error: "", actionError: "", description: "" });
    try {
      await api.login();
      const { kind, ...query } = this.selection;
      const [profile, result] = await Promise.all([api.request("/api/me/profile"), api.request(kind === "leaderboard" ? "/api/leaderboard?" + cards.queryString(query) : "/api/me/stats")]);
      if (!this.alive || sequence !== this.sequence) return;
      const now = Date.now();
      this.card = kind === "leaderboard" ? cards.leaderboardCard(profile, result)
        : kind === "stats" ? cards.statsCard(profile, result, now) : cards.funCard(profile, result, query.card, query.metric, now);
      this.setData({ description: cards.describe(this.card) });
    } catch (error) { if (this.alive && sequence === this.sequence) this.setData({ error: error.message }); }
    finally { this.fetching = false; if (this.alive && sequence === this.sequence) this.setData({ loading: false }); }
    if (this.alive && sequence === this.sequence && this.card && this.canvasReady) await this.render();
  },
  async render() {
    if (!this.card || !this.canvasReady || this.data.rendering || this.data.acting) return;
    const card = this.card, sequence = this.sequence;
    this.setData({ rendering: true, imagePath: "", error: "", actionError: "", albumDenied: false });
    try {
      const path = await renderImage(this, card);
      if (this.alive && sequence === this.sequence && card === this.card) this.setData({ imagePath: path });
    } catch (error) { if (this.alive && sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (this.alive) this.setData({ rendering: false }); }
  },
  retry() { return this.card ? this.render() : this.load(); },
  preview() {
    if (this.data.imagePath && !this.data.acting) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] });
  },
  send() {
    if (!this.data.imagePath || this.data.acting || this.data.rendering) return;
    if (!this.data.imageMenu) { this.setData({ actionError: "当前微信不支持直接发送，请保存图片后在聊天中发送。" }); return; }
    this.setData({ acting: true, actionError: "" });
    wx.showShareImageMenu({ path: this.data.imagePath,
      fail: error => { if (this.alive && !/cancel/i.test(error.errMsg || "")) this.setData({ actionError: "暂时无法发送，可重试或保存图片后发送。" }); },
      complete: () => { if (this.alive) this.setData({ acting: false }); },
    });
  },
  save() {
    if (!this.data.imagePath || this.data.acting || this.data.rendering) return;
    this.setData({ acting: true, actionError: "", albumDenied: false });
    wx.saveImageToPhotosAlbum({ filePath: this.data.imagePath,
      success: () => { if (this.alive) wx.showToast({ title: "已保存到相册", icon: "success" }); },
      fail: error => {
        if (!this.alive || /cancel/i.test(error.errMsg || "")) return;
        const denied = /auth|denied|authorize/i.test(error.errMsg || "");
        const alternative = this.data.imageMenu ? "也可以直接发给好友。" : "";
        this.setData({ albumDenied: denied, actionError: (denied ? "保存需要相册权限，可前往设置开启。" : "保存失败，请重试。") + alternative });
      },
      complete: () => { if (this.alive) this.setData({ acting: false }); },
    });
  },
  openAlbumSettings() {
    wx.openSetting({ success: result => { if (this.alive && result.authSetting?.["scope.writePhotosAlbum"]) this.setData({ albumDenied: false, actionError: "权限已开启，请再次点击保存图片。" }); } });
  },
  imageError(event) {
    if (this.alive && event.currentTarget.dataset.path === this.data.imagePath)
      this.setData({ imagePath: "", error: "图片暂时无法显示，请重新生成。" });
  },
  back: backToMe,
});
