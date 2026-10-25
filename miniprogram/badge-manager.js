const api = require('./api');
const { catalogue, presentCollection, MAX_EQUIPPED } = require('./badges');
const initialBadgeManager = { badgeCollection: null, badgeTotalCount: catalogue.length, badgeManagerLoading: false, badgeManagerSaving: false, badgeManagerError: '' };
function badgeManagerMethods() {
  return {
    async loadBadgeManager() {
      if (this.data.badgeManagerSaving) return;
      const sequence = this.badgeManagerSequence = (this.badgeManagerSequence || 0) + 1;
      this.setData({ badgeManagerLoading: true, badgeManagerError: '' });
      try {
        const value = await api.request('/api/me/badges');
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeCollection: presentCollection(value, this.data.badgeFilter, api.assetUrl) });
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
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeCollection: presentCollection(value, this.data.badgeFilter, api.assetUrl), selectedBadge: null });
      } catch (e) {
        if (this.alive && sequence === this.badgeManagerSequence) {
          // Reconcile an ambiguous network result before permitting another toggle.
          this.setData({ badgeCollection: null, selectedBadge: null, badgeManagerError: e.message + '，请刷新徽章后重试。' });
        }
      } finally {
        if (this.alive && sequence === this.badgeManagerSequence) this.setData({ badgeManagerSaving: false });
      }
    },
  };
}
module.exports = { initialBadgeManager, badgeManagerMethods };
