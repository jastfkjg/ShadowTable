const api = require("../../api");
const { presentProfile, presentStats } = require("../../profile");
const { selectTab } = require("../../tab-navigation");
Page({
  data: { loading: true, error: "", profile: null, stats: null },
  onLoad() { this.alive = true; },
  onShow() { selectTab(this, 1); return this.load(); },
  onUnload() { this.alive = false; },
  updateChangedData(values) {
    const changed = {};
    for (const key of Object.keys(values)) {
      if (JSON.stringify(this.data[key]) !== JSON.stringify(values[key])) changed[key] = values[key];
    }
    if (Object.keys(changed).length) this.setData(changed);
  },
  async load() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.matchesPreview = null;
    this.updateChangedData({ loading: true, error: "" });
    try {
      await api.login();
      if (!this.alive || sequence !== this.sequence) return;
      // Warm the first records page without delaying profile/stats or surfacing
      // speculative request errors. The destination still refreshes on entry.
      this.prefetchMatches(sequence);
      const errors = {};
      const read = async (key, present) => {
        try {
          const result = await api.request("/api/me/" + key);
          if (this.alive && sequence === this.sequence) this.updateChangedData({ [key]: present(result) });
        } catch (e) {
          errors[key] = e.message;
          if (this.alive && sequence === this.sequence) this.updateChangedData({ error: [errors.profile, errors.stats].filter(Boolean).join("；") });
        }
      };
      // Each section becomes usable as soon as its own request finishes.
      await Promise.all([read("profile", presentProfile), read("stats", presentStats)]);
    } catch (e) { if (this.alive && sequence === this.sequence) this.updateChangedData({ error: e.message }); }
    finally { if (this.alive && sequence === this.sequence) this.updateChangedData({ loading: false }); }
  },
  async prefetchMatches(sequence) {
    try {
      const result = await api.request("/api/me/matches?offset=0");
      if (this.alive && sequence === this.sequence) this.matchesPreview = result;
    } catch (_) { /* Navigation must work even when prefetch fails. */ }
  },
  about() { wx.showModal({ title: "关于桌边助手", content: "ShadowTable · 为面对面的阿瓦隆聚会而做。\n身份、投票与技能交给牌桌，讨论和故事留给同桌的朋友。", showCancel: false }); },
});
