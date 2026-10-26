const createStatistics = require("../stats/controller");
const createHistory = require("../matches/controller");
const { backToMe } = require("../../profile");
const { withoutAvatar } = require("../../honors");
const recordsShare = require("../../records-share");
const createSharedPage = require("../shared/controller");

// Both public routes enter the same retained surface; tabs never add pages.
module.exports = function createRecordsPage(initialTab = "records") {
  const statistics = createStatistics(), history = createHistory();
  const page = {
    data: { tab: initialTab, statistics: statistics.data, history: history.data, historyStarted: false, singlePage: false, sharedSurface: false, publicShare: {},
      scrollTops: { records: 0, matches: 0, fun: 0 }, historyFromFun: false },
    onLoad(options = {}) {
      this.alive = true;
      this.foreground = true;
      const tab = ["records", "matches", "fun"].includes(options.tab) ? options.tab : initialTab;
      const singlePage = recordsShare.isSinglePage();
      this.setData({ tab, singlePage, sharedSurface: singlePage || options.share != null });
      if (this.data.sharedSurface) {
        const host = this;
        this.sharedController = createSharedPage();
        this.sharedController.setData = values => {
          Object.assign(this.sharedController.data, values);
          if (host.alive) host.setData({ publicShare: { ...this.sharedController.data } });
        };
        return this.sharedController.onLoad(options);
      }
      wx.hideShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      this.scrollPositions = { records: 0, matches: 0, fun: 0 };
      this.statisticsStarted = false;
      this.historyOptions = options;
      this.statisticsController = this.attachController(statistics, "statistics");
      this.historyController = this.attachController(history, "history");
      return this.ensurePanel(tab);
    },
    onShareAppMessage() {
      if (this.sharedController) return this.sharedController.onShareAppMessage();
      const content = recordsShare.friendContent(this.data.tab, this.preparedShare);
      return this.preparedShare || !this.sharePromise ? content
        : { ...content, promise: this.sharePromise.then(snapshot => recordsShare.friendContent(this.data.tab, snapshot)) };
    },
    onShareTimeline() {
      if (this.sharedController) return this.sharedController.onShareTimeline();
      const content = recordsShare.timelineContent(this.data.tab, this.preparedShare);
      return this.preparedShare ? { ...content, query: "tab=" + this.data.tab + "&share=" + this.preparedShare.id } : content;
    },
    retrySharedRecord() { return this.sharedController?.retrySharedRecord(); },
    sharedAvatarError() { return this.sharedController?.sharedAvatarError(); },
    sharedPoster() { return this.sharedController?.sharedPoster(); },
    onShow() {
      this.foreground = true;
      if (this.sharedController) return this.sharedController.onShow();
      if (this.alive && typeof wx.showShareMenu === "function") {
        this.prepareRecordsShare();
        if (this.preparedShare) wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      }
    },
    onHide() {
      this.foreground = false;
      this.sharedController?.onHide();
      if (!this.preparedShare) {
        this.shareSequence = (this.shareSequence || 0) + 1;
        this.shareKey = null;
        this.sharePromise = null;
      }
    },
    openFunDetails(event) {
      this.selectedFunShareKey = event.currentTarget.dataset.key;
      this.scheduleRecordsShare();
      return this.statisticsController.openFunDetails(event);
    },
    historyToggleRecord(event) {
      this.selectedMatchShareId = event.currentTarget.dataset.id;
      this.historyController.toggleRecord(event);
      this.scheduleRecordsShare();
    },
    scheduleRecordsShare() {
      if (!this.alive || this.sharedController || this.shareQueued || typeof wx.showShareMenu !== "function") return;
      this.shareQueued = true;
      Promise.resolve().then(() => { this.shareQueued = false; if (this.alive) this.prepareRecordsShare(); });
    },
    prepareRecordsShare() {
      if (!this.foreground || typeof wx.showShareMenu !== "function") return;
      const stats = this.statisticsController?.data, history = this.historyController?.data;
      let selection, source;
      if (this.data.tab === "records" && !stats?.loading && !stats?.error && stats?.stats?.total) {
        selection = { kind: "stats" };
        source = [stats.stats.total, stats.stats.wins, stats.stats.score, stats.stats.byRole?.map(row => [row.role, row.faction, row.total, row.wins])];
      } else if (this.data.tab === "matches" && !history?.loading && !history?.error && history?.records?.length) {
        const record = history.records.find(row => row.id === this.selectedMatchShareId && row.expanded);
        if (record) {
          selection = { kind: "match", match: record.id };
          source = [record.role, record.faction, record.outcome, record.score, record.fun];
        }
      } else if (this.data.tab === "fun" && !stats?.loading && !stats?.error) {
        const tiles = stats?.stats?.fun?.tiles || [];
        const tile = tiles.find(row => row.key === this.selectedFunShareKey && row.known);
        if (tile) { selection = { kind: "fun", metric: tile.id, mode: tile.mode }; source = [tile.count, tile.opportunities, tile.knownGames]; }
      }
      const key = selection ? JSON.stringify([selection, source]) : null;
      if (key && key === this.shareKey) return;
      this.shareKey = key;
      this.preparedShare = null;
      const sequence = this.shareSequence = (this.shareSequence || 0) + 1;
      wx.hideShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      if (!selection) { this.sharePromise = null; return; }
      this.sharePromise = recordsShare.create(selection).then(snapshot => {
        if (!this.alive || !this.foreground || sequence !== this.shareSequence || !recordsShare.validId(snapshot?.id)) return null;
        this.preparedShare = snapshot;
        wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
        return snapshot;
      }).catch(() => { if (this.alive && sequence === this.shareSequence) this.shareKey = null; return null; });
    },
    attachController(definition, key) {
      const host = this;
      return { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
        setData(values, callback) {
          Object.assign(this.data, values);
          if (!host.alive || host[key + "Controller"] !== this) return;
          const patch = {};
          for (const name of Object.keys(values)) patch[key + "." + name] = values[name];
          host.setData(patch, callback);
          host.scheduleRecordsShare();
        },
      };
    },
    ensurePanel(tab) {
      if (tab === "matches") {
        if (this.data.historyStarted) return;
        this.setData({ historyStarted: true });
        return this.historyController.onLoad(this.historyOptions);
      }
      this.statisticsController.setData({ tab });
      if (this.statisticsStarted) return;
      this.statisticsStarted = true;
      return this.statisticsController.onLoad({ tab });
    },
    chooseTab(event) { return this.switchPanel(event.currentTarget.dataset.id); },
    switchPanel(tab) {
      if (!this.alive || this.data.singlePage || !["records", "matches", "fun"].includes(tab) || tab === this.data.tab) return;
      if (this.data.history.filtersExpanded) this.historyController.closeFilters();
      if (this.data.statistics.statsDetail) this.statisticsController.closeStatsDetails();
      this.setData({ tab, ["scrollTops." + tab]: this.scrollPositions[tab] });
      this.scheduleRecordsShare();
      return this.ensurePanel(tab);
    },
    rememberScroll(event) {
      const tab = event.currentTarget.dataset.tab;
      if (this.alive && tab === this.data.tab) {
        this.scrollPositions[tab] = event.detail.scrollTop;
        if (tab === "matches") this.historyController.clearScrollTarget();
      }
    },
    async openHistory(options, fromFun = false) {
      if (!this.alive) return;
      this.historyController.onUnload();
      const controller = this.historyController = this.attachController(createHistory(), "history");
      this.historyOptions = options;
      const previousTop = this.scrollPositions.matches;
      this.scrollPositions.matches = 0;
      this.setData({ tab: "matches", history: controller.data, historyStarted: true,
        historyFromFun: fromFun, "scrollTops.matches": previousTop }, () => {
        if (this.alive && this.historyController === controller) this.setData({ "scrollTops.matches": 0 });
      });
      await controller.onLoad(options);
    },
    openFunMatches(event) {
      const query = String(event.currentTarget.dataset.url || "").split("?")[1] || "";
      const options = {};
      for (const pair of query.split("&")) {
        const [key, value] = pair.split("=");
        if (["fun", "mode", "role"].includes(key)) options[key] = decodeURIComponent(value || "");
      }
      if (options.fun) return this.openHistory(options, true);
    },
    openScoreHistory() {
      if (this.data.statistics.loading || this.data.statistics.error) return;
      wx.navigateTo({ url: "/pages/scores/scores" });
    },
    historyClearFunFilter() {
      if (this.historyController.fetching) return;
      this.setData({ historyFromFun: false });
      return this.historyController.clearFunFilter();
    },
    honorAvatarError(event) {
      const url = event.currentTarget.dataset.url;
      this.historyController.setData({ records: this.historyController.data.records.map(record => ({ ...record, honors: withoutAvatar(record.honors, url) })) });
    },
    back() {
      if (this.data.statistics.statsDetail) return this.statisticsController.closeStatsDetails();
      if (this.data.history.filtersExpanded) return this.historyController.closeFilters();
      if (this.data.tab === "matches" && this.data.historyFromFun) return this.switchPanel("fun");
      return backToMe();
    },
    onUnload() {
      this.alive = false;
      this.shareSequence = (this.shareSequence || 0) + 1;
      this.sharedController?.onUnload();
      this.statisticsController?.onUnload();
      this.historyController?.onUnload();
    },
  };
  const excluded = new Set(["onLoad", "onReady", "onUnload", "back", "chooseTab", "onShareAppMessage", "onShareTimeline"]);
  for (const name of Object.keys(statistics)) {
    if (typeof statistics[name] === "function" && !excluded.has(name) && !page[name])
      page[name] = function(...args) { return this.statisticsController[name](...args); };
  }
  for (const name of Object.keys(history)) {
    const handler = "history" + name[0].toUpperCase() + name.slice(1);
    if (typeof history[name] === "function" && !excluded.has(name) && !page[handler])
      page[handler] = function(...args) { return this.historyController[name](...args); };
  }
  return page;
};
