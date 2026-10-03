"use strict";
const { createHash, createDecipheriv, timingSafeEqual } = require("node:crypto");
const { RuleError } = require("./engine");

// Safe-mode callbacks authenticate the encrypted body, not just the callback URL.
function createWechatAvatarReview({ appId, appSecret, token, aesKey, clock = Date.now, fetcher = fetch }) {
  const key = Buffer.from(aesKey + "=", "base64");
  if (!/^[A-Za-z0-9]{3,128}$/.test(token) || !/^[A-Za-z0-9+/]{43}$/.test(aesKey) || key.length !== 32)
    throw new Error("微信头像审核消息配置无效");
  let cached, refreshing;
  function signed(params, encrypted) {
    const signature = params.get(encrypted ? "msg_signature" : "signature") || "";
    const timestamp = params.get("timestamp"), nonce = params.get("nonce");
    if (!timestamp || !nonce || timestamp.length > 20 || nonce.length > 128 || !/^[a-f0-9]{40}$/.test(signature))
      throw new RuleError("审核消息签名无效", 403);
    const expected = createHash("sha1").update([token, timestamp, nonce, ...(encrypted ? [encrypted] : [])].sort().join("")).digest();
    if (!timingSafeEqual(Buffer.from(signature, "hex"), expected)) throw new RuleError("审核消息签名无效", 403);
  }
  function decrypt(encrypted) {
    try {
      if (typeof encrypted !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw Error();
      const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
      decipher.setAutoPadding(false);
      const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
      const padding = padded.at(-1);
      if (!padding || padding > 32 || !padded.subarray(-padding).every(byte => byte === padding)) throw Error();
      const raw = padded.subarray(0, -padding), length = raw.readUInt32BE(16);
      if (length > raw.length - 20 || raw.subarray(20 + length).toString() !== appId) throw Error();
      return raw.subarray(20, 20 + length).toString("utf8");
    } catch { throw new RuleError("审核消息无效", 403); }
  }
  async function accessToken() {
    if (cached && cached.until > clock()) return cached.value;
    if (!refreshing) refreshing = (async () => {
      const response = await fetcher("https://api.weixin.qq.com/cgi-bin/stable_token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credential", appid: appId, secret: appSecret }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || !data.access_token || !(data.expires_in > 120)) throw Error();
      cached = { value: data.access_token, until: clock() + (data.expires_in - 120) * 1000 };
      return cached.value;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  return {
    verify(params) {
      const echo = params.get("echostr");
      if (!echo || echo.length > 2048) throw new RuleError("审核验证请求无效", 400);
      signed(params, params.has("msg_signature") ? echo : null);
      return params.has("msg_signature") ? decrypt(echo) : echo;
    },
    event(params, envelope) {
      const encrypted = envelope?.Encrypt;
      if (!encrypted) throw new RuleError("审核消息必须使用安全模式及JSON格式", 403);
      signed(params, encrypted);
      let value;
      try { value = JSON.parse(decrypt(encrypted)); } catch (error) {
        if (error instanceof RuleError) throw error;
        throw new RuleError("审核消息格式错误", 400);
      }
      if (value.appid !== appId || value.Event !== "wxa_media_check" || value.version !== 2 || typeof value.trace_id !== "string")
        throw new RuleError("审核消息类型无效", 400);
      return value;
    },
    async submit({ openid, mediaUrl }) {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetcher("https://api.weixin.qq.com/wxa/media_check_async?access_token=" + encodeURIComponent(await accessToken()), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ openid, media_url: mediaUrl, media_type: 2, version: 2, scene: 1 }),
            signal: AbortSignal.timeout(8000),
          });
          const data = await response.json();
          if (attempt === 0 && [40001, 40014, 42001].includes(data.errcode)) { cached = null; continue; }
          if (!response.ok || data.errcode !== 0 || typeof data.trace_id !== "string" || !data.trace_id) throw Error();
          return { traceId: data.trace_id };
        }
      } catch { throw new RuleError("图片审核暂不可用，请稍后重新上传", 503); }
    },
  };
}
module.exports = { createWechatAvatarReview };
