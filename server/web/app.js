(function () {
  "use strict";
  const funCopy = window.shadowtableFunCopy;
  const rankPresentation = window.shadowtableLeaderboard;

  // ===== DOM =====
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var modal = document.getElementById("modal");
  var modalTitle = document.getElementById("modal-title");
  var modalMessage = document.getElementById("modal-message");
  var modalOk = document.getElementById("modal-ok");
  var modalCancel = document.getElementById("modal-cancel");

  // ===== Constants / pure helpers (mirror of the mini-program) =====
  var CHOICES = {
    confirm: "确认",
    approve: "赞成",
    reject: "反对",
    success: "任务成功",
    fail: "任务失败",
    magic: "魔法（反转结果）",
    thiefFail: "盗贼失败",
    pass: "不使用技能 / 确认",
  };
  // Derive private skill controls only from the server's allowed choices.
  function skillView(room, choices, hunterModes, hunterMode, swapOptions) {
    const skillAction = ["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn"].includes(room.phase);
    const targets = choices.filter(c => /^(target|inspect|detonate|passive):\d+$/.test(c.value)).map(c => {
      const seat = Number(c.value.split(":")[1]);
      const player = (room.players || []).find(p => p.seat === seat);
      return { ...c, seat, name: player ? player.name : "" };
    });
    let title = "使用技能";
    let hint = "请选择一名目标，或本轮不使用技能";
    if (swapOptions.length) {
      title += " · 秘密换号";
      hint = "选择两个座位交换号码，再次点击可取消";
    } else if (hunterModes) {
      title += hunterMode === "detonate" ? " · 主动自爆" : hunterMode === "passive" ? " · 被动开枪" : " · 猎人";
      hint = hunterMode === "detonate" ? "第 2 步：选择相邻一人，自己将自爆出局" : hunterMode === "passive" ? "第 2 步：选择出局时开枪的目标；替女巫出局不触发" : "第 1 步：选择主动技能、被动技能，或本轮不开枪";
    } else if (targets.length) {
      const label = targets[0].label;
      const name = ["指定替死者", "秘密守护", "查验", "复活", "开枪", "决斗", "开刀"].find(word => label.includes(word));
      if (name) title += " · " + name;
      if (name === "查验") hint = "选择一名玩家，查验其是否拥有主动击杀能力";
    } else {
      hint = "本阶段没有可选目标，请确认本轮选择";
    }
    return {
      skillAction, skillTitle: title, skillHint: hint, skillTargets: targets,
      skillBodyHeight: Math.ceil((swapOptions.length ? new Set(swapOptions.flatMap(v => v.split(":").slice(1))).size : targets.length) / 3) * 164 + (swapOptions.length ? 60 : 0),
      skillOtherChoices: choices.filter(c => !targets.some(t => t.value === c.value)).map(c => ({
        ...c, label: c.value === "pass" ? (hunterModes ? "本轮不开枪" : c.label === "确认" ? "本轮确认" : "本轮不使用技能") : c.label,
      })),
    };
  }
  function skillDraftLabel(choice, hunterModes) {
    if (choice.value === "pass") return hunterModes ? "本轮不开枪" : choice.label === "确认" ? "本轮确认" : "不使用技能";
    if (choice.value.startsWith("inspect:")) return "查验 " + choice.value.split(":")[1] + " 号";
    return choice.label;
  }
  function factionTone(faction) {
    if (!faction) return "";
    if (faction.indexOf("好人") !== -1) return "good";
    if (faction.indexOf("坏人") !== -1) return "evil";
    if (faction.indexOf("盗贼") !== -1) return "third";
    return "";
  }
  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }
  function voteSummary(votes) {
    return (votes.some(function (v) { return v.approve === null; }) ? [true, false, null] : [true, false])
      .map(function (approve) {
        var seats = votes
          .filter(function (v) {
            return v.approve === approve;
          })
          .map(function (v) {
            return v.seat;
          })
          .sort(function (a, b) {
            return a - b;
          });
        return (
          seats.length +
          "票" +
          (approve === null ? "弃权" : approve ? "赞成" : "反对") +
          "：" +
          (seats.length ? seats.join("，") : "无")
        );
      })
      .join("\n");
  }
  function toolHistory(h, key) {
    if (["skillDetail", "skillResult", "toolCutoff"].indexOf(h.kind) !== -1)
      return { key: key, text: h.text, detail: h.detail || "" };
    if (h.kind === "variant") return { key: key, text: h.text, detail: "" };
    if (h.kind === "toolVote")
      return {
        key: key,
        text: "投票" + (h.approved ? "通过" : "未通过") + (h.earlyClosed ? " · 提前截止" : ""),
        voteGroups: (h.votes.some(function (v) { return v.approve === null; }) ? [true, false, null] : [true, false]).map(function (approve) {
          var seats = h.votes
            .filter(function (v) {
              return v.approve === approve;
            })
            .map(function (v) {
              return v.seat;
            })
            .sort(function (a, b) {
              return a - b;
            });
          return {
            label: approve === null ? "弃权" : approve ? "赞成" : "反对",
            count: seats.length,
            seats: seats.length ? seats.join("、") + " 号" : "无",
            tone: approve === null ? "abstain" : approve ? "approve" : "reject",
          };
        }),
        teamLabel: h.team.length ? h.team.join("、") + " 号" : "",
        detail:
          (h.team.length ? "队伍 " + h.team.join("、") + "号\n" : "") +
          voteSummary(h.votes),
      };
    if (h.kind === "toolQuest")
      return {
        key: key,
        text: h.success ? "任务成功" : "任务失败",
        questResult: h.success ? "success" : "failure",
        teamLabel: h.team.join("、") + " 号",
        cards: Object.entries(
          h.counts || { success: h.team.length - h.fails, fail: h.fails },
        )
          .filter(function (entry) {
            return entry[1] > 0;
          })
          .map(function (entry) {
            var kind = entry[0];
            return {
              label:
                {
                  success: "成功",
                  fail: "失败",
                  thiefFail: "盗贼失败",
                  magic: "魔法",
                }[kind] || kind,
              count: entry[1],
              tone: kind === "success" ? "success" : ["fail", "thiefFail"].includes(kind) ? "failure" : "",
            };
          }),
        detail: h.counts
          ? h.team.join("、") +
            "号 · 成功" +
            h.counts.success +
            " / 失败" +
            h.counts.fail +
            " / 盗贼失败" +
            h.counts.thiefFail +
            " / 魔法" +
            h.counts.magic
          : h.team.join("、") + "号 · " + h.fails + "张失败票",
      };
    if (h.kind === "toolKnife")
      return {
        key: key,
        text: "刀梅林",
        detail:
          (h.target === 0 ? "空刀" : h.target + "号") +
          " · " +
          (h.hit
            ? h.target === 0
              ? "空刀命中"
              : "命中梅林"
            : h.target === 0
              ? "空刀未命中"
              : "未命中梅林"),
      };
    if (h.kind === "toolReverse")
      return {
        key: key,
        text: "刀逆仆已结算",
        detail: "结果仅向相关玩家展示，可继续发起其他操作",
      };
    if (h.kind === "toolOffline")
      return { key: key, text: "线下刀人已完成", detail: "以线下结算为准" };
    if (h.kind === "toolCanceled")
      return {
        key: key,
        text: h.text || "未结算的操作已作废",
        detail: h.detail || "未公开或计入本次提交",
      };
    return null;
  }

  // ===== storage =====
  var storage = {
    get: function (k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
    remove: function (k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    },
  };
  function safeParse(s) {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  // ===== mini-program confirmation for this browser =====
  var webLoginTimer = 0, webLoginSequence = 0, webLoginPolling = false;
  async function accountRequest(path, method = 'GET', guest = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (webSessionTag) headers['X-Web-Session'] = webSessionTag;
    if (guest && !webAccountExpired && storage.get('session')) headers.Authorization = 'Bearer ' + storage.get('session');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 25000) : null;
    try {
      const response = await fetch('/api/web-auth/' + path, {
        method, headers, credentials: 'same-origin', ...(controller ? { signal: controller.signal } : {}),
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      const data = await response.json();
      if (!response.ok && response.status >= 400) throw Object.assign(new Error(data.error || '登录请求失败'), { status: response.status });
      return data;
    } catch (e) {
      if (e.status) throw e;
      throw new Error('登录请求未确认，请检查网络后重试');
    } finally { if (timeout !== null) clearTimeout(timeout); }
  }
  async function initializeWebAccount() {
    const result = await accountRequest('session');
    state.serverConnected = true;
    webAuthEnabled = result.enabled;
    webSessionTag = result.authenticated ? result.sessionTag : '';
    webAccountExpired = !result.authenticated && !!storage.get('webAccount');
    if (result.authenticated) {
      // A claim response may have been lost after the browser accepted its
      // cookie. Never resume an old guest command under that cookie identity.
      if (storage.get('webAccount') !== 'wechat' || storage.get('session')) forgetAccountDrafts();
      if (storage.get('session')) storage.set('guestSession', storage.get('session'));
      storage.remove('session'); storage.set('webAccount', 'wechat');
    }
  }
  function forgetAccountDrafts() {
    for (const key of ['pendingEntry', 'roomCode', 'nickname']) storage.remove(key);
  }
  function reloadAccount() {
    // A full reload discards all private views, pending actions, drafts and old
    // async callbacks together. Other tabs receive only a change notification.
    forgetAccountDrafts();
    storage.set('accountRevision', requestId());
    window.location.replace('/#/me');
    window.location.reload();
  }
  async function startWebLogin() {
    if (state.webLoginBusy) return;
    clearTimeout(webLoginTimer);
    const sequence = ++webLoginSequence;
    setState({ webLogin: null, webLoginBusy: true, webLoginError: '', webLoginStatus: 'creating' });
    try {
      const result = await accountRequest('requests', 'POST', true);
      if (sequence !== webLoginSequence || state.page !== 'login') return;
      setState({ webLogin: result, webLoginStatus: 'pending' });
    } catch (e) {
      if (sequence !== webLoginSequence) return;
      if (e.status === 409) {
        const session = await accountRequest('session').catch(() => null);
        if (session?.authenticated && sequence === webLoginSequence) { reloadAccount(); return; }
      }
      if (e.status === 401 && !webAccountExpired) storage.remove('session');
      setState({ webLoginError: e.message, webLoginStatus: 'error' });
    } finally {
      if (sequence === webLoginSequence) {
        setState({ webLoginBusy: false });
        if (state.webLogin) pollWebLogin();
      }
    }
  }
  async function pollWebLogin() {
    clearTimeout(webLoginTimer);
    if (webLoginPolling || !foreground || state.page !== 'login' || !state.webLogin || state.webLoginBusy || ['expired', 'cancelled', 'error'].includes(state.webLoginStatus)) return;
    const sequence = webLoginSequence, item = state.webLogin;
    if (Date.now() >= item.expiresAt) { setState({ webLoginStatus: 'expired', webLoginError: '' }); return; }
    webLoginPolling = true;
    let delay = 2000;
    try {
      const result = await accountRequest('requests/' + item.id);
      if (sequence !== webLoginSequence || state.page !== 'login') return;
      setState({ webLoginStatus: result.status, webLoginError: '' });
      if (['confirmed', 'consumed'].includes(result.status)) {
        setState({ webLoginBusy: true });
        const claimed = await accountRequest('requests/' + item.id + '/claim', 'POST');
        if (sequence !== webLoginSequence) return;
        if (storage.get('session')) storage.set('guestSession', storage.get('session'));
        storage.remove('session'); storage.set('webAccount', 'wechat');
        webSessionTag = claimed.sessionTag; webAccountExpired = false;
        reloadAccount(); return;
      }
    } catch (e) {
      if (sequence !== webLoginSequence) return;
      delay = e.status === 429 ? 60000 : 4000;
      setState({ webLoginError: e.message, ...(e.status === 410 ? { webLoginStatus: 'expired' } : e.status && e.status < 500 && e.status !== 429 ? { webLoginStatus: 'error' } : {}) });
    } finally {
      webLoginPolling = false;
      if (sequence === webLoginSequence) {
        setState({ webLoginBusy: false });
        if (foreground && state.page === 'login' && !['expired', 'cancelled', 'error'].includes(state.webLoginStatus))
          webLoginTimer = setTimeout(pollWebLogin, delay);
      } else if (foreground && state.page === 'login' && state.webLogin && !state.webLoginBusy)
        webLoginTimer = setTimeout(pollWebLogin, 0);
    }
  }
  async function cancelWebLogin() {
    if (state.webLoginBusy) return false;
    const item = state.webLogin;
    ++webLoginSequence; clearTimeout(webLoginTimer);
    if (item && !['expired', 'cancelled'].includes(state.webLoginStatus)) {
      try { await accountRequest('requests/' + item.id + '/cancel', 'POST'); }
      catch (e) {
        if (e.status !== 410) {
          // A claim can win the race with cancel; reflect the actual cookie state.
          const session = await accountRequest('session').catch(() => null);
          if (session?.authenticated) { reloadAccount(); return false; }
          setState({ webLoginError: e.message }); return false;
        }
      }
    }
    setState({ webLogin: null, webLoginStatus: '', webLoginError: '' }); return true;
  }
  async function continueAsGuest() {
    if (state.webLoginBusy || !(await mayNavigate())) return;
    if (webSessionTag && !await confirm('退出当前网页登录？', '只退出此浏览器，小程序保持登录。将返回原游客身份；游客记录不会合并。')) return;
    ++webLoginSequence; clearTimeout(webLoginTimer);
    setState({ webLoginBusy: true, webLoginError: '' });
    try {
      await accountRequest('logout', 'POST');
      webSessionTag = ''; webAccountExpired = false; storage.remove('webAccount');
      const guest = storage.get('guestSession');
      if (guest) { storage.set('session', guest); storage.remove('guestSession'); }
      // Only a still-valid guest credential can recover its previous records.
      if (storage.get('session')) {
        try { await request('/api/me/profile'); }
        catch (e) { /* Expired guest tokens are removed by request; network errors retry after reload. */ }
      }
      reloadAccount();
    } catch (e) { setState({ webLoginError: e.message }); }
    finally { setState({ webLoginBusy: false }); }
  }
  function viewWebLogin() {
    const item = state.webLogin, status = state.webLoginStatus;
    let html = '<section class="web-login-page">' + personalTitle('使用小程序账号登录', '', false);
    html += '<p class="muted">' + (webAccountExpired ? '网页登录已过期。重新扫码即可恢复账号、资料与战绩。' : '用微信扫一扫，在桌边助手小程序中确认。') + '</p>';
    if (!webAuthEnabled) html += '<p class="notice">小程序扫码登录暂未开放，你仍可使用游客身份。</p>';
    else {
      const message = { creating: '正在生成小程序码…', pending: '等待微信扫码', scanned: '已扫码，请在小程序中确认', confirmed: '已确认，正在登录…', consumed: '正在恢复登录…', cancelled: '登录已取消', expired: '小程序码已过期', error: '暂时无法登录' }[status] || '点击下方按钮生成小程序码';
      html += '<div class="web-login-code">' + (item && ['pending', 'scanned'].includes(status) ? '<img src="' + esc(item.qrCode) + '" width="256" height="256" alt="使用微信扫描，进入小程序确认网页登录" />' : '<div class="web-login-placeholder">' + esc(message) + '</div>') + '</div>';
      html += '<p class="web-login-status" role="status" aria-live="polite">' + esc(message) + '</p><p class="small muted">小程序码两分钟内有效。请仅确认你自己发起的登录。</p>';
      html += btn('primary', 'startWebLogin', item ? '刷新小程序码' : '生成小程序码', null, state.webLoginBusy);
    }
    if (state.webLoginError) html += '<div class="inline-error" role="alert">' + esc(state.webLoginError) + '</div>';
    html += '<p class="small muted web-login-note">登录后显示小程序账号的数据。原游客记录暂不合并；退出网页登录可返回原游客身份，原凭证失效后无法恢复。</p>';
    html += btn('secondary', 'continueAsGuest', webAccountExpired ? '继续以游客身份访问' : '返回游客访问', null, state.webLoginBusy) + '</section>';
    return html;
  }

  // ===== API =====
  var webSessionTag = '', webAuthEnabled = false, webAccountExpired = false;
  var retryAt = 0, cacheEpoch = 0;
  const roomCache = new Map();
  const copyResponse = value => JSON.parse(JSON.stringify(value));
  function request(path, method, data, id) {
    if (Date.now() < retryAt)
      return Promise.reject(
        Object.assign(new Error("请求冷却中，请稍后重试"), {
          status: 429,
          retryAfterMs: retryAt - Date.now(),
        }),
      );
    const tag = webSessionTag, token = tag ? '' : storage.get("session") || "", cacheKey = (tag || token) + path;
    const cacheable = (!method || method === "GET") && /^\/api\/rooms\/\d{6}$/.test(path);
    if (method && method !== "GET") { roomCache.clear(); cacheEpoch++; }
    const cached = cacheable && roomCache.get(cacheKey), epoch = cacheEpoch;
    var headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
    if (tag) headers['X-Web-Session'] = tag;
    if (cached) headers["If-None-Match"] = cached.etag;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 10000) : null;
    if (id) headers["Idempotency-Key"] = id;
    return fetch(path, {
      method: method || "GET",
      ...(controller ? { signal: controller.signal } : {}),
      headers: headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    })
      .then(function (response) {
        if (tag !== webSessionTag) throw Object.assign(new Error('浏览器账号已变化，请刷新页面'), { status: 409 });
        if (response.status === 304 && cached) return funCopy.response(copyResponse(cached.data));
        if (response.status >= 200 && response.status < 300) return response.json().then(payload => {
          const etag = response.headers?.get("ETag");
          if (cacheable && etag && epoch === cacheEpoch && (tag || token) === (webSessionTag || storage.get("session") || "")) {
            roomCache.set(cacheKey, { etag, data: copyResponse(payload) });
            if (roomCache.size > 4) roomCache.delete(roomCache.keys().next().value);
          }
          return funCopy.response(payload);
        });
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            var err = new Error(payload.error || "请求失败");
            err.status = response.status;
            if (err.status === 429) {
              const value = response.headers.get("Retry-After"), seconds = value == null ? NaN : Number(value);
              const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
              err.retryAfterMs = Math.max(1000, Number.isFinite(wait) ? wait : 60000);
              retryAt = Date.now() + err.retryAfterMs;
            }
            if (err.status === 401 && tag) {
              webAccountExpired = true; webSessionTag = ''; storage.set('webAccount', 'expired');
              roomCache.clear(); cacheEpoch++;
            } else if (err.status === 401 && token === (storage.get("session") || "")) { storage.remove("session"); roomCache.clear(); cacheEpoch++; }
            throw err;
          });
      })
      .catch(function (e) {
        if (e && e.status) throw e;
        throw new Error(e?.name === "AbortError" ? "请求超时，结果尚未确认，正在重试原请求" : "网络未确认，请检查连接后重试原请求");
      }).finally(() => { if (timeout !== null) clearTimeout(timeout); });
  }
  var loginPromise;
  function login() {
    if (webSessionTag) return Promise.resolve();
    if (webAccountExpired) return Promise.reject(Object.assign(new Error('网页登录已过期，请重新扫码，或选择游客访问'), { status: 401 }));
    if (storage.get("session")) return Promise.resolve();
    if (loginPromise) return loginPromise;
    loginPromise = request("/api/guest-login", "POST", {}).then(function (data) {
      storage.set("session", data.token);
    }).finally(() => { loginPromise = null; });
    return loginPromise;
  }
  function requestId() {
    return (
      "v1_" + Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    );
  }

  // ===== runtime state (mirror of the mini-program instance + data) =====
  var generation = 0,
    actionGeneration = 0;
  var alive = true;
  var foreground = !document.hidden;
  var roomCode = null;
  var inviteCode = null;
  var pending = null;
  var timer = 0;
  var refreshSequence = 0;
  var rateLimitUntil = 0, reconnectAttempts = 0, recovering = false, unchangedPolls = 0, lastRoomSnapshot = "";
  var promptedActionStage = null;
  var actionDraftStage = null;
  var toolStage = null;
  var resultStage = null, resultConfirming = false;
  var settingsOriginal = null;
  var settingsKickPending = null;
  var settingsSavePending = null;

  var state = {
    webLogin: null, webLoginBusy: false, webLoginError: '', webLoginStatus: '',
    page: "lobby", profile: null, profileDraft: null, profileLoading: false, profileSaving: false, profileError: "", profileDirty: false, profileConflict: false, nameEdited: false, profileEditingNickname: false, profileNicknameError: "",
    loading: true,
    roomsRefreshing: false,
    busy: false,
    error: "",
    recoverableError: false,
    reconnecting: false,
    hasPendingRequest: false,
    notice: "",
    room: null,
    playerCard: null, playerCardStats: null, playerCardLoading: false, playerCardError: "", playerCardStatus: "",
    boards: [],
    availableBoards: [],
    entryMode: "join",
    showRules: false,
    showRoomRules: false,
    showBoardDetails: false,
    boardDetail: null,
    actionDialog: false,
    actionSecret: null,
    dealtIdentityDialog: false,
    dealtIdentitySecret: null,
    identityHintVisible: false,
    actionLoading: false,
    actionLabel: "",
    actionChoices: [],
    hunterModes: false,
    hunterMode: "",
    hunterChoices: [],
    actionTargets: [],
    draftChoice: "",
    draftLabel: "",
    stagedChoice: false,
      skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
    swapOptions: [],
    swapSeats: [],
    swapPlayers: [],
    toolType: "",
    toolTitle: "",
    toolDescription: "",
    toolSeats: [],
    toolPlayers: [],
    toolThreshold: 1,
    showRoomSettings: false,
    showTransfer: false,
    statsOpen: false, stats: null, statsTab: "records", funExpanded: false, funRulesExpanded: false, statsLoading: false, statsError: "",
    rankMineExpanded: false, rankRulesExpanded: false, rankMetricsExpanded: false, rankFunCategory: 'good', rankPendingMetric: '', rankMetric: 'points', rankFunMode: 'all', rankFunSort: 'count', rankFunRole: '', rankFunMetrics: [], rankPointsAvailable: true, rankPeriod: 'all', rankBoard: null, rankLoading: false, rankMoreLoading: false, rankError: '', rankMoreError: false, rankNotice: '', rankVisible: false, rankVisibilitySaving: false, rankVisibilityError: '',
    resultDialog: false, resultChoice: "", resultReason: "", resultTarget: null, resultActor: null, resultRequiresTarget: false,
    matches: [], matchesTotal: 0, matchesMore: false, matchesLoading: false, matchesError: "", matchScored: false, matchFun: null, scoringRules: null, scoringError: "",
    memberRooms: [],
    roomListFilter: "all",
    roomMenu: null,
    noteRoom: null,
    roomNoteDraft: "",
    undoRoom: null,
    boardId: "classic",
    boardName: "阿瓦隆 · 经典基础",
    boardRoleConfiguration: [],
    name: "",
    code: "",
    capacity: 6,
    capacities: [5, 6, 7, 8, 9, 10, 11, 12, 13],
    selected: [],
    revealed: false,
    secret: null,
    fairyResult: null,
    fairyResultRevealed: false,
    identityChange: null,
    identityChangeRevealed: false,
    network: true,
    serverConnected: false,
    needsLogin: false,
    seats: [],
    history: [],
    latestResult: null,
    seatsExpanded: true,
    seatOccupiedCount: 0,
    seatReadyCount: 0,
    operationProgressExpanded: false,
    historyExpanded: false,
    focusedHistoryKey: null,
    canStart: false,
    startHint: "",
    canSettle: false,
    settleHint: "",
    questSummary: { total: 0, success: 0, failure: 0 },
    teamText: "",
    settings: null,
  };

  function setState(patch) {
    var previousMenu = state.roomMenu || state.noteRoom;
    for (var k in patch) state[k] = patch[k];
    render();
    if (typeof app.querySelector === "function") {
      if (patch.roomMenu || patch.noteRoom) {
        var first = app.querySelector('.room-list-dialog input, .room-list-dialog button:not(:disabled)');
        if (first) first.focus();
      } else if (previousMenu && !state.roomMenu && !state.noteRoom) {
        var origin = app.querySelector('[data-action="openRoomMenu"][data-code="' + previousMenu.code + '"]');
        if (origin) origin.focus();
      }
    }
  }
  function setSettings(patch) {
    if (!state.settings) return;
    for (var k in patch) state.settings[k] = patch[k];
    render();
  }

  // Personal destinations use hash URLs so refresh, browser back and shared room links remain meaningful.
  var routeSequence = 0, currentRoute = '#/lobby', profileSequence = 0, profilePending = null;
  var statsSequence = 0, statsRequestRoute = -1;
  var seatAvatarFailures = new Set();
  function routeInfo(hash) {
    var table = /^#\/table\/(\d{6})$/.exec(hash || '');
    if (table) return { page: 'table', code: table[1] };
    const parts = (hash || '').split('?'), query = new URLSearchParams(parts[1] || '');
    if (parts[0] === '#/matches') return { page: 'matches', scored: query.get('scored') === '1', fun: query.get('fun') ? { metric: query.get('fun'), mode: query.get('mode') || 'classic', role: query.get('role') || '' } : null };
    if (parts[0] === '#/stats') return { page: 'stats', tab: query.get('tab') === 'fun' ? 'fun' : 'records' };
    var name = (hash || '').replace(/^#\//, '');
    return { page: ['lobby', 'me', 'profile', 'stats', 'leaderboard', 'help', 'login'].includes(name) ? name : 'lobby' };
  }
  async function mayNavigate() {
    if (pending || state.busy || state.profileSaving || state.webLoginBusy) {
      toast('请先完成或重试当前操作'); return false;
    }
    if (state.page === 'profile' && (state.profileDirty || profilePending))
      return confirm('离开编辑资料？', profilePending ? '保存结果尚未确认，建议先重试保存。仍要离开吗？' : '未保存的修改将丢弃。');
    return true;
  }
  async function navigate(page, code, replace = false) {
    if (!(await mayNavigate())) return;
    const hash = '#/' + page + (code ? '/' + code : '');
    window.history[replace ? 'replaceState' : 'pushState']({}, '', hash);
    await applyRoute(hash);
  }
  async function applyRoute(hash) {
    if (state.page === 'login' && routeInfo(hash).page !== 'login' && !await cancelWebLogin()) return;
    const sequence = ++routeSequence, route = routeInfo(hash);
    currentRoute = '#/' + route.page + (route.code ? '/' + route.code : '');
    clearTimeout(timer); refreshSequence++; mask();
    roomCode = null; profilePending = null;
    if(route.page==='matches'){scoreAdjustmentRecords=[];scoreAdjustmentTotal=0;scoreAdjustmentMore=false;scoreAdjustmentError='';}
    setState({ page: route.page, room: route.page === 'table' && state.room?.code === route.code ? state.room : null,
      ...(route.code ? { code: route.code } : {}), error: '', notice: '', showRoomSettings: false, showRoomRules: false,
      settings: null, roomMenu: null, noteRoom: null, toolType: '', resultDialog: false, showBoardDetails: false,
      profileDirty: false, profileDraft: route.page === 'profile' && state.profile ? profileDraft(state.profile) : null,
      rankMineExpanded: false, rankRulesExpanded: false, rankMetricsExpanded: false, profileLoading: route.page === 'profile', profileError: '', profileConflict: false, profileEditingNickname: false, profileNicknameError: '', statsOpen: route.page === 'stats', ...(route.page === 'stats' ? { statsTab: route.tab || 'records' } : {}), ...(route.page === 'matches' ? { matchScored: !!route.scored, matchFun: route.fun || null, matches: [], matchesTotal: 0, matchesMore: false } : {}) });
    window.scrollTo(0, 0);
    const heading = app.querySelector('[data-page-heading]');
    if (heading) heading.focus({ preventScroll: true });
    try {
      if (route.page === 'login') {
        if (webSessionTag) { await navigate('me', null, true); return; }
        if (webAuthEnabled && !state.webLogin) await startWebLogin();
        return;
      }
      await login();
      if (sequence !== routeSequence) return;
      if (route.page === 'table') {
        roomCode = route.code; state.code = route.code;
        storage.set('roomCode', route.code);
        await refresh(); schedule();
      } else if (route.page === 'lobby') {
        await Promise.all([loadRooms(), loadProfile()]);
        if (!state.nameEdited) setState({ name: (!needsNicknameSetup() ? state.profile?.nickname : '') || storage.get('nickname') || '' });
      } else if (route.page === 'me') await Promise.all([loadProfile(), loadStats()]);
      else if (route.page === 'profile') await loadProfile(true);
      else if (route.page === 'stats') await loadStats();
      else if (route.page === 'leaderboard') await loadLeaderboard();
      else if (route.page === 'matches') await loadMatches();
      else if (route.page === 'help') await loadScoreRules();
    } catch (e) { if (sequence === routeSequence) handleError(e); }
  }
  function profileDraft(profile) {
    return { nickname: profile.nickname, avatarPreview: profile.avatarUrl, version: profile.version, avatarStyle: profilePreset(profile.avatarUrl)?.style || 'classic' };
  }
  function needsNicknameSetup() {
    return !(state.profile?.nicknameConfirmed ?? !!(state.profile?.nickname && state.profile.nickname !== '新朋友'));
  }
  function entryNicknameData() {
    return needsNicknameSetup() ? { confirmNickname: true, profileVersion: state.profile?.version || 0 } : {};
  }
  async function loadProfile(edit = false) {
    const sequence = ++profileSequence, route = routeSequence;
    const initialAvatarStyle = state.profileDraft?.avatarStyle;
    setState({ profileLoading: true, profileError: '', profileConflict: false });
    try {
      const profile = await request('/api/me/profile');
      if (sequence !== profileSequence || route !== routeSequence) return;
      // Refreshing a preview must not replace edits or their original version.
      if (edit && (state.profileDirty || state.profileEditingNickname || profilePending)) return;
      const draft = profileDraft(profile);
      if (edit && initialAvatarStyle && state.profileDraft?.avatarStyle !== initialAvatarStyle)
        draft.avatarStyle = state.profileDraft.avatarStyle;
      setState({ profile, serverConnected: true, ...(edit && state.page === 'profile' ? {
        profileDraft: draft, profileDirty: false, profileEditingNickname: false, profileNicknameError: '',
      } : {}) });
    } catch (e) {
      if (sequence !== profileSequence || route !== routeSequence) return;
      setState({ profileError: e.message });
      if (e.status === 401) handleError(e);
    } finally { if (sequence === profileSequence && route === routeSequence) setState({ profileLoading: false }); }
  }
  function profileDirty() {
    setState({ profileDirty: !!state.profileDraft && (state.profileDraft.nickname.trim() !== (state.profile?.nickname || '') || state.profileDraft.avatar !== undefined) });
  }
  const builtinAvatars = window.shadowtableBuiltinAvatars || [];
  const avatarStyles = window.shadowtableAvatarStyles || [];
  function profilePreset(url) {
    return builtinAvatars.find(item => url === item.path || url?.endsWith('/api/avatars/' + item.hash));
  }
  function chooseProfileAvatarStyle(el) {
    if (!state.profileDraft || state.profileSaving || profilePending) return;
    const style = el.dataset.style;
    if (!avatarStyles.some(item => item.id === style)) return;
    state.profileDraft.avatarStyle = style;
    setState({});
  }
  function chooseBuiltinProfileAvatar(el) {
    if (!state.profileDraft || state.profileSaving || profilePending) return;
    const preset = builtinAvatars.find(item => item.id === el.dataset.id);
    if (!preset) return;
    if (profilePreset(state.profile?.avatarUrl)?.id === preset.id) delete state.profileDraft.avatar;
    else state.profileDraft.avatar = 'builtin:' + preset.id;
    state.profileDraft.avatarPreview = preset.path;
    state.profileDraft.avatarStyle = preset.style;
    state.profileError = '';
    profileDirty();
  }
  function editProfileNickname() {
    if (!state.profileDraft || state.profileSaving || profilePending) return;
    setState({ profileEditingNickname: true, profileNicknameError: '' });
    app.querySelector('#profile-nickname')?.focus();
  }
  function finishProfileNickname() {
    // Removing the focused input also fires focusout during DOM reconciliation.
    if (!state.profileEditingNickname || !state.profileDraft || state.profileSaving || profilePending) return;
    const nickname = state.profileDraft.nickname.trim();
    if (!nickname || nickname.length > 16)
      return setState({ profileNicknameError: '请输入1–16个字符的昵称' });
    state.profileDraft.nickname = nickname;
    state.profileEditingNickname = false;
    state.profileNicknameError = '';
    profileDirty();
  }
  async function saveProfile() {
    if (state.profileSaving || state.profileLoading || state.profileConflict || !state.profileDraft) return;
    if (!profilePending) {
      const nickname = state.profileDraft.nickname.trim();
      if (!nickname || nickname.length > 16) {
        editProfileNickname();
        setState({ profileNicknameError: '请输入1–16个字符的昵称' });
        app.querySelector('#profile-nickname')?.focus();
        return;
      }
      profilePending = { id: requestId(), data: { nickname, version: state.profileDraft.version,
        ...(state.profileDraft.avatar !== undefined ? { avatar: state.profileDraft.avatar } : {}) } };
    }
    setState({ profileSaving: true, profileError: '', profileEditingNickname: false, profileNicknameError: '' });
    try {
      await login();
      const profile = await request('/api/me/profile', 'POST', profilePending.data, profilePending.id);
      profilePending = null;
      setState({ profile, profileDirty: false, profileSaving: false, nameEdited: false });
      toast('资料已保存'); await navigate('me', null, true);
    } catch (e) {
      if (e.status && e.status < 500 && ![401,429].includes(e.status)) profilePending = null;
      setState({ profileError: e.message, profileConflict: e.status === 409 });
    } finally { setState({ profileSaving: false }); }
  }
  function navIcon(name) {
    const paths = name === 'table' ? '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h12v14h-2M9 10h6m-6 5h4"/>' : '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>';
    return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  function viewNavigation() {
    if (!['lobby','me'].includes(state.page)) return '';
    return '<nav class="bottom-navigation" aria-label="主导航">' + [['lobby','对局','table'],['me','我的','me']].map(function (item) {
      return '<button type="button" data-action="navigate" data-page="' + item[0] + '" class="nav-destination ' + (state.page === item[0] ? 'active' : '') + '"' + (state.page === item[0] ? ' aria-current="page"' : '') + '>' + navIcon(item[2]) + '<span>' + item[1] + '</span></button>';
    }).join('') + '</nav>';
  }
  function avatarView(url, nickname, large = false) {
    return url ? '<img class="profile-avatar' + (large ? ' large' : '') + '" src="' + esc(url) + '" alt="我的头像" />'
      : '<span class="profile-avatar avatar-fallback' + (large ? ' large' : '') + '" aria-hidden="true">' + esc((nickname || '友').slice(0,1)) + '</span>';
  }
  function personalTitle(title, eyebrow, back = true) {
    return (back ? btn('text-button page-back','navigate','‹ 返回我的',{page:'me'},state.profileSaving) : '') + '<div class="personal-heading">' + (eyebrow ? '<span class="eyebrow">' + eyebrow + '</span>' : '') + '<h1 class="page-title" tabindex="-1" data-page-heading>' + title + '</h1></div>';
  }
  function viewProfileError() {
    return state.profileError ? '<div class="inline-error" role="alert">' + esc(state.profileError) + (state.page === 'profile' || state.profileConflict || !state.profile ? btn('secondary','reloadProfile','重新载入资料',null,state.profileLoading) : '') + '</div>' : '';
  }
  function viewMe() {
    const profile = state.profile, stats = state.stats;
    let html = '<div class="me-overview-page">' + personalTitle('我的','',false) + viewProfileError();
    if (!profile) return html + (state.profileLoading ? '<div class="status" role="status">正在读取个人资料…</div>' : '') + '</div>';
    html += '<div class="profile-hero">' + avatarView(profile.avatarUrl,profile.nickname) + '<div class="profile-identity"><div class="profile-name">' + esc(profile.nickname || '新朋友') + '</div></div>' + btn('profile-edit','navigate','编辑',{page:'profile'}) + '</div>';
    if (profile.identityType === 'guest') html += '<div class="account-note small muted">当前为游客身份。清除缓存或登录过期后，无法自动找回资料与战绩。</div>';
    html += '<div class="web-account-row"><span class="small muted">' + (profile.identityType === 'wx' ? '小程序账号 · 资料与战绩共用' : '游客账号') + '</span>' + (webSessionTag ? btn('text-button', 'continueAsGuest', storage.get('guestSession') ? '退出并返回原游客' : '退出网页登录', null, state.webLoginBusy) : webAuthEnabled ? btn('text-button', 'navigate', '使用小程序账号登录', { page: 'login' }) : '') + '</div>';
    if (state.webLoginError) html += '<div class="inline-error" role="alert">' + esc(state.webLoginError) + '</div>';
    html += '<div class="me-overview"><section class="personal-section me-results" aria-label="我的战绩"><button type="button" class="me-overview-link me-results-link" data-action="navigate" data-page="stats" aria-label="查看详细战绩统计"><span class="section-title history-heading"><span>战绩概览</span><span class="me-results-detail" aria-hidden="true">详情<span class="me-chevron"></span></span></span>';
    html += '<span class="personal-metrics"><span class="me-metric"><span class="metric-value">' + (stats ? stats.total : '—') + '</span><span class="small muted">总局数</span></span><span class="me-metric"><span class="metric-value">' + (stats ? stats.wins : '—') + '</span><span class="small muted">胜场</span></span><span class="me-metric"><span class="metric-value accent">' + (!stats || stats.winRate === null ? '—' : stats.winRate + '%') + '</span><span class="small muted">胜率</span></span></span></button>';
    if (state.statsError) html += '<div class="inline-error" role="alert">' + esc(state.statsError) + btn('text-button','loadStats','重试') + '</div>';
    html += '</section>' + viewScoreOverview(stats?.score) + '</div>';
    const link = (page, title, note, icon) => '<button class="personal-link" type="button" data-action="navigate" data-page="'+page+'"><span class="me-icon me-icon-'+icon+'" aria-hidden="true"></span><span class="me-link-copy"><span>'+title+'</span>'+(note?'<span class="small muted link-note">'+esc(note)+'</span>':'')+'</span><span aria-hidden="true">›</span></button>';
    html += '<div class="personal-links me-links-primary">' + link('matches','对局记录','','history') + link('stats?tab=fun','趣味记录','','spark') + link('leaderboard','排行榜','','rank') + '</div><div class="personal-links me-links-secondary">' + link('help','帮助与规则','','book') + btn('personal-link','about','关于桌边助手 ›') + '</div></div>';
    return html;
  }
  function viewProfileEditor() {
    const draft = state.profileDraft, locked = state.profileSaving || !!profilePending;
    let html = viewProfileError();
    if (!draft) return html + (state.profileLoading ? '<div class="status">正在读取资料…</div>' : '');
    html += '<form class="profile-form" data-form="profile" aria-busy="' + state.profileLoading + '"><div class="avatar-editor"><div class="avatar-preview">' + avatarView(draft.avatarPreview,draft.nickname.trim(),true) + '</div><div class="nickname-editor">';
    if (state.profileEditingNickname) {
      html += '<div class="nickname-input-row"><input id="profile-nickname" name="nickname" class="input nickname-input' + (state.profileNicknameError ? ' is-invalid' : '') + '" maxlength="16" autocomplete="nickname" enterkeyhint="done" data-input="profileName" value="' + esc(draft.nickname) + '" placeholder="输入1–16个字符" aria-label="个人昵称，1至16个字符"' + (state.profileNicknameError ? ' aria-invalid="true" aria-describedby="profile-nickname-error"' : '') + (locked ? ' disabled' : '') + ' />' + btn('nickname-done','finishProfileNickname','完成',null,locked) + '</div>';
    } else {
      html += '<button type="button" class="nickname-display" data-action="editProfileNickname" aria-label="修改个人昵称，当前昵称：' + esc(draft.nickname || '新朋友') + '"' + (locked ? ' disabled' : '') + '><span class="nickname-text">' + esc(draft.nickname || '新朋友') + '</span><svg class="nickname-edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4.5-1L20 7.5a2.8 2.8 0 0 0-4-4L4.5 15Z"/></svg></button>';
    }
    if (state.profileNicknameError) html += '<div id="profile-nickname-error" class="nickname-error" role="alert">' + esc(state.profileNicknameError) + '</div>';
    html += '</div></div>';
    const selected = profilePreset(draft.avatarPreview)?.id;
    const style = draft.avatarStyle || 'classic';
    const visibleAvatars = builtinAvatars.filter(item => item.style === style);
    html += '<section class="avatar-library" aria-labelledby="avatar-library-title"><h2 id="avatar-library-title" class="field-title">选择头像</h2><div class="avatar-styles" role="group" aria-label="头像风格">' + avatarStyles.map(item => '<button type="button" class="avatar-style' + (style === item.id ? ' is-active' : '') + '" data-action="chooseProfileAvatarStyle" data-style="' + esc(item.id) + '" aria-label="' + esc(item.label + '，' + item.count + '款头像') + '" aria-pressed="' + (style === item.id) + '"' + (locked ? ' disabled' : '') + '>' + esc(item.shortLabel) + '</button>').join('') + '</div><div class="avatar-grid">' + visibleAvatars.map(item => {
      const chosen = selected === item.id;
      return '<button type="button" class="avatar-option' + (chosen ? ' is-selected' : '') + '" data-action="chooseBuiltinProfileAvatar" data-id="' + esc(item.id) + '" aria-label="' + esc(item.label + (chosen ? '，已选择' : '')) + '" aria-pressed="' + chosen + '"' + (locked ? ' disabled' : '') + '><img class="avatar-option-image" src="' + esc(item.path) + '" width="52" height="52" loading="lazy" alt="" />' + (chosen ? '<span class="avatar-option-selected" aria-hidden="true">✓</span>' : '') + '</button>';
    }).join('') + '</div></section>';
    html += '<div class="profile-save-bar"><div class="profile-save-content">' + (profilePending && !state.profileSaving ? '<div class="profile-save-hint small muted">保存结果尚未确认，请重试保存。</div>' : '') + btn('primary profile-save','saveProfile',state.profileSaving ? '正在保存…' : profilePending ? '重试保存' : state.profileLoading ? '正在同步…' : '保存资料',null,state.profileSaving || state.profileLoading || state.profileConflict) + '</div></div></form>';
    return html;
  }
  function viewProfileHeader() {
    return '<header class="profile-navigation"><div class="profile-navigation-content"><button type="button" class="profile-back" data-action="navigate" data-page="me" aria-label="返回我的"' + (state.profileSaving ? ' disabled' : '') + '>‹</button><h1 class="profile-title" tabindex="-1" data-page-heading>编辑资料</h1></div></header>';
  }
  const rankGroups = [['points','积分'],['games','局数'],['overall','胜率'],['fun','趣味']];
  const rankMetrics = [['points','积分'],['games','局数'],['overall','总胜率'],['good','好人胜率'],['evil','坏人胜率']];
  var rankSequence = 0, rankFailedSelection = null, rankVisibilityPending = null, rankVisibilityTarget = false;
  async function loadLeaderboard(more = false, selection = {}) {
    if (more && (state.rankLoading || state.rankMoreLoading || !state.rankBoard?.hasMore)) return;
    closePlayerCard(false);
    const sequence = ++rankSequence, route = routeSequence;
    let metric = selection.rankMetric || state.rankMetric;
    const period = selection.rankPeriod || state.rankPeriod, board = state.rankBoard;
    const funMode = selection.rankFunMode || state.rankFunMode, funSort = selection.rankFunSort || state.rankFunSort, funRole = selection.rankFunRole ?? state.rankFunRole;
    let append = more, pointsUnavailable = false, funUnavailable = false;
    rankFailedSelection = null;
    setState({ ...selection, rankRulesExpanded: false, rankMetricsExpanded: false, rankLoading: !more, rankMoreLoading: more, rankError: '', rankMoreError: more, rankNotice: '' });
    try {
      await login();
      let result;
      try { result = await request('/api/leaderboard?metric=' + metric + '&period=' + period + (metric.startsWith('fun_') ? '&mode=' + funMode + '&sort=' + funSort + (funRole ? '&role=' + funRole : '') : '') + (more ? '&offset=' + board.nextOffset + '&version=' + board.version : '')); }
      catch (e) {
        if (metric !== 'points' && !metric.startsWith('fun_') || e.status !== 400 || !/^排行榜参数无效/.test(e.message)) throw e;
        if (sequence !== rankSequence || route !== routeSequence) return;
        pointsUnavailable = metric === 'points'; funUnavailable = metric.startsWith('fun_');
        metric = 'games'; append = false;
        result = await request('/api/leaderboard?metric=games&period=' + period);
      }
      if (sequence !== rankSequence || route !== routeSequence) return;
      if (append) result.rows = board.rows.concat(result.rows);
      const rankPointsAvailable = Array.isArray(result.availableMetrics) ? result.availableMetrics.includes('points') : !pointsUnavailable && state.rankPointsAvailable;
      setState({ rankMetric: result.metric, rankFunMetrics: funUnavailable ? [] : rankPresentation.funOptions(result.availableFunMetrics, {includeFinal:true}), rankFunMode: result.mode || funMode, rankFunSort: result.sort || funSort, rankFunRole: result.role || '', rankPointsAvailable, rankPeriod: result.period, rankBoard: result, serverConnected: true, rankLoading: false, rankMoreLoading: false,
        rankNotice: funUnavailable ? '当前服务尚未开放趣味榜，已显示局数榜。' : rankPointsAvailable ? '' : pointsUnavailable ? '当前服务尚未开放积分榜，已显示局数榜。' : '当前服务尚未开放积分榜。',
        ...(!rankVisibilityPending ? { rankVisible: !['hidden','unsupported'].includes(result.me.status) } : {}) });
    } catch (e) {
      if (sequence !== rankSequence || route !== routeSequence) return;
      if (append && e.status === 409) {
        await loadLeaderboard();
        if (sequence + 1 === rankSequence && route === routeSequence && !state.rankError)
          setState({ rankNotice: '榜单已更新，已重新加载。' });
      } else {
        rankFailedSelection = { rankMetric: metric, rankPeriod: period, rankFunMode: funMode, rankFunSort: funSort, rankFunRole: funRole };
        setState({ rankError: e.message, rankLoading: false, rankMoreLoading: false, rankMoreError: append,
          ...(pointsUnavailable ? { rankPointsAvailable: false, rankNotice: '当前服务尚未开放积分榜。' } : {}),
          ...(!more && board ? { rankMetric: board.metric, rankPeriod: board.period, rankFunMode: board.mode || funMode, rankFunSort: board.sort || funSort, rankFunRole: board.role || '' } : {}) });
      }
    }
  }
  async function changeRankVisibility(visible) {
    if (state.rankVisibilitySaving || !state.rankBoard || state.rankBoard.me.status === 'unsupported') return;
    const route = routeSequence;
    rankVisibilityTarget = rankVisibilityPending ? rankVisibilityPending.data.leaderboardVisible : visible;
    rankVisibilityPending ||= { id: requestId(), data: { leaderboardVisible: rankVisibilityTarget } };
    setState({ rankVisible: rankVisibilityTarget, rankVisibilitySaving: true, rankVisibilityError: '' });
    try {
      await request('/api/me/leaderboard-visibility', 'POST', rankVisibilityPending.data, rankVisibilityPending.id);
      rankVisibilityPending = null;
      if (route === routeSequence) await loadLeaderboard();
    } catch (e) {
      if (e.status && e.status < 500 && ![401,429].includes(e.status)) rankVisibilityPending = null;
      if (route === routeSequence) setState({ rankVisible: !['hidden','unsupported'].includes(state.rankBoard.me.status), rankVisibilityError: e.message, rankMineExpanded: true });
    } finally { setState({ rankVisibilitySaving: false }); }
  }
  function toggleRankSheet(key, opener) {
    closePlayerCard(false);
    const open = !state[key];
    setState({rankMineExpanded:false,rankRulesExpanded:false,rankMetricsExpanded:false,[key]:open});
    app.querySelector(open ? '.rank-sheet button' : opener)?.focus({preventScroll:true});
  }
  function rankAvatar(row) {
    return row.avatarUrl && !row.avatarFailed ? '<img class="rank-avatar" src="' + esc(row.avatarUrl) + '" alt="" data-rank-avatar-id="' + esc(row.publicId) + '" />' : '<span class="rank-avatar rank-avatar-fallback" aria-hidden="true">' + esc(Array.from(row.nickname || '友')[0]) + '</span>';
  }
  function rankSheetStart(kind, title, action, label = title) {
    return '<div class="dialog-backdrop rank-sheet-backdrop" data-rank-dismiss="' + action + '"><section class="rank-sheet ' + kind + '" role="dialog" aria-modal="true" aria-label="' + label + '"><div class="rank-sheet-handle" aria-hidden="true"></div><div class="rank-sheet-header"><h2 class="rank-sheet-title">' + title + '</h2>' + btn('rank-sheet-close', action, '关闭') + '</div>';
  }
  function viewRankMetricSheet() {
    const options = rankPresentation.funOptions(state.rankFunMetrics, {includeFinal:true});
    const pending = options.find(item => item.key === state.rankPendingMetric);
    let html = rankSheetStart('rank-metrics-sheet', '选择趣味指标', 'rankToggleMetrics');
    html += '<div class="fun-categories" role="group" aria-label="角色分类">' + rankPresentation.categories.map(item => '<button type="button" data-action="funRankCategory" data-value="' + item.id + '" class="' + (item.id === state.rankFunCategory ? 'selected' : '') + '" aria-pressed="' + (item.id === state.rankFunCategory) + '">' + item.label + '</button>').join('') + '</div><div class="fun-metric-options">';
    html += options.filter(item => item.category === state.rankFunCategory).map(item => '<button type="button" class="fun-metric-option ' + (item.key === state.rankPendingMetric ? 'selected' : '') + '" data-action="funRankPreview" data-value="' + esc(item.key) + '" aria-label="' + esc(item.tabLabel) + '" aria-pressed="' + (item.key === state.rankPendingMetric) + '"><span class="fun-option-copy"><span><span class="fun-option-title">' + esc(item.title) + '</span><span class="fun-option-label">' + esc(item.label) + '</span></span></span><span class="fun-option-radio" aria-hidden="true">' + (item.key === state.rankPendingMetric ? '<span class="fun-option-check"></span>' : '') + '</span></button>').join('');
    if (!options.some(item => item.category === state.rankFunCategory)) html += '<p class="small muted">当前暂无此类指标</p>';
    html += '</div><div class="rank-sheet-footer">' + (pending ? '<div class="rank-sheet-note">已选：' + esc(pending.tabLabel) + '</div>' : '') + btn('rank-confirm','funRankConfirm','查看榜单',null,!pending || state.rankLoading) + '</div></section></div>';
    return html;
  }
  function viewLeaderboard() {
    const board = rankPresentation.presentBoard(state.rankBoard), metric = state.rankMetric;
    const locked = state.rankLoading || state.rankMoreLoading || state.rankVisibilitySaving;
    const overlay = state.rankMineExpanded || state.rankRulesExpanded || state.rankMetricsExpanded;
    let html = personalTitle('排行榜', '') + '<section class="leaderboard-page' + (board?.fun ? ' fun-leaderboard' : '') + '" aria-label="排行榜"><div class="rank-workspace"' + (overlay ? ' inert' : '') + '>';
    html += '<div class="rank-toolbar"><div class="rank-period" role="group" aria-label="统计周期">' + [['all','全部'],['month','本月']].map(item => '<button type="button" class="' + (state.rankPeriod === item[0] ? 'selected' : '') + '" data-action="rankPeriod" data-value="' + item[0] + '" aria-pressed="' + (state.rankPeriod === item[0]) + '">' + item[1] + '</button>').join('') + '</div><div class="rank-tools"><button type="button" class="rank-tool" data-action="rankToggleRules" aria-expanded="' + !!state.rankRulesExpanded + '" aria-label="榜单规则"' + (!board ? ' disabled' : '') + '>规则<span class="rank-info-icon" aria-hidden="true">i</span></button>' + btn('rank-tool','rankRefresh','刷新',null,locked) + '</div></div>';
    html += '<div class="rank-metrics" role="group" aria-label="排行指标">' + rankGroups.map(item => {
      const selected = metric === item[0] || item[0] === 'fun' && metric.startsWith('fun_') || item[0] === 'overall' && ['overall','good','evil'].includes(metric);
      return '<button type="button" class="rank-metric ' + item[0] + (selected ? ' selected' : '') + '" data-action="rankMetric" data-value="' + item[0] + '" aria-pressed="' + selected + '"' + (item[0] === 'points' && !state.rankPointsAvailable || item[0] === 'fun' && !state.rankFunMetrics.length ? ' disabled' : '') + '><span class="rank-metric-label">' + item[1] + '<span class="rank-metric-indicator" aria-hidden="true"></span></span></button>';
    }).join('') + '</div>';
    if (['overall','good','evil'].includes(metric)) html += '<div class="rank-rates" role="group" aria-label="胜率阵营">' + rankMetrics.filter(item => ['overall','good','evil'].includes(item[0])).map(item => '<button type="button" class="' + (metric === item[0] ? 'selected' : '') + '" data-action="rankMetric" data-value="' + item[0] + '" aria-pressed="' + (metric === item[0]) + '">' + item[1] + '</button>').join('') + '</div>';
    if (metric.startsWith('fun_')) html += viewFunRankFilters(board);
    if (state.rankLoading && !board) html += '<div class="rank-share-status small muted" role="status">正在读取榜单…</div>';
    if (state.rankNotice) html += '<div role="status" class="rank-notice small muted">' + esc(state.rankNotice) + '</div>';
    if (state.rankError) html += '<div class="inline-error" role="alert">' + esc(state.rankError) + btn('secondary','rankRetry','重试',null,locked) + '</div>';
    if (!board) return html + '</div></section>';
    const value = row => esc(row.value) + '<span class="rank-unit">' + esc(row.unit) + '</span>';
    html += '<div aria-live="polite" aria-atomic="true" class="sr-only">' + esc(board.valueHeading) + '，' + (board.eligibleCount ?? board.rows.length) + '人上榜</div><div class="rank-list-heading"><span>排名 / 玩家</span><span>' + esc(board.valueHeading) + '</span></div>';
    if (board.rows.length) {
      html += '<ol class="rank-list" aria-label="榜单玩家">' + board.rows.map(row => '<li id="rank-' + esc(row.publicId) + '"><button type="button" class="rank-row' + (row.isSelf ? ' is-self' : '') + '" data-action="rankPlayerCard" data-id="' + esc(row.publicId) + '" aria-label="' + esc((row.tied ? '并列' : '') + '第' + row.rank + '名，' + row.nickname + '，' + row.value + row.unit + '，查看玩家战绩') + '"' + (locked ? ' disabled' : '') + '><span class="rank-number rank-place-' + row.rank + '" aria-hidden="true">' + (row.rank === 1 ? '<svg class="rank-crown" viewBox="0 0 32 24"><path d="M4 18 2 5l8 5 6-9 6 9 8-5-2 13ZM5 21h22v3H5z" fill="currentColor"/></svg>' : '') + '<span>' + row.rank + '</span>' + (row.tied ? '<span class="rank-tie">并列</span>' : '') + '</span>' + rankAvatar(row) + '<span class="rank-identity"><span class="rank-name"><span class="rank-nickname">' + esc(row.nickname) + '</span>' + (row.isSelf ? '<span class="rank-self-label">我</span>' : '') + '</span><span class="rank-secondary">' + esc(row.secondaryLabel) + '</span></span><span class="rank-value' + (row.valueCompact ? ' is-compact' : '') + '">' + value(row) + '</span></button></li>').join('') + '</ol>';
    } else html += '<div class="rank-empty"><div class="rank-empty-title">' + esc(board.emptyTitle) + '</div><p class="small muted">' + esc(board.emptyHint) + '</p></div>';
    if (board.hasMore) html += btn('rank-more','rankMore',state.rankMoreLoading ? '正在加载…' : '加载更多',null,locked);
    else if (board.rows.length && !state.rankLoading) html += '<div class="rank-list-end' + (board.eligibleCount === 1 ? ' is-sparse' : '') + '">' + (board.eligibleCount === 1 ? '当前仅 1 位玩家满足上榜条件<div class="rank-end-hint">有新的有效记录后，榜单会同步更新</div>' : esc(board.endLabel)) + '</div>';
    const me = board.me;
    html += '<aside class="rank-mine" aria-label="我的排名"><button class="rank-mine-toggle" data-action="rankToggleMine" aria-expanded="' + !!state.rankMineExpanded + '" aria-label="我的排名，详情与公开设置"><span class="rank-mine-stats"><span class="rank-mine-brief"><span class="rank-mine-label">我的排名</span><span class="rank-mine-place">' + esc(me.placeLabel) + '</span></span><span class="rank-mine-brief"><span class="rank-mine-label">' + esc(board.valueHeading) + '</span><span class="rank-mine-value">' + value(me) + '</span></span></span><span class="rank-mine-entry">我的榜单<span class="rank-chevron" aria-hidden="true"></span></span></button></aside></div>';
    if (state.rankMetricsExpanded) html += viewRankMetricSheet();
    if (state.rankRulesExpanded) html += rankSheetStart('rank-rules-sheet','榜单规则','rankToggleRules') + '<div class="rank-rules-body"><div class="rank-rules-metric">' + esc(board.valueHeading) + ' · ' + (board.period === 'month' ? '本月' : '全部') + '</div>' + board.ruleLines.map(line => '<p class="rank-rule-line">' + esc(line) + '</p>').join('') + '</div></section></div>';
    if (state.rankMineExpanded) html += rankSheetStart('rank-details-dialog','我的榜单','rankToggleMine','我的排名与公开设置') + '<div class="rank-details-body"><div class="rank-mine-content"><div><div class="rank-mine-label">我的排名</div><div class="rank-mine-place">' + esc(me.placeLabel) + '</div></div><div class="rank-mine-metric"><div class="rank-mine-label">' + esc(board.valueHeading) + '</div><div class="rank-mine-value">' + value(me) + '</div></div></div>' + (!me.rank ? '<div class="rank-status-label">' + esc(me.statusLabel) + '</div>' : '') + (board.fun ? '<div class="small muted fun-mine-sample">' + esc(me.sampleLabel) + (me.unknownGames ? ' · ' + me.unknownGames + ' 局未记录' : '') + '</div>' : '') + (me.status !== 'unsupported' ? '<label class="rank-visibility"><span>' + (state.rankVisibilitySaving ? '正在保存…' : '在排行榜公开展示') + '</span><input type="checkbox" role="switch" aria-label="在排行榜公开展示" data-change="rankVisibility"' + (state.rankVisible ? ' checked' : '') + (state.rankVisibilitySaving ? ' disabled' : '') + ' /></label><div class="small muted">此开关仅控制是否出现在排行榜，玩家战绩均可查看。</div>' : '') + (state.rankVisibilityError ? '<div class="rank-visibility-error" role="alert">' + esc(state.rankVisibilityError) + btn('text-button','rankVisibilityRetry','重试',null,state.rankVisibilitySaving) + '</div>' : '') + '</div></section></div>';
    return html + '</section>';
  }
  function viewHelp() {
    return personalTitle('帮助与规则','') + '<div class="personal-section"><h2 class="page-subtitle">从一张牌桌开始</h2><p>在「对局」创建房间，或输入朋友分享的6位房间码。全员入座并准备后，由房主开始发牌。</p><h2 class="page-subtitle">秘密只给自己看</h2><p>主动查看身份与视野；离开牌桌或切到后台后会遮盖。返回对局列表不会退出座位。</p><h2 class="page-subtitle">跟随现场节奏</h2><p>房主按需发起投票、任务和技能。操作收齐后自动结算，板子具体玩法可在创建页或牌桌的配置说明中查看。</p><h2 class="page-subtitle">记下每一局</h2><p>结束时由房主登记胜方。终止局和未登记胜负的局不计入胜率；陪测完成并登记胜负的对局正常计入；战绩按最终阵营归属。重开或解散牌桌不会删除已归档的战绩。</p><h2 class="page-subtitle">趣味记录与荣誉榜</h2><p>从「我的」进入趣味记录，点次数可回查对应对局。关闭积分也会记录；结束时请房主登记实际原因和刺杀目标，场上没有刺客时还需登记实际带刀人。好人挡刀会记录次数及成功率，比例按终局面对最终非空刀的有效机会计算。缺失过程保留未知。趣味排行跨板子汇总，可切换三炸车、被刺、歪刀、刀客刀中友方和骑士决斗友方等指标；次数与比例均可排名，反向指标的比例显示发生率；比例榜有有效机会即可参与，沿用公开展示开关。</p></div>' + viewScoreRules();
  }

  // ===== modal / toast =====
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 1600);
  }
  function confirm(title, content, showCancel, confirmLabel) {
    if (!modal.hidden) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      modalTitle.textContent = title;
      modalMessage.textContent = content;
      modalOk.textContent = confirmLabel || "确定";
      modalCancel.hidden = showCancel === false;
      modal.hidden = false;
      (showCancel === false ? modalOk : modalCancel).focus();
      function onKey(event) {
        if (event.key === "Escape" && showCancel !== false) {
          event.preventDefault();
          done(false);
        } else if (event.key === "Tab") {
          event.preventDefault();
          (showCancel === false || document.activeElement === modalCancel ? modalOk : modalCancel).focus();
        }
      }
      modal.addEventListener("keydown", onKey);
      function done(val) {
        modal.hidden = true;
        modal.removeEventListener("keydown", onKey);
        if (opener && opener.isConnected) opener.focus();
        modalOk.onclick = null;
        modalCancel.onclick = null;
        resolve(val);
      }
      modalOk.onclick = function () {
        done(true);
      };
      modalCancel.onclick = function () {
        done(false);
      };
    });
  }

  // ===== lifecycle helpers =====
  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {}
  }
  function mask() {
    closePlayerCard(false);
    generation++;
    actionGeneration++;
    setState({
      dealtIdentityDialog: false,
      dealtIdentitySecret: null,
      identityHintVisible: false,
      fairyResult: null,
      fairyResultRevealed: false,
      identityChange: null,
      identityChangeRevealed: false,
      actionDialog: false,
      actionSecret: null,
      actionLoading: false,
      actionLabel: "",
      actionChoices: [],
      hunterModes: false,
      hunterMode: "",
      hunterChoices: [],
      actionTargets: [],
      draftChoice: "",
      draftLabel: "",
      stagedChoice: false,
      skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
      swapOptions: [],
      swapSeats: [],
      swapPlayers: [],
      revealed: false,
      secret: null,
    });
  }
  function handleError(e) {
    mask();
    if (e.status === 401 && webAccountExpired) {
      pending = null; storage.remove('pendingEntry');
      setState({ profile: null, stats: null, matches: [], memberRooms: [], error: '', hasPendingRequest: false, needsLogin: true, reconnecting: false });
      window.history.replaceState({}, '', '#/login');
      applyRoute('#/login'); return;
    }
    if (e.status === 403 && e.message === "你已被房主移出房间") {
      pending = null;
      clearRoom();
      setState({ notice: e.message, hasPendingRequest: false });
      loadRooms().catch(handleError);
      return;
    }
    if ((!e.status || e.status >= 500 || e.status === 429) && e.retryable !== false) {
      reconnectAttempts++;
      if (e.status === 429) rateLimitUntil = Date.now() + (e.retryAfterMs || 60000);
      setState({ reconnecting: true, error: "", recoverableError: false, serverConnected: false, hasPendingRequest: !!pending,
        notice: e.status === 429 && !pending ? "请求较多，冷却后会自动刷新" : "" });
      schedule(); return;
    }
    setState({ reconnecting: false });
    setState({
      error: e.message,
      serverConnected: !!e.status && e.status < 500 && e.status !== 401,
      needsLogin: e.status === 401,
      recoverableError:
        !e.status || e.status === 401 || e.status === 429 || e.status >= 500,
      hasPendingRequest: !!pending,
    });
  }
  function connectionRecovered() {
    reconnectAttempts = 0;
    if (state.reconnecting || !state.serverConnected || !state.network || state.needsLogin)
      setState({ reconnecting: false, serverConnected: true, network: true, needsLogin: false });
  }
  async function recoverConnection() {
    if (!alive || !foreground || recovering || state.busy || state.loading || state.needsLogin || !state.network) return;
    if (Date.now() < rateLimitUntil) { schedule(); return; }
    recovering = true;
    try { await retry(); } finally { recovering = false; schedule(); }
  }
  function schedule() {
    clearTimeout(timer);
    if (!foreground || !alive || (!roomCode && !state.reconnecting)) return;
    const idle = ["lobby", "ended", "terminated"].includes(state.room?.phase);
    const delay = state.reconnecting
      ? Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(0, reconnectAttempts - 1))) * (.8 + Math.random() * .2)
      : idle ? Math.min(10000, 2500 * (1 + Math.floor(unchangedPolls / 4))) : 2500;
    timer = setTimeout(async function () {
      try {
        if (state.reconnecting) await recoverConnection();
        else if (roomCode && !state.busy && !pending && !state.error && !recovering && state.network) await refresh();
      } catch (e) { handleError(e); }
      finally { schedule(); }
    }, Math.max(delay, rateLimitUntil - Date.now()));
  }
  function clearRoom() {
    clearTimeout(timer);
    seatAvatarFailures.clear();
    refreshSequence++;
    mask();
    roomCode = null;
    storage.remove("roomCode");
    state.page = 'lobby'; currentRoute = '#/lobby';
    window.history.replaceState({}, '', currentRoute);
    setState({
      room: null,
      resultDialog: false, statsOpen: false, stats: null,
      toolType: "",
      toolTitle: "",
      toolDescription: "",
      toolSeats: [],
      toolPlayers: [],
      seats: [],
      seatOccupiedCount: 0,
      seatReadyCount: 0,
      history: [],
      latestResult: null,
      selected: [],
      code: "",
      error: "",
      entryMode: "join",
      showRoomRules: false,
      showBoardDetails: false,
      boardDetail: null,
      showRoomSettings: false,
      showTransfer: false,
      settings: null,
    });
  }

  // ===== data bootstrap =====
  function selectCapacity(capacity) {
    var availableBoards = state.boards.filter(function (b) {
      return b.available && b.counts.indexOf(capacity) !== -1;
    });
    var b =
      availableBoards.filter(function (x) {
        return x.id === state.boardId;
      })[0] || availableBoards[0];
    if (!b) return;
    setState({
      capacity: capacity,
      availableBoards: availableBoards,
      boardId: b.id,
      boardName: (b.namesByCapacity || {})[capacity] || b.name,
      boardRoleConfiguration: (b.roleConfigurations || {})[capacity] || [],
      showRules: false,
    });
  }
  function pickBoard(boardId) {
    if (state.busy) return;
    var b = state.availableBoards.filter(function (x) {
      return x.id === boardId;
    })[0];
    if (!b) return;
    setState({
      boardId: b.id,
      boardName: (b.namesByCapacity || {})[state.capacity] || b.name,
      boardRoleConfiguration:
        (b.roleConfigurations || {})[state.capacity] || [],
      showRules: false,
    });
  }
function roomListItems(rooms) {
  return rooms.map(r => {
    const time = r.updatedAt ? new Date(r.updatedAt) : null;
    return { ...r,
      statusLabel: ({ lobby: "待开局", playing: "进行中", ended: "已结束", unavailable: "已失效" })[r.status] || r.phaseName || "待开局",
      peopleLabel: r.status === "lobby" ? `${r.occupied || 0}/${r.capacity}人已入座` : `${r.capacity}人`,
      relationLabel: r.available === false ? r.phaseName : `${r.isHost ? "我是房主" : r.relation === "旁观者" ? "旁观者" : "玩家"}${r.seat != null ? " · 我在" + r.seat + "号" : ""}`,
      activityLabel: time ? `${time.getMonth()+1}/${time.getDate()} ${String(time.getHours()).padStart(2,"0")}:${String(time.getMinutes()).padStart(2,"0")}` : "暂无活动时间",
    };
  });
}
  async function loadRooms() {
    var data = await request("/api/me/rooms");
    if (alive) { connectionRecovered(); setState({ memberRooms: roomListItems(data.rooms), serverConnected: true }); }
  }
  function nicknameValue() {
    var el = document.getElementById("nickname");
    return el ? el.value.trim() : (state.name || "").trim();
  }
  function codeValue() {
    var el = document.getElementById("code");
    return el ? el.value.trim() : (state.code || "").trim();
  }

  async function bootstrap() {
    setState({ loading: true, error: "" });
    try {
      await initializeWebAccount();
      if (!webAccountExpired) await login();
      var boards = (await request("/api/boards")).boards;
      var capacities = [
        ...new Set(
          boards
            .filter(function (b) {
              return b.available;
            })
            .flatMap(function (b) {
              return b.counts;
            }),
        ),
      ].sort(function (a, b) {
        return a - b;
      });
      setState({ boards: boards, capacities: capacities, needsLogin: false });
      selectCapacity(state.capacity);
      var entry = !webAccountExpired && safeParse(storage.get("pendingEntry"));
      if (entry) {
        pending = entry;
        await executePending();
        return;
      }
      var hash = webAccountExpired ? '#/login' : location.hash || (inviteCode ? '#/table/' + inviteCode : '#/lobby');
      window.history.replaceState({}, '', hash);
      await applyRoute(hash);
    } catch (e) {
      handleError(e);
    } finally {
      setState({ loading: false });
      schedule();
    }
  }

  // ===== polling / refresh =====
  async function refresh() {
    if (!roomCode) return;
    var code = roomCode;
    refreshSequence++;
    var sequence = refreshSequence;
    var room;
    try {
      room = await request("/api/rooms/" + code);
    } catch (e) {
      if (!alive || code !== roomCode || sequence !== refreshSequence) return;
      if (e.status === 404 || e.status === 403) {
        clearRoom();
        setState({
          notice: e.status === 404 ? "牌桌已删除或不存在" : e.message === "你已被房主移出房间" ? e.message : "你已离开这张牌桌",
        });
        if (e.status === 403 && e.message !== '你已被房主移出房间') setState({ code: code, entryMode: 'join', notice: '输入本桌昵称，加入房间 ' + code });
        await loadRooms();
        return;
      }
      throw e;
    }
    if (!alive || code !== roomCode || sequence !== refreshSequence) return;
    connectionRecovered();
    const snapshot = JSON.stringify(room);
    unchangedPolls = snapshot === lastRoomSnapshot ? unchangedPolls + 1 : 0;
    lastRoomSnapshot = snapshot;
    var stageChanged = state.room && state.room.stage !== room.stage;
    var privacyChanged = stageChanged || (state.room && state.room.me.identityRevision !== room.me.identityRevision);
    if (state.playerCard) {
      const target = room.players.find(p => p.statsId === state.playerCard.id);
      if (privacyChanged || room.code !== state.room?.code || !target || target.seat !== state.playerCard.seat || target.name !== state.playerCard.name || target.avatarUrl !== state.playerCard.sourceAvatarUrl) closePlayerCard(false);
    }
    if (stageChanged)
      buzz(room.needsSubmission && !room.me.submitted ? [50, 40, 50] : [25]);
    var selected = stageChanged ? [] : state.selected;
    var patch = {
      notice:
        state.notice === "请求较多，冷却后会自动刷新" ? "" : state.notice,
      room: room,
      error: "",
      network: true,
      serverConnected: true,
      needsLogin: false,
      selected: selected,
    };
    if (stageChanged) patch.resultDialog = false;
    if (privacyChanged) {
      generation++;
      actionGeneration++;
      patch.fairyResult = null;
      patch.fairyResultRevealed = false;
      patch.identityChange = null;
      patch.identityChangeRevealed = false;
      patch.dealtIdentityDialog = false;
      patch.dealtIdentitySecret = null;
      patch.identityHintVisible = false;
      patch.revealed = false;
      patch.secret = null;
      patch.actionDialog = false;
      patch.actionSecret = null;
      patch.actionLoading = false;
      patch.actionLabel = "";
      patch.actionChoices = [];
      patch.hunterModes = false;
      patch.hunterMode = "";
      patch.hunterChoices = [];
      patch.actionTargets = [];
      patch.draftChoice = "";
      patch.draftLabel = "";
      patch.stagedChoice = false;
      patch.skillAction = false;
      patch.skillTitle = "";
      patch.skillHint = "";
      patch.skillTargets = [];
      patch.skillBodyHeight = 0;
      patch.skillOtherChoices = [];
      patch.swapOptions = [];
      patch.swapSeats = [];
      patch.swapPlayers = [];
    }
    if (state.room?.code !== room.code) seatAvatarFailures.clear();
    var currentAvatarUrls = new Set((room.players || []).map(p => p.avatarUrl).filter(Boolean));
    for (const url of seatAvatarFailures) if (!currentAvatarUrls.has(url)) seatAvatarFailures.delete(url);
    var seats = Array.from({ length: room.capacity }, function (_, i) {
      var seat = i + 1;
      var p =
        (room.players || []).filter(function (pl) {
          return pl.seat === seat;
        })[0] || null;
      return {
        seat: seat,
        name: p ? p.name : "空位",
        avatarUrl: p?.avatarUrl || "",
        avatarInitial: p ? Array.from(p.name || "友")[0] : "+",
        avatarFailed: seatAvatarFailures.has(p?.avatarUrl || ""),
        occupied: !!p,
        alive: p ? p.alive !== false : true,
        ready: p ? !!p.ready : false,
        mine: seat === room.me.seat,
        host: p ? !!p.isHost : false,
        inTeam: room.team.indexOf(seat) !== -1,
        selected: selected.indexOf(seat) !== -1,
      };
    });
    patch.seats = seats;
    patch.seatOccupiedCount = seats.filter(s => s.occupied).length;
    patch.seatReadyCount = seats.filter(s => s.occupied && s.ready).length;
    var history = room.history.map(function (h, i) {
      return (
        toolHistory(h, i) || {
          key: i,
          questResult:
            h.kind === "quest" ? (h.success ? "success" : "failure") : "",
          text:
            h.kind === "team"
              ? "第" +
                h.round +
                "轮 · " +
                h.leader +
                "号组队 " +
                h.team.join("、") +
                "：" +
                (h.approved ? "通过" : "否决")
              : h.kind === "quest"
                ? "任务结算"
                : "最终行动",
          detail:
            h.kind === "team"
              ? voteSummary(h.votes)
              : h.kind === "quest"
                ? "第" +
                  h.round +
                  "轮 · " +
                  (h.success ? "任务成功" : "任务失败") +
                  " · " +
                  h.fails +
                  "张失败"
                : "最终目标 " +
                  h.target +
                  "号 · " +
                  (h.hit ? "命中梅林" : "未命中梅林"),
        }
      );
    });
    history.forEach(function (entry, i) {
      var source = room.history[i];
      var time = source.startedAt ? new Date(source.startedAt) : null;
      entry.timeLabel = time && !Number.isNaN(time.getTime()) ? String(time.getHours()).padStart(2, "0") + ":" + String(time.getMinutes()).padStart(2, "0") : "";
      entry.resultTone = entry.questResult || (["toolVote", "team"].includes(source.kind) ? (source.approved ? "success" : "failure") : "");
      if (source.kind === "skillResult" && Array.isArray(source.eliminated) && Array.isArray(source.redrawn) && Array.isArray(source.restored) && Array.isArray(source.out)) {
        entry.historyText = "技能结算";
        entry.historyNote = source.text.includes("提前截止") ? "提前截止" : "";
        entry.resultRows = [["最终仍出局", source.out], ["本轮出局", source.eliminated], ["抽牌复活", source.redrawn], ["原牌复活", source.restored]]
          .filter(function (row, index) { return (index !== 0 && index !== 3) || row[1].length > 0; })
          .map(function (row) { return { label: row[0], value: row[1].length ? row[1].join("、") + " 号" : "无", final: row[0] === "最终仍出局" }; });
        entry.detail = entry.resultRows.map(function (row) { return row.label + "：" + row.value; }).join("；");
      }
      entry.latestDetail = entry.voteGroups ? voteSummary(source.votes) : entry.detail;
      entry.resultTeam = entry.voteGroups ? entry.teamLabel : "";
    });
    patch.seatsExpanded = room.phase !== "lobby" && state.room?.code === room.code ? state.seatsExpanded : true;
    patch.operationProgressExpanded = !!room.operationProgress && state.room?.code === room.code && state.room?.stage === room.stage && state.operationProgressExpanded;
    patch.historyExpanded = state.room?.code === room.code && state.room?.game === room.game && room.phase !== "lobby" ? state.historyExpanded : false;
    patch.focusedHistoryKey = state.room?.code === room.code && state.room?.game === room.game && room.phase !== "lobby" ? state.focusedHistoryKey : null;
    history = history.filter(entry => !(room.history[entry.key].kind === "variant" && /^进入第\d+轮$/.test(entry.text)));
    patch.history = history;
    patch.latestResult = history.filter(function (entry) {
      var h = room.history[entry.key];
      return ["toolVote", "toolQuest", "skillResult", "toolReverse", "toolKnife", "toolOffline", "toolCanceled", "team", "quest", "assassination"].indexOf(h.kind) !== -1 || (h.kind === "variant" && (h.number || h.resultType === "conversion" || /^本轮(?:阵营转换|不转换)$/.test(h.text)));
    }).pop() || null;
    patch.canStart =
      room.players.length === room.capacity &&
      room.players.every(function (p) {
        return p.ready;
      });
    patch.startHint =
      room.players.length < room.capacity
        ? "还差 " +
          (room.capacity - room.players.length) +
          " 人入座 · " +
          room.players.filter(function (p) {
            return !p.ready;
          }).length +
          " 人未准备"
        : room.players.some(function (p) {
              return !p.ready;
            })
          ? "还差 " +
            room.players.filter(function (p) {
              return !p.ready;
            }).length +
            " 人准备"
          : "全员已准备，可以发放身份";
    patch.canSettle =
      !!room.operationProgress &&
      room.operationProgress.total > 0 &&
      room.operationProgress.completed === room.operationProgress.total;
    patch.settleHint = room.operationProgress
      ? room.operationProgress.completed < room.operationProgress.total
        ? "还差 " +
          (room.operationProgress.total - room.operationProgress.completed) +
          " 人提交"
        : room.flexible ? "提交已收齐，正在同步结果" : "参与者已全部提交，可以结算"
      : "正在确认操作进度";
    patch.questSummary = {
      total: history.filter(function (h) {
        return h.questResult;
      }).length,
      success: history.filter(function (h) {
        return h.questResult === "success";
      }).length,
      failure: history.filter(function (h) {
        return h.questResult === "failure";
      }).length,
    };
    patch.teamText = room.team.join("、") || "尚未选择";
    if (!room.me.isHost || stageChanged) patch.toolType = "";
    if (state.settings && state.settings.authorized && state.settings.room?.code === room.code)
      state.settings.room = room;
    if (state.settings && !room.me.isHost) {
      state.settings.authorized = false;
      state.settings.error = "房主已变更，你不再拥有管理权限。";
    }
    setState(patch);
    if (
      (!room.needsSubmission || room.me.submitted) &&
      (state.actionDialog || state.actionLoading)
    )
      closeAction();
    if (
      room.me.identityChanged &&
      !state.showRoomSettings &&
      foreground &&
      !state.identityChange
    )
      await showIdentityChange();
    if (
      room.me.fairyResultPending &&
      !room.me.identityChanged &&
      foreground &&
      !state.fairyResult
    )
      await showFairyResult();
    if (showDealtIdentity()) return;
    if (
      !room.me.identityChanged &&
      !room.me.fairyResultPending &&
      room.needsSubmission &&
      !room.me.submitted &&
      foreground &&
      promptedActionStage !== room.stage &&
      !state.actionLoading &&
      !state.toolType &&
      !state.showRoomRules &&
      !state.showRoomSettings &&
      !state.showBoardDetails
    )
      await openAction();
  }

  // ===== write path (idempotent) =====
  async function mutate(path, data, after) {
    if (state.busy) return;
    if (pending) {
      setState({ error: "上次请求尚未确认，请先重试原请求" });
      return;
    }
    refreshSequence++;
    pending = { path: path, data: data, id: requestId(), after: after };
    if (after === "enter") storage.set("pendingEntry", JSON.stringify(pending));
    await executePending();
  }
  async function executePending() {
    var p = pending;
    if (!p || state.busy) return;
    setState({ busy: true, error: "", notice: "" });
    try {
      await login();
      var result = await request(p.path, "POST", p.data, p.id);
      pending = null;
      connectionRecovered();
      setState({
        serverConnected: true,
        hasPendingRequest: false,
        recoverableError: false,
      });
      if (p.after === "enter") storage.remove("pendingEntry");
      mask();
      if (p.after === "enter" || p.after === "entryVisit") {
        if (result.profile) { profileSequence++; state.profile = result.profile; state.profileLoading = false; }
        roomCode = result.code;
        storage.set("roomCode", result.code);
        storage.set("nickname", p.data.name || state.name);
        state.nameEdited = false;
        state.page = 'table'; currentRoute = '#/table/' + result.code;
        window.history.pushState({}, '', currentRoute);
      }
      if (["entryHide", "entryRestore", "entryNote"].includes(p.after)) {
        setState({ roomMenu: null, noteRoom: null });
        if (p.after === "entryHide") {
          var undo = { code: result.code, until: Date.now() + 8000 };
          setState({ undoRoom: undo, notice: "已从列表移除" });
          clearTimeout(undoRoomTimer);
          undoRoomTimer = setTimeout(function () { if (alive && state.undoRoom && state.undoRoom.until === undo.until) setState({ undoRoom: null }); }, 8000);
        } else setState({ undoRoom: null, notice: p.after === "entryNote" ? "个人备注已保存" : "已恢复牌桌记录" });
        await loadRooms();
      } else if (p.after === "leave" || p.after === "delete") {
        clearRoom();
        setState({
          notice: p.after === "delete" ? "房间已解散" : "已离开房间",
        });
        await loadRooms();
      } else {
        setState({ notice: "" });
        await refresh();
      }
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 401 && e.status !== 429) {
        pending = null;
        if (p.after === "enter") storage.remove("pendingEntry");
      }
      setState({ notice: "" });
      handleError(e);
      if (e.status === 409 && p.after === 'enter') await loadProfile();
    } finally {
      setState({ busy: false });
      schedule();
    }
  }
  function cmd(type, extra, after) {
    var r = state.room;
    if (!r) return;
    var body = { type: type, stage: r.stage };
    if (extra) for (var k in extra) body[k] = extra[k];
    mutate("/api/rooms/" + r.code + "/commands", body, after);
  }
  async function confirmCommand(title, content, type, extra) {
    var stage = state.room && state.room.stage;
    if (!(await confirm(title, content))) return;
    if (!foreground || !state.room || state.room.stage !== stage) {
      setState({ error: "阶段已变化，请查看当前阶段后重新操作" });
      return;
    }
    cmd(type, extra || {});
  }
  function resultFlow(data) {
    const room = data.room || {}, reasons = room.scoreSettlement?.length ? room.scoreSettlement : room.funSettlement || [];
    const reason = reasons.find(item => item.id === data.resultReason);
    const option = (room.winnerOptions || []).find(item => item.value === data.resultChoice);
    const players = (room.players || []).filter(player => player.alive !== false);
    const actor = players.find(player => player.seat === data.resultActor);
    const target = players.find(player => player.seat === data.resultTarget);
    const needsActor = !!(reason?.requiresTarget && (room.settlementRequiresActor ?? (room.knights && room.funSettlement)));
    const steps = [{ id: "reason", label: "结束原因" }];
    if (needsActor) steps.push({ id: "actor", label: "实际带刀人" });
    if (reason?.requiresTarget) steps.push({ id: "target", label: "实际刺杀目标" });
    steps.push({ id: "review", label: "核对结果" });
    const step = steps.findIndex(item => item.id === data.resultStep);
    const index = Math.max(0, step), current = steps[index];
    const selected = !!reason || !!option || data.resultChoice === "none";
    const actorValid = !needsActor || !!actor;
    const targetValid = !reason?.requiresTarget || data.resultTarget === 0 || !!target && (!needsActor || target.seat !== actor?.seat);
    const ready = selected && actorValid && targetValid;
    const summary = [{ label: reason ? "结束原因" : "登记方式", value: reason?.label || (option ? "仅登记胜方 · " + option.label : "不计战绩") }];
    if (needsActor) summary.push({ label: "实际带刀人", value: actor ? actor.seat + "号 · " + actor.name : "尚未选择" });
    if (reason?.requiresTarget) summary.push({ label: "实际刺杀目标", value: data.resultTarget === 0 ? "空刀" : target ? target.seat + "号 · " + target.name : "尚未选择" });
    const notice = data.resultChoice === "none" ? "本局不计战绩及积分。" : reason ? room.scoreSettlement?.length ? "按本局规则结算积分，并保存胜负与趣味记录。" : "保存胜负与趣味记录，本局不计积分。" : "仅保存胜负，不计积分；缺失的趣味结果保留未知。";
    return { resultSteps: steps, resultStep: current.id, resultStepIndex: index, resultStepTitle: current.label,
      resultNextEnabled: current.id === "reason" ? selected : current.id === "actor" ? actorValid : current.id === "target" ? targetValid : ready,
      resultNeedsActor: needsActor, resultReady: ready, resultSummary: summary, resultNotice: notice, resultPlayers: players };
  }

  function updateResult(patch) {
    const previousStep = state.resultStep;
    setState({ ...patch, ...resultFlow({ ...state, ...patch }) });
    if (state.resultStep !== previousStep) app.querySelector('.score-step-label')?.focus();
  }
  function closeResult() {
    setState({ resultDialog: false });
    var opener = app.querySelector('[data-action="finishTools"]');
    if (opener) opener.focus();
  }
  async function saveResult() {
    var room = state.room, choice = state.resultChoice;
    const scoring = !!room?.scoreSettlement?.length;
    const reason = (scoring ? room.scoreSettlement : room?.funSettlement)?.find(item => item.id === state.resultReason);
    if (!state.resultDialog || state.resultStep !== "review" || !resultFlow(state).resultReady || (!choice && !reason) || state.busy || pending || resultConfirming) return;
    if (reason?.requiresTarget && !Number.isInteger(state.resultTarget)) return;
    if (reason?.requiresTarget && (room.settlementRequiresActor ?? (room.knights && room.funSettlement)) && !Number.isInteger(state.resultActor)) return;
    if (!room || room.stage !== resultStage) {
      setState({ resultDialog: false, error: "阶段已变化，请重新登记胜负" }); return;
    }
    var option = (room.winnerOptions || []).find(o => o.value === choice);
    if (!reason && choice !== "none" && !option) return;
    const target = state.resultTarget;
    const details = reason ? { [scoring ? "scoreReason" : "funReason"]: reason.id, ...(reason.requiresTarget ? { [scoring ? "scoreTarget" : "funTarget"]: target, ...((room.settlementRequiresActor ?? (room.knights && room.funSettlement)) ? {funActor:state.resultActor} : {}) } : {}) } : { winner: choice === "none" ? null : choice };
    const flow = resultFlow(state), stage = room.stage;
    resultConfirming = true;
    try {
      const confirmed = await confirm("确认结束本局？", flow.resultSummary.map(row => row.label + "：" + row.value).join("\n") + "\n" + flow.resultNotice + "\n胜负确认后将归档，不能直接修改。" + (room.hasActiveOperation ? "当前未结算的操作将作废。" : ""));
      if (!confirmed) return;
      if (!foreground || state.room?.stage !== stage || state.busy || pending) { setState({ resultDialog: false, error: "阶段已变化，请重新登记胜负" }); return; }
      closeResult();
      return cmd("finishTools", { replace: true, ...details });
    } finally { resultConfirming = false; }
  }

  async function loadStats() {
    if (state.statsLoading && statsRequestRoute === routeSequence) return;
    const sequence = ++statsSequence, route = statsRequestRoute = routeSequence;
    setState({ statsLoading: true, statsError: "" });
    try {
      const stats = await request("/api/me/stats");
      if (sequence === statsSequence && route === routeSequence) setState({ stats, serverConnected: true });
    }
    catch (e) {
      if (sequence !== statsSequence || route !== routeSequence) return;
      setState({ statsError: e.message });
      if (e.status === 401) handleError(e);
    } finally { if (sequence === statsSequence && route === routeSequence) setState({ statsLoading: false }); }
  }
  function viewResultDialog() {
    const room = state.room;
    if (!state.resultDialog || !room?.canUseTools || state.error) return "";
    const flow = resultFlow(state), step = flow.resultStep;
    const reasons = room.scoreSettlement?.length ? room.scoreSettlement : room.funSettlement || [];
    let html = '<div class="dialog-backdrop"><div class="error-dialog result-dialog score-dialog" role="dialog" aria-modal="true" aria-labelledby="result-dialog-title"><div class="score-header"><div class="dialog-title" id="result-dialog-title">登记本局结果</div><div class="score-step-label" tabindex="-1" role="status">' + (flow.resultStepIndex + 1) + ' / ' + flow.resultSteps.length + ' · ' + flow.resultStepTitle + '</div></div><div class="score-body">';
    if (step === 'reason') {
      html += '<p class="small muted">按实际发生的情况登记，请先与同桌玩家确认。</p><div class="score-reasons">' + reasons.map(reason => '<button type="button" class="secondary ' + (state.resultReason === reason.id ? 'is-selected' : '') + '" data-action="pickScoreReason" data-id="' + esc(reason.id) + '" aria-pressed="' + (state.resultReason === reason.id) + '">' + esc(reason.label) + (state.resultReason === reason.id ? ' ✓' : '') + '</button>').join('') + '</div>';
      if (reasons.length) html += '<button class="disclosure-button score-other-toggle" data-action="toggleResultOther" aria-expanded="' + !!state.resultOther + '">其他登记方式 <span>' + (state.resultOther ? '收起' : '展开') + '</span></button>';
      if (state.resultOther || !reasons.length) html += '<div class="result-options"><p class="small muted">信息不完整时可仅登记胜方；不确定胜负时选“不计战绩”。以下选项不计积分。</p>' + (room.winnerOptions || []).concat([{value:'none',label:'不计战绩'}]).map(option => '<button class="secondary '+(state.resultChoice===option.value?'is-selected':'')+'" data-action="pickResult" data-value="'+esc(option.value)+'" aria-pressed="'+(state.resultChoice===option.value)+'">'+(option.value==='none'?'':'仅登记胜方 · ')+esc(option.label)+'</button>').join('')+'</div>';
    } else if (step === 'actor' || step === 'target') {
      html += '<p class="small muted">' + (step === 'actor' ? '选择线下实际执行最终刺杀的玩家。' : '选择线下实际刺杀的目标；未指定目标请选择空刀。') + '</p><div class="score-targets">' + flow.resultPlayers.map(player => '<button class="secondary ' + ((step === 'actor' ? state.resultActor : state.resultTarget) === player.seat ? 'is-selected' : '') + '" data-action="' + (step === 'actor' ? 'pickFunActor' : 'pickScoreTarget') + '"' + (step === 'target' && (room.settlementRequiresActor ?? room.knights) && state.resultActor === player.seat ? ' disabled' : '') + ' data-seat="' + player.seat + '" aria-pressed="' + ((step === 'actor' ? state.resultActor : state.resultTarget) === player.seat) + '"><span>' + player.seat + '号</span><span class="score-player-name">' + esc(player.name) + '</span></button>').join('') + (step === 'target' ? '<button class="secondary '+(state.resultTarget===0?'is-selected':'')+'" data-action="pickScoreTarget" data-seat="0" aria-pressed="'+(state.resultTarget===0)+'">空刀</button>' : '') + '</div>';
    } else {
      html += '<div class="result-review">' + flow.resultSummary.map(row => '<div class="result-review-row"><span class="small muted">'+esc(row.label)+'</span><span>'+esc(row.value)+'</span></div>').join('') + '</div><p class="result-review-note">'+esc(flow.resultNotice)+'</p>' + (room.hasActiveOperation ? '<p class="result-warning">当前未结算的操作将作废。</p>' : '');
    }
    return html + '</div><div class="dialog-actions">' + btn('secondary','backResult',step==='reason'?'取消':'上一步',null,state.busy || !!pending) + (step==='review' ? btn('primary','saveResult','确认并结束',null,!flow.resultReady || state.busy || !!pending) : btn('primary','nextResult','下一步',null,!flow.resultNextEnabled || state.busy || !!pending)) + '</div></div></div>';
  }

  function viewScoreOverview(score) {
    return '<section class="personal-section score-overview" aria-label="我的积分"><button type="button" class="me-overview-link me-points-link" data-action="scoreRecords" aria-label="查看积分明细"><span class="section-title history-heading"><span>积分</span><span class="me-results-detail" aria-hidden="true">明细<span class="me-chevron"></span></span></span><span class="personal-metrics"><span class="me-metric"><span class="metric-value accent">' + (score?.total ?? '—') + '</span><span class="small muted">总积分</span></span><span class="me-metric"><span class="metric-value">' + (score?.month ?? '—') + '</span><span class="small muted">本月积分</span></span></span></button><button type="button" class="me-rules-trigger" data-action="navigate" data-page="help" aria-label="查看积分规则"><svg class="me-rules-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".08"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .3c0 1.6-2.5 2-2.5 3.7M12 16h.01"/></svg></button></section>';
  }
  function viewScoreBreakdown(score) {
    if (!score || score.status !== 'scored') return '<div class="small muted">' + esc(score?.reason || '积分功能启用前的记录') + '</div>';
    return '<details class="score-breakdown"><summary class="accent">本局 ' + (score.total >= 0 ? '+' : '') + score.total + ' 分 · 查看明细</summary>' + score.breakdown.map(award => '<div class="score-award"><span>' + esc(award.label) + '</span><span>' + (award.points >= 0 ? '+' : '') + award.points + '分</span></div>').join('') + (score.manualOverride ? '<p class="small muted">管理员调整原因：'+esc(score.manualOverride.reason)+'</p>' : '') + '</details>';
  }
  var matchSequence = 0;
  var scoreAdjustmentRecords=[],scoreAdjustmentTotal=0,scoreAdjustmentMore=false,scoreAdjustmentLoading=false,scoreAdjustmentError='';
  async function loadMatches(more = false) {
    if (more && (state.matchesLoading || !state.matchesMore)) return;
    const sequence = ++matchSequence, route = routeSequence;
    setState({ matchesLoading: true, matchesError: '' });
    try {
      const result = await request('/api/me/matches?offset=' + (more ? state.matches.length : 0) + (state.matchScored ? '&scored=1' : '') + (state.matchFun ? '&fun=' + encodeURIComponent(state.matchFun.metric) + '&mode=' + encodeURIComponent(state.matchFun.mode) + (state.matchFun.role ? '&role=' + encodeURIComponent(state.matchFun.role) : '') : ''));
      if (sequence === matchSequence && route === routeSequence) {
        if(!more){scoreAdjustmentRecords=result.adjustments?.records || [];scoreAdjustmentTotal=result.adjustments?.total || 0;scoreAdjustmentMore=!!result.adjustments?.hasMore;scoreAdjustmentError='';}
        setState({ matches: more ? state.matches.concat(result.records) : result.records, matchesTotal: result.total, matchesMore: result.hasMore });
      }
    } catch (e) { if (sequence === matchSequence && route === routeSequence) setState({ matchesError: e.message }); }
    finally { if (sequence === matchSequence && route === routeSequence) setState({ matchesLoading: false }); }
  }
  function viewFunStory(record) {
    if (!record) return '';
    let html = '<section class="match-fun"><div class="field-title">我的趣味记录</div>';
    if (record.initialRole) html += '<div class="small muted">初始身份：' + esc(record.initialRole) + '</div>';
    if (record.reason) html += '<div class="small muted">' + esc(record.reason) + '</div>';
    for (const event of record.events) html += '<div class="fun-event"><div>' + (event.round ? '第 ' + event.round + ' 轮 · ' : '') + esc(event.role) + ' · ' + esc(event.label) + '</div><div class="small muted">' + esc(event.detail) + '</div></div>';
    if (!record.events.length && !record.reason) html += '<div class="small muted">本局没有适用的趣味事件。</div>';
    return html + '</section>';
  }
  function viewFunStats(data) {
    if (!data) return '<p class="muted">趣味记录将在服务更新后开放。</p>';
    let html = data.legacyGames ? '<p class="small muted">' + data.legacyGames + ' 局旧对局未记录完整过程，缺失数据不按零次计算。</p>' : '';
    if (!data.cards.length) return html + '<p class="fun-empty muted">暂无趣味记录</p>';
    for (const card of (state.funExpanded ? data.cards : data.cards.slice(0,3))) {
      const rows = card.metrics.filter(row => !row.id.endsWith('aim_enemy')), primary = rows.find(row => row.positive ?? row.ranked) || rows[0];
      const combat = [':knife',':gun',':duel'].some(suffix => card.id.endsWith(suffix));
      html += '<article class="fun-card"><div class="fun-heading"><h2>' + esc(card.title) + '</h2></div><div class="fun-metrics' + (combat ? ' three' : '') + '">';
      for (const row of rows) {
        const color = (row.positive ?? row.ranked) ? 'good' : /_(ally|hit|bust|miss)$/.test(row.id) ? 'evil' : 'muted';
        html += '<button type="button" class="fun-metric" data-action="funRecords" data-metric="'+esc(row.id)+'" data-mode="'+esc(row.mode)+'"><span class="fun-number '+color+'">'+(row.value===null ? '—' : row.count)+'<span class="small muted"> '+esc(row.unit)+'</span></span><span class="small">'+esc(row.label)+' ›</span></button>';
      }
      html += '</div>';
      if (combat && primary.opportunities) {
        let position = 0;
        html += '<svg class="fun-bar" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">' + rows.map(row => {
          const width = row.count / row.opportunities * 100, start = position; position += width;
          return '<rect class="fun-bar-' + ((row.positive ?? row.ranked) ? 'good' : row.id.endsWith('ally') ? 'evil' : 'muted') + '" x="'+start+'" y="0" width="'+width+'" height="1" />';
        }).join('') + '</svg>';
      }
      html += '<p class="fun-caption small muted">' + (combat ? esc(primary.label) + '率' : '成功率') + ' ' + (primary.rate===null ? '暂无机会' : primary.rate.toFixed(1)+'%') + ' · ' + primary.opportunities + (combat ? ' 次出手' : ' 次机会') + '<br>' + primary.knownGames + ' 局有记录' + (primary.unknownGames ? ' · '+primary.unknownGames+' 局未记录' : '') + '</p>';
      if (state.funRulesExpanded && card.id.endsWith(':shield')) html += '<p class="small muted">挡刀率按终局面对最终非空刀的有效机会计算。</p>';
      const aim = card.metrics.find(row=>row.id.endsWith('aim_enemy'));
      if (state.funRulesExpanded && aim?.rate!==null && aim) html += '<p class="small muted">选敌率 '+aim.rate.toFixed(1)+'%；选中敌方但被挡下仍计未生效。</p>';
      if (combat && primary.byRole.length) {
        html += '<details class="fun-roles"><summary>按出刀角色查看</summary>';
        for (const role of primary.byRole) html += '<div class="fun-role"><div>'+esc(role.label)+' · '+role.opportunities+' 次出手</div><div class="fun-role-metrics">' + rows.map(row=>btn('text-button','funRecords',row.label+' '+(row.byRole.find(r=>r.role===role.role)?.value === null ? '—' : row.byRole.find(r=>r.role===role.role)?.count || 0)+' ›',{metric:row.id,mode:row.mode,role:role.role})).join('')+'</div></div>';
        html += '</details>';
      }
      html += '</article>';
    }
    if (data.cards.length > 3) html += '<button class="secondary fun-more" data-action="toggleFunCards" aria-expanded="'+!!state.funExpanded+'">'+(state.funExpanded?'收起更多记录':'查看其余 '+(data.cards.length-3)+' 项趣味记录')+'</button>';
    html += '<button class="disclosure-button fun-role-toggle" data-action="toggleFunRules" aria-expanded="'+!!state.funRulesExpanded+'">统计说明 '+(state.funRulesExpanded?'⌃':'⌄')+'</button>';
    if (state.funRulesExpanded) html += '<p class="small muted fun-note">派西维尔按初始身份记三绿车／三炸车；梅林只统计最终刺杀机会。刀、枪、决斗与最终刀分别记录，空刀单列；未使用和作废不计失败。</p>';
    return html;
  }
  function viewFunRankFilters(board) {
    const option = rankPresentation.funOptions(state.rankFunMetrics, {includeFinal:true}).find(item => item.key === state.rankMetric);
    const rateLabel = option?.rateLabel || board?.rateLabel || '成功率';
    let html = '<div class="fun-rank-filters"><button type="button" class="fun-metric-toggle" data-action="rankToggleMetrics" aria-expanded="' + !!state.rankMetricsExpanded + '" aria-label="选择趣味指标"><span class="fun-metric-current"><span class="fun-metric-role">' + esc(option?.title || '') + '</span><span class="fun-metric-name">' + esc(option?.label || '选择指标') + '</span></span><span class="fun-filter-chevron" aria-hidden="true"></span></button><div class="fun-sort-row"><div class="fun-sort" role="group" aria-label="排序方式">' + ['count','rate'].map(sort => '<button type="button" class="' + (sort === state.rankFunSort ? 'selected' : '') + '" data-action="funRankSort" data-value="' + sort + '" aria-pressed="' + (sort === state.rankFunSort) + '">按' + (sort === 'count' ? '次数' : esc(rateLabel)) + '</button>').join('') + '</div><span class="fun-sort-direction">由高到低</span></div>';
    if (board?.roleOptions?.length) html += '<label class="fun-role-filter"><span class="fun-filter-label">出刀角色</span><select class="fun-picker" data-change="funRankRole" aria-label="出刀角色">' + [{ id: '', label: '全部角色' }, ...board.roleOptions].map(item => '<option value="' + esc(item.id) + '"' + (item.id === state.rankFunRole ? ' selected' : '') + '>' + esc(item.label) + '</option>').join('') + '</select></label>';
    return html + '</div>';
  }
  function viewMatches() {
    let html = personalTitle('对局记录','') + '<div class="matches-filters" role="group" aria-label="对局筛选">' + [['0','全部对局'],['1','计分局']].map(item => '<button type="button" data-action="filterMatches" data-scored="' + item[0] + '" aria-pressed="' + (state.matchScored === (item[0] === '1')) + '">' + item[1] + '</button>').join('') + '</div>';
    if (state.matchFun) html += '<div class="fun-filter"><span>相关趣味记录</span>' + btn('text-button','navigate','查看全部 ›',{page:'matches'}) + '</div>';
    if (state.matchesError) html += '<div class="inline-error" role="alert">' + esc(state.matchesError) + btn('secondary','loadMatches','重试') + '</div>';
    if (!state.matches.length) html += '<div class="muted" role="status">' + (state.matchesLoading ? '正在读取对局…' : '暂无对局记录') + '</div>';
    else html += '<div class="small muted">共 ' + state.matchesTotal + ' 场对局</div>';
    state.matches.forEach(record => {
      html += '<details class="stats-match"><summary><div class="stats-row"><span>' + esc(record.boardName) + ' · ' + record.capacity + '人</span><span class="stats-outcome ' + esc(record.outcome) + '">' + ({win:'胜利',loss:'失利',excluded:'不计入战绩'})[record.outcome] + '</span></div><div class="small muted">' + esc(new Date(record.endedAt).toLocaleString('zh-CN',{hour12:false})) + ' · 我的身份：' + esc(record.role) + '</div><div class="' + (record.score?.status === 'scored' ? 'accent' : 'muted') + '">' + (record.score?.status === 'scored' ? (record.score.total >= 0 ? '+' : '') + record.score.total + ' 分' : record.score?.status === 'excluded' ? '不计积分' : '积分未启用') + '</div>' + (record.fun?.highlights?.length ? '<div class="match-fun-label">' + record.fun.highlights.slice(0,2).map(item=>esc(item.label)+(item.count>1 ? ' ×'+item.count : '')).join(' · ') + '</div>' : '') + '</summary>' + viewScoreBreakdown(record.score) + viewFunStory(record.fun) + '<div class="small muted">同桌成员：' + record.members.map(member => esc(member.seat + '号 ' + member.name)).join('、') + '</div></details>';
    });
    if (state.matchesMore) html += btn('secondary','moreMatches',state.matchesLoading ? '正在加载…' : '加载更多',null,state.matchesLoading);
    if(scoreAdjustmentRecords.length && !state.matchFun) {
      html+='<section class="personal-section"><h2 class="page-subtitle">管理员积分调整 · '+scoreAdjustmentTotal+' 条</h2>';
      for(const record of scoreAdjustmentRecords) html+='<div class="stats-match"><div class="stats-row"><span class="small muted">'+esc(new Date(record.created).toLocaleString('zh-CN',{hour12:false}))+'</span><span class="accent">'+(record.delta>=0?'+':'')+record.delta+' 分</span></div><p>'+esc(record.reason)+'</p><div class="small muted">总积分 '+record.beforePoints+' → '+record.afterPoints+'</div></div>';
      if(scoreAdjustmentError)html+='<p role="alert">'+esc(scoreAdjustmentError)+'</p>';
      if(scoreAdjustmentMore)html+=btn('secondary','moreScoreAdjustments',scoreAdjustmentError?'重试加载调整记录':'加载更多调整记录',null,scoreAdjustmentLoading);
      html+='</section>';
    }
    return html;
  }
  async function moreScoreAdjustments() {
    if(scoreAdjustmentLoading)return;
    const route=routeSequence,sequence=matchSequence;scoreAdjustmentLoading=true;scoreAdjustmentError='';render();
    try {
      const result=await request('/api/me/score-adjustments?offset='+scoreAdjustmentRecords.length);
      if(route!==routeSequence || sequence!==matchSequence)return;
      scoreAdjustmentRecords=scoreAdjustmentRecords.concat(result.records);scoreAdjustmentTotal=result.total;scoreAdjustmentMore=result.hasMore;
    }catch(error){if(route===routeSequence && sequence===matchSequence)scoreAdjustmentError=error.message;}
    finally{scoreAdjustmentLoading=false;render();}
  }
  async function loadScoreRules() {
    const route = routeSequence;
    setState({ scoringError: '' });
    try { const rules = await request('/api/scoring/rules'); if (route === routeSequence) setState({ scoringRules: rules }); }
    catch (e) { if (route === routeSequence) setState({ scoringError: '积分规则暂未加载，请重试。' }); }
  }
  function viewScoreRules() {
    const rules = state.scoringRules;
    return '<section class="personal-section"><h2 class="page-subtitle">积分规则</h2>' + (state.scoringError ? '<div role="alert">' + esc(state.scoringError) + btn('secondary','loadScoreRules','重试') : '') + (!rules ? '<div class="muted">正在读取积分规则…</div>' : '<p class="muted">' + esc(rules.scopeLabel) + '</p>' + rules.items.map(item => '<p><strong>' + esc(item.label) + '</strong><br><span class="muted">' + esc(item.text) + '</span></p>').join('') + rules.notes.map(note => '<p class="small muted">' + esc(note) + '</p>').join('')) + '</section>';
  }
  function viewStats() {
    var html = '<section class="stats-content" aria-label="我的战绩" aria-busy="' + state.statsLoading + '">';
    var stats = state.stats, rate = row => row.winRate === null ? '—' : row.winRate + '%';
    if (state.statsError) html += '<div role="alert">' + esc(state.statsError) + '</div>' + btn('secondary','loadStats','重试',null,state.statsLoading);
    if (state.statsLoading && !stats) html += '<div class="muted" role="status">正在读取战绩…</div>';
    if (stats) {
      if (state.statsTab !== 'fun') html += '<div class="stats-summary"><div><div class="stats-rate">' + rate(stats) + '</div><span class="small muted">总胜率</span></div><div><div>' + stats.wins + ' 胜 · ' + stats.losses + ' 负</div><span class="small muted">' + stats.total + ' 局有效对局</span></div></div>';
      html += '<div class="stats-tabs" role="group" aria-label="战绩分类">' + [['records','胜负积分'],['fun','趣味记录']].map(item=>'<button type="button" data-action="statsTab" data-value="'+item[0]+'" aria-pressed="'+(state.statsTab===item[0])+'">'+item[1]+'</button>').join('') + '</div>';
      if (state.statsTab === 'fun') return html + viewFunStats(stats.fun) + '</section>';
      if (stats.score) html += '<div class="score-stats muted">积分 ' + stats.score.total + ' · ' + stats.score.games + '场计分局 · 场均 ' + (stats.score.average == null ? '—' : stats.score.average.toFixed(2)) + '<br>当前 ' + stats.score.current + ' 连胜 · 最高 ' + stats.score.best + ' 连胜</div>';
      if (stats.excluded) html += '<div class="small muted">' + stats.excluded + ' 局不计入战绩</div>';
      if (stats.identityType === 'guest') html += '<div class="stats-note small">当前为游客战绩，仅随本浏览器登录凭证保留；清缓存或登录过期后无法自动找回。</div>';
      if (!stats.total) html += '<div class="stats-note">还没有有效战绩</div>';
      [['阵营战绩',(stats.byFaction || []).map(row=>({...row,roles:(stats.byRole || []).filter(role=>role.faction===row.faction)}))],['板子战绩',stats.byBoard]].forEach(function (group) {
        if (!group[1]?.length) return;
        html += '<section class="stats-breakdown"><h2 class="page-subtitle">'+group[0]+'</h2>';
        group[1].forEach(function (row) {
          const summary = '<span class="faction-heading"><span>'+esc(row.label)+'</span><span class="small muted">'+row.total+'局 · '+row.wins+'胜 · 胜率 '+rate(row)+(row.score?' · '+row.score.total+'分':'')+'</span></span>';
          if (row.roles?.length) html += '<details class="faction-group"><summary>'+summary+'</summary><div class="role-list"><div class="role-row role-list-heading"><span>角色</span><span>局数</span><span>胜场</span><span>胜率</span></div>'+row.roles.map(role=>'<div class="role-row"><span>'+esc(role.role)+'</span><span>'+role.total+'</span><span>'+role.wins+'</span><span>'+rate(role)+'</span></div>').join('')+'</div></details>';
          else html += '<div class="stats-row">'+summary+'</div>';
        });
        html += '</section>';
      });
      html += btn('stats-record-link','navigate','对局记录 ›',{page:'matches'});
      html += btn('text-button','loadStats',state.statsLoading ? '刷新中…' : '刷新战绩',null,state.statsLoading);
    }
    return html + '</section>';
  }
  async function retry() {
    setState({ error: "", recoverableError: false });
    if (pending) return executePending();
    if (state.needsLogin || !state.boards.length) return bootstrap();
    try {
      setState({ loading: true });
      if (roomCode) await refresh();
      else await loadRooms();
    } catch (e) {
      handleError(e);
    } finally {
      setState({ loading: false });
    }
  }

  // ===== entry actions =====
  function switchEntry(mode) {
    if (state.busy || pending) return;
    setState({ entryMode: mode, error: "", notice: "" });
  }
  function create() {
    var name = nicknameValue();
    if (!name) return setState({ error: "请填写昵称" });
    state.name = name;
    mutate(
      "/api/rooms",
      { name: name, board: state.boardId, capacity: state.capacity, ...entryNicknameData() },
      "enter",
    );
  }
  function join() {
    var name = nicknameValue();
    var code = codeValue();
    if (!name || !/^\d{6}$/.test(code))
      return setState({ error: "请填写昵称和6位房间码" });
    state.name = name;
    state.code = code;
    mutate("/api/rooms/" + code + "/join", { name: name, ...entryNicknameData() }, "enter");
  }
  async function openRoom(code) {
    if (state.busy || pending) return;
    var target = state.memberRooms.filter(function (r) {
      return r.code === code;
    })[0];
    if (target && target.isHost && target.seat === null && !target.isMember) {
      if (!(state.name || "").trim()) {
        setState({ code: target.code, entryMode: "join", error: "请填写昵称后重新入座" });
        return;
      }
      return mutate(
        "/api/rooms/" + target.code + "/join",
        { name: state.name },
        "enter",
      );
    }
    if (target && target.available === false) return;
    return mutate("/api/me/rooms/" + code, { action: "visit" }, "entryVisit");
  }
  var undoRoomTimer;
  async function refreshRooms() {
    if (state.busy || pending || state.loading || state.roomsRefreshing) return;
    setState({ roomsRefreshing: true });
    try { await loadRooms(); } catch (e) { handleError(e); }
    finally { setState({ roomsRefreshing: false }); }
  }
  async function roomMenuAction(kind) {
    var room = state.roomMenu;
    if (!room || state.busy || pending) return;
    setState({ roomMenu: null });
    if (kind === "note") return setState({ noteRoom: room, roomNoteDraft: room.note || "" });
    if (kind === "hide") return mutate("/api/me/rooms/" + room.code, { action: "hide" }, "entryHide");
    if (kind === "delete" && room.isHost && room.available !== false) return deleteRoom(room.code);
    if (kind === "leave" && room.canLeave) {
      if (!(await confirm("离开房间 " + room.code + "？", "你将退出成员关系并释放座位。房间不会解散；房主离开后仍保留管理权。"))) return;
      if (state.busy || pending) return;
      setState({ busy: true });
      try {
        var fresh = await request("/api/rooms/" + room.code);
        setState({ busy: false });
        await mutate("/api/rooms/" + room.code + "/commands", { type: "leave", stage: fresh.stage }, "leave");
      } catch (e) { handleError(e); }
      finally { setState({ busy: false }); }
    }
  }
  async function deleteRoom(code) {
    if (state.busy || pending) return;
    setState({ busy: true, error: "" });
    try {
      var room = await request("/api/rooms/" + code + "/management");
      if (!room.isHost) throw new Error("只有当前房主可以删除牌桌");
      if (
        !(await confirm(
          "解散房间 " + code + "？",
          "所有玩家将退出，牌桌与对局记录将被删除且无法恢复。进行中的对局不判胜负。",
        ))
      )
        return;
      if (!alive || !foreground) return;
      setState({ busy: false });
      await mutate(
        "/api/rooms/" + code + "/delete",
        { stage: room.stage },
        "delete",
      );
    } catch (e) {
      if (e.status === 404) {
        await loadRooms();
        setState({ notice: "牌桌已删除或不存在" });
      } else handleError(e);
    } finally {
      setState({ busy: false });
    }
  }
  async function returnHome() {
    if (pending || state.busy) {
      setState({ error: "仍有未确认请求，请先重试原请求" });
      return;
    }
    clearRoom();
    setState({ notice: "" });
    try {
      await loadRooms();
    } catch (e) {
      handleError(e);
    }
  }

  // ===== room actions =====
  function seatAvatarError(el) {
    var url = el.dataset.seatAvatarUrl, seatNum = Number(el.dataset.seat);
    if (!alive || !url || !state.seats.some(s => s.seat === seatNum && s.avatarUrl === url)) return;
    seatAvatarFailures.add(url);
    setState({ seats: state.seats.map(s => s.avatarUrl === url ? { ...s, avatarFailed: true } : s) });
  }
  let playerCardSequence = 0;
  function closePlayerCard(restoreFocus = true) {
    const card = state.playerCard, seatNum = card?.seat;
    playerCardSequence++;
    setState({ playerCard: null, playerCardStats: null, playerCardLoading: false, playerCardError: "", playerCardStatus: "" });
    if (restoreFocus && card?.scope === 'leaderboard') app.querySelector('[data-action="rankPlayerCard"][data-id="' + card.id + '"]')?.focus({ preventScroll: true });
    if (restoreFocus && seatNum != null) app.querySelector('[data-action="seat"][data-seat="' + seatNum + '"]')?.focus({ preventScroll: true });
  }
  async function openPlayerCard(seatNum) {
    const room = state.room, player = room?.players.find(p => p.seat === seatNum);
    if (!player || !foreground || state.actionDialog || state.dealtIdentityDialog || state.identityChange || state.fairyResult) return;
    const card = { id: player.statsId, seat: seatNum, name: player.name, isHost: player.isHost, sourceAvatarUrl: player.avatarUrl,
      avatarUrl: player.avatarUrl || "", initial: Array.from(player.name || "友")[0], avatarFailed: false };
    return loadPlayerCard(card, '/api/rooms/' + room.code + '/players/' + player.statsId + '/stats',
      () => state.room?.code === room.code && state.room?.stage === room.stage);
  }
  function openRankPlayerCard(id) {
    const row = state.rankBoard?.rows.find(row => row.publicId === id), route = routeSequence, rank = rankSequence;
    if (!row || state.page !== 'leaderboard' || !foreground || state.rankLoading || state.rankMoreLoading || state.rankVisibilitySaving) return;
    setState({ rankMineExpanded: false, rankRulesExpanded: false, rankMetricsExpanded: false });
    return loadPlayerCard({ scope: 'leaderboard', id, name: row.nickname, avatarUrl: row.avatarUrl || '',
      initial: Array.from(row.nickname || '友')[0], avatarFailed: !!row.avatarFailed }, '/api/leaderboard/players/' + encodeURIComponent(id) + '/stats',
      () => state.page === 'leaderboard' && route === routeSequence && rank === rankSequence);
  }
  async function loadPlayerCard(card, path, current) {
    const sequence = ++playerCardSequence;
    const active = () => alive && foreground && sequence === playerCardSequence && current();
    setState({ playerCard: card, playerCardStats: null, playerCardLoading: true, playerCardError: "", playerCardStatus: "" });
    app.querySelector('.player-card-close')?.focus({ preventScroll: true });
    try {
      if (!card.id) throw new Error("当前服务暂不支持查看玩家战绩，请更新服务端后重试");
      const result = await request(path);
      if (!active()) return;
      if (!result?.player || !['available', 'untracked'].includes(result.status) ||
        result.status === 'available' && (!result.stats || !Array.isArray(result.stats.byFaction)))
        throw new Error('战绩暂时无法读取，请稍后重试');
      if (result.player.id !== card.id || card.seat != null && result.player.seat !== card.seat) return closePlayerCard(false);
      const rateLabel = value => value == null ? "—" : value.toFixed(1) + "%";
      const stats = result.status === "available" ? { ...result.stats, rateLabel: rateLabel(result.stats.winRate),
        byFaction: result.stats.byFaction.map(row => ({ ...row, rateLabel: rateLabel(row.winRate) })) } : null;
      const playerCard = card.scope === 'leaderboard' ? { ...card, name: result.player.name, initial: Array.from(result.player.name || '友')[0], avatarUrl: result.player.avatarUrl || '' } : card;
      setState({ playerCard, playerCardStats: stats, playerCardStatus: result.status });
    } catch (e) {
      if (active()) setState({ playerCardError: e.message || "战绩读取失败，请重试" });
    } finally {
      if (active()) setState({ playerCardLoading: false });
    }
  }
  function seat(seatNum) {
    const r = state.room, s = state.seats.find(x => x.seat === seatNum);
    if (!r || !s || seatDisabled(s)) return;
    if (r.phase === "lobby") {
      if (s.mine) return confirmCommand("站起围观？", "站起后释放座位并取消准备，你仍留在房间，可点击空位重新坐下。", "stand");
      if (!s.occupied) return cmd("seat", { seat: seatNum });
    }
    return openPlayerCard(seatNum);
  }
  function toggleProposalSeat(seatNum) {
    const r = state.room;
    if (r?.phase !== "proposal" || r.flexible || r.leader !== r.me.seat || state.busy || state.hasPendingRequest || !state.network || !r.players.some(p => p.seat === seatNum)) return;
    const selected = state.selected.includes(seatNum) ? state.selected.filter(n => n !== seatNum) : [...state.selected, seatNum];
    setState({ selected, seats: state.seats.map(s => ({ ...s, selected: selected.includes(s.seat) })) });
  }
  function ready() {
    cmd("ready", { ready: !state.room.me.ready });
  }
  function propose() {
    cmd("propose", { team: state.selected });
  }
  async function leave() {
    if (state.busy || pending || !state.room) return;
    var room = state.room;
    if (
      !(await confirm(
        "离开房间？",
        room.me.isHost
          ? "离开仅释放座位，牌桌与房主身份保留，可从我的牌桌重新入座。"
          : "离开后将释放你的座位，牌桌保留。重新加入需要输入房间码。",
      ))
    )
      return;
    if (
      !foreground ||
      !state.room ||
      state.room.code !== room.code ||
      state.room.stage !== room.stage
    )
      return;
    cmd("leave", {}, "leave");
  }

  // ===== identity / private views =====
  var dealtIdentityReceipts;
  var identityHintPending = "";
  function identityDealKey() {
    var room = state.room;
    if (!room || !room.flexible || !room.game || room.me.seat == null ||
      ["lobby", "ended", "terminated"].includes(room.phase)) return "";
    return room.code + ":" + room.game + ":" + room.me.seat;
  }
  function identityReceipts() {
    if (!dealtIdentityReceipts) {
      var saved = safeParse(storage.get("dealtIdentityReceipts"));
      dealtIdentityReceipts = Array.isArray(saved) ? saved : [];
    }
    return dealtIdentityReceipts;
  }
  function rememberDealtIdentity() {
    var key = identityDealKey();
    if (!key) return;
    dealtIdentityReceipts = identityReceipts().filter(function (k) { return k !== key; }).concat(key).slice(-50);
    // Persist reminder receipts only; secrets stay in memory.
    storage.set("dealtIdentityReceipts", JSON.stringify(dealtIdentityReceipts));
  }
  function identityOverlayBlocked() {
    return !alive || !foreground || !state.room || state.error || !modal.hidden ||
      state.actionDialog || state.actionLoading || state.identityChange || state.fairyResult ||
      state.toolType || state.showRoomRules || state.showRoomSettings || state.showBoardDetails;
  }
  function showDealtIdentity() {
    var key = identityDealKey();
    if (!key || state.room.me.identityRevision > 0 || identityOverlayBlocked()) return false;
    if (state.dealtIdentityDialog) return true;
    if (identityReceipts().includes(key)) return false;
    mask();
    setState({ dealtIdentityDialog: true });
    var first = app.querySelector && app.querySelector('[data-action="revealDealtIdentity"]');
    if (first) first.focus({ preventScroll: true });
    return true;
  }
  async function revealDealtIdentity() {
    if (!state.dealtIdentityDialog || state.busy || !state.network || !foreground) return;
    var key = identityDealKey(), stage = state.room.stage, gen = ++generation;
    setState({ busy: true });
    try {
      var secret = await request("/api/rooms/" + roomCode + "/private");
      if (!alive || !foreground || gen !== generation || !state.dealtIdentityDialog ||
        key !== identityDealKey() || state.room.stage !== stage || secret.stage !== stage) return;
      rememberDealtIdentity();
      setState({ dealtIdentitySecret: {
        role: secret.role, faction: secret.faction, factionTone: factionTone(secret.faction),
        information: secret.information, skillStatus: secret.skillStatus,
      } });
      var close = app.querySelector && app.querySelector('.dealt-identity-dialog [data-action="closeDealtIdentity"]');
      if (close) close.focus({ preventScroll: true });
    } catch (e) {
      if (gen === generation && foreground) handleError(e);
    } finally {
      setState({ busy: false });
    }
  }
  function closeDealtIdentity() {
    if (!state.dealtIdentityDialog) return;
    rememberDealtIdentity();
    mask();
    if (!storage.get("identityEntryHintSeen")) identityHintPending = identityDealKey();
    showIdentityHintWhenVisible();
    var entry = app.querySelector && app.querySelector('[data-action="reveal"]');
    if (entry) entry.focus({ preventScroll: true });
  }
  function showIdentityHintWhenVisible() {
    if (!identityHintPending || identityHintPending !== identityDealKey() || identityOverlayBlocked() ||
      state.dealtIdentityDialog || state.revealed || !app.querySelector) return;
    var anchor = app.querySelector(".room-identity-anchor");
    if (!anchor) return;
    var rect = anchor.getBoundingClientRect();
    if (rect.height <= 0 || rect.top < 0 || rect.bottom > window.innerHeight) return;
    identityHintPending = "";
    storage.set("identityEntryHintSeen", "1");
    setState({ identityHintVisible: true });
  }
  function dismissIdentityHint() {
    identityHintPending = "";
    setState({ identityHintVisible: false });
  }
  async function reveal() {
    dismissIdentityHint();
    if (state.revealed) {
      mask();
      return;
    }
    if (state.busy || !state.network) return;
    generation++;
    var gen = generation;
    var stage = state.room.stage;
    setState({ busy: true, error: "" });
    try {
      var secret = await request("/api/rooms/" + roomCode + "/private");
      if (
        foreground &&
        alive &&
        gen === generation &&
        secret.stage === stage &&
        state.room &&
        state.room.stage === stage
      ) {
        secret.factionTone = factionTone(secret.faction);
        rememberDealtIdentity();
        setState({ revealed: true, secret: secret });
      }
    } catch (e) {
      handleError(e);
    } finally {
      setState({ busy: false });
    }
  }
  function closeAction() {
    actionGeneration++;
    setState({
      actionDialog: false,
      actionSecret: null,
      actionLoading: false,
      actionLabel: "",
      actionChoices: [],
      hunterModes: false,
      hunterMode: "",
      hunterChoices: [],
      actionTargets: [],
      draftChoice: "",
      draftLabel: "",
      stagedChoice: false,
      skillAction: false, skillTitle: "", skillHint: "", skillTargets: [], skillOtherChoices: [], skillBodyHeight: 0,
      swapOptions: [],
      swapSeats: [],
      swapPlayers: [],
    });
  }
  async function openAction() {
    var room = state.room;
    if (
      !room ||
      !room.needsSubmission ||
      room.me.submitted ||
      !foreground ||
      !state.network ||
      state.actionLoading
    )
      return;
    mask();
    var gen = actionGeneration;
    setState({ actionLoading: true });
    try {
      var response = await request("/api/rooms/" + roomCode + "/private");
      var r = state.room;
      if (
        !alive ||
        !foreground ||
        gen !== actionGeneration ||
        !r ||
        r.stage !== room.stage ||
        response.stage !== room.stage ||
        r.me.submitted
      )
        return;
      if (!response.action) return;
      promptedActionStage = room.stage;
      actionDraftStage = room.stage;
      var swapOptions = (response.action.choices || []).filter(function (v) {
        return /^swap:\d+:\d+$/.test(v);
      });
      var swapSeatsSet = new Set(
        swapOptions.flatMap(function (v) {
          return v.split(":").slice(1).map(Number);
        }),
      );
      var hunterChoices = response.action.hunterModes ? response.action.options : [];
      const actionChoices = response.action.hunterModes ? [{ value: "mode:detonate", label: "主动技能" }, { value: "mode:passive", label: "被动技能" }, { value: "pass", label: "本轮不开枪" }] : (response.action.choices || [])
          .filter(function (v) {
            return swapOptions.indexOf(v) === -1;
          })
          .map(function (value) {
            var opt = (response.action.options || []).filter(function (o) {
              return o.value === value;
            })[0];
            return {
              value: value,
              label: (opt && opt.label) || CHOICES[value] || value,
            };
          });
      setState({
        actionDialog: true,
        actionLabel: response.action.label,
        hunterModes: !!response.action.hunterModes,
        hunterMode: "",
        hunterChoices: hunterChoices,
        stagedChoice: ["teamVote", "quest", "skillPrepare", "skillTurn", "paladinTurn", "hunterTurn"].includes(room.phase),
        draftChoice: "",
        draftLabel: "",
        swapOptions: swapOptions,
        swapSeats: [],
        swapPlayers: (room.players || [])
          .filter(function (p) {
            return swapSeatsSet.has(p.seat);
          })
          .map(function (p) {
            return { seat: p.seat, name: p.name, selected: false };
          }),
        actionChoices,
        ...skillView(room, actionChoices, !!response.action.hunterModes, "", swapOptions),
        actionTargets: response.action.targets || [],
      });
    } catch (e) {
      if (gen === actionGeneration && foreground) handleError(e);
    } finally {
      if (gen === actionGeneration) setState({ actionLoading: false });
    }
  }
  async function revealActionIdentity() {
    if (state.actionSecret) {
      setState({ actionSecret: null });
      return;
    }
    var room = state.room;
    if (
      !state.actionDialog ||
      !room ||
      room.phase !== "identity" ||
      room.me.submitted ||
      !foreground ||
      state.busy ||
      !state.network
    )
      return;
    var gen = actionGeneration;
    setState({ busy: true });
    try {
      var secret = await request("/api/rooms/" + roomCode + "/private");
      if (
        alive &&
        foreground &&
        state.actionDialog &&
        gen === actionGeneration &&
        state.room &&
        state.room.stage === room.stage &&
        secret.stage === room.stage &&
        !state.room.me.submitted
      ) {
        setState({
          actionSecret: {
            role: secret.role,
            faction: secret.faction,
            factionTone: factionTone(secret.faction),
            information: secret.information,
            skillStatus: secret.skillStatus,
          },
        });
      }
    } catch (e) {
      if (gen === actionGeneration && foreground) handleError(e);
    } finally {
      setState({ busy: false });
    }
  }
  async function submitChoice(value) {
    if (state.hunterModes && value.indexOf("mode:") === 0) {
      if (state.busy || state.hasPendingRequest || !state.network || !foreground || !state.actionDialog || !state.room || state.room.me.submitted || state.room.stage !== actionDraftStage) return;
      if (!state.actionChoices.some(c => c.value === value)) return;
      var mode = value.split(":")[1];
      const actionChoices = mode ? state.hunterChoices.filter(function (o) { return o.value.indexOf(mode + ":") === 0; }).concat([{value: "mode:", label: "返回选择技能方式"}]) : [{value: "mode:detonate", label: "主动技能"}, {value: "mode:passive", label: "被动技能"}, {value: "pass", label: "本轮不开枪"}];
      setState({ hunterMode: mode, actionChoices, draftChoice: "", draftLabel: "",
        ...skillView(state.room, actionChoices, true, mode, state.swapOptions) });
      return;
    }
    var room = state.room;
    if (!room) return;
    if (state.stagedChoice) {
      if (
        state.busy ||
        state.hasPendingRequest ||
        !state.network ||
        state.room.me.submitted ||
        !foreground ||
        !state.actionDialog ||
        room.stage !== actionDraftStage
      )
        return;
      var choice = state.actionChoices.filter(function (c) {
        return c.value === value;
      })[0];
      if (choice) setState({ draftChoice: value, draftLabel: state.skillAction ? skillDraftLabel(choice, state.hunterModes) : choice.label,
        swapSeats: [], swapPlayers: state.swapPlayers.map(p => ({ ...p, selected: false })) });
      return;
    }
    if (
      ["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn", "fairy"].indexOf(
        room.phase,
      ) !== -1
    ) {
      var choice2 = state.actionChoices.filter(function (c) {
        return c.value === value;
      })[0];
      var label = (choice2 && choice2.label) || value;
      return confirmCommand("确认使用技能？", label + "。提交后不可更改。", "submit", {
        value: value,
      });
    }
    cmd("submit", { value: value });
  }
  function confirmChoice() {
    if (
      state.busy ||
      state.hasPendingRequest ||
      !foreground ||
      !state.actionDialog ||
      !state.stagedChoice ||
      !state.room ||
      state.room.stage !== actionDraftStage ||
      state.room.me.submitted ||
      !state.network
    )
      return;
    var value = state.draftChoice;
    if (!value || value.startsWith("mode:") ||
      !(state.actionChoices.some(c => c.value === value) ||
        (state.skillAction && state.swapOptions.includes(value)))) return;
    cmd("submit", { value: value });
  }
  async function submitTarget(seatNum) {
    return confirmCommand(
      "确认提交？",
      "提交 " + seatNum + " 号为最终目标，确认后不可更改。",
      "submit",
      { value: seatNum },
    );
  }
  function toggleSwapSeat(seatNum) {
    if (
      state.busy ||
      state.hasPendingRequest ||
      !state.network ||
      !foreground ||
      !state.actionDialog ||
      !state.room ||
      state.room.me.submitted ||
      state.room.stage !== actionDraftStage
    )
      return;
    if (!state.swapPlayers.some(function (p) {
      return p.seat === seatNum;
    }))
      return;
    var selected =
      state.swapSeats.indexOf(seatNum) !== -1
        ? state.swapSeats.filter(function (s) {
            return s !== seatNum;
          })
        : state.swapSeats.length < 2
          ? state.swapSeats.concat([seatNum])
          : state.swapSeats;
    const pair = selected.slice().sort((a, b) => a - b).join(":");
    const draft = state.swapOptions.find(v => v.split(":").slice(1).map(Number).sort((a, b) => a - b).join(":") === pair);
    setState({
      ...(state.skillAction ? { draftChoice: draft || "", draftLabel: draft ? "交换 " + selected.slice().sort((a, b) => a - b).join(" 号与 ") + " 号" : "" } : {}),
      swapSeats: selected,
      swapPlayers: state.swapPlayers.map(function (p) {
        return { seat: p.seat, name: p.name, selected: selected.indexOf(p.seat) !== -1 };
      }),
    });
  }
  async function confirmSwap() {
    if (
      state.busy ||
      !state.network ||
      !foreground ||
      !state.actionDialog ||
      !state.room ||
      state.room.stage !== actionDraftStage ||
      state.swapSeats.length !== 2
    )
      return;
    var seats = state.swapSeats.slice().sort(function (a, b) {
      return a - b;
    });
    var value = (state.swapOptions || []).filter(function (v) {
      var parts = v
        .split(":")
        .slice(1)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        });
      return parts.join(":") === seats.join(":");
    })[0];
    if (!value) return;
    return confirmCommand(
      "确认秘密换号？",
      "交换 " + seats[0] + " 号与 " + seats[1] + " 号。提交后不可更改。",
      "submit",
      { value: value },
    );
  }
  async function showFairyResult() {
    var room = state.room;
    if (!room || state._fairyLoading) return;
    state._fairyLoading = true;
    var gen = generation;
    try {
      var secret = await request("/api/rooms/" + room.code + "/private");
      if (
        alive &&
        foreground &&
        generation === gen &&
        state.room &&
        state.room.code === room.code &&
        state.room.stage === secret.stage &&
        state.room.me.fairyResultPending &&
        !state.identityChange &&
        secret.fairyResult
      ) {
        closeAction();
        setState({
          fairyResult: secret.fairyResult,
          fairyResultRevealed: false,
          revealed: false,
          secret: null,
        });
      }
    } catch (e) {
      handleError(e);
    } finally {
      state._fairyLoading = false;
    }
  }
  async function acknowledgeFairyResult() {
    if (state.busy || state._fairyAckConfirm || !state.fairyResultRevealed || !state.fairyResult) return;
    var result = state.fairyResult, gen = generation;
    state._fairyAckConfirm = true;
    try {
      if (!(await confirm("关闭查验结果？", "关闭后不会再显示本次查验结果，请确认已记住。"))) return;
      if (!alive || !foreground || generation !== gen || state.fairyResult !== result || !state.fairyResultRevealed) return;
      setState({ fairyResult: null, fairyResultRevealed: false });
      return cmd("ackFairyResult", { revision: result.revision });
    } finally {
      state._fairyAckConfirm = false;
    }
  }
  async function showIdentityChange() {
    var room = state.room;
    if (!room || state._identityLoading) return;
    state._identityLoading = true;
    var gen = generation;
    try {
      var secret = await request("/api/rooms/" + room.code + "/private");
      if (
        foreground &&
        alive &&
        generation === gen &&
        state.room &&
        state.room.code === room.code &&
        state.room.stage === secret.stage &&
        state.room.me.identityChanged
      ) {
        closeAction();
        secret.factionTone = factionTone(secret.faction);
        setState({
          identityChange: secret,
          identityChangeRevealed: false,
          revealed: false,
          secret: null,
        });
      }
    } catch (e) {
      handleError(e);
    } finally {
      state._identityLoading = false;
    }
  }
  function acknowledgeIdentity() {
    if (state.busy || !state.identityChangeRevealed) return;
    var revision = state.identityChange && state.identityChange.identityRevision;
    if (revision === undefined) return;
    setState({ identityChange: null, identityChangeRevealed: false });
    cmd("ackIdentity", { revision: revision });
  }

  // ===== host tools =====
  function openTool(kind) {
    var room = state.room;
    if (!room || !room.canUseTools || state.busy) return;
    var toolSeats =
      ["vote", "quest"].indexOf(kind) !== -1 ? room.team.slice() : [];
    toolStage = room.stage;
    setState({
      toolType: kind,
      toolTitle:
        {
          skills: "使用技能",
          conversion: "身份转换",
          fairy: "仙女查验",
        }[kind] || "",
      toolDescription:
        {
          skills:
            "全员同时提交，按车长顺序结算。再次发起会进入下一轮，新身份技能随之生效。",
          conversion: "抽取一张转换牌，按牌面决定兰斯洛特是否交换阵营。",
          fairy: "仅仙女持有者选择目标，私密查验并传递仙女。",
        }[kind] || "",
      toolSeats: toolSeats,
      toolThreshold: 1,
      toolPlayers: room.players
        .filter(function (p) {
          return kind === "assassination" || p.alive !== false;
        })
        .map(function (p) {
          return {
            seat: p.seat,
            name: p.name,
            alive: p.alive,
            selected: toolSeats.indexOf(p.seat) !== -1,
          };
        }),
    });
  }
  function closeTool() {
    setState({ toolType: "", toolTitle: "", toolDescription: "" });
  }
  function toggleToolSeat(seatNum) {
    if (state.busy) return;
    var r = state.room;
    var toolSeats =
      r.knights && state.toolType === "assassination"
        ? [seatNum]
        : state.toolSeats.indexOf(seatNum) !== -1
          ? state.toolSeats.filter(function (s) {
              return s !== seatNum;
            })
          : state.toolSeats.concat([seatNum]);
    setState({
      toolSeats: toolSeats,
      toolPlayers: state.toolPlayers.map(function (p) {
        return {
          seat: p.seat,
          name: p.name,
          alive: p.alive,
          selected: toolSeats.indexOf(p.seat) !== -1,
        };
      }),
    });
  }
  function pickToolThreshold(value) {
    if (state.busy) return;
    if ([1, 2].indexOf(value) !== -1) setState({ toolThreshold: value });
  }
  async function launchTool() {
    if (state.busy || pending) return;
    var room = state.room;
    if (!room || room.stage !== toolStage) {
      closeTool();
      setState({ error: "阶段已变化，请重新选择操作" });
      return;
    }
    var kind = state.toolType;
    var extra = {
      kind: kind,
      team: state.toolSeats.slice(),
      threshold: state.toolThreshold,
      actor: state.toolSeats[0],
      replace: room.hasActiveOperation,
    };
    if (kind === "quest" && (!extra.team.length || extra.threshold > extra.team.length)) {
      setState({ error: "请选择任务队员，失败票门槛不能超过队员人数" });
      return;
    }
    if (
      room.hasActiveOperation &&
      !(await confirm(
        "作废当前操作并切换？",
        "当前尚未结算的提交将作废，已结算记录和玩家身份保留。",
      ))
    )
      return;
    if (!foreground || !state.room || state.room.stage !== room.stage) return;
    closeTool();
    cmd("beginActivity", extra);
  }

  // ===== clipboard / misc =====
  async function copyText(text, okMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText)
        await navigator.clipboard.writeText(text);
      else throw new Error("unsupported");
      toast(okMsg);
    } catch (e) {
      handleError({ message: "复制失败，请手动记录", status: 400 });
    }
  }
  function connectionInfo() {
    var content = !state.network || state.needsLogin || !state.serverConnected
      ? "连接尚未确认，请检查网络或重试。"
      : state.busy || state.loading || state.roomsRefreshing || pending
        ? "正在确认操作，请稍候。"
        : "最近一次服务器请求成功。";
    confirm("连接状态", content, false);
  }

  // ===== settings dialog =====
  function emptySettings() {
    return {
      loading: true,
      busy: false,
      authorized: false,
      error: "",
      room: null,
      boards: [],
      capacities: [],
      choices: [],
      capacity: 0,
      boardId: "",
      visible: false,
      fairyEnabled: false,
      scoreEnabled: false,
      recordPurpose: "normal",
      dirty: false,
      pendingKick: !!settingsKickPending && settingsKickPending.code === roomCode,
      pendingSave: !!settingsSavePending && settingsSavePending.code === roomCode,
    };
  }
  function toggleRoomSettings() {
    if (!state.room || !state.room.me.isHost || state.busy) return;
    if (state.showRoomSettings) {
      closeSettings();
      return;
    }
    mask();
    state.showRoomSettings = true;
    state.settings = emptySettings();
    render();
    loadSettings();
  }
  function closeSettings() {
    if (state.settings?.busy) return;
    state.showRoomSettings = false;
    state.settings = null;
    render();
  }
  async function loadSettings(quiet = false) {
    var s = state.settings;
    if (!s || (s.busy && !quiet)) return;
    setSettings(quiet ? { error: "" } : { loading: true, error: "", authorized: false });
    try {
      if (!/^\d{6}$/.test(roomCode || "")) throw new Error("房间号无效");
      await login();
      var room = await request("/api/rooms/" + roomCode);
      if (!room.me.isHost) throw Object.assign(new Error("仅房主管理员可访问房间设置"), { status: 403 });
      var boards = (await request("/api/boards")).boards;
      if (!alive || state.settings !== s) return;
      settingsOriginal = room;
      var capacities = [
        ...new Set(
          boards
            .filter(function (b) {
              return b.available;
            })
            .flatMap(function (b) {
              return b.counts;
            }),
        ),
      ]
        .filter(function (n) {
          return room.players.every(function (p) {
            return p.seat <= n;
          });
        })
        .sort(function (a, b) {
          return a - b;
        });
      setSettings({
        authorized: true,
        room: room,
        boards: boards,
        capacities: capacities,
        capacity: room.capacity,
        boardId: room.board,
        visible: room.showSkillDetails === true,
        fairyEnabled: room.fairyEnabled === true,
        scoreEnabled: room.scoreSettings?.enabled === true,
        recordPurpose: room.recordSettings?.purpose || "normal",
        dirty: false,
      });
      updateSettingsChoices(room.capacity, room.board);
    } catch (e) {
      if (alive && state.settings === s) setSettings({ error: e.message, authorized: e.status === 403 ? false : s.authorized });
    } finally {
      if (alive && state.settings === s) setSettings({ loading: false });
    }
  }
  function updateSettingsChoices(capacity, boardId) {
    var s = state.settings;
    if (!s) return;
    var choices = s.boards.filter(function (b) {
      return b.available && b.counts.indexOf(capacity) !== -1;
    });
    var selected =
      choices.filter(function (b) {
        return b.id === boardId;
      })[0] || choices[0];
    if (!selected) return;
    setSettings({
      fairyEnabled: capacity !== s.capacity ? capacity >= 8 : s.fairyEnabled,
      scoreEnabled: capacity !== s.capacity && s.room?.scoreSettings ? capacity >= s.room.scoreSettings.defaultEnabledMinPlayers : s.scoreEnabled,
      capacity: capacity,
      boardId: selected.id,
      choices: choices,
      visible: ["knights", "knights-10", "knights-11", "knights-13"].includes(selected.id) ? s.visible : false,
    });
    updateSettingsDirty();
  }
  function updateSettingsDirty() {
    var s = state.settings;
    var r = settingsOriginal;
    setSettings({
      dirty:
        !!r &&
        (s.fairyEnabled !== (r.fairyEnabled === true) ||
          !!r.scoreSettings && s.scoreEnabled !== r.scoreSettings.enabled ||
          !!r.recordSettings && s.recordPurpose !== r.recordSettings.purpose ||
          s.capacity !== r.capacity ||
          s.boardId !== r.board ||
          s.visible !== (["knights", "knights-10", "knights-11", "knights-13"].includes(r.board) && r.showSkillDetails === true)),
    });
  }
  function settingsLocked() {
    var s = state.settings;
    return !s || s.loading || s.busy || s.pendingKick || s.pendingSave || !s.authorized;
  }
  async function settingsSave() {
    var s = state.settings;
    if (!s || s.busy || s.pendingKick || !s.authorized || (!s.dirty && !s.pendingSave)) return;
    if (!settingsSavePending || settingsSavePending.code !== roomCode) {
      settingsSavePending = { id: requestId(), code: roomCode, data: {
        type: "updateSettings", stage: settingsOriginal.stage,
        board: s.boardId, capacity: s.capacity, visible: s.visible, fairyEnabled: s.fairyEnabled,
        ...(settingsOriginal.scoreSettings ? { scoreEnabled: s.scoreEnabled } : {}),
        ...(settingsOriginal.recordSettings ? { recordPurpose: s.recordPurpose } : {}),
      } };
    }
    var saved = settingsSavePending;
    setSettings({ busy: true, pendingSave: true, error: "" });
    try {
      await login();
      await request("/api/rooms/" + saved.code + "/commands", "POST", saved.data, saved.id);
      if (settingsSavePending === saved) settingsSavePending = null;
      if (!alive || state.settings !== s) return;
      setSettings({ dirty: false, pendingSave: false });
      await loadSettings(true);
    } catch (e) {
      if (e.status && e.status < 500 && ![401, 429].includes(e.status) && settingsSavePending === saved)
        settingsSavePending = null;
      if (!alive || state.settings !== s) return;
      setSettings({ error: e.message, pendingSave: settingsSavePending === saved,
        authorized: e.status === 403 ? false : s.authorized });
      if (e.status === 409) {
        await loadSettings(true);
        setSettings({ error: "房间状态已变化，已刷新设置，请重新修改。" });
      }
    } finally {
      if (alive && state.settings === s) setSettings({ busy: false });
    }
  }
  async function settingsBack() {
    var s = state.settings;
    if (s?.busy) return;
    if (s && (s.dirty || s.pendingKick || s.pendingSave)) {
      if (!(await confirm("返回牌桌？", s.pendingKick ? "移出结果尚未确认，请重新进入房间设置重试确认。" : s.pendingSave ? "保存结果尚未确认，请重新进入设置重试。" : "未保存的修改将放弃。"))) return;
    }
    closeSettings();
  }
  async function kickFromSettings(seat) {
    var s = state.settings;
    if (!s || s.busy || s.pendingKick || s.pendingSave || !s.authorized || !s.room || !s.room.canKick || state.busy || pending) return;
    var target = s.room.players.find(function (p) { return p.seat === seat && p.seat !== s.room.me.seat; });
    if (!target) return;
    var code = roomCode;
    var data = { type: "kick", stage: s.room.stage, seat: seat, targetId: target.managementId, confirm: true };
    setSettings({ busy: true });
    var ok = await confirm("移出玩家？", "将 " + seat + "号 · " + target.name + " 移出房间，其他玩家和已有对局记录保留。准备阶段可凭房间码重新加入。", true, "移出");
    if (state.settings !== s) return;
    setSettings({ busy: false });
    if (!ok || !alive || !foreground || code !== roomCode) return;
    settingsKickPending = { id: requestId(), data: data, code: code };
    return sendKick();
  }
  async function sendKick() {
    var s = state.settings;
    var requestData = settingsKickPending;
    if (!s || s.busy || !requestData || requestData.code !== roomCode) return;
    var draft = s.dirty ? { capacity: s.capacity, boardId: s.boardId, visible: s.visible, fairyEnabled: s.fairyEnabled, scoreEnabled: s.scoreEnabled, recordPurpose: s.recordPurpose } : null;
    setSettings({ busy: true, pendingKick: true, error: "" });
    try {
      await login();
      await request("/api/rooms/" + requestData.code + "/commands", "POST", requestData.data, requestData.id);
      settingsKickPending = null;
      if (!alive || state.settings !== s) return;
      setSettings({ busy: false, pendingKick: false });
      await loadSettings();
      if (state.settings === s && s.authorized && draft) {
        setSettings({ visible: draft.visible });
        updateSettingsChoices(draft.capacity, draft.boardId);
        setSettings({ fairyEnabled: draft.fairyEnabled, scoreEnabled: draft.scoreEnabled, recordPurpose: draft.recordPurpose });
        updateSettingsDirty();
      }
      if (foreground) toast("玩家已移出");
      await refresh();
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 401 && e.status !== 429) settingsKickPending = null;
      if (!alive || state.settings !== s) return;
      setSettings({ error: e.message, pendingKick: !!settingsKickPending, authorized: e.status === 403 ? false : s.authorized });
      if (e.status === 409) {
        setSettings({ busy: false });
        await loadSettings();
        setSettings({ error: "房间或座位已变化，已刷新，请重新选择要移出的玩家。" });
      }
    } finally {
      if (alive && state.settings === s) setSettings({ busy: false });
    }
  }
  async function transferFromSettings(seat) {
    var s = state.settings;
    if (!s || s.busy || s.pendingKick || s.pendingSave || !s.authorized || !s.room || state.busy || pending)
      return;
    var target = s.room.players.filter(function (p) {
      return p.seat === seat && p.seat !== s.room.me.seat;
    })[0];
    if (!target) return;
    if (
      !(await confirm(
        "移交房主？",
        "房主身份将移交给 " +
          seat +
          "号 · " +
          target.name +
          "，你不再拥有管理权限。对局中也可移交，新房主立即接管流程。" +
          (s.dirty ? "未保存的房间设置将放弃。" : ""),
      ))
    )
      return;
    if (!alive || !foreground || !state.room) return;
    var id = requestId();
    var data = { type: "transfer", stage: state.room.stage, seat: seat };
    setSettings({ busy: true, error: "" });
    try {
      await login();
      await request("/api/rooms/" + roomCode + "/commands", "POST", data, id);
      if (!alive) return;
      toast("房主已移交");
      closeSettings();
      await refresh();
    } catch (e) {
      if (!alive) return;
      setSettings({
        error: e.message,
        authorized:
          e.status === 403
            ? false
            : !!(state.settings && state.settings.authorized),
      });
      if (e.status === 409) {
        setSettings({ busy: false });
        await loadSettings();
        setSettings({ error: "房间状态已变化，请重试。" });
      }
    } finally {
      if (alive) setSettings({ busy: false });
    }
  }

  // ===== render =====
  function btn(cls, action, label, opts, disabled) {
    var attrs = [];
    if (action) attrs.push('data-action="' + action + '"');
    if (opts)
      for (var k in opts) {
        if (opts[k] === undefined || opts[k] === null) continue;
        attrs.push('data-' + k + '="' + esc(String(opts[k])) + '"');
      }
    if (disabled) attrs.push("disabled");
    return (
      '<button type="button" class="' +
      cls +
      '" ' +
      attrs.join(" ") +
      ">" +
      esc(label) +
      "</button>"
    );
  }
  function seatMeta(s) {
    var r = state.room;
    if (r.phase === "lobby")
      return s.occupied ? (s.ready ? "已准备" : "未准备") : "可入座";
    return s.selected ? "已选入队" : s.inTeam ? "任务队员" : "";
  }

  function roomMenuButton(kind, title, description, disabled) {
    return '<button type="button" class="room-menu-action' + (kind === "delete" ? ' danger' : '') +
      '" data-action="roomMenuAction" data-kind="' + kind + '"' + (disabled ? ' disabled' : '') +
      '><span class="room-menu-copy"><span class="room-menu-label">' + esc(title) +
      '</span>' + (description ? '<span class="room-menu-description">' + esc(description) + '</span>' : '') +
      '</span><span class="room-menu-chevron" aria-hidden="true">›</span></button>';
  }
  function seatDisabled(s) {
    return state.busy || state.hasPendingRequest || !state.network || (state.room.phase !== "lobby" && !s.occupied);
  }
  function viewPlayerCard() {
    const p = state.playerCard, stats = state.playerCardStats;
    if (!p || state.error || state.actionDialog || state.dealtIdentityDialog || state.identityChange || state.fairyResult) return "";
    let html = '<div class="dialog-backdrop player-card-backdrop" data-player-card-backdrop><section class="player-card-sheet" role="dialog" aria-modal="true" aria-label="' + esc(p.name + '的玩家战绩') + '"><div class="player-card-handle" aria-hidden="true"></div><div class="player-card-heading"><span>玩家战绩</span>' + '<button type="button" class="player-card-close" data-action="closePlayerCard" aria-label="关闭玩家战绩">×</button>' + '</div><div class="player-card-body"><div class="player-card-identity"><div class="player-card-avatar"><span>' + esc(p.initial) + '</span>' + (p.avatarUrl && !p.avatarFailed ? '<img class="player-card-avatar-image" src="' + esc(p.avatarUrl) + '" alt="" data-player-card-avatar />' : '') + '</div><div class="player-card-name"><span class="player-card-display-name">' + esc(p.name) + '</span>' + (p.scope !== 'leaderboard' ? '<span class="small muted">' + p.seat + '号位' + (p.isHost ? ' · 房主' : '') + '</span>' : '') + '</div></div>';
    if (state.playerCardLoading) html += '<div class="player-card-message muted" role="status">正在读取战绩…</div>';
    else if (state.playerCardError) html += '<div class="player-card-message" role="alert">' + esc(state.playerCardError) + btn('text-button','retryPlayerCard','重试') + '</div>';
    else if (state.playerCardStatus === 'untracked') html += '<div class="player-card-message muted">陪测玩家不记录个人战绩</div>';
    else if (stats) {
      html += '<div class="player-card-summary">' + [[stats.total,'有效局数'],[stats.wins,'胜场'],[stats.rateLabel,'总胜率']].map(row => '<div class="player-card-stat"><span class="player-card-number">' + esc(row[0]) + '</span><span class="small muted">' + row[1] + '</span></div>').join('') + '</div>';
      html += stats.total ? '<div class="player-card-factions"><div class="player-card-section-title">阵营表现</div>' + stats.byFaction.map(row => '<div class="player-card-faction"><span class="faction-' + esc(row.faction) + '">' + esc(row.label) + '</span><span class="small muted">' + row.wins + '胜 / ' + row.total + '局</span><span>' + esc(row.rateLabel) + '</span></div>').join('') + '</div>' : '<div class="player-card-empty small muted">暂无有效战绩</div>';
      html += '<div class="player-card-score"><span>总积分</span><span class="player-card-score-value">' + stats.scoreTotal + '</span></div>';
    } else html += '<div class="player-card-message" role="alert">战绩暂时无法读取，请稍后重试' + btn('text-button','retryPlayerCard','重试') + '</div>';
    return html + '</div></section></div>';
  }
  function viewFairyResult() {
    if (!state.fairyResult || state.identityChange || state.error) return "";
    return (
      '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">仙女查验结果</div><div class="small muted">仅供本人查看</div>' +
      (state.fairyResultRevealed
        ? '<div class="fairy-result-summary">' +
          esc(state.fairyResult.summary || state.fairyResult.information) +
          "</div>" +
          btn("primary", "acknowledgeFairyResult", "记住了，遮盖结果", null, state.busy)
        : '<div class="private-info muted">结果已遮盖，请确认周围无人查看。</div>' +
          btn("primary", "revealFairyResult", "查看查验结果", null, state.busy)) +
      "</div></div>"
    );
  }
  function viewDealtIdentity() {
    if (!state.dealtIdentityDialog || state.error) return "";
    var secret = state.dealtIdentitySecret;
    return '<div class="dialog-backdrop"><div class="error-dialog dealt-identity-dialog" role="dialog" aria-modal="true" aria-labelledby="dealt-identity-title">' +
      '<div id="dealt-identity-title" class="dialog-title">身份已发放</div><div class="small muted identity-privacy-note">仅供本人查看</div>' +
      (secret ? '<div class="identity-title faction-' + secret.factionTone + '">' + esc(secret.role) + '</div><div class="muted">' + esc(secret.faction) +
        '</div><div class="private-info"><div class="label">你的视野</div>' + esc(secret.information) + '</div>' +
        (secret.skillStatus ? '<div class="private-info"><div class="label">技能状态 · ' + esc(secret.skillStatus.title) + '</div>' + esc(secret.skillStatus.detail) + '</div>' : '') +
        '<div class="small muted identity-return-note">之后可在房间号右侧的「我的身份」再次查看。</div>' +
        btn("primary", "closeDealtIdentity", "记住了，遮盖身份") :
        '<div class="private-info muted">请确认屏幕仅自己可见，再查看身份与视野。</div>' +
        btn("primary", "revealDealtIdentity", state.busy ? "正在读取…" : "查看身份", null, state.busy || !state.network) +
        btn("text-button", "closeDealtIdentity", "稍后查看")) + '</div></div>';
  }
  function viewIdentityChange() {
    if (!state.identityChange || state.error) return "";
    var ic = state.identityChange;
    return (
      '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">你已获得新身份</div>' +
      '<div class="small muted">仅供本人查看 · ' +
      (ic.passiveVision ? "视野随技能结算自动更新" : "新技能下一轮可用") +
      "</div>" +
      (state.identityChangeRevealed
        ? '<div class="identity-title faction-' +
          (ic.factionTone || "") +
          '">' +
          esc(ic.role) +
          '</div><div class="muted">' +
          esc(ic.faction) +
          '</div><div class="private-info">' +
          esc(ic.information) +
          "</div>" +
          viewSkillStatus(ic) +
          btn("primary", "acknowledgeIdentity", "记住了，遮盖身份", null, state.busy)
        : '<div class="private-info muted">身份已遮盖，请确认周围无人查看。</div>' +
          btn("primary", "revealChangedIdentity", "查看新身份", null, state.busy)) +
      "</div></div>"
    );
  }
  function viewBrand() {
    var dot =
      !state.network || state.needsLogin
        ? "offline"
        : state.loading || state.roomsRefreshing || state.busy || state.hasPendingRequest
          ? "pending"
          : state.serverConnected
            ? "online"
            : "offline";
    var label =
      !state.network || state.needsLogin
        ? "连接异常"
        : state.loading || state.roomsRefreshing || state.busy || state.hasPendingRequest
          ? "正在同步"
          : state.serverConnected
            ? "连接正常"
            : "连接未确认";
    return (
      '<div class="brand"><div class="brand-identity"><span class="brand-mark">桌边助手</span>' +
      '<button type="button" class="connection-button" data-action="connectionInfo" aria-label="服务器' +
      esc(state.reconnecting ? "重连中" : label) +
      '"><span class="connection-dot ' + (state.reconnecting ? "pending" : dot) + '"></span>' +
      (state.reconnecting || !state.network || state.needsLogin ? '<span class="connection-label">' + (state.reconnecting ? '重连中' : '连接断开') + '</span>' : '') +
      '</button></div>' +
      (state.room || state.page === 'table' ? '<button type="button" class="switch-table home-entry" data-action="returnHome" aria-label="返回对局，保留当前座位"' + (state.busy ? ' disabled' : '') + '><span class="home-icon" aria-hidden="true"></span><span>对局</span></button>' : '') +
      '</div>'

    );
  }
  function viewErrorDialog() {
    if (!state.error) return "";
    return (
      '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">' +
      (state.recoverableError ? "连接需要恢复" : "暂时无法完成") +
      '</div><div class="dialog-message">' +
      esc(state.error) +
      '</div><div class="dialog-actions">' +
      (state.recoverableError && !state.hasPendingRequest
        ? btn("secondary", "returnHome", "回首页", null, state.busy)
        : "") +
      (state.recoverableError
        ? btn(
            "primary",
            "retry",
            state.needsLogin ? "重新登录" : "重试",
            null,
            state.busy,
          )
        : btn("primary", "dismissError", "知道了")) +
      "</div></div></div>"
    );
  }
  function viewSkillStatus(secret) {
    if (!secret || !secret.skillStatus) return "";
    return '<div class="private-info"><div class="label">技能状态 · ' +
      esc(secret.skillStatus.title) + '</div>' + esc(secret.skillStatus.detail) + '</div>';
  }
  function viewSkillDialog() {
    var locked = state.busy || state.hasPendingRequest || !state.network;
    var html = '<div class="dialog-backdrop"><div class="error-dialog action-dialog skill-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-title" aria-describedby="skill-hint">' +
      '<div class="skill-header"><div id="skill-title" class="skill-title">' + esc(state.skillTitle) + '</div>' +
      '<div id="skill-hint" class="skill-hint">' + esc(state.skillHint) + '</div>' +
      '</div><div class="skill-body">';
    if (["hunterTurn", "paladinTurn"].includes(state.room.phase) && state.room.operationStatus)
      html += '<div class="skill-context">' + esc(state.room.operationStatus.detail) + '</div>';
    function seatButton(c, swap) {
      var selected = swap ? c.selected : state.draftChoice === c.value;
      return '<button type="button" class="skill-option' + (selected ? ' is-selected' : '') + '" data-action="' + (swap ? 'toggleSwapSeat' : 'submitChoice') + '" ' +
        (swap ? 'data-seat="' + c.seat : 'data-value="' + esc(c.value)) + '" aria-pressed="' + selected + '" aria-label="' + esc((swap ? c.seat + '号' : c.label) + ' ' + c.name) + '"' +
        (locked || (swap && state.swapSeats.length === 2 && !selected) ? ' disabled' : '') + '><span class="skill-seat">' + c.seat + ' 号</span><span class="skill-name">' + esc(c.name) + '</span>' +
        (selected ? '<span class="skill-check" aria-hidden="true">✓</span>' : '') + '</button>';
    }
    if (state.skillTargets.length) html += '<div class="skill-target-grid">' + state.skillTargets.map(c => seatButton(c, false)).join('') + '</div>';
    if (state.swapOptions.length) html += '<div class="skill-context">已选 ' + state.swapSeats.length + ' / 2</div><div class="skill-target-grid">' + state.swapPlayers.map(c => seatButton(c, true)).join('') + '</div>';
    html += '</div><div class="skill-other-choices">';
    for (var c of state.skillOtherChoices) {
      var selected = state.draftChoice === c.value;
      html += '<button type="button" class="skill-other' + (selected ? ' is-selected' : '') + '" data-action="submitChoice" data-value="' + esc(c.value) + '"' +
        (c.value === 'pass' ? ' aria-pressed="' + selected + '"' : '') + (locked ? ' disabled' : '') + '><span class="skill-other-mark" aria-hidden="true">' +
        (selected ? '✓' : c.value === 'pass' ? '○' : '›') + '</span>' + esc(c.label) + '</button>';
    }
    html += '</div><div class="skill-footer"><div class="skill-summary" aria-live="polite">' +
      (state.draftChoice ? '已选择：' + esc(state.draftLabel) : state.swapSeats.length ? '还需选择一个座位' : '尚未选择') + '</div>' +
      (state.hunterModes && state.draftChoice === 'pass' ? '<div class="small">本轮若出局，将不会触发被动开枪。是否确认？</div>' : '') +
      btn('primary skill-confirm', 'confirmChoice', state.busy ? '正在提交…' : state.draftChoice ? (state.draftLabel === '本轮确认' ? '确认本轮选择' : '确认' + state.draftLabel) : '请先选择', null, locked || !state.draftChoice) +
      btn('text-button skill-later', 'closeAction', '稍后选择', null, state.busy) + '</div></div></div>';
    return html;
  }
  function viewActionDialog() {
    var r = state.room;
    if (
      !state.actionDialog ||
      state.error ||
      !r ||
      !r.needsSubmission ||
      r.me.submitted
    )
      return "";
    if (state.skillAction) return viewSkillDialog();
    var html =
      '<div class="dialog-backdrop"><div class="error-dialog action-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">' +
      (r.phase === "identity" ? "查看身份" : esc(state.actionLabel)) +
      "</div>";
    if (r.phase === "teamVote") html += '<div class="action-team">' + (r.team.length ? '任务队伍：' + esc(r.team.join("、")) + '号' : '本次为全员表决（未指定任务队伍）') + '</div>';
    if (r.phase === "identity") {
      html += '<div class="action-identity">';
      if (state.actionSecret) {
        var s = state.actionSecret;
        html +=
          '<div class="action-identity-details"><div class="identity-title faction-' +
          (s.factionTone || "") +
          '">' +
          esc(s.role) +
          '</div><div class="muted">' +
          esc(s.faction) +
          '</div><div class="private-info"><div class="label">你的视角</div>' +
          esc(s.information) +
          "</div>" + viewSkillStatus(s) + "</div>";
      }
      html +=
        btn(
          "secondary",
          "revealActionIdentity",
          state.actionSecret ? "立即遮盖" : "查看身份与视角",
          null,
          state.busy || !state.network,
        ) +
        "</div>";
    }
    if (["paladinTurn", "hunterTurn"].indexOf(r.phase) !== -1) html += '<div class="small muted">' + esc(r.operationStatus ? r.operationStatus.detail : "进入追加技能确认，上一阶段提交已完成。") + '</div>';
    if (state.hunterModes) html += '<div class="small muted">' + (state.hunterMode ? (state.hunterMode === "detonate" ? "第 2 步：选择相邻一人，自己将自爆出局" : "第 2 步：选择出局时开枪的目标") : "第 1 步：选择技能方式") + '</div>';
    html += '<div class="action-choice-list">';
    for (var i = 0; i < state.actionChoices.length; i++) {
      var c = state.actionChoices[i];
      var cls =
        state.stagedChoice
          ? state.draftChoice === c.value
            ? "primary"
            : "secondary"
          : "secondary";
      var label =
        (state.stagedChoice && state.draftChoice === c.value ? "✓ " : "") +
        (r.phase === "identity" ? "已记住身份与视野" : c.label);
      html += btn("action-choice " + cls, "submitChoice", label, { value: c.value }, state.busy || !state.network);
    }
    html += "</div>";
    if (state.swapOptions.length) {
      html +=
        '<div class="small muted">选择两个座位 · 已选 ' +
        state.swapSeats.length +
        " / 2；再次点击可取消</div>" +
        '<div class="tool-seat-grid swap-seat-grid">';
      for (var j = 0; j < state.swapPlayers.length; j++) {
        var p = state.swapPlayers[j];
        html +=
          '<button type="button" class="tool-seat-option' +
          (p.selected ? " active" : "") +
          '" data-action="toggleSwapSeat" data-seat="' +
          p.seat +
          '"' +
          (state.busy || !state.network || (state.swapSeats.length === 2 && !p.selected)
            ? " disabled"
            : "") +
          '><span>' +
          (p.selected ? "✓ " : "") +
          p.seat +
          '号</span><span class="swap-seat-name">' +
          esc(p.name) +
          "</span></button>";
      }
      html +=
        "</div>" +
        btn("primary", "confirmSwap", "确认换号", null, state.busy || !state.network || state.swapSeats.length !== 2);
    }
    if (state.stagedChoice) {
      html +=
        '<div class="small muted">' +
        (state.draftChoice
          ? "已选：" + esc(state.draftLabel) + "，确认提交后不可更改"
          : "请先选择，再确认提交") +
        "</div>" +
        btn("primary", "confirmChoice", "确认提交", null, state.busy || !state.network || !state.draftChoice);
    }
    if (state.actionTargets.length) {
      html += '<div class="action-target-scroll">';
      for (var k = 0; k < state.actionTargets.length; k++) {
        var t = state.actionTargets[k];
        html +=
          btn("secondary", "submitTarget", t.seat + "号 · " + t.name, { seat: t.seat }, state.busy || !state.network);
      }
      html += "</div>";
    }
    html += btn("text-button", "closeAction", "稍后", null, state.busy);
    html += "</div></div>";
    return html;
  }
  function viewToolDialog() {
    var r = state.room;
    if (!state.toolType || !r || !r.canUseTools || state.error) return "";
    var kind = state.toolType;
    var title = state.toolTitle
      ? state.toolTitle
      : kind === "vote"
        ? "发起投票"
        : kind === "quest"
          ? "发起任务"
          : kind === "reverseStrike"
            ? "刀逆仆"
            : kind === "offline"
              ? "线下刀人"
              : "刀梅林";
    var html =
      '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">' +
      esc(title) +
      "</div>";
    if (kind === "vote" || kind === "quest" || (r.knights && kind === "assassination")) {
      var hint =
        r.knights && kind === "assassination"
          ? "选择线下多数决议的红方带刀人（平票先猜拳）；由本人录入目标或空刀。提前起刀只能在发言环节。"
          : kind === "vote"
            ? "可选队伍，也可直接发起全员投票。"
            : "选择任务队员。";
      html +=
        '<div class="small muted">' +
        esc(hint) +
        '</div><div class="tool-seat-scroll"><div class="tool-seat-grid">';
      for (var i = 0; i < state.toolPlayers.length; i++) {
        var p = state.toolPlayers[i];
        html +=
          '<button type="button" class="tool-seat-option' +
          (p.selected ? " active" : "") +
          '" data-action="toggleToolSeat" data-seat="' +
          p.seat +
          '"' +
          (state.busy ? " disabled" : "") +
          ">" +
          p.seat +
          "号 · " +
          esc(p.name) +
          "</button>";
      }
      html += "</div></div><div class=\"small muted\">已选 " + state.toolSeats.length + " 人</div>";
      if (kind === "quest") {
        html +=
          '<div class="quest-threshold"><div class="label">失败票门槛</div><div class="threshold-options">' +
          btn("tool-seat-option" + (state.toolThreshold === 1 ? " active" : ""), "pickToolThreshold", (state.toolThreshold === 1 ? "✓ " : "") + "1 张", { value: 1 }, state.busy) +
          btn("tool-seat-option" + (state.toolThreshold === 2 ? " active" : ""), "pickToolThreshold", (state.toolThreshold === 2 ? "✓ " : "") + "2 张", { value: 2 }, state.busy) +
          '</div><div class="small muted">至少 ' +
          state.toolThreshold +
          " 张失败票，任务才失败</div>" +
          (state.toolSeats.length > 0 && state.toolSeats.length < state.toolThreshold
            ? '<div class="small threshold-hint">请至少选择 ' + state.toolThreshold + " 名任务队员</div>"
            : "") +
          "</div>";
      }
    } else {
      var desc = state.toolDescription
        ? state.toolDescription
        : kind === "offline"
          ? "线下刀人后，由房主记录完成。"
          : kind === "reverseStrike"
            ? "刺客选择逆仆，结果私密。"
            : "刺客选择梅林，结算后公开是否命中。";
      html += '<div class="dialog-message">' + esc(desc) + "</div>";
    }
    html +=
      '<div class="dialog-actions">' +
      btn("secondary", "closeTool", "取消", null, state.busy) +
      btn("primary", "launchTool", "发起", null, state.busy || (kind === "quest" && state.toolSeats.length < state.toolThreshold)) +
      "</div></div></div>";
    return html;
  }
  function viewEntry() {
    var active = state.memberRooms.filter(r => r.status === 'playing' && r.available !== false);
    var html = (active.length ? '<div class="resume-section"><span class="eyebrow">正在进行</span>' + active.map(r => '<button type="button" class="resume-room" data-action="openRoom" data-code="' + esc(r.code) + '"><span><span>继续对局 · ' + esc(r.code) + '</span><span class="small muted link-note">' + esc(r.boardName) + ' · ' + r.capacity + '人</span></span><span aria-hidden="true">→</span></button>').join('') + '</div>' : '') +
      '<div class="lobby-heading"><h1 class="page-title" tabindex="-1" data-page-heading>今晚，开一桌。</h1></div>';
    html +=
      '<form class="panel entry-panel"><label class="label" for="nickname">' + (needsNicknameSetup() ? '玩家昵称' : '本桌昵称') + '</label>' +
      '<input class="input" id="nickname" name="nickname" maxlength="16" data-input="name" value="' +
      esc(state.name) +
      '" placeholder="' + (needsNicknameSetup() ? '填写玩家昵称' : '使用个人昵称，也可为本桌修改') + '"' + (state.busy ? ' disabled' : '') + ' />' +
      (needsNicknameSetup() ? '<div class="small muted">用于牌桌和排行榜，可在“我的”中修改。</div>' : '') +
      '<div class="entry-tabs">' +
      btn("entry-tab" + (state.entryMode !== "join" ? " active" : ""), "switchEntry", "创建房间", { mode: "create" }, state.busy) +
      btn("entry-tab" + (state.entryMode === "join" ? " active" : ""), "switchEntry", "加入房间", { mode: "join" }, state.busy) +
      "</div>";
    if (state.entryMode !== "join") {
      html += '<div class="field-title">人数</div>';
      html += '<select class="input" data-change="entryCapacity">';
      for (var i = 0; i < state.capacities.length; i++) {
        var n = state.capacities[i];
        html +=
          '<option value="' +
          n +
          '"' +
          (state.capacity === n ? " selected" : "") +
          ">" +
          n +
          "人</option>";
      }
      html += "</select>";
      html += '<div class="field-title">板子</div>';
      if (state.availableBoards.length === 1)
        html += '<div class="single-board">' + esc(state.boardName) + "</div>";
      else {
        html += '<select class="input" data-change="entryBoard">';
        for (var j = 0; j < state.availableBoards.length; j++) {
          var b = state.availableBoards[j];
          html +=
            '<option value="' +
            esc(b.id) +
            '"' +
            (state.boardId === b.id ? " selected" : "") +
            ">" +
            esc((b.namesByCapacity || {})[state.capacity] || b.name) +
            "</option>";
        }
        html += "</select>";
      }
      html +=
        btn("text-button rules-toggle", "toggleRules", state.showRules ? "收起配置" : "角色配置") +
        (state.showRules
          ? '<div class="rules-detail">' +
            state.boardRoleConfiguration
              .map(function (r) {
                return (
                  '<div class="role-line">' + esc(r.label) + "：" + esc(r.roles) + "</div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        btn("primary", "create", (needsNicknameSetup() ? "确认昵称并创建 " : "创建 ") + state.capacity + " 人房间", null, state.loading || state.busy);
    } else {
      html +=
        '<label class="field-title" for="code">房间码</label>' +
        '<input class="input room-input" id="code" name="code" inputmode="numeric" maxlength="6" data-input="code" value="' +
        esc(state.code) +
        '" placeholder="输入6位房间码" />' +
        btn("primary", "join", needsNicknameSetup() ? "确认昵称并加入房间" : "加入房间", null, state.loading || state.busy);
    }
    html += "</form>";

    html += '<div class="section-title history-heading"><span>我的牌桌' + (state.memberRooms.length ? '<span class="room-count">' + state.memberRooms.length + '</span>' : '') + '</span>' + btn("history-toggle room-refresh", "refreshRooms", state.roomsRefreshing ? "刷新中…" : "刷新", null, state.busy || state.loading || state.roomsRefreshing || !!pending) + '</div>';
    if (state.memberRooms.length >= 6 || state.roomListFilter !== "all") {
      html += '<div class="room-filters">' + [["all","全部"],["playing","进行中"],["lobby","待开局"],["ended","已结束"],["unavailable","已失效"]].map(function (f) {
        return '<button type="button" class="room-filter ' + (state.roomListFilter === f[0] ? 'active' : '') + '" data-action="filterRooms" data-filter="' + f[0] + '" aria-pressed="' + (state.roomListFilter === f[0]) + '">' + f[1] + '</button>';
      }).join('') + '</div>';
    }
    if (state.undoRoom) html += '<div class="room-undo" role="status"><span>已从列表移除 ' + esc(state.undoRoom.code) + '</span>' + btn("history-toggle", "undoRemoveRoom", "撤销", null, state.busy || !!pending) + '</div>';
    var visible = state.memberRooms.filter(function (r) { return state.roomListFilter === "all" || r.status === state.roomListFilter; });
    visible.forEach(function (m) {
      html += '<div class="member-room room-list-item ' + (m.available === false ? 'is-unavailable' : '') + '"><button type="button" class="room-list-open" data-action="openRoom" data-code="' + esc(m.code) + '"' + (state.busy || state.loading || pending || m.available === false ? ' disabled' : '') + '><span class="room-list-top"><span class="room-list-title">' + esc(m.note || '房间 ' + m.code) + '</span><span class="room-status ' + esc(m.status) + '">' + esc(m.statusLabel) + '</span></span>' +
        (m.note ? '<span class="small muted">房间 ' + esc(m.code) + '</span>' : '') + '<span class="room-list-board">' + esc(m.boardName) + ' · ' + esc(m.peopleLabel) + '</span><span class="room-list-meta"><span class="room-host-name">房主：' + esc(m.hostName || '未知') + '</span><span>' + esc(m.relationLabel) + '</span></span><span class="room-list-time">最近活动 ' + esc(m.activityLabel) + '</span></button>' +
        '<button type="button" class="room-more" data-action="openRoomMenu" data-code="' + esc(m.code) + '" aria-label="管理房间' + esc(m.code) + '的个人记录"' + (state.busy || state.loading || pending ? ' disabled' : '') + '>⋯</button></div>';
    });
    if (!state.memberRooms.length && !state.loading) html += '<div class="room-empty"><div>还没有牌桌</div><div class="room-empty-actions">' + btn("secondary","switchEntry","加入房间",{mode:"join",scroll:"true"},state.busy || !!pending) + btn("secondary","switchEntry","创建房间",{mode:"create",scroll:"true"},state.busy || !!pending) + '</div></div>';
    else if (!visible.length) html += '<div class="room-empty">没有符合条件的牌桌' + btn("history-toggle","filterRooms","查看全部",{filter:"all"}) + '</div>';
    if (state.roomMenu && !state.error) {
      var m = state.roomMenu, locked = state.busy || !!pending;
      html += '<div class="dialog-backdrop"><div class="error-dialog room-list-dialog room-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="room-menu-title" aria-describedby="room-menu-code"><div class="room-menu-header"><div id="room-menu-title" class="room-menu-heading">房间管理</div><div id="room-menu-code" class="room-menu-code">房间 ' + esc(m.code) + '</div></div><div class="room-menu-options">' +
        roomMenuButton("hide", "从列表移除", "", locked) +
        (m.available !== false && m.isMember ? roomMenuButton("leave", "离开房间", m.canLeave ? "" : m.canLeave === false ? "当前状态暂不可离开" : "离开权限暂未同步", locked || !m.canLeave) : '') + '</div>' +
        (m.available !== false && m.isHost ? roomMenuButton("delete", "解散房间", "", locked) : '') +
        btn("secondary room-menu-cancel","closeRoomMenu","取消",null,locked) + '</div></div>';
    }
    if (state.noteRoom && !state.error) html += '<div class="dialog-backdrop"><div class="error-dialog room-list-dialog" role="dialog" aria-modal="true" aria-label="个人备注"><div class="dialog-title">个人备注 · ' + esc(state.noteRoom.code) + '</div><label for="room-note" class="small muted">仅你可见，最多30字；留空可清除</label><input id="room-note" class="input" data-input="roomNote" maxlength="30" placeholder="例如：周五朋友局" value="' + esc(state.roomNoteDraft) + '"' + (state.busy || pending ? ' disabled' : '') + ' /><div class="dialog-actions">' + btn("secondary","closeRoomMenu","取消",null,state.busy || !!pending) + btn("primary","saveRoomNote","保存",null,state.busy || !!pending) + '</div></div></div>';
    return html;
  }
  function viewRoom() {
    var r = state.room;
    var html = "";
    html +=
      '<div class="room-summary"><button type="button" class="copy-room" data-action="copyRoomCode"><span>房间 ' +
      esc(r.code) +
      '</span><span class="copy-label">复制</span></button><div class="summary-right">' +
      (r.phase !== "lobby" && r.me.seat !== null
        ? '<div class="room-identity-anchor">' + btn("room-identity" + (state.identityHintVisible ? " identity-entry-highlight" : ""), "reveal", r.me.seat + "号 · " + (state.revealed ? "遮盖身份" : "我的身份 ›"), null, !state.revealed && (state.busy || !state.network)) +
          (state.identityHintVisible && !state.dealtIdentityDialog && !identityOverlayBlocked() ? '<div class="identity-entry-hint"><span role="status">随时点这里，查看身份与视野。</span><button type="button" class="identity-hint-close" data-action="dismissIdentityHint" aria-label="关闭身份入口提示">×</button></div>' : '') + '</div>'
        : '<span class="summary-seat">' + (r.me.seat != null ? "你在 " + r.me.seat + " 号" : "") + '</span>') +
      "</div></div>";
    html +=
      '<div class="row subline room-subline"><div class="room-board-info">' +
      (r.testRoom ? '<span class="small room-test-label">测试房间 · 陪测已开启</span>' : "") +
      '<span class="room-board-name">' +
      esc(r.boardName) +
      " · " +
      r.capacity +
      '人</span><button type="button" class="room-rules-button" data-action="openRoomRules">配置说明</button></div>' +
      (r.me.isHost
        ? '<button type="button" class="room-rules-button" data-action="toggleRoomSettings">房间设置</button>'
        : "") +
      '<button type="button" class="room-rules-button" data-action="copyInviteLink">邀请</button></div>';
    if (state.showRoomRules) {
      html +=
        '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
        '<div class="dialog-title">角色配置</div><div class="small muted">' +
        esc(r.boardName) +
        " · " +
        r.capacity +
        '人</div><div class="configuration-roles">' +
        (r.roleConfiguration || [])
          .map(function (x) {
            return (
              '<div class="role-line">' + esc(x.label) + "：" + esc(x.roles) + "</div>"
            );
          })
          .join("") +
        "</div>" +
        '<div class="dialog-actions">' +
        btn("secondary", "openBoardDetails", "板子详情") +
        btn("primary", "closeRoomRules", "知道了") +
        "</div></div></div>";
    }
    if (r.phase !== "lobby" && r.me.seat !== null) {
      if (state.revealed && state.secret)
        html +=
          '<div class="identity open"><div class="identity-title faction-' +
          (state.secret.factionTone || "") +
          '">' +
          esc(state.secret.role) +
          '</div><span class="muted">' +
          esc(state.secret.faction) +
          '</span><div class="private-info">' +
          esc(state.secret.information) +
          (state.secret.outcome
            ? '<span class="label">' + esc(state.secret.outcome) + "</span>"
            : "") +
          "</div>" +
          viewSkillStatus(state.secret) +
          btn("secondary", "reveal", "立即遮盖") +
          "</div>";
    }
    var operationFirst = !["tools", "ended", "lobby"].includes(r.phase);
    var phaseHtml =
      '<div class="phase-strip"><div class="phase-heading"><span class="phase-label">当前阶段</span><span class="phase-name">' +
      esc(r.phaseName) +
      "</span></div>" +
      (!r.flexible && (r.round || r.leader)
        ? '<div class="phase-detail">' +
          (r.round ? "<span>任务 " + r.round + "</span>" : "") +
          (r.leader
            ? "<span>队长 " + r.leader + " 号 · 连续否决 " + r.rejects + " / 5</span>"
            : "") +
          "</div>"
        : "");
      if (
        r.phase === "teamVote" ||
        r.phase === "quest" ||
        r.phase === "teamResult"
      )
        phaseHtml +=
          '<div class="phase-team"><span class="label">' +
          (r.team.length ? "任务队伍 " + esc(state.teamText) + " 号" : "全员投票") +
          '</span><span class="muted">' +
          (r.phase === "teamVote" ? "全员表决，结算后公开票型" : "仅公开票数，不公开出牌人") +
          "</span></div>";
    if (r.operationStatus || r.needsSubmission)
      phaseHtml +=
        '<div class="action-entry" role="status"><div class="action-status-copy"><div>' +
        esc(r.operationStatus ? r.operationStatus.title : r.me.submitted ? "已提交，等待其他玩家" : "请完成本次操作") +
        '</div><div class="small muted">' + esc(r.operationStatus ? r.operationStatus.detail : "") + '</div></div>' +
        (r.needsSubmission && !r.me.submitted
          ? btn("primary", "openAction", "立即操作", null, state.busy || state.actionLoading || !state.network)
          : "") +
        "</div>";
    phaseHtml += "</div>";
    var resultHtml = "";
    if (state.latestResult && ["tools", "ended"].includes(r.phase)) {
      var latest = state.latestResult;
      resultHtml += '<div class="latest-result" role="status" aria-label="最近操作结果"><div class="result-summary-heading"><span class="small muted">最近结果</span>' + btn("history-toggle", "showLatestRecord", "查看记录 ›") + '</div><div class="latest-result-title result-heading">' + resultIcon(latest.resultTone) + '<span>' + esc(latest.resultRows ? "技能最终结果" : latest.text) + '</span>' + (latest.resultTeam ? '<span class="result-team">队伍 ' + esc(latest.resultTeam) + '</span>' : '') + '</div>';
      if (latest.resultRows) {
        if (latest.historyNote) resultHtml += '<div class="latest-result-note small muted">' + esc(latest.historyNote) + '</div>';
        resultHtml += '<div class="history-result-rows">' + latest.resultRows.map(function (row) { return '<div class="history-result-line' + (row.final ? ' is-final' : '') + '"><span class="history-result-label">' + esc(row.label) + '</span><span class="history-result-value">' + esc(row.value) + '</span></div>'; }).join('') + '</div>';
      } else resultHtml += '<div class="history-detail">' + esc(latest.latestDetail || latest.detail) + '</div>';
      resultHtml += '</div>';
    }
    html += '<div class="table-dynamics ' + (r.phase === "lobby" ? 'is-lobby' : operationFirst ? 'operation-first' : 'result-first') + '">' + resultHtml + phaseHtml + '</div>';
    if (r.recordNotice) html += '<div class="small muted">' + esc(r.recordNotice) + '</div>';
    if (r.scoreSettings) html += '<div class="small muted">' + esc(r.scoreNotice || (r.scoreSettings.enabled ? '本局计分已开启' : '本局计分已关闭')) + '</div>';
    if (r.phase === "lobby") {
      html +=
        '<div class="panel"><span class="muted small">' +
        esc(state.startHint) +
        "</span>" +
        (r.me.seat !== null ? btn("primary", "ready", r.me.ready ? "取消准备" : "我准备好了", null, state.busy) : "") +
        (r.me.isHost
          ? btn("secondary", "start", "发放身份", null, state.busy || !state.network || !state.canStart)
          : "") +
        "</div>";
    }
    if (r.canUseTools) {
      html +=
        '<div class="panel host-panel"><div class="label">房主操作</div>' +
        (r.knights
          ? '<div class="small muted">第' +
            r.knights.round +
            "轮 · B牌剩余" +
            r.knights.remainingCards +
            '张</div>'
          : "") +
        '<div class="tool-actions">' +
        btn("secondary", "openTool", "投票", { kind: "vote" }, state.busy) +
        btn("secondary", "openTool", "做任务", { kind: "quest" }, state.busy) +
        (r.knights
          ? btn("secondary", "openTool", "使用技能", { kind: "skills" }, state.busy) +
            btn("secondary", "openTool", "身份转换", { kind: "conversion" }, state.busy)
          : "") +
        (r.fairyEnabled ? btn("secondary", "openTool", "仙女查验", { kind: "fairy" }, state.busy) : "") +
        (r.hasReverse && !r.knifeOffline
          ? btn("secondary", "openTool", "刀逆仆", { kind: "reverseStrike" }, state.busy)
          : "") +
        "</div>";
      if (r.operationProgress) {
        html +=
          '<div class="operation-progress"><button type="button" class="progress-heading progress-toggle" data-action="toggleOperationProgress" aria-expanded="' + !!state.operationProgressExpanded + '"><span class="progress-title">当前操作进度</span><span class="progress-count">' +
          r.operationProgress.completed +
          " / " +
          r.operationProgress.total +
          ' 已完成</span><span class="progress-disclosure">' + (state.operationProgressExpanded ? "收起 ⌃" : "展开 ⌄") + '</span></button>';
        for (var q = 0; q < (r.operationProgress.players || []).length; q++) {
          var pp = r.operationProgress.players[q];
          if (!state.operationProgressExpanded || !pp.required) continue;
          html +=
            '<div class="progress-player"><span class="progress-player-name">' +
            pp.seat +
            "号 · " +
            esc(pp.name) +
            '</span><span class="progress-state' +
            (pp.completed ? " completed" : "") +
            '">' +
            (pp.completed ? "已完成" : "未完成") +
            "</span></div>";
        }
        html += "</div>";
      }
      html += "</div>";
    }
    var quests = r.phase === "lobby" ? [] : state.history.filter(function (h) { return h.questResult; });
    html += '<div class="task-progress"><div class="section-title history-heading"><span class="seat-section-title"><span>' + (quests.length ? '任务进度' : '玩家与座位') + '</span>' +
      (r.phase === 'lobby' ? '<span class="seat-count" aria-label="已入座' + state.seatOccupiedCount + '人，共' + r.capacity + '个座位">' + state.seatOccupiedCount + '/' + r.capacity + '</span>' : '') + '</span>' +
      (r.phase === "lobby" ? '' : '<button type="button" class="history-toggle" data-action="toggleSeats" aria-expanded="' + !!state.seatsExpanded + '">' + (state.seatsExpanded ? "收起座位" : "座位（" + r.capacity + "）⌄") + '</button>') + '</div>';
    if (r.phase === 'lobby') html += '<div class="seat-section-caption"><span class="seat-ready-count">已准备 ' + state.seatReadyCount + '/' + state.seatOccupiedCount + '</span><span>点自己站起，点空位坐下</span></div>';
    if (quests.length) html += '<div class="quest-timeline">' + quests.map(function (h, i) {
      return btn("quest-step " + h.questResult, "showQuestRecord", "第" + (i + 1) + "次 · " + (h.questResult === "success" ? "✓ 成功" : "× 失败"), { key: h.key });
    }).join("") + '</div>';
    html += '</div>';
    if (r.phase === "lobby" || state.seatsExpanded) {
    html += '<div class="seats' + (r.capacity >= 10 ? ' seats-compact' : '') + '">';
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      html +=
        '<button type="button" class="seat' +
        (s.occupied ? "" : " seat-empty") +
        (s.mine ? " mine" : "") +
        (s.inTeam ? " team" : "") +
        (s.selected ? " selected" : "") +
        '" data-action="seat" data-seat="' +
        s.seat +
        '"' +
        ' aria-label="' + esc(s.seat + '号，' + s.name + (s.mine ? '，你的座位' : '') + (s.host ? '，房主' : '') + (s.alive === false ? '，已出局' : '') + (s.selected ? '，已选入队' : s.inTeam ? '，任务队员' : '') + (r.fairyHolder === s.seat ? '，湖仙' : '') + (r.phase === 'lobby' ? '，' + seatMeta(s) : '')) + '"' +
        ' aria-description="' + (r.phase === 'lobby' && s.mine ? '点击站起围观' : s.occupied ? '点击查看战绩' : r.phase === 'lobby' ? '点击入座' : '空位') + '"' +
        (seatDisabled(s) ? " disabled" : "") +
        '><span class="seat-head"><span class="seat-number">' +
        s.seat +
        '号</span>' + (s.mine ? '<span class="seat-self">你</span>' : '') + '</span>';
      if (s.occupied) {
        html += '<span class="seat-player"><span class="seat-avatar" aria-hidden="true"><span class="seat-avatar-fallback">' + esc(s.avatarInitial) + '</span>' +
        (s.avatarUrl && !s.avatarFailed ? '<img class="seat-avatar-image" src="' + esc(s.avatarUrl) + '" alt="" data-seat="' + s.seat + '" data-seat-avatar-url="' + esc(s.avatarUrl) + '" />' : '') +
        '</span><span class="seat-name">' + esc(s.name) + '</span></span><span class="seat-meta">' +
        (seatMeta(s) ? '<span class="seat-status' + (r.phase === 'lobby' && s.ready ? ' seat-ready' : '') + '">' + esc(seatMeta(s)) + '</span>' : '') +
        (s.host || s.alive === false || r.fairyHolder === s.seat ? '<span class="seat-tags">' +
          (s.host ? '<span class="seat-flag">房主</span>' : '') +
          (s.alive === false ? '<span class="seat-out">已出局</span>' : '') +
          (r.fairyHolder === s.seat ? '<span class="seat-fairy">湖仙</span>' : '') + '</span>' : '') +
        '</span>';
      } else {
        html += '<span class="seat-empty-body"><span class="seat-empty-mark" aria-hidden="true">+</span><span class="seat-empty-label">' + (r.phase === 'lobby' ? '点击入座' : '空位') + '</span></span>';
      }
      html += '</button>';
    }
    html += "</div>";
    }
    if (r.phase === "lobby") {
      html += btn("leave-button", "leave", "离开房间", null, state.busy);
    } else {
      if (r.me.seat === null && !r.me.isHost)
        html += btn("leave-button", "leave", "离开房间", null, state.busy);
      if (r.phase === "proposal" && !r.canUseTools && !r.flexible)
        html +=
          '<div class="panel"><div class="label">本轮需要 ' +
          r.teamSize +
          ' 人</div><span class="muted">' +
          (r.leader === r.me.seat ? "在下方选择队员，再提交队伍" : "等待队长选人") +
          '</span><div class="team-line">当前队伍：' +
          esc(state.teamText) +
          "</div>" +
          (r.leader === r.me.seat
            ? '<div class="proposal-player-options">' + r.players.map(p => btn(state.selected.includes(p.seat) ? 'selected' : '', 'toggleProposalSeat', p.seat + '号 · ' + p.name + (state.selected.includes(p.seat) ? ' ✓' : ''), { seat: p.seat }, state.busy || state.hasPendingRequest || !state.network)).join('') + '</div>' + btn(
                "primary",
                "propose",
                "提交队伍（已选 " + state.selected.length + " / " + r.teamSize + "）",
                null,
                state.busy || state.selected.length !== r.teamSize,
              )
            : "") +
          "</div>";
      if (r.result) {
        var resultCls =
          r.result.winner === "good"
            ? "result-good"
            : r.result.winner === "evil"
              ? "result-evil"
              : "result-neutral";
        var kicker = r.result.winner
          ? "最终结果"
          : (r.flexible || r.assisted || r.offlineAssassination) && r.phase === "ended"
            ? "线下结算完毕"
            : "本局终止";
        var resultTitle =
          r.result.winner === "good"
            ? "好人获胜"
            : r.result.winner === "evil"
              ? "坏人获胜"
              : r.result.winner === "third" ? "盗贼阵营获胜" : (r.flexible || r.assisted || r.offlineAssassination) && r.phase === "ended"
                ? "以线下结算为准"
                : "不判胜负";
        html +=
          '<div class="result ' +
          resultCls +
          '"><span class="kicker">' +
          esc(kicker) +
          '</span><div class="phase-title">' +
          esc(resultTitle) +
          "</div><span>" +
          esc(r.result.reason || "") +
          "</span>" +
          '<div class="small muted">' + (r.result.source === "manual" ? "房主登记" : r.result.source === "system" ? "系统判定" : "") + "</div>" +
          (r.myFun?.hasEffectiveHighlights && r.phase === "ended" ? viewFunStory(r.myFun) + btn("text-button","navigate","查看趣味统计 ›",{page:"stats?tab=fun"}) : "") +
          (r.myScore ? viewScoreBreakdown(r.myScore) + btn("text-button", "scoreRecords", "查看积分明细 ›") : "") +
          (r.me.isHost
            ? btn("primary", "rematch", "同房再开一局", null, state.busy)
            : '<span class="muted">等待房主开启下一局</span>') +
          "</div>";
      }
      if (r.phase === "offlineFinal")
        html +=
          '<div class="panel"><span class="label">' +
          (r.offlineAssassination ? "请莫德雷德线下刺梅林" : "请线下完成特殊结算") +
          '</span><span class="muted">' +
          (r.offlineAssassination
            ? "三次任务已成功，请在线下完成刺梅林并确认胜负。"
            : "任务记录已保留。起刀、内奸及最终胜负在线下完成，本系统不自动判定。") +
          "</span>" +
          (r.me.isHost
            ? btn("primary", "closeOffline", "线下已完成，记录结果", null, state.busy)
            : "") +
          "</div>";
      if (state.history.length) html += '<div class="section-title">公开记录 · 共' + state.history.length + '条</div>';
      var visibleHistory = state.history.slice(state.historyExpanded ? 0 : -3).reverse();
      for (var hh = 0; hh < visibleHistory.length; hh++) {
        var h = visibleHistory[hh];
        html += '<div id="history-record-' + h.key + '" tabindex="-1" class="' + (state.focusedHistoryKey === h.key ? 'history-row history-row-focused' : 'history-row') + '"><div class="history-heading-line"><div class="history-title">' + resultIcon(h.resultTone) + '<span>' + esc(h.historyText || h.text) + '</span>' + (h.timeLabel ? '<span class="history-time">' + esc(h.timeLabel) + '</span>' : '') + '</div><span class="history-number">#' + (h.key + 1) + '</span></div>';
        if (h.historyNote) html += '<div class="small muted history-subtitle">' + esc(h.historyNote) + '</div>';
        if (h.teamLabel) html += '<div class="result-team">队伍 ' + esc(h.teamLabel) + '</div>';
        if (h.resultRows) html += '<div class="history-result-rows">' + h.resultRows.map(function (row) { return '<div class="history-result-line' + (row.final ? ' is-final' : '') + '"><span class="history-result-label">' + esc(row.label) + '</span><span class="history-result-value">' + esc(row.value) + '</span></div>'; }).join('') + '</div>';
        if (h.voteGroups) {
          html += h.voteGroups
            .map(function (g) {
              return (
                '<div class="history-vote-line"><div class="history-vote-count ' +
                g.tone +
                '"><span class="history-count">' +
                g.count +
                "</span><span>票" +
                esc(g.label) +
                '</span></div><div class="history-vote-seats">' +
                esc(g.seats) +
                "</div></div>"
              );
            })
            .join("");
        } else if (h.cards) {
          html +=
            '<div class="history-cards">' +
            h.cards
              .map(function (c) {
                return (
                  '<div class="history-card-count"><span>' +
                  esc(c.label) +
                  '</span><span class="history-count ' + esc(c.tone || "") + '">' +
                  c.count +
                  "</span><span>张</span></div>"
                );
              })
              .join("") +
            "</div>";
        } else if (h.detail && !h.resultRows)
          html += '<div class="muted small history-detail">' + esc(h.detail) + "</div>";
        html += "</div>";
      }
      if (state.history.length > 3) html += '<button type="button" class="history-more" data-action="toggleHistory" aria-expanded="' + !!state.historyExpanded + '" aria-label="' + (state.historyExpanded ? '收起记录' : '展开更早的 ' + (state.history.length - 3) + ' 条记录') + '"><span class="history-more-label">' + (state.historyExpanded ? '收起记录' : '更早记录') + '</span><span class="history-more-chevron' + (state.historyExpanded ? ' is-expanded' : '') + '" aria-hidden="true"></span></button>';
    }
    if (r.canUseTools)
      html +=
        '<div class="finish-game-footer">' +
        btn("finish-game-button", "finishTools", "结束本局", null, state.busy) +
        "</div>";
    html += viewHostBar();
    return html;
  }
  function resultIcon(tone) {
    return tone ? '<span class="quest-result-icon ' + tone + '" aria-hidden="true">' + (tone === "success" ? "✓" : "×") + '</span>' : '';
  }
  function viewHostBar() {
    var r = state.room;
    if (!r.canUseTools || !r.hasActiveOperation || r.phase === "offlineFinal")
      return "";
    if (r.closeWaiting) return '<div class="host-action-bar"><div class="host-action-bar-inner has-waiting"><div class="host-waiting-copy small muted">' + esc(state.settleHint) + '<div>收齐自动结算</div></div>' +
      btn("secondary bar-cancel bar-cutoff", "closeWaiting", r.closeWaiting.label || "结束等待", null, state.busy || !state.network) +
      (r.closeWaiting.mode !== "cancel" ? btn("secondary bar-cancel", "cancelTool", "作废", null, state.busy || !state.network) : "") + '</div></div>';
    return (
      '<div class="host-action-bar"><div class="host-action-bar-inner">' +
      btn(
        "primary bar-settle",
        "settleTool",
        state.canSettle ? "结算当前操作" : state.settleHint,
        null,
        state.busy || !state.network || !state.canSettle,
      ) +
      btn("secondary bar-cancel", "cancelTool", "作废", null, state.busy) +
      "</div></div>"
    );
  }
  function viewSettingsDialog() {
    if (!state.showRoomSettings || !state.settings) return "";
    var s = state.settings;
    var html =
      '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">房间设置</div>';
    if (s.loading) html += '<div class="muted settings-loading">正在加载房间设置…</div>';
    else if (s.error)
      html +=
        '<div class="settings-error">' +
        esc(s.error) +
        '</div><div class="dialog-actions">' +
        (s.pendingKick ? btn("secondary", "retryKick", "重试确认移出结果", null, s.busy) : (s.pendingSave || s.dirty) && s.authorized ? btn("secondary", "settingsSave", "重试保存", null, s.busy) : btn("secondary", "retrySettings", "重新加载")) +
        btn("secondary", "settingsBack", "返回牌桌", null, s.busy) +
        "</div>";
    else if (s.authorized && s.room) {
      var room = s.room;
      html +=
        '<div class="settings-header"><div class="settings-eyebrow">房间 ' +
        esc(room.code) +
        ' · 管理员</div><div class="settings-title">' +
        esc(room.boardName) +
        '</div><div class="muted">' +
        room.capacity +
        "人 · " +
        (room.phase === "lobby" ? "准备中" : room.phase === "ended" ? "本局已结束" : room.phase === "terminated" ? "本局已终止" : "对局进行中") +
        "</div></div>";
      if (s.pendingSave || s.dirty) html += '<div class="settings-caption" role="status">' + (s.pendingSave ? (s.busy ? '正在保存…' : '保存未确认') : '尚未保存') + '</div>';
      if (s.pendingSave && !s.busy) html += btn("secondary", "settingsSave", "重试保存");
      html += '<div class="settings-section-title">房间配置</div><div class="settings-section">';
      if (room.phase === "lobby") {
        html +=
          '<div class="settings-row"><span>人数</span><select class="settings-select" data-change="settingsCapacity"' +
          (s.busy || s.pendingKick || s.pendingSave ? " disabled" : "") +
          ">";
        for (var i = 0; i < s.capacities.length; i++)
          html +=
            '<option value="' +
            s.capacities[i] +
            '"' +
            (s.capacity === s.capacities[i] ? " selected" : "") +
            ">" +
            s.capacities[i] +
            " 人</option>";
        html += "</select></div>";
        html +=
          '<div class="settings-row"><span>板子</span><select class="settings-select" data-change="settingsBoard"' +
          (s.busy || s.pendingKick || s.pendingSave ? " disabled" : "") +
          ">";
        for (var j = 0; j < s.choices.length; j++)
          html +=
            '<option value="' +
            esc(s.choices[j].id) +
            '"' +
            (s.boardId === s.choices[j].id ? " selected" : "") +
            ">" +
            esc(s.choices[j].name) +
            "</option>";
        html += "</select></div>";
      } else {
        html +=
          '<div class="settings-row"><span>人数</span><span class="muted">' +
          room.capacity +
          ' 人</span></div><div class="settings-row"><span>板子</span><span class="muted">' +
          esc(room.boardName) +
          "</span></div>";
      }
      html += "</div>";
      if (room.recordSettings) html += '<div class="settings-section-title">对局用途</div><div class="settings-section"><label class="settings-row fairy-setting"><span><span>仅测试，不计战绩</span><span class="settings-caption">保留对局记录，不计入胜率、积分和趣味统计。' + (room.recordSettings.editable ? '发牌后固定' : '本局设置已固定') + '</span></span><input type="checkbox" aria-label="仅测试，不计战绩" data-change="settingsRecordPurpose"' + (s.recordPurpose === "test" ? ' checked' : '') + (settingsLocked() || !room.recordSettings.editable ? ' disabled' : '') + ' /></label></div>';
      if (room.scoreSettings) html += '<div class="settings-section-title">积分</div><div class="settings-section"><label class="settings-row fairy-setting"><span><span>本局计分</span><span class="settings-caption">' +
        esc(room.scoreSettings.unavailableReason || (s.scoreEnabled ? '已开启' : '已关闭')) + ' · ' + (room.scoreSettings.editable ? '发牌后固定' : '本局设置已固定') +
        '</span></span><input type="checkbox" aria-label="本局计分" data-change="settingsScoring"' + (s.scoreEnabled ? ' checked' : '') +
        (settingsLocked() || !room.scoreSettings.editable ? ' disabled' : '') + ' /></label></div>';
      html += '<div class="settings-section-title">湖中仙女</div><div class="settings-section"><label class="settings-row fairy-setting"><span><span>启用湖中仙女</span><span class="settings-caption">' +
        (s.capacity < 7 ? "5、6人局不支持" : s.fairyEnabled ? "持有者对所有玩家公开" : "本房间不使用仙女查验") +
        '</span></span><input type="checkbox" aria-label="启用湖中仙女" data-change="settingsFairy"' +
        (s.fairyEnabled ? " checked" : "") +
        (s.busy || s.pendingKick || s.pendingSave || s.capacity < 7 || room.phase === "fairy" ? " disabled" : "") +
        ' /></label></div>' +
        (room.phase === "fairy" ? '<div class="settings-help">请先完成或作废当前查验。</div>' : '');
      if (["knights", "knights-10", "knights-11", "knights-13"].includes(s.boardId)) {
        html +=
          '<div class="settings-section-title">信息公开</div><div class="settings-section"><div class="settings-row"><span><span>公开技能过程</span><span class="settings-caption">' +
          (s.visible ? "所有玩家可见" : "仅公示最终结果") +
          "</span></span>" +
          '<input type="checkbox" data-change="settingsVisibility"' +
          (s.visible ? " checked" : "") +
          (s.busy || s.pendingKick || s.pendingSave ? " disabled" : "") +
          ' /></div></div>';
      }
      var transfers = room.players.filter(function (p) {
        return p.seat !== room.me.seat;
      });
      html += '<div class="transfer-entry"><select class="secondary" data-change="settingsTransfer"' +
        (s.busy || s.pendingKick || s.pendingSave || !transfers.length ? " disabled" : "") + '><option value="" disabled selected>移交房主</option>';
      transfers.forEach(function (player) {
        html += '<option value="' + player.seat + '">' + player.seat + '号 · ' + esc(player.name) + '</option>';
      });
      html += '</select>' + (!transfers.length ? '<div class="settings-help">暂无可移交的玩家</div>' : '') + '</div>';
      html += '<div class="transfer-entry"><select class="secondary kick-entry" data-change="settingsKick"' +
        (s.busy || s.pendingKick || s.pendingSave || !room.canKick || !transfers.length ? " disabled" : "") + '><option value="" disabled selected>移出玩家</option>';
      transfers.forEach(function (player) {
        html += '<option value="' + player.seat + '">' + player.seat + '号 · ' + esc(player.name) + '</option>';
      });
      html += '</select>' + (!room.canKick || !transfers.length ? '<div class="settings-help">' + (typeof room.canKick !== 'boolean' ? '暂不支持移出玩家' : !room.canKick ? '对局进行中不能移出玩家' : '暂无可移出的玩家') + '</div>' : '') + '</div>';
      if (s.pendingKick) html += btn("secondary", "retryKick", "重试确认移出结果", null, s.busy);
      html +=
        '<div class="settings-footer">' +
        btn("text-button", "settingsBack", "返回牌桌", null, s.busy) +
        "</div>";
    } else
      html +=
        '<div class="dialog-actions">' +
        btn("secondary", "retrySettings", "重新加载") +
        btn("secondary", "settingsBack", "返回牌桌") +
        "</div>";
    html += "</div></div>";
    return html;
  }
  function detailText(text) {
    var split = text.indexOf("：");
    return split > 0 && split <= 24
      ? "<strong>" + esc(text.slice(0, split)) + "</strong>：" + esc(text.slice(split + 1))
      : esc(text);
  }
  function viewBoardDetails() {
    if (!state.showBoardDetails) return "";
    var b = state.boardDetail;
    var html =
      '<div class="dialog-backdrop"><div class="board-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="board-detail-title">' +
      '<header class="detail-toolbar"><div id="board-detail-title">板子详情</div>' +
      btn("detail-close", "closeBoardDetails", "关闭 ×") + "</header>";
    if (b && b.detail) {
      html += '<nav class="detail-nav" aria-label="章节目录">' + b.detail.sections.map(function (sec, index) {
        return btn("detail-nav-item", "jumpBoardSection", sec.navTitle || sec.title, { value: index });
      }).join("") + "</nav>";
    }
    html += '<div class="detail-scroll" tabindex="0" aria-label="板子规则正文">';
    if (b)
      html +=
        '<div class="detail-board-name">' +
        esc(b.name) +
        (/[（(]\d+人[）)]/.test(b.name) ? "" : ' <span class="detail-capacity muted">· ' + b.capacity + '人</span>') + '</div>' +
        (b.detail ? '<div class="detail-summary">' + esc(b.detail.summary) + "</div>" : "");
    if (b && b.detail) {
      b.detail.sections.forEach(function (sec, index) {
        html += '<section class="detail-section" id="board-section-' + index + '"><h2 class="detail-section-title"><span class="detail-section-number">' + String(index + 1).padStart(2, "0") + "</span>" + esc(sec.title) + "</h2>";
        if (sec.kind === "roles") {
          html +=
            '<div class="role-grid">' +
            sec.items
              .map(function (role, roleIndex) {
                if (role.brief) {
                  var key = index + ":" + roleIndex;
                  var expanded = !!(state.expandedBoardRoles || {})[key];
                  return '<div class="role-quick"><button type="button" class="role-quick-toggle" data-action="toggleBoardRole" data-value="' + key + '" aria-expanded="' + expanded + '"><span class="role-quick-name tone-' + esc(role.tone || "") + '">' + esc(role.name) + '</span><span class="role-quick-brief">' + esc(role.brief) + '</span><span class="role-quick-arrow" aria-hidden="true">' + (expanded ? "−" : "+") + "</span></button>" + (expanded ? '<div class="role-quick-detail">' + detailText(role.text) + "</div>" : "") + "</div>";
                }
                return (
                  '<div class="role-card"><div class="role-card-heading"><span class="role-card-name tone-' + esc(role.tone || "") + '">' +
                  esc(role.name) +
                  "</span>" +
                  "</div>" +
                  '<div class="role-card-text">' +
                  detailText(role.text) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>";
        } else if (sec.kind === "blocks") {
          html += sec.items
            .map(function (blk) {
              return '<div class="detail-block">' + detailText(blk) + "</div>";
            })
            .join("");
        } else {
          html += sec.items
            .map(function (line) {
              return '<div class="detail-line">' + detailText(line) + "</div>";
            })
            .join("");
        }
        html += "</section>";
      });
    } else {
      html +=
        '<div class="configuration-roles">' +
        ((b && b.roleConfiguration) || [])
          .map(function (x) {
            return (
              '<div class="role-line">' + esc(x.label) + "：" + esc(x.roles) + "</div>"
            );
          })
          .join("") +
        '</div><div class="muted small detail-none">本板子暂无详细说明，以上为角色配置。</div>';
    }
    html +=
      '<div class="dialog-actions">' +
      btn("primary", "closeBoardDetails", "知道了") +
      "</div></div></div></div>";
    return html;
  }
  // Keep option selection in a themed, keyboard-accessible modal above settings.
  var optionDialog = null;
  function enhanceSelects(root) {
    root.querySelectorAll("select[data-change]").forEach(function (select) {
      var key = select.dataset.change;
      var label = key.startsWith('funRank') ? ({funRankMode:'玩法',funRankMetric:'趣味指标',funRankRole:'出刀角色'})[key] : key === "settingsKick" ? "要移出的玩家" : key === "settingsTransfer" ? "新房主" : /Capacity$/.test(key) ? "人数" : "板子";
      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = select.className + " option-trigger";
      trigger.dataset.optionTrigger = key;
      trigger.disabled = select.disabled || state.busy;
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-label", key === "settingsKick" ? "移出玩家" : key === "settingsTransfer" ? "移交房主" : label + "：" + (select.selectedOptions[0] || {}).textContent);
      trigger.textContent = (select.selectedOptions[0] || {}).textContent || "请选择";
      select.hidden = true;
      select.after(trigger);
    });
  }
  function validateOptionDialog() {
    if (optionDialog) {
      var current = app.querySelector('select[data-change="' + optionDialog.dataset.key + '"]');
      if (!current || current.disabled || state.busy || current.innerHTML !== optionDialog.optionSnapshot)
        optionDialog.close();
    }
  }
  function openOptions(select, label) {
    if (optionDialog) return;
    var key = select.dataset.change;
    var dialog = document.createElement("dialog");
    optionDialog = dialog;
    dialog.className = "option-dialog";
    dialog.dataset.key = key;
    dialog.optionSnapshot = select.innerHTML;
    dialog.setAttribute("aria-labelledby", "option-title");
    dialog.innerHTML = '<div class="option-header"><div><div class="settings-eyebrow">' + (key.startsWith('funRank') ? '榜单筛选' : '房间配置') + '</div><h2 id="option-title">选择' + label +
      '</h2></div><button type="button" class="option-close" aria-label="关闭选项">×</button></div><div class="option-list"></div>';
    var list = dialog.querySelector(".option-list");
    Array.from(select.options).forEach(function (option) {
      if (option.disabled) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "option-item";
      button.disabled = option.disabled;
      button.setAttribute("aria-pressed", String(option.selected));
      button.innerHTML = '<span>' + esc(option.textContent) + '</span><span class="option-check" aria-hidden="true">' + (option.selected ? "✓" : "") + '</span>';
      button.addEventListener("click", function () {
        // Finish native dialog focus restoration before opening confirmation.
        dialog.addEventListener("close", function () {
          var current = app.querySelector('select[data-change="' + key + '"]');
          if (!current || current.disabled || state.busy) return;
          current.value = option.value;
          CHANGES[key](current);
          if (key === "settingsTransfer" || key === "settingsKick") current.value = "";
          var trigger = app.querySelector('[data-option-trigger="' + key + '"]');
          if (modal.hidden && trigger) trigger.focus();
        }, { once: true });
        dialog.close();
      });
      list.appendChild(button);
    });
    dialog.querySelector(".option-close").addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (event) {
      if (event.target !== dialog) return;
      var rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener("keydown", function (event) {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      var items = Array.from(list.querySelectorAll("button:not(:disabled)"));
      var index = items.indexOf(document.activeElement);
      var next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      if (items[next]) items[next].focus();
    });
    dialog.addEventListener("close", function () {
      optionDialog = null;
      dialog.remove();
      var trigger = app.querySelector('[data-option-trigger="' + key + '"]');
      if (!modal.hidden) modalCancel.focus();
      else if (trigger) trigger.focus();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    var selected = list.querySelector('[aria-pressed="true"]') || list.querySelector("button");
    if (selected) selected.focus();
  }
  // Reconcile matching nodes in place: polling and selection must not restart
  // animations, detach focused controls, or reset scroll containers.
  function nodeKey(node) {
    if (node.nodeType !== 1) return "";
    if (node.id) return node.tagName + "#" + node.id;
    var identity = ["data-action", "data-change", "data-input", "data-option-trigger"]
      .map(function (attr) { return node.getAttribute(attr) || ""; }).join("|");
    var detail = ["data-seat", "data-value", "data-code", "data-kind", "data-mode"]
      .map(function (attr) { return node.getAttribute(attr) || ""; }).join("|");
    return node.tagName + ":" + identity + ":" + detail + ":" + (node.classList[0] || "");
  }
  function patchDOM(parent, source) {
    var cursor = parent.firstChild;
    Array.from(source.childNodes).forEach(function (next) {
      var match = cursor;
      while (match && (match.nodeType !== next.nodeType || nodeKey(match) !== nodeKey(next)))
        match = match.nextSibling;
      if (!match) {
        parent.insertBefore(next, cursor);
        return;
      }
      if (match !== cursor) parent.insertBefore(match, cursor);
      if (match.nodeType === 3) {
        if (match.nodeValue !== next.nodeValue) match.nodeValue = next.nodeValue;
      } else if (match.nodeType === 1) {
        var nextValue = next.value;
        var nextChecked = next.checked;
        Array.from(match.attributes).forEach(function (attr) {
          if (!next.hasAttribute(attr.name)) match.removeAttribute(attr.name);
        });
        Array.from(next.attributes).forEach(function (attr) {
          if (match.getAttribute(attr.name) !== attr.value) match.setAttribute(attr.name, attr.value);
        });
        patchDOM(match, next);
        if (match.tagName === "INPUT") {
          if (match.value !== nextValue) match.value = nextValue;
          if (match.checked !== nextChecked) match.checked = nextChecked;
        }
        if (match.tagName === "SELECT" && match.value !== nextValue) match.value = nextValue;
      }
      cursor = match.nextSibling;
    });
    while (cursor) {
      var removed = cursor;
      cursor = cursor.nextSibling;
      parent.removeChild(removed);
    }
  }
  function viewTableLoading() {
    return '<section class="table-loading" aria-busy="' + !state.error + '"><div class="section-title">房间 ' + esc(roomCode || state.code) + '</div><div class="status" role="status">' + (state.error ? '牌桌暂未载入，请重试' : '正在读取牌桌…') + '</div></section>';
  }
  function render() {
    var hasHostBar =
      state.room &&
      state.room.canUseTools &&
      state.room.hasActiveOperation &&
      state.room.phase !== "offlineFinal";
    var next = document.createElement("div");
    next.innerHTML =
      viewFairyResult() +
      viewIdentityChange() +
      viewDealtIdentity() +
      (state.page === 'profile' ? viewProfileHeader() : '') + '<div class="page' +
      (hasHostBar ? " has-host-bar" : "") + (["lobby","me"].includes(state.page) ? " has-bottom-nav" : "") + (["me","profile","stats","leaderboard","help"].includes(state.page) ? " personal-page" : "") +
      (state.page === 'profile' ? ' profile-page' + (profilePending ? ' has-pending-save' : '') : '') + '">' +
      (state.page === 'profile' ? '' : viewBrand()) +
      (state.loading && state.page !== 'table' ? '<div class="status">正在连接牌桌…</div>' : "") +
      viewErrorDialog() +
      viewActionDialog() +
      viewToolDialog() +
      viewResultDialog() +
      (state.reconnecting ? '<div class="notice" role="status">' + (pending ? '正在确认提交结果，请勿重复提交' : '连接中断，正在重连；当前显示上次同步的内容') + btn('text-button','recoverConnection','立即重试',null,state.busy || state.loading) + '</div>' : '') +
      (state.notice ? '<div class="notice">' + esc(state.notice) + "</div>" : "") +
      (state.page === 'login' ? viewWebLogin() : state.page === 'me' ? viewMe() : state.page === 'profile' ? viewProfileEditor() : state.page === 'matches' ? viewMatches() : state.page === 'stats' ? personalTitle('我的战绩','MY RECORDS') + viewStats() : state.page === 'leaderboard' ? viewLeaderboard() : state.page === 'help' ? viewHelp() : state.page === 'table' ? (state.room ? viewRoom() : viewTableLoading()) : viewEntry()) +
      "</div>" +
      viewPlayerCard() + viewSettingsDialog() +
      viewBoardDetails() + viewNavigation();
    enhanceSelects(next);
    patchDOM(app, next);
    validateOptionDialog();
    showIdentityHintWhenVisible();
  }

  // ===== event delegation =====
  var ACTIONS = {
    startWebLogin, continueAsGuest,
    closePlayerCard: () => closePlayerCard(),
    rankPlayerCard: el => openRankPlayerCard(el.dataset.id),
    retryPlayerCard: () => state.playerCard && !state.playerCardLoading && (state.playerCard.scope === 'leaderboard' ? openRankPlayerCard(state.playerCard.id) : openPlayerCard(state.playerCard.seat)),
    toggleProposalSeat: el => toggleProposalSeat(Number(el.dataset.seat)),
    recoverConnection: recoverConnection,
    toggleFunCards: () => setState({funExpanded:!state.funExpanded}),
    toggleFunRules: () => setState({funRulesExpanded:!state.funRulesExpanded}),
    statsTab: el => { if(['records','fun'].includes(el.dataset.value)) setState({statsTab:el.dataset.value}); },
    funRecords: el => navigate('matches?fun='+encodeURIComponent(el.dataset.metric)+'&mode='+encodeURIComponent(el.dataset.mode)+(el.dataset.role ? '&role='+encodeURIComponent(el.dataset.role) : '')),
    funRankMetric: el => { if(el.dataset.value!==state.rankMetric && state.rankFunMetrics.some(item=>item.key===el.dataset.value)) return loadLeaderboard(false,{rankMetric:el.dataset.value,rankFunMode:'all',rankFunRole:''}); },
    funRankSort: el => { if(['count','rate'].includes(el.dataset.value)) return loadLeaderboard(false,{rankFunSort:el.dataset.value}); },
    rankMetric: el => { if(el.dataset.value==='fun' && state.rankFunMetrics.length && !state.rankMetric.startsWith('fun_')) return loadLeaderboard(false,{rankMetric:'fun_merlin_evade',rankFunMode:'all',rankFunSort:'count',rankFunRole:''}); if (rankMetrics.some(item => item[0] === el.dataset.value) && el.dataset.value !== state.rankMetric && (el.dataset.value !== 'points' || state.rankPointsAvailable)) return loadLeaderboard(false, { rankMetric: el.dataset.value }); },
    rankToggleMine: () => toggleRankSheet('rankMineExpanded', '.rank-mine-toggle'),
    rankToggleRules: () => toggleRankSheet('rankRulesExpanded', '[data-action="rankToggleRules"]'),
    rankToggleMetrics: () => {
      if (!state.rankMetricsExpanded) {
        const options = rankPresentation.funOptions(state.rankFunMetrics, {includeFinal:true});
        const option = options.find(item => item.key === state.rankMetric) || options[0];
        if (!option || state.rankLoading) return;
        state.rankPendingMetric = option.key; state.rankFunCategory = option.category;
      }
      toggleRankSheet('rankMetricsExpanded', '.fun-metric-toggle');
      app.querySelector('.fun-metric-options .selected')?.scrollIntoView({block:'nearest'});
    },
    funRankCategory: el => { if (rankPresentation.categories.some(item => item.id === el.dataset.value)) setState({ rankFunCategory: el.dataset.value }); },
    funRankPreview: el => { if (rankPresentation.funOptions(state.rankFunMetrics, {includeFinal:true}).some(item => item.category === state.rankFunCategory && item.key === el.dataset.value)) setState({ rankPendingMetric: el.dataset.value }); },
    funRankConfirm: async () => {
      if (!state.rankMetricsExpanded || state.rankLoading) return;
      const metric = state.rankPendingMetric;
      if (!rankPresentation.funOptions(state.rankFunMetrics, {includeFinal:true}).some(item => item.key === metric)) return;
      toggleRankSheet('rankMetricsExpanded', '.fun-metric-toggle');
      if (metric !== state.rankMetric) await loadLeaderboard(false, {rankMetric:metric,rankFunMode:'all',rankFunRole:''});
      app.querySelector('.fun-metric-toggle')?.focus({preventScroll:true});
    },
    rankPeriod: el => { if (['all','month'].includes(el.dataset.value) && el.dataset.value !== state.rankPeriod) return loadLeaderboard(false, { rankPeriod: el.dataset.value }); },
    rankMore: () => loadLeaderboard(true),
    rankVisibilityRetry: () => changeRankVisibility(rankVisibilityTarget),
    rankRetry: () => loadLeaderboard(state.rankMoreError, rankFailedSelection || {}),
    rankRefresh: () => loadLeaderboard(),
    navigate: el => navigate(el.dataset.page),
    saveProfile,
    chooseBuiltinProfileAvatar,
    chooseProfileAvatarStyle,
    editProfileNickname,
    finishProfileNickname,
    reloadProfile: async () => { if (!state.profileDirty || await confirm('重新载入资料？', '当前未保存的修改将丢弃。')) { profilePending = null; try { await login(); await loadProfile(state.page === 'profile'); } catch (e) { setState({ profileError: e.message }); } } },
    removeProfileAvatar: () => { if (state.profileDraft && !state.profileSaving && !profilePending) { state.profileDraft.avatar = null; state.profileDraft.avatarPreview = null; profileDirty(); } },
    about: () => confirm('关于桌边助手', 'ShadowTable · 为面对面的阿瓦隆聚会而做。身份、投票与技能交给牌桌，讨论和故事留给同桌的朋友。', false),
    returnHome: returnHome,
    connectionInfo: connectionInfo,
    retry: retry,
    dismissError: function () {
      setState({ error: "", recoverableError: false, hasPendingRequest: false });
    },
    reveal: reveal,
    revealDealtIdentity: revealDealtIdentity,
    closeDealtIdentity: closeDealtIdentity,
    dismissIdentityHint: dismissIdentityHint,
    revealActionIdentity: revealActionIdentity,
    openAction: openAction,
    closeAction: closeAction,
    submitChoice: function (el) {
      submitChoice(el.dataset.value);
    },
    confirmChoice: confirmChoice,
    submitTarget: function (el) {
      submitTarget(Number(el.dataset.seat));
    },
    toggleSwapSeat: function (el) {
      toggleSwapSeat(Number(el.dataset.seat));
    },
    confirmSwap: confirmSwap,
    revealFairyResult: function () {
      if (state.busy || !foreground || !state.fairyResult) return;
      setState({ fairyResultRevealed: true });
    },
    acknowledgeFairyResult: acknowledgeFairyResult,
    revealChangedIdentity: function () {
      if (state.busy || !foreground || !state.identityChange) return;
      setState({ identityChangeRevealed: true });
    },
    acknowledgeIdentity: acknowledgeIdentity,
    openTool: function (el) {
      openTool(el.dataset.kind);
    },
    closeTool: closeTool,
    toggleToolSeat: function (el) {
      toggleToolSeat(Number(el.dataset.seat));
    },
    pickToolThreshold: function (el) {
      pickToolThreshold(Number(el.dataset.value));
    },
    launchTool: launchTool,
    switchEntry: function (el) {
      if (state.busy || pending) return;
      switchEntry(el.dataset.mode);
      if (el.dataset.scroll) {
        var field = app.querySelector(el.dataset.mode === "join" ? "#code" : "#nickname");
        if (field) field.focus({ preventScroll: true });
        app.querySelector(".entry-panel").scrollIntoView({ block: "start" });
      }
    },
    toggleRules: function () {
      setState({ showRules: !state.showRules });
    },
    create: create,
    join: join,
    openRoom: function (el) {
      openRoom(el.dataset.code);
    },
    refreshRooms: refreshRooms,
    filterRooms: function (el) { if (["all", "playing", "lobby", "ended", "unavailable"].includes(el.dataset.filter)) setState({ roomListFilter: el.dataset.filter }); },
    openRoomMenu: function (el) { if (!state.busy && !pending) setState({ roomMenu: state.memberRooms.find(function (r) { return r.code === el.dataset.code; }) || null }); },
    closeRoomMenu: function () { if (!state.busy && !pending) setState({ roomMenu: null, noteRoom: null }); },
    roomMenuAction: function (el) { return roomMenuAction(el.dataset.kind); },
    saveRoomNote: function () { if (state.noteRoom) return mutate("/api/me/rooms/" + state.noteRoom.code, { action: "note", note: state.roomNoteDraft }, "entryNote"); },
    undoRemoveRoom: function () { if (state.undoRoom && Date.now() < state.undoRoom.until) return mutate("/api/me/rooms/" + state.undoRoom.code, { action: "restore" }, "entryRestore"); },
    deleteRoom: function (el) {
      deleteRoom(el.dataset.code);
    },
    copyRoomCode: function () {
      if (state.room) copyText(state.room.code, "房间号已复制");
    },
    copyInviteLink: function () {
      if (state.room)
        copyText(location.origin + "/?code=" + state.room.code, "邀请链接已复制");
    },
    openRoomRules: function () {
      setState({ showRoomRules: true });
    },
    closeRoomRules: function () {
      setState({ showRoomRules: false });
    },
    openBoardDetails: function () {
      if (!state.room) return;
      var board = state.boards.find(function (b) {
        return b.id === state.room.board;
      });
      setState({
        showBoardDetails: true,
        expandedBoardRoles: {},
        showRoomRules: false,
        boardDetail: board
          ? {
              name: board.name,
              capacity: state.room.capacity,
              detail: board.detail,
              roleConfiguration:
                state.room.roleConfiguration ||
                (board.roleConfigurations || {})[state.room.capacity] ||
                [],
            }
          : null,
      });
      var close = app.querySelector('[data-action="closeBoardDetails"]');
      if (close) close.focus();
    },
    toggleBoardRole: function (el) {
      var expanded = Object.assign({}, state.expandedBoardRoles || {});
      expanded[el.dataset.value] = !expanded[el.dataset.value];
      setState({ expandedBoardRoles: expanded });
    },
    jumpBoardSection: function (el) {
      var target = document.getElementById("board-section-" + Number(el.dataset.value));
      var scroll = app.querySelector(".detail-scroll");
      if (target && scroll) scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16;
    },
    closeBoardDetails: function () {
      setState({ showBoardDetails: false, boardDetail: null });
      var trigger = app.querySelector('[data-action="openRoomRules"]');
      if (trigger) trigger.focus();
    },
    toggleRoomSettings: toggleRoomSettings,
    seat: function (el) {
      seat(Number(el.dataset.seat));
    },
    ready: ready,
    start: function () {
      confirmCommand(
        "开始这一局？",
        "按当前人数随机分配身份，之后由房主按需发起投票、任务或刀人。",
        "start",
        { flexible: true },
      );
    },
    propose: propose,
    leave: leave,
    rematch: function () {
      cmd("rematch");
    },
    closeOffline: function () {
      confirmCommand(
        "线下已结算完毕？",
        "记录线下操作完成，随后可继续发起其他操作。",
        "closeOffline",
        { keepPlaying: true },
      );
    },
    offline: function () {
      confirmCommand(
        "转入线下结算？",
        "停止线上任务推进，在线下完成起刀、内奸及最终胜负。本系统不会代判。",
        "offline",
      );
    },
    closeWaiting: function () {
      var policy = state.room && state.room.closeWaiting;
      if (!policy) return;
      return confirmCommand(policy.title, policy.description, "closeWaiting", { confirm: true });
    },
    settleTool: function () {
      cmd("settleTool");
    },
    cancelTool: function () {
      confirmCommand(
        "作废当前操作？",
        "本次未结算的提交将作废，玩家身份和已结算记录保留。",
        "cancelActivity",
      );
    },
    finishTools: function () {
      if (!state.room?.canUseTools || state.busy || pending) return;
      resultStage = state.room.stage;
      updateResult({ resultDialog: true, resultStep: "reason", resultOther: false, resultChoice: "", resultReason: "", resultTarget: null, resultActor: null, resultRequiresTarget: false });
      var first = app.querySelector('.result-dialog button');
      if (first) first.focus();
    },
    closeResult: closeResult,
    toggleResultOther: () => setState({ resultOther: !state.resultOther }),
    nextResult: () => {
      if (state.busy || pending || !state.resultDialog) return;
      if (state.room?.stage !== resultStage) { setState({resultDialog:false,error:"阶段已变化，请重新登记胜负"}); return; }
      const flow = resultFlow(state);
      if (flow.resultNextEnabled && flow.resultStep !== 'review') updateResult({resultStep:flow.resultSteps[flow.resultStepIndex+1].id});
    },
    backResult: () => {
      if (state.busy || pending) return;
      const flow = resultFlow(state);
      if (flow.resultStepIndex) updateResult({resultStep:flow.resultSteps[flow.resultStepIndex-1].id});
      else closeResult();
    },
    pickResult: el => {
      if (el.dataset.value !== 'none' && !state.room?.winnerOptions?.some(item=>item.value===el.dataset.value)) return;
      updateResult({resultChoice:el.dataset.value,resultReason:'',resultRequiresTarget:false,resultTarget:null,resultActor:null});
    },
    pickScoreReason: el => {
      const room=state.room, reason=(room?.scoreSettlement?.length ? room.scoreSettlement : room?.funSettlement)?.find(item=>item.id===el.dataset.id);
      if (reason) updateResult({resultReason:reason.id,resultChoice:'',resultRequiresTarget:!!reason.requiresTarget,resultTarget:null,resultActor:null});
    },
    pickFunActor: el => {
      const seat=Number(el.dataset.seat);
      if (!state.room?.players?.some(player=>player.seat===seat && player.alive!==false)) return;
      updateResult({resultActor:seat,...(state.resultTarget===seat?{resultTarget:null}:{})});
    },
    pickScoreTarget: el => {
      const seat=Number(el.dataset.seat);
      if (seat!==0 && !state.room?.players?.some(player=>player.seat===seat && player.alive!==false)) return;
      if ((state.room?.settlementRequiresActor ?? state.room?.knights) && state.resultActor===seat) return;
      updateResult({resultTarget:seat});
    },
    scoreRecords: function () { return navigate('matches?scored=1'); },
    filterMatches: function (el) { return navigate('matches?scored=' + (el.dataset.scored === '1' ? '1' : '0')); },
    loadMatches: function () { return loadMatches(); },
    moreMatches: function () { return loadMatches(true); },
    moreScoreAdjustments: moreScoreAdjustments,
    loadScoreRules: loadScoreRules,
    saveResult: saveResult,
    toggleStats: async function () {
      setState({ statsOpen: !state.statsOpen });
      if (state.statsOpen) await loadStats();
    },
    loadStats: loadStats,
    retrySettings: loadSettings,
    toggleSeats: function () { if (state.room && state.room.phase !== "lobby") setState({ seatsExpanded: !state.seatsExpanded }); },
    toggleOperationProgress: function () { if (state.room?.canUseTools && state.room.operationProgress) setState({ operationProgressExpanded: !state.operationProgressExpanded }); },
    toggleHistory: function () { setState({ historyExpanded: !state.historyExpanded }); },
    showLatestRecord: function () {
      var entry = state.latestResult;
      if (!entry) return;
      setState({
        historyExpanded: state.historyExpanded || !state.history.slice(-3).some(function (h) { return h.key === entry.key; }),
        focusedHistoryKey: entry.key,
      });
      var target = document.getElementById("history-record-" + entry.key);
      if (target) {
        // Restart the brief highlight when the same record is revisited.
        target.classList.remove("history-row-focused");
        void target.offsetWidth;
        target.classList.add("history-row-focused");
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    },
    showQuestRecord: function (el) {
      var entry = state.history.find(function (h) { return h.key === Number(el.dataset.key); });
      if (entry) confirm(entry.text, entry.detail, false);
    },
    settingsSave: settingsSave,
    settingsBack: settingsBack,
    retryKick: sendKick,
    transferFromSettings: function (el) {
      transferFromSettings(Number(el.dataset.seat));
    },
  };
  var CHANGES = {
    funRankRole: el => loadLeaderboard(false,{rankFunRole:el.value}),
    rankVisibility: el => changeRankVisibility(el.checked),
    settingsKick: function (el) { kickFromSettings(Number(el.value)); },
    settingsTransfer: function (el) { transferFromSettings(Number(el.value)); },
    entryCapacity: function (el) {
      if (state.busy) return;
      selectCapacity(Number(el.value));
    },
    entryBoard: function (el) {
      pickBoard(el.value);
    },
    settingsCapacity: function (el) {
      if (settingsLocked() || !state.settings.room) return;
      if (state.settings.room.phase !== "lobby") return;
      updateSettingsChoices(Number(el.value), state.settings.boardId);
      return settingsSave();
    },
    settingsBoard: function (el) {
      if (settingsLocked() || !state.settings.room) return;
      if (state.settings.room.phase !== "lobby") return;
      var b = state.settings.choices.filter(function (x) {
        return x.id === el.value;
      })[0];
      if (b) {
        updateSettingsChoices(state.settings.capacity, b.id);
        return settingsSave();
      }
    },
    settingsFairy: function (el) {
      var s = state.settings;
      if (settingsLocked() || s.capacity < 7 || s.room.phase === "fairy") return;
      setSettings({ fairyEnabled: el.checked });
      updateSettingsDirty();
      return settingsSave();
    },
    settingsRecordPurpose: function (el) {
      const s = state.settings;
      if (settingsLocked() || !s.room?.recordSettings?.editable) return;
      setSettings({recordPurpose:el.checked ? "test" : "normal"});
      updateSettingsDirty();
      return settingsSave();
    },
    settingsScoring: function (el) {
      const s = state.settings;
      if (settingsLocked() || !s.room?.scoreSettings?.editable) return;
      setSettings({ scoreEnabled: el.checked });
      updateSettingsDirty();
      return settingsSave();
    },
    settingsVisibility: function (el) {
      if (settingsLocked()) return;
      setSettings({ visible: el.checked });
      updateSettingsDirty();
      return settingsSave();
    },
  };
  var INPUTS = {
    profileName: el => { if (state.profileDraft && !state.profileSaving && !profilePending) { state.profileDraft.nickname = el.value; state.profileNicknameError = ''; state.profileError = ''; profileDirty(); } },
    roomNote: function (el) { state.roomNoteDraft = el.value; },
    name: function (el) {
      state.nameEdited = true;
      state.name = el.value;
    },
    code: function (el) {
      var v = el.value.replace(/\D/g, "").slice(0, 6);
      state.code = v;
      if (el.value !== v) el.value = v;
    },
  };

  // Image errors do not bubble; capture them without changing seat click handling.
  app.addEventListener("error", function (e) {
    if (e.target?.dataset?.seatAvatarUrl) seatAvatarError(e.target);
    if (e.target?.dataset?.rankAvatarId && state.rankBoard) {
      const id = e.target.dataset.rankAvatarId, src = e.target.getAttribute('src');
      setState({ rankBoard: { ...state.rankBoard, rows: state.rankBoard.rows.map(row => row.publicId === id && row.avatarUrl === src ? { ...row, avatarFailed: true } : row) } });
    }
    if (e.target?.hasAttribute?.('data-player-card-avatar') && state.playerCard) setState({ playerCard: { ...state.playerCard, avatarFailed: true } });
  }, true);
  app.addEventListener("click", function (e) {
    if (e.target?.dataset?.rankDismiss) return ACTIONS[e.target.dataset.rankDismiss]?.();
    if (e.target?.hasAttribute?.('data-player-card-backdrop')) return closePlayerCard();
    var picker = e.target.closest("[data-option-trigger]");
    if (picker && !picker.disabled) {
      var key = picker.dataset.optionTrigger;
      var select = app.querySelector('select[data-change="' + key + '"]');
      if (select) openOptions(select, key === 'funRankRole' ? '出刀角色' : key === "settingsKick" ? "要移出的玩家" : key === "settingsTransfer" ? "新房主" : /Capacity$/.test(key) ? "人数" : "板子");
      return;
    }
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var fn = ACTIONS[t.dataset.action];
    if (fn) fn(t);
  });
  app.addEventListener("change", function (e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.change && CHANGES[t.dataset.change])
      CHANGES[t.dataset.change](t);
  });
  app.addEventListener("input", function (e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.input && INPUTS[t.dataset.input])
      INPUTS[t.dataset.input](t);
  });
  app.addEventListener("submit", function (e) {
    e.preventDefault();
    if (e.target.dataset.form === "profile") saveProfile();
  });
  app.addEventListener('focusout', function (e) {
    if (e.target?.dataset?.input === 'profileName' && e.relatedTarget?.dataset?.action !== 'finishProfileNickname') finishProfileNickname();
  });
  app.addEventListener('keydown', function (e) {
    if (e.target?.dataset?.input === 'profileName' && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      finishProfileNickname();
      if (!state.profileEditingNickname) app.querySelector('[data-action="editProfileNickname"]')?.focus({ preventScroll: true });
    }
  });

  // ===== lifecycle =====
  window.addEventListener("scroll", showIdentityHintWhenVisible, { passive: true });
  window.addEventListener("resize", showIdentityHintWhenVisible);
  document.addEventListener("keydown", function (event) {
    if (state.playerCard && !state.error) {
      if (event.key === "Escape") { event.preventDefault(); closePlayerCard(); }
      else if (event.key === "Tab") {
        const buttons = app.querySelectorAll('.player-card-sheet button:not(:disabled)');
        if (buttons.length) {
          const index = Array.prototype.indexOf.call(buttons, document.activeElement);
          event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
        }
      }
      return;
    }
    if (!state.dealtIdentityDialog || state.error) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDealtIdentity();
    } else if (event.key === "Tab") {
      var buttons = app.querySelectorAll('.dealt-identity-dialog button:not(:disabled)');
      if (!buttons.length) return;
      var index = Array.prototype.indexOf.call(buttons, document.activeElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      foreground = false;
      clearTimeout(webLoginTimer);
      clearTimeout(timer);
      mask();
    } else {
      foreground = true;
      if (state.page === 'login') pollWebLogin();
      if (alive) {
        if (state.reconnecting || pending) recoverConnection();
        else if (roomCode && !state.needsLogin) refresh().catch(handleError);
        schedule();
      }
    }
  });
  window.addEventListener("offline", function () {
    state.network = false;
    mask();
    handleError(new Error("连接已断开，请恢复网络后重试"));
  });
  window.addEventListener("online", function () {
    state.network = true;
    if (state.page === 'login') pollWebLogin();
    if (state.reconnecting || pending) recoverConnection();
    else if (roomCode && foreground && !state.needsLogin) refresh().catch(handleError);
    render();
  });

  document.addEventListener("keydown", function (event) {
    if (!state.showBoardDetails || !modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      ACTIONS.closeBoardDetails();
    } else if (event.key === "Tab") {
      var dialog = app.querySelector(".board-detail-dialog");
      if (!dialog) return;
      var controls = Array.from(dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]'));
      var first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener("keydown", function (event) {
    if (!(state.roomMenu || state.noteRoom) || state.error || !modal.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); ACTIONS.closeRoomMenu(); return; }
    if (event.key !== "Tab") return;
    var dialog = app.querySelector(".room-list-dialog");
    if (!dialog) return;
    var controls = Array.from(dialog.querySelectorAll("button:not(:disabled), input:not(:disabled)"));
    if (!controls.length) { event.preventDefault(); return; }
    var first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener("keydown", function (event) {
    if (!state.resultDialog || state.error || !modal.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closeResult(); return; }
    if (event.key !== "Tab") return;
    var controls = Array.from(app.querySelectorAll('.result-dialog button:not(:disabled)'));
    if (!controls.length) return;
    var index = controls.indexOf(document.activeElement);
    event.preventDefault();
    controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
  });
  document.addEventListener("keydown", function (event) {
    if (!(state.rankMineExpanded || state.rankRulesExpanded || state.rankMetricsExpanded) || state.page !== 'leaderboard' || !modal.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); ACTIONS[state.rankMineExpanded ? 'rankToggleMine' : state.rankRulesExpanded ? 'rankToggleRules' : 'rankToggleMetrics'](); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(app.querySelectorAll('.rank-sheet button:not(:disabled), .rank-sheet input:not(:disabled)'));
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    event.preventDefault();
    controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
  });
  window.addEventListener('hashchange', async function () {
    if (location.hash === currentRoute) return;
    const requested = location.hash;
    if (!(await mayNavigate())) { window.history.pushState({}, '', currentRoute); return; }
    await applyRoute(requested);
  });
  window.addEventListener('beforeunload', function (event) {
    if (pending || state.profileDirty || profilePending || state.profileSaving) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'accountRevision') {
      mask();
      window.location.reload();
    }
  });
  // ===== boot =====
  var codeMatch = /(?:\?|&)code=(\d{6})/.exec(location.search || "");
  if (codeMatch) inviteCode = codeMatch[1];
  state.name = storage.get("nickname") || "";
  state.code = inviteCode || storage.get("roomCode") || "";
  var initialRoute = routeInfo(location.hash || (inviteCode ? '#/table/' + inviteCode : '#/lobby'));
  state.page = initialRoute.page;
  if (initialRoute.code) state.code = initialRoute.code;
  render();
  bootstrap();
})();
