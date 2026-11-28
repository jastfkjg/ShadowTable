(function (root, factory) {
  const value = factory(
    typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport,
    typeof module === "object" && module.exports ? require("./poster-canvas") : root.shadowtablePosterCanvas,
  );
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation, canvas) {
  const { WIDTH, clean, wrap, painter, colors } = canvas;
  const BACKGROUND_PATH = "/assets/room-share-background.jpg";
  const W = 480,
    SCALE = WIDTH / W,
    M = 23,
    INNER = W - 2 * M,
    HERO = 229;
  const color = { ...colors, line: "#32434c" };
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
  // Coordinates are shared by the exported bitmap and the player links on the home page.
  function podiumLayout(lanes, width) {
    const side = (width - 4) / 3.16, center = side * 1.16;
    let height = 0, sampleHeight = 0;
    for (const lane of lanes) {
      const winner = lane.rank === 1;
      lane.width = winner ? center : side;
      lane.x = winner ? side + 2 : lane.rank === 2 ? 0 : side + center + 4;
      lane.plinth = winner ? 86 : lane.rank === 2 ? 66 : 60;
      const cell = lane.width / lane.members.length;
      const diameter = Math.min(winner ? 64 : 50, cell - 14);
      lane.tiles = lane.members.map((row, i) => {
        const labelWidth = cell - 8;
        const nameLines = wrap(row.name, 18, labelWidth);
        const sampleLines = row.secondary ? wrap(row.secondary, 12, labelWidth) : [];
        return { row, x: (i + 0.5) * cell - diameter / 2, diameter, labelWidth, nameLines, sampleLines };
      });
      lane.nameHeight = Math.max(...lane.tiles.map(tile => tile.nameLines.length)) * 22;
      sampleHeight = Math.max(sampleHeight, (Math.max(...lane.tiles.map(tile => tile.sampleLines.length)) - 1) * 15);
      height = Math.max(height, diameter + 10 + lane.nameHeight + 10 + lane.plinth);
    }
    for (const lane of lanes) {
      lane.plinthTop = height - lane.plinth;
      lane.plinth += sampleHeight;
      for (const tile of lane.tiles) {
        tile.y = lane.plinthTop - 10 - lane.nameHeight - 10 - tile.diameter;
      }
    }
    return height + sampleHeight;
  }
  function boardLayout(lanes, width, stacked, points) {
    let bottom = 0;
    for (const [index, lane] of lanes.entries()) {
      lane.x = stacked ? 0 : index * width / lanes.length;
      lane.width = stacked ? width : width / lanes.length;
      lane.top = stacked ? bottom : 0;
      const inset = !stacked && index ? 13 : 0;
      const cols = stacked ? Math.min(3, lane.members.length) : 1;
      const cell = (lane.width - inset) / cols;
      const diameter = 31;
      const labelWidth = cell - diameter - 13;
      let y = lane.top + 33;
      lane.tiles = [];
      for (let i = 0; i < lane.members.length; i += cols) {
        let rowHeight = diameter;
        for (const [col, row] of lane.members.slice(i, i + cols).entries()) {
          const nameLines = wrap(row.name, 15, labelWidth);
          const sampleLines = points ? wrap(row.secondary, 12, labelWidth) : [];
          const textHeight = nameLines.length * 18 + sampleLines.length * 15;
          lane.tiles.push({ row, x: inset + col * cell, y, diameter, labelWidth, nameLines, sampleLines,
            textTop: Math.max(0, (diameter - textHeight) / 2) });
          rowHeight = Math.max(rowHeight, textHeight);
        }
        y += rowHeight + 6;
      }
      bottom = Math.max(bottom, y + (stacked ? 8 : 0));
    }
    return bottom;
  }
  function sectionLayout(section, width = INNER) {
    const points = section.id === "points";
    const title = wrap(points ? "本月积分榜" : section.title, 20, width);
    const subtitle = section.type === "honor" && section.subtitle ? wrap(section.subtitle, 14, width) : [];
    const heading = 17 + title.length * 25 + subtitle.length * 20 + 13;
    const lanes = [];
    for (const row of section.rows) {
      if (lanes[lanes.length - 1]?.rank !== row.rank) lanes.push({ rank: row.rank, members: [] });
      lanes[lanes.length - 1].members.push(row);
    }
    // Large tied groups flow across the full width so every player and sample stays legible.
    const stacked = lanes.some(lane => lane.members.length > 2);
    const podium = points && !stacked;
    const contentHeight = podium ? podiumLayout(lanes, width) : boardLayout(lanes, width, stacked, points);
    return { title, subtitle, heading, lanes, podium, stacked, height: heading + contentHeight + (points ? 22 : 11), width };
  }
  function layout(card) {
    let y = HERO,
      previous = "";
    const sections = [];
    for (const section of card.sections) {
      const points = section.id === "points";
      const title = section.groupTitle === "综合榜单" ? "" : section.groupTitle;
      const chapter = !points && title !== previous ? title : "";
      if (!points) previous = title;
      const groupTop = y;
      if (chapter) y += 42;
      const box = sectionLayout(section);
      sections.push({ section, box, x: M, top: y, chapter, groupTop });
      y += box.height;
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
          x: percent(x + lane.x + tile.x, W),
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
  function avatar(ctx, p, row, x, y, size, images, circular = false) {
    const art = images.get(row.avatar);
    ctx.save();
    if (circular) {
      circle(ctx, x + size / 2, y + size / 2, size / 2, color.line);
    } else {
      p.round(x, y, size, size, 6, color.line);
    }
    if (art?.width && art.height) {
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
  function circle(ctx, x, y, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  function gradient(ctx, x, y, endX, endY, stops) {
    const fill = ctx.createLinearGradient?.(x, y, endX, endY);
    if (!fill?.addColorStop) return stops[0][1];
    for (const [position, color] of stops) fill.addColorStop(position, color);
    return fill;
  }
  function numberFont(ctx, size) {
    ctx.font = "600 " + size + "px 'DIN Alternate', 'Helvetica Neue', sans-serif";
  }
  function measured(ctx, value, size) {
    return ctx.measureText?.(value)?.width || canvas.width(value, size);
  }
  // Set the unit on the number's baseline and reserve its width even for a large negative score.
  function score(ctx, p, row, unit, x, y, size, limit, center = false) {
    const ink = row.rank === 1 ? color.gold : color.text;
    const unitSize = 13;
    numberFont(ctx, size);
    const unitWidth = canvas.width(unit, unitSize), gap = unit === "%" ? 1 : 3;
    const numberWidth = Math.min(measured(ctx, row.value, size), limit - unitWidth - gap);
    const left = center ? x - (numberWidth + unitWidth + gap) / 2 : x;
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = ink;
    ctx.fillText(row.value, left, y, numberWidth);
    p.text(unit, left + numberWidth + gap, y + (size - unitSize) * 0.82, unitSize,
      center && row.rank === 1 ? color.gold : color.muted, unitWidth + 1);
  }
  function drawPodium(ctx, p, section, lane, x, y, images) {
    const winner = lane.rank === 1, third = lane.rank === 3;
    const top = y + lane.plinthTop;
    const fill = gradient(ctx, x, top, x, top + lane.plinth, [
      [0, winner ? "#31434a" : "#223642"], [1, winner ? "#1a2b34" : "#192933"],
    ]);
    p.rect(x, top, lane.width, lane.plinth, fill);
    p.rect(x, top, lane.width, winner ? 2 : 1, winner ? color.gold : "#617681");
    score(ctx, p, lane.members[0], section.unit, x + lane.width / 2, top + (winner ? 10 : 6),
      winner ? 40 : 30, lane.width - 10, true);
    for (const tile of lane.tiles) {
      const ax = x + tile.x, ay = y + tile.y, d = tile.diameter, cx = ax + d / 2;
      if (winner) {
        circle(ctx, cx, ay + d / 2, d / 2 + 5, "#ac965e");
        circle(ctx, cx, ay + d / 2, d / 2 + 3.5, color.bg);
      }
      avatar(ctx, p, tile.row, ax, ay, d, images, true);
      const badgeX = ax + d - 3, badgeY = ay + d - 3;
      circle(ctx, badgeX, badgeY, 10, color.bg);
      circle(ctx, badgeX, badgeY, 8.5, winner ? color.gold : third ? "#aca59a" : "#a3b6c0");
      p.text(lane.rank, badgeX, badgeY - 6, 12, color.bg, 15, "center", 600);
      p.lines(tile.nameLines, cx, ay + d + 10, 18, color.text, tile.labelWidth, 22, 600, "center");
      p.lines(tile.sampleLines, cx, top + (winner ? 57 : 41), 12, color.muted, tile.labelWidth, 15, 400, "center");
    }
  }
  function drawBoard(ctx, p, section, box, lane, x, y, images) {
    const first = lane.members[0], inset = !box.stacked && lane.x ? 13 : 0;
    const top = y + lane.top, left = x + inset, tied = first.tied || lane.members.length > 1;
    if (box.stacked && lane.top) p.line(x, top - 5, x + lane.width, color.line);
    if (inset) p.rect(x, top, 1, box.height - box.heading - 18, color.line);
    const label = String(lane.rank).padStart(2, "0") + (tied ? " 并列" : "");
    p.text(label, left, top + 6, 13, first.rank === 1 ? color.gold : color.muted, 50);
    const scoreX = left + (tied ? 58 : 24);
    score(ctx, p, first, section.unit, scoreX, top, 23, x + lane.width - scoreX - 5);
    for (const tile of lane.tiles) {
      const ax = x + tile.x, ay = y + tile.y, tx = ax + tile.diameter + 7;
      avatar(ctx, p, tile.row, ax, ay, tile.diameter, images);
      p.lines(tile.nameLines, tx, ay + tile.textTop, 15, color.text, tile.labelWidth, 18, 600);
      p.lines(tile.sampleLines, tx, ay + tile.textTop + tile.nameLines.length * 18, 12, color.muted, tile.labelWidth, 15);
    }
  }
  function drawCard(ctx, card, images = new Map()) {
    const page = layout(card), p = painter(ctx);
    ctx.save();
    ctx.scale(SCALE, SCALE);
    p.rect(0, 0, W, page.height / SCALE, color.bg);
    const art = images.get(BACKGROUND_PATH);
    if (art?.width && art.height) {
      const scale = Math.max(W / art.width, HERO / art.height), crop = HERO / scale;
      ctx.drawImage(art, (art.width - W / scale) / 2, (art.height - crop) * 0.58, W / scale, crop, 0, 0, W, HERO);
      p.rect(0, 0, W, HERO, gradient(ctx, 0, 0, W, 0, [
        [0, "rgba(16,28,36,.95)"], [.35, "rgba(16,28,36,.73)"], [.75, "rgba(16,28,36,0)"],
      ]));
      p.rect(0, HERO * .77, W, HERO * .23, gradient(ctx, 0, HERO * .77, 0, HERO, [
        [0, "rgba(16,28,36,0)"], [1, color.bg],
      ]));
    }
    p.text(card.month.replace(".", "  /  "), M, 40, 17, color.gold, 95, "left", 600);
    p.text("炉边来信", M, 74, 54, color.text, INNER, "left", 600, true);
    let statX = M;
    for (const [value, unit] of [[card.overview.games, "场对局"], [card.overview.players, "位玩家"]]) {
      if (statX !== M) { p.rect(statX, 159, 1, 13, "#617078"); statX += 15; }
      const count = String(value);
      p.font(21, 600);
      const digits = Math.min(90, measured(ctx, count, 21));
      p.text(count, statX, 152, 21, color.text, digits, "left", 600);
      p.text(unit, statX + digits + 5, 158, 14, color.muted, 46);
      statX += digits + 62;
    }
    for (const { section, box, x, top, chapter, groupTop } of page.sections) {
      if (chapter) {
        p.line(M, groupTop, W - M, "#536570");
        p.text(chapter, M, groupTop + 13, 25, color.gold, INNER, "left", 600, true);
      } else if (top > HERO) p.line(M, top, W - M, color.line);
      p.lines(box.title, x, top + 14, 20, color.text, box.width, 25, 600);
      p.lines(box.subtitle, x, top + 16 + box.title.length * 25, 14, color.muted, box.width, 20);
      for (const lane of box.lanes) {
        const lx = x + lane.x, ly = top + box.heading;
        if (box.podium) drawPodium(ctx, p, section, lane, lx, ly, images);
        else drawBoard(ctx, p, section, box, lane, lx, ly, images);
      }
    }
    p.line(M, page.footerTop, W - M, color.line);
    p.text("桌边助手", M, page.footerTop + 11, 12, color.text, 110, "left", 600);
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
