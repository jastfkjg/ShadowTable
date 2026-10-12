const api = require("../../api");
const { backToMe } = require("../../profile");
const { presentReplay, trajectory } = require("../../replay");
Page({
  data: { loading: true, error: "", replay: null, view: "global", initialPlayers: [], finalPlayers: [],
    rounds: [], taskPips: [], selfTrajectory: null, playerDetail: null, playersExpanded: false },
  onLoad(options = {}) { this.alive = true; this.id = options.id || ""; return this.load(); },
  onUnload() { this.alive = false; this.rawReplay = null; },
  async load() {
    if (this.fetching) return;
    if (!this.id) { this.setData({ loading: false, error: "对局记录不存在或已移除" }); return; }
    this.fetching = true; this.setData({ loading: true, error: "", playerDetail: null });
    try {
      await api.login();
      const result = await api.request("/api/me/matches/" + encodeURIComponent(this.id) + "/replay");
      if (this.alive) { this.rawReplay = result.replay; this.setData(presentReplay(this.rawReplay, this.data.view)); }
    } catch (error) { if (this.alive) this.setData({ replay: null, error: error.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  chooseView(e) {
    const view = e.currentTarget.dataset.view;
    if (!this.rawReplay || !["global", "mine"].includes(view) || view === this.data.view) return;
    this.setData(presentReplay(this.rawReplay, view, this.data.rounds.filter(r => r.expanded).map(r => r.id)));
  },
  toggleRound(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ rounds: this.data.rounds.map(r => r.id === id ? { ...r, expanded: !r.expanded } : r) });
  },
  openPlayer(e) {
    if (!this.rawReplay) return;
    const detail = trajectory(this.rawReplay, Number(e.currentTarget.dataset.seat));
    if (detail) this.setData({ playerDetail: detail });
  },
  closePlayer() { this.setData({ playerDetail: null }); },
  blockScroll() {},
  togglePlayers() { this.setData({ playersExpanded: !this.data.playersExpanded }); },
  jumpTo(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.replay || !["replay-initial", "replay-final", ...this.data.rounds.map(r => r.id)].includes(id)) return;
    if (id.startsWith("round-")) this.setData({ rounds: this.data.rounds.map(r => r.id === id ? { ...r, expanded: true } : r) }, () => this.scrollTo(id));
    else this.scrollTo(id);
  },
  scrollTo(id) {
    const query = wx.createSelectorQuery();
    query.select(".replay-nav").boundingClientRect();
    query.select("#" + id).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec(([header, section, viewport]) => {
      if (this.alive && header && section && viewport)
        wx.pageScrollTo({ scrollTop: Math.max(0, viewport.scrollTop + section.top - header.height - 16), duration: 0 });
    });
  },
  back() { if (this.data.playerDetail) return this.closePlayer(); return backToMe(); },
});
