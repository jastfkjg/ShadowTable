const api = require("../../api");
const { presentStats, presentFun, backToMe, personalPreview } = require("../../profile");
const { queryString } = require("../../share-card");
function preserveFactions(stats, previous) {
  return { ...stats, byFaction: stats.byFaction.map(row => {
    const old = previous?.byFaction?.find(item => item.faction === row.faction);
    return { ...row, expanded: old ? old.expanded : stats.byFaction.length === 1, rolesExpanded: !!old?.rolesExpanded };
  }) };
}
module.exports = function createController() { return {
  data: { loading: true, error: "", stats: null, funExpanded: false, funRulesExpanded: false, tab: "records", funRoles: {} },
  onLoad(options = {}) {
    this.alive = true;
    this.setData({ tab: options.tab === "fun" ? "fun" : "records" });
    const preview = personalPreview("stats");
    if (preview) this.setData({ stats: preserveFactions({ ...preview, fun: preview.fun?.available === false ? preview.fun : presentFun(preview.fun) }) });
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
        const shown = preserveFactions(presentStats(stats), this.data.stats);
        this.setData({ stats: shown });
      }
    }
    catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  toggleFunCards() { this.setData({ funExpanded: !this.data.funExpanded }); },
  shareStats() {
    if (this.data.tab === "fun") return this.shareFunSummary();
    if (this.data.loading || this.data.error || !this.data.stats?.total) return;
    wx.navigateTo({ url: "/pages/share/share?kind=stats" });
  },
  shareFunSummary() {
    if (this.data.loading || this.data.error || !this.data.stats?.fun?.shareable) return;
    wx.navigateTo({ url: "/pages/share/share?kind=funSummary" });
  },
  shareFun(event) {
    if (this.data.loading || this.data.error) return;
    const card = this.data.stats?.fun.cards.find(row => row.id === event.currentTarget.dataset.card);
    if (card?.shareMetric) wx.navigateTo({ url: "/pages/share/share?" + queryString({ kind: "fun", card: card.id, metric: card.shareMetric }) });
  },
  toggleFunRules() { this.setData({ funRulesExpanded: !this.data.funRulesExpanded }); },
  chooseTab(e) { const tab = e.currentTarget.dataset.id; if (["records","fun"].includes(tab)) this.setData({ tab }); },
  toggleFunRoles(e) { const id = e.currentTarget.dataset.id; this.setData({ funRoles: { ...this.data.funRoles, [id]: !this.data.funRoles[id] } }); },
  toggleFaction(e) {
    const faction = e.currentTarget.dataset.faction;
    const stats = this.data.stats;
    if (!stats) return;
    this.setData({ stats: { ...stats, byFaction: stats.byFaction.map(row => row.faction === faction ? { ...row, expanded: !row.expanded } : row) } });
  },
  toggleFactionRoles(e) {
    const faction = e.currentTarget.dataset.faction;
    if (!this.data.stats) return;
    this.setData({ stats: { ...this.data.stats, byFaction: this.data.stats.byFaction.map(row => row.faction === faction ? { ...row, rolesExpanded: !row.rolesExpanded } : row) } });
  },
  back: backToMe,
}; };
