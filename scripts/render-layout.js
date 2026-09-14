// Layout-only HTML projection of the compiled WXML tree. Not a replacement client.
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { wxmlToJs } = require("miniprogram-compiler");
const {
  BOARDS,
  newRoom,
  enter,
  command,
  publicView,
} = require("../server/engine");
const root = path.resolve(__dirname, "../miniprogram");
const ctx = { window: {}, global: {}, console };
vm.createContext(ctx);
const factory = vm.runInContext(
  "(function(global){" + wxmlToJs(root) + "})(global)",
  ctx,
);
const render = factory("pages/table/table.wxml");
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function html(n) {
  if (typeof n === "string" || typeof n === "number") return escape(n);
  const tag =
    {
      "wx-text": "span",
      "wx-button": "button",
      "wx-input": "input",
      "wx-label": "label",
    }[n.tag] || "div";
  const attrs = Object.entries(n.attr || {})
    .filter(([k]) =>
      ["class", "disabled", "placeholder", "value", "role"].includes(k),
    )
    .map(([k, v]) =>
      k === "disabled" ? (v ? "disabled" : "") : `${k}="${escape(v)}"`,
    )
    .join(" ");
  return `<${tag} ${attrs}>${(n.children || []).map(html).join("")}${tag === "input" ? "" : `</${tag}>`}`;
}
const r = newRoom("628419", "p1", "林间", "classic-court", 12);
for (let i = 2; i <= 12; i++)
  enter(
    r,
    "p" + i,
    [
      "",
      "",
      "阿木",
      "小橙",
      "晚风",
      "Kiki",
      "七月",
      "北川",
      "小鱼",
      "向晚",
      "舟舟",
      "阿辰",
      "星河",
    ][i],
  );
const base = {
  loading: false,
  busy: false,
  error: "",
  notice: "",
  room: null,
  boardId: "classic",
  boardName: "阿瓦隆 · 经典基础",
  capacity: 6,
  boardRoleConfiguration: BOARDS[0].roleConfigurations[6],
  name: "",
  code: "",
  boards: BOARDS,
  availableBoards: BOARDS.filter((b) => b.available && b.counts.includes(6)),
  capacities: [6, 7, 8, 9, 10, 11, 12],
  entryMode: "create",
  revealed: false,
  secret: null,
  network: true,
  selected: [],
  history: [],
};
function roomData() {
  const room = publicView(r, "p1");
  return {
    ...base,
    room,
    teamText: "尚未选择",
    seats: room.players.map((p) => ({
      ...p,
      occupied: true,
      mine: p.seat === 1,
      host: p.isHost,
      inTeam: false,
    })),
  };
}
const scenes = {
  home: base,
  homeRules: { ...base, showRules: true },
  roomRules: { ...roomData(), showRoomRules: true },
  home12: {
    ...base,
    capacity: 12,
    boardId: "classic-court",
    availableBoards: BOARDS.filter((b) => b.available && b.counts.includes(12)),
  },
  join: { ...base, entryMode: "join" },
  lobby: roomData(),
};
r.players.forEach((p) =>
  command(r, p.uid, { type: "ready", ready: true, stage: r.stage }),
);
command(r, "p1", { type: "start", stage: r.stage });
scenes.identity = roomData();
const taskSeats = roomData();
scenes.taskSeats = {
  ...taskSeats,
  room: { ...taskSeats.room, phase: "proposal", phaseName: "队长组队", needsSubmission: false, capacity: 6, teamSize: 2, leader: 3, team: [2, 4] },
  teamText: "2、4",
  seats: taskSeats.seats.slice(0, 6).map((seat) => ({ ...seat, inTeam: [2, 4].includes(seat.seat) })),
};
scenes.selfInTeam = {
  ...scenes.taskSeats,
  room: { ...scenes.taskSeats.room, team: [1, 4] },
  teamText: "1、4",
  seats: scenes.taskSeats.seats.map((seat) => ({ ...seat, inTeam: [1, 4].includes(seat.seat) })),
};
const css = fs
  .readFileSync(path.join(root, "app.wxss"), "utf8")
  .replace(/^page\s*\{/m, "body {")
  .replace(/([\d.]+)rpx/g, "calc($1 * 100vw / 750)");
fs.mkdirSync("output/playwright", { recursive: true });
for (const [name, data] of Object.entries(scenes)) {
  fs.writeFileSync(
    `output/playwright/${name}.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>影中执刃 · 编译模板布局检查</title><style>body{margin:0}button,input{font:inherit;border:0}span{white-space:normal}form{display:block}button{width:100%}input{display:block;width:100%}${css}</style>${html(render(data))}</html>`,
  );
}
console.log("Layout projections: output/playwright/{home,lobby,identity}.html");
