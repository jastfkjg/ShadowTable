(function (root, factory) {
  const value = factory(
    typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport,
    typeof module === "object" && module.exports ? require("./poster-canvas") : root.shadowtablePosterCanvas,
    typeof module === "object" && module.exports ? require("./badges") : root.shadowtableBadges,
  );
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation, canvas, badges) {
  const { WIDTH, clean, wrap, painter, colors } = canvas;
  const BACKGROUND_PATH = "/assets/room-share-background.jpg";
  const BADGE_SIZE = 27, BADGE_GAP = 6;
  const badgeArt = new Map(badges.catalogue.map(badge => [badge.id, badge.imageUrl]));
  const rateBadges = new Map([["overall", "rate_overall"], ["good", "rate_good"], ["evil", "rate_evil"]]);
  const titleBadge = id => badgeArt.get(rateBadges.get(id) || id);
  const VISIBLE_PLAYERS = 3, PREVIEW_LIMIT = 4;
  const COMPACT_AVATAR = 25, PLAYER_GAP = 4, TWO_PLAYERS = 2 * (COMPACT_AVATAR + PLAYER_GAP);
  const W = 480,
    SCALE = WIDTH / W,
    M = 23,
    INNER = W - 2 * M,
    GUTTER = 30, COL = (INNER - GUTTER) / 2,
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
        subtitle: board.sort ? [board.roleLabel, board.label === board.title ? "" : board.label].filter(Boolean).join(" · ") : board.subtitle,
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
  function playerTile(row, diameter, fontSize, available, sample = "") {
    const labelWidth = Math.max(1, Math.min(available - diameter - 6,
      Math.max(canvas.width(row.name, fontSize), canvas.width(sample, 12))));
    const nameLines = wrap(row.name, fontSize, labelWidth);
    const sampleLines = sample ? wrap(sample, 12, labelWidth) : [];
    const textHeight = nameLines.length * 20 + sampleLines.length * 15;
    return { row, diameter, labelWidth, nameLines, sampleLines, height: Math.max(diameter, textHeight),
      textTop: Math.max(0, (diameter - textHeight) / 2) };
  }
  function entriesLayout(lanes, section, width, compact) {
    let bottom = 0;
    for (const lane of lanes) {
      lane.width = width;
      lane.x = 0;
      lane.top = bottom;
      lane.tiles = [];
      lane.groupHeader = !compact && lane.members.length > 1;
      const scoreSize = compact ? 21 : 22;
      lane.each = compact && lane.members.length > 1 && section.unit !== "%";
      const valueWidth = canvas.width(lane.members[0].value, scoreSize) + canvas.width(section.unit, 13) + 5;
      lane.scoreWidth = Math.min(Math.max(44, valueWidth + (lane.each ? 16 : 0)), lane.width * .4);
      if (lane.folded) {
        lane.countWidth = Math.min(lane.width * .54, canvas.width(lane.members.length + " 位玩家", 15) + 12);
        lane.peopleX = compact ? 0 : lane.width - lane.countWidth;
        lane.height = compact ? 45 : 43;
        lane.countHeight = lane.height;
        bottom = lane.top + lane.height;
        continue;
      }
      lane.peopleX = lane.groupHeader ? 12 : compact ? 0 : 77;
      const available = lane.width - lane.peopleX - (lane.groupHeader ? 0 : lane.scoreWidth + 7);
      const diameter = compact ? COMPACT_AVATAR : 29, fontSize = compact ? 15 : 16;
      let height = lane.groupHeader ? 31 : 8, used = 0, lineHeight = 0;
      for (const row of lane.members) {
        const sample = section.id === "points" ? row.secondary : "";
        const tile = playerTile(row, diameter, fontSize, available, sample);
        const tileWidth = diameter + 6 + tile.labelWidth;
        if (used && (compact || used + tileWidth > available)) {
          height += lineHeight + PLAYER_GAP; used = 0; lineHeight = 0;
        }
        lane.tiles.push({ ...tile, x: lane.peopleX + used, y: lane.top + height });
        used += tileWidth + 14;
        lineHeight = Math.max(lineHeight, tile.height);
      }
      lane.height = Math.max(compact ? 45 : 43, height + lineHeight + 8);
      bottom = Math.max(bottom, lane.top + lane.height);
    }
    return bottom;
  }
  function sectionLayout(section, width = INNER) {
    const points = section.id === "points", compact = width < INNER || section.id === "games" || rateBadges.has(section.id);
    const lanes = rankGroups(section.rows);
    const podium = points && lanes.every(lane => lane.members.length <= 2);
    const badge = titleBadge(section.id), titleSize = compact ? 19.5 : 20;
    const titleWidth = width - (badge ? BADGE_SIZE + BADGE_GAP : 0);
    const title = wrap(points ? "本月积分榜" : section.title, titleSize, titleWidth);
    const subtitle = section.type === "honor" && section.subtitle ? wrap(section.subtitle, 14, width) : [];
    const heading = 12 + title.length * 27 + subtitle.length * 19 + 8;
    const contentHeight = podium ? podiumLayout(lanes, width) : entriesLayout(lanes, section, width, compact);
    return { title, titleWidth, titleSize, subtitle, badge, heading, lanes, podium, compact,
      width, height: heading + contentHeight + (points ? 20 : 10) };
  }
  function moveLane(lane, dx, dy) {
    lane.x += dx;
    lane.top += dy;
    for (const tile of lane.tiles) tile.y += dy;
  }
  // Only reveal a whole avatar and nickname if it fits in the space beside the other column.
  function revealPlayers(lanes, spare) {
    if (spare <= 0) return 0;
    let used = 0;
    for (const lane of lanes) {
      moveLane(lane, 0, used);
      if (!lane.folded) continue;
      for (const row of lane.members.slice(0, PREVIEW_LIMIT)) {
        const tile = playerTile(row, COMPACT_AVATAR, 15, lane.width);
        const step = tile.height + PLAYER_GAP;
        if (used + step > spare) break;
        lane.tiles.push({ ...tile, x: 0, y: lane.top + lane.height });
        lane.height += step;
        used += step;
      }
    }
    return used;
  }
  function balanceColumns(left, right) {
    const heightOf = lanes => lanes.reduce((sum, lane) => sum + lane.height, 0);
    const a = heightOf(left), b = heightOf(right);
    const bothSummaries = left.length === 1 && right.length === 1 && left[0].folded && right[0].folded;
    const height = Math.max(a, b) + (bothSummaries ? TWO_PLAYERS : 0);
    return Math.max(a + revealPlayers(left, height - a), b + revealPlayers(right, height - b));
  }
  // A final odd board can use both columns for its ranks. With just one rank, put the title beside it.
  function lastBoard(section) {
    const box = sectionLayout(section, COL), lanes = box.lanes;
    if (!lanes.length) return box;
    box.divider = true;
    if (lanes.length === 1) {
      const lane = lanes[0], titleHeight = box.heading;
      if (lane.folded) revealPlayers(lanes, Math.max(TWO_PLAYERS, titleHeight - lane.height));
      moveLane(lane, COL + GUTTER, 12);
      box.height = Math.max(titleHeight, lane.top + lane.height + 10);
      box.heading = 0;
      return box;
    }
    const total = lanes.reduce((sum, lane) => sum + lane.height, 0);
    let split = 1;
    for (let i = 2; i < lanes.length; i++) {
      if (Math.abs(total / 2 - lanes[i].top) < Math.abs(total / 2 - lanes[split].top)) split = i;
    }
    const left = lanes.slice(0, split), right = lanes.slice(split);
    const offset = right[0].top;
    for (const lane of right) moveLane(lane, COL + GUTTER, -offset);
    box.height = box.heading + balanceColumns(left, right) + 10;
    return box;
  }
  function chapterOf(section) {
    if (section.groupTitle === "综合榜单") return section.id === "points" ? "" : "胜率与场次";
    return section.groupTitle;
  }
  function layout(card) {
    let y = HERO, previous = "";
    const sections = [];
    for (let index = 0; index < card.sections.length; index++) {
      const section = card.sections[index], neighbor = card.sections[index + 1];
      const paired = section.id !== "points" && neighbor && neighbor.id !== "points";
      const title = chapterOf(section), nextTitle = paired ? chapterOf(neighbor) : title;
      const mixed = title !== nextTitle;
      const chapter = title === previous ? "" : title, groupTop = y;
      if (chapter || mixed) y += mixed ? 36 : 42;
      if (paired) {
        const left = sectionLayout(section, COL), right = sectionLayout(neighbor, COL);
        const heading = Math.max(left.heading, right.heading);
        const height = heading + balanceColumns(left.lanes, right.lanes) + 10;
        for (const box of [left, right]) { box.heading = heading; box.height = height; }
        sections.push({ section, box: left, x: M, top: y, groupTop, chapter, mixed, caption: mixed ? title : chapter },
          { section: neighbor, box: right, x: M + COL + GUTTER, top: y, groupTop, mixed,
            chapter: mixed ? nextTitle : "", caption: mixed ? nextTitle : "", rightPanel: true });
        y += height;
        index++;
      } else {
        const box = section.id === "points" ? sectionLayout(section) : lastBoard(section);
        sections.push({ section, box, x: M, top: y, chapter, caption: chapter, groupTop });
        y += box.height;
      }
      previous = nextTitle;
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
            ...bounds(left + lane.peopleX, y + lane.top, lane.countWidth, lane.countHeight) });
        }
        for (const [offset, tile] of lane.tiles.entries()) {
          const row = tile.row, publicId = boards[index].rows[lane.start + offset].publicId;
          targets.push({ key: section.id + "/" + publicId, publicId,
            label: section.title + "，" + (row.tied ? "并列" : "") + "第" + row.rank + "名，" + row.name + "，" + row.value + section.unit + "，查看玩家战绩",
            ...bounds(left + tile.x, y + tile.y, tile.diameter, tile.diameter) });
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
    for (const { box } of layout(card).sections) {
      if (box.badge) paths.add(box.badge);
      for (const lane of box.lanes) {
        for (const { row } of lane.tiles) if (row.avatar) paths.add(row.avatar);
      }
    }
    return [...paths];
  }
  function describe(card) {
    return [card.month + " 月度战报", "完整长图", ...layout(card).sections.flatMap(({section, box}) => [section.title,
      ...box.lanes.flatMap(lane => lane.folded
        ? [place(lane) + "，" + lane.members.length + " 位玩家，各 " + lane.members[0].value + section.unit, ...lane.tiles.map(tile => tile.row.name)]
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
    const numberWidth = Math.min(measured(ctx, row.value, size), limit - unitWidth - gap - (each ? 16 : 0));
    const total = numberWidth + unitWidth + gap;
    const left = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = ink;
    ctx.fillText(row.value, left, y, numberWidth);
    if (each) p.text("各", left - 16, y + (size - unitSize) * .82, unitSize, color.muted, 15);
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
  function drawPeople(ctx, p, lane, x, y, images, fontSize, lineHeight) {
    for (const tile of lane.tiles) {
      const ax = x + tile.x, ay = y + tile.y, tx = ax + tile.diameter + 6;
      avatar(ctx, p, tile.row, ax, ay, tile.diameter, images);
      p.lines(tile.nameLines, tx, ay + tile.textTop, fontSize, color.text, tile.labelWidth, lineHeight, 600);
      if (tile.sampleLines?.length) p.lines(tile.sampleLines, tx, ay + tile.textTop + tile.nameLines.length * lineHeight,
        12, color.muted, tile.labelWidth, 15);
    }
  }
  function drawEntry(ctx, p, section, box, lane, x, y, images) {
    const compact = box.compact, top = y + lane.top, right = x + lane.width;
    const mid = top + (lane.folded ? lane.countHeight : lane.height) / 2;
    if (!compact && lane.top) p.line(x, top, right, color.line);
    if (lane.groupHeader) {
      const left = x + (lane.folded ? 0 : 12), labelY = lane.folded ? mid - 8 : top + 8;
      const rank = place(lane) + " · ", result = "各 " + lane.members[0].value + " " + section.unit;
      const labelWidth = lane.folded ? x + lane.peopleX - left - 7 : right - left;
      p.font(14, 500);
      const rankWidth = Math.min(measured(ctx, rank, 14), labelWidth * .55);
      p.text(rank, left, labelY, 14, lane.folded ? color.muted : color.text, rankWidth, "left", 500);
      p.text(result, left + rankWidth, labelY, 14, lane.rank === 1 ? color.gold : color.muted,
        labelWidth - rankWidth, "left", 600);
      if (!lane.folded) p.rect(left - 12, top + 6, 2, lane.height - 12, "#776b50");
    } else {
      p.text(place(lane), compact ? right : x, compact ? mid + 5 : mid - 8,
        compact ? 12 : 14, !compact && lane.rank === 1 ? color.gold : color.muted, 73, compact ? "right" : "left");
      const size = compact ? 21 : 22;
      score(ctx, p, lane.members[0], section.unit, right, compact ? mid - 19 : mid - size / 2,
        size, lane.scoreWidth, "right", lane.each);
    }
    if (lane.folded) {
      p.text(lane.members.length + " 位玩家", x + lane.peopleX, mid - 8, 15, color.text, lane.countWidth - 12, "left", 600);
    }
    drawPeople(ctx, p, lane, x, y, images, compact ? 15 : 16, 20);
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
    for (const { section, box, x, top, caption, mixed, groupTop, rightPanel } of page.sections) {
      if (caption) {
        const size = mixed ? 21 : 28, width = mixed ? COL : INNER;
        p.text(caption, x, groupTop + 9, size, color.gold, width, "left", 600, true);
        const start = x + measured(ctx, caption, size) + 10;
        if (start < x + width) p.line(start, groupTop + (mixed ? 20 : 25), x + width, "#53605d");
      }
      if (rightPanel) p.rect(x - GUTTER / 2, top + 12, 1, box.height - 24, color.line);
      else if (!caption && top > HERO) p.line(M, top, W - M, color.line);
      if (box.divider) p.rect(x + COL + GUTTER / 2, top + box.heading + 6, 1, box.height - box.heading - 16, color.line);
      box.title.forEach((line, i) => p.text(line, x, top + 15 + i * 27,
        box.titleSize, color.text, box.titleWidth, "left", 600));
      const badge = box.badge && images.get(box.badge);
      if (badge?.width && badge.height) {
        const last = box.title.length - 1, end = Math.min(box.titleWidth, measured(ctx, box.title[last], box.titleSize));
        ctx.drawImage(badge, x + end + BADGE_GAP, top + 11 + last * 27, BADGE_SIZE, BADGE_SIZE);
      }
      p.lines(box.subtitle, x, top + 12 + box.title.length * 27, 14, color.muted, box.width, 19);
      for (const lane of box.lanes) {
        const lx = x + lane.x, ly = top + box.heading;
        if (box.podium) drawPodium(ctx, p, section, lane, lx, ly, images);
        else drawEntry(ctx, p, section, box, lane, lx, ly, images);
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
