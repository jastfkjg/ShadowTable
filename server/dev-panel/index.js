"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const assets = {
  "/dev": ["index.html", "text/html; charset=utf-8"],
  "/dev/": ["index.html", "text/html; charset=utf-8"],
  "/dev/icon.svg": ["icon.svg", "image/svg+xml"],
  "/dev/panel.js": ["panel.js", "text/javascript; charset=utf-8"],
  "/dev/panel.css": ["panel.css", "text/css; charset=utf-8"],
};
function serve(req, res, path) {
  const asset = assets[path];
  if (!asset || req.method !== "GET") return false;
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    req.socket.remoteAddress,
  );
  const host = req.headers.host || "";
  // Check socket AND Host, so LAN access and DNS rebinding do not expose the panel.
  if (!local || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
    return false;
  if (
    req.headers.origin &&
    !["http://" + host, "https://" + host].includes(req.headers.origin)
  )
    return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  res.setHeader("Content-Type", asset[1]);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.writeHead(200);
  res.end(readFileSync(join(__dirname, asset[0])));
  return true;
}
module.exports = { serve };
