// Shared catalogue. Monthly ranks and permanent campaign grants are server-owned.
(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./fun-copy') : root.shadowtableFunCopy);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.shadowtableBadges = value;
})(typeof window === 'object' ? window : this, function (copy) {
  const rules = '本月榜首徽章随北京时间本月公开榜实时更新。榜单徽章沿用对应榜单的对局人数门槛。每月1日结算上月公开积分月榜，前三名（含并列）获得永久徽章。活动纪念徽章获得后也永久保留。反馈首次被采纳可获得永久「共建者」徽章。';
  const standard = [
    { id: 'points', title: '积分王者', description: '本月积分榜第一。每一分，都是牌桌上的实力积累。', metric: 'points' },
    { id: 'games', title: '牌桌常青树', description: '本月场次榜第一。常驻牌桌，热爱从不缺席。', metric: 'games' },
    { id: 'overall', title: '常胜将军', description: '本月总胜率榜第一。以原始胜率排名，胜率相同时按有效局数排序，两者相同则并列。', metric: 'overall' },
  ];
  const funMonthly = Object.entries({ ...copy.honors, ...copy.roleRecords }).map(([id, honor]) => ({
    id, title: honor.title, metric: 'fun_' + id,
    description: '本月「' + honor.title + '」' + (copy.roleRecords[id] ? '达成' : '') + '次数榜第一。' + honor.description.replace(/。+$/, '') + '。',
  }));
  const monthly = standard.concat(funMonthly).map(badge => ({ ...badge, imageUrl: '/assets/badges/' + badge.id + '.png', rules,
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
  const contributor = {
    id: 'feedback_contributor', title: '共建者', permanent: true, metric: 'feedback', periodLabel: '永久',
    category: '社区贡献', condition: '首次有一条反馈被采纳。', description: '首次有一条反馈被采纳。',
    flavor: '谢谢你留下这一笔，让下一桌玩得更好。', holdingRule: '获得后永久保留',
    rules: '管理员采纳反馈后发放，每位玩家只获得一次。',
    imageUrl: '/assets/badges/feedback_contributor.png', largeImageUrl: '/assets/badges/feedback_contributor-large.png',
  };
  const permanent = october.concat(contributor);
  const catalogue = monthly.concat(permanent);
  // The server also uses catalogue order to choose default equipped badges.
  const funByRole = monthly.slice(standard.length).sort((a, b) => copy.compareDisplayIds(a.id, b.id));
  const collectionCatalogue = monthly.slice(0, standard.length).concat(funByRole, permanent);
  const placementTitles = ['交剑王冠', '持枪骑士', '铜铸城钥'];
  function monthlyAward(id) {
    const match = /^monthly_points_(\d{4}-(?:0[1-9]|1[0-2]))_([1-3])$/.exec(id);
    if (!match) return null;
    const [, month, place] = match;
    const rank = Number(place), periodLabel = month.replace('-', '年') + '月';
    const condition = periodLabel + '积分月榜第' + rank + '名';
    return { id, month, rank, periodLabel, title: placementTitles[rank - 1], condition,
      description: condition, category: '积分月榜荣誉', metric: 'monthly_points', permanent: true,
      imageUrl: '/assets/badges/monthly-points/' + month + '/' + rank + '.png',
      holdingRule: '获得后永久保留', rules: '每月1日按北京时间结算上月公开积分月榜。前三名（含并列）获得对应名次的永久徽章。' };
  }
  const awardDefinition = id => monthlyAward(id) || permanent.find(b => b.id === id);
  const MAX_EQUIPPED = 3;
  const usesServerArt = badge => !!(badge.permanent || badge.id === 'good_shield' || Object.hasOwn(copy.roleRecords, badge.id));
  const badgeImageUrl = (badge, assetUrl) => usesServerArt(badge) ? assetUrl(badge.imageUrl) : badge.imageUrl;
  function presentPlayerBadge(badge, assetUrl = path => path) {
    const definition = catalogue.find(item => item.id === badge.id) || monthlyAward(badge.id);
    if (!definition) return null;
    return { ...badge, ...definition, imageUrl: badgeImageUrl(definition, assetUrl) };
  }
  const detailNotes = {
    overall: '按原始胜率排序，胜率相同时比较有效局数。',
    survival_revive: '统计十二骑士中实际发生的复活。',
    survival_knifed: '统计十二骑士中实际承受的轮内刀和最终刀，无论是否生效或复活。',
    percival_bust: '仅统计派西维尔玩家。',
    good_shield: '终局存活的非梅林好人被最终刀选中，含派西维尔。',
    defense_ally: '统计守卫、魔术师的防御技能。',
    defense_enemy: '统计守卫、魔术师的防御技能。',
    kill_enemy: '仅统计有击杀技能的玩家。',
    kill_ally: '仅统计有击杀技能的玩家。',
  };
  function presentCollection(value, filter = 'all', assetUrl = path => path) {
    const owned = new Map((value.badges || []).map(b => [b.id, b]));
    const placements = Array.from(owned.keys(), monthlyAward).filter(Boolean);
    const items = placements.concat(collectionCatalogue).map(b => {
      const roleRecord = copy.roleRecords[b.id];
      const condition = (b.condition || (!roleRecord && copy.labels[b.id] ? '本月' + copy.labels[b.id] + '次数第一' : b.description.split('。')[0])).replace(/。+$/, '');
      return { ...b, imageUrl: badgeImageUrl(b, assetUrl), owned: owned.has(b.id), equipped: !!owned.get(b.id)?.equipped, slotIndex: owned.get(b.id)?.slotIndex,
      condition, detailCondition: b.permanent ? condition : condition + '（含并列）', detailNote: roleRecord?.description || detailNotes[b.id] || '', kindLabel: b.permanent ? '永久' : '月榜',
      periodLabel: b.periodLabel || value.monthLabel || '', holdingRule: b.holdingRule || '榜首变动或跨月时重新计算',
      status: owned.has(b.id) ? (owned.get(b.id).equipped ? '已佩戴' : '已拥有') : '未拥有' }; });
    items.sort((a, b) => Number(b.owned) - Number(a.owned));
    const badges = (value.badges || []).map(b => items.find(item => item.id === b.id)).filter(Boolean), equipped = badges.filter(b => b.equipped);
    equipped.forEach((b, i) => { if (!Number.isInteger(b.slotIndex)) b.slotIndex = i; });
    const month = new Date((value.periodStart || Date.now()) + 8 * 3600000);
    return { ...value, badges, items, visibleBadges: items.filter(b => filter === 'owned' ? b.owned : filter === 'unowned' ? !b.owned : true),
      availableBadges: items.filter(b => b.owned && !b.equipped), equippedBadges: equipped,
      slots: Array.from({ length: MAX_EQUIPPED }, (_, i) => equipped.find(b => b.slotIndex === i) || { id: 'empty-' + i, empty: true, slotIndex: i }),
      ownedCount: badges.length, totalCount: items.length, unownedCount: items.length - badges.length,
      equippedCount: equipped.length, maxEquipped: MAX_EQUIPPED,
      monthLabel: month.getUTCFullYear() + '年' + String(month.getUTCMonth() + 1).padStart(2, '0') + '月' };
  }
  return { catalogue, rules, MAX_EQUIPPED, usesServerArt, badgeImageUrl, presentPlayerBadge, presentCollection, awardDefinition, monthlyAward };
});
