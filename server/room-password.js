"use strict";
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { RuleError } = require("./engine");

function valid(password) {
  return typeof password === "string" && password.trim().length > 0 && password.length <= 128;
}
function set(store, password) {
  if (!valid(password)) throw new RuleError("请输入 1 至 128 个字符的房间设置密码");
  const salt = randomBytes(16);
  store.db.prepare("INSERT INTO room_settings_password VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET salt=excluded.salt,digest=excluded.digest")
    .run(salt, scryptSync(password, salt, 32));
}
function verify(store, password) {
  const row = store.db.prepare("SELECT salt,digest FROM room_settings_password WHERE id=1").get();
  if (!row) throw new RuleError("请先联系管理员设置房间设置密码");
  if (!valid(password) || !timingSafeEqual(scryptSync(password, row.salt, 32), row.digest))
    throw new RuleError("房间设置密码错误，请重新输入");
}
module.exports = { set, verify };
