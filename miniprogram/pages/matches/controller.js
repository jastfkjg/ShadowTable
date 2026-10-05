const api = require("../../api");
const { presentMatches, backToMe, personalPreview } = require("../../profile");
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
function draftState(filters, options, previousGroups) {
  const state = filterState({ ...filters }, options, previousGroups);
  return { draftFilters: state.filters, draftFilterGroups: state.filterGroups };
}
function completeOutcomeSummary(records, total, hasMore) {
  // Never present a loaded page's wins/losses as the whole filtered result.
  if (hasMore || !total || records.length !== total) return "";
  const wins = records.filter(row => row.outcome === "win").length;
  const losses = records.filter(row => row.outcome === "loss").length;
  const excluded = total - wins - losses;
  return `${wins} 胜 · ${losses} 负${excluded ? ` · ${excluded} 场不计入` : ""}`;
}
module.exports = function createController() { return {
  data: { loading: true, loadingMore: false, loaded: false, loadMoreError: false, error: "", records: [], total: 0, hasMore: false, outcomeSummary: "", scoredOnly: false, funFilter: null, filtersAvailable: false, filtersExpanded: false, ...filterState(defaultFilters), ...draftState(defaultFilters) },
  onLoad(options = {}) {
    this.alive = true;
    this.setData({ scoredOnly: options.scored === "1", funFilter: options.fun ? { metric: options.fun, mode: options.mode || "classic", role: options.role || "" } : null });
    const preview = !this.data.scoredOnly && !this.data.funFilter && personalPreview("matches");
    if (preview) this.setData({ records: presentMatches(preview.records), total: preview.total, hasMore: preview.hasMore, outcomeSummary: completeOutcomeSummary(preview.records, preview.total, preview.hasMore), loaded: true });
    return this.load();
  },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    this.fetching = true; this.setData({ loading: true, error: "", loadMoreError: false });
    try {
      await api.login();
      const result = await api.request(this.query(0));
      if (this.alive && result.filterOptions) this.filterOptions = result.filterOptions;
      if (this.alive) this.setData({ records: presentMatches(result.records).map(row => {
        const previous = this.data.records.find(old => old.id === row.id);
        return { ...row, expanded: !!previous?.expanded, membersExpanded: !!previous?.membersExpanded };
      }), total: result.total, hasMore: result.hasMore, outcomeSummary: completeOutcomeSummary(result.records, result.total, result.hasMore), loaded: true, filtersAvailable: !!result.filterOptions, ...filterState(this.data.filters, this.filterOptions, this.data.filterGroups) });
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  async loadMore() {
    if (this.fetching || !this.data.hasMore) return;
    this.fetching = true; this.setData({ loadingMore: true, error: "", loadMoreError: true });
    try {
      const result = await api.request(this.query(this.data.records.length));
      if (this.alive) {
        const records = this.data.records.concat(presentMatches(result.records));
        this.setData({ records, total: result.total, hasMore: result.hasMore, outcomeSummary: completeOutcomeSummary(records, result.total, result.hasMore) });
      }
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
  toggleFilters() {
    if (this.data.filtersExpanded) return this.closeFilters();
    if (this.fetching || !this.data.filtersAvailable) return;
    this.setData({ filtersExpanded: true, ...draftState(this.data.filters, this.filterOptions, this.data.filterGroups) });
  },
  closeFilters() { this.setData({ filtersExpanded: false }); },
  blockScroll() {},
  chooseFilter(e) {
    if (this.fetching || !this.data.filtersAvailable || !this.data.filtersExpanded) return;
    const group = this.data.draftFilterGroups.find(item => item.key === e.currentTarget.dataset.key);
    const option = group?.options[Number(e.detail.value)];
    if (!option || option.id === this.data.draftFilters[group.key]) return;
    this.setData(draftState({ ...this.data.draftFilters, [group.key]: option.id }, this.filterOptions, this.data.draftFilterGroups));
  },
  resetDraftFilters() {
    if (this.fetching || !this.data.filtersExpanded) return;
    this.setData(draftState(defaultFilters, this.filterOptions));
  },
  confirmFilters() {
    if (this.fetching || !this.data.filtersExpanded) return;
    const filters = { ...this.data.draftFilters };
    this.closeFilters();
    if (Object.keys(defaultFilters).every(key => filters[key] === this.data.filters[key])) return;
    return this.applyFilters(filters);
  },
  clearFilters() {
    if (this.fetching) return;
    return this.applyFilters({ ...defaultFilters });
  },
  applyFilters(filters) {
    this.setData({ ...filterState(filters, this.filterOptions, this.data.filterGroups), records: [], loaded: false, total: 0, hasMore: false });
    return this.load();
  },
  clearFunFilter() { if (this.fetching) return; this.setData({ funFilter: null, records: [], loaded: false, total: 0, hasMore: false }); return this.load(); },
  filterScores(e) {
    const scoredOnly = String(e.currentTarget.dataset.scored) === "1";
    if (this.fetching || scoredOnly === this.data.scoredOnly) return;
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
}; };
