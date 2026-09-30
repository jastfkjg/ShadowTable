"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const builtinAvatars = require("../../miniprogram/builtin-avatars");
const { avatarStyles } = require("../../miniprogram/avatar-library");
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const assets = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/builtin-avatars.js": [null, "text/javascript; charset=utf-8"],
};
for (const avatar of builtinAvatars)
  assets[avatar.path] = ["../../miniprogram" + avatar.path, "image/jpeg"];
// Public, self-contained player web app. Same-origin with /api/ so no CORS.
function serve(req, res, path) {
  const asset = Object.hasOwn(assets, path) ? assets[path] : null;
  if (!asset || req.method !== "GET") return false;
  res.setHeader("Content-Type", asset[1]);
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(200);
  res.end(asset[0] === null
    ? "window.shadowtableBuiltinAvatars = " + JSON.stringify(builtinAvatars) + ";window.shadowtableAvatarStyles = " + JSON.stringify(avatarStyles) + ";"
    : readFileSync(join(__dirname, asset[0])));
  return true;
}
module.exports = { serve };
