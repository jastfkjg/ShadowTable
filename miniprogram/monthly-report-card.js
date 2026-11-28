(function (root, factory) {
  const value = factory(
    typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport,
    typeof module === "object" && module.exports ? require("./poster-canvas") : root.shadowtablePosterCanvas,
  );
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation, canvas) {
  const { WIDTH, clean, wrap, painter } = canvas;
  const BACKGROUND_PATH = "/assets/room-share-background.jpg";
  const W = 480,
    SCALE = WIDTH / W,
    M = 23,
    INNER = W - 2 * M,
    HERO = 178;
  const color = {
    bg: "#281f24",
    surface: "#33262b",
    ink: "#f7e9da",
    accent: "#efbd8f",
    muted: "#d1c0b8",
    line: "#554249",
    border: "#926e66",
  };
  const rowProjection = (row) => ({
    rank: row.rank,
    tied: row.tied,
    name: clean(row.nickname) || "新朋友",
    avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(row.avatarUrl || "") ? row.avatarUrl : "",
    value: clean(row.value),
    secondary: clean(row.secondaryLabel),
  });
  function cardFromReport(report) {
    if (!report.canShare) throw new Error("这个月还没有有效对局，暂时无法生成月报图片。");
    const sections = report.groups.flatMap((group) =>
      group.boards.map((board) => ({
        id: board.metric || board.id,
        title: board.title,
        unit: board.unit,
        type: board.sort ? "honor" : "board",
        groupTitle: group.title,
        subtitle: board.sort ? [board.roleLabel, board.label].filter(Boolean).join(" · ") : board.subtitle,
        rows: board.rows.map(rowProjection),
      })),
    );
    return {
      kind: "monthly", title: "月度战报", month: report.monthTitle, asOf: report.asOfLabel,
      status: report.status === "preview" ? "实时更新" : "", range: report.rangeLabel,
      overview: { games: report.overview.games, players: report.overview.players }, sections,
    };
  }
  const cards = (response) => [cardFromReport(presentation.presentReport(response))];
  // Tied players share a rank and score. Each avatar keeps its own nickname and optional game sample.
  function sectionLayout(section, width = INNER) {
    const points = section.id === "points";
    const inset = points ? 0 : 10,
      gap = 7;
    const title = wrap(points ? "本月积分榜" : section.title, 16, width - inset * 2);
    const subtitle = points ? [] : wrap(section.subtitle, 12, width - inset * 2);
    const heading = 10 + title.length * 22 + subtitle.length * 17 + 7;
    const lanes = [];
    for (const row of section.rows) {
      if (lanes[lanes.length - 1]?.rank !== row.rank) lanes.push({ rank: row.rank, members: [] });
      lanes[lanes.length - 1].members.push(row);
    }
    const weight = (lane) => Math.min(3, lane.members.length);
    const total = lanes.reduce((sum, lane) => sum + weight(lane), 0);
    const space = width - inset * 2 - gap * (lanes.length - 1);
    let x = inset,
      tallest = 0;
    for (const lane of lanes) {
      lane.x = x;
      lane.width = (space * weight(lane)) / total;
      const padding = points ? 7 : 2;
      const available = lane.width - padding * 2;
      const cols = Math.min(lane.members.length, Math.max(1, Math.floor(available / (points ? 85 : 66))));
      const tileWidth = available / cols;
      const diameter = Math.min(tileWidth - 4, points ? (lane.rank === 1 ? 65 : 54) : 38);
      const vertical = points || tileWidth < 114;
      const labelWidth = Math.max(22, tileWidth - (vertical ? 4 : diameter + 7));
      let cursor = points ? 27 : 26;
      lane.tiles = [];
      for (let index = 0; index < lane.members.length; index += cols) {
        let rowHeight = 0;
        for (const [column, row] of lane.members.slice(index, index + cols).entries()) {
          const nameLines = wrap(row.name, 14, labelWidth);
          const sampleLines = row.secondary ? wrap(row.secondary, 11, labelWidth) : [];
          const sampleOffset = nameLines.length * 18 + 1;
          const textHeight = sampleLines.length ? sampleOffset + sampleLines.length * 15 : nameLines.length * 18;
          const textTop = vertical ? diameter + 4 : Math.max(0, (diameter - textHeight) / 2);
          const height = Math.max(diameter, textTop + textHeight);
          lane.tiles.push({
            row,
            x: padding + column * tileWidth,
            y: cursor,
            tileWidth,
            diameter,
            avatarOffset: vertical ? (tileWidth - diameter) / 2 : 0,
            vertical,
            labelWidth,
            textTop, nameLines, sampleLines, sampleOffset,
          });
          rowHeight = Math.max(rowHeight, height);
        }
        cursor += rowHeight + 6;
      }
      lane.height = cursor + (points ? 31 : 1);
      tallest = Math.max(tallest, lane.height);
      x += lane.width + gap;
    }
    if (points) for (const lane of lanes) lane.height = tallest;
    return { title, subtitle, heading, lanes, height: heading + tallest + 8, width };
  }
  function layout(card) {
    let y = HERO,
      previous = "";
    const sections = [];
    for (const section of card.sections) {
      const points = section.id === "points";
      const title = section.groupTitle === "综合榜单" ? "胜率与场次" : section.groupTitle;
      const chapter = !points && title !== previous ? title : "";
      if (!points) previous = title;
      const groupTop = y;
      if (chapter) y += 42;
      const box = sectionLayout(section);
      sections.push({ section, box, x: M, top: y, chapter, groupTop });
      y += box.height + 6;
    }
    return { sections, footerTop: y + 10, width: WIDTH, height: Math.ceil((y + 54) * SCALE) };
  }
  const dimensions = (card) => ({ width: WIDTH, height: layout(card).height });
  function renderDimensions(card) {
    const size = dimensions(card),
      scale = Math.min(1, 8192 / size.height);
    return { width: Math.ceil(WIDTH * scale), height: Math.ceil(size.height * scale), scale };
  }
  // Overlay only the avatars on the home page. Both platforms use the same positions as drawCard.
  function playerTargets(card, report) {
    const page = layout(card);
    const boards = report.groups.flatMap(group => group.boards);
    const targets = [];
    const percent = (value, total) => Number((100 * value / total).toFixed(5));
    const height = page.height / SCALE;
    for (const [index, { section, box, x, top }] of page.sections.entries()) {
      // Layout preserves the board's ranked row order, including all ties.
      let rowIndex = 0;
      for (const lane of box.lanes) for (const tile of lane.tiles) {
        const row = tile.row, publicId = boards[index].rows[rowIndex++].publicId;
        targets.push({
          key: section.id + "/" + publicId,
          publicId,
          label: section.title + "，" + (row.tied ? "并列" : "") + "第" + row.rank + "名，" + row.name + "，" + row.value + section.unit + "，查看玩家战绩",
          x: percent(x + lane.x + tile.x + tile.avatarOffset, W),
          y: percent(top + box.heading + tile.y, height),
          width: percent(tile.diameter, W), height: percent(tile.diameter, height),
        });
      }
    }
    return targets;
  }
  const imagePaths = (card) => [
    ...new Set([
      BACKGROUND_PATH,
      ...card.sections.flatMap((section) => section.rows.map((row) => row.avatar).filter(Boolean)),
    ]),
  ];
  function describe(card) {
    return [
      card.month + " 月度战报",
      "完整长图",
      ...card.sections.flatMap((section) => [
        section.title,
        ...section.rows.map(
          (row) => (row.tied ? "并列" : "") + "第" + row.rank + "名 " + row.name + " " + row.value + section.unit,
        ),
      ]),
    ].join("，");
  }
  function avatar(ctx, p, row, x, y, size, images) {
    const art = images.get(row.avatar);
    ctx.save();
    p.round(x, y, size, size, 7, color.line);
    if (art?.width && art.height) {
      // round() leaves the rounded path current on native and browser Canvas.
      ctx.clip();
      const side = Math.min(art.width, art.height);
      ctx.drawImage(art, (art.width - side) / 2, (art.height - side) / 2, side, side, x, y, size, size);
    } else {
      ctx.fillStyle = color.muted;
      ctx.beginPath();
      ctx.arc(x + size * 0.5, y + size * 0.37, size * 0.15, 0, Math.PI * 2);
      ctx.fill();
      p.round(x + size * 0.21, y + size * 0.57, size * 0.58, size * 0.27, size * 0.12, color.muted);
    }
    ctx.restore();
  }
  function drawCard(ctx, card, images = new Map()) {
    const page = layout(card),
      p = painter(ctx);
    ctx.save();
    ctx.scale(SCALE, SCALE);
    p.rect(0, 0, W, page.height / SCALE, color.bg);
    const art = images.get(BACKGROUND_PATH);
    if (art?.width && art.height) {
      const scale = Math.max(W / art.width, HERO / art.height),
        crop = HERO / scale;
      ctx.drawImage(art, (art.width - W / scale) / 2, (art.height - crop) * 0.6, W / scale, crop, 0, 0, W, HERO);
      const gradient = ctx.createLinearGradient?.(0, 0, W, 0);
      if (gradient?.addColorStop) {
        gradient.addColorStop(0, "#251f26");
        gradient.addColorStop(0.42, "rgba(37,31,38,.85)");
        gradient.addColorStop(1, "rgba(37,31,38,0)");
        p.rect(0, 0, W, HERO, gradient);
      }
    }
    const m = Number(card.month.slice(5)),
      month = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"][m - 1];
    p.text("桌边助手", M, 15, 12, color.ink, 120, "left", 600);
    p.text(card.month.replace(".", " / "), W - M, 15, 14, color.ink, 120, "right");
    p.text(month + "月", M, 44, 34, color.ink, 220, "left", 600, true);
    p.text("炉边来信", M, 84, 34, color.ink, 230, "left", 600, true);
    p.text(card.overview.games + " 场对局   |   " + card.overview.players + " 位玩家", M, 141, 15, color.ink, 280);
    for (const { section, box, x, top, chapter, groupTop } of page.sections) {
      if (chapter) {
        p.line(M, groupTop + 4, W - M, color.border);
        p.text(chapter, M, groupTop + 11, 21, color.ink, INNER, "left", 600, true);
      }
      const points = section.id === "points",
        inset = points ? 0 : 10;
      if (!points) p.round(x, top, box.width, box.height, 7, color.surface);
      p.lines(box.title, x + inset, top + 7, 16, color.ink, box.width - 2 * inset, 22, 600);
      if (points) p.text("前三名", x + box.width, top + 10, 12, color.muted, 80, "right");
      p.lines(box.subtitle, x + inset, top + 8 + box.title.length * 22, 12, color.muted, box.width - 2 * inset, 17);
      const ly = top + box.heading;
      for (const lane of box.lanes) {
        const lx = x + lane.x,
          lead = lane.members[0],
          ink = lane.rank === 1 ? color.accent : color.ink;
        const label = (lead.tied || lane.members.length > 1 ? "并列" : "") + "第" + lane.rank + "名";
        if (points) {
          p.round(lx, ly, lane.width, lane.height, 8, lane.rank === 1 ? "#b68a66" : color.border);
          p.round(lx + 1, ly + 1, lane.width - 2, lane.height - 2, 7, lane.rank === 1 ? "#594039" : "#402e34");
          p.text(label, lx + lane.width / 2, ly + 6, 12, ink, lane.width - 8, "center");
          p.text(
            lead.value + section.unit,
            lx + lane.width / 2,
            ly + lane.height - 31,
            24,
            ink,
            lane.width - 8,
            "center",
            600,
          );
        } else {
          const rankWidth = Math.min(lane.width * 0.46, label.length * 12);
          p.text(label, lx + 2, ly + 3, 11, color.muted, rankWidth);
          p.text(lead.value + section.unit, lx + rankWidth + 5, ly, 16, ink, lane.width - rankWidth - 6, "left", 600);
        }
        for (const tile of lane.tiles) {
          const left = lx + tile.x,
            y = ly + tile.y;
          const ax = left + tile.avatarOffset;
          avatar(ctx, p, tile.row, ax, y, tile.diameter, images);
          const align = tile.vertical ? "center" : "left";
          const tx = left + (tile.vertical ? tile.tileWidth / 2 : tile.diameter + 5);
          const ty = y + tile.textTop;
          p.lines(tile.nameLines, tx, ty, 14, color.ink, tile.labelWidth, 18, 600, align);
          p.lines(tile.sampleLines, tx, ty + tile.sampleOffset, 11, color.muted, tile.labelWidth, 15, 400, align);
        }
      }
    }
    p.line(M, page.footerTop, W - M, color.line);
    p.text("桌边助手", M, page.footerTop + 11, 12, color.ink, 110, "left", 600);
    p.text(
      (card.status ? card.status + " · " : "") + "截至 " + card.asOf,
      W - M,
      page.footerTop + 11,
      11,
      color.muted,
      290,
      "right",
    );
    ctx.restore();
  }
  return { cards, cardFromReport, dimensions, renderDimensions, describe, drawCard, imagePaths, BACKGROUND_PATH, sectionLayout, layout, playerTargets };
});
