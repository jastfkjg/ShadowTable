"use strict";

const { createHash } = require("node:crypto");
const { RuleError } = require("./engine");

const categories = ["问题反馈", "功能建议", "其他"];
const areas = ["牌桌", "对局记录", "我的", "其他"];
const maxImageBytes = 1024 * 1024;
const maxEncoded = Math.ceil(maxImageBytes / 3) * 4;
const maxBody = 4 * maxEncoded + 16384;
function requireValue(value, message, status = 400) {
  if (!value) throw new RuleError(message, status);
}

function initialize(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY, uid TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL,
    category TEXT NOT NULL, area TEXT NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL,
    photos INTEGER NOT NULL, reply TEXT NOT NULL DEFAULT '', repliedAt INTEGER,
    UNIQUE(uid, request));
    CREATE INDEX IF NOT EXISTS feedback_owner ON feedback(uid, id DESC);
    CREATE TABLE IF NOT EXISTS feedback_images (
      feedbackId INTEGER NOT NULL, position INTEGER NOT NULL, data BLOB NOT NULL,
      PRIMARY KEY(feedbackId, position));`);
}

async function prepareImage(encoded) {
  requireValue(typeof encoded === "string" && encoded.length && encoded.length <= maxEncoded,
    "每张截图最多 1 MB", 400);
  const bytes = Buffer.from(encoded, "base64");
  requireValue(bytes.length <= maxImageBytes && bytes.toString("base64") === encoded, "截图格式无效");
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  requireValue(jpeg || png || webp, "请选择 JPG、PNG 或 WebP 静态图片");
  try {
    const image = require("sharp")(bytes, { limitInputPixels: 16777216, failOn: "warning" });
    const meta = await image.metadata();
    requireValue(["jpeg", "png", "webp"].includes(meta.format) && (meta.pages || 1) === 1, "请选择静态截图");
    return await image.rotate().resize({ width: 1920, height: 2600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#fff" }).jpeg({ quality: 82 }).timeout({ seconds: 5 }).toBuffer();
  } catch {
    throw new RuleError("截图无法读取，请选择 JPG、PNG 或 WebP 静态图片");
  }
}

async function submit(store, uid, key, input) {
  const { category, area = "", content, images = [] } = input;
  requireValue(typeof key === "string" && /^[\w-]{8,100}$/.test(key), "提交编号无效");
  requireValue(categories.includes(category), "请选择反馈类型");
  requireValue(area === "" || category === categories[0] && areas.includes(area), "请选择有效页面");
  requireValue(typeof content === "string" && content.trim() && content.length <= 1000, "请填写 1 至 1000 字反馈内容");
  requireValue(Array.isArray(images) && images.length <= 4, "最多可附 4 张截图");
  const fingerprint = createHash("sha256").update(JSON.stringify([category, area, content.trim(), images])).digest("hex");
  const existing = () => {
    const row = store.db.prepare("SELECT id,fingerprint FROM feedback WHERE uid=? AND request=?").get(uid, key);
    if (row) requireValue(row.fingerprint === fingerprint, "提交编号已用于其他内容", 409);
    return row && { id: row.id };
  };
  const previous = existing();
  if (previous) return previous;
  const photos = [];
  for (const image of images) photos.push(await prepareImage(image));
  return store.transaction(() => {
    const duplicate = existing();
    if (duplicate) return duplicate;
    const now = store.clock();
    const recent = store.db.prepare("SELECT count(*) AS n FROM feedback WHERE uid=? AND created>?").get(uid, now - 86400000);
    requireValue(recent.n < 20, "今天提交的反馈已达上限，请稍后再试", 429);
    const id = Number(store.db.prepare(`INSERT INTO feedback(uid,request,fingerprint,category,area,content,created,photos)
      VALUES(?,?,?,?,?,?,?,?)`).run(uid, key, fingerprint, category, area, content.trim(), now, photos.length).lastInsertRowid);
    photos.forEach((photo, index) => store.db.prepare("INSERT INTO feedback_images VALUES(?,?,?)").run(id, index, photo));
    return { id };
  });
}

const columns = "f.id,f.category,f.area,f.content,f.created,f.photos,f.reply,f.repliedAt";
function list(store, uid, params) {
  const where = [], args = [];
  if (uid !== null) { where.push("f.uid=?"); args.push(uid); }
  const before = params.get("before");
  if (before !== null) {
    requireValue(/^\d+$/.test(before) && Number.isSafeInteger(Number(before)), "分页参数无效");
    where.push("f.id<?"); args.push(Number(before));
  }
  const status = params.get("status") || "all";
  requireValue(["all", "pending", "replied"].includes(status), "状态无效");
  if (status !== "all") where.push(status === "pending" ? "f.repliedAt IS NULL" : "f.repliedAt IS NOT NULL");
  const admin = uid === null;
  const rows = store.db.prepare(`SELECT ${columns}${admin ? ",p.nickname" : ""} FROM feedback f
    ${admin ? "LEFT JOIN profiles p ON p.uid=f.uid" : ""}
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.id DESC LIMIT 21`).all(...args);
  return { items: rows.slice(0,20), next: rows.length > 20 ? rows[19].id : null };
}

function image(store, uid, id, position) {
  const row = store.db.prepare(`SELECT i.data FROM feedback_images i JOIN feedback f ON f.id=i.feedbackId
    WHERE f.id=? AND i.position=? AND (? IS NULL OR f.uid=?)`).get(id, position, uid, uid);
  requireValue(row, "截图不存在", 404);
  return Buffer.from(row.data);
}

function reply(store, id, text) {
  requireValue(typeof text === "string" && text.trim() && text.length <= 1000, "请填写 1 至 1000 字回复");
  const item = store.db.prepare("SELECT reply FROM feedback WHERE id=?").get(id);
  requireValue(item, "反馈不存在", 404);
  requireValue(!item.reply || item.reply === text.trim(), "这条反馈已有回复，请刷新查看", 409);
  if (!item.reply) store.db.prepare("UPDATE feedback SET reply=?,repliedAt=? WHERE id=?").run(text.trim(), store.clock(), id);
  return { ok: true };
}

module.exports = { initialize, submit, list, image, reply, maxBody };
