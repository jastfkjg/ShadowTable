"use strict";
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { RuleError } = require("./engine");
const builtinHashes = new Set(require("../miniprogram/builtin-avatars").map(item => item.hash));
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024, TTL = 86400000;
const fail = (ok, message, status = 400) => { if (!ok) throw new RuleError(message, status); };

function initialize(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS avatar_uploads(
    id TEXT PRIMARY KEY, uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL,
    hash TEXT NOT NULL, data BLOB, status TEXT NOT NULL, trace_id TEXT UNIQUE,
    fetch_token TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
    UNIQUE(uid,request));
    CREATE INDEX IF NOT EXISTS avatar_uploads_expiry ON avatar_uploads(expires);
    CREATE TABLE IF NOT EXISTS uploaded_avatars(hash TEXT PRIMARY KEY, unreferenced_since INTEGER NOT NULL);`);
}
async function multipart(req) {
  fail(/^multipart\/form-data\s*;/i.test(req.headers["content-type"] || ""), "请上传JPG或PNG图片");
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    fail(size <= MAX_UPLOAD_BYTES + 8192, "头像文件超过2MB，请重新选择", 413);
    chunks.push(chunk);
  }
  return new Promise((resolve, reject) => {
    let parser, file, code, invalid = false, tooLarge = false;
    try { parser = require("busboy")({ headers: req.headers, limits: { files: 1, fields: 1, parts: 3, fileSize: MAX_UPLOAD_BYTES, fieldSize: 256, headerPairs: 32 } }); }
    catch { return reject(new RuleError("上传格式错误", 400)); }
    parser.on("file", (name, stream) => {
      if (name !== "file") invalid = true;
      const data = [];
      stream.on("data", chunk => data.push(chunk));
      stream.on("limit", () => { tooLarge = true; });
      stream.on("end", () => { file = Buffer.concat(data); });
    });
    parser.on("field", (name, value, info) => {
      if (name !== "code" || info.valueTruncated || info.nameTruncated) invalid = true;
      else code = value;
    });
    for (const event of ["partsLimit", "filesLimit", "fieldsLimit"]) parser.on(event, () => { invalid = true; });
    parser.on("error", () => reject(new RuleError("上传格式错误", 400)));
    parser.on("close", () => {
      if (tooLarge) return reject(new RuleError("头像文件超过2MB，请重新选择", 413));
      if (invalid || !file?.length) return reject(new RuleError("请选择一张JPG或PNG图片", 400));
      resolve({ file, code });
    });
    parser.end(Buffer.concat(chunks));
  });
}
async function normalize(file) {
  const jpeg = file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
  const png = file.length >= 8 && file.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  fail(jpeg || png, "头像仅支持静态JPG或PNG图片");
  try {
    const sharp = require("sharp"), options = { limitInputPixels: 16 * 1024 * 1024, failOn: "warning" };
    const metadata = await sharp(file, options).metadata();
    fail(["jpeg", "png"].includes(metadata.format) && (metadata.pages || 1) === 1, "头像仅支持静态JPG或PNG图片");
    const data = await sharp(file, options).rotate().resize(256, 256, { fit: "cover" }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).timeout({ seconds: 5 }).toBuffer();
    fail(data.length <= 256 * 1024, "头像文件过大，请重新选择");
    return { data, hash: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof RuleError) throw error;
    throw new RuleError("图片无法读取或尺寸过大，请重新选择JPG或PNG图片", 400);
  }
}
function readUpload(store, uid, id) {
  const row = store.db.prepare("SELECT id,status,expires,created FROM avatar_uploads WHERE uid=? AND id=?").get(uid, id);
  fail(row, "上传记录不存在", 404);
  fail(row.expires > store.clock(), "上传图片已过期，请重新选择", 410);
  if (row.status === "processing" && row.created < store.clock() - 60000) {
    store.db.prepare("UPDATE avatar_uploads SET status='failed',data=NULL WHERE id=? AND status='processing'").run(id);
    row.status = "failed";
  }
  return { id: row.id, status: row.status, expiresAt: row.expires };
}
function resolveUpload(store, uid, id) {
  const shown = readUpload(store, uid, id);
  fail(shown.status === "approved", shown.status === "rejected" ? "图片未通过审核，请重新选择" : shown.status === "failed" ? "图片审核失败，请重新上传" : "图片正在审核，请稍后再保存", 409);
  const row = store.db.prepare("SELECT hash,data FROM avatar_uploads WHERE uid=? AND id=?").get(uid, id);
  if (row.data) store.db.prepare("INSERT OR IGNORE INTO avatars VALUES(?,?,?)").run(row.hash, "image/jpeg", row.data);
  fail(store.db.prepare("SELECT 1 FROM avatars WHERE hash=?").get(row.hash), "上传图片已失效，请重新选择", 410);
  if (!builtinHashes.has(row.hash)) store.db.prepare("INSERT OR IGNORE INTO uploaded_avatars VALUES(?,0)").run(row.hash);
  store.db.prepare("UPDATE avatar_uploads SET data=NULL WHERE id=?").run(id);
  return row.hash;
}
function trackReferences(store, oldHash, newHash) {
  if (newHash) store.db.prepare("UPDATE uploaded_avatars SET unreferenced_since=0 WHERE hash=?").run(newHash);
  if (oldHash && oldHash !== newHash) store.db.prepare(`UPDATE uploaded_avatars SET unreferenced_since=? WHERE hash=? AND unreferenced_since=0
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE avatar_hash=?)`).run(store.clock(), oldHash, oldHash);
}
function cleanup(store, { batchSize = 100, retentionMs = 90 * TTL } = {}) {
  const db = store.db, now = store.clock();
  db.prepare("DELETE FROM avatar_uploads WHERE id IN (SELECT id FROM avatar_uploads WHERE expires<=? ORDER BY expires LIMIT ?)").run(now, batchSize);
  const rows = db.prepare(`SELECT hash FROM uploaded_avatars WHERE unreferenced_since>0 AND unreferenced_since<?
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE avatar_hash=uploaded_avatars.hash)
    AND NOT EXISTS (SELECT 1 FROM avatar_uploads WHERE hash=uploaded_avatars.hash AND expires>?)
    AND NOT EXISTS (SELECT 1 FROM receipts WHERE json_extract(result,'$.avatarUrl')='/api/avatars/'||uploaded_avatars.hash)
    LIMIT ?`).all(now - retentionMs, now, batchSize);
  for (const row of rows) {
    db.prepare("DELETE FROM avatars WHERE hash=?").run(row.hash);
    db.prepare("DELETE FROM uploaded_avatars WHERE hash=?").run(row.hash);
  }
}
function createAvatarUploads({ store, enabled, review, publicOrigin, exchangeCode, devAuth, limit }) {
  const inflight = new Map(); let working = 0;
  return {
    enabled: !!enabled,
    async upload(req, uid) {
      fail(enabled, "头像上传暂未开放，请选择内置头像", 503);
      fail(uid.startsWith("wx:") || (devAuth && uid.startsWith("dev:")), "请使用小程序微信账号上传头像", 403);
      limit("avatar:" + uid, 5);
      const id = req.headers["idempotency-key"];
      fail(typeof id === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(id), "缺少合法请求编号");
      const { file, code } = await multipart(req), fingerprint = createHash("sha256").update(file).digest("hex"), request = uid + ":" + id;
      const old = store.db.prepare("SELECT id,fingerprint FROM avatar_uploads WHERE uid=? AND request=?").get(uid, id);
      if (old) { fail(old.fingerprint === fingerprint, "请求编号已用于其他图片", 409); return readUpload(store, uid, old.id); }
      if (inflight.has(request)) {
        fail(inflight.get(request).fingerprint === fingerprint, "请求编号已用于其他图片", 409);
        return inflight.get(request).promise;
      }
      fail(working < 4, "图片处理繁忙，请稍后重试", 503);
      const promise = (async () => {
        working++;
        try {
          // Obtain a fresh OpenID for this review only; never persist it or change existing user IDs.
          const openid = uid.startsWith("wx:") ? await exchangeCode(code) : "";
          fail(uid.startsWith("dev:") || typeof openid === "string" && "wx:" + createHash("sha256").update(openid).digest("hex") === uid, "微信账号已切换，请重新登录后上传", 401);
          const avatar = await normalize(file), uploadId = randomUUID(), fetchToken = randomBytes(32).toString("hex"), now = store.clock();
          store.db.prepare("INSERT INTO avatar_uploads VALUES(?,?,?,?,?,?,'processing',NULL,?,?,?)")
            .run(uploadId, uid, id, fingerprint, avatar.hash, avatar.data, fetchToken, now, now + TTL);
          try {
            const result = await review({ openid, mediaUrl: publicOrigin + "/api/avatar-review-media/" + fetchToken });
            fail(result?.approved === true || typeof result?.traceId === "string" && result.traceId.length > 0, "图片审核暂不可用，请稍后重新上传", 503);
            store.db.prepare("UPDATE avatar_uploads SET status=?,trace_id=? WHERE id=? AND status='processing'")
              .run(result.approved === true ? "approved" : "pending", result.traceId || null, uploadId);
          } catch {
            store.db.prepare("UPDATE avatar_uploads SET status='failed',data=NULL WHERE id=?").run(uploadId);
          }
          return readUpload(store, uid, uploadId);
        } finally { working--; }
      })();
      inflight.set(request, { fingerprint, promise });
      try { return await promise; } finally { inflight.delete(request); }
    },
    media(token) {
      const row = store.db.prepare("SELECT data FROM avatar_uploads WHERE fetch_token=? AND expires>? AND status IN ('processing','pending')").get(token, store.clock());
      fail(row?.data, "图片不存在", 404);
      return Buffer.from(row.data);
    },
    complete(event) {
      const status = event.errcode !== 0 ? "failed" : event.result?.suggest === "pass" ? "approved" : ["risky", "review"].includes(event.result?.suggest) ? "rejected" : "failed";
      const row = store.db.prepare("SELECT id,status FROM avatar_uploads WHERE trace_id=? AND expires>?").get(event.trace_id, store.clock());
      // A callback can arrive before the submission response. Ask WeChat to retry.
      if (!row) throw new RuleError("审核任务尚未就绪", 503);
      if (row.status !== "pending") return;
      store.db.prepare("UPDATE avatar_uploads SET status=?,data=CASE WHEN ?='approved' THEN data ELSE NULL END WHERE id=? AND status='pending'").run(status, status, row.id);
    },
  };
}
module.exports = { initialize, createAvatarUploads, readUpload, resolveUpload, trackReferences, cleanup, normalize, MAX_UPLOAD_BYTES };
