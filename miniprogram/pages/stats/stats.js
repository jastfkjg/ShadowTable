const api = require("../../api");
const { presentStats, backToMe } = require("../../profile");
Page({
  data: { loading: true, error: "", stats: null },
  onLoad() { this.alive = true; this.load(); },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    this.fetching = true; this.setData({ loading: true, error: "" });
    try { await api.login(); const stats = await api.request("/api/me/stats"); if (this.alive) this.setData({ stats: presentStats(stats) }); }
    catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  back: backToMe,
});
