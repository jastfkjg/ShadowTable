// Shared catalogue. Ownership always comes from the server's current monthly ranks.
(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./fun-copy') : root.shadowtableFunCopy);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.shadowtableBadges = value;
})(typeof window === 'object' ? window : this, function (copy) {
  const rules = '按北京时间本月公开榜计算，当前第一名（含并列）持有；排名变化或跨月后自动重新计算。';
  const standard = [
    { id: 'points', title: '积分王者', description: '本月积分榜第一。每一分，都是牌桌上的实力积累。', metric: 'points' },
    { id: 'games', title: '牌桌常青树', description: '本月场次榜第一。常驻牌桌，热爱从不缺席。', metric: 'games' },
    { id: 'overall', title: '常胜将军', description: '本月总胜率榜第一。以原始胜率排名，胜率相同时按有效局数排序，两者相同则并列。', metric: 'overall' },
  ];
  const catalogue = standard.concat(Object.entries(copy.honors).map(([id, honor]) => ({
    id, title: honor.title, metric: 'fun_' + id,
    description: '本月「' + honor.title + '」次数榜第一。' + honor.description + '。',
  }))).map(badge => ({ ...badge, imageUrl: '/assets/badges/' + badge.id + '.png', rules }));
  const MAX_EQUIPPED = 3;
  function presentCollection(value, filter = 'all') {
    const owned = new Map((value.badges || []).map(b => [b.id, b]));
    const items = catalogue.map(b => ({ ...b, owned: owned.has(b.id), equipped: !!owned.get(b.id)?.equipped,
      condition: copy.labels[b.id] ? '本月' + copy.labels[b.id] + '次数第一' : b.description.split('。')[0],
      status: owned.has(b.id) ? (owned.get(b.id).equipped ? '已佩戴' : '已拥有') : '未拥有' }));
    items.sort((a, b) => Number(b.owned) - Number(a.owned));
    const badges = items.filter(b => b.owned), equipped = badges.filter(b => b.equipped);
    const month = new Date((value.periodStart || Date.now()) + 8 * 3600000);
    return { ...value, badges, items, visibleBadges: items.filter(b => filter === 'owned' ? b.owned : filter === 'unowned' ? !b.owned : true),
      slots: Array.from({ length: MAX_EQUIPPED }, (_, i) => equipped[i] || { id: 'empty-' + i, empty: true }),
      ownedCount: badges.length, totalCount: catalogue.length, unownedCount: catalogue.length - badges.length,
      equippedCount: equipped.length, maxEquipped: MAX_EQUIPPED,
      monthLabel: month.getUTCFullYear() + '年' + String(month.getUTCMonth() + 1).padStart(2, '0') + '月' };
  }
  return { catalogue, rules, MAX_EQUIPPED, presentCollection };
});
