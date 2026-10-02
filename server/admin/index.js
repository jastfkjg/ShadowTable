"use strict";
const {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { auditGroups } = require("../audit");
const scoring = require("../scoring");
const fun = require("../fun");
const { RuleError, command, roomSummary } = require("../engine");
const digest = (s) => createHash("sha256").update(s).digest();
const fail = (ok, message, status = 400) => {
  if (!ok) throw new RuleError(message, status);
};
function createAdmin({ store, origin, key, body, limit }) {
  const url = new URL(origin);
  fail(url.origin === origin, "ADMIN_ORIGIN 必须是完整的源地址，不含路径");
  fail(key.length >= 32, "ADMIN_KEY 至少32字符");
  fail(
    url.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)),
    "管理平台必须使用 HTTPS",
  );
  const secure = url.protocol === "https:";
  const cookieName = secure ? "__Host-shadowtable_admin" : "shadowtable_admin";
  const sessions = new Map();
  const keyHash = digest(key);
  const cookie = (token, age) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  function authenticate(req) {
    fail(req.headers.host === url.host, "管理平台域名不匹配", 403);
    fail(req.headers["sec-fetch-site"] !== "cross-site", "禁止跨站请求", 403);
    if (req.method !== "GET")
      fail(req.headers.origin === origin, "请求来源不匹配", 403);
    const raw =
      (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1) || "";
    const session = sessions.get(digest(raw).toString("hex"));
    fail(session && session.expires > Date.now(), "请先登录管理平台", 401);
    return { ...session, hash: digest(raw).toString("hex") };
  }
  function asset(res, file, type) {
    res.setHeader("Content-Type", type);
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    res.setHeader("X-Frame-Options", "DENY");
    res.writeHead(200);
    res.end(readFileSync(file));
  }
  function audit(action, code, reason = "") {
    store.db
      .prepare(
        "INSERT INTO admin_audit(action,code,reason,created) VALUES(?,?,?,?)",
      )
      .run(action, code || "", reason, Date.now());
  }
  const describe = (room) => ({
    ...roomSummary(room, room.host),
    phase: room.phase,
    stage: room.stage,
    testRoom: room.testRoom === true,
    players: room.players.length,
  });
  async function handle(req, res, path, send) {
    if (
      !path.startsWith("/api/admin/") &&
      path !== "/admin" &&
      !path.startsWith("/admin/")
    )
      return false;
    fail(req.headers.host === url.host, "管理平台域名不匹配", 403);
    if (req.method === "GET") {
      if (path === "/admin/icon.svg") {
        asset(res, join(__dirname, "../dev-panel/icon.svg"), "image/svg+xml");
        return true;
      }
      const assets = {
        "/admin": ["index.html", "text/html; charset=utf-8"],
        "/admin/": ["index.html", "text/html; charset=utf-8"],
        "/admin/app.js": ["app.js", "text/javascript; charset=utf-8"],
        "/admin/style.css": ["style.css", "text/css; charset=utf-8"],
      };
      if (assets[path]) {
        asset(res, join(__dirname, assets[path][0]), assets[path][1]);
        return true;
      }
      const companionAssets = {
        "/admin/companion": ["index.html", "text/html; charset=utf-8"],
        "/admin/companion/panel.js": [
          "panel.js",
          "text/javascript; charset=utf-8",
        ],
        "/admin/companion/panel.css": ["panel.css", "text/css; charset=utf-8"],
        "/admin/companion/icon.svg": ["icon.svg", "image/svg+xml"],
      };
      if (companionAssets[path]) {
        authenticate(req);
        const [file, type] = companionAssets[path];
        if (file === "index.html") {
          let html = readFileSync(
            join(__dirname, "../dev-panel/index.html"),
            "utf8",
          )
            .replaceAll("/dev/", "/admin/companion/")
            .replaceAll("仅本机开发", "已认证 · 测试房间")
            .replaceAll("本地陪测", "在线陪测")
            .replaceAll("LOCAL PLAYTEST", "AUTHORIZED PLAYTEST");
          html = html.replace(
            '<section class="entry">',
            '<p><a href="/admin">返回管理平台</a> · 仅允许加入已标记的测试房间。</p><section class="entry">',
          );
          res.setHeader("Content-Type", type);
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          );
          send(200, html, true);
        } else asset(res, join(__dirname, "../dev-panel", file), type);
        return true;
      }
    }
    if (path === "/api/admin/login" && req.method === "POST") {
      fail(
        req.headers.origin === origin &&
          req.headers["sec-fetch-site"] !== "cross-site",
        "请求来源不匹配",
        403,
      );
      limit("admin-login", 10);
      const b = await body(req);
      fail(
        typeof b.key === "string" && timingSafeEqual(digest(b.key), keyHash),
        "管理密钥错误",
        401,
      );
      for (const [id, s] of sessions)
        if (s.expires <= Date.now()) sessions.delete(id);
      fail(sessions.size < 100, "管理员会话过多，请稍后重试", 429);
      const token = randomBytes(32).toString("hex");
      sessions.set(digest(token).toString("hex"), {
        expires: Date.now() + 8 * 3600000,
      });
      audit("login");
      res.setHeader("Set-Cookie", cookie(token, 8 * 3600));
      send(200, { ok: true });
      return true;
    }
    if (path === "/api/admin/session" && req.method === "GET") {
      try {
        authenticate(req);
        send(200, { authenticated: true });
      } catch (error) {
        if (error.status !== 401) throw error;
        send(200, { authenticated: false });
      }
      return true;
    }
    const session = authenticate(req);
    limit("admin:" + session.hash, 600);
    const scoringMutation = (path,input,action,operation) => {
      fail(typeof input.reason === "string" && input.reason.trim().length>=2 && input.reason.length<=200,"请填写2–200字的调整原因");
      fail(typeof input.requestId === "string" && /^[a-f0-9-]{36}$/.test(input.requestId),"缺少合法请求编号");
      const actor="admin:scoring", fingerprint=digest(JSON.stringify([path,input])).toString("hex");
      return store.transaction(()=>{
        const cached=store.receipt(actor,input.requestId);
        if (cached) {fail(cached.fingerprint===fingerprint,"请求编号已用于其他操作",409);return JSON.parse(cached.result);}
        const changed=operation();
        store.db.prepare("INSERT INTO admin_audit(action,code,reason,created,details) VALUES(?,?,?,?,?)")
          .run(action,changed.code || "",input.reason.trim(),Date.now(),JSON.stringify({...changed,administrator:session.hash}));
        const response={id:changed.id,revision:changed.revision,...(changed.delta===undefined?{}:{before:changed.before,after:changed.after,delta:changed.delta})};
        store.addReceipt(actor,input.requestId,fingerprint,response);return response;
      });
    };
    if (path === "/api/admin/logout" && req.method === "POST") {
      sessions.delete(session.hash);
      res.setHeader("Set-Cookie", cookie("", 0));
      send(200, { ok: true });
      return true;
    }
    if (path === "/api/admin/rooms" && req.method === "GET") {
      const query = new URL(req.url, origin).searchParams;
      const offset = Math.max(0, Math.floor(Number(query.get("offset")) || 0));
      const rooms = store.db
        .prepare("SELECT state FROM rooms ORDER BY code LIMIT 50 OFFSET ?")
        .all(offset)
        .map((row) => describe(JSON.parse(row.state)));
      send(200, {
        rooms,
        total: store.db.prepare("SELECT count(*) AS n FROM rooms").get().n,
        offset,
      });
      return true;
    }
    if (path === "/api/admin/audit" && req.method === "GET") {
      const query = new URL(req.url, origin).searchParams;
      const code = query.get("code");
      fail(code === null || code === "" || /^\d{6}$/.test(code), "房间号无效");
      const offset = Math.max(0, Math.floor(Number(query.get("offset")) || 0));
      const where =
        " WHERE action != 'actor'" + (code === null ? "" : " AND code=?");
      const args = code === null ? [] : [code];
      const grouped = query.get("grouped") === "1";
      send(200, {
        filtered: true,
        ...(grouped
          ? auditGroups(store, code, offset)
          : {
              entries: store.db
                .prepare(
                  "SELECT id,action,code,reason,created,details FROM admin_audit" +
                    where +
                    " ORDER BY id DESC LIMIT 100 OFFSET ?",
                )
                .all(...args, offset)
                .map((entry) => ({
                  ...entry,
                  details: JSON.parse(entry.details),
                })),
              total: store.db
                .prepare("SELECT count(*) AS n FROM admin_audit" + where)
                .get(...args).n,
            }),
        rooms: store.db
          .prepare("SELECT code FROM rooms ORDER BY code")
          .all()
          .map((row) => row.code),
      });
      return true;
    }
    if (path === "/api/admin/actors" && req.method === "POST") {
      const b = await body(req);
      const room = store.get(b.code);
      fail(
        room?.testRoom && room.phase === "lobby",
        "只能在准备阶段的测试房间添加陪测玩家",
        403,
      );
      limit("admin-actors:" + session.hash, 30);
      const token = randomBytes(32).toString("hex");
      // Bind to both room and administrator session: copied player tokens alone are unusable.
      store.addSession(
        digest(token).toString("hex"),
        `test:${room.code}:${session.hash}:${randomUUID()}`,
      );
      audit("actor", room.code);
      send(200, { token });
      return true;
    }
    if (path === "/api/admin/matches" && req.method === "GET") {
      const code = new URL(req.url,origin).searchParams.get("code");
      fail(/^\d{6}$/.test(code || ""),"请输入6位房间号");
      const matches = store.db.prepare("SELECT id,snapshot FROM matches WHERE json_extract(snapshot,'$.code')=? ORDER BY json_extract(snapshot,'$.endedAt') DESC LIMIT 50").all(code).map(row=>{
        const saved=JSON.parse(row.snapshot);
        return {id:row.id,boardName:saved.boardName,endedAt:saved.endedAt,winner:saved.winner,revision:saved.scoreRevision || 0,
          correctionKind:saved.scorePolicy && !saved.scoreEligibilityReason ? "score" : "fun", needsActor:fun.modeFor(saved.board)==="knights" && !!saved.funFacts,
          options:saved.scorePolicy && !saved.scoreEligibilityReason ? scoring.optionsFor(saved.board, saved.scorePolicy) : saved.funFacts && saved.excludedReason!=="对局终止" ? fun.settlementOptions(saved.board) : [],
          players:store.db.prepare("SELECT snapshot FROM match_players WHERE match_id=?").all(row.id).map(p=>{const player=JSON.parse(p.snapshot);return {seat:player.seat,name:player.name,alive:player.alive ?? true};})};
      });
      send(200,{matches});return true;
    }
    if (path === "/api/admin/score-players" && req.method === "GET") {
      const query=new URL(req.url,origin).searchParams,search=(query.get("q") || "").trim(),offset=query.get("offset") || "0";
      fail(search.length>=1 && search.length<=200,"请输入玩家昵称或账号标识");
      fail(/^(0|[1-9]\d{0,6})$/.test(offset),"页码无效");
      send(200,store.searchScorePlayers(search,Number(offset)));return true;
    }
    if (path === "/api/admin/score-adjustments" && req.method === "GET") {
      const query=new URL(req.url,origin).searchParams,uid=query.get("uid"),offset=query.get("offset") || "0";
      fail(typeof uid==='string' && uid.length>0 && uid.length<=500 && /^(0|[1-9]\d{0,6})$/.test(offset),"玩家或页码无效");
      send(200,{...store.playerScore(uid),adjustments:store.scoreAdjustments(uid,Number(offset))});return true;
    }
    if (path === "/api/admin/score-adjustments" && req.method === "POST") {
      const input=await body(req);fail(typeof input.uid==='string' && input.uid.length>0 && input.uid.length<=500,"玩家无效");
      send(200,scoringMutation(path,input,"adjust-player-score",()=>store.adjustPlayerScore(input)));return true;
    }
    const matchScores=path.match(/^\/api\/admin\/matches\/([a-f0-9-]{36})\/scores$/);
    if (matchScores && req.method==='GET') {send(200,store.matchScoreData(matchScores[1]));return true;}
    if (matchScores && req.method==='POST') {
      const input=await body(req);
      send(200,scoringMutation(path,input,"adjust-match-scores",()=>store.adjustMatchScores(matchScores[1],input)));return true;
    }
    const correction = path.match(/^\/api\/admin\/matches\/([a-f0-9-]{36})\/correct$/);
    if (correction && req.method === "POST") {
      const b = await body(req);
      fail(typeof b.reason === "string" && b.reason.trim().length >= 2 && b.reason.length <= 200,"请填写2–200字的更正原因");
      fail(typeof b.requestId === "string" && /^[a-f0-9-]{36}$/.test(b.requestId),"缺少合法请求编号");
      const actor = "administrator:correct-result", fingerprint = digest(JSON.stringify([path,b])).toString("hex");
      const result=store.transaction(()=>{
        const cached=store.receipt(actor,b.requestId) || store.receipt("admin:"+session.hash,b.requestId);
        if(cached) {fail(cached.fingerprint===fingerprint,"请求编号已用于其他操作",409);return JSON.parse(cached.result);}
        const changed=b.funReason !== undefined ? store.correctFunMatch(correction[1],b) : store.correctMatch(correction[1],b);
        const code=JSON.parse(store.db.prepare("SELECT snapshot FROM matches WHERE id=?").get(correction[1]).snapshot).code;
        store.db.prepare("INSERT INTO admin_audit(action,code,reason,created,details) VALUES(?,?,?,?,?)").run("correct-result",code,b.reason.trim(),Date.now(),JSON.stringify(changed));
        const response={id:changed.id,winner:changed.winner,revision:changed.revision};store.addReceipt(actor,b.requestId,fingerprint,response);return response;
      });
      send(200,result);return true;
    }
    const match = path.match(/^\/api\/admin\/rooms\/(\d{6})$/);
    if (match && req.method === "POST") {
      const b = await body(req);
      fail(
        [
          "test-on",
          "test-off",
          "clear-testers",
          "terminate",
          "rematch",
          "delete",
        ].includes(b.action),
        "管理操作无效",
      );
      fail(
        b.reason === undefined ||
          (typeof b.reason === "string" && b.reason.length <= 200),
        "操作原因最多200字",
      );
      if (!["test-on", "clear-testers"].includes(b.action))
        fail(
          b.confirm === true || b.confirm === match[1],
          "请确认管理操作",
        );
      store.transaction(() => {
        const room = store.get(match[1]);
        fail(room, "房间不存在", 404);
        fail(b.stage === room.stage, "房间状态已变化，请刷新后重试", 409);
        if (b.action === "delete") {
          store.remove(room.code);
          store.db
            .prepare("DELETE FROM sessions WHERE uid LIKE ?")
            .run(`test:${room.code}:%`);
        } else {
          if (b.action === "clear-testers") {
            fail(
              room.phase === "lobby",
              "请先结束对局并同房重开，再清理陪测座位",
              409,
            );
            const humans = room.players.filter(
              (p) => !p.uid.startsWith("test:"),
            );
            if (room.host.startsWith("test:")) {
              fail(humans.length, "请先让真人入座接任房主", 409);
              room.host = humans[0].uid;
            }
            room.players = humans;
            room.spectators = (room.spectators || []).filter((p) => !p.uid.startsWith("test:"));
            // Invalidate all credentials, including actors not seated yet.
            store.db
              .prepare("DELETE FROM sessions WHERE uid LIKE ?")
              .run(`test:${room.code}:%`);
            room.stage = randomUUID();
          } else if (b.action.startsWith("test-")) {
            fail(room.phase === "lobby", "仅准备阶段可以更改测试标记", 409);
            fail(
              b.action !== "test-off" ||
                ![...room.players, ...(room.spectators || [])].some((p) => p.uid.startsWith("test:")),
              "请先清空陪测玩家",
              409,
            );
            room.testRoom = b.action === "test-on";
            if (!room.testRoom)
              store.db
                .prepare("DELETE FROM sessions WHERE uid LIKE ?")
                .run(`test:${room.code}:%`);
            room.stage = randomUUID();
          } else {
            command(room, room.host, { type: b.action, stage: room.stage });
            if (b.action === "terminate")
              room.result.reason = "管理员终止了对局，本局不判胜负";
          }
          store.save(room);
        }
        audit(b.action, room.code, (b.reason || "").trim());
      });
      send(200, { ok: true });
      return true;
    }
    throw new RuleError("管理接口不存在", 404);
  }
  return { handle, authenticate };
}
module.exports = { createAdmin };
