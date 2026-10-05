const windowInfo = wx.getWindowInfo?.() || wx.getSystemInfoSync();
const statusBarHeight = windowInfo.statusBarHeight || 20;
const menu = wx.getMenuButtonBoundingClientRect?.();
const menuGap = menu && menu.top > statusBarHeight ? menu.top - statusBarHeight : 6;
const navHeight = menu?.height ? menu.height + menuGap * 2 : 44;
const windowWidth = windowInfo.windowWidth || 375;
// Keep the optional title action inside the space before WeChat's capsule.
const shareTitleShift = windowWidth < 360 ? 12 : 0;
const shareTitleWidth = Math.max(44, Math.min(windowWidth * .52, 2 * ((menu?.left || windowWidth - 96) - 8 + shareTitleShift) - windowWidth));

Component({
  properties: {
    title: { type: String, value: "" },
    back: { type: Boolean, value: false },
    backLabel: { type: String, value: "返回" },
    backText: { type: String, value: "" },
    share: { type: Boolean, value: false },
    shareDisabled: { type: Boolean, value: false },
    shareLabel: { type: String, value: "分享成绩图片" },
  },
  data: { statusBarHeight, navHeight, totalHeight: statusBarHeight + navHeight, shareTitleWidth, shareTitleShift },
  methods: {
    goBack() { this.triggerEvent("back"); },
    shareImage() { if (this.properties.share && !this.properties.shareDisabled) this.triggerEvent("share"); },
  },
});
