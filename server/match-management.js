"use strict";
const { RuleError } = require("./engine");
const scoring = require("./scoring");
const fun = require("./fun");
const fail = (ok, message, status = 400) => {
  if (!ok) throw new RuleError(message, status);
};
const states = { active: "正常", excluded: "不计战绩", deleted: "已删除" };

function initialize(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS match_controls(
    match_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('active','excluded','deleted')),
    previous_state TEXT NOT NULL DEFAULT 'active', previous_reason TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL);
    CREATE VIEW IF NOT EXISTS visible_match_players AS
      SELECT p.match_id,p.uid,p.board,p.faction,
        CASE WHEN c.state='excluded' THEN 'excluded' ELSE p.outcome END AS outcome,p.ended,p.snapshot
      FROM match_players p LEFT JOIN match_controls c ON c.match_id=p.match_id
      WHERE c.state IS NULL OR c.state<>'deleted';
    CREATE VIEW IF NOT EXISTS active_match_scores AS
      SELECT s.rowid AS rowid,s.* FROM match_scores s LEFT JOIN match_controls c ON c.match_id=s.match_id
      WHERE c.state IS NULL OR c.state='active';`);
}
function control(store, id) {
  return (
    store.db
      .prepare("SELECT * FROM match_controls WHERE match_id=?")
      .get(id) || { state: "active", reason: "", previous_state: "active" }
  );
}
function present(store, id, game, player) {
  const c = control(store, id);
  if (c.state === "active") return { game, player };
  const reason =
    c.state === "deleted"
      ? "管理员已删除本局记录"
      : c.reason || "管理员设置不计战绩";
  return {
    game: { ...game, excludedReason: reason, recordStatus: c.state },
    player: {
      ...player,
      outcome: "excluded",
      score: { status: "excluded", total: 0, breakdown: [], reason },
      fun: { status: "excluded", reason, metrics: [], events: [] },
    },
  };
}
function detail(store, id) {
  const row = store.db
    .prepare("SELECT snapshot FROM matches WHERE id=?")
    .get(id);
  fail(row, "对局不存在", 404);
  const game = JSON.parse(row.snapshot),
    c = control(store, id);
  const players = store.db
    .prepare(
      "SELECT uid,snapshot FROM match_players WHERE match_id=? ORDER BY json_extract(snapshot,'$.seat')",
    )
    .all(id)
    .map((row) => {
      const p = JSON.parse(row.snapshot);
      return {
        uid: row.uid,
        name: p.name,
        seat: p.seat,
        outcome: p.outcome,
        points: p.score?.total ?? null,
        alive: p.alive ?? true,
        companion: row.uid.startsWith("test:"),
      };
    });
  return {
    id,
    code: game.code,
    game: game.game,
    boardName: game.boardName,
    capacity: game.capacity,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    winner: game.winner,
    revision: game.scoreRevision || 0,
    state: c.state,
    stateLabel: states[c.state],
    reason: c.reason,
    previousState: c.previous_state,
    correctionKind:
      game.scorePolicy && !game.scoreEligibilityReason ? "score" : "fun",
    needsActor: fun.modeFor(game.board) === "knights" && !!game.funFacts,
    options:
      c.state !== "active"
        ? []
        : game.scorePolicy && !game.scoreEligibilityReason
          ? scoring.optionsFor(game.board, game.scorePolicy)
          : game.funFacts && game.excludedReason !== "对局终止"
            ? fun.settlementOptions(game.board)
            : [],
    test: game.recordPurpose === "test",
    companion: players.some((p) => p.companion),
    players,
  };
}
function list(store, query) {
  const allowed = new Set([
    "code",
    "uid",
    "from",
    "to",
    "state",
    "companion",
    "offset",
  ]);
  for (const key of query.keys())
    fail(allowed.has(key) && query.getAll(key).length === 1, "查询参数无效");
  const code = query.get("code"),
    uid = query.get("uid"),
    state = query.get("state") || "visible",
    offset = query.get("offset") || "0";
  fail(!code || /^\d{6}$/.test(code), "请输入6位房间号");
  fail(!uid || uid.length <= 500, "玩家标识无效");
  fail(
    ["visible", "active", "excluded", "deleted", "all"].includes(state),
    "记录状态无效",
  );
  fail(/^(0|[1-9]\d{0,6})$/.test(offset), "页码无效");
  fail(
    !query.has("companion") || query.get("companion") === "1",
    "陪测筛选无效",
  );
  const where = [],
    args = [];
  if (code) {
    where.push("json_extract(m.snapshot,'$.code')=?");
    args.push(code);
  }
  if (uid) {
    where.push(
      "EXISTS(SELECT 1 FROM match_players p WHERE p.match_id=m.id AND p.uid=?)",
    );
    args.push(uid);
  }
  if (state !== "all") {
    where.push(
      state === "visible"
        ? "coalesce(c.state,'active')<>'deleted'"
        : "coalesce(c.state,'active')=?",
    );
    if (state !== "visible") args.push(state);
  }
  for (const field of ["from", "to"])
    if (query.get(field)) {
      const raw = query.get(field);
      fail(/^\d{4}-\d{2}-\d{2}$/.test(raw), "日期格式无效");
      const value = Date.parse(raw + "T00:00:00+08:00");
      fail(
        Number.isFinite(value) &&
          new Date(value + 8 * 3600000).toISOString().slice(0, 10) === raw,
        "日期无效",
      );
      where.push(
        `json_extract(m.snapshot,'$.endedAt')${field === "from" ? ">=" : "<"}?`,
      );
      args.push(value + (field === "to" ? 86400000 : 0));
    }
  fail(
    !query.get("from") ||
      !query.get("to") ||
      query.get("from") <= query.get("to"),
    "开始日期不能晚于结束日期",
  );
  if (query.has("companion"))
    where.push(
      "EXISTS(SELECT 1 FROM match_players p WHERE p.match_id=m.id AND p.uid LIKE 'test:%')",
    );
  const sql =
    " FROM matches m LEFT JOIN match_controls c ON c.match_id=m.id" +
    (where.length ? " WHERE " + where.join(" AND ") : "");
  const total = store.db.prepare("SELECT count(*) AS n" + sql).get(...args).n;
  const matches = store.db
    .prepare(
      "SELECT m.id" +
        sql +
        " ORDER BY json_extract(m.snapshot,'$.endedAt') DESC,m.id DESC LIMIT 20 OFFSET ?",
    )
    .all(...args, Number(offset))
    .map((row) => detail(store, row.id));
  return {
    matches,
    total,
    offset: Number(offset),
    pageSize: 20,
    hasMore: Number(offset) + matches.length < total,
    timezone: "Asia/Shanghai",
  };
}
function validate(store, input) {
  fail(
    ["delete", "restore", "exclude", "include"].includes(input.action),
    "对局管理操作无效",
  );
  fail(
    input.reason === undefined ||
      (typeof input.reason === "string" && input.reason.length <= 200),
    "操作备注最多200字",
  );
  fail(
    Array.isArray(input.matches) &&
      input.matches.length > 0 &&
      input.matches.length <= 20,
    "每次请选择1至20场对局",
  );
  fail(
    input.matches.every(
      (m) =>
        m &&
        typeof m.id === "string" &&
        /^[a-f0-9-]{36}$/.test(m.id) &&
        Number.isSafeInteger(m.revision),
    ),
    "对局参数无效",
  );
  fail(
    new Set(input.matches.map((m) => m.id)).size === input.matches.length,
    "不能重复选择同一对局",
  );
  return input.matches.map((m) => {
    const d = detail(store, m.id);
    fail(d.revision === m.revision, "对局已更新，请重新加载并预览", 409);
    const allowed = {
      delete: d.state !== "deleted",
      restore: d.state === "deleted",
      exclude: d.state === "active",
      include: d.state === "excluded",
    };
    fail(allowed[input.action], "所选对局状态已变化，请重新选择", 409);
    return d;
  });
}
function change(store, input) {
  if (!store.inTransaction) throw Error("对局管理必须在事务中执行");
  const selected = validate(store, input),
    uids = new Set();
  for (const d of selected) {
    const next =
      input.action === "delete"
        ? "deleted"
        : input.action === "restore"
          ? d.previousState
          : input.action === "exclude"
            ? "excluded"
            : "active";
    const c = control(store, d.id),
      reason =
        input.reason?.trim() ||
        (input.action === "exclude" ? "管理员设置不计战绩" : "");
    store.db
      .prepare(
        `INSERT INTO match_controls(match_id,state,previous_state,previous_reason,reason,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET
      state=excluded.state,previous_state=excluded.previous_state,previous_reason=excluded.previous_reason,reason=excluded.reason,updated=excluded.updated`,
      )
      .run(
        d.id,
        next,
        input.action === "delete" ? d.state : c.previous_state,
        input.action === "delete" ? c.reason : c.previous_reason || "",
        input.action === "restore" ? c.previous_reason || "" : reason,
        store.clock(),
      );
    const game = JSON.parse(
      store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(d.id)
        .snapshot,
    );
    game.scoreRevision = d.revision + 1;
    store.db
      .prepare("UPDATE matches SET snapshot=? WHERE id=?")
      .run(JSON.stringify(game), d.id);
    d.players.forEach((p) => uids.add(p.uid));
  }
  for (const uid of uids) store.rebuildScores(uid);
  store.syncScoreRooms();
  store.invalidateLeaderboard();
  return {
    matches: selected.map((d) => ({
      id: d.id,
      code: d.code,
      before: d.state,
      after: control(store, d.id).state,
      revision: d.revision + 1,
    })),
    affectedPlayers: uids.size,
  };
}
function preview(store, input) {
  if (!store.inTransaction) throw Error("预览必须在事务中执行");
  const selected = validate(store, input),
    players = new Map();
  for (const d of selected) for (const p of d.players) players.set(p.uid, p);
  const summary = (uid) => {
    const stats = store.statsFor(uid);
    return {
      games: stats.total,
      wins: stats.wins,
      points: stats.score.total,
      streak: stats.score.current,
      fun: stats.fun.metrics.reduce(
        (sum, metric) => sum + (metric.count || 0),
        0,
      ),
    };
  };
  const before = new Map([...players.keys()].map((uid) => [uid, summary(uid)])),
    dirty = store.leaderboardDirty;
  store.db.exec("SAVEPOINT match_preview");
  try {
    change(store, input);
    return {
      matches: selected,
      affectedPlayers: players.size,
      players: [...players.values()].map((p) => ({
        uid: p.uid,
        name: p.name,
        companion: p.companion,
        before: before.get(p.uid),
        after: summary(p.uid),
      })),
    };
  } finally {
    store.db.exec("ROLLBACK TO match_preview; RELEASE match_preview");
    store.leaderboardDirty = dirty;
  }
}
module.exports = {
  initialize,
  control,
  present,
  detail,
  list,
  validate,
  change,
  preview,
};
