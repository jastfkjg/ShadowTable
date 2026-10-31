(function (root, factory) {
  const value = factory(
    typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport,
    typeof module === "object" && module.exports ? require("./poster-canvas") : root.shadowtablePosterCanvas,
  );
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation, canvas) {
  const { WIDTH, colors, clean, width, wrap, painter, BACKGROUND_PATH } = canvas;
  const LEFT = 48, RIGHT = WIDTH - LEFT, INSET = 36, NAME_X = LEFT + 246;
  const HERO_HEIGHT = 684, GAP = 39, GROUP_HEADER = 144, FOOTER_HEIGHT = 396;
  const roleArt = metric => {
    const role = /^merlin_/.test(metric) ? "merlin" : /^percival_/.test(metric) ? "percival" : /^assassin_/.test(metric) ? "assassin" : "";
    return role ? "/assets/roles/" + role + ".png" : "";
  };
  const rowProjection = row => ({ rank: row.rank, tied: row.tied, name: clean(row.nickname) || "新朋友",
    avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(row.avatarUrl || "") ? row.avatarUrl : "",
    value: clean(row.value), secondary: clean(row.secondaryLabel), rate: row.rate, opportunities: row.opportunities });
  function rowLayout(row, section) {
    const honor = section.type === "honor", valueWidth = width(row.value, 81) + width(section.unit, 30) + 9;
    const wide = valueWidth > 252, nameSize = 46, nameStep = 65;
    const available = RIGHT - INSET - NAME_X;
    const nameWidth = available - (wide ? 0 : Math.max(132, valueWidth) + 24) - (row.tied ? 84 : 0);
    const nameLines = wrap(row.name, nameSize, nameWidth);
    const metadata = honor && Number.isFinite(row.rate) && Number.isFinite(row.opportunities)
      ? (section.rateLabel || "成功率") + " " + row.rate + "% · " + row.opportunities + " 次机会" : row.secondary;
    const secondary = wrap(metadata, 30, available - (wide ? 0 : Math.max(132, valueWidth) + 24));
    const nameHeight = nameLines.length * nameStep, metadataTop = 30 + nameHeight + 12;
    const dataBottom = metadataTop + secondary.length * 45;
    const height = Math.max(honor ? 198 : 183, dataBottom + (wide ? 123 : 30));
    return { wide, nameSize, nameStep, nameWidth, nameLines, secondary, nameHeight, metadataTop,
      secondaryWidth: available - (wide ? 0 : Math.max(132, valueWidth) + 24),
      valueTop: wide ? dataBottom + 18 : (height - 81) / 2, height };
  }
  function sectionLayout(section) {
    const title = wrap(section.title, 45, 660), subtitle = wrap(section.subtitle, 30, 786);
    const header = Math.max(174, 27 + title.length * 65 + 9 + subtitle.length * 45 + 27);
    const rows = section.rows.map(row => rowLayout(row, section));
    return { title, subtitle, header, rows, height: header + rows.reduce((sum, row) => sum + row.height, 0) };
  }
  function cards(response) {
    const report = presentation.presentReport(response);
    if (!report.canShare) throw new Error("这个月还没有有效对局，暂时无法生成月报图片。");
    const main = [...report.coreBoards, ...report.extraBoards].map(board => ({ type: "board", id: board.id, title: board.title, subtitle: board.subtitle, unit: board.unit, rows: board.rows.map(rowProjection) }));
    const groups = [false, true].map(entertainment => {
      const sections = presentation.detailBoards(report, "count", entertainment).map(board => ({ type: "honor", id: board.metric, title: board.title,
        subtitle: [board.roleLabel, board.label].filter(Boolean).join(" · "), unit: board.unit, portrait: roleArt(board.metric),
        rateLabel: board.rateLabel, groupTitle: entertainment ? "本月娱乐榜" : "本月趣味荣誉", rows: board.rows.map(rowProjection) }));
      if (sections.length) sections[0].showGroupTitle = true;
      return sections;
    });
    const metadata = { kind: "monthly", title: "月度战报", month: report.monthTitle,
      range: report.rangeLabel, asOf: report.asOfLabel, status: report.status === "preview" ? "实时更新" : "", overview: { games: report.overview.games, players: report.overview.players } };
    // Keep the existing array interface for both clients; one report is one image.
    return [{ ...metadata, sections: [...main, ...groups.flat()] }];
  }
  function layout(card) {
    const mainGroupTop = card.sections.some(section => section.type === "board") ? HERO_HEIGHT : null;
    let chapter = mainGroupTop === null ? 0 : 1;
    let cursor = HERO_HEIGHT + (mainGroupTop === null ? 0 : GROUP_HEADER);
    const sections = card.sections.map((section, index) => {
      if (index) cursor += GAP;
      const groupTop = section.showGroupTitle ? cursor : null;
      const groupNumber = section.showGroupTitle ? ++chapter : null;
      if (section.showGroupTitle) cursor += GROUP_HEADER;
      const box = sectionLayout(section), top = cursor;
      cursor += box.height;
      return { section, box, top, groupTop, groupNumber };
    });
    const footerTop = cursor + GAP;
    return { sections, mainGroupTop, footerTop, width: WIDTH, height: Math.ceil(footerTop + FOOTER_HEIGHT) };
  }
  const dimensions = card => { const { width, height } = layout(card); return { width, height }; };
  function renderDimensions(card) {
    const logical = dimensions(card);
    // Bound the backing bitmap while keeping all sections in one proportional image.
    const scale = Math.min(1, 8192 / logical.height);
    return { width: Math.ceil(logical.width * scale), height: Math.ceil(logical.height * scale), scale };
  }
  function imagePaths(card) {
    return [...new Set([BACKGROUND_PATH, ...card.sections.flatMap(section => [section.portrait, ...section.rows.map(row => row.avatar)])].filter(Boolean))];
  }
  function describe(card) {
    return [card.month + " " + card.title, "完整长图", ...card.sections.flatMap(section =>
      [section.title, ...section.rows.map(row => (row.tied ? "并列" : "") + "第" + row.rank + "名 " + row.name + " " + row.value + section.unit)])].join("，");
  }
  function drawCard(ctx, card, images = new Map()) {
    const poster = layout(card), { height } = poster, p = painter(ctx);
    const boardIcon = id => id === "points" ? "crown" : id === "games" ? "swords" : /shield|defense_|good/.test(id) ? "shield" : /assassin/.test(id) ? "moon" : "spark";
    const gradient = (x, y, x2, y2, stops) => {
      const value = ctx.createLinearGradient?.(x, y, x2, y2);
      if (!value?.addColorStop) return stops[stops.length - 1][1];
      stops.forEach(([at, color]) => value.addColorStop(at, color)); return value;
    };
    const drawRank = (row, x, y) => {
      const color = row.rank === 1 ? colors.gold : row.rank === 2 ? "#c7d7e3" : "#ddbcaa";
      ctx.save(); ctx.translate(x, y + 7); ctx.scale(69 / 40, 69 / 40);
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1;
      for (const [cx, cy, angle] of [[6,8,-34],[4,15,-22],[5,22,-38],[9,28,-48],[34,8,34],[36,15,22],[35,22,38],[31,28,48]]) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle * Math.PI / 180); ctx.beginPath();
        ctx.moveTo(0,-4.1); ctx.quadraticCurveTo(2.1,-4.1,2.1,0); ctx.quadraticCurveTo(2.1,4.1,0,4.1);
        ctx.quadraticCurveTo(-2.1,4.1,-2.1,0); ctx.quadraticCurveTo(-2.1,-4.1,0,-4.1);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); ctx.moveTo(7,7); ctx.bezierCurveTo(-2,23,9,33,16,35);
      ctx.moveTo(33,7); ctx.bezierCurveTo(42,23,31,33,24,35); ctx.stroke(); ctx.restore();
      p.text(String(row.rank).padStart(2, "0"), x + 34.5, y + 26, 25, color, 46, "center");
    };
    const drawChapter = (top, number, title, meta) => {
      p.text(number, LEFT + 6, top + 51, 27, colors.gold, 54);
      p.text(title, LEFT + 84, top + 45, 39, colors.text, 510, "left", 600);
      p.text(meta, RIGHT - 6, top + 54, 27, colors.muted, 330, "right");
    };
    const art = images.get(BACKGROUND_PATH);
    p.rect(0, 0, WIDTH, height, colors.bg);
    if (art?.width && art?.height) {
      ctx.drawImage(art, 0, 0, art.width, Math.min(art.height, art.width * HERO_HEIGHT / WIDTH), 0, 0, WIDTH, HERO_HEIGHT);
      p.rect(0, 0, WIDTH, HERO_HEIGHT, gradient(0,0,WIDTH,0,[[0,colors.bg],[.44,"rgba(16,28,36,.38)"],[1,"rgba(16,28,36,0)"]]));
      p.rect(0, 0, WIDTH, HERO_HEIGHT, gradient(0,0,0,HERO_HEIGHT,[[0,"rgba(16,28,36,0)"],[.44,"rgba(16,28,36,0)"],[1,colors.bg]]));
      const crop = Math.min(art.height, art.width * FOOTER_HEIGHT / WIDTH);
      ctx.drawImage(art, 0, art.height - crop, art.width, crop, 0, poster.footerTop, WIDTH, FOOTER_HEIGHT);
      p.rect(0, poster.footerTop, WIDTH, FOOTER_HEIGHT, gradient(0,poster.footerTop,0,height,[[0,colors.bg],[.2,colors.bg],[1,"rgba(16,28,36,.18)"]]));
    }
    p.text("桌边助手", 60, 54, 33, colors.text, 165, "left", 600);
    p.text("SHADOWTABLE", 234, 65, 20, colors.muted, 260);
    p.text(card.month.replace(".", " 年 ") + " 月", 60, 165, 33, colors.gold);
    p.text("月度战报", 60, 230, 102, colors.text, 700, "left", 600, true);
    p.text(card.range.slice(5).replace(/—20\d{2}\./, " — ") + (card.status ? " · " + card.status : ""), 60, 393, 30, colors.muted, 900);
    p.line(60, 507, WIDTH - 60, "rgba(229,198,139,.36)");
    [[card.overview.games, "有效对局"], [card.overview.players, "参赛玩家"]].forEach(([value, label], index) => {
      const x = 60 + index * 540, size = Math.min(84, 210 / Math.max(1, width(value, 1)));
      p.text(value, x, 539, size, colors.text, 210, "left", 600);
      p.text(label, x + width(value, size) + 24, 573, 30, colors.muted, 180);
    });
    p.rect(540, 558, 1, 66, colors.line);
    p.line(60, HERO_HEIGHT, WIDTH - 60);
    if (poster.mainGroupTop !== null) drawChapter(poster.mainGroupTop, "01", "综合榜单", "本月战绩");
    for (const { section, box, top: cursor, groupTop, groupNumber } of poster.sections) {
      if (groupTop !== null) drawChapter(groupTop, String(groupNumber).padStart(2, "0"), section.groupTitle.replace(/^本月/, ""), "按次数 · 保留并列");
      const honor = section.type === "honor", right = RIGHT - INSET, titleX = LEFT + 126;
      p.round(LEFT, cursor, RIGHT - LEFT, box.height, 45);
      if (honor && images.get(section.portrait)) ctx.drawImage(images.get(section.portrait), LEFT + 27, cursor + 36, 81, 102);
      else p.icon(boardIcon(section.id), LEFT + INSET, cursor + 55, 63);
      p.lines(box.title, titleX, cursor + 27, 45, honor ? colors.gold : colors.text, 660, 65, 600);
      p.lines(box.subtitle, titleX, cursor + 27 + box.title.length * 65 + 9, 30, colors.muted, 786, 45);
      p.text("前三名次", right, cursor + 75, 24, colors.muted, 108, "right");
      let rowTop = cursor + box.header;
      section.rows.forEach((row, index) => {
        const r = box.rows[index], x = LEFT + INSET, avatarTop = r.wide || r.nameLines.length > 1 ? 30 : (r.height - 93) / 2;
        p.line(x, rowTop, right);
        drawRank(row, x, rowTop + avatarTop + 4.5);
        p.avatar(row, x + 93, rowTop + avatarTop, 93, images);
        p.lines(r.nameLines, NAME_X, rowTop + 30, r.nameSize, colors.text, r.nameWidth, r.nameStep, 600);
        if (row.tied) {
          const last = r.nameLines[r.nameLines.length - 1], badgeX = NAME_X + width(last, r.nameSize) + 12;
          const badgeTop = rowTop + 34 + (r.nameLines.length - 1) * r.nameStep;
          p.round(badgeX, badgeTop, 72, 38, 9, "rgba(177,191,198,.08)");
          p.text("并列", badgeX + 8, badgeTop + 2, 24, colors.muted, 56);
        }
        p.lines(r.secondary, NAME_X, rowTop + r.metadataTop, 30, colors.muted, r.secondaryWidth, 45);
        const unitWidth = width(section.unit, 30), valueTop = rowTop + r.valueTop;
        p.text(row.value, right - unitWidth - 9, valueTop, 81, row.rank === 1 ? colors.gold : colors.text, (r.wide ? right - NAME_X : 252) - unitWidth - 9, "right", 600);
        p.text(section.unit, right, valueTop + 38, 30, colors.muted, unitWidth + 2, "right");
        rowTop += r.height;
      });
    }
    const footer = poster.footerTop, date = card.month.replace(".", " 年 ") + " 月 · ";
    p.line(60, footer + 48, WIDTH - 60);
    p.text("桌边助手", 60, footer + 96, 33, colors.text, 180, "left", 600);
    p.text("ShadowTable", 252, footer + 106, 24, colors.muted, 240);
    p.text(date, 60, footer + 156, 27, colors.muted, 360);
    p.text("月度战报", 60 + width(date, 27), footer + 156, 27, colors.muted, 360);
    p.text("统计截至 " + card.asOf.slice(5), WIDTH - 60, footer + 105, 24, colors.muted, 390, "right");
  }
  return { cards, dimensions, renderDimensions, describe, drawCard, imagePaths, BACKGROUND_PATH, sectionLayout, layout };
});
