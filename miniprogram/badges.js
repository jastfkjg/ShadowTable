// Shared catalogue. Monthly ranks and permanent campaign grants are server-owned.
(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./fun-copy') : root.shadowtableFunCopy);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.shadowtableBadges = value;
})(typeof window === 'object' ? window : this, function (copy) {
  const rules = '月榜徽章按北京时间本月公开榜计算，当前第一名（含并列）持有；排名变化或跨月后自动重新计算。活动纪念徽章由服务端授予，获得后永久保留，跨月不收回。';
  const standard = [
    { id: 'points', title: '积分王者', description: '本月积分榜第一。每一分，都是牌桌上的实力积累。', metric: 'points' },
    { id: 'games', title: '牌桌常青树', description: '本月场次榜第一。常驻牌桌，热爱从不缺席。', metric: 'games' },
    { id: 'overall', title: '常胜将军', description: '本月总胜率榜第一。以原始胜率排名，胜率相同时按有效局数排序，两者相同则并列。', metric: 'overall' },
  ];
  const monthly = standard.concat(Object.entries(copy.honors).map(([id, honor]) => ({
    id, title: honor.title, metric: 'fun_' + id,
    description: '本月「' + honor.title + '」次数榜第一。' + honor.description + '。',
  }))).map(badge => ({ ...badge, imageUrl: '/assets/badges/' + badge.id + '.png', rules,
    category: ({ points: '积分荣誉', games: '场次荣誉', overall: '胜率荣誉' })[badge.id] || '趣味荣誉',
    flavor: badge.description.split('。').slice(1).join('。') }));
  const october = [
    { id: 'october_2026_crown', title: '加冕圣剑', rank: 1, condition: '2026年10月积分榜第1名。' },
    { id: 'october_2026_silver', title: '银盔骑士', rank: 2, condition: '2026年10月积分榜第2名。' },
    { id: 'october_2026_stag', title: '林间守望', rank: 3, condition: '2026年10月积分榜第3名。' },
    { id: 'october_2026_table', title: '共建圆桌', condition: '2026年10月至少参加一场对局。' },
    { id: 'october_2026_book', title: '内测纪念册', condition: '2026年10月至少参加一场计分对局。', largeImageUrl: '/assets/badges/october_2026_book-large.png' },
  ].map(b => ({ ...b, permanent: true, metric: 'campaign', periodLabel: '2026年10月', category: b.rank ? '积分榜限定荣誉' : '内测参与纪念',
    imageUrl: '/assets/badges/' + b.id + '.png', holdingRule: '获得后永久保留', rules: '2026年10月内测限定纪念。积分前三名按首次发布时的公开榜排名锁定，含并列；参与纪念按北京时间10月归档对局授予，获得后永久保留。', description: b.condition }));
  const catalogue = monthly.concat(october);
  const MAX_EQUIPPED = 3;
  function presentCollection(value, filter = 'all', assetUrl = path => path) {
    const owned = new Map((value.badges || []).map(b => [b.id, b]));
    const items = catalogue.map(b => {
      const condition = (b.condition || (copy.labels[b.id] ? '本月' + copy.labels[b.id] + '次数第一' : b.description.split('。')[0])).replace(/。+$/, '');
      return { ...b, imageUrl: b.permanent ? assetUrl(b.imageUrl) : b.imageUrl, owned: owned.has(b.id), equipped: !!owned.get(b.id)?.equipped, slotIndex: owned.get(b.id)?.slotIndex,
      condition, detailCondition: condition,
      periodLabel: b.periodLabel || value.monthLabel || '', holdingRule: b.holdingRule || '榜首持有，含并列第一',
      status: owned.has(b.id) ? (owned.get(b.id).equipped ? '已佩戴' : '已拥有') : '未拥有' }; });
    items.sort((a, b) => Number(b.owned) - Number(a.owned));
    const badges = (value.badges || []).map(b => items.find(item => item.id === b.id)).filter(Boolean), equipped = badges.filter(b => b.equipped);
    equipped.forEach((b, i) => { if (!Number.isInteger(b.slotIndex)) b.slotIndex = i; });
    const month = new Date((value.periodStart || Date.now()) + 8 * 3600000);
    return { ...value, badges, items, visibleBadges: items.filter(b => filter === 'owned' ? b.owned : filter === 'unowned' ? !b.owned : true),
      availableBadges: badges.filter(b => !b.equipped), equippedBadges: equipped,
      slots: Array.from({ length: MAX_EQUIPPED }, (_, i) => equipped.find(b => b.slotIndex === i) || { id: 'empty-' + i, empty: true, slotIndex: i }),
      ownedCount: badges.length, totalCount: catalogue.length, unownedCount: catalogue.length - badges.length,
      equippedCount: equipped.length, maxEquipped: MAX_EQUIPPED,
      monthLabel: month.getUTCFullYear() + '年' + String(month.getUTCMonth() + 1).padStart(2, '0') + '月' };
  }
  return { catalogue, rules, MAX_EQUIPPED, presentCollection };
});
