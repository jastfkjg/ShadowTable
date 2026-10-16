"use strict";
// Exercise the headers Caddy forwards. Node 24 fetch does not preserve an
// overridden Host header, so use node:http for this loopback proxy simulation.
const http = require("node:http");
const fs = require("node:fs");
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8787";
const sessionFile = process.env.SMOKE_SESSION_FILE || "/data/smoke-token";
const origin = "https://table.example.com";

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, baseUrl), {
      method,
      headers: { Host: new URL(origin).host, ...headers },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          // Report the server error, never dump a successful session token.
          reject(new Error(`${method} ${path}: HTTP ${res.statusCode}: ${text.slice(0, 500)}`));
          return;
        }
        resolve(text);
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error(`${method} ${path}: timeout`)));
    req.on("error", reject);
    req.end(body);
  });
}

async function main() {
  if (process.argv[2] === "login") {
    const html = await request("/");
    if (!html.includes("<html")) throw new Error("Web entry did not return HTML");
    // Fetch the dependencies from the actual image, not the source checkout.
    const assets = new Set(Array.from(html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi), match => match[1]));
    if (!assets.size) throw new Error("Web entry has no assets");
    // These images are referenced by rendered views rather than the HTML shell.
    for (const asset of ["/assets/board-search.svg", "/assets/board-directory.svg",
      ...["merlin", "percival", "assassin"].map(name => "/assets/roles/" + name + ".png"),
      ...["crown", "sword", "moon", "shield", "star", "laurel-1", "laurel-2", "laurel-3"].map(name => "/assets/monthly-" + name + ".svg")]) assets.add(asset);
    for (const asset of assets) {
      const url = new URL(asset, origin);
      if (url.origin !== origin) throw new Error(`Unexpected external web asset: ${asset}`);
      const content = await request(url.pathname + url.search);
      if (!content.trim()) throw new Error(`Empty web asset: ${asset}`);
      if (url.pathname.endsWith(".js")) new (require("node:vm").Script)(content, { filename: asset });
    }
    const data = JSON.parse(await request("/api/guest-login", {
      method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: "{}",
    }));
    if (!/^[a-f0-9]{64}$/.test(data.token)) throw new Error("Guest login returned an invalid token");
    const artwork = await request("/assets/monthly-report-background.jpg");
    if (Buffer.from(artwork, "utf8").length < 1000) throw new Error("Monthly artwork was not packaged");
    const report = JSON.parse(await request("/api/monthly-report", { headers: { Authorization: "Bearer " + data.token } }));
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(report.month) || !Array.isArray(report.mainBoards)) throw new Error("Monthly report is unavailable in the image");
    const badges = JSON.parse(await request("/api/me/badges", { headers: { Authorization: "Bearer " + data.token } }));
    if (!Array.isArray(badges.badges) || badges.maxEquipped !== 3) throw new Error("Honor badge API is unavailable in the image");
    for (const badge of require(require("node:path").join(process.cwd(), "miniprogram/badges")).catalogue) {
      const image = await request(badge.imageUrl);
      if (Buffer.byteLength(image) < 1000) throw new Error(`Badge artwork was not packaged: ${badge.id}`);
    }
    fs.writeFileSync(sessionFile, data.token, { mode: 0o600 });
  } else if (process.argv[2] === "resume") {
    const token = fs.readFileSync(sessionFile, "utf8");
    const data = JSON.parse(await request("/api/me/rooms", { headers: { Authorization: "Bearer " + token } }));
    if (!Array.isArray(data.rooms)) throw new Error("Session did not survive restart");
  } else {
    throw new Error("Usage: smoke-client.cjs login|resume");
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
