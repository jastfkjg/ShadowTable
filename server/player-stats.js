"use strict";
const { createHash } = require("node:crypto");
const { RuleError } = require("./engine");
const { readProfile } = require("./profile");
const { readBadges } = require("./badges");

// Scoped to a room membership, never an account ID or a management credential.
function playerStatsId(room, player) {
  return createHash("sha256").update(JSON.stringify(["player-stats", room.code, player.membershipId || player.uid])).digest("hex");
}
function readRoomPlayerStats(store, room, viewer, targetId, resource = "stats") {
  if (![...room.players, ...(room.spectators || [])].some(p => p.uid === viewer))
    throw new RuleError("你不在该房间", 403);
  const target = room.players.find(p => playerStatsId(room, p) === targetId);
  if (!target) throw new RuleError("该玩家已离开座位，请关闭卡片后重试", 404);
  const profile = readProfile(store, target.uid);
  const player = { id: targetId, seat: target.seat, name: target.name, isHost: room.host === target.uid, avatarUrl: profile.avatarUrl };
  return readPlayerResource(store, target.uid, viewer, player, resource);
}
function readPlayerResource(store, uid, viewer, player, resource) {
  if (uid.startsWith("test:")) {
    if (resource === "badges") throw new RuleError("陪测玩家没有徽章收藏", 404);
    return { player, status: "untracked" };
  }
  const { badges } = readBadges(store, uid);
  const settings = viewer !== uid && store.db.prepare("SELECT honor_visible,fun_visible FROM badge_rank_players WHERE uid=?").get(uid);
  const limited = !!settings && (!settings.honor_visible || !settings.fun_visible);
  const visible = limited ? badges.filter(b => b.category === "趣味徽章" ? settings.fun_visible : settings.honor_visible) : badges;
  if (resource === "badges") {
    return { player, limited, badges: visible.map(({ id, rank, equipped }) => ({ id, rank, equipped })) };
  }
  player.badges = badges.filter(b => b.equipped);
  player.ownedBadgeCount = visible.length;
  player.badgesLimited = limited;
  return { player, status: "available", stats: playerStatsSummary(store, uid) };
}
function playerStatsSummary(store, uid) {
  const { total, wins, winRate, byFaction, scoreTotal } = store.statsSummaryFor(uid);
  return { total, wins, winRate, scoreTotal,
    byFaction: byFaction.filter(row => row.total > 0).map(({ faction, label, total, wins, winRate }) => ({ faction, label, total, wins, winRate })) };
}
function readLeaderboardPlayerStats(store, publicId, viewer, resource = "stats") {
  const target = store.db.prepare("SELECT uid FROM profiles WHERE public_id=?").get(publicId);
  if (!target) throw new RuleError("该玩家暂不可查看", 404);
  const profile = readProfile(store, target.uid);
  const player = { id: publicId, name: profile.nickname || "新朋友", avatarUrl: profile.avatarUrl };
  return readPlayerResource(store, target.uid, viewer, player, resource);
}
module.exports = { playerStatsId, readRoomPlayerStats, readLeaderboardPlayerStats };
