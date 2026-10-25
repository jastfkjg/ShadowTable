(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./avoidance'));
  else root.shadowtableBadgeAwards = factory(root.shadowtableAvoidance);
})(typeof window === 'object' ? window : this, function (notices) {
  function present(notice) {
    const badges = (notice?.badges || []).map(b => ({ ...b,
      displayReason: b.rank ? '10月积分榜 · 第' + b.rank + '名' : b.briefCondition || b.condition,
    }));
    const ranked = badges.find(b => b.rank), hero = ranked || (badges.length === 1 ? badges[0] : null);
    return { badges, count: badges.length, hero, ranked: !!ranked,
      secondary: ranked ? badges.filter(b => b.id !== ranked.id) : hero ? [] : badges,
      title: ranked ? '十月荣誉已送达' : '感谢你，与我们同席',
      message: ranked ? '' : badges.length > 1 ? '你的名字，留在了十月的故事里。' : '这个十月，因为相聚而值得纪念。',
    };
  }
  function createNotifier(options) {
    return notices.createGrantNotifier({ ...options, present });
  }
  function markup(value, esc, detail = null) {
    const image = b => '<img src="' + esc(b.imageUrl) + '" alt="" />';
    const item = b => '<article class="award-small"><button type="button" data-award-detail="' + esc(b.id) + '" aria-label="查看' + esc(b.title) + '详情"><span class="award-small-art">' + image(b) + '</span><span class="award-name">' + esc(b.title) + '</span></button><p class="award-reason">' + esc(b.displayReason) + '</p></article>';
    if (detail) return '<section class="award-popup award-detail" role="dialog" aria-modal="true" aria-label="' + esc(detail.title) + '详情"><button type="button" class="award-close" data-award-back aria-label="返回发放弹窗">×</button><div class="award-scroll"><p class="award-eyebrow">2026年10月 · ' + esc(detail.category) + '</p><div class="award-large-art"><img src="' + esc(detail.largeImageUrl || detail.imageUrl) + '" alt="' + esc(detail.title) + '" /></div><h2 class="award-title">' + esc(detail.title) + '</h2><p class="award-reason">' + esc(detail.condition) + '</p><p class="award-message">' + esc(detail.flavor) + '</p><p class="award-hint">获得后永久保留</p></div><footer class="award-actions"><button type="button" class="award-confirm" data-award-back>返回</button></footer></section>';
    return '<section class="award-popup ' + (value.ranked ? 'award-ranked' : value.hero ? 'award-single' : 'award-dual') + '" role="dialog" aria-modal="true" aria-label="' + esc(value.title) + '"><button type="button" class="award-close" data-award-confirm aria-label="关闭发放弹窗">×</button><div class="award-scroll"><p class="award-eyebrow">2026年10月 · 内测纪念</p><h2 class="award-title">' + esc(value.title) + '</h2><p class="award-count">你获得了 <strong>' + value.count + '</strong> 枚限定徽章</p>' + (value.hero ? '<div class="award-hero"><button type="button" class="award-hero-art" data-award-detail="' + esc(value.hero.id) + '" aria-label="查看' + esc(value.hero.title) + '详情">' + image(value.hero) + '</button><h3 class="award-hero-name">' + esc(value.hero.title) + '</h3><p class="award-reason ' + (value.ranked ? 'award-rank' : '') + '">' + esc(value.hero.displayReason) + '</p></div>' : '') + (value.secondary.length ? '<div class="award-secondary">' + value.secondary.map(item).join('') + '</div>' : '') + (value.message ? '<p class="award-message">' + esc(value.message) + '</p>' : '') + '<p class="award-hint">可在「荣誉徽章」中查看与佩戴</p></div><footer class="award-actions"><button type="button" class="award-confirm" data-award-confirm>收下徽章</button><button type="button" class="award-view" data-award-collection>查看荣誉徽章 ›</button></footer></section>';
  }
  return { present, createNotifier, markup };
});
