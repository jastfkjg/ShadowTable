const api = require("../../api");
const { groups, metrics, presentLeaderboard, isPointsUnavailable } = require("../../leaderboard");
const { backToMe } = require("../../profile");
Page({
  data: { groups, metrics, rateMetrics: metrics.filter(item => ["overall","good","evil"].includes(item.id)), metric: "points", funSelected: false, funAvailable: false, funMode: "all", funSort: "count", funRole: "", funMetrics: [], funOptions: [], funActiveId: "", funRoleOptions: [{id:"",label:"全部角色"}], funRoleIndex: 0, pointsAvailable: true, period: "all", loading: true, loadingMore: false, error: "", moreError: false, notice: "", board: null, visible: false, visibilitySaving: false, visibilityError: "" },
  onLoad() { this.alive = true; },
  onShow() { return this.load(); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(more = false, selection = {}) {
    if (more && (this.data.loading || this.data.loadingMore || !this.data.board?.hasMore)) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    let { metric } = { ...this.data, ...selection };
    const { period, board, funMode, funSort, funRole } = { ...this.data, ...selection };
    let append = more, pointsUnavailable = false, funUnavailable = false;
    this.failedSelection = null;
    // Keep the rendered snapshot mounted until the replacement is ready.
    this.setData({ ...selection, funSelected: metric.startsWith("fun_"), funActiveId: "rank-" + metric, loading: !more, loadingMore: more, error: "", moreError: more, notice: "" });
    try {
      await api.login();
      const query = "?metric=" + metric + "&period=" + period + (metric.startsWith("fun_") ? "&mode=" + funMode + "&sort=" + funSort + (funRole ? "&role=" + funRole : "") : "") + (more ? "&offset=" + board.nextOffset + "&version=" + board.version : "");
      let response;
      try { response = await api.request("/api/leaderboard" + query); }
      catch (e) {
        if (!["points"].includes(metric) && !metric.startsWith("fun_") || !isPointsUnavailable(e)) throw e;
        if (!this.alive || sequence !== this.sequence) return;
        // Older services know the existing leaderboards but reject the new metric.
        pointsUnavailable = metric === "points"; funUnavailable = metric.startsWith("fun_");
        metric = "games"; append = false;
        response = await api.request("/api/leaderboard?metric=games&period=" + period);
      }
      const result = presentLeaderboard(response);
      if (!this.alive || sequence !== this.sequence) return;
      if (append) result.rows = board.rows.concat(result.rows);
      const pointsAvailable = Array.isArray(result.availableMetrics) ? result.availableMetrics.includes("points") : !pointsUnavailable && this.data.pointsAvailable;
      const funMetrics = result.availableFunMetrics || [];
      const resolvedMode = result.mode || funMode;
      const funOptions = funMetrics.map(item => ({ ...item, tabLabel: item.title + " · " + item.label }));
      const funRoleOptions = [{ id:"", label:"全部角色" }, ...(result.roleOptions || [])];
      this.setData({ metric: result.metric, pointsAvailable, period: result.period, board: result, loading: false, loadingMore: false,
        funSelected: !!result.fun, funAvailable: !funUnavailable && !!funMetrics.length, funMetrics, funOptions, funMode: resolvedMode, funSort: result.sort || funSort, funRole: result.role || "", funActiveId: "rank-" + result.metric, funRoleOptions, funRoleIndex: Math.max(0,funRoleOptions.findIndex(item => item.id === result.role)),
        notice: funUnavailable ? "当前服务尚未开放趣味榜，已显示局数榜。" : pointsAvailable ? "" : pointsUnavailable ? "当前服务尚未开放积分榜，已显示局数榜。" : "当前服务尚未开放积分榜。",
        ...(!this.visibilityPending ? { visible: !['hidden','unsupported'].includes(result.me.status) } : {}) });
    } catch (e) {
      if (!this.alive || sequence !== this.sequence) return;
      if (append && e.status === 409) {
        await this.load();
        if (this.alive && sequence + 1 === this.sequence && !this.data.error)
          this.setData({ notice: "榜单已更新，已重新加载。" });
      } else {
        this.failedSelection = { metric, period, funMode, funSort, funRole };
        this.setData({ error: e.message, loading: false, loadingMore: false, moreError: append,
          ...(pointsUnavailable ? { pointsAvailable: false, notice: "当前服务尚未开放积分榜。" } : {}),
          ...(!more && board ? { metric: board.metric, period: board.period, funSelected: !!board.fun, funActiveId: "rank-" + board.metric, funMode: board.mode || funMode, funSort: board.sort || funSort, funRole: board.role || "" } : {}) });
      }
    }
  },
  chooseGroup(e) {
    if (e.currentTarget.dataset.id === "fun") {
      if (!this.data.funAvailable || this.data.funSelected) return;
      return this.load(false,{metric:"fun_merlin_evade",funMode:"all",funRole:"",funSort:"count"});
    }
    if (e.currentTarget.dataset.id === "overall" && ["overall", "good", "evil"].includes(this.data.metric)) return;
    return this.chooseMetric(e);
  },
  chooseMetric(e) {
    const metric = e.currentTarget.dataset.id;
    if (!metrics.some(item => item.id === metric) || metric === this.data.metric || metric === "points" && !this.data.pointsAvailable) return;
    return this.load(false, { metric });
  },
  chooseFunMetric(e) { const key=e.currentTarget.dataset.id; if(key!==this.data.metric && this.data.funOptions.some(item=>item.key===key)) return this.load(false,{metric:key,funMode:"all",funRole:""}); },
  chooseFunSort(e) { const funSort=e.currentTarget.dataset.id; if(["count","rate"].includes(funSort) && funSort!==this.data.funSort) return this.load(false,{funSort}); },
  chooseFunRole(e) { const role=this.data.funRoleOptions[Number(e.detail.value)]; if(role) return this.load(false,{funRole:role.id}); },
  choosePeriod(e) {
    const period = e.currentTarget.dataset.id;
    if (!["all", "month"].includes(period) || period === this.data.period) return;
    return this.load(false, { period });
  },
  loadMore() { return this.load(true); },
  retry() { return this.load(this.data.moreError, this.failedSelection || {}); },
  async changeVisibility(e) {
    if (this.data.visibilitySaving || !this.data.board || this.data.board.me.status === "unsupported") return;
    const visible = this.visibilityPending ? this.visibilityPending.data.leaderboardVisible : e.detail.value;
    this.visibilityTarget = visible;
    this.visibilityPending ||= { id: api.requestId(), data: { leaderboardVisible: visible } };
    this.setData({ visible, visibilitySaving: true, visibilityError: "" });
    try {
      await api.login();
      await api.request("/api/me/leaderboard-visibility", "POST", this.visibilityPending.data, this.visibilityPending.id);
      this.visibilityPending = null;
      if (this.alive) await this.load();
    } catch (e) {
      if (e.status && e.status < 500 && ![401,429].includes(e.status)) this.visibilityPending = null;
      if (this.alive) this.setData({ visible: !['hidden','unsupported'].includes(this.data.board.me.status), visibilityError: e.message });
    } finally {
      if (this.alive) this.setData({ visibilitySaving: false });
    }
  },
  retryVisibility() { return this.changeVisibility({ detail: { value: this.visibilityTarget } }); },
  back: backToMe,
});
