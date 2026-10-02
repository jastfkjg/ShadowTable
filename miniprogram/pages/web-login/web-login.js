const api = require("../../api");
const { presentProfile, backToMe } = require("../../profile");

Page({
  data: { loading: true, busy: false, error: "", terminal: false, request: null, profile: null, status: "" },
  onLoad(options) {
    this.alive = true;
    try { this.requestId = decodeURIComponent(options.scene || ""); } catch { this.requestId = ""; }
    if (!/^[a-f0-9]{32}$/.test(this.requestId)) {
      this.setData({ loading: false, error: "请使用微信扫描网页版显示的小程序码", terminal: true });
      return;
    }
    return this.load();
  },
  onShow() {
    if (this.hidden && this.alive && !this.data.busy && this.requestId) this.load();
    this.hidden = false;
  },
  onHide() { this.hidden = true; },
  onUnload() { this.alive = false; clearTimeout(this.expiryTimer); },
  async authenticated(operation) {
    // Only this new page retries an expired mini-program session. The shared
    // login/API and existing table lifecycle are intentionally left unchanged.
    await api.login();
    try { return await operation(); }
    catch (e) { if (e.status !== 401) throw e; await api.login(); return operation(); }
  },
  async load() {
    if (this.data.busy) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    clearTimeout(this.expiryTimer);
    this.setData({ loading: true, error: "", terminal: false });
    try {
      const result = await this.authenticated(async () => {
        const profile = await api.request("/api/me/profile");
        if (profile.identityType !== "wx") throw new Error("请在正式微信账号下扫码确认，开发和陪测账号不可使用");
        const request = await api.request("/api/web-auth/requests/" + this.requestId + "/inspect", "POST", {});
        return { profile: presentProfile(profile), request };
      });
      if (!this.alive || sequence !== this.sequence) return;
      this.setData({ ...result, status: result.request.status });
      this.armExpiry(result.request.expiresAt);
    } catch (e) {
      if (this.alive && sequence === this.sequence) this.setData({ error: e.message, status: '', terminal: [400, 409, 410].includes(e.status) });
    } finally { if (this.alive && sequence === this.sequence) this.setData({ loading: false }); }
  },
  armExpiry(expiresAt) {
    clearTimeout(this.expiryTimer);
    if (["confirmed", "consumed", "cancelled"].includes(this.data.status)) return;
    this.expiryTimer = setTimeout(() => {
      if (this.alive) this.setData({ terminal: true, error: "小程序码已过期，请在网页刷新后重新扫描" });
    }, Math.max(0, expiresAt - Date.now()));
  },
  async respond(action) {
    if (this.data.loading || this.data.busy || this.data.terminal || this.data.status !== "scanned") return;
    this.setData({ busy: true, error: "" });
    try {
      const result = await this.authenticated(() => api.request("/api/web-auth/requests/" + this.requestId + "/" + action, "POST", {}));
      if (!this.alive) return;
      clearTimeout(this.expiryTimer);
      this.setData({ status: result.status, terminal: true });
    } catch (e) {
      if (this.alive) this.setData({ error: e.message, terminal: [400, 409, 410].includes(e.status) });
    } finally { if (this.alive) this.setData({ busy: false }); }
  },
  confirm() { return this.respond("confirm"); },
  reject() { return this.respond("reject"); },
  back() { if (!this.data.busy) backToMe(); },
});
