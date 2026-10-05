const api = require("../../api");
const { presentProfile, backToMe, personalPreview } = require("../../profile");
const builtinAvatars = require("../../builtin-avatars");
const { avatarStyles, avatarPreset, avatarLibrary } = require("../../avatar-library");
function presetId(url) {
  return avatarPreset(url)?.id || "";
}
Page({
  data: { loading: true, busy: false, error: "", conflict: false, dirty: false, pendingSave: false, roomStatsVisible: false, nickname: "", editingNickname: false, nicknameError: "", keyboardHeight: 0, avatarPreview: "", selectedAvatar: "", canUpload: false, uploadBusy: false, uploadStatus: "", uploadError: "", uploadProgress: 0, ...avatarLibrary(), initial: "友", profile: null },
  onLoad() {
    this.alive = true;
    const pages = getCurrentPages();
    this.setData({ backLabel: pages[pages.length - 2]?.route === "pages/leaderboard/leaderboard" ? "返回排行榜" : "返回我的" });
    const preview = personalPreview("profile");
    if (preview) {
      this.original = preview;
      this.setData({ profile: preview, roomStatsVisible: !!preview.roomStatsVisible, nickname: preview.nickname, avatarPreview: preview.avatarUrl, selectedAvatar: presetId(preview.avatarUrl), ...avatarLibrary(avatarPreset(preview.avatarUrl)?.style), initial: preview.initial });
    }
    const loading = this.load({ preserveEdits: true });
    this.loadUploadCapability();
    return loading;
  },
  onUnload() { this.alive = false; this.stopAvatarReview(); },
  async loadUploadCapability() {
    if (typeof api.uploadAvatar !== "function") return;
    try {
      await api.login();
      const result = await api.request("/api/me/avatar-uploads");
      if (this.alive) this.setData({ canUpload: !!result?.enabled && (!wx.canIUse || wx.canIUse("button.open-type.chooseAvatar")) });
    } catch { /* Old servers and unavailable upload services keep the existing avatar picker. */ }
  },
  stopAvatarReview() {
    this.uploadEpoch = (this.uploadEpoch || 0) + 1;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
  },
  clearCustomAvatar() {
    this.stopAvatarReview();
    this.customAvatarPath = ""; this.uploadRequest = null; this.uploadRecord = null;
    this.uploadPolls = 0;
    this.setData({ uploadBusy: false, uploadStatus: "", uploadError: "", uploadProgress: 0 });
  },
  async chooseWechatAvatar(e) {
    const path = e.detail?.avatarUrl;
    if (!this.alive || !path || !this.original || !this.data.canUpload || this.data.busy || this.pending) return;
    this.clearCustomAvatar();
    this.customAvatarPath = path; this.avatar = "local";
    this.setData({ avatarPreview: path, selectedAvatar: "", error: "" }); this.markDirty();
    await this.retryAvatarUpload();
  },
  async retryAvatarUpload() {
    if (!this.customAvatarPath || this.data.busy || this.pending || this.data.uploadBusy) return;
    if (this.uploadRecord && ["processing", "pending"].includes(this.uploadRecord.status)) return this.checkAvatarReview();
    const epoch = this.uploadEpoch, path = this.customAvatarPath;
    this.setData({ uploadBusy: true, uploadStatus: "uploading", uploadError: "", uploadProgress: 0 });
    try {
      await api.login();
      if (!this.alive || epoch !== this.uploadEpoch) return;
      const code = this.original.identityType === "wx" ? await new Promise((resolve, reject) => wx.login({
        success: r => r.code ? resolve(r.code) : reject(new Error("微信登录失败，请重试上传")),
        fail: () => reject(new Error("微信登录失败，请重试上传")),
      })) : "";
      if (!this.alive || epoch !== this.uploadEpoch) return;
      this.uploadRequest ||= api.requestId();
      const result = await api.uploadAvatar(path, code, this.uploadRequest, progress => {
        if (this.alive && epoch === this.uploadEpoch) this.setData({ uploadProgress: Math.max(0, Math.min(100, Number(progress) || 0)) });
      });
      if (!this.alive || epoch !== this.uploadEpoch) return;
      this.applyAvatarReview(result);
    } catch (error) {
      if (!this.alive || epoch !== this.uploadEpoch) return;
      if (error.status && error.status < 500 && ![401, 429].includes(error.status)) this.uploadRequest = null;
      this.setData({ uploadStatus: "failed", uploadError: error.message });
    } finally {
      if (this.alive && epoch === this.uploadEpoch) this.setData({ uploadBusy: false });
    }
  },
  applyAvatarReview(result) {
    this.uploadRecord = result;
    this.setData({ uploadStatus: result.status, uploadError: "" });
    if (result.status === "approved") {
      this.avatar = "upload:" + result.id; this.markDirty();
    } else if (["pending", "processing"].includes(result.status)) {
      this.uploadPolls = (this.uploadPolls || 0) + 1;
      if (this.uploadPolls <= 200) this.uploadTimer = setTimeout(() => { this.uploadTimer = null; this.checkAvatarReview(); }, 3000);
      else this.setData({ uploadError: "头像准备时间较长，请重试或选择其他头像。" });
    } else {
      this.uploadRequest = null;
      this.setData({ uploadError: result.status === "rejected" ? "这张图片暂时无法使用，请重新选择。" : "头像暂时无法处理，请重试。" });
    }
  },
  async checkAvatarReview() {
    if (!this.uploadRecord || !this.alive || this.data.uploadBusy) return;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    const epoch = this.uploadEpoch;
    this.setData({ uploadBusy: true, uploadError: "" });
    try {
      const result = await api.request("/api/me/avatar-uploads/" + this.uploadRecord.id);
      if (this.alive && epoch === this.uploadEpoch) this.applyAvatarReview(result);
    } catch (error) {
      if (this.alive && epoch === this.uploadEpoch) {
        if ([404, 410].includes(error.status)) { this.uploadRecord = null; this.uploadRequest = null; this.setData({ uploadStatus: "failed" }); }
        this.setData({ uploadError: error.message });
      }
    } finally { if (this.alive && epoch === this.uploadEpoch) this.setData({ uploadBusy: false }); }
  },
  async load({ preserveEdits = false } = {}) {
    if (this.data.busy) return;
    this.setData({ loading: true, error: "", conflict: false });
    try {
      await api.login();
      const profile = await api.request("/api/me/profile");
      if (!this.alive) return;
      // A background refresh must never replace edits started from the preview.
      if (preserveEdits && (this.data.dirty || this.data.editingNickname || this.pending)) return;
      this.clearCustomAvatar();
      this.original = profile; this.avatar = undefined; this.pending = null;
      const shown = presentProfile(profile);
      const style = preserveEdits && this.avatarStyleTouched ? this.data.avatarStyle : avatarPreset(profile.avatarUrl)?.style;
      this.setData({ profile: shown, roomStatsVisible: !!profile.roomStatsVisible, nickname: profile.nickname, avatarPreview: shown.avatarUrl, selectedAvatar: presetId(profile.avatarUrl), ...avatarLibrary(style), initial: shown.initial, dirty: false, pendingSave: false, editingNickname: false, nicknameError: "", keyboardHeight: 0 });
      wx.disableAlertBeforeUnload?.();
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { if (this.alive) this.setData({ loading: false }); }
  },
  markDirty() {
    const dirty = this.data.nickname.trim() !== (this.original?.nickname || "") || this.avatar !== undefined || this.data.roomStatsVisible !== !!this.original?.roomStatsVisible;
    this.setData({ dirty });
    if (dirty) wx.enableAlertBeforeUnload?.({ message: "资料尚未保存，离开会丢失修改" });
    else wx.disableAlertBeforeUnload?.();
  },
  changeRoomStatsVisibility(e) {
    if (this.pending || this.data.busy) return;
    this.setData({ roomStatsVisible: !!e.detail.value }); this.markDirty();
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
  chooseAvatarStyle(e) {
    if (this.data.busy || this.pending) return;
    const style = e.currentTarget.dataset.style;
    if (!avatarStyles.some(item => item.id === style) || style === this.data.avatarStyle) return;
    this.avatarStyleTouched = true;
    this.setData(avatarLibrary(style));
  },
  chooseBuiltinAvatar(e) {
    if (!this.original || this.data.busy || this.pending) return;
    const preset = builtinAvatars.find(item => item.id === e.currentTarget.dataset.id);
    if (!preset) return;
    this.clearCustomAvatar();
    this.avatar = presetId(this.original.avatarUrl) === preset.id ? undefined : "builtin:" + preset.id;
    this.setData({ avatarPreview: preset.path, selectedAvatar: preset.id, ...avatarLibrary(preset.style), error: "" });
    this.markDirty();
  },
  removeAvatar() {
    if (this.data.busy || this.pending) return;
    this.clearCustomAvatar();
    this.avatar = this.original?.avatarUrl ? null : undefined;
    this.setData({ avatarPreview: "", selectedAvatar: "", error: "" }); this.markDirty();
  },
  async save(e) {
    if (this.data.busy || this.data.loading || this.data.conflict) return;
    if (this.customAvatarPath && this.avatar === "local") return this.setData({ uploadError: "头像尚未准备好，请稍候或重新选择。" });
    if (!this.pending) {
      const nickname = (e?.detail?.value?.nickname ?? this.data.nickname).trim();
      this.setData({ nickname });
      if (!nickname || nickname.length > 16) {
        this.editNickname();
        return this.setData({ nicknameError: "请输入1–16个字符的昵称" });
      }
      this.pending = { id: api.requestId(), data: { nickname, version: this.original.version, ...(this.data.roomStatsVisible !== !!this.original.roomStatsVisible ? { roomStatsVisible: this.data.roomStatsVisible } : {}), ...(this.avatar !== undefined ? { avatar: this.avatar } : {}) } };
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
    if (this.data.busy) return;
    if (this.data.dirty || this.pending) {
      const yes = await new Promise(resolve => wx.showModal({ title: "离开编辑资料？", content: this.pending ? "保存结果尚未确认，建议先重试保存。仍要离开吗？" : "未保存的修改将丢弃。", success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (!yes) return;
    }
    wx.disableAlertBeforeUnload?.(); backToMe();
  },
});
