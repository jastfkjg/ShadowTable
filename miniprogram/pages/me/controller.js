const api = require("../../api");
const { presentProfile, presentStats } = require("../../profile");
const { selectTab } = require("../../tab-navigation");
const { presentMonthlyReset } = require("../../monthly-reset");
function currentRoom(rooms) {
  const active = rooms.filter(row => /^\d{6}$/.test(row.code || "") && row.available !== false && row.isMember !== false && ["playing", "lobby"].includes(row.status));
  active.sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing") || Number(b.seat != null) - Number(a.seat != null) || (b.lastEnteredAt || b.updatedAt || 0) - (a.lastEnteredAt || a.updatedAt || 0));
  const room = active[0];
  return room ? { ...room, statusLabel: room.status === "playing" ? "进行中" : "待开局",
    boardLabel: (room.boardName || "阿瓦隆").replace(/^阿瓦隆\s*·\s*/, "").replace(/（\d+人）$/, ""),
    relationLabel: room.seat != null ? "我在 " + room.seat + " 号" : room.isHost ? "我是房主" : "旁观中" } : null;
}
module.exports = function createMePage() { return {
  data: { loading: true, error: "", profile: null, stats: null, currentRoom: null, monthlyReset: null, resetSaving: false, resetError: "" },
  onLoad() { this.alive = true; },
  onShow() { this.foreground = true; selectTab(this, 1); return this.load(); },
  onHide() { this.foreground = false; this.updateChangedData({ monthlyReset: null }); },
  onUnload() { this.alive = false; },
  updateChangedData(values) {
    const changed = {};
    for (const key of Object.keys(values)) {
      if (JSON.stringify(this.data[key]) !== JSON.stringify(values[key])) changed[key] = values[key];
    }
    if (Object.keys(changed).length) this.setData(changed);
  },
  async load() {
    const sequence = this.sequence = (this.sequence || 0) + 1, resetEpoch = this.resetEpoch;
    this.matchesPreview = null;
    this.updateChangedData({ loading: true, error: "" });
    try {
      await api.login();
      if (!this.alive || sequence !== this.sequence) return;
      // Warm the first records page without delaying profile/stats or surfacing
      // speculative request errors. The destination still refreshes on entry.
      this.prefetchMatches(sequence);
      this.loadCurrentRoom(sequence);
      const errors = {};
      const read = async (key, present) => {
        try {
          const result = await api.request("/api/me/" + key);
          if (this.alive && sequence === this.sequence) {
            this.updateChangedData({ [key]: present(result) });
            if (key === "stats" && this.foreground && !this.data.resetSaving && resetEpoch === this.resetEpoch) this.updateChangedData({ monthlyReset: presentMonthlyReset(result.monthlyReset), resetError: "" });
          }
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
  async loadCurrentRoom(sequence) {
    try {
      const result = await api.request("/api/me/rooms");
      if (this.alive && sequence === this.sequence) this.updateChangedData({ currentRoom: currentRoom(result?.rooms || []) });
    } catch (_) {
      if (this.alive && sequence === this.sequence) this.updateChangedData({ currentRoom: null });
    }
  },
  blockMonthlyResetScroll() {},
  async dismissMonthlyReset() {
    const month = this.data.monthlyReset?.month;
    if (!month || this.data.resetSaving) return;
    this.updateChangedData({ resetSaving: true, resetError: "" });
    try {
      await api.request("/api/me/monthly-reset", "POST", { month });
      this.resetEpoch = (this.resetEpoch || 0) + 1;
      if (this.alive && this.data.monthlyReset?.month === month) this.updateChangedData({ monthlyReset: null });
    } catch (error) {
      if (this.alive) this.updateChangedData({ resetError: error.message });
    } finally { if (this.alive) this.updateChangedData({ resetSaving: false }); }
  },
  about() { wx.showModal({ title: "关于桌边助手", content: "ShadowTable · 为面对面的阿瓦隆聚会而做。\n身份、投票与技能交给牌桌，讨论和故事留给同桌的朋友。", showCancel: false }); },
}; };
