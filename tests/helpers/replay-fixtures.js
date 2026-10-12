const { newRoom, enter, command, privateView, roleName } = require("../../server/engine");
const variants = require("../../server/variants");
const replay = require("../../server/replay");
const ids = variants.decks.knights;
const metadata = { ...variants.roles, merlin: [roleName("merlin"), "good"], percival: [roleName("percival"), "good"],
  servant: [roleName("servant"), "good"], assassin: [roleName("assassin"), "evil"], mordred: [roleName("mordred"), "evil"], morgana: [roleName("morgana"), "evil"] };
function run(room, type, extra = {}, uid = room.host) { command(room, uid, { type, stage: room.stage, ...extra }); }
function setup() {
  const room = newRoom("123456", "wx:replay-1", "岚", "knights", 12);
  const names = ["岚", "小鹿", "阿川", "白石", "子龙", "七月", "安", "可乐", "林", "海", "月北", "南风"];
  for (let i = 2; i <= 12; i++) enter(room, "wx:replay-" + i, names[i - 1]);
  enter(room, "spectator", "围观");
  room.players.forEach(p => p.ready = true);
  run(room, "start", { flexible: true });
  for (const p of room.players) {
    room.roles[p.uid] = ids[p.seat - 1];
    Object.assign(room.knights.players[p.uid], { alive: true, used: false, faction: null,
      armor: ["merlin", "percival", "morgana"].includes(room.roles[p.uid]), b: false });
  }
  room.knights.initialRoles = { ...room.roles }; room.fun.initialRoles = { ...room.roles };
  room.knights.deck = ["blueGuard", "magician", "redKnight", "redHunter", "paladin", "gargoyle", "blueHunter", "prophet", "blueKnight", "witch", "blueAwakened", "redAwakened"];
  room.knights.conversions = [true, false, false, true, false, false, false];
  replay.init(room, metadata);
  return room;
}
function submit(room, values = {}) {
  for (const p of room.players) {
    const action = privateView(room, p.uid).action;
    if (!action) continue;
    run(room, "submit", { value: values[p.seat] ?? action.choices[0] }, p.uid);
  }
}
function task(room, team, failed = []) {
  run(room, "beginActivity", { kind: "quest", team, threshold: 1 });
  submit(room, Object.fromEntries(team.map(seat => [seat, failed.includes(seat) ? "fail" : "success"])));
}
function skills(room, values = {}) { run(room, "beginActivity", { kind: "skills" }); submit(room, values); }
function completed() {
  const room = setup();
  task(room, [1, 2, 3]); skills(room, { 5: "target:8" });
  task(room, [1, 3, 7, 9], [9]); run(room, "beginActivity", { kind: "conversion" });
  skills(room, { 6: "target:7", 7: "target:6" });
  task(room, [1, 2, 3, 9, 12]); run(room, "beginActivity", { kind: "conversion" });
  skills(room, { 6: "target:8", 8: "target:1" });
  task(room, [1, 2, 3, 4, 7, 9]); skills(room);
  run(room, "finishTools", { scoreReason: "assassination", scoreTarget: 1 });
  return room;
}
function onlineCompleted() {
  const room = setup();
  run(room, "beginActivity", { kind: "vote", team: [1, 2, 7] });
  submit(room, { 10: "reject", 11: "reject", 12: "reject" });
  task(room, [1, 2, 7]);
  room.knights.fairy = 1;
  run(room, "beginActivity", { kind: "fairy" });
  submit(room, { 1: "target:7" });
  run(room, "beginActivity", { kind: "conversion" });
  skills(room, { 6: "target:7", 7: "target:6" });
  run(room, "beginActivity", { kind: "vote", team: [1, 3, 10] });
  run(room, "submit", { value: "approve" }, room.host);
  run(room, "closeWaiting", { confirm: true });
  task(room, [1, 3, 10], [10]);
  run(room, "beginActivity", { kind: "conversion" });
  run(room, "beginActivity", { kind: "fairy" });
  submit(room, { 7: "target:10" });
  skills(room);
  run(room, "beginActivity", { kind: "quest", team: [1, 2, 3], threshold: 1 });
  run(room, "cancelActivity");
  run(room, "beginActivity", { kind: "assassination", actor: 1 });
  submit(room);
  run(room, "beginActivity", { kind: "assassination", actor: 10 });
  submit(room, { 10: 1 });
  run(room, "finishTools", { winner: "evil" });
  return room;
}
module.exports = { setup, completed, onlineCompleted, run, submit, task, skills, metadata };
