const { drawCover, renderCover } = require("./share-cover");
const shares = require("./records-share");
const number = value => Number.isFinite(value) ? String(value) : "—";
const rate = value => Number.isFinite(value) ? value + "%" : "—";

function coverContent(tab, snapshot) {
  const intro = shares.introFor(tab) || shares.introFor("records");
  const footer = "点击卡片 · 查看记录";
  if (!shares.validId(snapshot?.id)) return { title: intro.label, subtitle: "阿瓦隆 · 与朋友同桌",
    label: "", hero: "一起入座", footer };
  const data = snapshot.data || {}, name = String(snapshot.player?.name || "好友");
  const game = String(data.boardName || data.records?.[0]?.boardName || "阿瓦隆").split(/\s*·\s*/)[0];
  const owner = `${name}的${game}`;
  switch (snapshot.kind) {
    case "stats": return { title: "战绩统计", subtitle: owner + "战绩", label: "总胜率", hero: rate(data.winRate),
      detail: `${number(data.total)} 局 · ${number(data.wins)} 胜 ${number(data.losses)} 负`, footer };
    case "matches": return { title: "对局记录", subtitle: owner + "对局", label: "当前范围的对局", hero: number(data.total) + " 局",
      detail: data.scope, footer };
    case "funSummary": return { title: "趣味记录", subtitle: owner + "名场面", label: "有次数的趣味记录", hero: number(data.recorded) + " 项",
      detail: `${number(data.total)} 项记录 · ${number(data.known)} 项有完整记录`, footer };
    case "match": return { title: "对局记录", subtitle: data.boardName || game, label: "本人结果",
      hero: ({ win: "获胜", loss: "失利", excluded: "未计入" })[data.outcome] || "未记录",
      detail: `${name} · ${data.role || "角色未记录"}`, footer };
    case "fun": return { title: "趣味记录", subtitle: data.label || "同桌的名场面", label: `${name} · ${data.modeLabel || game}`,
      hero: number(data.count) + (data.unit || ""),
      detail: data.countOnly ? data.roleLabel : `${data.rateName || "成功率"} ${rate(data.rate)}`, footer };
    default: return { title: intro.label, subtitle: owner, label: "", hero: "一起入座", footer };
  }
}

function prepare(page, tab, snapshot) {
  if (!page.alive || !page.shareCanvasReady) return null;
  const content = coverContent(tab, snapshot), key = JSON.stringify(content);
  if (page.recordCover?.key === key) return page.recordCover;
  const previous = page.recordCoverRender || Promise.resolve();
  const cover = { key, path: null };
  page.recordCover = cover;
  cover.promise = previous.then(() => page.alive && page.recordCover === cover ? renderCover(page, content) : null).then(path => {
    if (page.alive && page.recordCover === cover) cover.path = path;
    return path;
  }).catch(() => null);
  page.recordCoverRender = cover.promise;
  return cover;
}

function friendContent(page, tab, snapshot) {
  const cover = prepare(page, tab, snapshot), content = shares.friendContent(tab, snapshot, cover?.path || undefined);
  return cover?.promise ? { ...content, promise: cover.promise.then(path => shares.friendContent(tab, snapshot, path || undefined)) } : content;
}
function timelineContent(page, tab, snapshot) {
  const cover = prepare(page, tab, snapshot);
  return shares.timelineContent(tab, snapshot, cover?.path || undefined);
}
function drawRecordCover(ctx, tab, snapshot, images) { drawCover(ctx, coverContent(tab, snapshot), images); }

module.exports = { coverContent, prepare, friendContent, timelineContent, drawRecordCover };
