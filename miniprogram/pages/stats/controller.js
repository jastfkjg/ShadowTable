const api = require("../../api");
const { presentStats, presentFun, backToMe, personalPreview } = require("../../profile");
const { queryString } = require("../../share-card");
function preserveFactions(stats, previous) {
  return { ...stats, byFaction: stats.byFaction.map(row => {
    const old = previous?.byFaction?.find(item => item.faction === row.faction);
    return { ...row, expanded: old ? old.expanded : stats.byFaction.length === 1, rolesExpanded: !!old?.rolesExpanded };
  }) };
}
function roleRows(stats, filter) {
  const roles = stats?.byRole || [];
  return filter === "all" ? roles : roles.filter(row => row.faction === filter);
}
function selectedDetail(stats, previous) {
  if (!previous) return null;
  const row = previous.kind === "role" ? stats.byRole.find(item => item.roleKey === previous.roleKey)
    : stats.byFaction.find(item => item.faction === previous.faction);
  return row ? detail(row, previous.kind) : null;
}
function detail(row, kind) {
  return { ...row, kind, title: kind === "role" ? row.role : row.label,
    losses: row.losses ?? Math.max(0, row.total - row.wins),
    score: row.score || { total: 0, games: 0, average: null },
    scoreAverageLabel: row.scoreAverageLabel || "—" };
}
module.exports = function createController() { return {
  data: { loading: true, error: "", stats: null, funRulesExpanded: false, tab: "records", funRoles: {},
    roleFilter: "all", roleRows: null, statsDetail: null },
  onLoad(options = {}) {
    this.alive = true;
    this.setData({ tab: options.tab === "fun" ? "fun" : "records" });
    const preview = personalPreview("stats");
    if (preview) {
      const stats = preserveFactions({ ...preview, fun: preview.fun?.available === false ? preview.fun : presentFun(preview.fun) });
      this.setData({ stats, roleRows: roleRows(stats, this.data.roleFilter) });
    }
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
        const filter = this.data.roleFilter === "all" || shown.byFaction.some(row => row.faction === this.data.roleFilter) ? this.data.roleFilter : "all";
        this.setData({ stats: shown, roleFilter: filter, roleRows: roleRows(shown, filter), statsDetail: selectedDetail(shown, this.data.statsDetail) });
      }
    }
    catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
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
  openFunMenu(event) {
    if (this.data.loading || this.data.error || this.funMenuOpen) return;
    const card = this.data.stats?.fun.cards.find(row => row.id === event.currentTarget.dataset.card);
    if (!card?.shareMetric) return;
    this.funMenuOpen = true;
    wx.showActionSheet({
      itemList: ["分享这张记录"],
      success: result => { if (this.alive && result.tapIndex === 0) this.shareFun(event); },
      complete: () => { this.funMenuOpen = false; },
    });
  },
  toggleFunRules() { this.setData({ funRulesExpanded: !this.data.funRulesExpanded }); },
  filterRoles(event) {
    const filter = event.currentTarget.dataset.faction;
    if (filter !== "all" && !this.data.stats?.byFaction.some(row => row.faction === filter)) return;
    this.setData({ roleFilter: filter, roleRows: roleRows(this.data.stats, filter) });
  },
  openRoleDetails(event) {
    const row = this.data.stats?.byRole.find(item => item.roleKey === event.currentTarget.dataset.key);
    if (row) this.setData({ statsDetail: detail(row, "role") });
  },
  openFactionDetails(event) {
    const row = this.data.stats?.byFaction.find(item => item.faction === event.currentTarget.dataset.faction);
    if (row) this.setData({ statsDetail: detail(row, "faction") });
  },
  closeStatsDetails() { this.setData({ statsDetail: null }); },
  blockStatsScroll() {},
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
