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
  privateView,
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
  // Approximate the native switch only in this layout projection.
  if (n.tag === "wx-switch")
    return `<span role="switch" aria-checked="${!!n.attr?.checked}" style="display:inline-block;flex-shrink:0;width:50px;height:30px;border-radius:20px;background:${n.attr?.checked ? "#c3a361" : "#536570"};padding:3px;box-sizing:border-box"><span style="display:block;width:24px;height:24px;border-radius:50%;background:#f2eee5;margin-left:${n.attr?.checked ? 20 : 0}px"></span></span>`;
  const tag =
    {
      "wx-text": "span",
      "wx-button": "button",
      "wx-input": "input",
      "wx-label": "label",
    }[n.tag] || "div";
  if (n.tag === "wx-scroll-view")
    n.attr = { ...n.attr, style: (n.attr?.style || "") + ";overflow-y:auto" };
  const attrs = Object.entries(n.attr || {})
    .filter(([k]) =>
      ["class", "disabled", "placeholder", "value", "role", "style"].includes(
        k,
      ),
    )
    .map(([k, v]) =>
      k === "disabled"
        ? v
          ? "disabled"
          : ""
        : `${k}="${escape(k === "style" ? String(v).replace(/([\d.]+)rpx/g, "calc($1 * 100vw / 750)") : v)}"`,
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
  showRules: true,
  revealed: false,
  secret: null,
  network: true,
  selected: [],
  history: [],
};
function roomData(source = r) {
  const room = publicView(source, "p1");
  return {
    ...base,
    room,
    teamText: "尚未选择",
    seats: room.players.map((p) => ({
      ...p,
      occupied: true,
      mine: p.seat === 1,
      host: p.isHost,
      inTeam: room.team.includes(p.seat),
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
  room: {
    ...taskSeats.room,
    phase: "proposal",
    phaseName: "队长组队",
    needsSubmission: false,
    capacity: 6,
    teamSize: 2,
    leader: 3,
    team: [2, 4],
  },
  teamText: "2、4",
  seats: taskSeats.seats
    .slice(0, 6)
    .map((seat) => ({ ...seat, inTeam: [2, 4].includes(seat.seat) })),
};
scenes.selfInTeam = {
  ...scenes.taskSeats,
  room: { ...scenes.taskSeats.room, team: [1, 4] },
  teamText: "1、4",
  seats: scenes.taskSeats.seats.map((seat) => ({
    ...seat,
    inTeam: [1, 4].includes(seat.seat),
  })),
};
const toolRoom = newRoom("628419", "p1", "林间", "classic", 6);
for (let i = 2; i <= 6; i++)
  enter(toolRoom, "p" + i, ["", "", "阿木", "小橙", "晚风", "Kiki", "七月"][i]);
toolRoom.players.forEach((p) =>
  command(toolRoom, p.uid, {
    type: "ready",
    ready: true,
    stage: toolRoom.stage,
  }),
);
command(toolRoom, "p1", {
  type: "start",
  flexible: true,
  stage: toolRoom.stage,
});
scenes.tools = roomData(toolRoom);
scenes.toolDialog = {
  ...scenes.tools,
  toolType: "quest",
  toolSeats: [2, 4],
  toolThreshold: 1,
  toolThresholds: ["1 张失败票", "2 张失败票"],
  toolPlayers: toolRoom.players.map((p) => ({
    ...p,
    selected: [2, 4].includes(p.seat),
  })),
};
command(toolRoom, "p1", {
  type: "beginActivity",
  kind: "vote",
  team: [2, 4],
  stage: toolRoom.stage,
});
command(toolRoom, "p2", {
  type: "submit",
  value: "approve",
  stage: toolRoom.stage,
});
command(toolRoom, "p4", {
  type: "submit",
  value: "reject",
  stage: toolRoom.stage,
});
scenes.operationProgress = {
  ...roomData(toolRoom),
  teamText: "2、4",
  history: [{ key: 0, text: "上次投票已结算", detail: "公开记录保留" }],
};
scenes.actionDialog = {
  ...scenes.operationProgress,
  room: {
    ...scenes.operationProgress.room,
    phase: "quest",
    phaseName: "任务出牌",
    needsSubmission: true,
  },
  actionDialog: true,
  actionLabel: "选择本轮任务牌",
  actionChoices: [
    { value: "success", label: "任务成功" },
    { value: "fail", label: "任务失败" },
  ],
  actionTargets: [],
};
const knightRoom = newRoom("628419", "p1", "林间", "knights", 12);
for (let i = 2; i <= 12; i++) enter(knightRoom, "p" + i, "玩家" + i);
for (const p of knightRoom.players)
  command(knightRoom, p.uid, {
    type: "ready",
    ready: true,
    stage: knightRoom.stage,
  });
command(knightRoom, "p1", {
  type: "start",
  flexible: true,
  stage: knightRoom.stage,
});
scenes.knightTools = roomData(knightRoom);
knightRoom.roles.p1 = "magician";
command(knightRoom, "p1", {
  type: "beginActivity",
  kind: "skills",
  stage: knightRoom.stage,
});
const skillAction = privateView(knightRoom, "p1").action;
scenes.knightSkills = {
  ...roomData(knightRoom),
  actionDialog: true,
  actionLabel: skillAction.label,
  actionChoices: skillAction.options,
  actionTargets: [],
};
const detailsRender = factory("pages/board-details/board-details.wxml");
const boardDetail = require("../server/board-info").knights;
scenes.boardDetails = { loading: false, error: "", hasDetail: true, title: "阿瓦隆 · 十二骑士", capacity: 12, directoryExpanded: false, ...boardDetail, summary: "" };
scenes.boardDirectory = { ...scenes.boardDetails, directoryExpanded: true };
const detailsCss = fs.readFileSync(path.join(root, "pages/board-details/board-details.wxss"), "utf8").replace(/([\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const settingsRender = factory("pages/settings/settings.wxml");
scenes.roomSettings = {
  loading: false,
  authorized: true,
  busy: false,
  room: {
    code: "600435",
    boardName: "阿瓦隆 · 十二骑士",
    capacity: 12,
    phase: "tools",
  },
  boardId: "knights",
  visible: false,
  dirty: false,
};
scenes.roomSettings.transferPlayers = Array.from({ length: 11 }, (_, i) => ({ seat: i + 2, name: `玩家${i + 2}` }));
scenes.roomSettingsPicker = { ...scenes.roomSettings, showTransferPicker: true };
const settingsCss = fs
  .readFileSync(path.join(root, "pages/settings/settings.wxss"), "utf8")
  .replace(/([\d.]+)rpx/g, "calc($1 * 100vw / 750)");
const css = fs
  .readFileSync(path.join(root, "app.wxss"), "utf8")
  .replace(/^page\s*\{/m, "body {")
  .replace(/([\d.]+)rpx/g, "calc($1 * 100vw / 750)");
fs.mkdirSync("output/playwright", { recursive: true });
for (const [name, data] of Object.entries(scenes)) {
  fs.writeFileSync(
    `output/playwright/${name}.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桌边助手 · 编译模板布局检查</title><style>body{margin:0}button,input{font:inherit;border:0}span{white-space:normal}form{display:block}button{width:100%}input{display:block;width:100%}${css}${settingsCss}${name.startsWith("boardD") ? detailsCss : ""}</style>${html(name.startsWith("boardD") ? detailsRender(data) : name.startsWith("roomSettings") ? settingsRender(data) : render(data))}</html>`,
  );
}
console.log("Layout projections: output/playwright/{home,lobby,identity}.html");
