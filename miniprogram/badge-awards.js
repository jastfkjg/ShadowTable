(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./avoidance'), require('./badges'));
  else root.shadowtableBadgeAwards = factory(root.shadowtableAvoidance, root.shadowtableBadges);
})(typeof window === 'object' ? window : this, function (notices, catalogue) {
  function present(notice) {
    const badges = (notice?.badges || []).map(b => ({ ...b,
      displayReason: b.condition, artStyle: catalogue.badgeArtStyle(b, true),
    }));
    const contributor = badges.find(b => b.id === 'feedback_contributor');
    if (contributor) {
      const single = badges.length === 1;
      return { badges, count: badges.length, hero: contributor, ranked: false, secondary: badges.filter(b => b !== contributor),
        eyebrow: single ? '社区贡献 · 永久荣誉' : '永久荣誉',
        title: single ? '你的反馈被采纳了' : '新的荣誉已送达',
        message: contributor.flavor };
    }
    const monthly = badges.find(b => b.month);
    const ranked = monthly || badges.find(b => b.rank), hero = ranked || (badges.length === 1 ? badges[0] : null);
    const eyebrow = monthly
      ? (badges.every(b => b.month === monthly.month) ? monthly.periodLabel + ' · 积分月榜' : '积分月榜 · 荣誉徽章')
      : '2026年10月 · 内测纪念';
    return { badges, count: badges.length, hero, ranked: !!ranked,
      secondary: ranked ? badges.filter(b => b.id !== ranked.id) : hero ? [] : badges,
      eyebrow, title: monthly ? '月榜荣誉已送达' : ranked ? '十月荣誉已送达' : '感谢你，与我们同席',
      message: ranked ? '' : badges.length > 1 ? '你的名字，留在了十月的故事里。' : '这个十月，因为相聚而值得纪念。',
    };
  }
  function createNotifier(options) {
    return notices.createGrantNotifier({ ...options, present });
  }
  return { present, createNotifier };
});
