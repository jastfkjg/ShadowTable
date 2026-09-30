const api = require("../../api");
const { presentProfile, presentStats } = require("../../profile");
Page({
  data: { loading: true, error: "", profile: null, stats: null },
  onLoad() { this.alive = true; },
  onShow() { return this.load(); },
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
      // Warm the first records page without delaying profile/stats or surfacing
      // speculative request errors. The destination still refreshes on entry.
      this.prefetchMatches(sequence);
      const [profile, stats] = await Promise.allSettled([api.request("/api/me/profile"), api.request("/api/me/stats")]);
      if (this.alive && sequence === this.sequence) this.updateChangedData({
        ...(profile.status === "fulfilled" ? { profile: presentProfile(profile.value) } : {}),
        ...(stats.status === "fulfilled" ? { stats: presentStats(stats.value) } : {}),
        error: [profile, stats].filter(r => r.status === "rejected").map(r => r.reason.message).join("；"),
      });
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
