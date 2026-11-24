// Shared catalogue. Monthly ranks and permanent campaign grants are server-owned.
(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./fun-copy') : root.shadowtableFunCopy);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.shadowtableBadges = value;
})(typeof window === 'object' ? window : this, function (copy) {
  const rules = '月度徽章按北京时间每月重置。次数榜、连胜负榜随公开排名更新；个人达成徽章按本人有效记录计算。新增胜率榜按当月有效计分对局排名，金、银、铜框对应前三名。五连捷徽、十连胜者、百胜传奇跨月累计，达成后永久保留。每月1日结算上月公开积分月榜，前三名（含并列）获得永久徽章。活动纪念徽章获得后也永久保留。反馈首次被采纳可获得永久「共建者」徽章。';
  const standard = [
    { id: 'points', title: '积分王者', description: '本月积分榜第一。每一分，都是牌桌上的实力积累。', metric: 'points' },
    { id: 'games', title: '牌桌常青树', description: '本月场次榜第一。常驻牌桌，热爱从不缺席。', metric: 'games' },
    { id: 'overall', title: '常胜将军', description: '本月总胜率榜第一。以原始胜率排名，胜率相同时按有效局数排序，两者相同则并列。', metric: 'overall' },
  ];
  const funMonthly = Object.entries({ ...copy.honors, ...copy.roleRecords }).map(([id, honor]) => ({
    id, title: honor.title, metric: 'fun_' + id,
    description: '本月「' + honor.title + '」' + (copy.roleRecords[id] ? '达成' : '') + '次数榜第一。' + honor.description.replace(/。+$/, '') + '。',
  }));
  const funBadgeIds = new Set([
    'games', 'survival_revive', 'survival_knifed', 'honor_svp', 'percival_bust', 'merlin_hit',
    'assassin_miss', 'defense_enemy', 'kill_ally', 'servant_all_green', 'merlin_bust_exit',
    'percival_morgana_streak', 'servant_bench_three_green', 'reverse_wrong_side', 'mordred_bench_win',
    'morgana_no_rides', 'assassin_oberon_double', 'oberon_bench_win', 'lancelot_double_agent', 'lancelot_switch_win',
  ]);
  const monthly = standard.concat(funMonthly).map(badge => ({ ...badge, imageUrl: '/assets/badges/' + badge.id + '.png', rules,
    category: funBadgeIds.has(badge.id) ? '趣味徽章' : '荣誉徽章',
    flavor: badge.description.split('。').slice(1).join('。') }));
  const october = [
    { id: 'october_2026_crown', title: '加冕圣剑', rank: 1, condition: '2026年10月积分榜第1名。' },
    { id: 'october_2026_silver', title: '银盔骑士', rank: 2, condition: '2026年10月积分榜第2名。' },
    { id: 'october_2026_stag', title: '林间守望', rank: 3, condition: '2026年10月积分榜第3名。' },
    { id: 'october_2026_table', title: '共建圆桌', condition: '2026年10月至少参加一场对局。' },
    { id: 'october_2026_book', title: '内测纪念册', condition: '2026年10月至少参加一场计分对局。', largeImageUrl: '/assets/badges/october_2026_book-large.png' },
  ].map(b => ({ ...b, permanent: true, metric: 'campaign', periodLabel: '2026年10月', category: b.rank ? '荣誉徽章' : '趣味徽章',
    imageUrl: '/assets/badges/' + b.id + '.png', holdingRule: '获得后永久保留', rules: '2026年10月内测限定纪念。积分前三名按首次发布时的公开榜排名锁定，含并列；参与纪念按北京时间10月归档对局授予，获得后永久保留。', description: b.condition }));
  const contributor = {
    id: 'feedback_contributor', title: '共建者', permanent: true, metric: 'feedback', periodLabel: '永久',
    category: '趣味徽章', condition: '首次有一条反馈被采纳。', description: '首次有一条反馈被采纳。',
    flavor: '谢谢你留下这一笔，让下一桌玩得更好。', holdingRule: '获得后永久保留',
    rules: '管理员采纳反馈后发放，每位玩家只获得一次。',
    imageUrl: '/assets/badges/feedback_contributor.png', largeImageUrl: '/assets/badges/feedback_contributor-large.png',
  };
  const achievements = [
    ['win_streak', '长胜王徽', 'leader', '荣誉徽章', '当月最长连胜局数排名第一（至少两局）'],
    ['alternating_streak', '神鬼莫测', 'leader', '荣誉徽章', '当月胜负交替的最长连续局数排名第一（至少两局）'],
    ['loss_streak', '鬼神之勇', 'leader', '趣味徽章', '当月最长连败局数排名第一（至少两局）'],
    ['servant_trio', '三忠会审', 'leader', '荣誉徽章', '首轮任务车由三名忠臣完成，当月上车达成次数最多'],
    ['evil_trio', '三手遮天', 'leader', '荣誉徽章', '首轮任务车由三名红方完成，当月上车达成次数最多'],
    ['triple_sabotage', '炸翻天', 'leader', '荣誉徽章', '单车至少三张失败牌，本人实际出失败牌的达成局数为本月最多'],
    ['lake_blessed', '湖仙祝福', 'leader', '趣味徽章', '当月被湖中仙女查验次数最多'],
    ['lake_seer', '半步先知', 'leader', '趣味徽章', '当月作为湖中仙女，成功查验其他玩家次数最多'],
    ['success_courier', '成功使者', 'monthlyGoal', '趣味徽章', '当月累计打出 30 张任务成功牌'],
    ['sabotage_courier', '炸车使者', 'monthlyGoal', '趣味徽章', '当月累计打出 30 张任务失败牌'],
    ['role_collector', '角色收集者', 'monthlyGoal', '趣味徽章', '当月计分对局中，集齐七种基础角色各一次（梅林、派西维尔、忠臣、莫德雷德、莫甘娜、刺客、奥伯伦）'],
    ['seven_victors', '七星战神', 'monthlyGoal', '荣誉徽章', '当月计分对局中，用七种不同角色各胜至少一局'],
    ['attendance', '赛季全勤', 'monthlyGoal', '荣誉徽章', '当月参与至少 80% 的计分对局'],
    ['approve_success', '铁票忠臣', 'monthlyGoal', '荣誉徽章', '单局所有赞成票均投给最终成功任务'],
    ['reject_success', '反对大师', 'monthlyGoal', '荣誉徽章', '单局所有反对票均投给最终成功任务'],
    ['unanimous_allies', '一致对外', 'monthlyGoal', '荣誉徽章', '单局与同阵营全部队友投票一致至少两次'],
    ['faction_ballots', '稳稳很贴心', 'monthlyGoal', '荣誉徽章', '连续五次有效投票，均符合己方阵营立场。好人有红反对、全蓝赞成，坏人有红赞成、全蓝反对'],
    ['rate_overall', '胜徽巅峰三甲', 'podium', '荣誉徽章', '总胜率前三。当月至少参加 10 场有效计分对局'],
    ['rate_good', '圣光正义', 'podium', '荣誉徽章', '好人胜率前三。当月至少参加 10 场有效计分对局'],
    ['rate_evil', '暗影统治', 'podium', '荣誉徽章', '坏人胜率前三。当月至少参加 10 场有效计分对局'],
    ['rate_merlin', '烛照先知', 'podium', '荣誉徽章', '梅林胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_percival', '慧眼金睛', 'podium', '荣誉徽章', '派西维尔胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_mordred', '暗夜潜锋', 'podium', '荣誉徽章', '莫德雷德胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_morgana', '幻魅先知', 'podium', '荣誉徽章', '莫甘娜胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_assassin', '锋刃猎杀', 'podium', '荣誉徽章', '刺客胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_oberon', '孤星独行', 'podium', '荣誉徽章', '奥伯伦胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_servant', '浩然正气', 'podium', '荣誉徽章', '忠臣胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_reverse', '逆刃胜冠', 'podium', '荣誉徽章', '逆仆胜率前三。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['rate_lancelot', '双相胜章', 'podium', '荣誉徽章', '兰斯洛特胜率前三，蓝兰斯与红兰斯合并。当月至少参加 10 场有效计分对局，且至少抽到该角色 3 次'],
    ['five_wins', '五连捷徽', 'milestone', '荣誉徽章', '连续五局获胜'],
    ['ten_wins', '十连胜者', 'milestone', '荣誉徽章', '连续十局获胜'],
    ['hundred_wins', '百胜传奇', 'milestone', '荣誉徽章', '累计获得一百局胜利'],
  ].map(([id, title, metric, category, condition]) => {
    const permanent = metric === 'milestone';
    return { id, title, metric, category, condition, description: condition, permanent, achievement: true,
      imageUrl: '/assets/badges/' + id + '.png', periodLabel: permanent ? '永久' : '',
      holdingRule: permanent ? '获得后永久保留' : metric === 'monthlyGoal' ? '按本月有效记录计算，次月重置' : '随本月排名更新，次月重置' };
  });
  const seasonal = achievements.filter(b => !b.permanent);
  const permanent = october.concat(contributor, achievements.filter(b => b.permanent));
  const catalogue = monthly.concat(seasonal, permanent);
  // The server also uses catalogue order to choose default equipped badges.
  const funByRole = monthly.slice(standard.length).sort((a, b) => copy.compareDisplayIds(a.id, b.id));
  const collectionCatalogue = monthly.slice(0, standard.length).concat(funByRole, seasonal, permanent);
  const placementTitles = ['交剑王冠', '持枪骑士', '铜铸城钥'];
  function monthlyAward(id) {
    const match = /^monthly_points_(\d{4}-(?:0[1-9]|1[0-2]))_([1-3])$/.exec(id);
    if (!match) return null;
    const [, month, place] = match;
    const rank = Number(place), periodLabel = month.replace('-', '年') + '月';
    const condition = periodLabel + '积分月榜第' + rank + '名';
    return { id, month, rank, periodLabel, title: placementTitles[rank - 1], condition,
      description: condition, category: '荣誉徽章', metric: 'monthly_points', permanent: true,
      imageUrl: '/assets/badges/monthly-points/' + month + '/' + rank + '.png',
      holdingRule: '获得后永久保留', rules: '每月1日按北京时间结算上月公开积分月榜。前三名（含并列）获得对应名次的永久徽章。' };
  }
  const awardDefinition = id => monthlyAward(id) || permanent.find(b => b.id === id);
  const MAX_EQUIPPED = 3;
  const usesServerArt = badge => !!(badge.achievement || badge.permanent || ['good_shield', 'honor_svp'].includes(badge.id) || Object.hasOwn(copy.roleRecords, badge.id));
  const badgeImageUrl = (badge, assetUrl) => usesServerArt(badge) ? assetUrl(badge.imageUrl) : badge.imageUrl;
  // The quill fills its canvas. Match the painted area of the other permanent badges.
  function badgeArtStyle(badge, awardPopup = false) {
    const frameScale = badge.permanent && !awardPopup ? 1.14 : 1;
    const scale = frameScale * (badge.id === contributor.id ? 0.8 : 1);
    return scale === 1 ? '' : 'transform:scale(' + Number(scale.toFixed(3)) + ')';
  }
  function rankedBadge(definition, rank) {
    if (definition.metric !== 'podium' || ![1,2,3].includes(rank)) return definition;
    return { ...definition, rank, imageUrl: definition.imageUrl.replace('.png', ['', '-silver', '-bronze'][rank - 1] + '.png') };
  }
  function presentPlayerBadge(badge, assetUrl = path => path) {
    const base = catalogue.find(item => item.id === badge.id) || monthlyAward(badge.id);
    const definition = base && rankedBadge(base, badge.rank);
    if (!definition) return null;
    return { ...badge, ...definition, artStyle: badgeArtStyle(definition), imageUrl: badgeImageUrl(definition, assetUrl) };
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
  const categories = ['全部分类', '荣誉徽章', '趣味徽章'];
  function presentCollection(value, filter = 'all', assetUrl = path => path, category = categories[0]) {
    const owned = new Map((value.badges || []).map(b => [b.id, b]));
    const placements = Array.from(owned.keys(), monthlyAward).filter(Boolean);
    const items = placements.concat(collectionCatalogue).map(base => {
      const b = rankedBadge(base, owned.get(base.id)?.rank);
      const roleRecord = copy.roleRecords[b.id];
      const condition = (b.condition || (!roleRecord && copy.labels[b.id] ? '本月' + copy.labels[b.id] + '次数第一' : b.description.split('。')[0])).replace(/。+$/, '');
      return { ...b, artStyle: badgeArtStyle(b), imageUrl: badgeImageUrl(b, assetUrl), owned: owned.has(b.id), equipped: !!owned.get(b.id)?.equipped, slotIndex: owned.get(b.id)?.slotIndex,
      condition, detailCondition: b.permanent || b.metric === 'monthlyGoal' ? condition : condition + '（含并列）', detailNote: roleRecord?.description || detailNotes[b.id] || (b.metric === 'podium' ? (b.rank ? '当前第' + b.rank + '名。' : '') + '金、银、铜边框对应前三名。胜率相同时按样本局数排序，两者相同则并列。' : '') || '', kindLabel: b.permanent ? '永久' : b.metric === 'monthlyGoal' ? '月度' : '月榜',
      periodLabel: b.periodLabel || value.monthLabel || '', holdingRule: b.holdingRule || '榜首变动或跨月时重新计算',
      status: owned.has(b.id) ? (owned.get(b.id).equipped ? '已佩戴' : '已拥有') : '未拥有' }; });
    items.sort((a, b) => Number(b.owned) - Number(a.owned));
    const badges = (value.badges || []).map(b => items.find(item => item.id === b.id)).filter(Boolean), equipped = badges.filter(b => b.equipped);
    equipped.forEach((b, i) => { if (!Number.isInteger(b.slotIndex)) b.slotIndex = i; });
    const month = new Date((value.periodStart || Date.now()) + 8 * 3600000);
    const categoryItems = category === categories[0] ? items : items.filter(b => b.category === category);
    const ownedInCategory = categoryItems.filter(b => b.owned).length;
    const ownershipFilters = [
      { id: 'all', title: '全部', count: categoryItems.length },
      { id: 'owned', title: '已拥有', count: ownedInCategory },
      { id: 'unowned', title: '未拥有', count: categoryItems.length - ownedInCategory },
    ];
    const emptyMessage = filter === 'owned' ? '暂无已拥有的徽章，点开徽章可查看获取条件。'
      : category === categories[0] ? '已拥有全部徽章。' : '已拥有此分类全部徽章。';
    return { ...value, badges, items, category, categories, ownershipFilters, emptyMessage,
      visibleBadges: categoryItems.filter(b => filter === 'owned' ? b.owned : filter === 'unowned' ? !b.owned : true),
      availableBadges: items.filter(b => b.owned && !b.equipped), equippedBadges: equipped,
      slots: Array.from({ length: MAX_EQUIPPED }, (_, i) => equipped.find(b => b.slotIndex === i) || { id: 'empty-' + i, empty: true, slotIndex: i }),
      ownedCount: badges.length, totalCount: items.length, unownedCount: items.length - badges.length,
      equippedCount: equipped.length, maxEquipped: MAX_EQUIPPED,
      monthLabel: month.getUTCFullYear() + '年' + String(month.getUTCMonth() + 1).padStart(2, '0') + '月' };
  }
  return { catalogue, categories, rules, MAX_EQUIPPED, usesServerArt, rankedBadge, badgeImageUrl, badgeArtStyle, presentPlayerBadge, presentCollection, awardDefinition, monthlyAward };
});
