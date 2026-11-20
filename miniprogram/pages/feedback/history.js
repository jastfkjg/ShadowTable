const api = require("../../api");
const { backToMe } = require("../../profile");
const types = require("./types");
const screenshots = require("./screenshots");

function formatTime(value) {
  const date = new Date(value);
  const padded = number => String(number).padStart(2, "0");
  return date.getFullYear() + "/" + padded(date.getMonth() + 1) + "/" + padded(date.getDate())
    + " " + padded(date.getHours()) + ":" + padded(date.getMinutes());
}
function present(row) {
  const type = types.find(option => option.label === row.category);
  return { ...row, icon: type ? type.id : "other", date: formatTime(row.created),
    replyDate: row.repliedAt ? formatTime(row.repliedAt) : "" };
}

Page({
  data: { items: [], expanded: 0, submitted: 0, photos: [], next: null, loading: true, error: "" },
  back: backToMe,
  onLoad(options) {
    const id = Number(options.id) || 0;
    this.setData({ expanded: id, submitted: id });
  },
  onShow() {
    this.active = true;
    if (this.returningFromPreview && !this.data.loading && this.account === wx.getStorageSync("session")) {
      this.returningFromPreview = false;
      return;
    }
    return this.load(false);
  },
  onHide() { this.active = false; },
  onUnload() {
    this.active = false;
    this.releasePhotos();
  },
  onPullDownRefresh() { return this.load(false).finally(() => wx.stopPullDownRefresh()); },
  toggle(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.setData({ expanded: this.data.expanded === id ? 0 : id });
    return this.showPhotos();
  },
  more() { if (!this.data.loading && this.data.next) return this.load(true); },
  retry() { return this.load(this.failedMore); },
  async load(more) {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const current = () => this.active && sequence === this.sequence;
    if (this.account !== undefined && this.account !== wx.getStorageSync("session")) {
      this.releasePhotos();
      this.setData({ items: [], next: null, expanded: 0, submitted: 0, photos: [] });
      more = false;
    }
    this.setData({ loading: true, error: "" });
    try {
      await api.login();
      if (!current()) return;
      const account = this.account = wx.getStorageSync("session");
      const page = await api.request("/api/me/feedback" + (more ? "?before=" + this.data.next : ""));
      if (!current() || account !== wx.getStorageSync("session")) return;
      this.setData({ items: [...(more ? this.data.items : []), ...page.items.map(present)], next: page.next });
      return this.showPhotos();
    } catch (e) { if (current()) { this.failedMore = more; this.setData({ error: e.message }); } }
    finally { if (current()) this.setData({ loading: false }); }
  },
  releasePhotos() {
    if (this.gallery) this.gallery.photos.forEach(photo => screenshots.remove(photo.src));
    this.gallery = null;
  },
  showPhotos() {
    const row = this.data.items.find(item => item.id === this.data.expanded);
    if (row && this.gallery?.id === row.id) return;
    this.releasePhotos();
    const photos = Array.from({ length: row?.photos || 0 }, (_, index) => ({ index, src: "", state: "loading" }));
    this.setData({ photos });
    if (!photos.length) return;
    const gallery = this.gallery = { id: row.id, photos, account: this.account };
    return Promise.all(photos.map(photo => this.loadPhoto(gallery, photo)));
  },
  async loadPhoto(gallery, photo) {
    const current = () => this.gallery === gallery && gallery.account === wx.getStorageSync("session");
    try {
      const bytes = await api.feedbackImage(gallery.id, photo.index);
      if (!current()) return;
      const path = await screenshots.write(bytes);
      if (!current()) { screenshots.remove(path); return; }
      photo.src = path;
      photo.state = "ready";
    } catch {
      if (this.gallery !== gallery) return;
      photo.state = "error";
    }
    this.setData({ photos: gallery.photos });
  },
  imageError(e) {
    const { id, index, src } = e.currentTarget.dataset;
    const photo = this.gallery?.photos[index];
    if (!photo || this.gallery.id !== Number(id) || photo.src !== src) return;
    screenshots.remove(photo.src);
    photo.src = "";
    photo.state = "error";
    this.setData({ photos: this.gallery.photos });
  },
  async preview(e) {
    const { id, index } = e.currentTarget.dataset;
    const gallery = this.gallery;
    if (!gallery || gallery.id !== Number(id) || gallery.account !== wx.getStorageSync("session")) {
      return this.load(false);
    }
    const photo = gallery.photos[index];
    if (!photo || photo.state === "loading") return;
    if (photo.state === "error") {
      photo.state = "loading";
      this.setData({ photos: gallery.photos });
      return this.loadPhoto(gallery, photo);
    }
    this.returningFromPreview = true;
    wx.previewImage({
      current: photo.src,
      urls: gallery.photos.filter(item => item.state === "ready").map(item => item.src),
      fail: () => {
        this.returningFromPreview = false;
        if (this.active) wx.showToast({ title: "截图暂时无法打开，请重试", icon: "none" });
      },
    });
  },
});
