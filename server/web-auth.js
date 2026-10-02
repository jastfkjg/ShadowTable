"use strict";
const { randomBytes, createHash, createHmac } = require("node:crypto");
const { RuleError } = require("./engine");
const hash = value => createHash("sha256").update(value).digest("hex");
const check = (ok, message, status = 400) => { if (!ok) throw new RuleError(message, status); };
const REQUEST_MS = 2 * 60000, SESSION_MS = 30 * 86400000;

function createWebAuth({ store, origin, enabled, qrCode, body, limit, clientAddress, clock }) {
  const url = new URL(origin), secure = url.protocol === "https:";
  const prefix = secure ? "__Host-shadowtable_" : "shadowtable_";
  const sessionName = prefix + "web", bindingName = prefix + "login";
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS web_sessions(hash TEXT PRIMARY KEY, uid TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires);
    CREATE TABLE IF NOT EXISTS web_login_requests(
      id TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, source_uid TEXT,
      status TEXT NOT NULL, approver_uid TEXT, expires INTEGER NOT NULL, device TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS web_login_expiry ON web_login_requests(expires);
    CREATE INDEX IF NOT EXISTS web_login_browser ON web_login_requests(browser_hash);
  `);
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const readCookie = (req, name) => (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "="))?.slice(name.length + 1) || "";
  function source(req) {
    check(req.headers.host === url.host && req.headers["sec-fetch-site"] !== "cross-site", "请求来源不匹配", 403);
    if (req.method !== "GET") check(req.headers.origin === origin, "请求来源不匹配", 403);
  }
  function session(req) {
    const token = readCookie(req, sessionName);
    if (!token) return null;
    source(req);
    return /^[a-f0-9]{64}$/.test(token)
      ? store.db.prepare("SELECT * FROM web_sessions WHERE hash=? AND expires>?").get(hash(token), clock()) || null : null;
  }
  function authenticate(req) {
    if (!readCookie(req, sessionName)) {
      check(!req.headers["x-web-session"], "网页登录已过期，请重新扫码登录", 401);
      return null;
    }
    const current = session(req);
    check(current, "网页登录已过期，请重新扫码登录", 401);
    // Prevent in-flight commands from an old tab being applied to a new account.
    check(req.headers["x-web-session"] === current.hash.slice(0, 24), "浏览器账号已变化，请刷新页面", 409);
    return current;
  }
  function bearer(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    return /^[a-f0-9]{64}$/.test(token) ? store.session(hash(token)) : null;
  }
  function maySwitch(uid) {
    if (!uid) return;
    const room = store.roomsFor(uid).find(r => !["ended", "terminated"].includes(r.phase) &&
      (r.host === uid || r.players.some(p => p.uid === uid)));
    check(!room, room?.phase === "lobby" ? "请先离开准备中的牌桌，再切换账号" : "你正在对局中，请在本局结束后切换账号", 409);
  }
  function readRequest(id) {
    check(/^[a-f0-9]{32}$/.test(id), "登录请求无效", 400);
    const request = store.db.prepare("SELECT * FROM web_login_requests WHERE id=?").get(id);
    check(request && request.expires > clock(), "小程序码已过期，请在网页刷新", 410);
    return request;
  }
  function browserRequest(req, id) {
    const request = readRequest(id), binding = readCookie(req, bindingName);
    check(/^[a-f0-9]{64}$/.test(binding) && hash(binding) === request.browser_hash, "请在发起登录的浏览器继续", 403);
    return { request, binding };
  }
  function describeDevice(agent = "") {
    const platform = /iPhone|iPad/.test(agent) ? "iPhone / iPad" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "Mac" : "浏览器";
    const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "";
    return [platform, browser].filter(Boolean).join(" · ");
  }
  async function handle(req, res, path, send) {
    if (!path.startsWith("/api/web-auth/")) return false;
    const mini = /^\/api\/web-auth\/requests\/([a-f0-9]{32})\/(inspect|confirm|reject)$/.exec(path);
    if (mini) {
      check(enabled, "网页登录暂未开放", 503);
      check(req.method === "POST", "接口不存在", 404);
      const current = bearer(req);
      check(current?.uid.startsWith("wx:"), "请使用小程序微信账号确认登录", 401);
      limit("web-confirm:" + current.uid, 30);
      await body(req);
      const result = store.transaction(() => {
        const request = readRequest(mini[1]);
        check(!request.approver_uid || request.approver_uid === current.uid, "该登录请求已由其他账号扫描，请在网页刷新", 409);
        check(request.status !== "cancelled", "登录已取消，请在网页重新发起", 410);
        if (mini[2] === "inspect") {
          if (request.status === "pending") store.db.prepare("UPDATE web_login_requests SET status='scanned',approver_uid=? WHERE id=?").run(current.uid, request.id);
          return { status: request.status === "pending" ? "scanned" : request.status, website: origin, device: request.device, expiresAt: request.expires };
        }
        if (mini[2] === "reject") {
          check(!["confirmed", "consumed"].includes(request.status), "此请求已确认，无法取消", 409);
          store.db.prepare("UPDATE web_login_requests SET status='cancelled',approver_uid=? WHERE id=?").run(current.uid, request.id);
          return { status: "cancelled" };
        }
        check(request.approver_uid === current.uid, "请先查看登录请求再确认", 409);
        if (!["confirmed", "consumed"].includes(request.status)) {
          maySwitch(request.source_uid);
          store.db.prepare("UPDATE web_login_requests SET status='confirmed' WHERE id=?").run(request.id);
        }
        return { status: request.status === "consumed" ? "consumed" : "confirmed" };
      });
      send(200, result); return true;
    }
    source(req);
    const binding = readCookie(req, bindingName);
    if (path === "/api/web-auth/session" && req.method === "GET") {
      const current = session(req);
      send(200, { enabled, authenticated: !!current, ...(current ? { sessionTag: current.hash.slice(0, 24), expiresAt: current.expires } : {}) }); return true;
    }
    if (path === "/api/web-auth/logout" && req.method === "POST") {
      await body(req);
      const current = session(req);
      if (current) { authenticate(req); maySwitch(current.uid); }
      store.transaction(() => {
        if (current) store.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(current.hash);
        if (binding) store.db.prepare("UPDATE web_login_requests SET status='cancelled' WHERE browser_hash=?").run(hash(binding));
      });
      res.setHeader("Set-Cookie", [cookie(sessionName, "", 0), cookie(bindingName, "", 0)]);
      send(200, { ok: true }); return true;
    }
    check(enabled, "网页登录暂未开放", 503);
    if (path === "/api/web-auth/requests" && req.method === "POST") {
      limit("web-qr:" + clientAddress(req), 10);
      await body(req);
      check(!session(req), "请先退出当前网页账号", 409);
      const guest = bearer(req);
      check(!req.headers.authorization || guest?.uid.startsWith("guest:"), "游客登录已过期，请刷新后重试", 401);
      maySwitch(guest?.uid);
      const secret = /^[a-f0-9]{64}$/.test(binding) ? binding : randomBytes(32).toString("hex");
      const browserHash = hash(secret), id = randomBytes(16).toString("hex"), expiresAt = clock() + REQUEST_MS;
      store.transaction(() => {
        store.db.prepare("DELETE FROM web_login_requests WHERE expires<=?").run(clock());
        store.db.prepare("DELETE FROM web_sessions WHERE expires<=?").run(clock());
        check(store.db.prepare("SELECT count(*) AS n FROM web_login_requests").get().n < 1000, "登录请求较多，请稍后重试", 429);
        store.db.prepare("UPDATE web_login_requests SET status='cancelled' WHERE browser_hash=?").run(browserHash);
        store.db.prepare("INSERT INTO web_login_requests VALUES(?,?,?,'pending',NULL,?,?)").run(id, browserHash, guest?.uid || null, expiresAt, describeDevice(req.headers["user-agent"]));
      });
      res.setHeader("Set-Cookie", cookie(bindingName, secret, REQUEST_MS / 1000 + 60));
      try {
        const qr = await qrCode(id);
        check(readRequest(id).status !== "cancelled", "登录请求已更新，请重试", 409);
        send(200, { id, expiresAt, qrCode: `data:${qr.mime};base64,${qr.bytes.toString("base64")}` });
      } catch (error) {
        store.db.prepare("UPDATE web_login_requests SET status='cancelled' WHERE id=?").run(id);
        throw error;
      }
      return true;
    }
    const browserRoute = /^\/api\/web-auth\/requests\/([a-f0-9]{32})(?:\/(claim|cancel))?$/.exec(path);
    check(browserRoute, "接口不存在", 404);
    const action = browserRoute[2];
    check(req.method === (action ? "POST" : "GET"), "接口不存在", 404);
    if (action) await body(req);
    const { request, binding: secret } = browserRequest(req, browserRoute[1]);
    limit("web-poll:" + request.browser_hash, 90);
    if (!action) { send(200, { status: request.status, expiresAt: request.expires }); return true; }
    if (action === "cancel") {
      check(request.status !== "consumed", "此浏览器已完成登录", 409);
      store.db.prepare("UPDATE web_login_requests SET status='cancelled' WHERE id=?").run(request.id);
      send(200, { status: "cancelled" }); return true;
    }
    // Derive a browser-specific credential to safely retry a lost claim response.
    // Neither the QR identifier nor a mini-program session can derive this token.
    const token = createHmac("sha256", secret).update("web-session:" + request.id).digest("hex");
    const result = store.transaction(() => {
      check(["confirmed", "consumed"].includes(request.status), "请先在小程序确认登录", 409);
      const current = session(req);
      check(!current || current.hash === hash(token), "浏览器账号已变化，请刷新页面", 409);
      if (request.status === "confirmed") {
        maySwitch(request.source_uid);
        store.db.prepare("INSERT INTO web_sessions VALUES(?,?,?)").run(hash(token), request.approver_uid, clock() + SESSION_MS);
        store.db.prepare("UPDATE web_login_requests SET status='consumed' WHERE id=?").run(request.id);
      }
      const saved = store.db.prepare("SELECT * FROM web_sessions WHERE hash=? AND expires>?").get(hash(token), clock());
      check(saved, "此网页登录已退出，请重新扫码", 410);
      return saved;
    });
    res.setHeader("Set-Cookie", cookie(sessionName, token, Math.max(1, Math.floor((result.expires - clock()) / 1000))));
    send(200, { authenticated: true, sessionTag: result.hash.slice(0, 24) }); return true;
  }
  return { handle, authenticate };
}
module.exports = { createWebAuth };
