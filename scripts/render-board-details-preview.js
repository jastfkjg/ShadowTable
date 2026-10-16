// Layout projections of the production mini-program templates; native WeChat behavior needs device QA.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs } = require("miniprogram-compiler");
const { BOARDS } = require("../server/engine");
const details = require("../server/board-info");
const presentation = require("../miniprogram/board-detail");
const { decorateBoard } = require("../miniprogram/board-detail-art");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(
  __dirname,
  "../output/playwright/board-detail-implemented",
);
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext(
  "(function(global){" + wxmlToJs(root) + "})(global)",
  context,
);
const safe = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const css = (file) =>
  fs
    .readFileSync(path.join(root, file), "utf8")
    .replace(/@import\s+"([^"]+)";/g, (_, name) =>
      css(path.relative(root, path.resolve(root, path.dirname(file), name))),
    )
    .replace(/^page\s*\{/m, "body {")
    .replace(/(-?[\d.]+)rpx/g, "calc($1 * 100vw / 750)");
function html(node) {
  if (typeof node === "string" || typeof node === "number") return safe(node);
  if (node.tag === "wx-app-nav")
    return html(
      factory("components/app-nav/app-nav.wxml")({
        ...node.attr,
        statusBarHeight: 44,
        navHeight: 44,
        totalHeight: 88,
      }),
    );
  const tag =
    {
      "wx-text": "span",
      "wx-button": "button",
      "wx-image": "img",
      "wx-input": "input",
    }[node.tag] || "div";
  const attrs = Object.entries(node.attr || {})
    .flatMap(([key, value]) => {
      if (key === "src" && value.startsWith("/"))
        value = "/miniprogram" + value;
      if (key.startsWith("aria"))
        key = key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      if (key === "style")
        value = String(value).replace(
          /(-?[\d.]+)rpx/g,
          "calc($1 * 100vw / 750)",
        );
      return [
        "class",
        "id",
        "src",
        "style",
        "role",
        "aria-label",
        "aria-selected",
        "aria-expanded",
        "aria-hidden",
        "aria-controls",
        "placeholder",
        "value",
      ].includes(key)
        ? [`${key}="${safe(value)}"`]
        : [];
    })
    .join(" ");
  return `<${tag} ${attrs}>${(node.children || []).map(html).join("")}${["img", "input"].includes(tag) ? "" : `</${tag}>`}`;
}
const styles =
  css("app.wxss") +
  css("components/app-nav/app-nav.wxss") +
  css("pages/board-details/board-details.wxss");
const scenes = {};
for (const source of BOARDS.filter((b) => b.available))
  for (const capacity of source.counts) {
    const board = decorateBoard(presentation.presentBoard(
        { ...source, detail: details[source.id] },
        capacity,
      )),
      selectedGroup = board.groups[0]?.id || "";
    scenes[source.id + "-" + capacity] = {
      board,
      selectedGroup,
      tab: board.defaultTab,
      chapters: board.chapters,
      visibleRoles: presentation.visibleRoles(board, selectedGroup),
    };
  }
const base = scenes["knights-12"];
scenes["knights-expanded"] = {
  ...base,
  visibleRoles: presentation.visibleRoles(base.board, base.selectedGroup, "", {
    "0:0": true,
  }),
};
scenes["knights-rules"] = { ...base, tab: "rules" };
scenes["knights-directory"] = { ...base, directoryExpanded: true };
scenes["knights-search"] = {
  ...base,
  query: "女巫",
  visibleRoles: presentation.visibleRoles(
    base.board,
    base.selectedGroup,
    "女巫",
  ),
};
fs.mkdirSync(output, { recursive: true });
for (const [name, data] of Object.entries(scenes))
  fs.writeFileSync(
    path.join(output, name + ".html"),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${safe(data.board.title)} · ${name}</title><style>body{margin:0}button{font:inherit;border:0;width:100%}input{border:0;background:none}img{object-fit:contain}.directory-list{overflow-y:auto}${styles}.app-nav-row::before{content:'9:41';position:absolute;top:-33px;left:28px;font-size:14px;font-weight:600}</style>${html(factory("pages/board-details/board-details.wxml")({ loading: false, error: "", query: "", allExpanded: false, navTop: 88, directoryExpanded: false, ...data }))}</html>`,
  );
function gallery(names) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>板子详情 · 已实现</title><link rel="icon" href="data:,"><style>body{margin:0;background:#e9e7e0;color:#172730;font:14px -apple-system,'PingFang SC',sans-serif;padding:28px 36px}h1{font-size:26px;font-weight:600;margin:0 0 10px}p{color:#64736e;margin:0 0 24px}.screens{display:flex;gap:24px;flex-wrap:wrap}section{width:375px}h2{font-size:14px;margin:0 0 12px}iframe{display:block;width:375px;height:812px;border:0;border-radius:20px}footer{margin-top:24px;color:#64736e;font-size:12px}</style><h1>板子详情 · 实际小程序模板</h1><p>角色速查与规则阅读共用新布局，各板子按内容和人数适配。</p><div class="screens">${names.map((name) => `<section><h2>${safe(scenes[name].board.title)} / ${name}</h2><iframe src="${name}.html" title="${name}"></iframe></section>`).join("")}</div><footer>生产 WXML / WXSS 布局投影 · 原生组件交互仍需微信开发者工具验收</footer></html>`;
}
fs.writeFileSync(
  path.join(output, "gallery.html"),
  gallery(["knights-12", "knights-expanded", "classic-9"]),
);
fs.writeFileSync(
  path.join(output, "all-boards.html"),
  gallery(Object.keys(scenes)),
);
console.log("Production board detail projections: " + output);
