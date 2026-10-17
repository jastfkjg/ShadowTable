"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const builtinAvatars = require("../../miniprogram/builtin-avatars");
const { avatarStyles } = require("../../miniprogram/avatar-library");
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const assets = {
  "/badges.js": ["../../miniprogram/badges.js", "text/javascript; charset=utf-8"],
  "/badges.css": ["../../miniprogram/pages/badges/badges.wxss", "text/css; charset=utf-8"],
  "/match-story.css": ["../../miniprogram/match-story.wxss", "text/css; charset=utf-8"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/board-detail.js": ["../../miniprogram/board-detail.js", "text/javascript; charset=utf-8"],
  "/board-detail.css": ["board-detail.css", "text/css; charset=utf-8"],
  "/assets/board-search.svg": ["../../miniprogram/assets/board-search.svg", "image/svg+xml"],
  "/assets/board-directory.svg": ["../../miniprogram/assets/board-directory.svg", "image/svg+xml"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/builtin-avatars.js": [null, "text/javascript; charset=utf-8"],
  "/public-history.js": ["../../miniprogram/public-history.js", "text/javascript; charset=utf-8"],
  "/room-swipe.js": ["../../miniprogram/room-swipe.js", "text/javascript; charset=utf-8"],
  "/room-list.js": ["../../miniprogram/room-list.js", "text/javascript; charset=utf-8"],
  "/room-list.css": ["../../miniprogram/room-list.wxss", "text/css; charset=utf-8"],
  "/room-menu.css": ["../../miniprogram/room-menu.wxss", "text/css; charset=utf-8"],
  "/honors.js": ["../../miniprogram/honors.js", "text/javascript; charset=utf-8"],
  "/honors.css": ["../../miniprogram/honors.wxss", "text/css; charset=utf-8"],
  "/fun-copy.js": ["../../miniprogram/fun-copy.js", "text/javascript; charset=utf-8"],
  "/result-registration.js": ["../../miniprogram/result-registration.js", "text/javascript; charset=utf-8"],
  "/leaderboard-presentation.js": ["../../miniprogram/leaderboard-presentation.js", "text/javascript; charset=utf-8"],
  "/leaderboard.css": ["leaderboard.css", "text/css; charset=utf-8"],
  "/monthly-report.js": ["../../miniprogram/monthly-report.js", "text/javascript; charset=utf-8"],
  "/monthly-report-card.js": ["../../miniprogram/monthly-report-card.js", "text/javascript; charset=utf-8"],
  "/poster-canvas.js": ["../../miniprogram/poster-canvas.js", "text/javascript; charset=utf-8"],
  "/monthly.css": ["monthly.css", "text/css; charset=utf-8"],
  "/assets/monthly-report-background.jpg": ["../../miniprogram/assets/monthly-report-background.jpg", "image/jpeg"],
};
for (const name of ["crown", "sword", "moon", "shield", "star", "laurel-1", "laurel-2", "laurel-3"])
  assets["/assets/monthly-" + name + ".svg"] = ["../../miniprogram/assets/monthly-" + name + ".svg", "image/svg+xml"];
for (const name of ["home-table-blue", "room-menu-remove", "room-menu-leave", "room-menu-delete"])
  assets["/assets/" + name + ".svg"] = ["../../miniprogram/assets/" + name + ".svg", "image/svg+xml"];
for (const avatar of builtinAvatars)
  assets[avatar.path] = ["../../miniprogram" + avatar.path, "image/jpeg"];
for (const role of ["merlin", "percival", "assassin"])
  assets["/assets/roles/" + role + ".png"] = ["../../miniprogram/assets/roles/" + role + ".png", "image/png"];
for (const badge of require('../../miniprogram/badges').catalogue)
  assets[badge.imageUrl] = ['../../miniprogram' + badge.imageUrl, 'image/png'];
for (const name of ['info','heart','sword','swords','shield','spark','medal','users'])
  assets['/assets/record-' + name + '.svg'] = ['../../miniprogram/assets/record-' + name + '.svg', 'image/svg+xml'];
// Public, self-contained player web app. Same-origin with /api/ so no CORS.
function serve(req, res, path) {
  const asset = Object.hasOwn(assets, path) ? assets[path] : null;
  if (!asset || req.method !== "GET") return false;
  // Read before committing headers so a missing asset can return a normal 500.
  const content = asset[0] === null
    ? "window.shadowtableBuiltinAvatars = " + JSON.stringify(builtinAvatars) + ";window.shadowtableAvatarStyles = " + JSON.stringify(avatarStyles) + ";"
    : readFileSync(join(__dirname, asset[0]));
  res.setHeader("Content-Type", asset[1]);
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(200);
  res.end(content);
  return true;
}
module.exports = { serve };
