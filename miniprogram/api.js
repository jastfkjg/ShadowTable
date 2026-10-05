const config = require("./config");
let retryAt = 0, cacheEpoch = 0;
const roomCache = new Map();
const copy = value => JSON.parse(JSON.stringify(value));
function request(path, method = "GET", data, requestId) {
  if (Date.now() < retryAt)
    return Promise.reject(
      Object.assign(new Error("请求冷却中，请稍后重试"), {
        status: 429,
        retryAfterMs: retryAt - Date.now(),
      }),
    );
  const token = wx.getStorageSync("session") || "";
  const cacheKey = token + path, cacheable = method === "GET" && /^\/api\/rooms\/\d{6}(?:\?instance=\d+)?$/.test(path);
  if (method !== "GET") { roomCache.clear(); cacheEpoch++; }
  const cached = cacheable && roomCache.get(cacheKey), epoch = cacheEpoch;
  return new Promise((resolve, reject) =>
    wx.request({
      url: config.baseUrl + path,
      method,
      data,
      timeout: 10000,
      header: {
        "content-type": "application/json",
        Authorization: "Bearer " + token,
        ...(cached ? { "If-None-Match": cached.etag } : {}),
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
      },
      success(res) {
        if (res.statusCode === 304 && cached) { resolve(copy(cached.data)); return; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const headers = res.header || {}, key = Object.keys(headers).find(k => k.toLowerCase() === "etag");
          if (cacheable && headers[key] && epoch === cacheEpoch && token === (wx.getStorageSync("session") || "")) {
            roomCache.set(cacheKey, { etag: headers[key], data: copy(res.data) });
            if (roomCache.size > 4) roomCache.delete(roomCache.keys().next().value);
          }
          resolve(res.data);
        }
        else {
          const e = new Error(res.data?.error || "请求失败");
          e.status = res.statusCode;
          if (e.status === 429) {
            const headers = res.header || {};
            const key = Object.keys(headers).find(
              (k) => k.toLowerCase() === "retry-after",
            );
            const value = headers[key], seconds = value == null ? NaN : Number(value);
            const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
            e.retryAfterMs = Math.max(1000, Number.isFinite(wait) ? wait : 60000);
            retryAt = Date.now() + e.retryAfterMs;
          }
          if (e.status === 401 && token === (wx.getStorageSync("session") || "")) { wx.removeStorageSync("session"); roomCache.clear(); cacheEpoch++; }
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
let loginPromise;
async function login() {
  if (loginPromise) return loginPromise;
  loginPromise = loginOnce();
  try { return await loginPromise; } finally { loginPromise = null; }
}
async function loginOnce() {
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
    "v1_" + Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}
function uploadAvatar(filePath, code, id, onProgress) {
  if (Date.now() < retryAt) return Promise.reject(Object.assign(new Error("请求冷却中，请稍后重试"), { status: 429 }));
  const token = wx.getStorageSync("session") || "";
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: config.baseUrl + "/api/me/avatar-uploads", filePath, name: "file", timeout: 45000,
      header: { Authorization: "Bearer " + token, "Idempotency-Key": id },
      formData: code ? { code } : {},
      success(res) {
        let data;
        try { data = typeof res.data === "string" ? JSON.parse(res.data) : res.data; }
        catch { return reject(new Error("上传结果尚未确认，请重试上传")); }
        if (res.statusCode >= 200 && res.statusCode < 300 && data?.id && data?.status) return resolve(data);
        const error = Object.assign(new Error(data?.error || "上传失败，请重试"), { status: res.statusCode });
        if (error.status === 429) {
          const headers = res.header || {}, key = Object.keys(headers).find(k => k.toLowerCase() === "retry-after");
          const seconds = Number(headers[key]);
          retryAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000);
        }
        if (error.status === 401 && token === (wx.getStorageSync("session") || "")) { wx.removeStorageSync("session"); roomCache.clear(); cacheEpoch++; }
        reject(error);
      },
      fail(error) {
        const domain = /url not in domain list|不在.*合法域名/i.test(error?.errMsg || "");
        reject(new Error(domain ? "上传地址未通过微信域名校验，请联系管理员检查配置" : "上传结果尚未确认，请检查网络后重试上传"));
      },
    });
    task?.onProgressUpdate?.(value => onProgress?.(value.progress));
  });
}
module.exports = { request, login, requestId, uploadAvatar, assetUrl: path => config.baseUrl.replace(/\/$/, "") + path };
