"use strict";
const { RuleError } = require("./engine");

// Server-only credentials. A token is shared only by this app instance; concurrent
// requests reuse the refresh. The existing code2Session login remains independent.
function createWechatCode({ appId, appSecret, clock = Date.now, fetcher = fetch }) {
  let cached, refreshing;
  async function accessToken() {
    if (cached && cached.until > clock()) return cached.value;
    if (!refreshing) refreshing = (async () => {
      const response = await fetcher("https://api.weixin.qq.com/cgi-bin/stable_token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credential", appid: appId, secret: appSecret }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error("wechat unavailable");
      const data = await response.json();
      if (!data.access_token || !(data.expires_in > 120)) throw Error("wechat token unavailable");
      cached = { value: data.access_token, until: clock() + (data.expires_in - 120) * 1000 };
      return cached.value;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  return async function qrCode(id) {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await accessToken();
        const response = await fetcher("https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=" + encodeURIComponent(token), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene: id, page: "pages/web-login/web-login", check_path: true, env_version: "release", width: 430 }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw Error("wechat code unavailable");
        const bytes = Buffer.from(await response.arrayBuffer());
        const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
        const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        if ((png || jpeg) && bytes.length <= 1024 * 1024)
          return { bytes, mime: png ? "image/png" : "image/jpeg" };
        const data = JSON.parse(bytes.toString("utf8"));
        if (attempt === 0 && [40001, 40014, 42001].includes(data.errcode)) { cached = null; continue; }
        if (data.errcode === 41030) throw new RuleError("小程序登录确认页尚未发布，请稍后再试", 503);
        throw Error("wechat code unavailable");
      }
    } catch (error) {
      if (error instanceof RuleError) throw error;
      // Never expose upstream URLs, credentials, raw responses or fetch errors.
      throw new RuleError("小程序码暂时无法生成，请稍后重试", 503);
    }
  };
}
module.exports = { createWechatCode };
