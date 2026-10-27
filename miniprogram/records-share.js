const cover = "/assets/share-cover.jpg";
const panels = {
  records: { title: "用桌边助手，记录阿瓦隆战绩", label: "战绩统计", heading: "每一局，都有迹可循", description: "回顾自己的胜率、阵营表现与常玩角色，留住每次同桌的成长。" },
  matches: { title: "每一局阿瓦隆，都值得记下来", label: "对局记录", heading: "同桌的故事，值得回顾", description: "按时间、玩法、角色和胜负查找自己的记录，重温牌桌上的关键时刻。" },
  fun: { title: "阿瓦隆的名场面，都在这里", label: "趣味记录", heading: "胜负之外，还有名场面", description: "躲过的刀、打出的配合和意外的反转，汇成属于自己的趣味记录。" },
};

function tabFor(tab) { return Object.prototype.hasOwnProperty.call(panels, tab) ? tab : "records"; }
function friendContent(tab, snapshot) {
  tab = tabFor(tab);
  if (validId(snapshot?.id)) return { title: snapshot.title, path: "/pages/shared/shared?share=" + snapshot.id, imageUrl: cover };
  return { title: panels[tab].title, path: "/pages/shared/shared?intro=" + tab, imageUrl: cover };
}
function timelineContent(tab, snapshot) {
  tab = tabFor(tab);
  if (validId(snapshot?.id)) return { title: snapshot.title, query: "share=" + snapshot.id, imageUrl: cover };
  return { title: panels[tab].title, query: "intro=" + tab, imageUrl: cover };
}
function introFor(tab) { return Object.prototype.hasOwnProperty.call(panels, tab) ? panels[tab] : null; }
const validId = value => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
function isSharedEntry(options = {}) {
  const path = String(options.path || "").replace(/^\//, "");
  return path === "pages/shared/shared" || ["pages/stats/stats", "pages/matches/matches"].includes(path)
    && ["share", "intro"].some(key => Object.prototype.hasOwnProperty.call(options.query || {}, key));
}
async function create(selection) {
  const api = require("./api");
  await api.login();
  return api.request("/api/me/shares", "POST", selection);
}
function read(id) {
  if (!validId(id)) return Promise.reject(new Error("分享链接无效，请让好友重新分享。"));
  // A Moments single page has no login or shared storage. Do not use api.request.
  const connection = require("./page-connection"), observation = connection.begin("/api/shares/" + id);
  return new Promise((resolve, reject) => wx.request({
    url: require("./api").assetUrl("/api/shares/" + id), method: "GET", timeout: 10000,
    success(response) {
      if (response.statusCode === 200) resolve(response.data);
      else reject(Object.assign(new Error(response.data?.error || "分享暂时无法读取，请稍后重试。"), { status: response.statusCode }));
    },
    fail: () => reject(new Error("分享暂时无法读取，请检查网络后重试。")),
  })).then(value => { connection.finish(observation);return value; }, error => { connection.finish(observation, error);throw error; });
}
function isSinglePage(options) {
  if (typeof options?.scene === "number") return options.scene === 1154;
  if (typeof wx === "undefined") return false;
  const entry = wx.getEnterOptionsSync?.() || wx.getLaunchOptionsSync?.();
  return entry?.scene === 1154;
}

module.exports = { friendContent, timelineContent, introFor, isSinglePage, isSharedEntry, validId, create, read };
