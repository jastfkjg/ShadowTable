const createStatistics = require("../stats/controller");
const createHistory = require("../matches/controller");
const { backToMe } = require("../../profile");

// Both public routes enter the same retained surface; tabs never add pages.
module.exports = function createRecordsPage(initialTab = "records") {
  const statistics = createStatistics(), history = createHistory();
  const page = {
    data: { tab: initialTab, statistics: statistics.data, history: history.data, historyStarted: false,
      scrollTops: { records: 0, matches: 0, fun: 0 }, historyFromFun: false },
    onLoad(options = {}) {
      this.alive = true;
      this.scrollPositions = { records: 0, matches: 0, fun: 0 };
      this.statisticsStarted = false;
      this.historyOptions = options;
      this.statisticsController = this.attachController(statistics, "statistics");
      this.historyController = this.attachController(history, "history");
      const tab = ["records", "matches", "fun"].includes(options.tab) ? options.tab : initialTab;
      this.setData({ tab });
      return this.ensurePanel(tab);
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
      if (!this.alive || !["records", "matches", "fun"].includes(tab) || tab === this.data.tab) return;
      if (this.data.history.filtersExpanded) this.historyController.closeFilters();
      this.setData({ tab, ["scrollTops." + tab]: this.scrollPositions[tab] });
      return this.ensurePanel(tab);
    },
    rememberScroll(event) {
      const tab = event.currentTarget.dataset.tab;
      if (this.alive && tab === this.data.tab) {
        this.scrollPositions[tab] = event.detail.scrollTop;
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
    shareStats() {
      if (this.data.tab !== "matches") return this.statisticsController.shareStats();
    },
    historyClearFunFilter() {
      if (this.historyController.fetching) return;
      this.setData({ historyFromFun: false });
      return this.historyController.clearFunFilter();
    },
    back() {
      if (this.data.history.filtersExpanded) return this.historyController.closeFilters();
      if (this.data.tab === "matches" && this.data.historyFromFun) return this.switchPanel("fun");
      return backToMe();
    },
    onUnload() {
      this.alive = false;
      this.statisticsController?.onUnload();
      this.historyController?.onUnload();
    },
  };
  const excluded = new Set(["onLoad", "onUnload", "back", "chooseTab", "shareStats"]);
  for (const name of Object.keys(statistics)) {
    if (typeof statistics[name] === "function" && !excluded.has(name))
      page[name] = function(...args) { return this.statisticsController[name](...args); };
  }
  for (const name of Object.keys(history)) {
    const handler = "history" + name[0].toUpperCase() + name.slice(1);
    if (typeof history[name] === "function" && !excluded.has(name) && !page[handler])
      page[handler] = function(...args) { return this.historyController[name](...args); };
  }
  return page;
};
