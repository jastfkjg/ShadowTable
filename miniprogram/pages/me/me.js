const api = require("../../api");
const { presentProfile, presentStats } = require("../../profile");
Page({
  data: { loading: true, error: "", profile: null, stats: null },
  onLoad() { this.alive = true; },
  onShow() { this.getTabBar?.()?.setData({ selected: 1 }); this.load(); },
  onUnload() { this.alive = false; },
  async load() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: "" });
    try {
      await api.login();
      const [profile, stats] = await Promise.allSettled([api.request("/api/me/profile"), api.request("/api/me/stats")]);
      if (this.alive && sequence === this.sequence) this.setData({
        ...(profile.status === "fulfilled" ? { profile: presentProfile(profile.value) } : {}),
        ...(stats.status === "fulfilled" ? { stats: presentStats(stats.value) } : {}),
        error: [profile, stats].filter(r => r.status === "rejected").map(r => r.reason.message).join("；"),
      });
    } catch (e) { if (this.alive && sequence === this.sequence) this.setData({ error: e.message }); }
    finally { if (this.alive && sequence === this.sequence) this.setData({ loading: false }); }
  },
  editProfile() { wx.navigateTo({ url: "/pages/profile/profile" }); },
  openStats() { wx.navigateTo({ url: "/pages/stats/stats" }); },
  openHelp() { wx.navigateTo({ url: "/pages/help/help" }); },
  about() { wx.showModal({ title: "关于桌边助手", content: "ShadowTable · 为面对面的阿瓦隆聚会而做。\n身份、投票与技能交给牌桌，讨论和故事留给同桌的朋友。", showCancel: false }); },
});
