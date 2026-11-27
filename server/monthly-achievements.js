'use strict';
const { periodRange, compareWinRate } = require('./leaderboard');
const { roleIds, roleName } = require('./engine');
const { questFacts } = require('./role-fun');
const { RANK_MIN_PLAYERS } = require('./match-management');
const roleByName = new Map(roleIds.map((id) => [roleName(id), id]));
const basicRoles = ['merlin', 'percival', 'servant', 'mordred', 'morgana', 'assassin', 'oberon'];
const rankingBadges = require('../miniprogram/badges').catalogue.filter(b => b.metric === 'leader' || b.metric === 'podium');
const cache = new WeakMap();

function stats() {
  return {
    counts: {},
    earned: new Map(),
    rates: new Map(),
    playedRoles: new Set(),
    winningRoles: new Set(),
    previous: null,
    run: 0,
    alternating: 0,
    aligned: 0,
  };
}
function increment(s, id) {
  s.counts[id] = (s.counts[id] || 0) + 1;
}
function finishGame(s, row, role) {
  const win = row.outcome === 'win';
  s.run = row.outcome === s.previous ? s.run + 1 : 1;
  s.alternating = row.outcome !== s.previous ? s.alternating + 1 : 1;
  s.previous = row.outcome;
  const id = win ? 'win_streak' : 'loss_streak';
  if (s.run >= 2) s.counts[id] = Math.max(s.counts[id] || 0, s.run);
  if (s.alternating >= 2) s.counts.alternating_streak = Math.max(s.counts.alternating_streak || 0, s.alternating);
  if (!row.scored) return;
  if (role) {
    s.playedRoles.add(role);
    if (win) s.winningRoles.add(role);
  }
  const bucket = ['blueLancelot', 'redLancelot'].includes(role) ? 'lancelot' : role;
  for (const key of ['overall', row.faction, bucket].filter(Boolean)) {
    const rate = s.rates.get(key) || { total: 0, wins: 0 };
    rate.total++;
    rate.wins += Number(win);
    s.rates.set(key, rate);
  }
}

function timeline(game) {
  if (game.funFacts?.badgeTimeline) return game.funFacts.badgeTimeline;
  // Legacy knight replays contain changes of allegiance in chronological order.
  const sides = Object.fromEntries(
    (game.replay?.complete ? game.replay.initialPlayers || [] : []).map((p) => [p.seat, p.faction]),
  );
  return (game.replay?.events || []).map((e) => {
    for (const change of e.changes || []) sides[change.seat] = change.after.faction;
    return e.kind === 'vote' ? { ...e, sides: { ...sides } } : e;
  });
}
function votesWithResults(events) {
  const votes = [];
  let pending;
  for (const e of events) {
    if (e.kind === 'vote') {
      pending = { ...e, successful: false };
      votes.push(pending);
    } else if (e.kind === 'quest') {
      if (
        pending?.approved &&
        pending.team?.length &&
        pending.team.length === e.team?.length &&
        pending.team.every((seat) => e.team.includes(seat))
      )
        pending.successful = e.success === true;
      pending = null;
    } else if (e.kind === 'canceled') pending = null;
  }
  return votes;
}
function countVotes(s, seat, ballots, complete) {
  const own = ballots.map((v) => ({ vote: v, choice: v.votes?.find((p) => p.seat === seat)?.approve }));
  for (const [choice, id] of [
    [true, 'approve_success'],
    [false, 'reject_success'],
  ]) {
    const cast = own.filter((item) => item.choice === choice);
    if (complete && cast.length && cast.every((item) => item.vote.successful)) s.earned.set(id, true);
  }
  let unanimous = 0;
  for (const { vote, choice } of own) {
    const side = vote.sides?.[seat];
    const cast = typeof choice === 'boolean';
    const voters = vote.votes || [];
    const allies = voters.filter((p) => p.seat !== seat && vote.sides?.[p.seat] === side);
    if (
      side &&
      side !== 'unknown' &&
      cast &&
      voters.every((p) => vote.sides?.[p.seat] && vote.sides[p.seat] !== 'unknown') &&
      allies.length &&
      allies.every((p) => p.approve === choice)
    )
      unanimous++;
    const team = (vote.team || []).map((n) => vote.sides?.[n]);
    const red = team.includes('evil'),
      blue = team.length > 0 && team.every((f) => f === 'good');
    const aligned =
      cast && (side === 'good' || side === 'evil') && (red || blue) && choice === (side === 'evil' ? red : blue);
    s.aligned = aligned ? s.aligned + 1 : 0;
    if (s.aligned >= 5) s.earned.set('faction_ballots', true);
  }
  if (unanimous >= 2) s.earned.set('unanimous_allies', true);
}
function countGame(players, game, byUid) {
  const quests = questFacts(game, [...players, ...(game.companions || [])]);
  const first = quests[0],
    members = first?.members || [];
  const firstTrio = first?.team?.length === 3 && members.length === 3 && (first.round == null || first.round === 1);
  const events = timeline(game),
    ballots = votesWithResults(events);
  const fairies = events.filter((e) => e.kind === 'fairy');
  const complete = Array.isArray(game.funFacts?.badgeTimeline) || game.replay?.complete === true;
  for (const p of players) {
    if (!p.valid) continue;
    if (!byUid.has(p.uid)) byUid.set(p.uid, stats());
    const s = byUid.get(p.uid);
    s.visible = !!p.visible;
    const drawn =
      game.funFacts?.initialRoles?.[p.uid] ||
      game.replay?.initialPlayers?.find((x) => x.seat === p.seat)?.roleId ||
      (game.board?.startsWith('knights') ? null : p.roleId || roleByName.get(p.role));
    finishGame(s, p, drawn === 'redSwordsman' ? 'oberon' : drawn);
    if (p.scored && game.capacity >= RANK_MIN_PLAYERS) {
      increment(s, p.outcome === 'win' ? 'overall' : 'headwind_navigator');
    }
    if (firstTrio && first.team.includes(p.seat)) {
      if (members.every((m) => m.role === 'servant')) increment(s, 'servant_trio');
      if (members.every((m) => m.faction === 'evil')) increment(s, 'evil_trio');
    }
    let triple = false;
    for (const q of quests) {
      const member = q.members?.find((m) => m.seat === p.seat);
      if (member?.playedSuccess) increment(s, 'success_courier');
      if (member?.playedFailure) {
        increment(s, 'sabotage_courier');
        if (q.fails >= 3) triple = true;
      }
    }
    if (triple) increment(s, 'triple_sabotage');
    for (const e of fairies) {
      if ((e.actor?.seat ?? e.actor) === p.seat) increment(s, 'lake_seer');
      if ((e.target?.seat ?? e.target) === p.seat) increment(s, 'lake_blessed');
    }
    if (!complete) s.aligned = 0;
    countVotes(s, p.seat, ballots, complete);
    if (!complete) s.aligned = 0;
  }
}
function achievementStandings(byUid, badge) {
  const rows = [];
  const rate = badge.metric === 'podium', key = rate && badge.id.slice(5);
  for (const [uid, stats] of byUid) {
    if (!stats.visible || !/^(wx|dev):/.test(uid)) continue;
    if (rate) {
      const sample = stats.rates.get(key);
      const minimum = ['overall', 'good', 'evil'].includes(key) ? 1 : 3;
      if (stats.rates.get('overall')?.total >= 10 && sample?.total >= minimum) rows.push({ uid, ...sample });
    } else if (stats.counts[badge.id]) {
      rows.push({ uid, count: stats.counts[badge.id] });
    }
  }
  const compare = rate ? compareWinRate : (a, b) => b.count - a.count;
  rows.sort(compare);
  for (const [i, row] of rows.entries()) {
    row.rank = i && compare(row, rows[i - 1]) === 0 ? rows[i - 1].rank : i + 1;
  }
  return rows;
}
function awardRanks(byUid) {
  for (const badge of rankingBadges) {
    const places = badge.metric === 'leader' ? 1 : 3;
    for (const row of achievementStandings(byUid, badge)) {
      if (row.rank > places) break;
      byUid.get(row.uid).earned.set(badge.id, row.rank);
    }
  }
}
function monthlyAchievements(store, now) {
  const { start, end } = periodRange('month', now);
  const old = cache.get(store);
  if (!store.leaderboardDirty && old?.start === start && old.revision === store.leaderboardRevision) return old.byUid;
  // Read each archived event log once, even when all seats belong to public players.
  const rows = store.db
    .prepare(
      `SELECT p.match_id, p.uid, p.outcome, p.faction,
    json_extract(p.snapshot,'$.seat') AS seat, json_extract(p.snapshot,'$.roleId') AS roleId,
    json_extract(p.snapshot,'$.role') AS role, p.outcome IN ('win','loss') AS valid,
    s.status='scored' AS scored, f.leaderboard_visible AND f.public_id IS NOT NULL AS visible
    FROM visible_match_players p LEFT JOIN active_match_scores s ON s.match_id=p.match_id AND s.uid=p.uid
    LEFT JOIN profiles f ON f.uid=p.uid WHERE p.ended>=? AND p.ended<? ORDER BY p.ended,p.match_id`,
    )
    .all(start, end);
  const groups = new Map();
  for (const p of rows) {
    if (!groups.has(p.match_id)) groups.set(p.match_id, []);
    groups.get(p.match_id).push(p);
  }
  const byUid = new Map(),
    get = store.db.prepare('SELECT snapshot FROM matches WHERE id=?');
  // Personal history clears affect that seat's attendance, never the shared denominator.
  const scoredGames = store.db
    .prepare(
      `SELECT count(DISTINCT s.match_id) AS n FROM match_scores s
    JOIN match_players p ON p.match_id=s.match_id AND p.uid=s.uid
    LEFT JOIN match_controls c ON c.match_id=s.match_id
    WHERE s.ended>=? AND s.ended<? AND s.status='scored' AND p.outcome IN ('win','loss')
    AND coalesce(c.state,'active')='active'`,
    )
    .get(start, end).n;
  for (const [id, players] of groups) {
    if (!players.some((p) => p.valid)) continue;
    const game = JSON.parse(get.get(id).snapshot);
    countGame(players, game, byUid);
  }
  for (const s of byUid.values()) {
    if (s.counts.success_courier >= 30) s.earned.set('success_courier', true);
    if (s.counts.sabotage_courier >= 30) s.earned.set('sabotage_courier', true);
    if (basicRoles.every((id) => s.playedRoles.has(id))) s.earned.set('role_collector', true);
    if (s.winningRoles.size >= 7) s.earned.set('seven_victors', true);
    if (scoredGames && (s.rates.get('overall')?.total || 0) * 5 >= scoredGames * 4) s.earned.set('attendance', true);
  }
  awardRanks(byUid);
  if (!store.inTransaction) cache.set(store, { start, revision: store.leaderboardRevision, byUid });
  return byUid;
}
module.exports = { monthlyAchievements, achievementStandings };
