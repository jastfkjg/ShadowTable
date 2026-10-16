// Shared Canvas 2D primitives for the native PNG exporter and the web month report.
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtablePosterCanvas = value;
})(typeof window === "object" ? window : this, function () {
  const WIDTH = 1080, HEIGHT = 1920, LEFT = 72, RIGHT = 1008;
  const BACKGROUND_PATH = "/assets/monthly-report-background.jpg";
  const colors = { bg: "#101c24", surface: "#1b2b35", control: "#14232c", text: "#f2eee5", muted: "#b1bfc6", gold: "#e5c68b", good: "#a3dfbe", evil: "#f2b6ae", line: "rgba(177,191,198,.18)" };
  const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  // Conservative glyph advances keep pagination identical before a native canvas exists.
  // Draw the same prepared lines at a fixed font size; names never lose an ellipsis tail.
  function width(value, size) {
    return Array.from(clean(value)).reduce((sum, char) => sum + size * (
      /\s/.test(char) ? .38 : /[MW@%#&]/.test(char) ? .98 : /[ilI1.,:;'!|]/.test(char) ? .42 :
      /[A-Z]/.test(char) ? .8 : /[a-z0-9+\-/()]/.test(char) ? .7 : char.codePointAt(0) > 0xffff ? 1.18 : 1.06), 0);
  }
  function wrap(value, size, limit) {
    const lines = []; let line = "";
    for (const char of Array.from(clean(value))) {
      if (line && width(line + char, size) > limit) { lines.push(line); line = ""; }
      line += char;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }
  function painter(ctx) {
    const font = (size, weight = 400, serif = false) => { ctx.font = weight + " " + size + "px " + (serif ? "'Songti SC', 'STSong', serif" : "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"); };
    const text = (value, x, y, size = 30, color = colors.text, limit = 936, align = "left", weight = 400, serif = false) => {
      font(size, weight, serif); ctx.textAlign = align; ctx.textBaseline = "top"; ctx.fillStyle = color;
      ctx.fillText(clean(value), x, y, limit);
    };
    const lines = (rows, x, y, size, color, limit, step = size * 1.5, weight = 400, align = "left") => rows.forEach((row, i) => text(row, x, y + i * step, size, color, limit, align, weight));
    const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    const line = (x, y, end, color = colors.line, thickness = 1) => { ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(end, y); ctx.stroke(); };
    const round = (x, y, w, h, radius = 24, color = colors.surface) => {
      if (typeof ctx.quadraticCurveTo !== "function") return rect(x, y, w, h, color);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius); ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h); ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath(); ctx.fill();
    };
    const avatar = (row, x, y, size, images, outline = false) => {
      const source = images.get(row.avatar);
      ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
      rect(x, y, size, size, "#2a3a45");
      if (source?.width && source?.height) {
        const side = Math.min(source.width, source.height);
        ctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, x, y, size, size);
      } else text(Array.from(row.name || "友")[0], x + size / 2, y + size * .19, size * .52, colors.muted, size * .9, "center");
      ctx.restore();
      if (outline) { ctx.strokeStyle = colors.gold; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.stroke(); }
    };
    const icon = (kind, x, y, size = 32, color = colors.gold) => {
      ctx.save(); ctx.translate?.(x, y); ctx.scale?.(size / 24, size / 24); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.lineCap = "round";
      const path = points => { ctx.beginPath(); points.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.stroke(); };
      if (kind === "crown") { path([[3,6],[7,11],[12,4],[17,11],[21,6],[18,19],[6,19],[3,6]]); path([[6,22],[18,22]]); }
      else if (kind === "shield") path([[12,2],[20,6],[19,15],[12,22],[5,15],[4,6],[12,2]]);
      else if (kind === "medal") { ctx.beginPath(); ctx.arc(12, 8, 6, 0, Math.PI * 2); ctx.stroke(); path([[8,14],[6,22],[12,19],[18,22],[16,14]]); }
      else if (kind === "moon") { ctx.beginPath(); ctx.arc(12, 12, 9, .2, Math.PI * 1.65); ctx.stroke(); path([[17,4],[11,10],[11,15],[20,16]]); }
      else if (kind === "swords") { path([[4,3],[19,20]]); path([[20,3],[5,20]]); path([[12,17],[18,12]]); path([[6,12],[12,18]]); }
      else path([[12,3],[14,9],[21,12],[14,15],[12,21],[9,15],[3,12],[9,9],[12,3]]);
      ctx.restore();
    };
    const gradient = (x, y, x2, y2, stops) => {
      const paint = ctx.createLinearGradient?.(x, y, x2, y2);
      if (!paint?.addColorStop) return stops[stops.length - 1][1];
      stops.forEach(([at, color]) => paint.addColorStop(at, color)); return paint;
    };
    const background = (height, images, personal = false) => {
      rect(0, 0, WIDTH, height, colors.bg);
      const art = images.get(BACKGROUND_PATH);
      if (art?.width && art?.height) {
        ctx.save(); ctx.globalAlpha = personal ? .32 : .88;
        ctx.drawImage(art, 0, 0, art.width, Math.min(art.height, art.width * 462 / WIDTH), 0, 0, WIDTH, 462); ctx.restore();
        rect(0, 0, WIDTH, 462, gradient(0, 0, WIDTH, 0, [[0, colors.bg], [.3, "rgba(16,28,36,.8)"], [.8, "rgba(16,28,36,.02)"]]));
        rect(0, 300, WIDTH, 162, gradient(0, 300, 0, 462, [[0, "rgba(16,28,36,0)"], [1, colors.bg]]));
      }
    };
    const brand = tag => { text("桌边助手", LEFT, 48, 26, colors.text, 180, "left", 500); text("ShadowTable", LEFT + 152, 53, 21, colors.muted, 230); text(tag, RIGHT, 53, 20, colors.gold, 340, "right"); };
    const footer = (height, note, asOf, page = "") => {
      const top = height - 138; line(LEFT, top, RIGHT);
      text("桌边助手", LEFT, top + 28, 24, colors.text, 480, "left", 500);
      text(note, LEFT, top + 68, 20, colors.muted, 580);
      text("截至 " + asOf, RIGHT, top + 29, 20, colors.muted, 350, "right");
      text(page || "ShadowTable", RIGHT, top + 68, 20, page ? colors.gold : colors.muted, 260, "right");
    };
    return { font, text, lines, rect, line, round, avatar, icon, background, brand, footer };
  }
  return { WIDTH, HEIGHT, LEFT, RIGHT, BACKGROUND_PATH, colors, clean, width, wrap, painter };
});
