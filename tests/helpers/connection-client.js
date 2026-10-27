const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../../miniprogram");
const settle = () => new Promise(setImmediate);
function harness(route = "pages/scores/scores") {
  let now = 10000, next = 0, listener, pages;
  const jobs = new Map(), calls = [], updates = [];
  const page = { route, data: { loading: true }, setData(value) { Object.assign(this.data, value); } };
  pages = [page];
  const clock = { setTimeout(fn, ms) { const id = ++next;jobs.set(id, { fn, at: now + ms });return id; }, clearTimeout(id) { jobs.delete(id); } };
  const wx = { getStorageSync: () => "session", onNetworkStatusChange(fn) { listener = fn; }, offNetworkStatusChange(fn) { if (listener === fn) listener = null; },
    getNetworkType(options) { options.success({ networkType: "wifi" }); },
    request(options) { calls.push(options); }, removeStorageSync() {},
  };
  const cache = new Map();
  function load(file) {
    if (file.endsWith("/config.js")) return { baseUrl: "https://example.test" };
    if (file.endsWith("/connection-feedback.js")) return require(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };cache.set(file, mod);
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module: mod,
      require: name => load(path.resolve(path.dirname(file), name + ".js")), wx,
      Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }, Math: Object.assign(Object.create(Math), { random: () => 1 }), getCurrentPages: () => pages, ...clock }, { filename: file });
    return mod.exports;
  }
  const connection = load(path.join(root, "page-connection.js")), api = load(path.join(root, "api.js"));
  const release = connection.activate(page, value => updates.push(structuredClone(value)));
  page.load = async () => {
    page.data.loading = true;
    try { return await api.request("/api/me/score-ledger?offset=0"); }
    catch (error) { page.data.error = error.message; }
    finally { page.data.loading = false; }
  };
  return { page, api, connection, calls, updates, jobs, release, loadModule:load, wx, last: () => updates.at(-1),
    network(connected) { listener?.({ isConnected: connected }); },
    setPages(value) { pages = value; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, job]) => job.at <= end).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
        if (!due) break;
        now = due[1].at;jobs.delete(due[0]);due[1].fn();await settle();
      }
      now = end;await settle();
    },
  };
}
module.exports = { harness, settle };
