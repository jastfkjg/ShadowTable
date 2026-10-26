const api = require("../../api");
const clearing = require("./presentation");
const { backToMe } = require("../../profile");
Page({
  data: { months: [], monthLabels: [], month: "", currentMonth: "", monthIndex: 0, preview: null, loading: true, saving: false, confirming: false, confirmation: null, confirmationBodyHeight: 0, rulesExpanded: false, pending: false, error: "", notice: "", rules: clearing.rules, impacts: clearing.impacts, sheetLines: clearing.sheetLines },
  onLoad() { this.alive = true; },
  async onShow() {
    this.active = true;
    try {
      await api.login();
      if (!this.alive || !this.active) return;
      const account = wx.getStorageSync("session");
      if (this.account && this.account !== account) {
        this.pending = null;
        this.setData({ pending: false, preview: null, month: "", notice: "", saving: false, confirming: false, confirmation: null });
      }
      this.account = account;
      if (this.pending) { this.setData({ loading: false }); return; }
      return this.load();
    } catch (e) { if (this.alive) this.setData({ loading: false, error: e.message }); }
  },
  onHide() { this.active = false; this.sequence = (this.sequence || 0) + 1; this.confirmationPreview = null; this.setData({ confirming: false, confirmation: null }); },
  onUnload() { this.alive = false; this.active = false; this.sequence = (this.sequence || 0) + 1; },
  async load() {
    if (this.data.saving || this.pending || this.data.confirming) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, preview: null, error: "" });
    try {
      const result = await api.request("/api/me/record-clearing");
      if (!this.active || sequence !== this.sequence) return;
      const month = result.months.includes(this.data.month) ? this.data.month : result.months[0] || "";
      this.setData({ months: result.months, currentMonth: result.currentMonth, monthLabels: result.months.map(value => clearing.monthLabel(value) + (value === result.currentMonth ? "（本月）" : "")), month, monthIndex: Math.max(0, result.months.indexOf(month)) });
      if (month) {
        const preview = await api.request("/api/me/record-clearing?month=" + month);
        if (this.active && sequence === this.sequence) this.setData({ preview: clearing.present(preview, result.currentMonth) });
      }
    } catch (e) { if (this.active && sequence === this.sequence) this.setData({ error: e.message }); }
    finally { if (this.active && sequence === this.sequence) this.setData({ loading: false }); }
  },
  async chooseMonth(e) {
    if (this.data.loading || this.data.saving || this.pending || this.data.confirming) return;
    const month = this.data.months[Number(e.detail.value)];
    if (!month || month === this.data.month) return;
    this.setData({ month, notice: "" });
    return this.load();
  },
  clearRecords() {
    if (this.data.loading || this.data.saving || this.data.confirming || !this.active) return;
    const preview = this.pending?.preview || this.data.preview;
    if (!preview?.canClear) return;
    this.confirmationPreview = preview;
    this.setData({ confirming: true, confirmation: preview, confirmationBodyHeight: 0 }, () => this.measureConfirmation());
  },
  closeConfirmation() {
    if (this.data.saving) return;
    this.confirmationPreview = null;
    this.setData({ confirming: false, confirmation: null, confirmationBodyHeight: 0 });
  },
  toggleRules() { this.setData({ rulesExpanded: !this.data.rulesExpanded }); },
  blockScroll() {},
  onResize() { if (this.data.confirming) this.measureConfirmation(); },
  measureConfirmation() {
    if (!this.data.confirming || typeof this.createSelectorQuery !== "function") return;
    const preview = this.confirmationPreview;
    this.createSelectorQuery().select(".data-confirm-content").boundingClientRect()
      .select(".data-confirm-top").boundingClientRect().select(".data-confirm-footer").boundingClientRect()
      .exec(([content, top, footer]) => {
        if (!this.active || !this.data.confirming || preview !== this.confirmationPreview || !content?.height || !top?.height || !footer?.height) return;
        const info = wx.getWindowInfo?.() || wx.getSystemInfoSync();
        this.setData({ confirmationBodyHeight: Math.max(1, Math.min(Math.ceil(content.height), Math.floor(info.windowHeight * .9) - Math.ceil(top.height + footer.height) - 2)) });
      });
  },
  async confirmClearRecords() {
    if (this.data.loading || this.data.saving || !this.data.confirming || !this.active) return;
    if (!this.pending) {
      const preview = this.confirmationPreview;
      if (!preview?.canClear || preview !== this.data.preview) { this.closeConfirmation(); return; }
      this.pending = { id: api.requestId(), body: { month: preview.month, version: preview.version }, account: this.account, preview };
    }
    const pending = this.pending;
    if (pending.account !== wx.getStorageSync("session")) { this.pending = null; this.closeConfirmation(); this.setData({ pending: false, preview: null, error: "账号已变化，请重新进入数据管理" }); return; }
    this.setData({ saving: true, pending: true, error: "", notice: "" });
    try {
      await api.request("/api/me/record-clearing", "POST", pending.body, pending.id);
      if (pending.account !== wx.getStorageSync("session") || this.pending !== pending) return;
      this.pending = null;
      this.confirmationPreview = null;
      if (this.alive) this.setData({ pending: false, preview: null, confirming: false, confirmation: null, notice: clearing.monthLabel(pending.body.month) + " 的个人战绩已清除" });
      // Remove previews held by pages beneath this one before they refresh.
      for (const page of getCurrentPages()) {
        const personal = page.personalController || (page.route === "pages/me/me" ? page : null);
        if (personal) {
          personal.matchesPreview = null; personal.sequence = (personal.sequence || 0) + 1;
          personal.updateChangedData?.({ stats: null });
        }
      }
    } catch (e) {
      if (this.pending !== pending) return;
      if (e.status && e.status < 500 && ![401, 429].includes(e.status)) this.pending = null;
      if (!this.pending) this.confirmationPreview = null;
      if (this.alive) this.setData({ pending: !!this.pending, preview: this.pending ? this.data.preview : null, error: e.message, ...(!this.pending ? { confirming: false, confirmation: null } : {}) }, () => this.measureConfirmation());
    } finally { if (this.alive && this.account === pending.account) this.setData({ saving: false }); }
    if (this.active && !this.pending) {
      const error = this.data.error;
      await this.load();
      if (error && this.alive) this.setData({ error });
    }
  },
  back() { if (this.data.confirming) return this.closeConfirmation(); if (!this.data.saving) return backToMe.call(this); },
});
