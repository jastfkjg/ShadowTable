// Page-scoped connection feedback. API observers never replay a write operation.
const feedback = require("./connection-feedback");
const states = new WeakMap();
const failures = new WeakMap();
const groups = new WeakMap();
const currentPage = () => typeof getCurrentPages === "function" ? getCurrentPages().slice(-1)[0] : null;
function target(page) {
  if (page.lobbyController) return page.data.activeTab === 1 ? page.personalController : null;
  if (page.sharedController) return page.sharedController;
  if (page.statisticsController) return page.data.tab === "matches" ? page.historyController : page.statisticsController;
  return page;
}
function config(page) {
  if (!page?.data) return null;
  const route = page.route || "", owner = target(page);
  if (!owner || route === "pages/table/table") return null;
  const name = route.split("/")[1];
  if (["lobby", "me"].includes(name) && !page.lobbyController) return null;
  const options = {
    lobby: ["load", /^\/api\/me\/(profile|stats)(?:\?|$)/],
    me: ["load", /^\/api\/me\/(profile|stats)(?:\?|$)/],
    stats: [page.sharedController ? "loadSharedRecord" : page.data.tab === "matches" ? "retry" : "load", page.sharedController ? /^\/api\/(me\/)?shares(?:[/?]|$)/ : /^\/api\/me\/(stats|matches)(?:[/?]|$)/],
    matches: [page.sharedController ? "loadSharedRecord" : "retry", page.sharedController ? /^\/api\/(me\/)?shares(?:[/?]|$)/ : /^\/api\/me\/matches(?:[/?]|$)/],
    shared: ["loadSharedRecord", /^\/api\/(me\/)?shares(?:[/?]|$)/],
    scores: [owner.data.moreError ? "retryMore" : "load", /^\/api\/me\/score-ledger/],
    leaderboard: ["retry", /^\/api\/(leaderboard(?:\?|$)|me\/leaderboard-visibility)/],
    monthly: ["load", /^\/api\/monthly-report/],
    replay: ["load", /^\/api\/me\/matches\/.+\/replay/],
    "board-details": ["load", /^\/api\/boards$/],
    help: ["loadBoards", /^\/api\/(boards|scoring\/rules)$/],
    badges: ["onShow", /^\/api\/me\/badges/],
    settings: ["load", /^\/api\/(rooms\/\d{6}(?:[/?]|$)|boards$)/],
    profile: ["load", /^\/api\/me\/profile$/],
    "data-management": ["onShow", /^\/api\/me\/record-clearing/],
    "web-login": ["load", /^\/api\/(me\/profile|web-auth\/requests\/)/],
    share: ["load", /^\/api\/(me\/(profile|stats)|monthly-report|leaderboard)/],
  };
  const option = options[name];
  return option ? { owner, method: option[0], paths: option[1], name,
    scope: name + ":" + (page.data.activeTab ?? page.data.tab ?? "") + ":" + !!page.sharedController } : null;
}
function ensure(page) {
  let state = states.get(page);
  if (!state) {
    state = { page, listeners: new Set(), foreground: true, network: true, requests: new Set(), generation: 0, attempts: 0, group: 0 };
    states.set(page, state);
  }
  const option = config(page);
  if (state.option?.scope !== option?.scope) {
    clear(state);state.generation++;state.requests.clear();
    const saved = option && failures.get(option.owner);
    state.failure = saved?.failure || null;state.rateLimitUntil = saved?.rateLimitUntil || 0;
    state.retryAt = saved?.read ? Math.max(Date.now() + 1000, state.rateLimitUntil) : 0;
    state.attempts = 0;state.show = false;state.failedGroup = -1;
  }
  state.option = option;
  const saved = option && failures.get(option.owner);
  if (saved && !state.failure && !state.requests.size) {
    state.failure = saved.failure;state.rateLimitUntil = saved.rateLimitUntil;
    state.retryAt = saved.read ? Math.max(Date.now() + 1000, state.rateLimitUntil || 0) : 0;
  }
  return state;
}
function clear(state) { clearTimeout(state.timer);clearTimeout(state.clock);clearTimeout(state.settle);state.timer = state.clock = state.settle = null; }
function busy(state) {
  const d = state.option?.owner.data || {};
  return !!(d.busy || d.saving || d.uploadBusy || d.visibilitySaving || d.badgeManagerSaving || d.rendering || d.acting);
}
function view(state) {
  const data = state.option?.owner.data || {};
  const active = state.requests.size > 0 && state.show;
  const pending = data.pendingSave || data.pendingTransfer || data.pendingKick || data.pending || data.hasPendingRequest;
  return { loading: active, network: state.network, reconnecting: !!state.failure, needsLogin: state.failure?.status === 401,
    hasPendingRequest: !!pending,
    ...feedback.present({ network: state.network, busy: busy(state), reconnecting: !!state.failure,
      needsLogin: state.failure?.status === 401, hasPendingRequest: !!pending },
    { active, context: "page", startedAt: state.startedAt, retryAt: state.retryAt,
      rateLimitUntil: state.rateLimitUntil, failure: state.failure?.kind }, Date.now()) };
}
function publish(state) {
  if (!state.foreground || !state.option || currentPage() !== state.page) return;
  const value = view(state);
  value.connectionVisible = !!(value.loading || value.reconnecting || !value.network || value.needsLogin);
  // Existing validation and permission errors remain in their own page context.
  const owner = state.option.owner;
  if (owner.data.connectionVisible !== value.connectionVisible && (value.connectionVisible || owner.data.connectionVisible))
    owner.setData({ connectionVisible: value.connectionVisible });
  for (const listener of state.listeners) listener(value);
}
function arm(state) {
  clear(state);
  if (!state.foreground || !state.option || currentPage() !== state.page) return;
  publish(state);
  if (state.requests.size && state.show || state.network && state.retryAt > Date.now()) {
    state.clock = setTimeout(() => { state.clock = null;arm(state); }, 1000);
  }
  if (state.network && state.retryAt && !state.requests.size) {
    state.timer = setTimeout(() => { state.timer = null;retry(state.page, true); }, Math.max(0, state.retryAt - Date.now()));
  }
}
function retryable(error) { return error && error.retryable !== false && (!error.status || error.status >= 500 || [401, 429].includes(error.status)); }
function begin(path, method = "GET") {
  const page = currentPage();if (!page) return null;
  const state = ensure(page), option = state.option;
  if (!option || !state.foreground || !(method === "AUTH" || option.paths.test(path) || state.probing && path === "/api/boards")) return null;
  const data = option.owner.data;
  if (!state.requests.size) {
    state.group++;state.failedGroup = -1;state.startedAt = Date.now();state.retryAt = 0;
    state.show = !!state.failure || !!(data.loading || data.loadingBoards || data.scoringLoading || data.badgeManagerLoading);
  }
  groups.set(option.owner, state.group);
  const handle = { state, owner:option.owner, revision:option.owner.sequence,
    generation: state.generation, group: state.group, method, path };
  state.requests.add(handle);arm(state);return handle;
}
function finish(handle, error) {
  if (!handle) return;
  const { state } = handle;
  if (handle.revision !== handle.owner.sequence) {
    state.requests.delete(handle);
    if (!state.requests.size && state.successGroup === state.group && state.failedGroup !== state.group)
      recovered(state, handle.owner);
    arm(state);return;
  }
  const read = handle.method === "GET" || handle.method === "AUTH" || /\/inspect$/.test(handle.path);
  const failure = retryable(error) ? { status:error.status,
    kind:error.status === 429 ? "rate" : /timeout|timed out|超时/i.test(error.message || "") ? "timeout" : "failed" } : null;
  const latest = groups.get(handle.owner) === handle.group;
  if (failure && latest) failures.set(handle.owner, { failure, read:read && error.status !== 401,
    rateLimitUntil:error.status === 429 ? Date.now() + (error.retryAfterMs || 60000) : 0 });
  // A read may finish after returning to the same page without a replacement read.
  if (handle.generation !== state.generation && latest && state.foreground && currentPage() === state.page &&
      state.option?.owner === handle.owner && !state.requests.size) {
    handle.generation = state.generation;state.requests.add(handle);
  }
  if (handle.generation !== state.generation || !state.requests.delete(handle)) return;
  if (retryable(error)) {
    state.failedGroup = handle.group;state.show = true;state.attempts++;
    state.failure = failure;
    state.rateLimitUntil = error.status === 429 ? Date.now() + (error.retryAfterMs || 60000) : 0;
    // Retry page reads only. Writes keep their original pending command and key.
    state.retryAt = state.network && read && error.status !== 401
      ? Date.now() + Math.max(feedback.retryDelay(state.attempts), (state.rateLimitUntil || 0) - Date.now()) : 0;
  } else {
    state.successGroup = handle.group;
    if (!state.requests.size && state.failedGroup !== handle.group) recovered(state, handle.owner);
  }
  arm(state);
  // Controller catch/finally handlers finish their own busy flags first.
  if (state.foreground && currentPage() === state.page)
    state.settle = setTimeout(() => { state.settle = null;if (handle.generation === state.generation) arm(state); }, 0);
}
function recovered(state, owner) {
  state.failure = null;state.retryAt = 0;state.attempts = 0;state.rateLimitUntil = 0;state.show = false;
  failures.delete(owner);
}
async function retry(page, automatic = false) {
  const state = ensure(page);
  if (!state.option || !state.foreground || currentPage() !== page || state.requests.size || busy(state)) {
    if (state.option && state.foreground && automatic && !state.requests.size) { state.retryAt = Date.now() + 1000;arm(state); }
    return;
  }
  if (Date.now() < (state.rateLimitUntil || 0)) { arm(state);return; }
  if (automatic && !state.network) return;
  state.retryAt = 0;clear(state);state.show = true;
  const { owner, method, name } = state.option;
  const data = owner.data;
  try {
    // These reads must preserve local edits and unconfirmed destructive commands.
    if (["profile", "settings", "data-management"].includes(name) &&
        (data.dirty || data.editingNickname || data.pendingSave || data.pendingTransfer || data.pendingKick || data.pending)) {
      state.probing = true;
      const api = require("./api");await api.login();await api.request("/api/boards");
    } else if (name === "help") {
      await Promise.all([owner.loadBoards(), owner.loadScoreRules()]);
    } else await owner[method]?.();
  } catch (_) { /* The API observer already recorded the failed connection. */ }
  finally { state.probing = false;arm(state); }
}
function activate(page, listener) {
  const state = ensure(page);state.foreground = true;state.listeners.add(listener);
  if (!state.networkListener && state.option && !page.data.singlePage) {
    state.networkListener = value => {
      const disconnected = !state.network;
      state.network = !!value.isConnected;
      if (!state.network) state.retryAt = 0;
      arm(state);
      if (state.network && (state.failure || disconnected)) Promise.resolve().then(() => retry(page, true));
    };
    wx.onNetworkStatusChange?.(state.networkListener);
    wx.getNetworkType?.({ success(value) { if (!state.foreground) return;state.network = value.networkType !== "none";arm(state); } });
  }
  arm(state);
  return () => {
    state.listeners.delete(listener);
    if (!state.listeners.size) {
      clear(state);state.foreground = false;state.generation++;state.requests.clear();
      if (state.networkListener) wx.offNetworkStatusChange?.(state.networkListener);
      state.networkListener = null;
    }
  };
}
module.exports = { begin, finish, activate, retry, retryable };
