const api = require("../../api");
const types = require("./types");
const dialog = require("../../dialog");
const { backToMe } = require("../../profile");
const maxBytes = 1024 * 1024;
const readPhoto = path => new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
  filePath: path, encoding: "base64", success: res => resolve(res.data),
  fail: () => reject(new Error("截图读取失败，请移除后重新选择")),
}));

async function preparePhoto(file) {
  if (file.size <= maxBytes) return file.tempFilePath;
  const compressed = await new Promise((resolve, reject) => wx.compressImage({
    src: file.tempFilePath, quality: 65, compressedWidth: 1080, success: resolve,
    fail: () => reject(new Error("截图压缩失败，请选择较小的图片")),
  }));
  const info = await new Promise((resolve, reject) => wx.getFileSystemManager().getFileInfo({
    filePath: compressed.tempFilePath, success: resolve, fail: () => reject(new Error("截图读取失败，请重新选择")),
  }));
  if (info.size > maxBytes) throw new Error("压缩后仍超过 1 MB，请裁剪截图后再添加");
  return compressed.tempFilePath;
}

Page({
  data: { type: types[0], areas: ["牌桌", "对局记录", "我的", "其他"], area: "", content: "",
    photos: [], choosing: false, saving: false, ready: false, guardPaused: false, error: "" },
  onLoad(options) {
    this.alive = true;
    this.setData({ type: types.find(type => type.id === options.type) || types[0] });
  },
  onUnload() { this.alive = false; },
  async back() {
    if (this.confirmingLeave || this.data.saving || this.data.choosing || this.leaving) return;
    if (!this.data.ready && !this.data.photos.length) return backToMe();
    this.confirmingLeave = true;
    wx.hideKeyboard?.();
    try {
      const { confirm } = await dialog.show({
        title: "放弃这条反馈？",
        content: this.data.photos.length ? "离开后，已填写的内容和添加的截图都会丢失。" : "离开后，已填写的内容将无法找回。",
        cancelText: "继续编辑", confirmText: "放弃反馈", danger: true,
      });
      if (!confirm || !this.alive) return;
      this.leaving = true;
      // Wait for the native container to leave before popping the actual page.
      this.setData({ guardPaused: true });
    } finally { this.confirmingLeave = false; }
  },
  onGuardClosed() {
    if (!this.alive) return;
    if (this.leaving) return backToMe();
    if (this.data.guardPaused || !(this.data.ready || this.data.photos.length)) return;
    // A native back closes the page-container first. Rearm it for the next back,
    // including another back gesture while the confirmation is on screen.
    this.setData({ guardPaused: true }, () => {
      if (this.alive && !this.leaving) this.setData({ guardPaused: false });
    });
    return this.back();
  },
  edit(patch) {
    if (this.data.saving) return;
    this.key = null;
    this.setData({ ...patch, error: "" });
  },
  input(e) { this.edit({ content: e.detail.value, ready: !!e.detail.value.trim() }); },
  area(e) {
    const field = e.currentTarget.dataset.area;
    this.edit({ area: this.data.area === field ? "" : field });
  },
  async choose() {
    if (this.data.choosing || this.data.saving || this.data.photos.length >= 4) return;
    this.setData({ choosing: true, error: "" });
    const photos = [...this.data.photos];
    try {
      const selection = await new Promise((resolve, reject) => wx.chooseMedia({
        count: 4 - photos.length, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"],
        success: resolve, fail: reject,
      }));
      for (const file of selection.tempFiles) {
        const path = await preparePhoto(file);
        if (!photos.includes(path)) photos.push(path);
      }
      if (this.alive) this.edit({ photos });
    } catch (e) {
      if (this.alive && !/cancel/i.test(e.errMsg || "")) {
        this.edit({ photos });
        this.setData({ error: e.message || "未能添加截图，请检查相册权限后重试" });
      }
    } finally { if (this.alive) this.setData({ choosing: false }); }
  },
  remove(e) { if (!this.data.choosing) this.edit({ photos: this.data.photos.filter(path => path !== e.currentTarget.dataset.path) }); },
  preview(e) { wx.previewImage({ current: e.currentTarget.dataset.path, urls: this.data.photos }); },
  async submit() {
    if (!this.data.ready || this.data.saving || this.data.choosing) return;
    this.setData({ saving: true, error: "" });
    if (!this.key) this.key = api.requestId();
    try {
      await api.login();
      const { type, area, content, photos } = this.data;
      const images = await Promise.all(photos.map(readPhoto));
      if (!this.alive) return;
      const result = await api.request("/api/me/feedback", "POST", { category: type.label, area, content, images }, this.key);
      if (!this.alive) return;
      this.setData({ ready: false, content: "", area: "", photos: [] });
      this.key = null;
      wx.redirectTo({ url: "history?id=" + result.id, fail: () => this.setData({ error: "反馈已提交，可返回「我的反馈」查看。" }) });
    } catch (e) {
      if (this.alive) this.setData({ error: e.message || "提交失败，内容已保留，请重试" });
    } finally { if (this.alive) this.setData({ saving: false }); }
  },
});
