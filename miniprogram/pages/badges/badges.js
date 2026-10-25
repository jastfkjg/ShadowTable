const dialog = require("../../dialog");
const api = require('../../api');
const { presentCollection, rules } = require('../../badges');
const { initialBadgeManager, badgeManagerMethods } = require('../../badge-manager');
const { backToMe } = require('../../profile');
Page({
  data: { ...initialBadgeManager, badgeFilter: 'all', selectedBadge: null, badgeManaging: false, badgeDetailHeight: 0 },
  ...badgeManagerMethods(),
  onLoad() { this.alive = true; },
  async onShow() {
    this.alive = true;
    const sequence = this.badgeManagerSequence = (this.badgeManagerSequence || 0) + 1;
    this.setData({ badgeManagerLoading: true, badgeManagerError: '' });
    try {
      await api.login();
      if (this.alive && sequence === this.badgeManagerSequence) return this.loadBadgeManager();
    } catch (e) {
      if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeManagerLoading: false, badgeManagerError: e.message });
    }
  },
  onHide() { this.alive = false; this.badgeManagerSequence++; this.setData({ ...initialBadgeManager, selectedBadge: null, badgeManaging: false, badgeDetailHeight: 0 }); },
  onUnload() { this.alive = false; this.badgeManagerSequence++; },
  onResize() { if (this.data.selectedBadge) this.measureBadgeDetail(); },
  async onPullDownRefresh() { try { this.closeBadgeDetail(); await this.loadBadgeManager(); } finally { wx.stopPullDownRefresh(); } },
  chooseBadgeFilter(e) {
    const badgeFilter = e.currentTarget.dataset.id;
    if (!['all', 'owned', 'unowned'].includes(badgeFilter)) return;
    this.setData({ badgeFilter, ...(this.data.badgeCollection ? { badgeCollection: presentCollection(this.data.badgeCollection, badgeFilter, api.assetUrl) } : {}) });
  },
  showBadgeDetail(e) {
    const selectedBadge = this.data.badgeCollection?.items.find(b => b.id === e.currentTarget.dataset.id);
    if (selectedBadge) this.setData({ selectedBadge, badgeDetailHeight: 0 }, () => this.measureBadgeDetail());
  },
  measureBadgeDetail() {
    if (!this.data.selectedBadge || typeof this.createSelectorQuery !== 'function') return;
    const id = this.data.selectedBadge.id;
    this.createSelectorQuery().select('.badge-detail-content').boundingClientRect(rect => {
      if (!this.alive || this.data.selectedBadge?.id !== id || !rect?.height) return;
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ badgeDetailHeight: Math.min(Math.ceil(rect.height), Math.floor(windowInfo.windowHeight * .9)) });
    }).exec();
  },
  closeBadgeDetail() { this.setData({ selectedBadge: null, badgeDetailHeight: 0 }); },
  manageBadges() { if (!this.data.badgeManagerSaving && !this.data.badgeManagerLoading) this.setData({ badgeManaging: !this.data.badgeManaging }); },
  showBadgeRules() { dialog.show({ title: '荣誉徽章规则', content: rules + '\n趣味徽章按次数榜授予。最多佩戴3枚，展示在玩家名片中；佩戴已满时，请先摘下一枚。', showCancel: false }); },
  blockScroll() {},
  back: backToMe,
});
