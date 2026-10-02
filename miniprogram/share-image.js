const api = require("./api");
const { SIZE, drawCard } = require("./share-card");

function canvasFor(page) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("画布暂时不可用，请重试。")), 5000);
    wx.createSelectorQuery().in(page).select("#share-canvas").fields({ node: true, size: true }).exec(result => {
      clearTimeout(timer);
      const canvas = result?.[0]?.node;
      canvas ? resolve(canvas) : reject(new Error("当前微信无法生成图片，请更新微信后重试。"));
    });
  });
}
function avatarFor(canvas, path) {
  if (!path) return Promise.resolve(null);
  return new Promise(resolve => {
    let image;
    try { image = canvas.createImage(); } catch { resolve(null); return; }
    const done = value => { clearTimeout(timer); image.onload = image.onerror = null; resolve(value); };
    const timer = setTimeout(() => done(null), 3000);
    image.onload = () => done(image.width && image.height ? image : null);
    image.onerror = () => done(null);
    try { image.src = api.assetUrl(path); } catch { done(null); }
  });
}
async function renderImage(page, card) {
  const canvas = await canvasFor(page);
  canvas.width = SIZE; canvas.height = SIZE;
  const avatar = await avatarFor(canvas, card.avatar);
  if (!page.alive) return null;
  drawCard(canvas.getContext("2d"), card, avatar);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("图片生成超时，请重试。")), 10000);
    wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width: SIZE, height: SIZE, destWidth: SIZE, destHeight: SIZE, fileType: "png",
      success: result => { clearTimeout(timer); resolve(result.tempFilePath); },
      fail: () => { clearTimeout(timer); reject(new Error("图片生成失败，请重试。")); },
    }, page);
  });
}
module.exports = { renderImage };
