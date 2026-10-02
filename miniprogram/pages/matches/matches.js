const api = require("../../api");
const { presentMatches, presentAdjustments, backToMe, personalPreview } = require("../../profile");
Page({
  data: { loading: true, loadingMore: false, loaded: false, loadMoreError: false, error: "", records: [], total: 0, hasMore: false, scoredOnly: false, funFilter: null, adjustments: [], adjustmentsTotal: 0, adjustmentsMore: false, adjustmentsLoading: false, adjustmentsError: "" },
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
      if (this.alive) this.setData({ records: presentMatches(result.records).map(row => ({ ...row, expanded: this.data.records.some(old => old.id === row.id && old.expanded) })), total: result.total, hasMore: result.hasMore, loaded: true, adjustments: presentAdjustments(result.adjustments?.records || []), adjustmentsTotal: result.adjustments?.total || 0, adjustmentsMore: !!result.adjustments?.hasMore, adjustmentsError: "" });
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
  query(offset) { const f = this.data.funFilter; return "/api/me/matches?offset=" + offset + (this.data.scoredOnly ? "&scored=1" : "") + (f ? "&fun=" + encodeURIComponent(f.metric) + "&mode=" + encodeURIComponent(f.mode) + (f.role ? "&role=" + encodeURIComponent(f.role) : "") : ""); },
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
  back: backToMe,
});
