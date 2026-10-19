"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const fail = (ok, message, status = 400) => {
  if (!ok) throw new (require("./engine").RuleError)(message, status);
};
const eligible = uid => /^(wx|dev|guest):/.test(uid);

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS avoidance_accounts(uid TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0));
    CREATE TABLE IF NOT EXISTS avoidance_ledger(id TEXT PRIMARY KEY, uid TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL, match_id TEXT, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS avoidance_ledger_user ON avoidance_ledger(uid,created DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS avoidance_spend_match ON avoidance_ledger(uid,match_id) WHERE source='spend';`);
  store.transaction(() => {
    const known = store.db.prepare(`SELECT uid FROM profiles UNION SELECT uid FROM sessions UNION SELECT uid FROM match_players
      UNION SELECT json_extract(p.value,'$.uid') FROM rooms r,json_each(r.state,'$.players') p
      UNION SELECT json_extract(p.value,'$.uid') FROM rooms r,json_each(r.state,'$.spectators') p`).all();
    for (const { uid } of known) ensureAccount(store, uid);
  });
}
function ensureAccount(store, uid) {
  const insert = () => {
    store.db.prepare("INSERT OR IGNORE INTO avoidance_accounts VALUES(?,0)").run(uid);
  };
  if (store.db.prepare("SELECT 1 FROM avoidance_accounts WHERE uid=?").get(uid)) return;
  if (store.inTransaction) insert(); else store.transaction(insert);
}
function balance(store, uid) {
  ensureAccount(store, uid);
  return store.db.prepare("SELECT balance FROM avoidance_accounts WHERE uid=?").get(uid).balance;
}
function wallet(store, uid) {
  return { balance: balance(store, uid), history: store.db.prepare("SELECT id,delta,balance,source,note,created FROM avoidance_ledger WHERE uid=? ORDER BY created DESC,rowid DESC LIMIT 30").all(uid) };
}

// Count optimal completions over labelled card slots, then sample by their
// counts. This maximizes fulfilled requests and gives every optimal deal equal
// probability, including decks containing several copies of the same role.
function deal(players, cards, choices, shuffle) {
  if (!players.some(p => choices?.[p.uid])) return shuffle(cards);
  const n = cards.length, full = (1 << n) - 1, memo = new Map();
  function solve(mask, index) {
    if (mask === full) return { cost: 0, count: 1 };
    if (memo.has(mask)) return memo.get(mask);
    let cost = Infinity, count = 0;
    for (let j = 0; j < n; j++) if (!(mask & (1 << j))) {
      const next = solve(mask | (1 << j), index + 1);
      const value = next.cost + (choices?.[players[index].uid] === cards[j] ? 1 : 0);
      if (value < cost) { cost = value; count = next.count; }
      else if (value === cost) count += next.count;
    }
    const result = { cost, count }; memo.set(mask, result); return result;
  }
  const result = []; let mask = 0;
  for (let i = 0; i < n; i++) {
    const best = solve(mask, i); let pick = randomInt(best.count);
    for (let j = 0; j < n; j++) if (!(mask & (1 << j))) {
      const next = solve(mask | (1 << j), i + 1);
      if (next.cost + (choices?.[players[i].uid] === cards[j] ? 1 : 0) !== best.cost) continue;
      if (pick < next.count) { result.push(cards[j]); mask |= 1 << j; break; }
      pick -= next.count;
    }
  }
  return result;
}
function prepare(store, room) {
  room.avoidanceUnavailable = {};
  for (const [uid, role] of Object.entries(room.avoidanceChoices || {})) {
    if (!room.players.some(p => p.uid === uid)) { delete room.avoidanceChoices[uid]; continue; }
    if (balance(store, uid) < 1) {
      room.avoidanceUnavailable[uid] = { role, status: "unavailable" };
      delete room.avoidanceChoices[uid];
    }
  }
}
function settle(store, room) {
  for (const [uid, result] of Object.entries(room.avoidanceResults || {})) {
    if (result.status !== "effective") continue;
    const changed = store.db.prepare("UPDATE avoidance_accounts SET balance=balance-1 WHERE uid=? AND balance>0").run(uid);
    fail(changed.changes === 1, "回避卡余额已变化，请重新发放身份", 409);
    store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(), uid, -1, balance(store, uid), "spend", "本局回避生效", room.matchId, store.clock());
  }
}
function resultView(store, room, uid) {
  const result = room.avoidanceResults?.[uid];
  if (!result) return null;
  return { ...result, roleName: require("./engine").roleName(result.role), balance: balance(store, uid) };
}
function roomView(store, room, uid) {
  const { publicView, avoidanceOptions } = require("./engine");
  const view = publicView(room, uid); // Check membership before reading private data.
  return { code: room.code, stage: room.stage, game: room.game, phase: room.phase,
    balance: balance(store, uid), selected: room.phase === "lobby" ? room.avoidanceChoices?.[uid] || null : null,
    editable: room.phase === "lobby" && view.me.seat !== null,
    options: room.phase === "lobby" ? avoidanceOptions(room).map(o => ({ ...o, portrait: require("../miniprogram/role-portraits").portrait(o.name, o.faction).portrait })) : [] };
}

function players(store, query = "", offset = 0) {
  fail(typeof query === "string" && query.length <= 200, "搜索内容最多200字");
  fail(Number.isSafeInteger(offset) && offset >= 0, "分页参数无效");
  const sql = `SELECT a.uid,a.balance,coalesce(nullif(f.nickname,''),
    (SELECT json_extract(p.snapshot,'$.name') FROM match_players p WHERE p.uid=a.uid ORDER BY p.ended DESC LIMIT 1),
    (SELECT json_extract(p.value,'$.name') FROM rooms r,json_each(r.state,'$.players') p WHERE json_extract(p.value,'$.uid')=a.uid LIMIT 1),'未设置昵称') AS name
    FROM avoidance_accounts a LEFT JOIN profiles f ON f.uid=a.uid WHERE (a.uid LIKE 'wx:%' OR a.uid LIKE 'dev:%' OR a.uid LIKE 'guest:%')`;
  const rows = store.db.prepare(`SELECT * FROM (${sql}) WHERE ?='' OR instr(lower(name),lower(?))>0 OR uid=? ORDER BY name,uid LIMIT 51 OFFSET ?`).all(query, query, query, offset);
  return { players: rows.slice(0, 50), hasMore: rows.length > 50, offset,
    total: store.db.prepare(`SELECT count(*) AS n FROM (${sql})`).get().n };
}
function grant(store, input) {
  fail(store.inTransaction, "发放需要在事务中执行");
  fail(["player", "all"].includes(input.scope), "请选择发放范围");
  fail(Number.isSafeInteger(input.amount) && input.amount >= 1 && input.amount <= 100, "每人发放数量须为1至100张整数");
  fail(typeof input.reason === "string" && input.reason.trim().length >= 1 && input.reason.length <= 200, "请填写发放原因，最多200字");
  let targets;
  if (input.scope === "all") {
    targets = store.db.prepare("SELECT uid FROM avoidance_accounts WHERE uid LIKE 'wx:%' OR uid LIKE 'dev:%' OR uid LIKE 'guest:%' ORDER BY uid").all();
    fail(Number.isSafeInteger(input.expectedCount) && input.expectedCount === targets.length, "玩家人数已变化，请刷新后重新确认", 409);
  } else {
    fail(typeof input.uid === "string" && eligible(input.uid), "请选择有效玩家");
    fail(store.db.prepare("SELECT 1 FROM avoidance_accounts WHERE uid=?").get(input.uid), "玩家不存在", 404);
    targets = [{ uid: input.uid }];
  }
  fail(targets.length > 0, "暂无可发放的玩家");
  const batchId = randomUUID(), created = store.clock();
  for (const { uid } of targets) {
    const after = balance(store, uid) + input.amount;
    fail(Number.isSafeInteger(after), "回避卡数量超出有效范围");
    store.db.prepare("UPDATE avoidance_accounts SET balance=? WHERE uid=?").run(after, uid);
    store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(), uid, input.amount, after, "admin", input.reason.trim(), null, created);
  }
  return { batchId, recipients: targets.length, amount: input.amount };
}
module.exports = { initialize, ensureAccount, balance, wallet, deal, prepare, settle, resultView, roomView, players, grant };
