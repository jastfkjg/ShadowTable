"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { RuleError } = require("./engine");
const builtinAvatars = require("../miniprogram/builtin-avatars");
const builtinCache = new Map();
const MAX_AVATAR_BYTES = 256 * 1024;
function fail(ok, message) { if (!ok) throw new RuleError(message, 400); }
function decodeAvatar(value) {
  const match = typeof value === "string" && /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  fail(match, "头像仅支持 JPG 或 PNG 图片");
  const data = Buffer.from(match[2], "base64");
  fail(data.length > 0 && data.length <= MAX_AVATAR_BYTES && data.toString("base64") === match[2], "头像文件无效或超过256KB，请重新选择");
  let width = 0, height = 0;
  if (match[1] === "png") {
    fail(data.length >= 45 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && data.toString("ascii", 12, 16) === "IHDR" && data.toString("ascii", data.length - 8, data.length - 4) === "IEND", "PNG图片不完整");
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else {
    fail(data.length >= 4 && data.readUInt16BE(0) === 0xffd8 && data.readUInt16BE(data.length - 2) === 0xffd9, "JPG图片不完整");
    let at = 2;
    while (at + 4 <= data.length) {
      fail(data[at] === 0xff, "JPG图片格式无效");
      while (data[at] === 0xff) at++;
      const marker = data[at++];
      if (marker === 0xda || marker === 0xd9) break;
      fail(at + 2 <= data.length, "JPG图片不完整");
      const length = data.readUInt16BE(at);
      fail(length >= 2 && at + length <= data.length, "JPG图片不完整");
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        fail(length >= 8, "JPG图片格式无效");
        height = data.readUInt16BE(at + 3); width = data.readUInt16BE(at + 5); break;
      }
      at += length;
    }
  }
  fail(width > 0 && height > 0 && width <= 1024 && height <= 1024, "请使用长宽不超过1024像素的头像");
  return { hash: createHash("sha256").update(data).digest("hex"), mime: "image/" + match[1], data };
}
function resolveAvatar(value) {
  fail(typeof value === "string" && value.startsWith("builtin:"), "头像上传已关闭，请选择内置头像");
  const preset = builtinAvatars.find(item => item.id === value.slice(8));
  fail(preset, "请选择有效的内置头像");
  if (!builtinCache.has(preset.id)) {
    const data = readFileSync(join(__dirname, "../miniprogram", preset.path));
    const avatar = decodeAvatar("data:image/jpeg;base64," + data.toString("base64"));
    if (avatar.hash !== preset.hash) throw new Error("内置头像资源与目录不一致");
    builtinCache.set(preset.id, avatar);
  }
  return builtinCache.get(preset.id);
}
function readProfile(store, uid) {
  const row = store.db.prepare("SELECT nickname, avatar_hash, version, updated, leaderboard_visible, nickname_confirmed FROM profiles WHERE uid=?").get(uid);
  return { nickname: row?.nickname || "", avatarUrl: row?.avatar_hash ? "/api/avatars/" + row.avatar_hash : null,
    identityType: uid.split(":")[0], version: row?.version || 0, updatedAt: row?.updated || null,
    leaderboardVisible: /^(wx|dev|test):/.test(uid) && (row ? !!row.leaderboard_visible : true), nicknameConfirmed: !!row?.nickname_confirmed };
}
// Room presentation uses current avatars without copying profile data into game state.
function readAvatarUrls(store, uids) {
  if (!uids.length) return new Map();
  const rows = store.db.prepare(`SELECT uid, avatar_hash FROM profiles WHERE uid IN (${uids.map(() => "?").join(",")})`).all(...uids);
  return new Map(rows.map(row => [row.uid, row.avatar_hash ? "/api/avatars/" + row.avatar_hash : null]));
}
function saveProfile(store, uid, input, { confirmNickname = true } = {}) {
  fail(typeof input.nickname === "string" && input.nickname.trim().length >= 1 && input.nickname.trim().length <= 16 && !/[\u0000-\u001f\u007f]/.test(input.nickname), "昵称需要1–16个字符，不能包含换行");
  fail(Number.isSafeInteger(input.version) && input.version >= 0, "请刷新个人资料后重试");
  const old = readProfile(store, uid);
  if (old.version !== input.version) throw new RuleError("资料已在其他设备更新，请重新载入后编辑", 409);
  fail(input.leaderboardVisible === undefined || typeof input.leaderboardVisible === "boolean", "排行榜展示设置无效");
  const visible = input.leaderboardVisible ?? old.leaderboardVisible;
  fail(!visible || /^(wx|dev|test):/.test(uid), "微信、开发或陪测账号可参与公开排行榜");
  let avatarHash = old.avatarUrl?.split("/").at(-1) || null;
  if (input.avatar === null) avatarHash = null;
  else if (input.avatar !== undefined) {
    const avatar = resolveAvatar(input.avatar);
    store.db.prepare("INSERT OR IGNORE INTO avatars VALUES(?,?,?)").run(avatar.hash, avatar.mime, avatar.data);
    avatarHash = avatar.hash;
  }
  store.db.prepare(`INSERT INTO profiles(uid,nickname,avatar_hash,version,updated,leaderboard_visible,public_id,nickname_confirmed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET
    nickname=excluded.nickname, avatar_hash=excluded.avatar_hash, version=excluded.version, updated=excluded.updated,
    leaderboard_visible=excluded.leaderboard_visible, public_id=COALESCE(profiles.public_id,excluded.public_id), nickname_confirmed=excluded.nickname_confirmed`)
    .run(uid, input.nickname.trim(), avatarHash, old.version + 1, Date.now(), visible ? 1 : 0, randomUUID(), confirmNickname || old.nicknameConfirmed ? 1 : 0);
  store.invalidateLeaderboard();
  return readProfile(store, uid);
}
module.exports = { readProfile, saveProfile, decodeAvatar, readAvatarUrls };
