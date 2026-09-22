const api = require("../../api");
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
const CHOICES = {
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
  if (faction.includes("好人")) return "good";
  if (faction.includes("坏人")) return "evil";
  if (faction.includes("盗贼")) return "third";
  return "";
}
function voteSummary(votes) {
  return (votes.some((v) => v.approve === null) ? [true, false, null] : [true, false])
    .map((approve) => {
      const seats = votes
        .filter((v) => v.approve === approve)
        .map((v) => v.seat)
        .sort((a, b) => a - b);
      return `${seats.length}票${approve === null ? "弃权" : approve ? "赞成" : "反对"}：${seats.length ? seats.join("，") : "无"}`;
    })
    .join("\n");
}
function toolHistory(h, key) {
  if (["skillDetail", "skillResult", "toolCutoff"].includes(h.kind))
    return { key, text: h.text, detail: h.detail || "" };
  if (h.kind === "variant") return { key, text: h.text, detail: "" };
  if (h.kind === "toolVote")
    return {
      key,
      text: "投票" + (h.approved ? "通过" : "未通过") + (h.earlyClosed ? " · 提前截止" : ""),
      voteGroups: (h.votes.some((v) => v.approve === null) ? [true, false, null] : [true, false]).map((approve) => {
        const seats = h.votes
          .filter((v) => v.approve === approve)
          .map((v) => v.seat)
          .sort((a, b) => a - b);
        return {
          label: approve === null ? "弃权" : approve ? "赞成" : "反对",
          count: seats.length,
          seats: seats.length ? seats.join("、") + " 号" : "无",
          tone: approve === null ? "abstain" : approve ? "approve" : "reject",
        };
      }),
      teamLabel: h.team.length ? h.team.join("、") + " 号" : "",
      detail:
        (h.team.length ? `队伍 ${h.team.join("、")}号\n` : "") +
        voteSummary(h.votes),
    };
  if (h.kind === "toolQuest")
    return {
      key,
      text: (h.success ? "任务成功" : "任务失败"),
      questResult: h.success ? "success" : "failure",
      teamLabel: h.team.join("、") + " 号",
      cards: Object.entries(
        h.counts || { success: h.team.length - h.fails, fail: h.fails },
      )
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => ({
          label:
            {
              success: "成功",
              fail: "失败",
              thiefFail: "盗贼失败",
              magic: "魔法",
            }[kind] || kind,
          count,
          tone: kind === "success" ? "success" : ["fail", "thiefFail"].includes(kind) ? "failure" : "",
        })),
      detail: h.counts
        ? `${h.team.join("、")}号 · 成功${h.counts.success} / 失败${h.counts.fail} / 盗贼失败${h.counts.thiefFail} / 魔法${h.counts.magic}`
        : `${h.team.join("、")}号 · ${h.fails}张失败票`,
    };
  if (h.kind === "toolKnife")
    return {
      key,
      text: "刀梅林",
      detail: `${h.target === 0 ? "空刀" : h.target + "号"} · ${h.hit ? (h.target === 0 ? "空刀命中" : "命中梅林") : h.target === 0 ? "空刀未命中" : "未命中梅林"}`,
    };
  if (h.kind === "toolReverse")
    return {
      key,
      text: "刀逆仆已结算",
      detail: "结果仅向相关玩家展示，可继续发起其他操作",
    };
  if (h.kind === "toolOffline")
    return { key, text: "线下刀人已完成", detail: "以线下结算为准" };
  if (h.kind === "toolCanceled")
    return { key, text: h.text || "未结算的操作已作废", detail: h.detail || "未公开或计入本次提交" };
  return null;
}
Page({
  data: {
    loading: true,
    busy: false,
    error: "",
    reconnecting: false,
    recoverableError: false,
    hasPendingRequest: false,
    notice: "",
    room: null,
    latestResult: null,
    historyExpanded: false,
    focusedHistoryKey: null,
    seatsExpanded: true,
    historyFilter: "all",
    visibleHistory: [],
    questTimeline: [],
    boards: [],
    availableBoards: [],
    entryMode: "join",
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
    toolSeats: [],
    toolThreshold: 1,
    showRoomSettings: false,
    boardIndex: 0,
    capacityIndex: 1,
    memberRooms: [],
    visibleMemberRooms: [],
    roomListFilter: "all",
    roomMenu: null,
    noteRoom: null,
    roomNoteDraft: "",
    undoRoom: null,
    roomFilters: [{id:"all",label:"全部"},{id:"playing",label:"进行中"},{id:"lobby",label:"待开局"},{id:"ended",label:"已结束"},{id:"unavailable",label:"已失效"}],
    boardId: "classic",
    boardName: "阿瓦隆 · 经典基础",
    boardRoleConfiguration: [],
    name: "",
    code: "",
    capacity: 6,
    capacities: [5, 6, 7, 8, 9, 10, 11, 12],
    selected: [],
    revealed: false,
    secret: null,
    choiceButtons: [],
    targetButtons: [],
    network: true,
    serverConnected: false,
    needsLogin: false,
  },
  onLoad(query) {
    this.alive = true;
    this.foreground = true;
    this.generation = 0;
    this.inviteCode = /^\d{6}$/.test(query.code || "") ? query.code : null;
    this.setData({
      name: wx.getStorageSync("nickname") || "",
      entryMode: "join",
      code: query.code || wx.getStorageSync("roomCode") || "",
    });
    this.networkListener = (res) => {
      this.setData({ network: res.isConnected });
      if (!res.isConnected) {
        this.mask();
        this.handleError(new Error("连接已断开"));
      } else if (this.data.reconnecting) {
        this.recoverConnection();
      }
    };
    wx.onNetworkStatusChange(this.networkListener);
    this.bootstrap();
  },
  onShow() {
    this.foreground = true;
    if (this.alive) {
      if (this.data.reconnecting || this.pending) this.recoverConnection();
      else if (this.roomCode) this.refresh().catch((e) => this.handleError(e));
      this.schedule();
    }
  },
  onHide() {
    this.foreground = false;
    clearTimeout(this.timer);
    this.mask();
  },
  onUnload() {
    clearTimeout(this.undoRoomTimer);
    this.alive = false;
    this.foreground = false;
    clearTimeout(this.timer);
    wx.offNetworkStatusChange(this.networkListener);
    this.mask();
  },
  updateChangedData(values) {
    const changed = {};
    for (const key of Object.keys(values)) {
      if (JSON.stringify(this.data[key]) !== JSON.stringify(values[key]))
        changed[key] = values[key];
    }
    if (Object.keys(changed).length) this.setData(changed);
  },
  mask() {
    this.generation = (this.generation || 0) + 1;
    this.actionGeneration = (this.actionGeneration || 0) + 1;
    this.updateChangedData({
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
      choiceButtons: [],
      targetButtons: [],
    });
  },
  buzz(type = "light") {
    try {
      if (wx.vibrateShort) wx.vibrateShort({ type });
    } catch (e) {}
  },
  async bootstrap() {
    this.setData({ loading: true, error: "" });
    try {
      await api.login();
      const { boards } = await api.request("/api/boards");
      this.setData({
        boards,
        capacities: [
          ...new Set(
            boards.filter((b) => b.available).flatMap((b) => b.counts),
          ),
        ].sort((a, b) => a - b),
        needsLogin: false,
      });
      this.selectCapacity(this.data.capacity);
      const entry = wx.getStorageSync("pendingEntry");
      if (entry) {
        this.pending = entry;
        await this.executePending();
        return;
      }
      await this.loadRooms();
      const code = wx.getStorageSync("roomCode");
      if (code && (!this.inviteCode || this.inviteCode === code)) {
        this.roomCode = code;
        await this.refresh();
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ loading: false });
      this.schedule();
    }
  },
  async loadRooms() {
    const { rooms } = await api.request("/api/me/rooms");
    if (this.alive) {
      this.connectionRecovered();
      const items = roomListItems(rooms);
      this.setData({ memberRooms: items, visibleMemberRooms: items.filter(r => this.data.roomListFilter === "all" || r.status === this.data.roomListFilter), serverConnected: true, network: true });
    }
  },
  handleError(e) {
    this.mask();
    if (e.status === 403 && e.message === "你已被房主移出房间") {
      this.pending = null;
      this.clearRoom();
      this.setData({ notice: e.message, hasPendingRequest: false });
      this.loadRooms().catch(error => this.handleError(error));
      return;
    }
    if ((!e.status || e.status >= 500 || e.status === 429) && e.retryable !== false) {
      this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
      if (e.status === 429) this.rateLimitUntil = Date.now() + (e.retryAfterMs || 60000);
      this.setData({ reconnecting: true, error: "", recoverableError: false, serverConnected: false,
        hasPendingRequest: !!this.pending,
        notice: e.status === 429 && !this.pending ? "请求较多，冷却后会自动刷新" : "" });
      this.schedule();
      return;
    }
    this.setData({ reconnecting: false });
    this.setData({
      error: e.message,
      serverConnected: !!e.status && e.status < 500 && e.status !== 401,
      needsLogin: e.status === 401,
      recoverableError:
        !e.status || e.status === 401 || e.status === 429 || e.status >= 500,
      hasPendingRequest: !!this.pending,
    });
  },
  blockScroll() {},
  dismissError() {
    this.setData({
      error: "",
      recoverableError: false,
      hasPendingRequest: false,
    });
  },
  connectionRecovered() {
    this.reconnectAttempts = 0;
    this.updateChangedData({ reconnecting: false });
  },
  async recoverConnection() {
    if (!this.alive || !this.foreground || this.recovering || this.data.busy || this.data.loading || this.data.needsLogin) return;
    if (Date.now() < (this.rateLimitUntil || 0)) { this.schedule(); return; }
    this.recovering = true;
    try {
      await this.retry();
    } finally {
      this.recovering = false;
      this.schedule();
    }
  },
  schedule() {
    clearTimeout(this.timer);
    if (!this.foreground || !this.alive || (!this.roomCode && !this.data.reconnecting)) return;
    const delay = this.data.reconnecting
      ? Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(0, (this.reconnectAttempts || 1) - 1))) * (0.8 + Math.random() * 0.2)
      : 2500;
    this.timer = setTimeout(async () => {
      if (this.data.reconnecting) {
        if (this.data.network) await this.recoverConnection();
      } else if (this.roomCode && !this.data.busy && !this.pending && !this.data.error && !this.recovering) {
        try { await this.refresh(); } catch (e) { this.handleError(e); }
      }
      this.schedule();
    }, Math.max(delay, (this.rateLimitUntil || 0) - Date.now()));
  },
  async refresh() {
    if (!this.roomCode) return;
    const code = this.roomCode,
      sequence = (this.refreshSequence = (this.refreshSequence || 0) + 1);
    let room;
    try {
      room = await api.request("/api/rooms/" + code);
    } catch (e) {
      if (
        !this.alive ||
        code !== this.roomCode ||
        sequence !== this.refreshSequence
      )
        return;
      if (e.status === 404 || e.status === 403) {
        this.clearRoom();
        this.setData({
          notice: e.status === 404 ? "牌桌已删除或不存在" : e.message === "你已被房主移出房间" ? e.message : "你已离开这张牌桌",
        });
        await this.loadRooms();
        return;
      }
      throw e;
    }
    if (
      !this.alive ||
      code !== this.roomCode ||
      sequence !== this.refreshSequence
    )
      return;
    this.connectionRecovered();
    const stageChanged = this.data.room?.stage !== room.stage;
    // Haptic nudge on game-stage transitions; stronger when it is now our turn.
    if (stageChanged && this.data.room)
      this.buzz(room.needsSubmission && !room.me.submitted ? "medium" : "light");
    const selected = stageChanged ? [] : this.data.selected;
    const privacyUpdate = stageChanged
      ? {
          fairyResult: null,
          fairyResultRevealed: false,
          identityChange: null,
          identityChangeRevealed: false,
          revealed: false,
          secret: null,
          choiceButtons: [],
          targetButtons: [],
          selected,
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
        }
      : {};
    // Invalidate pending identity reads before committing the new stage in one update.
    if (stageChanged) {
      this.generation = (this.generation || 0) + 1;
      this.actionGeneration = (this.actionGeneration || 0) + 1;
    }
    const seats = Array.from({ length: room.capacity }, (_, i) => {
      const seat = i + 1,
        p = room.players.find((p) => p.seat === seat);
      return {
        seat,
        name: p ? p.name : "空位",
        occupied: !!p,
        alive: p?.alive !== false,
        ready: !!p?.ready,
        mine: seat === room.me.seat,
        host: !!p?.isHost,
        inTeam: room.team.includes(seat),
        selected: selected.includes(seat),
      };
    });
    const history = room.history.map(
      (h, i) =>
        toolHistory(h, i) || {
          key: i,
          questResult:
            h.kind === "quest" ? (h.success ? "success" : "failure") : "",
          text:
            h.kind === "team"
              ? `第${h.round}轮 · ${h.leader}号组队 ${h.team.join("、")}：${h.approved ? "通过" : "否决"}`
              : h.kind === "quest"
                ? "任务结算"
                : "最终行动",
          detail:
            h.kind === "team"
              ? voteSummary(h.votes)
              : h.kind === "quest"
                ? `第${h.round}轮 · ${h.success ? "任务成功" : "任务失败"} · ${h.fails}张失败`
                : `最终目标 ${h.target}号 · ${h.hit ? "命中梅林" : "未命中梅林"}`,
        },
    );
    history.forEach((entry, i) => {
      const source = room.history[i];
      entry.category = ["toolVote", "team"].includes(source.kind) ? "vote"
        : ["toolQuest", "quest"].includes(source.kind) ? "quest"
        : ["skillDetail", "skillResult", "variant", "toolReverse", "toolKnife", "assassination"].includes(source.kind) ? "skill" : "other";
      entry.recordLabel = `记录 ${i + 1}`;
      const time = source.startedAt ? new Date(source.startedAt) : null;
      entry.timeLabel = time && !Number.isNaN(time.getTime()) ? `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}` : "";
      entry.resultTone = entry.questResult || (["toolVote", "team"].includes(source.kind) ? (source.approved ? "success" : "failure") : "");
      if (source.kind === "skillResult" && Array.isArray(source.eliminated) && Array.isArray(source.redrawn) && Array.isArray(source.restored) && Array.isArray(source.out)) {
        entry.historyText = "技能结算";
        entry.historyNote = source.text.includes("提前截止") ? "提前截止" : "";
        entry.resultRows = [["最终仍出局", source.out], ["本轮出局", source.eliminated], ["抽牌复活", source.redrawn], ["原牌复活", source.restored]]
          .filter(function (row, index) { return index !== 0 || row[1].length > 0; })
          .map(function (row) { return { label: row[0], value: row[1].length ? row[1].join("、") + " 号" : "无", final: row[0] === "最终仍出局" }; });
      }
      entry.latestDetail = entry.voteGroups ? voteSummary(source.votes) : entry.detail;
      entry.resultTeam = entry.voteGroups ? entry.teamLabel : "";
      entry.thresholdLabel = source.threshold ? `至少 ${source.threshold} 张失败票才失败` : "";
    });
    const historyExpanded = this.data.room?.code === room.code && this.data.room?.phase !== "lobby" && room.phase !== "lobby" ? this.data.historyExpanded : false;
    const historyFilter = historyExpanded ? this.data.historyFilter : "all";
    const actionEntryLabel = ({ identity: "查看身份", teamVote: "参与表决", quest: "提交任务牌" })[room.phase] || "完成本轮操作";
    this.updateChangedData({
      ...privacyUpdate,
      actionEntryLabel,
      seatsExpanded: room.phase !== "lobby" && this.data.room?.code === room.code ? this.data.seatsExpanded : true,
      historyExpanded,
      focusedHistoryKey: this.data.room?.code === room.code && this.data.room?.game === room.game && room.phase !== "lobby" ? this.data.focusedHistoryKey : null,
      historyFilter,
      visibleHistory: this.filteredHistory(history, historyExpanded, historyFilter),
      questTimeline: history.filter(h => h.questResult).map((h, i) => ({ ...h, number: i + 1 })),
      notice:
        this.data.notice === "请求较多，冷却后会自动刷新"
          ? ""
          : this.data.notice,
      room,
      canStart:
        room.players.length === room.capacity &&
        room.players.every((p) => p.ready),
      startHint:
        room.players.length < room.capacity
          ? `还差 ${room.capacity - room.players.length} 人入座 · ${room.players.filter((p) => !p.ready).length} 人未准备`
          : room.players.some((p) => !p.ready)
            ? `还差 ${room.players.filter((p) => !p.ready).length} 人准备`
            : "全员已准备，可以发放身份",
      canSettle:
        !!room.operationProgress &&
        room.operationProgress.total > 0 &&
        room.operationProgress.completed === room.operationProgress.total,
      settleHint: room.operationProgress
        ? room.operationProgress.completed < room.operationProgress.total
          ? `还差 ${room.operationProgress.total - room.operationProgress.completed} 人提交`
          : room.flexible ? "提交已收齐，正在同步结果" : "参与者已全部提交，可以结算"
        : "正在确认操作进度",
      seats,
      history,
      latestResult: history.filter((_, i) =>
        ["toolVote", "toolQuest", "skillResult", "toolReverse", "toolKnife", "toolOffline", "toolCanceled", "team", "quest", "assassination"].includes(room.history[i].kind) ||
        (room.history[i].kind === "variant" && (room.history[i].number || room.history[i].resultType === "conversion" || /^本轮(?:阵营转换|不转换)$/.test(room.history[i].text)))
      ).pop() || null,
      questSummary: {
        total: history.filter((h) => h.questResult).length,
        success: history.filter((h) => h.questResult === "success").length,
        failure: history.filter((h) => h.questResult === "failure").length,
      },
      roomBoards: this.data.boards.filter(
        (b) => b.available && b.counts.includes(room.capacity),
      ),
      roomBoardIndex: Math.max(
        0,
        this.data.boards
          .filter((b) => b.available && b.counts.includes(room.capacity))
          .findIndex((b) => b.id === room.board),
      ),
      roomCapacities: this.data.capacities.filter((n) =>
        room.players.every((p) => p.seat <= n),
      ),
      roomCapacityIndex: this.data.capacities
        .filter((n) => room.players.every((p) => p.seat <= n))
        .indexOf(room.capacity),
      teamText: room.team.join("、") || "尚未选择",
      error: "",
      network: true,
      serverConnected: true,
      needsLogin: false,
    });
    if (
      (!room.needsSubmission || room.me.submitted) &&
      (this.data.actionDialog || this.data.actionLoading)
    )
      this.closeAction();
    if (
      room.me.identityChanged &&
      !this.data.showRoomSettings &&
      this.foreground &&
      !this.data.identityChange
    )
      await this.showIdentityChange();
    if (
      room.me.fairyResultPending &&
      !room.me.identityChanged &&
      this.foreground &&
      !this.data.fairyResult
    )
      await this.showFairyResult();
    if (
      !room.me.identityChanged &&
      !room.me.fairyResultPending &&
      room.needsSubmission &&
      !room.me.submitted &&
      this.foreground &&
      this.promptedActionStage !== room.stage &&
      !this.data.actionLoading &&
      !this.data.toolType &&
      !this.data.showRoomRules &&
      !this.data.showRoomSettings
    )
      await this.openAction();
  },
  clearRoom() {
    clearTimeout(this.timer);
    this.refreshSequence = (this.refreshSequence || 0) + 1;
    this.mask();
    this.roomCode = null;
    wx.removeStorageSync("roomCode");
    this.setData({
      room: null,
      toolType: "",
      toolSeats: [],
      seats: [],
      history: [],
      latestResult: null,
      selected: [],
      code: "",
      error: "",
      entryMode: "join",
      showRoomRules: false,
      showRoomSettings: false,
    });
  },
  filterRooms(e) {
    const filter = e.currentTarget.dataset.filter;
    if (!this.data.roomFilters.some(f => f.id === filter)) return;
    this.setData({ roomListFilter: filter, visibleMemberRooms: this.data.memberRooms.filter(r => filter === "all" || r.status === filter) });
  },
  async refreshRooms() {
    if (this.data.busy || this.pending || this.data.loading) return;
    this.setData({ loading: true });
    try { await this.loadRooms(); } catch (e) { this.handleError(e); }
    finally { this.setData({ loading: false }); }
  },
  openRoomMenu(e) {
    if (this.data.busy || this.pending) return;
    this.setData({ roomMenu: this.data.memberRooms.find(r => r.code === e.currentTarget.dataset.code) || null });
  },
  closeRoomMenu() { if (!this.data.busy && !this.pending) this.setData({ roomMenu: null, noteRoom: null }); },
  inputRoomNote(e) { this.setData({ roomNoteDraft: e.detail.value }); },
  saveRoomNote() {
    if (!this.data.noteRoom) return;
    return this.mutate("/api/me/rooms/" + this.data.noteRoom.code, { action: "note", note: this.data.roomNoteDraft }, "entryNote");
  },
  undoRemoveRoom() {
    const undo = this.data.undoRoom;
    if (!undo || Date.now() >= undo.until) return;
    return this.mutate("/api/me/rooms/" + undo.code, { action: "restore" }, "entryRestore");
  },
  async roomMenuAction(e) {
    const room = this.data.roomMenu, kind = e.currentTarget.dataset.kind;
    if (!room || this.data.busy || this.pending) return;
    this.setData({ roomMenu: null });
    if (kind === "note") return this.setData({ noteRoom: room, roomNoteDraft: room.note || "" });
    if (kind === "hide") return this.mutate("/api/me/rooms/" + room.code, { action: "hide" }, "entryHide");
    if (kind === "delete" && room.isHost && room.available !== false)
      return this.deleteRoom({ currentTarget: { dataset: { code: room.code } } });
    if (kind === "leave" && room.canLeave) {
      if (!(await this.confirm("离开房间 " + room.code + "？", "你将退出成员关系并释放座位。房间不会解散；房主离开后仍保留管理权。"))) return;
      if (this.data.busy || this.pending) return;
      this.setData({ busy: true });
      try {
        const fresh = await api.request("/api/rooms/" + room.code);
        this.setData({ busy: false });
        await this.mutate("/api/rooms/" + room.code + "/commands", { type: "leave", stage: fresh.stage }, "leave");
      } catch (error) { this.handleError(error); }
      finally { this.setData({ busy: false }); }
    }
  },
  async deleteRoom(e) {
    if (this.data.busy || this.pending) return;
    const code = e.currentTarget.dataset.code;
    this.setData({ busy: true, error: "" });
    try {
      const room = await api.request("/api/rooms/" + code + "/management");
      if (!room.isHost) throw new Error("只有当前房主可以删除牌桌");
      if (
        !(await this.confirm(
          "解散房间 " + code + "？",
          "所有玩家将退出，牌桌与对局记录将被删除且无法恢复。进行中的对局不判胜负。",
        ))
      )
        return;
      if (!this.alive || !this.foreground) return;
      this.setData({ busy: false });
      await this.mutate(
        "/api/rooms/" + code + "/delete",
        { stage: room.stage },
        "delete",
      );
    } catch (e) {
      if (e.status === 404) {
        await this.loadRooms();
        this.setData({ notice: "牌桌已删除或不存在" });
      } else this.handleError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async returnHome() {
    if (this.pending) {
      this.setData({ error: "仍有未确认请求，请先重试原请求" });
      return;
    }
    this.clearRoom();
    this.setData({ notice: "" });
    try {
      await this.loadRooms();
    } catch (e) {
      this.handleError(e);
    }
  },
  async openRoom(e) {
    if (this.data.busy || this.pending || this.data.enteringCode || this.data.loading) return;
    const target = this.data.memberRooms.find(
      (r) => r.code === e.currentTarget.dataset.code,
    );
    if (target?.available === false) return;
    this.setData({ enteringCode: e.currentTarget.dataset.code });
    try {
      if (target?.isHost && target.seat === null && !target.isMember) {
        if (!this.data.name.trim()) {
          this.setData({
            code: target.code,
            entryMode: "join",
            error: "请填写昵称后重新入座",
          });
          return;
        }
        return await this.mutate(
          "/api/rooms/" + target.code + "/join",
          { name: this.data.name },
          "enter",
        );
      }
      return await this.mutate("/api/me/rooms/" + e.currentTarget.dataset.code, { action: "visit" }, "entryVisit");
    } finally {
      this.setData({ enteringCode: "" });
    }
  },
  inputName(e) {
    this.setData({ name: e.detail.value });
  },
  inputCode(e) {
    this.setData({ code: e.detail.value.replace(/\D/g, "").slice(0, 6) });
  },
  switchEntry(e) {
    if (this.data.busy || this.pending) return;
    this.setData({
      entryMode: e.currentTarget.dataset.mode,
      error: "",
      notice: "",
    }, () => { if (e.currentTarget.dataset.scroll) wx.pageScrollTo({ selector: ".entry-panel", duration: 250 }); });
  },
  filteredHistory(history, expanded, filter) {
    const entries = history.filter(h => filter === "all" || h.category === filter);
    return expanded ? entries.slice().reverse() : entries.slice(-3).reverse();
  },
  toggleSeats() {
    if (!this.data.room || this.data.room.phase === "lobby") return;
    this.setData({ seatsExpanded: !this.data.seatsExpanded });
  },
  toggleHistory() {
    const historyExpanded = !this.data.historyExpanded;
    this.setData({ historyExpanded, historyFilter: "all", visibleHistory: this.filteredHistory(this.data.history, historyExpanded, "all") });
  },
  filterHistory(e) {
    const historyFilter = e.currentTarget.dataset.filter;
    if (!["all", "vote", "quest", "skill", "other"].includes(historyFilter)) return;
    this.setData({ historyFilter, visibleHistory: this.filteredHistory(this.data.history, true, historyFilter) });
  },
  showLatestRecord() {
    const entry = this.data.latestResult;
    if (!entry) return;
    const room = this.data.room;
    const historyExpanded = this.data.historyExpanded || !this.data.history.slice(-3).some(h => h.key === entry.key);
    this.setData({ focusedHistoryKey: null }, () => {
      if (this.data.room?.code !== room?.code || this.data.room?.game !== room?.game) return;
      this.setData({
        historyExpanded,
        historyFilter: "all",
        focusedHistoryKey: entry.key,
        visibleHistory: this.filteredHistory(this.data.history, historyExpanded, "all"),
      }, () => {
        if (this.data.room?.code !== room?.code || this.data.room?.game !== room?.game) return;
        wx.pageScrollTo({ selector: `#history-record-${entry.key}`, duration: 250 });
      });
    });
  },
  showQuestRecord(e) {
    const entry = this.data.questTimeline.find(h => h.key === Number(e.currentTarget.dataset.key));
    if (!entry) return;
    wx.showModal({ title: `第 ${entry.number} 次任务 · ${entry.text}`, content: [entry.detail, entry.thresholdLabel].filter(Boolean).join("\n"), showCancel: false });
  },
  openHelp() {
    wx.navigateTo({ url: "/pages/help/help" });
  },
  openRoomRules() {
    this.setData({ showRoomRules: true });
  },
  openBoardDetails() {
    this.setData({ showRoomRules: false });
    const room = this.data.room;
    wx.navigateTo({
      url:
        "/pages/board-details/board-details?board=" +
        encodeURIComponent(room ? room.board : this.data.boardId) +
        "&capacity=" +
        (room ? room.capacity : this.data.capacity) +
        "&from=" + (room ? "room" : "create"),
    });
  },
  closeRoomRules() {
    this.setData({ showRoomRules: false });
  },
  toggleRoomSettings() {
    if (!this.data.room?.me.isHost || this.data.busy) return;
    this.mask();
    wx.navigateTo({
      url: "/pages/settings/settings?code=" + this.data.room.code,
    });
  },
  selectCapacity(capacity) {
    const availableBoards = this.data.boards.filter(
      (b) => b.available && b.counts.includes(capacity),
    );
    const b =
      availableBoards.find((b) => b.id === this.data.boardId) ||
      availableBoards[0];
    if (!b) return;
    this.setData({
      capacity,
      capacityIndex: this.data.capacities.indexOf(capacity),
      availableBoards,
      boardId: b.id,
      boardName: b.namesByCapacity?.[capacity] || b.name,
      boardRoleConfiguration: b.roleConfigurations?.[capacity] || [],
      boardIndex: availableBoards.indexOf(b),
      boardAssisted: b.mode === "assisted",
      });
  },
  pickBoard(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget?.dataset?.index ?? e.detail.value);
    const b = this.data.availableBoards[index];
    if (!b) return;
    this.setData({
      boardId: b.id,
      boardName: b.namesByCapacity?.[this.data.capacity] || b.name,
      boardRoleConfiguration: b.roleConfigurations?.[this.data.capacity] || [],
      boardIndex: index,
      boardAssisted: b.mode === "assisted",
      });
  },
  pickCapacity(e) {
    if (this.data.busy) return;
    const capacity =
      Number(e.currentTarget?.dataset?.capacity) ||
      this.data.capacities[Number(e.detail.value)];
    this.selectCapacity(capacity);
  },
  async mutate(path, data, after) {
    if (this.data.busy) return;
    if (this.pending) {
      if (this.data.reconnecting) return;
      this.setData({ error: "上次请求尚未确认，请先重试原请求" });
      return;
    }
    this.refreshSequence = (this.refreshSequence || 0) + 1;
    this.pending = { path, data, id: api.requestId(), after };
    // Only non-secret create/join requests survive an application restart.
    if (after === "enter") wx.setStorageSync("pendingEntry", this.pending);
    await this.executePending();
  },
  async executePending() {
    const pending = this.pending;
    if (!pending || this.data.busy) return;
    this.setData({ busy: true, busyAction: pending.after === "enter" ? "enter" : pending.data.type || pending.after, error: "", notice: "" });
    try {
      await api.login();
      const result = await api.request(
        pending.path,
        "POST",
        pending.data,
        pending.id,
      );
      this.pending = null;
      this.connectionRecovered();
      this.setData({
        serverConnected: true,
        hasPendingRequest: false,
        recoverableError: false,
      });
      if (pending.after === "enter") wx.removeStorageSync("pendingEntry");
      this.mask();
      if (pending.after === "enter" || pending.after === "entryVisit") {
        this.roomCode = result.code;
        wx.setStorageSync("roomCode", result.code);
        wx.setStorageSync("nickname", this.data.name);
      }
      if (["entryHide", "entryRestore", "entryNote"].includes(pending.after)) {
        this.setData({ roomMenu: null, noteRoom: null });
        if (pending.after === "entryHide") {
          const undo = { code: result.code, until: Date.now() + 8000 };
          this.setData({ undoRoom: undo, notice: "已从列表移除" });
          clearTimeout(this.undoRoomTimer);
          this.undoRoomTimer = setTimeout(() => { if (this.alive && this.data.undoRoom?.until === undo.until) this.setData({ undoRoom: null }); }, 8000);
        } else this.setData({ undoRoom: null, notice: pending.after === "entryNote" ? "个人备注已保存" : "已恢复牌桌记录" });
        await this.loadRooms();
      } else if (pending.after === "leave" || pending.after === "delete") {
        this.clearRoom();
        this.setData({
          notice: pending.after === "delete" ? "房间已解散" : "已离开房间",
        });
        await this.loadRooms();
      } else {
        this.setData({ notice: "" });
        await this.refresh();
      }
    } catch (e) {
      // Network/5xx uncertainty retains the exact command and idempotency key.
      if (e.status && e.status < 500 && e.status !== 401 && e.status !== 429) {
        this.pending = null;
        if (pending.after === "enter") wx.removeStorageSync("pendingEntry");
      }
      this.setData({ notice: "" });
      this.handleError(e);
    } finally {
      this.setData({ busy: false, busyAction: "" });
      this.schedule();
    }
  },
  async retry() {
    this.setData({ error: "", recoverableError: false });
    if (this.pending) return this.executePending();
    if (this.data.needsLogin || !this.data.boards.length)
      return this.bootstrap();
    try {
      this.setData({ loading: true });
      if (this.roomCode) await this.refresh();
      else await this.loadRooms();
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  submitEntry(e) {
    if (this.data.busy || this.data.loading) return;
    // Read the native form value: nickname autofill/security checks may skip input events.
    this.setData({ name: (e.detail.value.nickname || "").trim() });
    if (this.data.entryMode === "join") {
      this.setData({ code: (e.detail.value.code || "").trim() });
      return this.join();
    }
    return this.create();
  },
  create() {
    if (!this.data.name.trim()) return this.setData({ error: "请填写昵称" });
    this.mutate(
      "/api/rooms",
      {
        name: this.data.name,
        board: this.data.boardId,
        capacity: this.data.capacity,
      },
      "enter",
    );
  },
  join() {
    if (!this.data.name.trim() || !/^\d{6}$/.test(this.data.code))
      return this.setData({ error: "请填写昵称和6位房间码" });
    this.mutate(
      "/api/rooms/" + this.data.code + "/join",
      { name: this.data.name },
      "enter",
    );
  },
  cmd(type, extra = {}, after) {
    const r = this.data.room;
    if (r)
      this.mutate(
        "/api/rooms/" + r.code + "/commands",
        { type, stage: r.stage, ...extra },
        after,
      );
  },
  async seat(e) {
    const seat = Number(e.currentTarget.dataset.seat),
      r = this.data.room;
    if (r.phase === "lobby") {
      if (seat === r.me.seat) {
        return this.confirmCommand("站起围观？", "站起后释放座位并取消准备，你仍留在房间，可点击空位重新坐下。", "stand");
      }
      if (!this.data.seats.find((s) => s.seat === seat).occupied)
        this.cmd("seat", { seat });
    } else if (r.phase === "proposal" && r.leader === r.me.seat) {
      const selected = this.data.selected.includes(seat)
        ? this.data.selected.filter((s) => s !== seat)
        : [...this.data.selected, seat];
      this.setData({
        selected,
        seats: this.data.seats.map((s) => ({
          ...s,
          selected: selected.includes(s.seat),
        })),
      });
    }
  },
  configureBoard(e) {
    const b = this.data.roomBoards[Number(e.detail.value)];
    if (b)
      this.cmd("configure", { board: b.id, capacity: this.data.room.capacity });
  },
  configureCapacity(e) {
    const capacity = this.data.roomCapacities[Number(e.detail.value)];
    const boards = this.data.boards.filter(
      (b) => b.available && b.counts.includes(capacity),
    );
    const b = boards.find((b) => b.id === this.data.room.board) || boards[0];
    if (b) this.cmd("configure", { board: b.id, capacity });
  },
  ready() {
    this.cmd("ready", { ready: !this.data.room.me.ready });
  },
  async confirm(title, content) {
    return new Promise((resolve) =>
      wx.showModal({
        title,
        content,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    );
  },
  async confirmCommand(title, content, type, extra = {}) {
    const stage = this.data.room?.stage;
    if (!(await this.confirm(title, content))) return;
    if (!this.foreground || this.data.room?.stage !== stage) {
      this.setData({ error: "阶段已变化，请查看当前阶段后重新操作" });
      return;
    }
    this.cmd(type, extra);
  },
  async toggleSkillVisibility() {
    const visible = !this.data.room.showSkillDetails;
    if (visible)
      return this.confirmCommand(
        "公开技能过程？",
        "所有玩家将看到已结算技能的出手人、目标及过程；新身份牌面不公开。",
        "setSkillVisibility",
        { visible },
      );
    this.cmd("setSkillVisibility", { visible });
  },
  openTool(e) {
    const room = this.data.room;
    if (!room?.canUseTools || this.data.busy || this.pending) return;
    const toolType = e.currentTarget.dataset.kind;
    const toolSeats = ["vote", "quest"].includes(toolType)
      ? [...room.team]
      : [];
    this.toolStage = room.stage;
    this.setData({
      toolType,
      toolTitle:
        {
          skills: "使用技能",
          conversion: "身份转换",
          fairy: "仙女查验",
        }[toolType] || "",
      toolDescription:
        {
          skills:
            "全员同时提交，按车长顺序结算。再次发起会进入下一轮，新身份技能随之生效。",
          conversion: "抽取一张转换牌，按牌面决定兰斯洛特是否交换阵营。",
          fairy: "仅仙女持有者选择目标，私密查验并传递仙女。",
        }[toolType] || "",
      toolSeats,
      toolThreshold: 1,
      toolPlayers: room.players
        .filter((p) => toolType === "assassination" || p.alive !== false)
        .map((p) => ({
          ...p,
          selected: toolSeats.includes(p.seat),
        })),
    });
  },
  closeTool() {
    this.setData({ toolType: "" });
  },
  toggleToolSeat(e) {
    if (this.data.busy) return;
    const seat = Number(e.currentTarget.dataset.seat);
    const toolSeats =
      this.data.room.knights && this.data.toolType === "assassination"
        ? [seat]
        : this.data.toolSeats.includes(seat)
          ? this.data.toolSeats.filter((s) => s !== seat)
          : [...this.data.toolSeats, seat];
    this.setData({
      toolSeats,
      toolPlayers: this.data.toolPlayers.map((p) => ({
        ...p,
        selected: toolSeats.includes(p.seat),
      })),
    });
  },
  pickToolThreshold(e) {
    if (this.data.busy) return;
    const value = Number(e.currentTarget.dataset.value);
    if ([1, 2].includes(value)) this.setData({ toolThreshold: value });
  },
  async launchTool() {
    if (this.data.busy || this.pending) return;
    const room = this.data.room;
    if (!room || room.stage !== this.toolStage) {
      this.closeTool();
      this.setData({ error: "阶段已变化，请重新选择操作" });
      return;
    }
    const kind = this.data.toolType;
    const extra = {
      kind,
      team: [...this.data.toolSeats],
      threshold: this.data.toolThreshold,
      actor: this.data.toolSeats[0],
      replace: room.hasActiveOperation,
    };
    if (
      kind === "quest" &&
      (!extra.team.length || extra.threshold > extra.team.length)
    ) {
      this.setData({ error: "请选择任务队员，失败票门槛不能超过队员人数" });
      return;
    }
    if (
      room.hasActiveOperation &&
      !(await this.confirm(
        "作废当前操作并切换？",
        "当前尚未结算的提交将作废，已结算记录和玩家身份保留。",
      ))
    )
      return;
    if (!this.foreground || this.data.room?.stage !== room.stage) return;
    this.closeTool();
    this.cmd("beginActivity", extra);
  },
  async closeWaiting() {
    const policy = this.data.room?.closeWaiting;
    if (!policy) return;
    return this.confirmCommand(policy.title, policy.description, "closeWaiting", { confirm: true });
  },
  settleTool() {
    this.cmd("settleTool");
  },
  async cancelTool() {
    return this.confirmCommand(
      "作废当前操作？",
      "本次未结算的提交将作废，玩家身份和已结算记录保留。",
      "cancelActivity",
    );
  },
  async finishTools() {
    return this.confirmCommand(
      "结束本局？",
      this.data.room.hasActiveOperation
        ? "当前未结算的操作将作废。保留已结算记录，以线下胜负为准。"
        : "保留已结算记录，以线下胜负为准。结束后可以同房重新发牌。",
      "finishTools",
      { replace: true },
    );
  },
  async start() {
    return this.confirmCommand(
      "开始这一局？",
      "按当前人数随机分配身份，之后由房主按需发起投票、任务或刀人。",
      "start",
      { flexible: true },
    );
  },
  propose() {
    this.cmd("propose", { team: this.data.selected });
  },
  advance() {
    this.cmd("advance");
  },
  async terminate() {
    return this.confirmCommand(
      "终止本局？",
      "本局不判胜负。结束后可以在同一房间重新准备。",
      "terminate",
    );
  },
  async offline() {
    return this.confirmCommand(
      "转入线下结算？",
      "停止线上任务推进，在线下完成起刀、内奸及最终胜负。小程序不会代判。",
      "offline",
    );
  },
  async closeOffline() {
    return this.confirmCommand(
      "线下已结算完毕？",
      "记录线下操作完成，随后可继续发起其他操作。",
      "closeOffline",
      { keepPlaying: true },
    );
  },
  rematch() {
    this.cmd("rematch");
  },
  async leave() {
    if (this.data.busy || this.pending || !this.data.room) return;
    const room = this.data.room;
    if (
      !(await this.confirm(
        "离开房间？",
        room.me.isHost
          ? "离开仅释放座位，牌桌与房主身份保留，可从我的牌桌重新入座。"
          : "离开后将释放你的座位，牌桌保留。重新加入需要输入房间码。",
      ))
    )
      return;
    if (
      !this.foreground ||
      this.data.room?.code !== room.code ||
      this.data.room?.stage !== room.stage
    )
      return;
    this.cmd("leave", {}, "leave");
  },
  copyRoomCode() {
    const code = this.data.room?.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: "房间号已复制", icon: "success" }),
      fail: () =>
        this.handleError({ message: "复制失败，请再试一次", status: 400 }),
    });
  },
  connectionInfo() {
    const content =
      !this.data.network || this.data.needsLogin || !this.data.serverConnected
        ? "连接尚未确认，请检查网络或重试。"
        : this.data.busy || this.data.loading || this.pending
          ? "正在确认操作，请稍候。"
          : "最近一次服务器请求成功。";
    wx.showModal({ title: "连接状态", content, showCancel: false });
  },
  closeAction() {
    this.actionGeneration = (this.actionGeneration || 0) + 1;
    this.updateChangedData({
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
  },
  async openAction() {
    const room = this.data.room;
    if (
      this.pending ||
      !room?.needsSubmission ||
      room.me.submitted ||
      !this.foreground ||
      !this.data.network ||
      this.data.actionLoading
    )
      return;
    this.mask();
    const generation = this.actionGeneration;
    this.setData({ actionLoading: true });
    try {
      const response = await api.request(
        "/api/rooms/" + this.roomCode + "/private",
      );
      if (
        !this.alive ||
        !this.foreground ||
        generation !== this.actionGeneration ||
        this.data.room?.stage !== room.stage ||
        response.stage !== room.stage ||
        this.data.room.me.submitted
      )
        return;
      if (!response.action) return;
      this.promptedActionStage = room.stage;
      this.actionDraftStage = room.stage;
      const swapOptions = (response.action.choices || []).filter((v) =>
        /^swap:\d+:\d+$/.test(v),
      );
      const swapSeats = new Set(
        swapOptions.flatMap((v) => v.split(":").slice(1).map(Number)),
      );
      // Identity is fetched separately only after an explicit reveal tap.
      this.setData({
        actionDialog: true,
        actionLabel: response.action.label,
        stagedChoice: ["teamVote", "quest"].includes(room.phase),
        draftChoice: "",
        draftLabel: "",
        swapOptions,
        swapSeats: [],
        swapPlayers: (room.players || [])
          .filter((p) => swapSeats.has(p.seat))
          .map((p) => ({ seat: p.seat, name: p.name, selected: false })),
        actionChoices: (response.action.choices || [])
          .filter((v) => !swapOptions.includes(v))
          .map((value) => ({
            value,
            label:
              response.action.options?.find((o) => o.value === value)?.label ||
              CHOICES[value] ||
              value,
          })),
        actionTargets: response.action.targets || [],
      });
    } catch (e) {
      if (generation === this.actionGeneration && this.foreground)
        this.handleError(e);
    } finally {
      if (generation === this.actionGeneration)
        this.setData({ actionLoading: false });
    }
  },
  async revealActionIdentity() {
    if (this.data.actionSecret) {
      this.setData({ actionSecret: null });
      return;
    }
    const room = this.data.room;
    if (
      !this.data.actionDialog ||
      room?.phase !== "identity" ||
      room.me.submitted ||
      !this.foreground ||
      this.data.busy ||
      !this.data.network
    )
      return;
    const generation = this.actionGeneration;
    this.setData({ busy: true, busyAction: "actionIdentity" });
    try {
      const secret = await api.request(
        "/api/rooms/" + this.roomCode + "/private",
      );
      if (
        this.alive &&
        this.foreground &&
        this.data.actionDialog &&
        generation === this.actionGeneration &&
        this.data.room?.stage === room.stage &&
        secret.stage === room.stage &&
        !this.data.room.me.submitted
      ) {
        this.setData({
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
      if (generation === this.actionGeneration && this.foreground)
        this.handleError(e);
    } finally {
      this.setData({ busy: false, busyAction: "" });
    }
  },
  async reveal() {
    if (this.data.revealed) {
      this.mask();
      return;
    }
    if (this.data.busy || !this.data.network) return;
    const generation = ++this.generation,
      stage = this.data.room.stage;
    this.setData({ busy: true, busyAction: "identity", error: "" });
    try {
      const secret = await api.request(
        "/api/rooms/" + this.roomCode + "/private",
      );
      if (
        this.foreground &&
        this.alive &&
        generation === this.generation &&
        secret.stage === stage &&
        this.data.room.stage === stage
      ) {
        secret.factionTone = factionTone(secret.faction);
        this.setData({
          revealed: true,
          secret,
          choiceButtons: (secret.action?.choices || []).map((value) => ({
            value,
            label:
              secret.action.options?.find((o) => o.value === value)?.label ||
              CHOICES[value] ||
              value,
          })),
          targetButtons: secret.action?.targets || [],
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ busy: false, busyAction: "" });
    }
  },
  async showFairyResult() {
    const room = this.data.room;
    if (!room || this.fairyResultLoading) return;
    this.fairyResultLoading = true;
    const generation = this.generation;
    try {
      const secret = await api.request("/api/rooms/" + room.code + "/private");
      if (
        this.alive &&
        this.foreground &&
        this.generation === generation &&
        this.data.room?.code === room.code &&
        this.data.room?.stage === secret.stage &&
        this.data.room.me.fairyResultPending &&
        !this.data.identityChange &&
        secret.fairyResult
      ) {
        this.closeAction();
        this.setData({
          fairyResult: secret.fairyResult,
          fairyResultRevealed: false,
          revealed: false,
          secret: null,
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.fairyResultLoading = false;
    }
  },
  hidePrivatePreview() {
    this.setData({ fairyResultRevealed: false, identityChangeRevealed: false });
  },
  revealFairyResult() {
    if (this.data.busy || !this.foreground || !this.data.fairyResult) return;
    this.setData({ fairyResultRevealed: true });
  },
  async acknowledgeFairyResult() {
    if (
      this.data.busy || this.fairyAckConfirm ||
      !this.data.fairyResultRevealed ||
      !this.data.fairyResult
    )
      return;
    const result = this.data.fairyResult;
    const generation = this.generation;
    this.fairyAckConfirm = true;
    try {
      if (!(await this.confirm("关闭查验结果？", "关闭后不会再显示本次查验结果，请确认已记住。"))) return;
      if (!this.alive || !this.foreground || generation !== this.generation || this.data.fairyResult !== result || !this.data.fairyResultRevealed) return;
      this.setData({ fairyResult: null, fairyResultRevealed: false });
      return this.cmd("ackFairyResult", { revision: result.revision });
    } finally {
      this.fairyAckConfirm = false;
    }
  },
  async showIdentityChange() {
    const room = this.data.room;
    if (!room || this.identityChangeLoading) return;
    this.identityChangeLoading = true;
    const generation = this.generation;
    try {
      const secret = await api.request("/api/rooms/" + room.code + "/private");
      if (
        this.foreground &&
        this.alive &&
        this.generation === generation &&
        this.data.room?.code === room.code &&
        this.data.room?.stage === secret.stage &&
        this.data.room.me.identityChanged
      ) {
        this.closeAction();
        secret.factionTone = factionTone(secret.faction);
        this.setData({
          identityChange: secret,
          identityChangeRevealed: false,
          revealed: false,
          secret: null,
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.identityChangeLoading = false;
    }
  },
  revealChangedIdentity() {
    if (this.data.busy || !this.foreground || !this.data.identityChange) return;
    this.setData({ identityChangeRevealed: true });
  },
  acknowledgeIdentity() {
    if (this.data.busy || !this.data.identityChangeRevealed) return;
    const revision = this.data.identityChange?.identityRevision;
    if (revision === undefined) return;
    this.setData({ identityChange: null, identityChangeRevealed: false });
    this.cmd("ackIdentity", { revision });
  },
  toggleSwapSeat(e) {
    if (
      this.data.busy ||
      !this.data.network ||
      !this.foreground ||
      !this.data.actionDialog ||
      this.data.room?.stage !== this.actionDraftStage
    )
      return;
    const seat = Number(e.currentTarget.dataset.seat);
    if (!this.data.swapPlayers.some((p) => p.seat === seat)) return;
    const selected = this.data.swapSeats.includes(seat)
      ? this.data.swapSeats.filter((s) => s !== seat)
      : this.data.swapSeats.length < 2
        ? [...this.data.swapSeats, seat]
        : this.data.swapSeats;
    this.setData({
      swapSeats: selected,
      swapPlayers: this.data.swapPlayers.map((p) => ({
        ...p,
        selected: selected.includes(p.seat),
      })),
    });
  },
  async confirmSwap() {
    if (
      this.data.busy ||
      !this.data.network ||
      !this.foreground ||
      !this.data.actionDialog ||
      this.data.room?.stage !== this.actionDraftStage ||
      this.data.swapSeats.length !== 2
    )
      return;
    const seats = [...this.data.swapSeats].sort((a, b) => a - b);
    const value = this.data.swapOptions.find(
      (v) =>
        v
          .split(":")
          .slice(1)
          .map(Number)
          .sort((a, b) => a - b)
          .join(":") === seats.join(":"),
    );
    if (!value) return;
    return this.confirmCommand(
      "确认秘密换号？",
      `交换 ${seats[0]} 号与 ${seats[1]} 号。提交后不可更改。`,
      "submit",
      { value },
    );
  },
  confirmChoice() {
    if (
      this.data.busy ||
      !this.foreground ||
      !this.data.actionDialog ||
      !this.data.stagedChoice ||
      this.data.room?.stage !== this.actionDraftStage ||
      this.data.room.me.submitted ||
      !this.data.network
    )
      return;
    const value = this.data.draftChoice;
    if (!this.data.actionChoices.some((c) => c.value === value)) return;
    this.cmd("submit", { value });
  },
  async submitChoice(e) {
    const value = e.currentTarget.dataset.value;
    if (["teamVote", "quest"].includes(this.data.room?.phase)) {
      if (
        this.data.busy ||
        !this.foreground ||
        !this.data.actionDialog ||
        this.data.room.stage !== this.actionDraftStage
      )
        return;
      const choice = this.data.actionChoices.find((c) => c.value === value);
      if (choice)
        this.setData({ draftChoice: value, draftLabel: choice.label });
      return;
    }
    if (
      ["skillPrepare", "skillTurn", "paladinTurn", "hunterTurn", "fairy"].includes(
        this.data.room?.phase,
      )
    ) {
      const label =
        this.data.actionChoices.find((c) => c.value === value)?.label || value;
      return this.confirmCommand(
        "确认使用技能？",
        label + "。提交后不可更改。",
        "submit",
        { value },
      );
    }
    this.cmd("submit", { value });
  },
  async submitTarget(e) {
    const seat = Number(e.currentTarget.dataset.seat);
    return this.confirmCommand(
      "确认提交？",
      `提交 ${seat} 号为最终目标，确认后不可更改。`,
      "submit",
      { value: seat },
    );
  },
  onShareAppMessage() {
    return {
      title: "桌边助手 · 一起入座",
      path: "/pages/table/table?code=" + (this.roomCode || ""),
      imageUrl: "/assets/share-cover.jpg",
    };
  },
});
