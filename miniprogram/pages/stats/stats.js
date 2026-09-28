const api = require("../../api");
const { presentStats, backToMe } = require("../../profile");
Page({
  data: { loading: true, error: "", stats: null, overviewExpanded: false },
  onLoad() { this.alive = true; this.load(); },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    this.fetching = true; this.setData({ loading: true, error: "" });
    try { await api.login(); const stats = await api.request("/api/me/stats"); if (this.alive) this.setData({ stats: presentStats(stats) }); }
    catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  toggleOverview() { this.setData({ overviewExpanded: !this.data.overviewExpanded }); },
  toggleFaction(e) {
    const faction = e.currentTarget.dataset.faction;
    const stats = this.data.stats;
    if (!stats) return;
    this.setData({ stats: { ...stats, byFaction: stats.byFaction.map(row => row.faction === faction ? { ...row, expanded: !row.expanded } : row) } });
  },
  back: backToMe,
});
