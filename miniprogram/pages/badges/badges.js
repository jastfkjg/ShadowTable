const dialog = require("../../dialog");
const api = require('../../api');
const { presentCollection, rules } = require('../../badges');
const { initialBadgeManager, badgeManagerMethods } = require('../../badge-manager');
const { backToMe } = require('../../profile');
Page({
  data: { ...initialBadgeManager, badgeFilter: 'all', selectedBadge: null, badgeManaging: false, badgeDetailHeight: 0, badgePicker: '', badgePickerSlot: null, badgePickerHeight: 0 },
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
  onHide() { this.alive = false; this.badgeManagerSequence++; this.setData({ ...initialBadgeManager, selectedBadge: null, badgeManaging: false, badgeDetailHeight: 0, badgePicker: '' }); },
  onUnload() { this.alive = false; this.badgeManagerSequence++; },
  onResize() { if (this.data.badgePicker) this.measureBadgePicker(); else this.measureBadgeDetail(); },
  async onPullDownRefresh() {
    try {
      if (!this.data.badgeManagerSaving) {
        this.closeBadgeDetail();
        await this.loadBadgeManager();
      }
    } finally { wx.stopPullDownRefresh(); }
  },
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
      if (!this.alive || this.data.badgePicker || this.data.selectedBadge?.id !== id || !rect?.height) return;
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ badgeDetailHeight: Math.min(Math.ceil(rect.height), Math.floor(windowInfo.windowHeight * .9)) });
    }).exec();
  },
  closeBadgeDetail() {
    if (!this.data.badgeManagerSaving) this.setData({ selectedBadge: null, badgeDetailHeight: 0, badgePicker: '', badgePickerChoice: null });
  },
  openBadgePicker(e) {
    const { badgeCollection, badgeManagerSaving, badgeManagerLoading } = this.data;
    const badgePickerSlot = Number(e.currentTarget.dataset.slot);
    if (badgeManagerSaving || badgeManagerLoading || !badgeCollection?.slots[badgePickerSlot]?.empty) return;
    this.setData({ badgePicker: 'add', badgePickerSlot, badgePickerChoice: null, badgePickerHeight: 0 }, () => this.measureBadgePicker());
  },
  openBadgeReplacement() {
    const { selectedBadge, badgeCollection, badgeManagerSaving, badgeManagerLoading } = this.data;
    if (badgeManagerSaving || badgeManagerLoading || !badgeCollection || !selectedBadge?.owned || selectedBadge.equipped ||
        badgeCollection.equippedCount < badgeCollection.maxEquipped) return;
    this.setData({ badgePicker: 'replace', badgePickerChoice: null, badgePickerHeight: 0 }, () => this.measureBadgePicker());
  },
  measureBadgePicker() {
    const { badgePicker, badgePickerChoice } = this.data;
    if (!badgePicker || typeof this.createSelectorQuery !== 'function') return;
    this.createSelectorQuery().select('.badge-picker-content').boundingClientRect()
      .select('.badge-picker-header').boundingClientRect().select('.badge-picker-footer').boundingClientRect()
      .exec(([content, header, footer]) => {
        if (!this.alive || badgePicker !== this.data.badgePicker || badgePickerChoice?.id !== this.data.badgePickerChoice?.id ||
            !content?.height || !header?.height || !footer?.height) return;
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const availableHeight = Math.floor(windowInfo.windowHeight * .9) - Math.ceil(header.height + footer.height) - 2;
        this.setData({ badgePickerHeight: Math.max(1, Math.min(Math.ceil(content.height), availableHeight)) });
      });
  },
  chooseBadgePickerItem(e) {
    const { badgePicker, badgeCollection, badgeManagerSaving, badgeManagerLoading } = this.data;
    if (!badgePicker || !badgeCollection || badgeManagerSaving || badgeManagerLoading) return;
    const choices = badgePicker === 'add' ? badgeCollection.availableBadges : badgeCollection.equippedBadges;
    const badgePickerChoice = choices.find(badge => badge.id === e.currentTarget.dataset.id);
    if (badgePickerChoice) this.setData({ badgePickerChoice }, () => this.measureBadgePicker());
  },
  confirmBadgePicker() {
    const { badgePicker, badgePickerChoice, badgePickerSlot, selectedBadge } = this.data;
    if (!badgePicker || !badgePickerChoice) return;
    const dataset = badgePicker === 'add'
      ? { id: badgePickerChoice.id, slotIndex: badgePickerSlot }
      : { id: selectedBadge.id, replaceId: badgePickerChoice.id };
    return this.toggleOwnedBadge({ currentTarget: { dataset } });
  },
  closeBadgePicker() {
    if (!this.data.badgeManagerSaving) this.setData({ badgePicker: '', badgePickerChoice: null, badgeDetailHeight: 0 }, () => this.measureBadgeDetail());
  },
  manageBadges() { if (!this.data.badgeManagerSaving && !this.data.badgeManagerLoading) this.setData({ badgeManaging: !this.data.badgeManaging }); },
  showBadgeRules() { dialog.show({ title: '荣誉徽章规则', content: rules + '\n趣味徽章按次数榜授予。最多佩戴3枚，展示在玩家名片中；佩戴已满时可替换已佩戴的徽章。', showCancel: false }); },
  blockScroll() {},
  back: backToMe,
});
