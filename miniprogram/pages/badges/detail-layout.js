function measureBadgeDetail() {
  const selected = () => this.data.selectedBadge || this.data.rank?.selectedBadge;
  if (!selected() || typeof this.createSelectorQuery !== 'function') return;
  const id = selected().id;
  this.createSelectorQuery().select('.badge-detail-content').boundingClientRect(rect => {
    if (!this.alive || this.data.badgePicker || selected()?.id !== id || !rect?.height) return;
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ badgeDetailHeight: Math.min(Math.ceil(rect.height), Math.floor(windowInfo.windowHeight * .9)) });
  }).exec();
}
module.exports = { measureBadgeDetail };
