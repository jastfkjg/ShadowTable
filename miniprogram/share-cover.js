// Keep the crayon illustration text-free; invitations and records use real data.
const width = 1000, height = 800;
const assets = { background: "/assets/room-share-background.jpg" };
const font = '"PingFang SC", "Microsoft YaHei", sans-serif';
const colors = { background: "#101c24", cream: "#f4ead7", gold: "#e6bc75" };
const layout = { left: 64, textWidth: 530, subtitleTop: 285, subtitleHeight: 48 };

function fitText(ctx, value, maximum) {
  const characters = Array.from(String(value ?? ""));
  if (ctx.measureText(characters.join("")).width <= maximum) return characters.join("");
  while (characters.length && ctx.measureText(characters.join("") + "…").width > maximum) characters.pop();
  return characters.join("") + "…";
}

function textLines(ctx, value, maximum) {
  const characters = Array.from(String(value ?? ""));
  let first = "";
  while (characters.length && ctx.measureText(first + characters[0]).width <= maximum) first += characters.shift();
  return characters.length ? [first, fitText(ctx, characters.join(""), maximum)] : [first];
}

function fittedFont(ctx, value, size, minimum, maximum) {
  ctx.font = `700 ${size}px ${font}`;
  while (ctx.measureText(String(value)).width > maximum && size > minimum) {
    size -= 2; ctx.font = `700 ${size}px ${font}`;
  }
}

function drawCover(ctx, content, images = {}) {
  ctx.save();
  try {
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    if (images.background) ctx.drawImage(images.background, 0, 0, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = colors.cream;
    ctx.font = `600 36px ${font}`;
    ctx.fillText("桌边助手", layout.left, 54);
    ctx.strokeStyle = colors.gold;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(64, 108); ctx.lineTo(145, 105); ctx.lineTo(224, 107); ctx.stroke();
    fittedFont(ctx, content.title, 132, 60, layout.textWidth);
    ctx.fillText(fitText(ctx, content.title, layout.textWidth), layout.left, 135);
    ctx.fillStyle = colors.gold;
    ctx.font = `600 40px ${font}`;
    textLines(ctx, content.subtitle, layout.textWidth).forEach((line, index) =>
      ctx.fillText(line, layout.left, layout.subtitleTop + index * layout.subtitleHeight));
    ctx.fillStyle = colors.cream;
    ctx.font = `500 28px ${font}`;
    ctx.fillText(fitText(ctx, content.label, layout.textWidth), layout.left, 410);
    ctx.fillStyle = colors.gold;
    fittedFont(ctx, content.hero, 110, 36, layout.textWidth);
    ctx.fillText(fitText(ctx, content.hero, layout.textWidth), layout.left, 450);
    ctx.fillStyle = colors.cream;
    ctx.font = `500 27px ${font}`;
    if (content.detail) ctx.fillText(fitText(ctx, content.detail, layout.textWidth), layout.left, 570);
    ctx.strokeStyle = colors.cream;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(64, 612); ctx.lineTo(330, 614); ctx.lineTo(580, 611); ctx.stroke();
    ctx.font = `500 29px ${font}`;
    ctx.fillText(fitText(ctx, content.footer, layout.textWidth), layout.left, 634);
  } finally { ctx.restore(); }
}

function loadImage(canvas, path) {
  return new Promise(resolve => {
    let image;
    try { image = canvas.createImage(); } catch { resolve(null); return; }
    const done = value => { clearTimeout(timer); image.onload = image.onerror = null; resolve(value); };
    const timer = setTimeout(() => done(null), 1500);
    image.onload = () => done(image.width && image.height ? image : null);
    image.onerror = () => done(null);
    try { image.src = path; } catch { done(null); }
  });
}

async function renderCover(page, content, selector = "#record-share-canvas") {
  if (!wx.createSelectorQuery || !wx.canvasToTempFilePath) return null;
  const canvas = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("分享画布暂不可用")), 5000);
    wx.createSelectorQuery().in(page.coverOwner || page).select(selector).fields({ node: true, size: true }).exec(result => {
      clearTimeout(timer);
      const node = result?.[0]?.node;
      node ? resolve(node) : reject(new Error("分享画布暂不可用"));
    });
  });
  if (!page.alive) return null;
  canvas.width = width; canvas.height = height;
  const background = await loadImage(canvas, assets.background);
  if (!page.alive) return null;
  drawCover(canvas.getContext("2d"), content, { background });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("分享图片生成超时")), 5000);
    wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width, height, destWidth: width, destHeight: height, fileType: "png",
      success: result => { clearTimeout(timer); resolve(result.tempFilePath); },
      fail: () => { clearTimeout(timer); reject(new Error("分享图片暂不可用")); },
    }, page.coverOwner || page);
  });
}

module.exports = { width, height, assets, layout, fitText, drawCover, renderCover };
