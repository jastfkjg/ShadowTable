"use strict";
// Ballots are private facts, stored separately from public match/room snapshots.
const { RuleError } = require("./engine");
const { readAvatarUrls } = require("./profile");
const { control } = require("./match-management");
const keys = ["mvp", "svp"];
const check = (ok, message, status = 400) => { if (!ok) throw new RuleError(message, status); };
const read = (store, id) => {
  const row = store.db.prepare("SELECT state FROM honor_polls WHERE match_id=?").get(id);
  return row ? JSON.parse(row.state) : null;
};
function save(store, poll) {
  store.db.prepare("INSERT INTO honor_polls VALUES(?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET state=excluded.state,status=excluded.status,deadline=excluded.deadline")
    // Keep the legacy non-null deadline column compatible; polls no longer expire.
    .run(poll.matchId, JSON.stringify(poll), poll.status, 0);
}
function matchFor(store, id) {
  const row = store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id);
  if (row) return JSON.parse(row.snapshot);
  // Pure companion games have no personal archive. Keep their election in the
  // existing table and private poll, without creating any personal records.
  const room = store.db.prepare("SELECT state FROM rooms WHERE json_extract(state,'$.matchRecord.id')=?").get(id);
  return room ? JSON.parse(room.state).matchRecord : read(store, id)?.testMatch || null;
}
function participants(store, match) {
  const players = match.players || store.matchParticipants(match);
  return players.map(p => p.uid.startsWith("test:") && ["good", "evil", "third"].includes(p.faction)
    ? { ...p, outcome: p.faction === match.winner ? "win" : "loss" } : p)
    .filter(p => ["win", "loss"].includes(p.outcome));
}
function eligible(store, match) {
  if (!match?.winner || match.excludedReason || control(store, match.id).state !== "active") return false;
  const players = participants(store, match);
  return players.some(p => p.outcome === "win") && players.some(p => p.outcome === "loss");
}
function choices(poll, uid, key) {
  return poll.players.filter(p => p.uid !== uid && p.outcome === (key === "mvp" ? "win" : "loss"));
}
function publish(store, match, result) {
  match.honorResult = result;
  const saved = store.db.prepare("UPDATE matches SET snapshot=? WHERE id=?").run(JSON.stringify(match), match.id);
  if (saved.changes) {
    store.rebuildFun(match, store.matchParticipants(match));
    store.syncScoreRooms();
    store.invalidateLeaderboard();
  } else {
    const room = store.get(match.code);
    if (room?.matchRecord?.id === match.id) {
      room.matchRecord.honorResult = result;
      store.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(JSON.stringify(room), room.code);
    }
  }
}
function settle(store, poll) {
  if (!poll || poll.status !== "open") return;
  const match = matchFor(store, poll.matchId);
  if (!eligible(store, match) || match.winner !== poll.winner) return invalidate(store, poll.matchId);
  const completed = Object.keys(poll.ballots).length;
  poll.status = completed >= poll.required ? "settled" : "insufficient";
  poll.closedAt = store.clock();
  const avatars = readAvatarUrls(store, poll.players.map(p => p.uid));
  const result = { status: poll.status, completed, total: poll.players.length, required: poll.required, closedAt: poll.closedAt, mvp: [], svp: [] };
  if (poll.status === "settled") for (const key of keys) {
    const counts = new Map();
    for (const ballot of Object.values(poll.ballots)) if (ballot[key] !== null) counts.set(ballot[key], (counts.get(ballot[key]) || 0) + 1);
    const highest = Math.max(0, ...counts.values());
    result[key] = poll.players.filter(p => highest > 0 && counts.get(p.seat) === highest).map(p => ({
      seat: p.seat, name: p.name, avatarUrl: avatars.get(p.uid) || null, votes: highest,
    }));
  }
  poll.result = result;
  save(store, poll);
  publish(store, match, result);
}
function invalidate(store, id) {
  const poll = read(store, id);
  if (!poll || poll.status === "invalidated") return;
  poll.status = "invalidated";
  poll.result = { status: "invalidated", mvp: [], svp: [] };
  save(store, poll);
  const match = matchFor(store, id);
  if (match) publish(store, match, { status: "invalidated", mvp: [], svp: [] });
}
function settleOrphaned(store) {
  // A management rematch or room removal can discard the table's poll context.
  // Only those polls close here; an active table never closes because time passed.
  const rows = store.db.prepare(`SELECT state FROM honor_polls WHERE status='open' AND NOT EXISTS (
    SELECT 1 FROM rooms WHERE json_extract(rooms.state,'$.matchRecord.id')=honor_polls.match_id
      AND json_extract(rooms.state,'$.phase')='ended'
  )`).all();
  if (!rows.length) return;
  const finish = () => rows.forEach(row => settle(store, JSON.parse(row.state)));
  if (store.inTransaction) finish(); else store.transaction(finish);
}
function handle(store, room, uid, input) {
  check(room.phase === "ended" && room.matchRecord?.id === input.matchId && room.stage === input.stage, "本局已变化，请刷新后操作", 409);
  const match = matchFor(store, input.matchId);
  check(eligible(store, match), "本局未登记有效胜负，无法票选");
  let poll = read(store, match.id);
  if (input.type === "honorStart") {
    check(room.host === uid, "只有房主可以发起票选", 403);
    check(!poll, "本局已经发起过票选", 409);
    const players = participants(store, match).map(({ uid, seat, name, outcome }) => ({ uid, seat, name, outcome }));
    poll = { matchId: match.id, winner: match.winner, status: "open", players, required: Math.ceil(players.length / 2), ballots: {} };
    if (players.every(p => p.uid.startsWith("test:")))
      poll.testMatch = { id: match.id, code: match.code, winner: match.winner, players };
    save(store, poll);
  } else {
    check(poll?.status === "open", "投票已结束，请刷新查看结果", 409);
    if (input.type === "honorClose") {
      check(room.host === uid, "只有房主可以结束票选", 403);
      settle(store, poll);
    } else {
      check(input.type === "honorVote", "未知票选操作");
      check(poll.players.some(p => p.uid === uid), "仅本局参赛玩家可以投票", 403);
      const ballot = {};
      for (const key of keys) {
        const candidates = choices(poll, uid, key);
        check(candidates.length ? Number.isInteger(input[key]) && candidates.some(p => p.seat === input[key]) : input[key] === null,
          candidates.length ? "请为 " + key.toUpperCase() + " 选择对应胜负方的一名玩家，不能投自己" : "该项没有可选玩家，请跳过");
        ballot[key] = input[key];
      }
      poll.ballots[uid] = ballot;
      save(store, poll);
      if (Object.keys(poll.ballots).length === poll.players.length) settle(store, poll);
    }
  }
}
function closeForRoom(store, room) { settle(store, read(store, room.matchRecord?.id || "")); }
function view(store, room, uid) {
  if (room.phase !== "ended" || !room.matchRecord) return null;
  const match = matchFor(store, room.matchRecord.id);
  if (!eligible(store, match)) return null;
  const poll = read(store, match.id);
  if (!poll) return { matchId: match.id, status: "not_started", canStart: room.host === uid };
  if (poll.status !== "open") return { matchId: match.id, ...(match.honorResult || poll.result), canStart: false };
  const avatars = readAvatarUrls(store, poll.players.map(p => p.uid));
  return { matchId: match.id, status: "open",
    total: poll.players.length, completed: Object.keys(poll.ballots).length, required: poll.required,
    canVote: poll.players.some(p => p.uid === uid), canClose: room.host === uid, ballot: poll.ballots[uid] || null,
    ...(room.host === uid ? { pendingPlayers: poll.players.filter(p => !Object.hasOwn(poll.ballots, p.uid))
      .map(({ seat, name }) => ({ seat, name })) } : {}),
    groups: keys.map(key => ({ key, title: "最强 " + key.toUpperCase(), side: key === "mvp" ? "胜方" : "败方",
      skip: !choices(poll, uid, key).length,
      players: poll.players.filter(p => p.outcome === (key === "mvp" ? "win" : "loss")).map(p => ({
        seat: p.seat, name: p.name, avatarUrl: avatars.get(p.uid) || null, disabled: p.uid === uid,
      })),
    })),
  };
}
module.exports = { handle, view, settleOrphaned, closeForRoom, invalidate };
