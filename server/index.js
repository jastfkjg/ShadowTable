"use strict";
const { createApp } = require("./app");
const { resolve, dirname, join } = require("node:path");
const database = resolve(process.env.DB_PATH || "data/shadowtable.sqlite");
const positiveInteger = (name, fallback, maximum = 3650) => {
  const text = process.env[name] ?? String(fallback), value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(name + " 配置无效");
  return value;
};
const cleanupPolicy = {
  lobbyDays: positiveInteger("ROOM_LOBBY_RETENTION_DAYS", 7), graceDays: positiveInteger("ROOM_GRACE_DAYS", 3),
  endedDays: positiveInteger("ROOM_ENDED_RETENTION_DAYS", 30), entryDays: positiveInteger("ROOM_ENTRY_RETENTION_DAYS", 90),
  receiptDays: positiveInteger("RECEIPT_RETENTION_DAYS", 90), batchSize: positiveInteger("CLEANUP_BATCH_SIZE", 100, 1000),
  intervalMs: positiveInteger("CLEANUP_INTERVAL_MINUTES", 60, 1440) * 60000,
};
const devAuth = process.env.DEV_AUTH === "1";
if (process.env.NODE_ENV === "production" && devAuth)
  throw new Error("生产环境禁止开发登录");
if (!!process.env.ADMIN_ORIGIN !== !!process.env.ADMIN_KEY)
  throw new Error("ADMIN_ORIGIN 和 ADMIN_KEY 必须同时配置");
const { server, store } = createApp({
  adminOrigin: process.env.ADMIN_ORIGIN,
  adminKey: process.env.ADMIN_KEY,
  webOrigin: process.env.WEB_ORIGIN,
  database,
  trustedProxies: process.env.TRUSTED_PROXY_CIDRS || "",
  devAuth,
  devPanel: process.env.DEV_PANEL === "1",
  appId: process.env.WECHAT_APP_ID,
  appSecret: process.env.WECHAT_APP_SECRET,
});
const backups = require("./backup").startBackups(store, { database, directory: resolve(process.env.BACKUP_DIR || join(dirname(database), "backups")) });
const stopMaintenance = process.env.CLEANUP_ENABLED === "0" ? () => {} : require("./retention").startMaintenance(store, { ...cleanupPolicy, canCleanup: backups.hasRecentBackup });
server.listen(
  Number(process.env.PORT) || 8787,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `ShadowTable ready on port ${server.address().port}; dev auth ${devAuth ? "ON" : "OFF"}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      stopMaintenance();
      await backups.stop();
      store.close();
      process.exit(0);
    }),
  );
