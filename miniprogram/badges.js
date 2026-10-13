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
  return { catalogue, rules, MAX_EQUIPPED: 3 };
});
