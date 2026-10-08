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
