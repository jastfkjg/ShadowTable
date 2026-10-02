const api = require("../../api");
const { presentStats, backToMe, personalPreview } = require("../../profile");
Page({
  data: { loading: true, error: "", stats: null, overviewExpanded: true, funExpanded: false, funRulesExpanded: false, tab: "records", funRoles: {} },
  onLoad(options = {}) {
    this.alive = true;
    this.setData({ tab: options.tab === "fun" ? "fun" : "records" });
    const preview = personalPreview("stats");
    if (preview) this.setData({ stats: preview });
    return this.load();
  },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    this.fetching = true; this.setData({ loading: true, error: "" });
    try {
      await api.login();
      const stats = await api.request("/api/me/stats");
      if (this.alive) {
        const shown = presentStats(stats);
        shown.byFaction = shown.byFaction.map(row => ({ ...row, expanded: this.data.stats?.byFaction?.some(old => old.faction === row.faction && old.expanded) || false }));
        this.setData({ stats: shown });
      }
    }
    catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  toggleFunCards() { this.setData({ funExpanded: !this.data.funExpanded }); },
  toggleFunRules() { this.setData({ funRulesExpanded: !this.data.funRulesExpanded }); },
  toggleOverview() { this.setData({ overviewExpanded: !this.data.overviewExpanded }); },
  chooseTab(e) { const tab = e.currentTarget.dataset.id; if (["records","fun"].includes(tab)) this.setData({ tab }); },
  toggleFunRoles(e) { const id = e.currentTarget.dataset.id; this.setData({ funRoles: { ...this.data.funRoles, [id]: !this.data.funRoles[id] } }); },
  toggleFaction(e) {
    const faction = e.currentTarget.dataset.faction;
    const stats = this.data.stats;
    if (!stats) return;
    this.setData({ stats: { ...stats, byFaction: stats.byFaction.map(row => row.faction === faction ? { ...row, expanded: !row.expanded } : row) } });
  },
  back: backToMe,
});
