const windowInfo = wx.getWindowInfo?.() || wx.getSystemInfoSync();
const statusBarHeight = windowInfo.statusBarHeight || 20;
const menu = wx.getMenuButtonBoundingClientRect?.();
const menuGap = menu && menu.top > statusBarHeight ? menu.top - statusBarHeight : 6;
const navHeight = menu?.height ? menu.height + menuGap * 2 : 44;
const windowWidth = windowInfo.windowWidth || 375;
// Keep long titles and the optional title action clear of WeChat's capsule.
function titleBounds(width, capsule) {
  const shareTitleShift = width < 360 ? 12 : 0;
  const capsuleLeft = capsule?.left > 0 && capsule.left < width ? capsule.left : width - 96;
  const shareTitleWidth = Math.max(44, Math.min(width * .52, 2 * (capsuleLeft - 8 + shareTitleShift) - width));
  return { shareTitleShift, shareTitleWidth, titleWidth: Math.min(shareTitleWidth, width * .48) };
}
const { shareTitleWidth, shareTitleShift, titleWidth } = titleBounds(windowWidth, menu);

Component({
  properties: {
    title: { type: String, value: "" },
    connectionContext: { type: String, value: "" },
    back: { type: Boolean, value: false },
    backLabel: { type: String, value: "返回" },
    backText: { type: String, value: "" },
    constrainTitle: { type: Boolean, value: false },
    share: { type: Boolean, value: false },
    shareDisabled: { type: Boolean, value: false },
    shareLabel: { type: String, value: "分享成绩图片" },
  },
  data: { statusBarHeight, navHeight, totalHeight: statusBarHeight + navHeight, shareTitleWidth, shareTitleShift, titleWidth },
  pageLifetimes: {
    resize(event) {
      const width = event?.size?.windowWidth || event?.windowWidth || wx.getWindowInfo?.().windowWidth || windowWidth;
      this.setData(titleBounds(width, wx.getMenuButtonBoundingClientRect?.()));
    },
  },
  methods: {
    goBack() { this.triggerEvent("back"); },
    shareImage() { if (this.properties.share && !this.properties.shareDisabled) this.triggerEvent("share"); },
  },
});
