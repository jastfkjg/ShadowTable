(function () {
  "use strict";

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

  // ===== API =====
  var retryAt = 0;
  function request(path, method, data, id) {
    if (Date.now() < retryAt)
      return Promise.reject(
        Object.assign(new Error("请求冷却中，请稍后重试"), {
          status: 429,
          retryAfterMs: retryAt - Date.now(),
        }),
      );
    var headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (storage.get("session") || ""),
    };
    if (id) headers["Idempotency-Key"] = id;
    return fetch(path, {
      method: method || "GET",
      headers: headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    })
      .then(function (response) {
        if (response.status >= 200 && response.status < 300)
          return response.json();
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            var err = new Error(payload.error || "请求失败");
            err.status = response.status;
            if (err.status === 429) {
              var ra = Number(response.headers.get("Retry-After")) || 60;
              err.retryAfterMs = Math.min(60000, Math.max(1000, ra * 1000));
              retryAt = Date.now() + err.retryAfterMs;
            }
            if (err.status === 401) storage.remove("session");
            throw err;
          });
      })
      .catch(function (e) {
        if (e && e.status) throw e;
        throw new Error("网络未确认，请检查连接后重试原请求");
      });
  }
  function login() {
    if (storage.get("session")) return Promise.resolve();
    return request("/api/guest-login", "POST", {}).then(function (data) {
      storage.set("session", data.token);
    });
  }
  function requestId() {
    return (
      Date.now().toString(36) +
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
  var rateLimitUntil = 0;
  var promptedActionStage = null;
  var actionDraftStage = null;
  var toolStage = null;
  var settingsOriginal = null;
  var settingsKickPending = null;

  var state = {
    loading: true,
    busy: false,
    error: "",
    recoverableError: false,
    hasPendingRequest: false,
    notice: "",
    room: null,
    boards: [],
    availableBoards: [],
    entryMode: "join",
    showRules: false,
    showRoomRules: false,
    actionDialog: false,
    actionSecret: null,
    actionLoading: false,
    actionLabel: "",
    actionChoices: [],
    actionTargets: [],
    draftChoice: "",
    draftLabel: "",
    stagedChoice: false,
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
    memberRooms: [],
    boardId: "classic",
    boardName: "阿瓦隆 · 经典基础",
    boardRoleConfiguration: [],
    name: "",
    code: "",
    capacity: 6,
    capacities: [6, 7, 8, 9, 10, 11, 12],
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
    canStart: false,
    startHint: "",
    canSettle: false,
    settleHint: "",
    questSummary: { total: 0, success: 0, failure: 0 },
    teamText: "",
    settings: null,
  };

  function setState(patch) {
    for (var k in patch) state[k] = patch[k];
    render();
  }
  function setSettings(patch) {
    if (!state.settings) return;
    for (var k in patch) state.settings[k] = patch[k];
    render();
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
    generation++;
    actionGeneration++;
    setState({
      fairyResult: null,
      fairyResultRevealed: false,
      identityChange: null,
      identityChangeRevealed: false,
      actionDialog: false,
      actionSecret: null,
      actionLoading: false,
      actionLabel: "",
      actionChoices: [],
      actionTargets: [],
      draftChoice: "",
      draftLabel: "",
      stagedChoice: false,
      swapOptions: [],
      swapSeats: [],
      swapPlayers: [],
      revealed: false,
      secret: null,
    });
  }
  function handleError(e) {
    mask();
    if (e.status === 403 && e.message === "你已被房主移出房间") {
      pending = null;
      clearRoom();
      setState({ notice: e.message, hasPendingRequest: false });
      loadRooms().catch(handleError);
      return;
    }
    if (e.status === 429) {
      rateLimitUntil = Date.now() + (e.retryAfterMs || 60000);
      if (!pending && roomCode) {
        setState({
          error: "",
          notice: "请求较多，冷却后会自动刷新",
          serverConnected: true,
        });
        schedule();
        return;
      }
    }
    setState({
      error: e.message,
      serverConnected: !!e.status && e.status < 500 && e.status !== 401,
      needsLogin: e.status === 401,
      recoverableError:
        !e.status || e.status === 401 || e.status === 429 || e.status >= 500,
      hasPendingRequest: !!pending,
    });
  }
  function schedule() {
    clearTimeout(timer);
    if (foreground && alive && roomCode)
      timer = setTimeout(async function () {
        try {
          if (roomCode && !state.busy && !pending && !state.error) await refresh();
        } catch (e) {
          handleError(e);
        } finally {
          schedule();
        }
      }, Math.max(2500, (rateLimitUntil || 0) - Date.now()));
  }
  function clearRoom() {
    clearTimeout(timer);
    refreshSequence++;
    mask();
    roomCode = null;
    storage.remove("roomCode");
    setState({
      room: null,
      toolType: "",
      toolTitle: "",
      toolDescription: "",
      toolSeats: [],
      toolPlayers: [],
      seats: [],
      history: [],
      latestResult: null,
      selected: [],
      code: "",
      error: "",
      entryMode: "join",
      showRoomRules: false,
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
  async function loadRooms() {
    var data = await request("/api/me/rooms");
    if (alive) setState({ memberRooms: data.rooms, serverConnected: true });
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
      await login();
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
      var entry = safeParse(storage.get("pendingEntry"));
      if (entry) {
        pending = entry;
        await executePending();
        return;
      }
      await loadRooms();
      var code = storage.get("roomCode");
      if (code && (!inviteCode || inviteCode === code)) {
        roomCode = code;
        await refresh();
      }
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
        await loadRooms();
        return;
      }
      throw e;
    }
    if (!alive || code !== roomCode || sequence !== refreshSequence) return;
    var stageChanged = state.room && state.room.stage !== room.stage;
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
    if (stageChanged) {
      generation++;
      actionGeneration++;
      patch.fairyResult = null;
      patch.fairyResultRevealed = false;
      patch.identityChange = null;
      patch.identityChangeRevealed = false;
      patch.revealed = false;
      patch.secret = null;
      patch.actionDialog = false;
      patch.actionSecret = null;
      patch.actionLoading = false;
      patch.actionLabel = "";
      patch.actionChoices = [];
      patch.actionTargets = [];
      patch.draftChoice = "";
      patch.draftLabel = "";
      patch.stagedChoice = false;
      patch.swapOptions = [];
      patch.swapSeats = [];
      patch.swapPlayers = [];
    }
    var seats = Array.from({ length: room.capacity }, function (_, i) {
      var seat = i + 1;
      var p =
        (room.players || []).filter(function (pl) {
          return pl.seat === seat;
        })[0] || null;
      return {
        seat: seat,
        name: p ? p.name : "空位",
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
    patch.history = history;
    patch.latestResult = history.filter(function (_, i) {
      var h = room.history[i];
      return ["toolVote", "toolQuest", "skillResult", "toolReverse", "toolKnife", "toolOffline", "toolCanceled", "team", "quest", "assassination"].indexOf(h.kind) !== -1 || (h.kind === "variant" && h.number);
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
      !state.showRoomSettings
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
      setState({
        serverConnected: true,
        hasPendingRequest: false,
        recoverableError: false,
      });
      if (p.after === "enter") storage.remove("pendingEntry");
      mask();
      if (p.after === "enter") {
        roomCode = result.code;
        storage.set("roomCode", result.code);
        storage.set("nickname", state.name);
      }
      if (p.after === "leave" || p.after === "delete") {
        clearRoom();
        setState({
          notice: p.after === "delete" ? "牌桌已删除" : "已离开房间",
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
      { name: name, board: state.boardId, capacity: state.capacity },
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
    mutate("/api/rooms/" + code + "/join", { name: name }, "enter");
  }
  async function openRoom(code) {
    if (state.busy || pending) return;
    var target = state.memberRooms.filter(function (r) {
      return r.code === code;
    })[0];
    if (target && target.isHost && target.seat === null) {
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
    mask();
    roomCode = code;
    setState({ loading: true, error: "" });
    try {
      await refresh();
      if (roomCode) storage.set("roomCode", roomCode);
    } catch (e) {
      handleError(e);
    } finally {
      setState({ loading: false });
      schedule();
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
          "删除牌桌 " + code + "？",
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
    if (pending) {
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
  function seat(seatNum) {
    var r = state.room;
    if (r.phase === "lobby") {
      var s = state.seats.filter(function (x) {
        return x.seat === seatNum;
      })[0];
      if (s && !s.occupied) cmd("seat", { seat: seatNum });
    } else if (r.phase === "proposal" && r.leader === r.me.seat) {
      var selected =
        state.selected.indexOf(seatNum) !== -1
          ? state.selected.filter(function (x) {
              return x !== seatNum;
            })
          : state.selected.concat([seatNum]);
      setState({ selected: selected });
    }
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
  async function reveal() {
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
      actionTargets: [],
      draftChoice: "",
      draftLabel: "",
      stagedChoice: false,
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
      setState({
        actionDialog: true,
        actionLabel: response.action.label,
        stagedChoice: ["teamVote", "quest"].indexOf(room.phase) !== -1,
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
        actionChoices: (response.action.choices || [])
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
          }),
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
    var room = state.room;
    if (!room) return;
    if (["teamVote", "quest"].indexOf(room.phase) !== -1) {
      if (
        state.busy ||
        !foreground ||
        !state.actionDialog ||
        room.stage !== actionDraftStage
      )
        return;
      var choice = state.actionChoices.filter(function (c) {
        return c.value === value;
      })[0];
      if (choice) setState({ draftChoice: value, draftLabel: choice.label });
      return;
    }
    if (
      ["skillPrepare", "skillTurn", "hunterTurn", "fairy"].indexOf(
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
    if (!state.actionChoices.some(function (c) {
      return c.value === value;
    }))
      return;
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
      !state.network ||
      !foreground ||
      !state.actionDialog ||
      !state.room ||
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
    setState({
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
  function acknowledgeFairyResult() {
    if (state.busy || !state.fairyResultRevealed || !state.fairyResult) return;
    var revision = state.fairyResult.revision;
    setState({ fairyResult: null, fairyResultRevealed: false });
    cmd("ackFairyResult", { revision: revision });
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
      : state.busy || state.loading || pending
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
      dirty: false,
      pendingKick: !!settingsKickPending && settingsKickPending.code === roomCode,
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
    state.showRoomSettings = false;
    state.settings = null;
    render();
  }
  async function loadSettings() {
    var s = state.settings;
    if (!s || s.busy) return;
    setSettings({ loading: true, error: "", authorized: false });
    try {
      if (!/^\d{6}$/.test(roomCode || "")) throw new Error("房间号无效");
      await login();
      var room = await request("/api/rooms/" + roomCode);
      if (!room.me.isHost) throw new Error("仅房主管理员可访问房间设置");
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
        dirty: false,
      });
      updateSettingsChoices(room.capacity, room.board);
    } catch (e) {
      if (alive && state.settings === s) setSettings({ error: e.message });
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
      capacity: capacity,
      boardId: selected.id,
      choices: choices,
      visible: selected.id === "knights" ? s.visible : false,
    });
    updateSettingsDirty();
  }
  function updateSettingsDirty() {
    var s = state.settings;
    var r = settingsOriginal;
    setSettings({
      dirty:
        !!r &&
        (s.capacity !== r.capacity ||
          s.boardId !== r.board ||
          s.visible !== (r.board === "knights" && r.showSkillDetails === true)),
    });
  }
  async function settingsSave() {
    var s = state.settings;
    if (!s || s.busy || s.pendingKick || !s.authorized || !s.dirty) return;
    if (s.visible && !settingsOriginal.showSkillDetails) {
      var ok = await confirm(
        "公开技能过程？",
        "所有玩家将能查看已结算技能的出手人和目标，新身份牌面仍保密。",
      );
      if (!ok || !alive || !foreground) return;
    }
    var id = requestId();
    var data = {
      type: "updateSettings",
      stage: settingsOriginal.stage,
      board: s.boardId,
      capacity: s.capacity,
      visible: s.visible,
    };
    setSettings({ busy: true, error: "" });
    try {
      await login();
      await request("/api/rooms/" + roomCode + "/commands", "POST", data, id);
      if (!alive) return;
      setSettings({ dirty: false, busy: false });
      await loadSettings();
      if (foreground && state.settings && state.settings.authorized)
        toast("设置已保存");
    } catch (e) {
      if (!alive) return;
      setSettings({
        error: e.message,
        authorized:
          e.status === 403 ? false : !!(state.settings && state.settings.authorized),
      });
      if (e.status === 409) {
        setSettings({ busy: false });
        await loadSettings();
        setSettings({ error: "房间状态已变化，已刷新设置，请重新修改。" });
      }
    } finally {
      if (alive) setSettings({ busy: false });
    }
  }
  async function settingsBack() {
    var s = state.settings;
    if (s && (s.dirty || s.pendingKick)) {
      if (!(await confirm("返回牌桌？", s.pendingKick ? "移出结果尚未确认，请重新进入房间设置重试确认。" : "未保存的修改将放弃。"))) return;
    }
    closeSettings();
  }
  async function kickFromSettings(seat) {
    var s = state.settings;
    if (!s || s.busy || s.pendingKick || !s.authorized || !s.room || !s.room.canKick || state.busy || pending) return;
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
    var draft = s.dirty ? { capacity: s.capacity, boardId: s.boardId, visible: s.visible } : null;
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
    if (!s || s.busy || s.pendingKick || !s.authorized || !s.room || state.busy || pending)
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
  function seatDisabled(s) {
    var r = state.room;
    if (state.busy) return true;
    if (r.phase === "lobby") return s.occupied;
    return !(
      r.phase === "proposal" &&
      !r.flexible &&
      r.leader === r.me.seat
    );
  }
  function viewFairyResult() {
    if (!state.fairyResult || state.identityChange || state.error) return "";
    return (
      '<div class="dialog-backdrop"><div class="error-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">仙女查验结果</div><div class="small muted">仅供本人查看</div>' +
      (state.fairyResultRevealed
        ? '<div class="private-info">' +
          esc(state.fairyResult.information) +
          "</div>" +
          btn("primary", "acknowledgeFairyResult", "记住了，遮盖结果", null, state.busy)
        : '<div class="private-info muted">结果已遮盖，请确认周围无人查看。</div>' +
          btn("primary", "revealFairyResult", "查看查验结果", null, state.busy)) +
      "</div></div>"
    );
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
        : state.loading || state.busy || state.hasPendingRequest
          ? "pending"
          : state.serverConnected
            ? "online"
            : "offline";
    var label =
      !state.network || state.needsLogin
        ? "连接异常"
        : state.loading || state.busy || state.hasPendingRequest
          ? "正在同步"
          : state.serverConnected
            ? "连接正常"
            : "连接未确认";
    return (
      '<div class="brand"><span class="brand-mark">桌边助手</span>' +
      '<div class="brand-actions">' +
      (state.room
        ? btn("switch-table", "returnHome", "回首页", null, state.busy)
        : "") +
      '<button type="button" class="connection-button" data-action="connectionInfo" aria-label="' +
      esc(label) +
      '"><span class="connection-dot ' +
      dot +
      '"></span></button></div></div>'
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
    var html =
      '<div class="dialog-backdrop"><div class="error-dialog action-dialog" role="dialog" aria-modal="true">' +
      '<div class="dialog-title">' +
      (r.phase === "identity" ? "查看身份" : esc(state.actionLabel)) +
      "</div>";
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
    if (r.phase === "hunterTurn") html += '<div class="small muted">' + esc(r.operationStatus ? r.operationStatus.detail : "进入追加技能确认，上一阶段提交已完成。") + '</div>';
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
    var html = "";
    html +=
      '<form class="panel entry-panel"><label class="label" for="nickname">桌上昵称</label>' +
      '<input class="input" id="nickname" name="nickname" maxlength="16" data-input="name" value="' +
      esc(state.name) +
      '" placeholder="输入昵称" />' +
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
        btn("primary", "create", "创建 " + state.capacity + " 人房间", null, state.loading || state.busy);
    } else {
      html +=
        '<label class="field-title" for="code">房间码</label>' +
        '<input class="input room-input" id="code" name="code" inputmode="numeric" maxlength="6" data-input="code" value="' +
        esc(state.code) +
        '" placeholder="输入6位房间码" />' +
        btn("primary", "join", "加入房间", null, state.loading || state.busy);
    }
    html += "</form>";
    if (state.memberRooms.length) {
      html += '<div class="section-title">我的牌桌</div>';
      for (var k = 0; k < state.memberRooms.length; k++) {
        var m = state.memberRooms[k];
        html +=
          '<div class="member-room"><button type="button" class="secondary room-open" data-action="openRoom" data-code="' +
          esc(m.code) +
          '"' +
          (state.busy || state.loading ? " disabled" : "") +
          '><span class="member-room-code">' +
          esc(m.code) +
          '</span><span class="member-room-board">' +
          esc(m.boardName) +
          (m.capacity ? " · " + m.capacity + "人" : "") +
          "</span></button>" +
          (m.isHost
            ? btn("room-delete", "deleteRoom", "删除", { code: m.code }, state.busy || state.loading)
            : "") +
          "</div>";
      }
    }
    return html;
  }
  function viewRoom() {
    var r = state.room;
    var html = "";
    html +=
      '<div class="room-summary"><button type="button" class="copy-room" data-action="copyRoomCode"><span>房间 ' +
      esc(r.code) +
      '</span><span class="copy-label">复制</span></button><div class="summary-right">' +
      '<button type="button" class="copy-label room-invite" data-action="copyInviteLink">邀请链接</button><span class="summary-seat">' +
      (r.me.seat != null ? "你在 " + r.me.seat + " 号" : "未入座") +
      "</span></div></div>";
    html +=
      '<div class="row subline room-subline"><div class="room-board-info">' +
      (r.testRoom ? '<span class="small">测试房间 · 陪测已开启</span>' : "") +
      '<span class="room-board-name">' +
      esc(r.boardName) +
      " · " +
      r.capacity +
      '人</span><button type="button" class="room-rules-button" data-action="openRoomRules">配置说明</button></div>' +
      (r.me.isHost
        ? '<button type="button" class="room-rules-button" data-action="toggleRoomSettings">房间设置</button>'
        : '<span class="room-host-label">玩家</span>') +
      "</div>";
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
        btn("primary", "closeRoomRules", "知道了") +
        "</div></div></div>";
    }
    html +=
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
        : "") +
      "</div>";
    if (r.phase !== "lobby") {
      if (!state.revealed)
        html +=
          '<button type="button" class="identity-compact" data-action="reveal"' +
          (state.busy || !state.network ? " disabled" : "") +
          '><span>我的身份</span><span class="identity-compact-action">查看 ›</span></button>';
      else if (state.secret)
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
          btn("secondary", "reveal", "立即遮盖", null, state.busy || !state.network) +
          "</div>";
    }
    if (r.operationStatus || r.needsSubmission)
      html +=
        '<div class="action-entry" role="status"><div class="action-status-copy"><div>' +
        esc(r.operationStatus ? r.operationStatus.title : r.me.submitted ? "已提交，等待其他玩家" : "请完成本次操作") +
        '</div><div class="small muted">' + esc(r.operationStatus ? r.operationStatus.detail : "") + '</div></div>' +
        (r.needsSubmission && !r.me.submitted
          ? btn("secondary", "openAction", "立即操作", null, state.busy || state.actionLoading || !state.network)
          : "") +
        "</div>";
    if (state.latestResult && r.phase !== "lobby")
      html += '<div class="latest-result" role="status" aria-label="最近操作结果"><div class="small muted">最近操作结果 · 公开记录中可回看</div><div class="latest-result-title">' + esc(state.latestResult.text) + '</div><div class="history-detail">' + esc(state.latestResult.detail) + '</div></div>';
    if (r.phase === "lobby") {
      html +=
        '<div class="panel"><span class="muted small">' +
        esc(state.startHint) +
        "</span>" +
        btn("primary", "ready", r.me.ready ? "取消准备" : "我准备好了", null, state.busy) +
        (r.me.isHost
          ? btn("secondary", "start", "发放身份", null, state.busy || !state.network || !state.canStart)
          : "") +
        "</div>";
    }
    html +=
      '<div class="section-title">座位<span class="small muted">' +
      (r.phase === "lobby" ? "点空位换座" : "金色为队员，「你」为自己") +
      "</span></div>" +
      '<div class="seats">';
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      html +=
        '<button type="button" class="seat' +
        (s.mine ? " mine" : "") +
        (s.inTeam ? " team" : "") +
        (s.selected ? " selected" : "") +
        '" data-action="seat" data-seat="' +
        s.seat +
        '"' +
        (seatDisabled(s) ? " disabled" : "") +
        '><span class="seat-number">' +
        s.seat +
        '<span class="seat-flag">' +
        (s.mine ? "你" : s.host ? "房主" : "") +
        '</span></span><span class="seat-name">' +
        esc(s.name) +
        (s.alive === false ? " · 已出局" : "") +
        '</span><span class="seat-meta">' +
        esc(seatMeta(s)) +
        "</span></button>";
    }
    html += "</div>";
    if (r.phase === "lobby") {
      html += btn("leave-button", "leave", "离开房间", null, state.busy);
    } else {
      if (r.phase === "proposal" && !r.canUseTools && !r.flexible)
        html +=
          '<div class="panel"><div class="label">本轮需要 ' +
          r.teamSize +
          ' 人</div><span class="muted">' +
          (r.leader === r.me.seat ? "点座位选人，再提交队伍" : "等待队长选人") +
          '</span><div class="team-line">当前队伍：' +
          esc(state.teamText) +
          "</div>" +
          (r.leader === r.me.seat
            ? btn(
                "primary",
                "propose",
                "提交队伍（已选 " + state.selected.length + " / " + r.teamSize + "）",
                null,
                state.busy || state.selected.length !== r.teamSize,
              )
            : "") +
          "</div>";
      if (
        r.phase === "teamVote" ||
        r.phase === "quest" ||
        r.phase === "teamResult"
      )
        html +=
          '<div class="panel"><span class="label">' +
          (r.team.length ? "任务队伍 " + esc(state.teamText) + " 号" : "全员投票") +
          '</span><span class="muted">' +
          (r.phase === "teamVote" ? "全员表决，结算后公开票型" : "仅公开票数，不公开出牌人") +
          "</span></div>";
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
              : (r.flexible || r.assisted || r.offlineAssassination) && r.phase === "ended"
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
      if (r.canUseTools) {
        html +=
          '<div class="panel host-panel"><div class="label">房主操作</div>' +
          (r.knights
            ? '<div class="small muted">第' +
              r.knights.round +
              "轮 · 仙女" +
              r.knights.fairy +
              "号 · B牌剩余" +
              r.knights.remainingCards +
              '张</div><div class="small muted">再次发起技能或任务会自动进入新一轮；新身份技能随之生效。</div>'
            : "") +
          '<div class="tool-actions">' +
          btn("secondary", "openTool", "投票", { kind: "vote" }, state.busy) +
          btn("secondary", "openTool", "做任务", { kind: "quest" }, state.busy) +
          (r.knights
            ? btn("secondary", "openTool", "使用技能", { kind: "skills" }, state.busy) +
              btn("secondary", "openTool", "身份转换", { kind: "conversion" }, state.busy) +
              btn("secondary", "openTool", "仙女查验", { kind: "fairy" }, state.busy)
            : "") +
          (r.hasReverse && !r.knifeOffline
            ? btn("secondary", "openTool", "刀逆仆", { kind: "reverseStrike" }, state.busy)
            : "") +
          "</div>";
        if (r.operationProgress) {
          html +=
            '<div class="operation-progress"><div class="progress-heading"><span>当前操作进度</span><span>' +
            r.operationProgress.completed +
            " / " +
            r.operationProgress.total +
            " 已完成</span></div>";
          for (var q = 0; q < (r.operationProgress.players || []).length; q++) {
            var pp = r.operationProgress.players[q];
            if (!pp.required) continue;
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
      } else if (r.flexible && r.phase === "tools")
        html += '<div class="panel"><div class="label">等待房主发起操作</div></div>';
      if (state.questSummary.total)
        html +=
          '<div class="quest-summary"><span class="small muted">任务结果</span>' +
          '<span class="quest-summary-item"><span class="quest-result-icon success">✓</span><span>成功 ' +
          state.questSummary.success +
          '</span></span><span class="quest-summary-item"><span class="quest-result-icon failure">×</span><span>失败 ' +
          state.questSummary.failure +
          "</span></span></div>";
      if (state.history.length) html += '<div class="section-title">公开记录</div>';
      for (var hh = 0; hh < state.history.length; hh++) {
        var h = state.history[hh];
        html +=
          '<div class="history-row"><div class="history-title">' +
          (h.questResult
            ? '<span class="quest-result-icon ' +
              h.questResult +
              '">' +
              (h.questResult === "success" ? "✓" : "×") +
              "</span>"
            : "") +
          "<span>" +
          esc(h.text) +
          "</span></div>";
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
          if (h.teamLabel)
            html += '<div class="history-team">队伍 · ' + esc(h.teamLabel) + "</div>";
        } else if (h.cards) {
          html +=
            '<div class="history-team">队伍 · ' +
            esc(h.teamLabel) +
            '</div><div class="history-cards">' +
            h.cards
              .map(function (c) {
                return (
                  '<div class="history-card-count"><span>' +
                  esc(c.label) +
                  '</span><span class="history-count">' +
                  c.count +
                  "</span><span>张</span></div>"
                );
              })
              .join("") +
            "</div>";
        } else
          html += '<div class="muted small history-detail">' + esc(h.detail) + "</div>";
        html += "</div>";
      }
    }
    if (r.canUseTools)
      html +=
        '<div class="finish-game-footer">' +
        btn("finish-game-button", "finishTools", "结束本局", null, state.busy) +
        "</div>";
    html += viewHostBar();
    return html;
  }
  function viewHostBar() {
    var r = state.room;
    if (!r.canUseTools || !r.hasActiveOperation || r.phase === "offlineFinal")
      return "";
    if (r.closeWaiting) return '<div class="host-action-bar"><div class="host-action-bar-inner"><div class="host-waiting-copy small muted">' + esc(state.settleHint) + '<div>收齐自动结算</div></div>' +
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
        (s.pendingKick ? btn("secondary", "retryKick", "重试确认移出结果", null, s.busy) : btn("secondary", "retrySettings", "重新加载")) +
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
      html += '<div class="settings-section-title">房间配置</div><div class="settings-section">';
      if (room.phase === "lobby") {
        html +=
          '<div class="settings-row"><span>人数</span><select class="settings-select" data-change="settingsCapacity"' +
          (s.busy || s.pendingKick ? " disabled" : "") +
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
          (s.busy || s.pendingKick ? " disabled" : "") +
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
      html +=
        "</div><div class=\"settings-help\">" +
        (room.phase === "lobby"
          ? "保存人数或板子变更后，全员需要重新准备。"
          : "对局中不能修改人数和板子。") +
        "</div>";
      if (s.boardId === "knights") {
        html +=
          '<div class="settings-section-title">信息公开</div><div class="settings-section"><div class="settings-row"><span><span>公开技能过程</span><span class="settings-caption">' +
          (s.visible ? "保存后所有玩家可见" : "仅公示最终结果") +
          "</span></span>" +
          '<input type="checkbox" data-change="settingsVisibility"' +
          (s.visible ? " checked" : "") +
          (s.busy || s.pendingKick ? " disabled" : "") +
          ' /></div></div><div class="settings-help">开启后公开出手人、目标等过程。最终出局和复活结果始终公示，新身份仅本人可见。</div>';
      }
      var transfers = room.players.filter(function (p) {
        return p.seat !== room.me.seat;
      });
      html += '<div class="transfer-entry"><select class="secondary" data-change="settingsTransfer"' +
        (s.busy || s.pendingKick || !transfers.length ? " disabled" : "") + '><option value="" disabled selected>移交房主</option>';
      transfers.forEach(function (player) {
        html += '<option value="' + player.seat + '">' + player.seat + '号 · ' + esc(player.name) + '</option>';
      });
      html += '</select><div class="settings-help">' +
        (transfers.length ? "任意阶段均可移交，新房主立即接管流程。" : "其他玩家入座后可移交房主。") + '</div></div>';
      html += '<div class="transfer-entry"><select class="secondary kick-entry" data-change="settingsKick"' +
        (s.busy || s.pendingKick || !room.canKick || !transfers.length ? " disabled" : "") + '><option value="" disabled selected>移出玩家</option>';
      transfers.forEach(function (player) {
        html += '<option value="' + player.seat + '">' + player.seat + '号 · ' + esc(player.name) + '</option>';
      });
      html += '</select><div class="settings-help">' + (typeof room.canKick !== "boolean" ? "服务端尚未支持移出玩家，请重启服务并刷新页面。" : !room.canKick ? "对局进行中不能移出玩家，请在本局结束后操作。" : transfers.length ? "选择玩家后需确认，其他成员和对局记录保留。" : "暂无可移出的玩家。") + '</div></div>';
      if (s.pendingKick) html += btn("secondary", "retryKick", "重试确认移出结果", null, s.busy);
      html +=
        '<div class="settings-footer">' +
        btn(
          "primary",
          "settingsSave",
          s.busy ? (s.pendingKick ? "正在移出…" : "正在处理…") : s.dirty ? "保存设置" : "设置已保存",
          null,
          s.busy || s.pendingKick || !s.dirty,
        ) +
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
  // Keep option selection in a themed, keyboard-accessible modal above settings.
  var optionDialog = null;
  function enhanceSelects(root) {
    root.querySelectorAll("select[data-change]").forEach(function (select) {
      var key = select.dataset.change;
      var label = key === "settingsKick" ? "要移出的玩家" : key === "settingsTransfer" ? "新房主" : /Capacity$/.test(key) ? "人数" : "板子";
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
    dialog.innerHTML = '<div class="option-header"><div><div class="settings-eyebrow">房间配置</div><h2 id="option-title">选择' + label +
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
      '<div class="page' +
      (hasHostBar ? " has-host-bar" : "") +
      '">' +
      viewBrand() +
      (state.loading ? '<div class="status">正在连接牌桌…</div>' : "") +
      viewErrorDialog() +
      viewActionDialog() +
      viewToolDialog() +
      (state.notice ? '<div class="notice">' + esc(state.notice) + "</div>" : "") +
      (state.room ? viewRoom() : viewEntry()) +
      "</div>" +
      viewSettingsDialog();
    enhanceSelects(next);
    patchDOM(app, next);
    validateOptionDialog();
  }

  // ===== event delegation =====
  var ACTIONS = {
    returnHome: returnHome,
    connectionInfo: connectionInfo,
    retry: retry,
    dismissError: function () {
      setState({ error: "", recoverableError: false, hasPendingRequest: false });
    },
    reveal: reveal,
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
      switchEntry(el.dataset.mode);
    },
    toggleRules: function () {
      setState({ showRules: !state.showRules });
    },
    create: create,
    join: join,
    openRoom: function (el) {
      openRoom(el.dataset.code);
    },
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
      confirmCommand(
        "结束本局？",
        state.room && state.room.hasActiveOperation
          ? "当前未结算的操作将作废。保留已结算记录，以线下胜负为准。"
          : "保留已结算记录，以线下胜负为准。结束后可以同房重新发牌。",
        "finishTools",
        { replace: true },
      );
    },
    retrySettings: loadSettings,
    settingsSave: settingsSave,
    settingsBack: settingsBack,
    retryKick: sendKick,
    transferFromSettings: function (el) {
      transferFromSettings(Number(el.dataset.seat));
    },
  };
  var CHANGES = {
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
      if (!state.settings || state.settings.busy || !state.settings.room) return;
      if (state.settings.room.phase !== "lobby") return;
      updateSettingsChoices(Number(el.value), state.settings.boardId);
    },
    settingsBoard: function (el) {
      if (!state.settings || state.settings.busy || !state.settings.room) return;
      if (state.settings.room.phase !== "lobby") return;
      var b = state.settings.choices.filter(function (x) {
        return x.id === el.value;
      })[0];
      if (b) updateSettingsChoices(state.settings.capacity, b.id);
    },
    settingsVisibility: function (el) {
      if (!state.settings || state.settings.busy) return;
      setSettings({ visible: el.checked });
      updateSettingsDirty();
    },
  };
  var INPUTS = {
    name: function (el) {
      state.name = el.value;
    },
    code: function (el) {
      var v = el.value.replace(/\D/g, "").slice(0, 6);
      state.code = v;
      if (el.value !== v) el.value = v;
    },
  };

  app.addEventListener("click", function (e) {
    var picker = e.target.closest("[data-option-trigger]");
    if (picker && !picker.disabled) {
      var key = picker.dataset.optionTrigger;
      var select = app.querySelector('select[data-change="' + key + '"]');
      if (select) openOptions(select, key === "settingsKick" ? "要移出的玩家" : key === "settingsTransfer" ? "新房主" : /Capacity$/.test(key) ? "人数" : "板子");
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
  });

  // ===== lifecycle =====
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      foreground = false;
      clearTimeout(timer);
      mask();
    } else {
      foreground = true;
      if (alive) {
        if (roomCode) refresh().catch(handleError);
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
    render();
  });

  // ===== boot =====
  var codeMatch = /(?:\?|&)code=(\d{6})/.exec(location.search || "");
  if (codeMatch) inviteCode = codeMatch[1];
  state.name = storage.get("nickname") || "";
  state.code = inviteCode || storage.get("roomCode") || "";
  render();
  bootstrap();
})();