"use strict";
const { randomUUID } = require("node:crypto");
const avoidance = require("./avoidance");
const { RuleError } = require("./engine");
const lossesPerCard = 2, winsPerCard = 4;

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS avoidance_reward_matches(match_id TEXT PRIMARY KEY, started INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS avoidance_reward_accounts(uid TEXT PRIMARY KEY,
      wins INTEGER NOT NULL CHECK(wins>=0), losses INTEGER NOT NULL CHECK(losses>=0), issued INTEGER NOT NULL CHECK(issued>=0));`);
}

function registerStart(store, room) {
  if (!store.inTransaction) throw Error("回避卡奖励开局登记必须在事务中执行");
  if (room.recordPurpose === "test") return;
  // Only the successful start command registers a game. Never infer eligibility
  // from its end time or backfill existing rooms/archives when the server starts.
  store.db.prepare(`INSERT OR IGNORE INTO avoidance_reward_matches(match_id,started)
    SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM matches WHERE id=?)`)
    .run(room.matchId, room.startedAt, room.matchId);
}

function reconcile(store, matchIds) {
  if (!store.inTransaction) throw Error("回避卡奖励结算必须在事务中执行");
  if (!matchIds.length) return;
  const affected = store.db.prepare(`SELECT DISTINCT p.uid FROM match_players p
    JOIN avoidance_reward_matches r ON r.match_id=p.match_id
    WHERE p.match_id IN (${matchIds.map(() => "?").join(",")})`).all(...matchIds);
  const totals = store.db.prepare(`SELECT coalesce(sum(p.outcome='win'),0) AS wins, coalesce(sum(p.outcome='loss'),0) AS losses
    FROM match_players p JOIN avoidance_reward_matches r ON r.match_id=p.match_id
    JOIN matches m ON m.id=p.match_id LEFT JOIN match_controls c ON c.match_id=p.match_id
    WHERE p.uid=? AND p.outcome IN ('win','loss') AND coalesce(c.state,'active')='active'
      AND coalesce(json_extract(m.snapshot,'$.recordPurpose'),'normal')='normal'
      AND json_extract(m.snapshot,'$.excludedReason') IS NULL
      AND json_extract(m.snapshot,'$.winner') IN ('good','evil','third')`);
  for (const { uid } of affected) {
    if (!avoidance.eligible(uid)) continue;
    const { wins, losses } = totals.get(uid);
    const previous = store.db.prepare("SELECT wins,losses,issued FROM avoidance_reward_accounts WHERE uid=?").get(uid) || { wins: 0, losses: 0, issued: 0 };
    const { issued } = previous;
    const earned = Math.floor(losses / lossesPerCard) + Math.floor(wins / winsPerCard);
    // Corrections never claw back issued cards (which may already be spent).
    // Keep the lifetime issued count so any excess offsets future rewards.
    if (earned > issued) {
      const amount = earned - issued, after = avoidance.balance(store, uid) + amount;
      const winReward = Math.floor(wins / winsPerCard) > Math.floor(previous.wins / winsPerCard);
      const lossReward = Math.floor(losses / lossesPerCard) > Math.floor(previous.losses / lossesPerCard);
      const source = winReward && !lossReward ? "win_reward" : lossReward && !winReward ? "loss_reward" : "match_reward";
      if (!Number.isSafeInteger(after)) throw new RuleError("回避卡数量超出有效范围");
      store.db.prepare("UPDATE avoidance_accounts SET balance=? WHERE uid=?").run(after, uid);
      store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)")
        .run(randomUUID(), uid, amount, after, source, "胜负累计奖励：失利每2场、胜利每4场", matchIds[0], store.clock());
    }
    store.db.prepare(`INSERT INTO avoidance_reward_accounts VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET
      wins=excluded.wins,losses=excluded.losses,issued=excluded.issued`).run(uid, wins, losses, Math.max(issued, earned));
  }
}

module.exports = { initialize, registerStart, reconcile };
