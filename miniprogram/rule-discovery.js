// Public rule metadata only. Never include room, player or invitation parameters.
const cover = "/assets/share-cover.jpg";
function boardMetadata(source, board) {
  const label = board.title.replace(new RegExp("^" + board.capacity + "人\\s*"), "");
  const heading = `阿瓦隆 · ${label} · ${board.capacity}人规则`;
  return {
    title: heading + "｜桌边助手",
    query: `board=${encodeURIComponent(source.id)}&capacity=${board.capacity}`,
  };
}
function helpMetadata(scoringOnly = false) {
  return {
    heading: scoringOnly ? "阿瓦隆计分规则" : "阿瓦隆怎么玩",
    title: (scoringOnly ? "阿瓦隆计分规则" : "阿瓦隆新手入门与玩法规则") + "｜桌边助手",
    query: scoringOnly ? "section=scoring" : "",
  };
}
function share(route, metadata) {
  return { title: metadata.title, path: route + (metadata.query ? "?" + metadata.query : ""), imageUrl: cover };
}
module.exports = { boardMetadata, helpMetadata, share };
