(function (root, factory) {
  const value = factory(typeof module === "object" && module.exports ? require("./poster-canvas") : root.shadowtablePosterCanvas);
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableLeaderboardCard = value;
})(typeof window === "object" ? window : this, function (canvas) {
  const { WIDTH, HEIGHT, LEFT, RIGHT, colors, width, wrap, painter, BACKGROUND_PATH } = canvas;
  const date = time => { const d = new Date(time + 28800000), pad = n => String(n).padStart(2, "0"); return d.getUTCFullYear() + "." + pad(d.getUTCMonth() + 1) + "." + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); };
  function lane(row, self = false) {
    const wide = width(row.value, self ? 53 : 37) > 160;
    const name = wrap(row.name, self ? 39 : 33, wide ? 624 : self ? 428 : 488);
    const rank = wrap("第 " + row.rank + " 名", self ? 30 : 27, 160);
    const height = Math.max(self ? 150 : 106, Math.max(name.length * (self ? 56 : 48) + (self ? 37 : 0), rank.length * 41 + 34) + 36) + (wide ? 62 : 0);
    return { row, self, wide, name, rank, height };
  }
  function layout(card) {
    const context = wrap([card.context, card.scope].filter(Boolean).join(" · "), 26, 936);
    const title = wrap(card.title === "积分榜" ? "我的积分榜" : card.title, 64, 936);
    const name = wrap(card.name, 36, 840), titleTop = 145 + context.length * 40 + 12;
    const identityTop = titleTop + title.length * 90 + 24;
    const heroTop = identityTop + Math.max(74, name.length * 52 + 38) + 36;
    const wideHero = width(card.hero, 136) > 520;
    const heroSize = wideHero ? width(card.hero, 96) > 848 ? 72 : 96 : 136;
    const heroLines = wrap(card.hero, heroSize, wideHero ? 848 : 520);
    const heroLabel = wrap(card.label, 28, wideHero ? 848 : 520);
    const heroRank = wrap(card.rank ? "第 " + card.rank + " 名" : card.rankLabel, 42, 218);
    const heroHeight = Math.max(270, 34 + heroLabel.length * 42 + 10 + heroLines.length * heroSize * 1.2 + (wideHero ? 72 : 24), 80 + heroRank.length * 56 + 88);
    const rows = card.nearby || [], self = rows.find(row => row.isSelf);
    const before = self ? rows.filter(row => !row.isSelf && row.rank < self.rank).map(row => lane(row)) : [];
    const after = self ? rows.filter(row => !row.isSelf && row.rank > self.rank).map(row => lane(row)) : [];
    const tied = self ? rows.filter(row => !row.isSelf && row.rank === self.rank) : [];
    const columns = tied.every(row => width(row.name, 29) <= 204 && width(row.value, 29) <= 86 - width(card.unit, 23) - 10) ? 2 : 1;
    const peers = tied.map(row => {
      const wide = width(row.value, 29) > 86 - width(card.unit, 23) - 10;
      return { row, wide, lines: wrap(row.name, 29, columns === 2 ? 204 : wide ? 680 : 584) };
    });
    const peerGroups = [];
    for (let i = 0; i < peers.length; i += columns) {
      const group = peers.slice(i, i + columns);
      peerGroups.push({ peers: group, height: Math.max(71, ...group.map(peer => peer.lines.length * 43 + 18 + (peer.wide ? 52 : 0))) });
    }
    const ownLane = self ? lane(self, true) : null;
    const showNeighborhood = rows.length > 1 && !!self;
    const neighborhoodHeight = showNeighborhood ? 76 + (card.gap ? 56 : 0) + before.reduce((n, row) => n + row.height, 0) + ownLane.height + 26 + (peers.length ? 57 + peerGroups.reduce((n, g) => n + g.height, 0) + 20 : 0) + after.reduce((n, row) => n + row.height, 0) : 0;
    const metrics = card.metrics.map(item => ({ ...item, lines: wrap(item.label, 25, 280) }));
    const metricsHeight = card.performance ? 212 : 42 + Math.max(1, ...metrics.map(m => m.lines.length)) * 38 + 70;
    const notes = card.notes.flatMap(note => wrap(note, 25, 936));
    const neighborhoodTop = heroTop + heroHeight + 28, metricsTop = neighborhoodTop + neighborhoodHeight + (showNeighborhood ? 32 : 12);
    const notesTop = metricsTop + metricsHeight + 22;
    return { context, title, titleTop, name, identityTop, heroTop, wideHero, heroSize, heroLines, heroLabel, heroRank, heroHeight,
      before, after, ownLane, columns, peerGroups, showNeighborhood, neighborhoodTop, neighborhoodHeight, metrics, metricsTop, metricsHeight, notes, notesTop,
      height: Math.ceil(Math.max(HEIGHT, notesTop + notes.length * 38 + 180)) };
  }
  const dimensions = card => ({ width: WIDTH, height: layout(card).height });
  const imagePaths = card => [...new Set([BACKGROUND_PATH, card.avatar, ...(card.nearby || []).map(row => row.avatar)].filter(Boolean))];
  function drawCard(ctx, card, images = new Map()) {
    const box = layout(card), p = painter(ctx), unitWidth = width(card.unit, 23);
    const value = (row, x, y, size, limit = 160, color = colors.text) => {
      p.text(row.value, x - unitWidth - 10, y, size, color, limit - unitWidth - 10, "right", 500);
      p.text(card.unit, x, y + size * .4, 23, colors.muted, unitWidth + 2, "right");
    };
    p.background(box.height, images, true); p.brand("LEADERBOARD");
    p.lines(box.context, LEFT, 145, 26, colors.gold, 936, 40);
    p.lines(box.title, LEFT, box.titleTop, 64, colors.text, 936, 90, 600);
    p.avatar(card, LEFT, box.identityTop, 72, images);
    p.lines(box.name, LEFT + 92, box.identityTop, 36, colors.text, 840, 52, 550);
    p.text(card.label, LEFT + 92, box.identityTop + box.name.length * 52 + 3, 24, colors.muted, 840);
    p.round(LEFT, box.heroTop, 936, box.heroHeight, 28);
    p.lines(box.heroLabel, LEFT + 34, box.heroTop + 34, 28, colors.muted, box.wideHero ? 848 : 520, 42);
    const valueY = box.heroTop + 34 + box.heroLabel.length * 42 + 10;
    p.lines(box.heroLines, LEFT + 34, valueY, box.heroSize, colors.gold, box.wideHero ? 848 : 520, box.heroSize * 1.2, 550);
    if (box.wideHero) {
      p.text(card.unit, RIGHT - 34, valueY + box.heroLines.length * box.heroSize * 1.2 - 45, 32, colors.gold, 120, "right");
      p.text((card.rank ? "我的排名 · 第 " + card.rank + " 名" : "排名状态 · " + card.rankLabel), LEFT + 34, box.heroTop + box.heroHeight - 55, 30, colors.muted, 848);
    } else {
      p.text(card.unit, LEFT + 34 + width(box.heroLines[box.heroLines.length - 1], box.heroSize) + 12, valueY + box.heroSize * .65, 34, colors.gold, 90);
      p.icon("medal", RIGHT - 146, box.heroTop + 28, 33);
      p.text(card.rank ? "我的排名" : "排名状态", RIGHT - 126, box.heroTop + 75, 24, colors.muted, 220, "center");
      p.lines(box.heroRank, RIGHT - 126, box.heroTop + 118, 42, card.rank ? colors.text : colors.muted, 218, 56, 500, "center");
      if ((card.nearby || []).some(row => !row.isSelf && row.rank === card.rank)) p.text("并列", RIGHT - 126, box.heroTop + 118 + box.heroRank.length * 56 + 7, 20, colors.gold, 120, "center");
    }
    function drawLane(entry, top, label) {
      const { row, self, name, rank, height, wide } = entry;
      const nameX = self ? LEFT + 288 : LEFT + 262;
      if (self) { p.round(LEFT, top, 936, height, 20, "rgba(229,198,139,.09)"); p.round(LEFT, top + 30, 4, height - 60, 2, colors.gold); }
      const y = top + (self ? 25 : 18), rankX = LEFT + (self ? 24 : 8);
      p.text(label, rankX, y, 22, colors.muted, 160);
      p.lines(rank, rankX, y + 34, self ? 30 : 27, self ? colors.gold : colors.text, 160, 41, 400);
      p.avatar(row, self ? LEFT + 192 : LEFT + 180, y + (self ? 6 : 0), self ? 72 : 58, images, self);
      p.lines(name, nameX, y + (self ? 0 : 4), self ? 39 : 33, self ? colors.gold : colors.text, wide ? 624 : self ? 428 : 488, self ? 56 : 48, 550);
      if (self) p.text("我 · " + card.label, nameX, y + name.length * 56 + 3, 23, colors.muted, 428);
      value(row, RIGHT - (self ? 28 : 8), wide ? top + height - 58 : y + (self ? 21 : 7), self ? 53 : 37, wide ? 820 : 160, self ? colors.gold : colors.text);
    }
    if (box.showNeighborhood) {
      let top = box.neighborhoodTop;
      p.text("与我相邻", LEFT, top, 32, colors.text, 600, "left", 600);
      p.text((card.period === "day" ? "今日" : card.period === "month" ? "本月" : "") + card.nearbyLabel, RIGHT, top + 5, 23, colors.muted, 260, "right");
      top += 76;
      if (card.gap) { p.line(LEFT + 4, top + 17, LEFT + 36, "rgba(229,198,139,.5)"); p.text(card.gap, LEFT + 48, top, 25, colors.gold, 840); top += 56; }
      box.before.forEach((entry, index) => { drawLane(entry, top, index === box.before.length - 1 ? "上一名次" : "相邻名次"); top += entry.height; });
      top += 10; drawLane(box.ownLane, top, "当前名次"); top += box.ownLane.height + 16;
      if (box.peerGroups.length) {
        const x = LEFT + 178;
        p.text("同为第 " + card.rank + " 名", x, top, 22, colors.muted, 550);
        p.text("同分并列", RIGHT - 14, top + 2, 20, colors.muted, 220, "right"); top += 57;
        box.peerGroups.forEach(group => {
          group.peers.forEach((peer, i) => {
            const peerX = x + i * 394, peerRight = box.columns === 1 ? RIGHT - 14 : peerX + 364;
            p.avatar(peer.row, peerX, top + 7, 48, images);
            p.lines(peer.lines, peerX + 61, top + 7, 29, colors.text, box.columns === 1 ? peer.wide ? 680 : 584 : 204, 43, 550);
            value(peer.row, peerRight, peer.wide ? top + 13 + peer.lines.length * 43 : top + 13, 29, peer.wide ? 700 : 86);
          }); top += group.height;
        });
        top += 20; p.line(LEFT, top - 8, RIGHT);
      }
      box.after.forEach((entry, index) => { drawLane(entry, top, index === 0 ? "下一名次" : "相邻名次"); top += entry.height; });
    }
    p.line(LEFT, box.metricsTop, RIGHT);
    if (card.performance) {
      const top = box.metricsTop + 27, performance = card.performance;
      p.text(card.period === "day" ? "今日计分表现" : card.period === "month" ? "本月计分表现" : "计分表现", LEFT + 5, top, 28, colors.muted);
      p.text(performance.wins + " 胜 / " + performance.losses + " 负", LEFT + 5, top + 62, 45, colors.good, 610, "left", 500);
      p.text("共 " + performance.total + " 场计分对局", LEFT + 5, top + 130, 25, colors.muted, 610);
      p.text(performance.rate, RIGHT - 5, top + 55, 58, colors.gold, 310, "right", 500);
      p.text("计分局胜率", RIGHT - 5, top + 130, 25, colors.muted, 310, "right");
    } else box.metrics.forEach((metric, index) => {
      const x = LEFT + index * 320;
      p.text(metric.value, x, box.metricsTop + 29, 51, colors.text, 280, "left", 550);
      p.lines(metric.lines, x, box.metricsTop + 104, 25, colors.muted, 280, 38);
    });
    p.lines(box.notes, LEFT, box.notesTop, 25, colors.muted, 936, 38);
    p.footer(box.height, "个人榜单" + (card.context ? " · " + card.context : ""), date(card.asOf));
  }
  return { dimensions, drawCard, imagePaths, layout };
});
