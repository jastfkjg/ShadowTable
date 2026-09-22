"use strict";
const http = require("node:http");
const { randomBytes, randomInt, createHash } = require("node:crypto");
const { Store } = require("./store");
const { actionDetails } = require("./audit");
const BOARD_INFO = require("./board-info");
const {
  BOARDS,
  RuleError,
  newRoom,
  enter,
  command,
  publicView,
  roomSummary,
  privateView,
} = require("./engine");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const check = (ok, message, status = 400) => {
  if (!ok) throw new RuleError(message, status);
};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    check(size <= 8192, "请求过大", 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const b = JSON.parse(text || "{}");
    check(b && !Array.isArray(b) && typeof b === "object", "请求格式错误");
    return b;
  } catch (e) {
    if (e instanceof RuleError) throw e;
    throw new RuleError("JSON格式错误");
  }
}
function createApp({
  database = "data/shadowtable.sqlite",
  devAuth = false,
  devPanel = false,
  appId = "",
  appSecret = "",
  adminOrigin = "",
  adminKey = "",
  webOrigin = "",
  exchangeCode,
  clock = () => Date.now(),
} = {}) {
  // Defense in depth: callers cannot enable development features in production.
  devAuth = devAuth && process.env.NODE_ENV !== "production";
  const panel = devAuth && devPanel ? require("./dev-panel").serve : null;
  const web = webOrigin ? require("./web").serve : null;
  let webHost = "";
  if (webOrigin) {
    let url;
    try {
      url = new URL(webOrigin);
    } catch {
      throw new Error("WEB_ORIGIN 必须是完整的源地址");
    }
    if (url.origin !== webOrigin)
      throw new Error("WEB_ORIGIN 必须是完整的源地址，不含路径");
    if (
      url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("网页版必须使用 HTTPS");
    webHost = url.host;
  }
  const store = new Store(database),
    limits = new Map();
  function limit(key, max) {
    const now = clock(),
      old = limits.get(key);
    if (!old || now - old.at >= 60000) limits.set(key, { at: now, n: 1 });
    else {
      old.n++;
      if (old.n > max) {
        const error = new RuleError("请求过于频繁，请稍后重试", 429);
        error.retryAfter = Math.max(
          1,
          Math.ceil((60000 - (now - old.at)) / 1000),
        );
        throw error;
      }
    }
    if (limits.size > 10000)
      for (const [k, v] of limits) if (now - v.at > 60000) limits.delete(k);
  }
  async function wechatLogin(code) {
    check(
      typeof code === "string" && code.length > 0 && code.length < 256,
      "微信登录凭证无效",
    );
    if (exchangeCode) return exchangeCode(code);
    check(appId && appSecret, "服务器尚未配置微信登录", 503);
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.search = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: "authorization_code",
    });
    let data;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      check(response.ok, "微信登录服务暂不可用", 502);
      data = await response.json();
    } catch {
      throw new RuleError("微信登录失败，请重试", 502);
    }
    check(data.openid && !data.errcode, "微信登录凭证已失效，请重新登录", 401);
    return data.openid;
  }
  const admin =
    adminOrigin && adminKey
      ? require("./admin").createAdmin({
          store,
          origin: adminOrigin,
          key: adminKey,
          body,
          limit,
        })
      : null;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, data, raw = false) => {
      res.writeHead(status);
      res.end(raw ? data : JSON.stringify(data));
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (admin && (await admin.handle(req, res, path, send))) return;
      if (
        path === "/admin" ||
        path.startsWith("/admin/") ||
        path.startsWith("/api/admin/")
      )
        return send(404, { error: "管理平台未启用" });
      if (path === "/dev" || path.startsWith("/dev/")) {
        if (!panel || !panel(req, res, path))
          return send(404, { error: "接口不存在" });
        return;
      }
      if (web && web(req, res, path)) return;
      // Shared Wi-Fi and local companion players must fit under the IP ceiling.
      // Per-account and login/create limits below remain unchanged.
      limit(`ip:${req.socket.remoteAddress}`, 6000);
      if (req.method === "GET" && path === "/health")
        return send(200, { ok: true });
      if (req.method === "GET" && path === "/api/boards")
        return send(200, {
          boards: BOARDS.map((b) => ({ ...b, detail: BOARD_INFO[b.id] || null })),
        });
      if (
        req.method === "POST" &&
        ["/api/login", "/api/dev-login", "/api/guest-login"].includes(path)
      ) {
        limit(`login:${req.socket.remoteAddress}`, 30);
        const b = await body(req);
        let uid;
        if (path === "/api/dev-login") {
          check(devAuth, "开发登录未开启", 404);
          uid = `dev:${randomBytes(24).toString("hex")}`;
        } else if (path === "/api/guest-login") {
          check(web, "网页登录未开启", 404);
          check(
            req.headers.host === webHost &&
              req.headers.origin === webOrigin &&
              req.headers["sec-fetch-site"] !== "cross-site",
            "请求来源不匹配",
            403,
          );
          uid = `guest:${randomBytes(24).toString("hex")}`;
        } else uid = `wx:${hash(await wechatLogin(b.code))}`;
        const token = randomBytes(32).toString("hex");
        store.addSession(hash(token), uid);
        return send(200, { token });
      }
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      check(/^[a-f0-9]{64}$/.test(token), "请重新登录", 401);
      const session = store.session(hash(token));
      check(session, "登录已过期，请重新登录", 401);
      const uid = session.uid;
      if (uid.startsWith("test:")) {
        check(admin, "陪测平台未启用", 403);
        const adminSession = admin.authenticate(req);
        const [, code, owner] = uid.split(":");
        check(owner === adminSession.hash, "陪测账号不属于当前管理员会话", 403);
        check(
          path.startsWith(`/api/rooms/${code}/`) ||
            path === `/api/rooms/${code}`,
          "陪测账号只能访问绑定房间",
          403,
        );
        check(store.get(code)?.testRoom === true, "该房间未开启测试模式", 403);
      }
      limit(`uid:${uid}`, 180);
      if (req.method === "GET" && path === "/api/me/rooms") {
        const rooms = store.personalRooms(uid);
        return send(200, { rooms });
      }
      const personal = path.match(/^\/api\/me\/rooms\/(\d{6})$/);
      const match = path.match(
        /^\/api\/rooms\/(\d{6})(?:\/(join|commands|private|delete|management))?$/,
      );
      if (req.method === "GET" && match) {
        const room = store.get(match[1]);
        check(room, "房间不存在", 404);
        if (match[2] === "management") {
          check(room.host === uid, "只有房主可以管理牌桌", 403);
          return send(200, { ...roomSummary(room, uid), stage: room.stage });
        }
        check(!match[2] || match[2] === "private", "接口不存在", 404);
        return send(
          200,
          match[2] === "private"
            ? privateView(room, uid)
            : publicView(room, uid),
        );
      }
      check(
        req.method === "POST" &&
          (path === "/api/rooms" || personal ||
            (match && ["join", "commands", "delete"].includes(match[2]))),
        "接口不存在",
        404,
      );
      const b = await body(req),
        id = req.headers["idempotency-key"];
      check(
        typeof id === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(id),
        "缺少合法请求编号",
      );
      const fingerprint = hash(JSON.stringify([path, b]));
      const result = store.transaction(() => {
        const cached = store.receipt(uid, id);
        if (cached) {
          check(
            cached.fingerprint === fingerprint,
            "请求编号已用于其他操作",
            409,
          );
          return JSON.parse(cached.result);
        }
        if (personal) {
          const code = personal[1], room = store.get(code);
          const member = room && (room.host === uid || [...room.players, ...(room.spectators || [])].some(p => p.uid === uid));
          if (member) store.trackRoom(room, uid);
          check(store.entry(uid, code), "没有这条个人牌桌记录", 404);
          check(["hide", "restore", "note", "visit"].includes(b.action), "未知记录操作");
          if (b.action === "visit") {
            check(member, "房间已失效，请刷新列表", 404);
            store.visitRoom(uid, code);
          } else if (b.action === "note") {
            check(typeof b.note === "string" && b.note.trim().length <= 30, "备注最多30个字符");
            store.db.prepare("UPDATE room_entries SET note=? WHERE uid=? AND code=?").run(b.note.trim(), uid, code);
          } else store.db.prepare("UPDATE room_entries SET hidden=? WHERE uid=? AND code=?").run(b.action === "hide" ? 1 : 0, uid, code);
          const response = { code, accepted: true };
          store.addReceipt(uid, id, fingerprint, response);
          return response;
        }
        let room, response, details;
        if (path === "/api/rooms") {
          limit(`create:${uid}`, 8);
          let code;
          do {
            code = String(randomInt(100000, 1000000));
          } while (store.get(code));
          room = newRoom(code, uid, b.name, b.board, b.capacity);
          details = actionDetails(room, uid, "create", b);
          response = { code };
        } else {
          room = store.get(match[1]);
          check(room, "房间不存在", 404);
          if ([...room.players, ...(room.spectators || [])].some((p) => p.uid === uid))
            details = actionDetails(
              room,
              uid,
              match[2] === "commands" ? b.type : match[2],
              b,
            );
          if (match[2] === "delete") {
            check(room.host === uid, "只有当前房主可以删除牌桌", 403);
            check(
              b.stage === room.stage,
              "牌桌状态已变化，请重新确认删除",
              409,
            );
            room.players = [];
          } else if (match[2] === "join") enter(room, uid, b.name);
          else command(room, uid, b);
          if (!details) details = actionDetails(room, uid, match[2], b);
          response = { code: room.code, accepted: true };
        }
        if (match?.[2] === "delete") store.remove(room.code);
        else {
          store.save(room);
          if (path === "/api/rooms" || match?.[2] === "join") store.visitRoom(uid, room.code);
        }
        store.addReceipt(uid, id, fingerprint, response);
        store.db
          .prepare(
            "INSERT INTO admin_audit(action,code,reason,created,details) VALUES(?,?,?,?,?)",
          )
          .run(
            uid.startsWith("test:") ? "companion" : "player",
            room.code,
            "",
            Date.now(),
            JSON.stringify(details),
          );
        return response;
      });
      // Receipts store no role, action, or old view. Client fetches a fresh scoped view.
      send(200, result);
    } catch (e) {
      if (e.status === 429)
        res.setHeader("Retry-After", String(e.retryAfter || 60));
      send(e instanceof RuleError ? e.status : 500, {
        error:
          e instanceof RuleError ? e.message : "服务器处理失败，请稍后重试",
      });
    }
  });
  server.requestTimeout = 15000;
  return { server, store };
}
module.exports = { createApp };
