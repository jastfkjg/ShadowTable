"use strict";
const { BlockList, isIP } = require("node:net");

function clientAddressResolver(cidrs = "") {
  const trusted = new BlockList();
  for (const raw of (Array.isArray(cidrs) ? cidrs : cidrs.split(",")).map(s => s.trim()).filter(Boolean)) {
    const [ip, mask, extra] = raw.split("/"), family = isIP(ip);
    if (!family || extra !== undefined || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) > (family === 4 ? 32 : 128)))) throw new Error("TRUSTED_PROXY_CIDRS 无效：" + raw);
    if (mask === undefined) trusted.addAddress(ip, family === 4 ? "ipv4" : "ipv6");
    else trusted.addSubnet(ip, Number(mask), family === 4 ? "ipv4" : "ipv6");
  }
  const normalize = value => value?.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  const isTrusted = value => { const ip = normalize(value), family = isIP(ip || ""); return !!family && trusted.check(ip, family === 4 ? "ipv4" : "ipv6"); };
  return req => {
    const peer = normalize(req.socket.remoteAddress) || "unknown", header = req.headers["x-forwarded-for"];
    if (!isTrusted(peer) || typeof header !== "string" || header.length > 2048) return peer;
    const hops = header.split(",").map(h => normalize(h.trim()));
    if (hops.length > 20 || hops.some(ip => !isIP(ip))) return peer;
    let address = peer;
    for (let i = hops.length - 1; i >= 0 && isTrusted(address); i--) address = hops[i];
    return address;
  };
}

// Fixed buckets avoid retaining request paths, player identifiers or unbounded samples.
function createMetrics({ clock = () => Date.now(), logger = console } = {}) {
  const bounds = [10, 50, 100, 250, 500, 1000, 3000, 10000, Infinity];
  let counts = {}, buckets = bounds.map(() => 0), total = 0;
  const observe = (status, elapsed) => { total++; counts[status] = (counts[status] || 0) + 1; buckets[bounds.findIndex(n => elapsed <= n)]++; };
  const flush = () => {
    if (!total) return;
    let n = 0; const p95 = bounds.find((_, i) => (n += buckets[i]) >= total * .95);
    logger.log(JSON.stringify({ event: "http-metrics", at: clock(), requests: total, statuses: counts, p95MsUpperBound: Number.isFinite(p95) ? p95 : ">10000" }));
    total = 0; counts = {}; buckets = bounds.map(() => 0);
  };
  return { observe, flush };
}
module.exports = { clientAddressResolver, createMetrics };
