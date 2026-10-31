const api = require("./api");
const { renderDimensions, drawCard, imagePaths } = require("./share-card");

function canvasFor(page, selector) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("画布暂时不可用，请重试。")), 5000);
    wx.createSelectorQuery().in(page.coverOwner || page).select(selector).fields({ node: true, size: true }).exec(result => {
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
    try { image.src = path.startsWith("/assets/") || /^https?:\/\//.test(path) ? path : api.assetUrl(path); } catch { done(null); }
  });
}
async function renderImage(page, card, options = {}) {
  const renderer = options.renderer || { renderDimensions, drawCard, imagePaths };
  const canvas = await canvasFor(page, options.selector || "#share-canvas");
  const { width, height, scale } = renderer.renderDimensions(card);
  canvas.width = width; canvas.height = height;
  const paths = renderer.imagePaths(card);
  const avatars = new Map(await Promise.all(paths.map(async path => [path, await avatarFor(canvas, path)])));
  if (!page.alive) return null;
  const context = canvas.getContext("2d");
  context.save();
  try {
    if (scale !== 1) context.scale(scale, scale);
    renderer.drawCard(context, card, avatars.get(card.avatar), avatars);
  } finally { context.restore(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("图片生成超时，请重试。")), 10000);
    // Export the whole bitmap. Source crop dimensions use the canvas's displayed
    // size in WeChat; backing-pixel dimensions would crop a scaled long poster.
    wx.canvasToTempFilePath({ canvas, destWidth: width, destHeight: height, fileType: "png",
      success: result => { clearTimeout(timer); resolve(result.tempFilePath); },
      fail: () => { clearTimeout(timer); reject(new Error("图片生成失败，请重试。")); },
    }, page);
  });
}
module.exports = { renderImage };
