const createLobby = require("./pages/table/controller");
const createPersonal = require("./pages/me/controller");
const { currentRoom } = require("./room-list");
const { selectTab } = require("./tab-navigation");
const { isSinglePage } = require("./records-share");
const intro = { label: "桌边助手", heading: "和朋友，一起入座", description: "创建或加入阿瓦隆牌桌，记录对局、战绩与趣味故事，让精彩留在同桌之间。" };

// Both entry routes use one retained page surface. Bottom tabs never navigate.
module.exports = function createHomePage(initialTab = 0) {
  const lobby = createLobby({ lobby: true }), personal = createPersonal();
  const page = {
    data: { activeTab: initialTab, lobby: lobby.data, personal: personal.data, singlePage: false, publicIntro: null },
    onLoad(query = {}) {
      this.alive = true;
      this.foreground = false;
      this.homeQuery = query;
      this.startedPanels = [false, false];
      const activeTab = query.main === "0" ? 0 : query.main === "1" ? 1 : initialTab;
      const singlePage = isSinglePage();
      this.setData({ activeTab, singlePage });
      if (singlePage) { this.setData({ publicIntro: intro }); return; }
      wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
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
          if (key === "lobby" && ["entrySheet", "roomMenu", "noteRoom"].some(name => name in values) || key === "personal" && "monthlyReset" in values) selectTab(host, host.data.activeTab);
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
        if (this.lobbyController.roomsServerTime) {
          controller.updateChangedData({ currentRoom: currentRoom(this.lobbyController.data.memberRooms) });
        }
      }
      return controller.onShow();
    },
    onShow() {
      if (this.data.singlePage) return;
      wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      const app = typeof getApp === "function" ? getApp() : null;
      if (app?.homeTabRequest) {
        const { selected: requested, entry } = app.homeTabRequest;
        delete app.homeTabRequest;
        if (entry && requested === 0) this.lobbyController.publicEntry = entry;
        this.switchMainTab(requested);
      }
      this.foreground = true;
      selectTab(this, this.data.activeTab);
      return this.showMainPanel(this.data.activeTab);
    },
    onReady() { if (this.data.singlePage) wx.setNavigationBarTitle?.({ title: intro.label }); },
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
      if (this.data.activeTab === 0 && this.startedPanels[0]) this.lobbyController.onPageScroll(event);
    },
    onResize(event) {
      if (this.startedPanels[0]) this.lobbyController.onResize(event);
    },
    switchMainTab(index) {
      if (!this.alive || this.data.singlePage || ![0, 1].includes(index) || index === this.data.activeTab) return;
      const previous = this.data.activeTab;
      if (this.startedPanels[previous]) {
        const controller = previous === 0 ? this.lobbyController : this.personalController;
        controller.onHide?.();
      }
      this.setData({ activeTab: index });
      selectTab(this, index);
      if (this.foreground) return this.showMainPanel(index);
    },
    getPersonalPreview(kind) {
      if (this.data.singlePage || this.data.activeTab !== 1) return null;
      return kind === "matches" ? this.personalController.matchesPreview : this.personalController.data[kind];
    },
    mask() { this.lobbyController?.mask(); },
    load() { return this.personalController.load(); },
    about() { return this.personalController.about(); },
    dismissMonthlyReset() { return this.personalController.dismissMonthlyReset(); },
    blockMonthlyResetScroll() {},
    onShareAppMessage() { return { title: "桌边助手 · 阿瓦隆线下助手", path: "/pages/lobby/lobby", imageUrl: "/assets/share-cover.jpg" }; },
    onShareTimeline() {
      const { title, imageUrl } = this.onShareAppMessage();
      return { title, imageUrl, query: "main=" + this.data.activeTab };
    },
  };
  const lifecycles = new Set(["onLoad", "onReady", "onShow", "onHide", "onUnload", "onPageScroll", "onResize", "onShareAppMessage", "onShareTimeline", "mask"]);
  for (const name of Object.keys(lobby)) {
    if (typeof lobby[name] === "function" && !lifecycles.has(name)) {
      page[name] = function(...args) { return this.lobbyController[name](...args); };
    }
  }
  return page;
};
