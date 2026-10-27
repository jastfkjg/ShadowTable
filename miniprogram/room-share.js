const { width, height, assets, drawCover, renderCover } = require("./share-cover");

function shareContent(room, imageUrl = "/assets/share-cover.jpg") {
  if (!room) return { title: "桌边助手 · 一起入座", path: "/pages/lobby/lobby", imageUrl };
  const game = String(room.boardName || "阿瓦隆").split(/\s*·\s*/)[0];
  return {
    title: `${room.me.name}邀你加入${game} · 房间 ${room.code}`,
    path: `/pages/table/table?code=${room.code}&instance=${room.createdAt || 0}`,
    imageUrl,
  };
}

function coverContent(room) {
  const parts = String(room.boardName || "阿瓦隆").split(/\s*·\s*/);
  return { title: parts[0] || "阿瓦隆", subtitle: parts.slice(1).join(" · ") || "与朋友同桌",
    label: "房间号", hero: String(room.code), footer: "点击卡片 · 一起入座" };
}

function drawRoomCover(ctx, room, images = {}) { drawCover(ctx, coverContent(room), images); }
function renderRoomCover(page, room) { return renderCover(page, coverContent(room), "#room-share-canvas"); }

module.exports = { shareContent, coverContent, drawRoomCover, renderRoomCover, width, height, assets };
