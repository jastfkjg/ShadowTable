const api = require("../../api");
const { initialPlayerCardData, playerCardMethods } = require("../../player-card");
const { groups, metrics, presentLeaderboard, isPointsUnavailable } = require("../../leaderboard");
const rankPresentation = require("../../leaderboard-presentation");
const { backToMe } = require("../../profile");
const { boardSelection, queryString, leaderboardShareError } = require("../../share-card");
Page({
  data: { ...initialPlayerCardData, mineExpanded: false, metricsExpanded: false, rulesExpanded: false, funCategories: rankPresentation.categories, funCategory: "all", pendingFunMetric: "", pendingFunOption: null, filteredFunOptions: [], funOptionsScrollTop: 0, funOptionsScrollTarget: "", funOptionsCanScroll: false, groups, metrics, rateMetrics: metrics.filter(item => ["overall","good","evil"].includes(item.id)), metric: "points", funSelected: false, funAvailable: false, funMode: "all", funSort: "count", funMetrics: [], funOptions: [], pointsAvailable: true, period: "month", loading: true, loadingMore: false, error: "", moreError: false, notice: "", board: null, shareNotice: "", shareOpening: false, visible: false, visibilitySaving: false, visibilityError: "" },
  ...playerCardMethods(api),
  onLoad() { this.alive = true; this.foreground = true; },
  onShow() { this.foreground = true; return this.load(); },
  onResize() { if (this.data.metricsExpanded) this.measureFunOptions(this.data.funOptionsScrollTarget); },
  onHide() { this.foreground = false; this.closePlayerCard(); },
  openRankPlayerCard(e) {
    const id = e.currentTarget.dataset.id, row = this.data.board?.rows.find(row => row.publicId === id);
    if (!row || this.foreground === false || this.data.loading || this.data.loadingMore || this.data.visibilitySaving) return;
    this.setData({ mineExpanded: false, metricsExpanded: false, rulesExpanded: false });
    return this.loadPlayerCard({ scope: "leaderboard", id, name: row.nickname, avatarUrl: row.avatarUrl,
      initial: row.initial, avatarFailed: !!row.avatarFailed }, `/api/leaderboard/players/${encodeURIComponent(id)}/stats`);
  },
  retryPlayerCard() { if (this.data.playerCard && !this.data.playerCardLoading) return this.openRankPlayerCard({ currentTarget: { dataset: { id: this.data.playerCard.id } } }); },
  rankAvatarError(e) {
    const { id, url } = e.currentTarget.dataset, board = this.data.board;
    if (board?.rows.some(row => row.publicId === id && row.avatarUrl === url))
      this.setData({ board: { ...board, rows: board.rows.map(row => row.publicId === id ? { ...row, avatarFailed: true } : row) } });
  },
  shareLeaderboard() {
    if (this.data.loading || this.data.loadingMore || this.data.visibilitySaving || this.data.shareOpening) return;
    const error = this.data.error ? "请先重试读取榜单，再分享成绩。" : leaderboardShareError(this.data.board);
    if (error) return this.showShareNotice(error);
    this.setData({ shareNotice: "", shareOpening: true });
    wx.navigateTo({ url: "/pages/share/share?" + queryString(boardSelection(this.data.board)),
      fail: () => { if (this.alive) this.showShareNotice("分享页暂时无法打开，请稍后重试。"); },
      complete: () => { if (this.alive) this.setData({ shareOpening: false }); },
    });
  },
  showShareNotice(message) {
    this.setData({ shareNotice: message });
    wx.showToast({ title: message, icon: "none", duration: 3000 });
  },
  onUnload() { this.closePlayerCard(); this.alive = false; this.sequence = (this.sequence || 0) + 1; },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load(more = false, selection = {}) {
    if (more && (this.data.loading || this.data.loadingMore || !this.data.board?.hasMore)) return;
    this.closePlayerCard();
    const sequence = this.sequence = (this.sequence || 0) + 1;
    let { metric } = { ...this.data, ...selection };
    const { board } = this.data;
    const period = metric === "points" ? "month" : (selection.period || this.data.period);
    const countOnly = /^fun_(honor_(mvp|svp)|survival_(revive|knifed))$/.test(metric);
    const selected = { ...this.data, ...selection };
    const funMode = countOnly ? "all" : selected.funMode, funSort = countOnly ? "count" : selected.funSort;
    let append = more, pointsUnavailable = false, funUnavailable = false;
    this.failedSelection = null;
    // Keep the rendered snapshot mounted until the replacement is ready.
    this.setData({ ...selection, period, metricsExpanded: false, rulesExpanded: false, funSelected: metric.startsWith("fun_"), loading: !more, loadingMore: more, error: "", moreError: more, notice: "", shareNotice: "" });
    try {
      await api.login();
      const query = "?metric=" + metric + "&period=" + period + (metric.startsWith("fun_") ? "&mode=" + funMode + "&sort=" + funSort : "") + (more ? "&offset=" + board.nextOffset + "&version=" + board.version : "");
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
      if (append) Object.assign(result, rankPresentation.presentBoard({ ...result, rows: board.rows.concat(result.rows) }));
      const pointsAvailable = Array.isArray(result.availableMetrics) ? result.availableMetrics.includes("points") : !pointsUnavailable && this.data.pointsAvailable;
      const funMetrics = (result.availableFunMetrics || []).filter(item => item.key !== "fun_final_hit");
      const resolvedMode = result.mode || funMode;
      const funOptions = rankPresentation.funOptions(funMetrics);
      const pendingFunOption = funOptions.find(item => item.key === result.metric) || funOptions[0] || null;
      const funCategory = "all";
      this.setData({ metric: result.metric, pointsAvailable, period: result.period, board: result, loading: false, loadingMore: false,
        funSelected: !!result.fun, funAvailable: !funUnavailable && !!funMetrics.length, funMetrics, funOptions, funCategory, pendingFunOption, pendingFunMetric: pendingFunOption?.key || "", filteredFunOptions: funOptions, funMode: resolvedMode, funSort: result.sort || funSort,
        notice: funUnavailable ? "当前服务尚未开放趣味榜，已显示局数榜。" : pointsAvailable ? "" : pointsUnavailable ? "当前服务尚未开放积分榜，已显示局数榜。" : "当前服务尚未开放积分榜。",
        ...(!this.visibilityPending ? { visible: !['hidden','unsupported'].includes(result.me.status) } : {}) });
    } catch (e) {
      if (!this.alive || sequence !== this.sequence) return;
      if (append && e.status === 409) {
        await this.load();
        if (this.alive && sequence + 1 === this.sequence && !this.data.error)
          this.setData({ notice: "榜单已更新，已重新加载。" });
      } else {
        this.failedSelection = { metric, period, funMode, funSort };
        this.setData({ error: e.message, loading: false, loadingMore: false, moreError: append,
          ...(pointsUnavailable ? { pointsAvailable: false, notice: "当前服务尚未开放积分榜。" } : {}),
          ...(!more && board ? { metric: board.metric, period: board.period, funSelected: !!board.fun, funMode: board.mode || funMode, funSort: board.sort || funSort } : {}) });
      }
    }
  },
  chooseGroup(e) {
    if (e.currentTarget.dataset.id === "fun") {
      if (!this.data.funAvailable || this.data.funSelected) return;
      return this.load(false,{metric:this.data.funOptions[0].key,funMode:"all",funSort:"count"});
    }
    if (e.currentTarget.dataset.id === "overall" && ["overall", "good", "evil"].includes(this.data.metric)) return;
    return this.chooseMetric(e);
  },
  chooseMetric(e) {
    const metric = e.currentTarget.dataset.id;
    if (!metrics.some(item => item.id === metric) || metric === this.data.metric || metric === "points" && !this.data.pointsAvailable) return;
    return this.load(false, { metric });
  },
  chooseFunMetric(e) {
    const key = e.currentTarget.dataset.id;
    if (!this.data.funOptions.some(item => item.key === key)) return;
    this.setData({ metricsExpanded: false });
    if (key !== this.data.metric) return this.load(false, { metric: key, funMode: "all", funSort: this.data.funOptions.find(item => item.key === key)?.countOnly ? "count" : this.data.funSort });
  },
  chooseFunSort(e) { const funSort=e.currentTarget.dataset.id; if(!(this.data.board?.countOnly && funSort === "rate") && ["count","rate"].includes(funSort) && funSort!==this.data.funSort) return this.load(false,{funSort}); },
  choosePeriod(e) {
    const period = e.currentTarget.dataset.id;
    if (this.data.metric === "points" || !["all", "month"].includes(period) || period === this.data.period) return;
    return this.load(false, { period });
  },
  toggleMine() { this.closePlayerCard(); this.setData({ mineExpanded: !this.data.mineExpanded, metricsExpanded: false, rulesExpanded: false }); },
  toggleRules() { this.closePlayerCard(); this.setData({ rulesExpanded: !this.data.rulesExpanded, mineExpanded: false, metricsExpanded: false }); },
  toggleMetrics() {
    if (this.data.metricsExpanded) { this.setData({ metricsExpanded: false }); return; }
    if (this.data.loading || !this.data.funOptions.length) return;
    this.closePlayerCard();
    const option = this.data.funOptions.find(item => item.key === this.data.metric) || this.data.funOptions[0];
    this.funOptionsOffset = 0;
    this.setData({ metricsExpanded: true, mineExpanded: false, rulesExpanded: false, pendingFunMetric: option.key,
      pendingFunOption: option, funCategory: "all", filteredFunOptions: this.data.funOptions,
      funOptionsScrollTop: 0, funOptionsScrollTarget: "", funOptionsCanScroll: true });
    this.measureFunOptions("fun-option-" + option.key);
  },
  chooseFunCategory(e) {
    const category = e.currentTarget.dataset.id;
    if (!rankPresentation.categories.some(item => item.id === category)) return;
    this.funOptionsOffset = 0;
    const filteredFunOptions = rankPresentation.filterFunOptions(this.data.funOptions, category);
    this.setData({ funCategory: category, filteredFunOptions,
      funOptionsScrollTop: 0, funOptionsScrollTarget: "", funOptionsCanScroll: true });
    this.measureFunOptions(filteredFunOptions[0] ? "fun-option-" + filteredFunOptions[0].key : "");
  },
  previewFunMetric(e) {
    const option = this.data.filteredFunOptions.find(item => item.key === e.currentTarget.dataset.id);
    if (option) this.setData({ pendingFunMetric: option.key, pendingFunOption: option });
  },
  confirmFunMetric() {
    if (this.data.loading || !this.data.metricsExpanded) return;
    return this.chooseFunMetric({ currentTarget: { dataset: { id: this.data.pendingFunMetric } } });
  },
  measureFunOptions(scrollTarget) {
    if (!wx.createSelectorQuery) return;
    const category = this.data.funCategory;
    const measure = () => {
      if (!this.alive || !this.data.metricsExpanded || this.data.funCategory !== category) return;
      this.setData({ funOptionsScrollTarget: scrollTarget });
      wx.createSelectorQuery().in(this)
      .select(".fun-metric-options").boundingClientRect()
      .select(".fun-options-content").boundingClientRect()
      .exec(rects => {
        if (!this.alive || !this.data.metricsExpanded || this.data.funCategory !== category || !rects[0] || !rects[1]) return;
        this.funOptionsHeight = rects[0].height;
        this.updateFunOptionsHint(rects[1].height);
      });
    };
    if (wx.nextTick) wx.nextTick(measure); else measure();
  },
  updateFunOptionsHint(scrollHeight) {
    if (!this.funOptionsHeight) return;
    const canScroll = scrollHeight - (this.funOptionsOffset || 0) - this.funOptionsHeight > 2;
    if (canScroll !== this.data.funOptionsCanScroll) this.setData({ funOptionsCanScroll: canScroll });
  },
  onFunOptionsScroll(e) {
    this.funOptionsOffset = e.detail.scrollTop;
    this.updateFunOptionsHint(e.detail.scrollHeight);
  },
  onFunOptionsBottom() { this.setData({ funOptionsCanScroll: false }); },
  blockScroll() {},
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
      if (this.alive) this.setData({ visible: !['hidden','unsupported'].includes(this.data.board.me.status), visibilityError: e.message, mineExpanded: true });
    } finally {
      if (this.alive) this.setData({ visibilitySaving: false });
    }
  },
  retryVisibility() { return this.changeVisibility({ detail: { value: this.visibilityTarget } }); },
  back: backToMe,
});
