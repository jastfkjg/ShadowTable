const { switchHomeTab } = require("../tab-navigation");
Component({
  data: {
    selected: 0,
    keyboardVisible: false,
    list: [
      { pagePath: "/pages/lobby/lobby", text: "对局", icon: "/assets/tab-table.png", activeIcon: "/assets/tab-table-active.png" },
      { pagePath: "/pages/me/me", text: "我的", icon: "/assets/tab-me.png", activeIcon: "/assets/tab-me-active.png" },
    ],
  },
  lifetimes: {
    // Also handles a component attached after the page's onShow has already run.
    attached() {
      this.syncSelection();
      this.keyboardListener = ({ height }) => {
        const keyboardVisible = height > 0;
        if (keyboardVisible !== this.data.keyboardVisible) this.setData({ keyboardVisible });
      };
      wx.onKeyboardHeightChange?.(this.keyboardListener);
    },
    detached() { wx.offKeyboardHeightChange?.(this.keyboardListener); },
  },
  pageLifetimes: {
    show() { this.switching = false; this.syncSelection(); },
  },
  methods: {
    syncSelection() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const selected = typeof page?.switchMainTab === "function" ? page.data.activeTab
        : this.data.list.findIndex(item => item.pagePath === "/" + page?.route);
      if (selected >= 0 && selected !== this.data.selected) this.setData({ selected });
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.list[index];
      if (!item || index === this.data.selected || this.switching) return;
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      if (typeof page?.switchMainTab === "function") {
        page.switchMainTab(index);
        return;
      }
      this.switching = true;
      // Let the destination page select its own instance. Keep this one correct
      // if switching fails or the user returns from another page.
      switchHomeTab(index, {
        complete: () => { this.switching = false; },
      });
    },
  },
});
