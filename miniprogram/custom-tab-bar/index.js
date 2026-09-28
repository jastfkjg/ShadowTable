const list = [
  { pagePath: "pages/lobby/lobby", text: "对局", iconPath: "/assets/tab-table.png", selectedIconPath: "/assets/tab-table-active.png" },
  { pagePath: "pages/me/me", text: "我的", iconPath: "/assets/tab-me.png", selectedIconPath: "/assets/tab-me-active.png" },
];

Component({
  data: { selected: 0, list },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (index === this.data.selected || !this.data.list[index]) return;
      wx.switchTab({ url: "/" + this.data.list[index].pagePath });
    },
  },
});
