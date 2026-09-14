"use strict";
const { createApp } = require("./app");
const devAuth = process.env.DEV_AUTH === "1";
if (process.env.NODE_ENV === "production" && devAuth)
  throw new Error("生产环境禁止开发登录");
const { server, store } = createApp({
  database: process.env.DB_PATH || "data/shadowtable.sqlite",
  devAuth,
  devPanel: process.env.DEV_PANEL === "1",
  appId: process.env.WECHAT_APP_ID,
  appSecret: process.env.WECHAT_APP_SECRET,
});
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
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
