"use strict";
const { createHash } = require("node:crypto");
const { RuleError } = require("./engine");
const { readProfile } = require("./profile");

// Scoped to a room membership, never an account ID or a management credential.
function playerStatsId(room, player) {
  return createHash("sha256").update(JSON.stringify(["player-stats", room.code, player.membershipId || player.uid])).digest("hex");
}
function readRoomPlayerStats(store, room, viewer, targetId) {
  if (![...room.players, ...(room.spectators || [])].some(p => p.uid === viewer))
    throw new RuleError("你不在该房间", 403);
  const target = room.players.find(p => playerStatsId(room, p) === targetId);
  if (!target) throw new RuleError("该玩家已离开座位，请关闭卡片后重试", 404);
  const profile = readProfile(store, target.uid);
  const player = { id: targetId, seat: target.seat, name: target.name, isHost: room.host === target.uid, avatarUrl: profile.avatarUrl };
  if (target.uid.startsWith("test:")) return { player, status: "untracked" };
  return { player, status: "available", stats: playerStatsSummary(store, target.uid) };
}
function playerStatsSummary(store, uid) {
  const { total, wins, winRate, byFaction, scoreTotal } = store.statsSummaryFor(uid);
  return { total, wins, winRate, scoreTotal,
    byFaction: byFaction.filter(row => row.total > 0).map(({ faction, label, total, wins, winRate }) => ({ faction, label, total, wins, winRate })) };
}
function readLeaderboardPlayerStats(store, publicId) {
  const target = store.db.prepare("SELECT uid FROM profiles WHERE public_id=?").get(publicId);
  if (!target) throw new RuleError("该玩家暂不可查看", 404);
  const profile = readProfile(store, target.uid);
  const player = { id: publicId, name: profile.nickname || "新朋友", avatarUrl: profile.avatarUrl };
  if (target.uid.startsWith("test:")) return { player, status: "untracked" };
  return { player, status: "available", stats: playerStatsSummary(store, target.uid) };
}
module.exports = { playerStatsId, readRoomPlayerStats, readLeaderboardPlayerStats };
