const width = 600, height = 480;

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
  let text = value;
  while (text.length && ctx.measureText(text).width > maximum) text = text.slice(0, -1);
  if (text !== value) {
    while (text.length && ctx.measureText(text + "…").width > maximum) text = text.slice(0, -1);
    text += "…";
  }
  return text;
}

function drawRoomCover(ctx, room) {
  ctx.fillStyle = "#131e25";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#53616a";
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, width - 48, height - 48);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#e2c993";
  ctx.font = "500 22px sans-serif";
  ctx.fillText("桌边助手  /  一起入座", 52, 53);
  ctx.fillStyle = "#efece4";
  ctx.font = "600 32px sans-serif";
  const parts = room.boardName.split(" · ");
  ctx.fillText(fitText(ctx, parts[0], 496), 52, 116);
  ctx.font = "24px sans-serif";
  ctx.fillStyle = "#b5c0c6";
  ctx.fillText(fitText(ctx, parts.slice(1).join(" · ") || "与朋友同桌", 496), 52, 165);
  ctx.font = "20px sans-serif";
  ctx.fillText("房间", 52, 232);
  ctx.fillStyle = "#efece4";
  ctx.font = "600 72px sans-serif";
  ctx.fillText(room.code, 48, 263);
  ctx.fillStyle = "#e2c993";
  ctx.fillRect(52, 365, 496, 62);
  ctx.fillStyle = "#131e25";
  ctx.font = "600 25px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("点击进入房间", width / 2, 383);
  ctx.textAlign = "left";
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
  drawRoomCover(canvas.getContext("2d"), room);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("分享图片生成超时")), 5000);
    wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width, height, destWidth: width, destHeight: height, fileType: "png",
      success: result => { clearTimeout(timer); resolve(result.tempFilePath); },
      fail: () => { clearTimeout(timer); reject(new Error("分享图片暂不可用")); },
    }, page);
  });
}

module.exports = { shareContent, drawRoomCover, renderRoomCover, width, height };
