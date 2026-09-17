"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const assets = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
};
// Public, self-contained player web app. Same-origin with /api/ so no CORS.
function serve(req, res, path) {
  const asset = assets[path];
  if (!asset || req.method !== "GET") return false;
  res.setHeader("Content-Type", asset[1]);
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.writeHead(200);
  res.end(readFileSync(join(__dirname, asset[0])));
  return true;
}
module.exports = { serve };