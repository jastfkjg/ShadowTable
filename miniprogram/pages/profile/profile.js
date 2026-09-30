const api = require("../../api");
const { presentProfile, backToMe, personalPreview } = require("../../profile");
const builtinAvatars = require("../../builtin-avatars");
function presetId(url) {
  return builtinAvatars.find(item => url?.endsWith("/api/avatars/" + item.hash))?.id || "";
}
Page({
  data: { loading: true, busy: false, choosing: false, error: "", conflict: false, dirty: false, pendingSave: false, nickname: "", editingNickname: false, nicknameError: "", keyboardHeight: 0, avatarPreview: "", selectedAvatar: "", builtinAvatars, initial: "友", profile: null },
  onLoad() {
    this.alive = true;
    const pages = getCurrentPages();
    this.setData({ backLabel: pages[pages.length - 2]?.route === "pages/leaderboard/leaderboard" ? "返回排行榜" : "返回我的" });
    const preview = personalPreview("profile");
    if (preview) {
      this.original = preview;
      this.setData({ profile: preview, nickname: preview.nickname, avatarPreview: preview.avatarUrl, selectedAvatar: presetId(preview.avatarUrl), initial: preview.initial });
    }
    return this.load({ preserveEdits: true });
  },
  onUnload() { this.alive = false; },
  async load({ preserveEdits = false } = {}) {
    if (this.data.busy) return;
    this.setData({ loading: true, error: "", conflict: false });
    try {
      await api.login();
      const profile = await api.request("/api/me/profile");
      if (!this.alive) return;
      // A background refresh must never replace edits started from the preview.
      if (preserveEdits && (this.data.dirty || this.data.editingNickname || this.data.choosing || this.pending)) return;
      this.original = profile; this.avatar = undefined; this.pending = null;
      const shown = presentProfile(profile);
      this.setData({ profile: shown, nickname: profile.nickname, avatarPreview: shown.avatarUrl, selectedAvatar: presetId(profile.avatarUrl), initial: shown.initial, dirty: false, pendingSave: false, editingNickname: false, nicknameError: "", keyboardHeight: 0 });
      wx.disableAlertBeforeUnload?.();
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { if (this.alive) this.setData({ loading: false }); }
  },
  markDirty() {
    const dirty = this.data.nickname.trim() !== (this.original?.nickname || "") || this.avatar !== undefined;
    this.setData({ dirty });
    if (dirty) wx.enableAlertBeforeUnload?.({ message: "资料尚未保存，离开会丢失修改" });
    else wx.disableAlertBeforeUnload?.();
  },
  inputName(e) {
    if (this.pending || this.data.busy) return;
    this.setData({ nickname: e.detail.value, initial: (e.detail.value.trim() || "友").slice(0,1), error: "", nicknameError: "" }); this.markDirty();
  },
  editNickname() {
    if (this.pending || this.data.busy || !this.data.profile) return;
    this.setData({ editingNickname: true, nicknameError: "" });
    wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
  },
  finishNicknameEdit(e) {
    if (this.pending || this.data.busy) return;
    if (typeof e?.detail?.value === "string") this.inputName(e);
    const nickname = this.data.nickname.trim();
    if (!nickname || nickname.length > 16) {
      this.setData({ nicknameError: "请输入1–16个字符的昵称" });
      return;
    }
    this.setData({ nickname, editingNickname: false, nicknameError: "", keyboardHeight: 0 });
    this.markDirty();
  },
  keyboardHeightChange(e) {
    this.setData({ keyboardHeight: this.data.editingNickname ? Math.max(0, e.detail.height || 0) : 0 });
  },
  chooseBuiltinAvatar(e) {
    if (!this.original || this.data.busy || this.pending || this.data.choosing) return;
    const preset = builtinAvatars.find(item => item.id === e.currentTarget.dataset.id);
    if (!preset) return;
    this.avatar = presetId(this.original.avatarUrl) === preset.id ? undefined : "builtin:" + preset.id;
    this.setData({ avatarPreview: preset.path, selectedAvatar: preset.id, error: "" });
    this.markDirty();
  },
  async chooseAvatar(e) {
    if (this.data.busy || this.pending || this.data.choosing || !e.detail.avatarUrl) return;
    this.setData({ choosing: true, error: "" });
    try {
      const url = e.detail.avatarUrl;
      const canvas = await new Promise((resolve, reject) => wx.createSelectorQuery().in(this).select('#avatar-canvas').fields({ node: true, size: true }).exec(rows => rows[0]?.node ? resolve(rows[0].node) : reject(new Error("无法处理头像，请重试"))));
      canvas.width = 256; canvas.height = 256;
      const img = canvas.createImage();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("图片无法读取，请重新选择")); img.src = url; });
      const side = Math.min(img.width, img.height), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,256,256);
      ctx.drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0,0,256,256);
      const file = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.85, destWidth: 256, destHeight: 256, success: resolve, fail: reject }, this));
      const read = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: file.tempFilePath, encoding: 'base64', success: resolve, fail: reject }));
      if (!this.alive) return;
      this.avatar = 'data:image/jpeg;base64,' + read.data;
      this.setData({ avatarPreview: file.tempFilePath, selectedAvatar: "" }); this.markDirty();
    } catch (e) { if (this.alive) this.setData({ error: e.message || "头像处理失败，请重新选择" }); }
    finally { if (this.alive) this.setData({ choosing: false }); }
  },
  removeAvatar() {
    if (this.data.busy || this.pending || this.data.choosing) return;
    this.avatar = this.original?.avatarUrl ? null : undefined;
    this.setData({ avatarPreview: "", selectedAvatar: "", error: "" }); this.markDirty();
  },
  async save(e) {
    if (this.data.busy || this.data.loading || this.data.choosing || this.data.conflict) return;
    if (!this.pending) {
      const nickname = (e?.detail?.value?.nickname ?? this.data.nickname).trim();
      this.setData({ nickname });
      if (!nickname || nickname.length > 16) {
        this.editNickname();
        return this.setData({ nicknameError: "请输入1–16个字符的昵称" });
      }
      this.pending = { id: api.requestId(), data: { nickname, version: this.original.version, ...(this.avatar !== undefined ? { avatar: this.avatar } : {}) } };
    }
    this.setData({ busy: true, error: "", pendingSave: true, editingNickname: false, nicknameError: "", keyboardHeight: 0 });
    try {
      await api.login();
      await api.request("/api/me/profile", "POST", this.pending.data, this.pending.id);
      this.pending = null;
      if (!this.alive) return;
      this.setData({ dirty: false, pendingSave: false }); wx.disableAlertBeforeUnload?.();
      wx.showToast({ title: "资料已保存", icon: "success" }); backToMe();
    } catch (e) {
      if (e.status && e.status < 500 && ![401,429].includes(e.status)) this.pending = null;
      if (this.alive) {
        this.setData({ error: e.message, conflict: e.status === 409, pendingSave: !!this.pending });
        wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
      }
    } finally { if (this.alive) this.setData({ busy: false }); }
  },
  async reload() {
    if (this.data.dirty) {
      const yes = await new Promise(resolve => wx.showModal({ title: "重新载入资料？", content: "当前未保存的修改将丢弃。", success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (!yes) return;
    }
    await this.load();
  },
  async back() {
    if (this.data.busy || this.data.choosing) return;
    if (this.data.dirty || this.pending) {
      const yes = await new Promise(resolve => wx.showModal({ title: "离开编辑资料？", content: this.pending ? "保存结果尚未确认，建议先重试保存。仍要离开吗？" : "未保存的修改将丢弃。", success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (!yes) return;
    }
    wx.disableAlertBeforeUnload?.(); backToMe();
  },
});
