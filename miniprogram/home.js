const createLobby = require("./pages/table/controller");
const createPersonal = require("./pages/me/controller");
const { selectTab } = require("./tab-navigation");

// Both entry routes use one retained page surface. Bottom tabs never navigate.
module.exports = function createHomePage(initialTab = 0) {
  const lobby = createLobby({ lobby: true }), personal = createPersonal();
  const page = {
    data: { activeTab: initialTab, lobby: lobby.data, personal: personal.data },
    onLoad(query = {}) {
      this.alive = true;
      this.foreground = false;
      this.homeQuery = query;
      this.startedPanels = [false, false];
      this.tabScrollTops = [0, 0];
      const host = this;
      const attach = (definition, key) => ({
        ...definition,
        data: JSON.parse(JSON.stringify(host.data[key])),
        getTabBar: () => host.getTabBar?.(),
        setData(values, callback) {
          Object.assign(this.data, values);
          if (!host.alive) return;
          const patch = {};
          for (const name of Object.keys(values)) patch[key + "." + name] = values[name];
          host.setData(patch, callback);
          // The custom tab bar lives outside the page's stacking context.
          // Remove it while the sheet is open, even when the keyboard is closed.
          if (key === "lobby" && "entrySheet" in values) selectTab(host, host.data.activeTab);
        },
      });
      this.lobbyController = attach(lobby, "lobby");
      this.personalController = attach(personal, "personal");
    },
    showMainPanel(index) {
      const controller = index === 0 ? this.lobbyController : this.personalController;
      if (!this.startedPanels[index]) {
        this.startedPanels[index] = true;
        const loading = controller.onLoad(this.homeQuery);
        // The lobby bootstraps on load; personal reads start on show.
        if (index === 0) return loading;
      }
      return controller.onShow();
    },
    onShow() {
      const app = typeof getApp === "function" ? getApp() : null;
      if (app?.homeTabRequest) {
        const requested = app.homeTabRequest.selected;
        delete app.homeTabRequest;
        this.switchMainTab(requested);
      }
      this.foreground = true;
      selectTab(this, this.data.activeTab);
      return this.showMainPanel(this.data.activeTab);
    },
    onHide() {
      this.foreground = false;
      if (this.startedPanels[this.data.activeTab]) {
        const controller = this.data.activeTab === 0 ? this.lobbyController : this.personalController;
        controller.onHide?.();
      }
    },
    onUnload() {
      this.alive = false;
      this.foreground = false;
      if (this.startedPanels[0]) this.lobbyController.onUnload();
      if (this.startedPanels[1]) this.personalController.onUnload();
    },
    onPageScroll(event) {
      if (!this.restoringTabScroll) this.tabScrollTops[this.data.activeTab] = event.scrollTop;
    },
    switchMainTab(index) {
      if (!this.alive || ![0, 1].includes(index) || index === this.data.activeTab) return;
      const previous = this.data.activeTab;
      if (this.startedPanels[previous]) {
        const controller = previous === 0 ? this.lobbyController : this.personalController;
        controller.onHide?.();
      }
      const scrollTop = this.tabScrollTops[index];
      const sequence = this.tabSwitchSequence = (this.tabSwitchSequence || 0) + 1;
      this.restoringTabScroll = true;
      this.setData({ activeTab: index }, () => {
        if (!this.alive || sequence !== this.tabSwitchSequence) return;
        const complete = () => { if (sequence === this.tabSwitchSequence) this.restoringTabScroll = false; };
        if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop, duration: 0, complete });
        else complete();
      });
      selectTab(this, index);
      if (this.foreground) return this.showMainPanel(index);
    },
    getPersonalPreview(kind) {
      if (this.data.activeTab !== 1) return null;
      return kind === "matches" ? this.personalController.matchesPreview : this.personalController.data[kind];
    },
    mask() { this.lobbyController?.mask(); },
    load() { return this.personalController.load(); },
    about() { return this.personalController.about(); },
    onShareAppMessage() { return { title: "桌边助手 · ShadowTable", path: "/pages/lobby/lobby" }; },
  };
  const lifecycles = new Set(["onLoad", "onReady", "onShow", "onHide", "onUnload", "onPageScroll", "onResize", "onShareAppMessage", "mask"]);
  for (const name of Object.keys(lobby)) {
    if (typeof lobby[name] === "function" && !lifecycles.has(name)) {
      page[name] = function(...args) { return this.lobbyController[name](...args); };
    }
  }
  return page;
};
