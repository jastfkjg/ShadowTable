const cover = "/assets/share-cover.jpg";
const panels = {
  records: { title: "阿瓦隆战绩分享" },
  matches: { title: "阿瓦隆对局分享" },
  fun: { title: "阿瓦隆趣味成绩分享" },
};

function tabFor(tab) { return Object.prototype.hasOwnProperty.call(panels, tab) ? tab : "records"; }
function friendContent(tab, snapshot) {
  tab = tabFor(tab);
  if (snapshot) return { title: snapshot.title, path: "/pages/shared/shared?share=" + snapshot.id, imageUrl: cover };
  return { title: panels[tab].title, path: "/pages/shared/shared?share=", imageUrl: cover };
}
function timelineContent(tab, snapshot) {
  tab = tabFor(tab);
  if (snapshot) return { title: snapshot.title, query: "share=" + snapshot.id, imageUrl: cover };
  return { title: panels[tab].title, query: "share=", imageUrl: cover };
}
const validId = value => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
function isSharedEntry(options = {}) {
  const path = String(options.path || "").replace(/^\//, "");
  return path === "pages/shared/shared" || ["pages/stats/stats", "pages/matches/matches"].includes(path)
    && Object.prototype.hasOwnProperty.call(options.query || {}, "share");
}
async function create(selection) {
  const api = require("./api");
  await api.login();
  return api.request("/api/me/shares", "POST", selection);
}
function read(id) {
  if (!validId(id)) return Promise.reject(new Error("分享链接无效，请让好友重新分享。"));
  // A Moments single page has no login or shared storage. Do not use api.request.
  return new Promise((resolve, reject) => wx.request({
    url: require("./api").assetUrl("/api/shares/" + id), method: "GET", timeout: 10000,
    success(response) {
      if (response.statusCode === 200) resolve(response.data);
      else reject(Object.assign(new Error(response.data?.error || "分享暂时无法读取，请稍后重试。"), { status: response.statusCode }));
    },
    fail: () => reject(new Error("分享暂时无法读取，请检查网络后重试。")),
  }));
}
function isSinglePage(options) {
  if (typeof options?.scene === "number") return options.scene === 1154;
  if (typeof wx === "undefined") return false;
  const entry = wx.getEnterOptionsSync?.() || wx.getLaunchOptionsSync?.();
  return entry?.scene === 1154;
}

module.exports = { friendContent, timelineContent, isSinglePage, isSharedEntry, validId, create, read };
