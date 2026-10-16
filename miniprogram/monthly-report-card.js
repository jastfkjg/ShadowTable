(function (root, factory) {
  const value = factory(
    typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport,
    typeof module === "object" && module.exports ? require("./poster-canvas") : root.shadowtablePosterCanvas,
  );
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation, canvas) {
  const { WIDTH, LEFT, RIGHT, colors, clean, width, wrap, painter, BACKGROUND_PATH } = canvas;
  const CONTENT_TOP = 486, GAP = 26, GROUP_HEADER = 118;
  const roleArt = metric => {
    const role = /^merlin_/.test(metric) ? "merlin" : /^percival_/.test(metric) ? "percival" : /^assassin_/.test(metric) ? "assassin" : "";
    return role ? "/assets/roles/" + role + ".png" : "";
  };
  const rowProjection = row => ({ rank: row.rank, tied: row.tied, name: clean(row.nickname) || "新朋友",
    avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(row.avatarUrl || "") ? row.avatarUrl : "",
    value: clean(row.value), secondary: clean(row.secondaryLabel), rate: row.rate, opportunities: row.opportunities });
  function rowLayout(row, honor = false) {
    const wide = width(row.value, honor ? 44 : 46) > (honor ? 106 : 160);
    const nameSize = honor ? 39 : 36, nameStep = honor ? 56 : 52;
    const nameWidth = honor ? wide ? 772 : 642 : (wide ? 712 : 526) - (row.tied ? 76 : 0);
    const nameLines = wrap(row.name, nameSize, nameWidth);
    const secondary = honor ? [] : wrap(row.secondary, 25, wide ? 712 : 526);
    const nameHeight = Math.max(honor ? 60 : 62, nameLines.length * nameStep);
    const metadataTop = honor ? 18 + nameHeight + 11 : 18 + nameLines.length * nameStep + 6;
    const dataBottom = honor ? metadataTop + 40 : metadataTop + secondary.length * 38;
    return { wide, nameSize, nameStep, nameWidth, nameLines, secondary, nameHeight, metadataTop,
      valueTop: wide ? dataBottom + 12 : 28, height: Math.max(honor ? 146 : 132, dataBottom + (wide ? 76 : 18)) };
  }
  function sectionLayout(section) {
    const honor = section.type === "honor", titleSize = honor ? 38 : 35;
    const title = wrap(section.title, titleSize, honor ? 660 : 686);
    const subtitle = wrap(section.subtitle, honor ? 25 : 24, honor ? 690 : 730);
    const header = honor ? 16 + title.length * 57 + subtitle.length * 38 + 16 : 24 + title.length * 50 + subtitle.length * 36 + 14;
    const rows = section.rows.map(row => rowLayout(row, honor));
    return { title, subtitle, header, rows, height: header + rows.reduce((sum, row) => sum + row.height, 0) + (honor ? 24 : 16) };
  }
  function cards(response, entertainment = false) {
    const report = presentation.presentReport(response);
    if (!report.canShare) throw new Error("这个月还没有有效对局，暂时无法生成月报图片。");
    const main = [...report.coreBoards, ...report.extraBoards].map(board => ({ type: "board", id: board.id, title: board.title, subtitle: board.subtitle, unit: board.unit, rows: board.rows.map(rowProjection) }));
    const featured = entertainment ? presentation.detailBoards(report, "count", true).slice(0, 3) : report.featured;
    const honors = featured.map(board => ({ type: "honor", id: board.metric, title: board.title,
      subtitle: [board.roleLabel, board.label].filter(Boolean).join(" · "), unit: board.unit, portrait: roleArt(board.metric),
      rateLabel: board.rateLabel, groupTitle: entertainment ? "本月娱乐榜" : "本月趣味荣誉", rows: board.rows.map(rowProjection) }));
    const metadata = { kind: "monthly", title: entertainment ? "月度战报 · 娱乐版" : "月度战报", month: report.monthTitle,
      range: report.rangeLabel, asOf: report.asOfLabel, status: report.statusLabel, overview: { games: report.overview.games, players: report.overview.players } };
    if (honors.length) honors[0].showGroupTitle = true;
    // Keep the existing array interface for both clients; one report is one image.
    return [{ ...metadata, edition: entertainment ? "entertainment" : "overall", sections: [...main, ...honors] }];
  }
  function layout(card) {
    let cursor = CONTENT_TOP;
    const sections = card.sections.map((section, index) => {
      if (index) cursor += GAP;
      const groupTop = section.showGroupTitle ? cursor : null;
      if (section.showGroupTitle) cursor += GROUP_HEADER;
      const box = sectionLayout(section), top = cursor;
      cursor += box.height;
      return { section, box, top, groupTop };
    });
    return { sections, width: WIDTH, height: Math.ceil(Math.max(960, cursor + 162)) };
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
    const drawValue = (row, unit, top, right, maxWidth, size) => {
      const unitWidth = width(unit, 23);
      p.text(row.value, right - unitWidth - 10, top, size, row.rank === 1 ? colors.gold : colors.text, maxWidth - unitWidth - 10, "right", 500);
      p.text(unit, right, top + size * .45, 23, colors.muted, unitWidth + 2, "right");
    };
    p.background(height, images); p.brand(card.month);
    p.text(card.month.replace(".", " 年 ") + " 月", LEFT, 145, 26, colors.gold);
    p.text("月度战报", LEFT, 204, 86, colors.text, 700, "left", 600, true);
    p.text(card.range.slice(5).replace(/—20\d{2}\./, " — ") + " · " + (card.status || "月度战报"), LEFT, 321, 24, colors.muted, 740);
    p.line(LEFT, 366, RIGHT, "rgba(229,198,139,.65)");
    [[card.overview.games, "有效对局"], [card.overview.players, "参赛玩家"]].forEach(([value, label], index) => {
      const x = LEFT + index * 280;
      p.text(value, x, 391, 58, colors.text, 150, "left", 500);
      p.text(label, x + Math.min(150, width(value, 58)) + 17, 420, 25, colors.muted, 155);
    });
    p.text(card.edition === "entertainment" ? "综合榜单 · 娱乐版" : "综合榜单", RIGHT, 420, 21, colors.muted, 275, "right");
    p.line(LEFT, 461, RIGHT);
    for (const { section, box, top: cursor, groupTop } of poster.sections) {
      if (groupTop !== null) {
        p.icon("spark", LEFT, groupTop + 28, 30);
        p.text(section.groupTitle, LEFT + 48, groupTop + 24, 34, colors.text, 620, "left", 600);
        p.text("按次数 · 每榜前三名次", RIGHT, groupTop + 33, 22, colors.muted, 310, "right");
        p.line(LEFT, groupTop + 89, RIGHT);
      }
      const honor = section.type === "honor", right = honor ? RIGHT : RIGHT - 32;
      if (!honor) p.round(LEFT, cursor, 936, box.height, 28);
      const titleX = honor ? LEFT + 108 : LEFT + 86;
      if (honor && images.get(section.portrait)) ctx.drawImage(images.get(section.portrait), LEFT, cursor + 6, 90, 104);
      else p.icon(boardIcon(section.id), LEFT + (honor ? 23 : 32), cursor + 30, honor ? 42 : 32);
      p.lines(box.title, titleX, cursor + (honor ? 16 : 24), honor ? 38 : 35, honor ? colors.gold : colors.text, honor ? 660 : 686, honor ? 57 : 50, 600);
      p.lines(box.subtitle, titleX, cursor + (honor ? 16 + box.title.length * 57 : 24 + box.title.length * 50), honor ? 25 : 24, colors.muted, 730, 36);
      p.text("TOP 3", right, cursor + 35, 21, colors.muted, 110, "right");
      let rowTop = cursor + box.header;
      section.rows.forEach((row, index) => {
        const r = box.rows[index], x = honor ? LEFT : LEFT + 32, nameX = honor ? LEFT + 164 : LEFT + 184;
        p.line(x, rowTop, right);
        p.text(String(row.rank).padStart(2, "0"), x, rowTop + 26, honor ? 28 : 30, row.rank === 1 ? colors.gold : row.rank === 2 ? "#c3d1d9" : "#c9aa95", 52);
        if (honor && row.tied) p.text("并列", x, rowTop + 66, 18, colors.muted, 56);
        p.avatar(row, honor ? LEFT + 80 : LEFT + 98, rowTop + 18, honor ? 60 : 62, images);
        p.lines(r.nameLines, nameX, rowTop + 18, r.nameSize, colors.text, r.nameWidth, r.nameStep, 550);
        if (!honor && row.tied) {
          const last = r.nameLines[r.nameLines.length - 1], badgeX = nameX + width(last, 36) + 12, badgeTop = rowTop + 22 + (r.nameLines.length - 1) * 52;
          p.round(badgeX, badgeTop, 62, 31, 6, "rgba(177,191,198,.06)"); p.text("并列", badgeX + 7, badgeTop + 2, 21, colors.muted, 48);
        }
        if (honor) {
          const y = rowTop + r.metadataTop;
          if (Number.isFinite(row.rate) && Number.isFinite(row.opportunities)) {
            p.text(section.rateLabel || "成功率", nameX, y + 3, 23, colors.muted, 85);
            p.text(row.rate + "%", nameX + 86, y, 27, "#d3dce0", 130);
            p.text("有效机会", nameX + 245, y + 3, 23, colors.muted, 110);
            p.text(row.opportunities + " 次", nameX + 357, y, 27, "#d3dce0", 250);
          } else p.lines(wrap(row.secondary, 23, 772), nameX, y, 23, colors.muted, 772, 36);
        } else p.lines(r.secondary, nameX, rowTop + r.metadataTop, 25, colors.muted, r.wide ? 712 : 526, 38);
        drawValue(row, section.unit, rowTop + r.valueTop, right, r.wide ? 800 : honor ? 106 : 160, honor ? 44 : 46);
        rowTop += r.height;
      });
    }
    p.footer(height, card.edition === "entertainment" ? "月度战报 · 娱乐版" : "月度战报", card.asOf);
  }
  return { cards, dimensions, renderDimensions, describe, drawCard, imagePaths, BACKGROUND_PATH, sectionLayout, layout };
});
