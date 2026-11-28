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
  const PERCIVAL_BADGE = "/assets/badges/percival_green.png";
  const VISIBLE_PLAYERS = 3;
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
  function boardLayout(lanes, width, stacked) {
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
          const textHeight = nameLines.length * 18;
          lane.tiles.push({ row, x: inset + col * cell, y, diameter, labelWidth, nameLines,
            textTop: Math.max(0, (diameter - textHeight) / 2) });
          rowHeight = Math.max(rowHeight, textHeight);
        }
        y += rowHeight + 6;
      }
      bottom = Math.max(bottom, y + (stacked ? 8 : 0));
    }
    return bottom;
  }
  function rankGroups(rows) {
    const lanes = [];
    for (const [index, row] of rows.entries()) {
      if (lanes[lanes.length - 1]?.rank !== row.rank) lanes.push({ rank: row.rank, start: index, members: [] });
      lanes[lanes.length - 1].members.push(row);
    }
    for (const lane of lanes) lane.folded = lane.members.length > VISIBLE_PLAYERS;
    return lanes;
  }
  function place(lane) {
    const rank = ["", "一", "二", "三"][lane.rank] || lane.rank;
    return lane.members.length > 1 ? "并列第" + rank : "第" + rank + "名";
  }
  function entriesLayout(lanes, section, width, pair, rate) {
    let bottom = 0;
    for (const [index, lane] of lanes.entries()) {
      const seat = pair && index < 2, inset = pair ? 15 : 0;
      lane.width = seat ? width / 2 : width;
      lane.x = seat ? index * lane.width : 0;
      lane.top = seat ? 0 : bottom;
      lane.tiles = [];
      const scoreSize = rate ? 21 : 28;
      const valueWidth = canvas.width(lane.members[0].value, scoreSize) + canvas.width(section.unit, 13) + 5;
      lane.scoreWidth = Math.min(Math.max(43, valueWidth), lane.width * (rate ? .39 : .30));
      lane.peopleX = seat || rate ? inset : inset + 82;
      const available = lane.width - lane.peopleX - lane.scoreWidth - inset - 10;
      const diameter = rate ? 26 : 33, fontSize = rate ? 15 : 17;
      let height = seat ? 27 : 7, used = 0, lineHeight = 0;
      for (const row of lane.folded ? [] : lane.members) {
        const sample = section.id === "points" ? row.secondary : "";
        const labelWidth = Math.max(1, Math.min(available - diameter - 7,
          Math.max(canvas.width(row.name, fontSize), canvas.width(sample, 12))));
        const tileWidth = diameter + 7 + labelWidth;
        if (used && (rate || used + tileWidth > available)) {
          height += lineHeight + 5; used = 0; lineHeight = 0;
        }
        const nameLines = wrap(row.name, fontSize, labelWidth);
        const sampleLines = sample ? wrap(sample, 12, labelWidth) : [];
        const textHeight = nameLines.length * 20 + sampleLines.length * 15;
        lane.tiles.push({ row, x: lane.peopleX + used, y: lane.top + height, diameter,
          textTop: Math.max(0, (diameter - textHeight) / 2), labelWidth, nameLines, sampleLines });
        used += tileWidth + 12;
        lineHeight = Math.max(lineHeight, diameter, textHeight);
      }
      lane.height = Math.max(rate ? 47 : 55, height + lineHeight + (seat ? 14 : 8));
      if (lane.folded) {
        lane.countWidth = Math.min(available, canvas.width(lane.members.length + " 位玩家", 17) + 13);
      }
      bottom = Math.max(bottom, lane.top + lane.height);
    }
    return bottom;
  }
  function sectionLayout(section, width = INNER) {
    const points = section.id === "points", rate = section.id === "good" || section.id === "evil";
    const lanes = rankGroups(section.rows);
    const stacked = lanes.some(lane => lane.members.length > 2);
    const folded = lanes.some(lane => lane.folded);
    const podium = points && !stacked;
    const entries = section.type === "honor" || rate || folded || (points && stacked);
    const pair = !points && !rate && entries && lanes.length === 3 && !lanes[0].folded && !lanes[1].folded && lanes[2].folded;
    const honor = section.type === "honor", badge = section.id === "percival_green" ? PERCIVAL_BADGE : "";
    const titleWidth = width - (badge ? 69 : 0), titleSize = honor ? 30 : 20;
    const title = wrap(points ? "本月积分榜" : section.title, titleSize, titleWidth);
    const subtitle = honor && section.subtitle ? wrap(section.subtitle, 14, titleWidth) : [];
    const heading = 17 + Math.max(badge ? 58 : 0, title.length * (honor ? 37 : 25) + subtitle.length * 20) + 13;
    let contentHeight;
    if (podium) contentHeight = podiumLayout(lanes, width);
    else if (entries) contentHeight = entriesLayout(lanes, section, width, pair, rate);
    else contentHeight = boardLayout(lanes, width, stacked);
    return { title, titleWidth, titleSize, subtitle, badge, heading, lanes, podium, stacked, entries, pair, rate,
      width, height: heading + contentHeight + (points ? 22 : 11) };
  }
  function layout(card) {
    let y = HERO, previous = "";
    const sections = [];
    for (let index = 0; index < card.sections.length; index++) {
      const section = card.sections[index];
      const title = section.groupTitle === "综合榜单" ? "" : section.groupTitle;
      const chapter = title !== previous ? title : "";
      previous = title;
      const groupTop = y;
      if (chapter) y += 42;
      const neighbor = card.sections[index + 1];
      if (section.id === "good" && neighbor?.id === "evil") {
        const gap = 30, width = (INNER - gap) / 2;
        const left = sectionLayout(section, width), right = sectionLayout(neighbor, width);
        sections.push({ section, box: left, x: M, top: y, groupTop, chapter },
          { section: neighbor, box: right, x: M + width + gap, top: y, groupTop, chapter: "", rightPanel: true });
        y += Math.max(left.height, right.height);
        index++;
      } else {
        const box = sectionLayout(section);
        sections.push({ section, box, x: M, top: y, chapter, groupTop });
        y += box.height;
      }
    }
    return { sections, footerTop: y + 10, width: WIDTH, height: Math.ceil((y + 54) * SCALE) };
  }
  const dimensions = (card) => ({ width: WIDTH, height: layout(card).height });
  function renderDimensions(card) {
    const size = dimensions(card),
      scale = Math.min(1, 8192 / size.height);
    return { width: Math.ceil(WIDTH * scale), height: Math.ceil(size.height * scale), scale };
  }
  // Both clients position player links and roster buttons using the bitmap layout.
  function playerTargets(card, report) {
    const page = layout(card), boards = report.groups.flatMap(group => group.boards), targets = [];
    const percent = (value, total) => Number((100 * value / total).toFixed(5));
    const bounds = (x, y, width, height) => ({ x: percent(x, W), y: percent(y * SCALE, page.height),
      width: percent(width, W), height: percent(height * SCALE, page.height) });
    for (const [index, { section, box, x, top }] of page.sections.entries()) {
      for (const lane of box.lanes) {
        const left = x + lane.x, y = top + box.heading;
        if (lane.folded) {
          targets.push({ key: section.id + "/tie/" + lane.rank, boardId: section.id, rank: lane.rank,
            label: section.title + "，" + place(lane) + "，查看全部 " + lane.members.length + " 位玩家",
            ...bounds(left + lane.peopleX, y + lane.top, lane.countWidth, lane.height) });
        } else {
          for (const [offset, tile] of lane.tiles.entries()) {
            const row = tile.row, publicId = boards[index].rows[lane.start + offset].publicId;
            targets.push({ key: section.id + "/" + publicId, publicId,
              label: section.title + "，" + (row.tied ? "并列" : "") + "第" + row.rank + "名，" + row.name + "，" + row.value + section.unit + "，查看玩家战绩",
              ...bounds(left + tile.x, y + tile.y, tile.diameter, tile.diameter) });
          }
        }
      }
    }
    return targets;
  }
  function rosterFor(report, boardId, rank) {
    const board = report?.groups.flatMap(group => group.boards).find(b => (b.metric || b.id) === boardId);
    const members = board?.rows.filter(row => row.rank === Number(rank));
    if (!members || members.length <= VISIBLE_PLAYERS) return null;
    return { title: board.title, place: place({ rank: Number(rank), members }), result: "各 " + members[0].value + " " + board.unit,
      members: members.map(row => {
        const { name, avatar, secondary } = rowProjection(row);
        return { publicId: row.publicId, name, avatar, sample: boardId === "points" ? secondary : "" };
      }) };
  }
  function imagePaths(card) {
    const paths = new Set([BACKGROUND_PATH]);
    for (const section of card.sections) {
      if (section.id === "percival_green") paths.add(PERCIVAL_BADGE);
      for (const lane of rankGroups(section.rows)) {
        if (!lane.folded) for (const row of lane.members) if (row.avatar) paths.add(row.avatar);
      }
    }
    return [...paths];
  }
  function describe(card) {
    return [card.month + " 月度战报", "完整长图", ...card.sections.flatMap(section => [section.title,
      ...rankGroups(section.rows).flatMap(lane => lane.folded
        ? [place(lane) + "，" + lane.members.length + " 位玩家，各 " + lane.members[0].value + section.unit]
        : lane.members.map(row => place(lane) + " " + row.name + " " + row.value + section.unit))])].join("，");
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
  function score(ctx, p, row, unit, x, y, size, limit, align = "left", each = false) {
    const ink = row.rank === 1 ? color.gold : color.text;
    const unitSize = 13;
    numberFont(ctx, size);
    const unitWidth = canvas.width(unit, unitSize), gap = unit === "%" ? 1 : 3;
    const prefix = each ? 16 : 0;
    const numberWidth = Math.min(measured(ctx, row.value, size), limit - unitWidth - gap - prefix);
    const total = numberWidth + unitWidth + gap;
    const left = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    if (each) {
      p.text("各", left - prefix, y + (size - unitSize) * .82, unitSize, color.muted, prefix);
      numberFont(ctx, size);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = ink;
    ctx.fillText(row.value, left, y, numberWidth);
    p.text(unit, left + numberWidth + gap, y + (size - unitSize) * 0.82, unitSize,
      align === "center" && row.rank === 1 ? color.gold : color.muted, unitWidth + 1);
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
      winner ? 40 : 30, lane.width - 10, "center");
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
    drawPeople(ctx, p, lane, x, y, images, 15, 18);
  }
  function drawPeople(ctx, p, lane, x, y, images, fontSize, lineHeight) {
    for (const tile of lane.tiles) {
      const ax = x + tile.x, ay = y + tile.y, tx = ax + tile.diameter + 7;
      avatar(ctx, p, tile.row, ax, ay, tile.diameter, images);
      p.lines(tile.nameLines, tx, ay + tile.textTop, fontSize, color.text, tile.labelWidth, lineHeight, 600);
      if (tile.sampleLines?.length) p.lines(tile.sampleLines, tx, ay + tile.textTop + tile.nameLines.length * lineHeight,
        12, color.muted, tile.labelWidth, 15);
    }
  }
  function drawEntry(ctx, p, section, box, lane, x, y, images) {
    const seat = box.pair && !lane.folded, rate = box.rate, inset = box.pair ? 15 : 0;
    const top = y + lane.top, mid = top + lane.height / 2;
    if (box.pair && lane.folded) {
      p.rect(x, top, lane.width, lane.height, "#172833");
      p.line(x, top, x + lane.width, color.line);
    } else if (!rate && lane.top) p.line(x, top, x + lane.width, color.line);
    if (seat && lane.x) p.rect(x, top + 10, 1, box.lanes[2].top - 20, color.line);
    const right = x + lane.width - inset - 2;
    const labelX = rate ? right : x + inset;
    p.text(place(lane), labelX, rate ? mid + 5 : seat ? top + 6 : mid - 8, rate ? 11 : 14,
      !rate && lane.rank === 1 ? color.gold : color.muted, rate ? 66 : 72, rate ? "right" : "left");
    const size = rate ? 21 : lane.folded ? 25 : 28;
    score(ctx, p, lane.members[0], section.unit, right, rate ? mid - 20 : seat ? top + 28 : mid - size / 2,
      size, lane.scoreWidth + (lane.folded ? 16 : 0), "right", lane.folded);
    if (lane.folded) {
      p.text(lane.members.length + " 位玩家", x + lane.peopleX, mid - 10, 17, color.text, lane.countWidth - 10, "left", 600);
    }
    drawPeople(ctx, p, lane, x, y, images, rate ? 15 : 17, 20);
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
    for (const { section, box, x, top, chapter, groupTop, rightPanel } of page.sections) {
      if (chapter) {
        p.line(M, groupTop, W - M, "#536570");
        p.text(chapter, M, groupTop + 13, 25, color.gold, INNER, "left", 600, true);
      } else if (rightPanel) p.rect(x - 15, top + 15, 1, box.height - 25, color.line);
      else if (top > HERO) p.line(M, top, W - M, color.line);
      const honor = section.type === "honor";
      box.title.forEach((line, i) => p.text(line, x, top + 14 + i * (honor ? 37 : 25),
        box.titleSize, color.text, box.titleWidth, "left", 600, honor));
      p.lines(box.subtitle, x, top + 16 + box.title.length * (honor ? 37 : 25), 14, color.muted, box.titleWidth, 20);
      const badge = box.badge && images.get(box.badge);
      if (badge?.width && badge.height) ctx.drawImage(badge, x + box.width - 59, top + 12, 58, 58);
      if (box.pair) p.round(x, top + box.heading, box.width, box.lanes[2].top + 5, 8,
        gradient(ctx, x, top, x + box.width, top, [[0, "#253944"], [1, "#1b2c36"]]));
      for (const lane of box.lanes) {
        const lx = x + lane.x, ly = top + box.heading;
        if (box.podium) drawPodium(ctx, p, section, lane, lx, ly, images);
        else if (box.entries) drawEntry(ctx, p, section, box, lane, lx, ly, images);
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
  return { cards, cardFromReport, dimensions, renderDimensions, describe, drawCard, imagePaths, BACKGROUND_PATH, sectionLayout, layout, playerTargets, rosterFor };
});
