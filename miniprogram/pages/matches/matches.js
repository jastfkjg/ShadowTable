const api = require("../../api");
const { presentMatches, backToMe, personalPreview } = require("../../profile");
Page({
  data: { loading: true, loadingMore: false, loaded: false, loadMoreError: false, error: "", records: [], total: 0, hasMore: false },
  onLoad() {
    this.alive = true;
    const preview = personalPreview("matches");
    if (preview) this.setData({ records: presentMatches(preview.records), total: preview.total, hasMore: preview.hasMore, loaded: true });
    return this.load();
  },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    this.fetching = true; this.setData({ loading: true, error: "", loadMoreError: false });
    try {
      await api.login();
      const result = await api.request("/api/me/matches?offset=0");
      if (this.alive) this.setData({ records: presentMatches(result.records).map(row => ({ ...row, expanded: this.data.records.some(old => old.id === row.id && old.expanded) })), total: result.total, hasMore: result.hasMore, loaded: true });
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  async loadMore() {
    if (this.fetching || !this.data.hasMore) return;
    this.fetching = true; this.setData({ loadingMore: true, error: "", loadMoreError: true });
    try {
      const result = await api.request("/api/me/matches?offset=" + this.data.records.length);
      if (this.alive) this.setData({ records: this.data.records.concat(presentMatches(result.records)), total: result.total, hasMore: result.hasMore });
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loadingMore: false }); }
  },
  retry() { return this.data.loadMoreError ? this.loadMore() : this.load(); },
  toggleRecord(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ records: this.data.records.map(record => record.id === id ? { ...record, expanded: !record.expanded } : record) });
  },
  back: backToMe,
});
