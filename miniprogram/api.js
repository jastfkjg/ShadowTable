const config = require("./config");
let retryAt = 0;
function request(path, method = "GET", data, requestId) {
  if (Date.now() < retryAt)
    return Promise.reject(
      Object.assign(new Error("请求冷却中，请稍后重试"), {
        status: 429,
        retryAfterMs: retryAt - Date.now(),
      }),
    );
  return new Promise((resolve, reject) =>
    wx.request({
      url: config.baseUrl + path,
      method,
      data,
      timeout: 10000,
      header: {
        "content-type": "application/json",
        Authorization: "Bearer " + (wx.getStorageSync("session") || ""),
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else {
          const e = new Error(res.data.error || "请求失败");
          e.status = res.statusCode;
          if (e.status === 429) {
            const headers = res.header || {};
            const key = Object.keys(headers).find(
              (k) => k.toLowerCase() === "retry-after",
            );
            e.retryAfterMs = Math.min(
              60000,
              Math.max(1000, (Number(headers[key]) || 60) * 1000),
            );
            retryAt = Date.now() + e.retryAfterMs;
          }
          if (e.status === 401) wx.removeStorageSync("session");
          reject(e);
        }
      },
      fail(error) {
        const detail = (error && error.errMsg) || "";
        let message = "网络未确认，请检查连接后重试原请求";
        if (/url not in domain list|不在.*合法域名/i.test(detail))
          message = "服务地址未通过微信域名校验，请联系房主检查服务配置";
        else if (/timeout|超时/i.test(detail))
          message = "请求超时，结果尚未确认，请重试原请求";
        else if (
          /connection[ _]refused|connection[ _]reset|name[ _]not[ _]resolved/i.test(
            detail,
          )
        )
          message = "暂时无法连接游戏服务，请检查网络或稍后重试原请求";
        const failure = new Error(message);
        if (/url not in domain list|不在.*合法域名/i.test(detail)) failure.retryable = false;
        reject(failure);
      },
    }),
  );
}
async function login() {
  if (wx.getStorageSync("session")) return;
  const data = config.devAuth
    ? await request("/api/dev-login", "POST", {})
    : await new Promise((resolve, reject) =>
        wx.login({
          success: (r) =>
            r.code ? resolve(r.code) : reject(new Error("微信登录失败")),
          fail: () => reject(new Error("微信登录失败")),
        }),
      ).then((code) => request("/api/login", "POST", { code }));
  wx.setStorageSync("session", data.token);
}
function requestId() {
  return (
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}
module.exports = { request, login, requestId };
