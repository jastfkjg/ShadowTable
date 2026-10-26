const width = 1000, height = 800;
const assets = { background: "/assets/room-share-background.jpg", brand: "/assets/room-share-brand.png" };
const serif = '"Songti SC", "STSong", "Noto Serif CJK SC", serif';

function shareContent(room, imageUrl = "/assets/share-cover.jpg") {
  if (!room) return { title: "桌边助手 · 一起入座", path: "/pages/lobby/lobby", imageUrl };
  const game = room.boardName.split(" · ")[0];
  return {
    title: `${room.me.name}邀你加入${game} · 房间 ${room.code}`,
    path: `/pages/table/table?code=${room.code}&instance=${room.createdAt || 0}`,
    imageUrl,
  };
}

function fitText(ctx, value, maximum) {
  const characters = Array.from(value);
  while (characters.length && ctx.measureText(characters.join("")).width > maximum) characters.pop();
  if (characters.length < Array.from(value).length) {
    while (characters.length && ctx.measureText(characters.join("") + "…").width > maximum) characters.pop();
    return characters.join("") + "…";
  }
  return value;
}

function boardLines(ctx, value, maximum) {
  let first = "";
  const characters = Array.from(value);
  while (characters.length && ctx.measureText(first + characters[0]).width <= maximum) first += characters.shift();
  return characters.length ? [first, fitText(ctx, characters.join(""), maximum)] : [first];
}

function drawRoomCover(ctx, room, images = {}) {
  ctx.save();
  ctx.fillStyle = "#101c24";
  ctx.fillRect(0, 0, width, height);
  if (images.background) ctx.drawImage(images.background, 0, 0, width, height);
  // Keep dynamic text readable against both the artwork and the plain fallback.
  const shade = ctx.createLinearGradient(0, 0, 900, 0);
  shade.addColorStop(0, "rgba(5, 12, 18, .12)");
  shade.addColorStop(.7, "rgba(5, 12, 18, .16)");
  shade.addColorStop(1, "rgba(5, 12, 18, 0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, 540);
  const gold = ctx.createLinearGradient(0, 100, 0, 530);
  gold.addColorStop(0, "#fff0c5");
  gold.addColorStop(.5, "#e9bd72");
  gold.addColorStop(1, "#ffe2a3");
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (images.brand) {
    ctx.save();
    ctx.beginPath(); ctx.arc(206, 60, 20, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(images.brand, 186, 40, 40, 40);
    ctx.restore();
  }
  ctx.fillStyle = "#f5d99d";
  ctx.font = `500 30px ${serif}`;
  ctx.fillText("桌边助手", images.brand ? 240 : 190, 44);
  const parts = String(room.boardName || "阿瓦隆").split(/\s*·\s*/);
  const game = parts[0] || "阿瓦隆", board = parts.slice(1).join(" · ") || "与朋友同桌";
  let titleSize = 136;
  ctx.font = `600 ${titleSize}px ${serif}`;
  while (ctx.measureText(game).width > 650 && titleSize > 56) {
    titleSize -= 4;
    ctx.font = `600 ${titleSize}px ${serif}`;
  }
  ctx.fillStyle = gold;
  ctx.shadowColor = "rgba(0, 0, 0, .5)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillText(fitText(ctx, game, 650), 186, 102);
  ctx.font = `500 44px ${serif}`;
  ctx.fillStyle = "#f6e7c8";
  const lines = boardLines(ctx, board, 590);
  lines.forEach((line, index) => ctx.fillText(line, 190, 268 + index * 50));
  const roomTop = lines.length > 1 ? 369 : 339;
  ctx.font = "500 27px sans-serif";
  ctx.fillStyle = "#e9d5ae";
  ctx.fillText("房间", 194, roomTop);
  ctx.font = `600 118px ${serif}`;
  ctx.fillStyle = gold;
  ctx.fillText(String(room.code), 186, roomTop + 34);
  ctx.font = `500 29px ${serif}`;
  ctx.fillStyle = "#f6e7c8";
  ctx.textAlign = "center";
  ctx.fillText("点击卡片 · 一起入座", 485, 730);
  ctx.strokeStyle = "#f5d99d";
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(654, 735); ctx.lineTo(665, 746); ctx.lineTo(654, 757); ctx.stroke();
  ctx.restore();
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

async function renderRoomCover(page, room) {
  if (!wx.createSelectorQuery || !wx.canvasToTempFilePath) return null;
  const canvas = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("分享画布暂不可用")), 5000);
    wx.createSelectorQuery().in(page).select("#room-share-canvas").fields({ node: true, size: true }).exec(result => {
      clearTimeout(timer);
      const node = result?.[0]?.node;
      node ? resolve(node) : reject(new Error("分享画布暂不可用"));
    });
  });
  if (!page.alive) return null;
  canvas.width = width;
  canvas.height = height;
  const [background, brand] = await Promise.all([loadImage(canvas, assets.background), loadImage(canvas, assets.brand)]);
  if (!page.alive) return null;
  drawRoomCover(canvas.getContext("2d"), room, { background, brand });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("分享图片生成超时")), 5000);
    wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width, height, destWidth: width, destHeight: height, fileType: "png",
      success: result => { clearTimeout(timer); resolve(result.tempFilePath); },
      fail: () => { clearTimeout(timer); reject(new Error("分享图片暂不可用")); },
    }, page);
  });
}

module.exports = { shareContent, drawRoomCover, renderRoomCover, width, height, assets };
