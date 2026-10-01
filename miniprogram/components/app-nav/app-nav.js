const { restorePageBackground } = require("../../ui-theme");
const windowInfo = wx.getWindowInfo?.() || wx.getSystemInfoSync();
const statusBarHeight = windowInfo.statusBarHeight || 20;
const menu = wx.getMenuButtonBoundingClientRect?.();
const menuGap = menu && menu.top > statusBarHeight ? menu.top - statusBarHeight : 6;
const navHeight = menu?.height ? menu.height + menuGap * 2 : 44;

Component({
  lifetimes: { attached() { restorePageBackground(); } },
  pageLifetimes: { show() { restorePageBackground(); } },
  properties: {
    title: { type: String, value: "" },
    back: { type: Boolean, value: false },
    backLabel: { type: String, value: "返回" },
  },
  data: { statusBarHeight, navHeight, totalHeight: statusBarHeight + navHeight },
  methods: {
    goBack() { this.triggerEvent("back"); },
  },
});
