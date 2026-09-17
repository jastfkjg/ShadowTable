"use strict";
const {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
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
      send(200, {
        entries: store.db
          .prepare(
            "SELECT id,action,code,reason,created FROM admin_audit ORDER BY id DESC LIMIT 100",
          )
          .all(),
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
        typeof b.reason === "string" &&
          b.reason.trim().length >= 2 &&
          b.reason.length <= 200,
        "请填写2至200字操作原因",
      );
      fail(b.confirm === match[1], "请填写房间号确认操作");
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
            // Invalidate all credentials, including actors not seated yet.
            store.db
              .prepare("DELETE FROM sessions WHERE uid LIKE ?")
              .run(`test:${room.code}:%`);
            room.stage = randomUUID();
          } else if (b.action.startsWith("test-")) {
            fail(room.phase === "lobby", "仅准备阶段可以更改测试标记", 409);
            fail(
              b.action !== "test-off" ||
                !room.players.some((p) => p.uid.startsWith("test:")),
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
        audit(b.action, room.code, b.reason.trim());
      });
      send(200, { ok: true });
      return true;
    }
    throw new RuleError("管理接口不存在", 404);
  }
  return { handle, authenticate };
}
module.exports = { createAdmin };
