const api = require('./api');
const { catalogue, MAX_EQUIPPED } = require('./badges');
const initialBadgeManager = { badgeManagerOpen: false, badgeCollection: null, badgeManagerLoading: false, badgeManagerSaving: false, badgeManagerError: '' };
const present = value => ({ ...value, equippedCount: value.badges.filter(b => b.equipped).length, maxEquipped: MAX_EQUIPPED, badges: value.badges.filter(b => catalogue.some(c => c.id === b.id))
  .map(b => ({ ...b, imageUrl: catalogue.find(c => c.id === b.id).imageUrl })) });
function badgeManagerMethods() {
  return {
    async toggleBadgeManager() {
      const open = !this.data.badgeManagerOpen;
      this.badgeManagerSequence = (this.badgeManagerSequence || 0) + 1;
      this.setData({ badgeManagerOpen: open, badgeManagerSaving: false });
      if (open) return this.loadBadgeManager();
    },
    async loadBadgeManager() {
      const sequence = this.badgeManagerSequence = (this.badgeManagerSequence || 0) + 1;
      this.setData({ badgeManagerLoading: true, badgeManagerError: '' });
      try {
        const value = await api.request('/api/me/badges');
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeCollection: present(value) });
      } catch (e) {
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeManagerError: e.message });
      } finally {
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeManagerLoading: false });
      }
    },
    async toggleOwnedBadge(e) {
      if (this.data.badgeManagerSaving || this.data.badgeManagerLoading) return;
      const collection = this.data.badgeCollection, badge = collection?.badges.find(b => b.id === e.currentTarget.dataset.id);
      if (!badge) return;
      if (!badge.equipped && collection.badges.filter(b => b.equipped).length >= MAX_EQUIPPED) {
        this.setData({ badgeManagerError: '最多佩戴3枚徽章，请先摘下一枚' });
        return;
      }
      const sequence = this.badgeManagerSequence;
      this.setData({ badgeManagerSaving: true, badgeManagerError: '' });
      try {
        const value = await api.request('/api/me/badges', 'POST', { id: badge.id, equipped: !badge.equipped, version: collection.version, periodStart: collection.periodStart }, api.requestId());
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeCollection: present(value) });
      } catch (e) {
        if (this.alive && sequence === this.badgeManagerSequence) {
          // Reconcile an ambiguous network result before permitting another toggle.
          this.setData({ badgeCollection: null, badgeManagerError: e.message + '，请刷新徽章后重试。' });
        }
      } finally {
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeManagerSaving: false });
      }
    },
  };
}
module.exports = { initialBadgeManager, badgeManagerMethods };
