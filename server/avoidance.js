"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const fail = (ok, message, status = 400) => {
  if (!ok) throw new (require("./engine").RuleError)(message, status);
};
const eligible = uid => /^(wx|dev|guest):/.test(uid);
const avoidanceGrants = "'admin','match_reward','loss_reward','win_reward'";
const factionGrants = "'faction_reward','faction_admin'";
const allCardGrants = avoidanceGrants + "," + factionGrants;

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS avoidance_accounts(uid TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance>=0));
    CREATE TABLE IF NOT EXISTS avoidance_ledger(id TEXT PRIMARY KEY, uid TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL, match_id TEXT, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS avoidance_ledger_user ON avoidance_ledger(uid,created DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS avoidance_spend_match ON avoidance_ledger(uid,match_id) WHERE source='spend';
    CREATE UNIQUE INDEX IF NOT EXISTS faction_spend_match ON avoidance_ledger(uid,match_id) WHERE source='faction_spend';
    CREATE INDEX IF NOT EXISTS card_spends_by_match ON avoidance_ledger(match_id) WHERE source IN ('spend','faction_spend');
    CREATE TABLE IF NOT EXISTS avoidance_grant_reads(uid TEXT NOT NULL, ledger_id TEXT NOT NULL, PRIMARY KEY(uid,ledger_id));`);
  store.transaction(() => {
    if (!store.db.prepare("PRAGMA table_info(avoidance_accounts)").all().some(column => column.name === "faction_balance"))
      store.db.exec("ALTER TABLE avoidance_accounts ADD COLUMN faction_balance INTEGER NOT NULL DEFAULT 0 CHECK(faction_balance>=0)");
    const known = store.db.prepare(`SELECT uid FROM profiles UNION SELECT uid FROM sessions UNION SELECT uid FROM match_players
      UNION SELECT json_extract(p.value,'$.uid') FROM rooms r,json_each(r.state,'$.players') p
      UNION SELECT json_extract(p.value,'$.uid') FROM rooms r,json_each(r.state,'$.spectators') p`).all();
    for (const { uid } of known) ensureAccount(store, uid);
  });
}
function ensureAccount(store, uid) {
  const insert = () => {
    store.db.prepare("INSERT OR IGNORE INTO avoidance_accounts(uid,balance) VALUES(?,0)").run(uid);
  };
  if (store.db.prepare("SELECT 1 FROM avoidance_accounts WHERE uid=?").get(uid)) return;
  if (store.inTransaction) insert(); else store.transaction(insert);
}
function balances(store, uid) {
  ensureAccount(store, uid);
  return store.db.prepare("SELECT balance,faction_balance AS factionBalance FROM avoidance_accounts WHERE uid=?").get(uid);
}
function balance(store, uid, factionCard = false) {
  const cards = balances(store, uid);
  return factionCard ? cards.factionBalance : cards.balance;
}
function entryBalances(store, uid) {
  const cards = balances(store, uid);
  return { balance: cards.balance, totalBalance: cards.balance + cards.factionBalance };
}
function wallet(store, uid) {
  return { ...grantNotice(store, uid), history: store.db.prepare(`SELECT id,delta,balance,source,note,created FROM avoidance_ledger WHERE uid=? AND source NOT IN (${factionGrants},'faction_spend','faction_refund') ORDER BY created DESC,rowid DESC LIMIT 30`).all(uid) };
}
function grantNotice(store, uid, includeFaction = false) {
  const grantSources = includeFaction ? allCardGrants : avoidanceGrants;
  const rows = store.db.prepare(`SELECT l.id,l.delta,l.source,l.note FROM avoidance_ledger l
    LEFT JOIN avoidance_grant_reads r ON r.uid=l.uid AND r.ledger_id=l.id
    WHERE l.uid=? AND l.source IN (${grantSources}) AND l.delta>0 AND r.ledger_id IS NULL ORDER BY l.rowid`).all(uid);
  const sources = new Set(rows.map(row => row.source));
  const reasons = [...new Set(rows.filter(row => row.source === "admin" || row.source === "faction_admin").map(row => row.note.trim()).filter(Boolean))];
  const factionAmount = rows.filter(row => row.source === "faction_reward" || row.source === "faction_admin").reduce((sum, row) => sum + row.delta, 0);
  const counts = includeFaction ? entryBalances(store, uid) : { balance: balance(store, uid) };
  return { ...counts, notice: rows.length ? {
    through: rows[rows.length - 1].id, amount: rows.reduce((n, row) => n + row.delta, 0), grants: rows.length,
    ...(factionAmount ? { factionAmount } : {}),
    kind: sources.size === 1 ? ({ loss_reward: "loss", win_reward: "win" }[rows[0].source] || "generic") : "generic",
    ...(reasons.length ? { reasons } : {}),
  } : null };
}
function acknowledgeGrant(store, uid, input, includeFaction = false) {
  const grantSources = includeFaction ? allCardGrants : avoidanceGrants;
  fail(typeof input.through === "string" && /^[a-f0-9-]{36}$/.test(input.through), "通知编号无效");
  return store.transaction(() => {
    const row = store.db.prepare(`SELECT rowid FROM avoidance_ledger WHERE uid=? AND id=? AND source IN (${grantSources}) AND delta>0`).get(uid, input.through);
    fail(row, "通知不存在", 404);
    // Acknowledge only the grants actually displayed; concurrent grants stay unread.
    store.db.prepare(`INSERT OR IGNORE INTO avoidance_grant_reads(uid,ledger_id)
      SELECT uid,id FROM avoidance_ledger WHERE uid=? AND rowid<=? AND source IN (${grantSources}) AND delta>0`).run(uid, row.rowid);
    return { acknowledged: true };
  });
}

function choiceResult(choice, role, roles) {
  const faction = choice.faction;
  const effective = faction ? roles[role][1] === faction : role !== choice;
  return { ...(faction ? { faction } : { role: choice }), status: effective ? "effective" : "ineffective" };
}
// Count optimal completions over labelled card slots, then sample by their
// counts. This maximizes fulfilled requests and gives every optimal deal equal
// probability, including decks containing several copies of the same role.
function deal(players, cards, choices, shuffle, roles) {
  if (!players.some(p => choices?.[p.uid])) return shuffle(cards);
  const penalties = players.map(p => cards.map(role =>
    choices[p.uid] && choiceResult(choices[p.uid], role, roles).status === "ineffective" ? 1 : 0));
  const n = cards.length, full = (1 << n) - 1, memo = new Map();
  function solve(mask, index) {
    if (mask === full) return { cost: 0, count: 1 };
    if (memo.has(mask)) return memo.get(mask);
    let cost = Infinity, count = 0;
    for (let j = 0; j < n; j++) if (!(mask & (1 << j))) {
      const next = solve(mask | (1 << j), index + 1);
      const value = next.cost + penalties[index][j];
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
      if (next.cost + penalties[i][j] !== best.cost) continue;
      if (pick < next.count) { result.push(cards[j]); mask |= 1 << j; break; }
      pick -= next.count;
    }
  }
  return result;
}
function prepare(store, room) {
  room.avoidanceUnavailable = {};
  for (const [uid, choice] of Object.entries(room.avoidanceChoices || {})) {
    if (!room.players.some(p => p.uid === uid)) { delete room.avoidanceChoices[uid]; continue; }
    if (balance(store, uid, !!choice.faction) < 1) {
      room.avoidanceUnavailable[uid] = { ...(choice.faction ? choice : { role: choice }), status: "unavailable" };
      delete room.avoidanceChoices[uid];
    }
  }
}
function settle(store, room) {
  for (const [uid, result] of Object.entries(room.avoidanceResults || {})) {
    if (result.status !== "effective") continue;
    const column = result.faction ? "faction_balance" : "balance";
    const changed = store.db.prepare(`UPDATE avoidance_accounts SET ${column}=${column}-1 WHERE uid=? AND ${column}>0`).run(uid);
    fail(changed.changes === 1, "用卡余额已变化，请重新发放身份", 409);
    store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(), uid, -1, balance(store, uid, !!result.faction), result.faction ? "faction_spend" : "spend",
        result.faction ? "本局阵营卡生效" : "本局回避生效", room.matchId, store.clock());
  }
}
function refundUnrecordedMatch(store, room) {
  fail(store.inTransaction, "用卡退还需要在事务中执行");
  if (!room.matchId) return;
  // A refund is keyed to the original debit, including for games dealt before this upgrade.
  const spends = store.db.prepare(`SELECT s.uid, s.source, -s.delta AS amount, 'refund:' || s.id AS refundId
    FROM avoidance_ledger s WHERE s.match_id=? AND s.source IN ('spend','faction_spend') AND s.delta<0
    AND NOT EXISTS (SELECT 1 FROM avoidance_ledger r WHERE r.id='refund:' || s.id)`).all(room.matchId);
  for (const { uid, source, amount, refundId } of spends) {
    const faction = source === "faction_spend", column = faction ? "faction_balance" : "balance";
    const after = balance(store, uid, faction) + amount;
    fail(Number.isSafeInteger(after), "卡片数量超出有效范围");
    store.db.prepare(`UPDATE avoidance_accounts SET ${column}=? WHERE uid=?`).run(after, uid);
    store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)")
      .run(refundId, uid, amount, after, faction ? "faction_refund" : "refund", "本局不计战绩，退还用卡", room.matchId, store.clock());
    if (room.avoidanceResults?.[uid]) room.avoidanceResults[uid].refunded = true;
  }
}
function resultView(store, room, uid) {
  const result = room.avoidanceResults?.[uid];
  if (!result) return null;
  return { ...result, ...(result.role ? { roleName: require("./engine").roleName(result.role) } : {}), balance: balance(store, uid, !!result.faction) };
}
function roomView(store, room, uid) {
  const { publicView, avoidanceOptions } = require("./engine");
  const view = publicView(room, uid); // Check membership before reading private data.
  const choice = room.phase === "lobby" ? room.avoidanceChoices?.[uid] : null;
  return { code: room.code, stage: room.stage, game: room.game, phase: room.phase,
    ...balances(store, uid),
    selected: typeof choice === "string" ? choice : null, selectedFaction: choice?.faction || null,
    editable: room.phase === "lobby" && view.me.seat !== null,
    options: room.phase === "lobby" ? avoidanceOptions(room).map(o => ({ ...o, portrait: require("../miniprogram/role-portraits").portrait(o.name, o.faction).portrait })) : [] };
}

function players(store, query = "", offset = 0) {
  fail(typeof query === "string" && query.length <= 200, "搜索内容最多200字");
  fail(Number.isSafeInteger(offset) && offset >= 0, "分页参数无效");
  const sql = `SELECT a.uid,a.balance,a.faction_balance AS factionBalance,coalesce(nullif(f.nickname,''),
    (SELECT json_extract(p.snapshot,'$.name') FROM match_players p WHERE p.uid=a.uid ORDER BY p.ended DESC LIMIT 1),
    (SELECT json_extract(p.value,'$.name') FROM rooms r,json_each(r.state,'$.players') p WHERE json_extract(p.value,'$.uid')=a.uid LIMIT 1),'未设置昵称') AS name
    FROM avoidance_accounts a LEFT JOIN profiles f ON f.uid=a.uid WHERE (a.uid LIKE 'wx:%' OR a.uid LIKE 'dev:%' OR a.uid LIKE 'guest:%')`;
  const rows = store.db.prepare(`SELECT * FROM (${sql}) WHERE ?='' OR instr(lower(name),lower(?))>0 OR uid=? ORDER BY name,uid LIMIT 51 OFFSET ?`).all(query, query, query, offset);
  return { players: rows.slice(0, 50), hasMore: rows.length > 50, offset,
    total: store.db.prepare(`SELECT count(*) AS n FROM (${sql})`).get().n };
}
function grant(store, input) {
  fail(store.inTransaction, "发放需要在事务中执行");
  const { cardType = "avoidance" } = input;
  fail(["avoidance", "faction"].includes(cardType), "请选择有效的卡片类型");
  fail(["player", "all"].includes(input.scope), "请选择发放范围");
  fail(Number.isSafeInteger(input.amount) && input.amount >= 1 && input.amount <= 100, "每人发放数量须为1至100张整数");
  fail(input.reason === undefined || typeof input.reason === "string" && input.reason.length <= 200, "发放原因最多200字");
  const reason = (input.reason || "").trim();
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
  const faction = cardType === "faction";
  const update = store.db.prepare(`UPDATE avoidance_accounts SET ${faction ? "faction_balance" : "balance"}=? WHERE uid=?`);
  const record = store.db.prepare("INSERT INTO avoidance_ledger VALUES(?,?,?,?,?,?,?,?)");
  for (const { uid } of targets) {
    const after = balance(store, uid, faction) + input.amount;
    fail(Number.isSafeInteger(after), "卡片数量超出有效范围");
    update.run(after, uid);
    record.run(randomUUID(), uid, input.amount, after, faction ? "faction_admin" : "admin", reason, null, created);
  }
  return { batchId, recipients: targets.length, amount: input.amount, cardType };
}
module.exports = { initialize, eligible, ensureAccount, balance, entryBalances, wallet, grantNotice, acknowledgeGrant, choiceResult, deal, prepare, settle, refundUnrecordedMatch, resultView, roomView, players, grant };
