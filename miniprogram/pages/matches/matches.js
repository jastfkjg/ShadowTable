const api = require("../../api");
const { presentMatches, presentAdjustments, backToMe, personalPreview } = require("../../profile");
const defaultFilters = { period: "all", board: "", matchRole: "", outcome: "" };
function filterState(filters, options = {}, previousGroups = []) {
  const groups = [
    { key: "period", label: "时间", options: [{ id: "all", label: "全部时间" }, { id: "month", label: "本月" }, { id: "7d", label: "近7天" }, { id: "30d", label: "近30天" }] },
    { key: "board", label: "板子", options: [{ id: "", label: "全部板子" }, ...(options.boards || [])] },
    { key: "matchRole", label: "角色", options: [{ id: "", label: "全部角色" }, ...(options.roles || [])] },
    { key: "outcome", label: "胜负", options: [{ id: "", label: "全部结果" }, { id: "win", label: "胜利" }, { id: "loss", label: "失利" }, { id: "excluded", label: "不计入战绩" }] },
  ].map(group => {
    if (filters[group.key] !== defaultFilters[group.key] && !group.options.some(option => option.id === filters[group.key])) {
      const previous = previousGroups.find(item => item.key === group.key)?.options.find(option => option.id === filters[group.key]);
      group.options.push(previous || { id: filters[group.key], label: filters[group.key] });
    }
    const index = Math.max(0, group.options.findIndex(option => option.id === filters[group.key]));
    return { ...group, index, valueLabel: group.options[index].label, active: filters[group.key] !== defaultFilters[group.key] };
  });
  const selected = groups.filter(group => group.active);
  return { filters, filterGroups: groups, filterCount: selected.length, filterSummary: selected.map(group => group.valueLabel).join(" · ") };
}
Page({
  data: { loading: true, loadingMore: false, loaded: false, loadMoreError: false, error: "", records: [], total: 0, hasMore: false, scoredOnly: false, funFilter: null, adjustments: [], adjustmentsTotal: 0, adjustmentsMore: false, adjustmentsLoading: false, adjustmentsError: "", filtersAvailable: false, filtersExpanded: false, ...filterState(defaultFilters) },
  onLoad(options = {}) {
    this.alive = true;
    this.setData({ scoredOnly: options.scored === "1", funFilter: options.fun ? { metric: options.fun, mode: options.mode || "classic", role: options.role || "" } : null });
    const preview = !this.data.scoredOnly && !this.data.funFilter && personalPreview("matches");
    if (preview) this.setData({ records: presentMatches(preview.records), total: preview.total, hasMore: preview.hasMore, loaded: true });
    return this.load();
  },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching || this.data.adjustmentsLoading) return;
    this.fetching = true; this.setData({ loading: true, error: "", loadMoreError: false });
    try {
      await api.login();
      const result = await api.request(this.query(0));
      if (this.alive && result.filterOptions) this.filterOptions = result.filterOptions;
      if (this.alive) this.setData({ records: presentMatches(result.records).map(row => {
        const previous = this.data.records.find(old => old.id === row.id);
        return { ...row, expanded: !!previous?.expanded, membersExpanded: !!previous?.membersExpanded };
      }), total: result.total, hasMore: result.hasMore, loaded: true, adjustments: presentAdjustments(result.adjustments?.records || []), adjustmentsTotal: result.adjustments?.total || 0, adjustmentsMore: !!result.adjustments?.hasMore, adjustmentsError: "", filtersAvailable: !!result.filterOptions, ...filterState(this.data.filters, this.filterOptions, this.data.filterGroups) });
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  async loadMore() {
    if (this.fetching || this.data.adjustmentsLoading || !this.data.hasMore) return;
    this.fetching = true; this.setData({ loadingMore: true, error: "", loadMoreError: true });
    try {
      const result = await api.request(this.query(this.data.records.length));
      if (this.alive) this.setData({ records: this.data.records.concat(presentMatches(result.records)), total: result.total, hasMore: result.hasMore });
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loadingMore: false }); }
  },
  retry() { return this.data.loadMoreError ? this.loadMore() : this.load(); },
  query(offset) {
    const f = this.data.funFilter;
    const filters = Object.entries(this.data.filters).filter(([key, value]) => value !== defaultFilters[key])
      .map(([key, value]) => "&" + key + "=" + encodeURIComponent(value)).join("");
    return "/api/me/matches?offset=" + offset + (this.data.scoredOnly ? "&scored=1" : "")
      + (f ? "&fun=" + encodeURIComponent(f.metric) + "&mode=" + encodeURIComponent(f.mode) + (f.role ? "&role=" + encodeURIComponent(f.role) : "") : "") + filters;
  },
  toggleFilters() { this.setData({ filtersExpanded: !this.data.filtersExpanded }); },
  chooseFilter(e) {
    if (this.fetching || this.data.adjustmentsLoading || !this.data.filtersAvailable) return;
    const group = this.data.filterGroups.find(item => item.key === e.currentTarget.dataset.key);
    const option = group?.options[Number(e.detail.value)];
    if (!option || option.id === this.data.filters[group.key]) return;
    return this.applyFilters({ ...this.data.filters, [group.key]: option.id });
  },
  clearFilters() {
    if (this.fetching || this.data.adjustmentsLoading) return;
    return this.applyFilters({ ...defaultFilters });
  },
  applyFilters(filters) {
    this.setData({ ...filterState(filters, this.filterOptions, this.data.filterGroups), records: [], loaded: false, total: 0, hasMore: false,
      adjustments: [], adjustmentsTotal: 0, adjustmentsMore: false, adjustmentsError: "" });
    return this.load();
  },
  clearFunFilter() { if (this.fetching || this.data.adjustmentsLoading) return; this.setData({ funFilter: null, records: [], loaded: false, total: 0, hasMore: false }); return this.load(); },
  async loadAdjustments() {
    if(this.fetching || this.data.adjustmentsLoading)return;
    this.setData({adjustmentsLoading:true,adjustmentsError:""});
    try {
      const result=await api.request("/api/me/score-adjustments?offset="+this.data.adjustments.length);
      if(this.alive)this.setData({adjustments:this.data.adjustments.concat(presentAdjustments(result.records)),adjustmentsTotal:result.total,adjustmentsMore:result.hasMore});
    }catch(error){if(this.alive)this.setData({adjustmentsError:error.message});}
    finally{if(this.alive)this.setData({adjustmentsLoading:false});}
  },
  filterScores(e) {
    const scoredOnly = String(e.currentTarget.dataset.scored) === "1";
    if (this.fetching || this.data.adjustmentsLoading || scoredOnly === this.data.scoredOnly) return;
    this.setData({ scoredOnly, records: [], loaded: false, total: 0, hasMore: false });
    return this.load();
  },
  toggleRecord(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ records: this.data.records.map(record => record.id === id ? { ...record, expanded: !record.expanded } : record) });
  },
  toggleMembers(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ records: this.data.records.map(record => record.id === id && record.expanded ? { ...record, membersExpanded: !record.membersExpanded } : record) });
  },
  back: backToMe,
});
