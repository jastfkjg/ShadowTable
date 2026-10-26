"use strict";
const { randomBytes, createHash } = require("node:crypto");
const { RuleError } = require("./engine");
const { readProfile } = require("./profile");
const fun = require("./fun");
const funCopy = require("../miniprogram/fun-copy");
const validId = value => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
const check = (ok, message, status = 400) => { if (!ok) throw new RuleError(message, status); };
const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS record_shares(id TEXT PRIMARY KEY,uid TEXT NOT NULL,fingerprint TEXT NOT NULL,snapshot TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS record_shares_content ON record_shares(uid,fingerprint);`);
}
function record(row) {
  return { total: row.total, wins: row.wins, losses: row.losses ?? row.total - row.wins,
    winRate: row.total ? Math.round(row.wins / row.total * 1000) / 10 : null };
}
function statsData(stats, now = Date.now()) {
  check(stats.total > 0, "还没有可分享的有效战绩");
  const date = new Date(now + 8 * 3600000);
  return { ...record(stats), scoreMonth: stats.score?.month ?? stats.score?.total ?? 0,
    scorePeriod: date.getUTCFullYear() + "." + String(date.getUTCMonth() + 1).padStart(2, "0"),
    factions: (stats.byFaction || []).filter(row => row.total > 0).map(row => ({ faction: row.faction, ...record(row) })),
    roles: (stats.byRole || []).filter(row => row.total > 0).map(row => ({ role: clean(row.role), faction: row.faction, ...record(row) }))
      .sort((a, b) => b.total - a.total || b.wins - a.wins || a.role.localeCompare(b.role)).slice(0, 4) };
}
function matchData(store, uid, id) {
  check(typeof id === "string" && id.length > 0 && id.length <= 128, "请选择要分享的对局");
  const match = store.matchFor(uid, id), events = [];
  // Only public task results and the final result leave the replay projection.
  // Roles, votes, visions, targets, member names and private skill facts stay out.
  const raw = JSON.parse(store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(id).snapshot);
  const game = require("./match-management").present(store, id, raw, {}).game;
  for (const event of game.replay?.events || game.funFacts?.events || []) {
    if (event.kind === "quest") events.push({ round: Number.isInteger(event.round) ? event.round : null, label: event.success ? "任务成功" : "任务失败" });
  }
  const final = game.funFacts?.terminal;
  if (final && ["assassination", "early_assassination", "final_action"].includes(final.reason) && typeof final.hit === "boolean")
    events.push({ round: null, label: final.hit ? "最终刺杀命中梅林" : "最终刺杀未命中梅林" });
  return { boardName: clean(match.boardName), capacity: match.capacity, endedAt: match.endedAt,
    role: clean(match.role), faction: match.faction, seat: match.seat, outcome: match.outcome, winner: match.winner,
    score: match.score?.status === "scored" ? match.score.total : null,
    events, questSuccess: events.filter(row => row.label === "任务成功").length,
    questTotal: events.filter(row => row.label === "任务成功" || row.label === "任务失败").length };
}
function funData(store, uid, input) {
  check(Object.hasOwn(fun.metrics, input.metric || "") && Object.hasOwn(fun.modes, input.mode || ""), "请选择要分享的趣味指标");
  const tile = funCopy.records(store.funFor(uid)).tiles.find(row => row.id === input.metric && row.mode === input.mode);
  check(tile?.known && tile.knownGames > 0, "这项成绩还没有完整记录，暂时无法分享");
  const records = store.matchesFor(uid, 0, 5, false, { metric: tile.id, mode: tile.mode }).records.map(row => {
    const count = store.db.prepare("SELECT coalesce(sum(count),0) AS n FROM match_fun_stats WHERE uid=? AND match_id=? AND mode=? AND metric=? AND status='known'")
      .get(uid, row.id, tile.mode, tile.id).n;
    return { boardName: clean(row.boardName), role: clean(row.role), faction: row.faction, endedAt: row.endedAt, count };
  });
  const info = funCopy.recordInfo(tile);
  return { metric: tile.id, mode: tile.mode, modeLabel: fun.modes[tile.mode], label: clean(tile.title), roleLabel: clean(tile.roleLabel),
    icon: tile.icon, iconTone: tile.iconTone, unit: tile.unit, count: tile.count, opportunities: tile.opportunities,
    knownGames: tile.knownGames, countOnly: !!tile.countOnly, rate: tile.countOnly ? null : tile.rate,
    rateName: tile.rateLabel ? tile.rateLabel.slice(0, tile.rateLabel.indexOf(" ")) : "发生率",
    description: clean(info.info.description), records };
}
function create(store, uid, input) {
  check(input && typeof input === "object" && !Array.isArray(input), "分享参数无效");
  const allowed = { stats: ["kind"], match: ["kind", "match"], fun: ["kind", "metric", "mode"] };
  check(typeof input.kind === "string" && Object.hasOwn(allowed, input.kind) && Object.keys(input).every(key => allowed[input.kind].includes(key)), "分享参数无效");
  const profile = readProfile(store, uid);
  const player = { name: clean(profile.nickname) || "新朋友", avatarUrl: profile.avatarUrl || "" };
  const data = input.kind === "stats" ? statsData(store.statsFor(uid), store.clock()) : input.kind === "match" ? matchData(store, uid, input.match) : funData(store, uid, input);
  const title = input.kind === "stats" ? `${player.name}的阿瓦隆战绩 · 胜率 ${data.winRate}%`
    : input.kind === "match" ? `${player.name}的${data.boardName}对局`
    : `${player.name}的${data.label} · ${data.count}${data.unit}`;
  const payload = { version: 1, kind: input.kind, player, title, data };
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return store.transaction(() => {
    const existing = store.db.prepare("SELECT snapshot FROM record_shares WHERE uid=? AND fingerprint=?").get(uid, fingerprint);
    if (existing) return JSON.parse(existing.snapshot);
    const snapshot = { ...payload, id: randomBytes(24).toString("hex"), createdAt: store.clock() };
    store.db.prepare("INSERT INTO record_shares VALUES(?,?,?,?,?)").run(snapshot.id, uid, fingerprint, JSON.stringify(snapshot), snapshot.createdAt);
    return snapshot;
  });
}
function read(store, id) {
  check(validId(id), "分享不存在或已失效", 404);
  const row = store.db.prepare("SELECT snapshot FROM record_shares WHERE id=?").get(id);
  check(row, "分享不存在或已失效", 404);
  return JSON.parse(row.snapshot);
}
module.exports = { initialize, create, read, validId, statsData };
