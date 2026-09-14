const api = require("../../api");
const CHOICES = {
  confirm: "确认",
  approve: "赞成",
  reject: "反对",
  success: "任务成功",
  fail: "任务失败",
};
Page({
  data: {
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
    showRoomSettings: false,
    showTransfer: false,
    boardIndex: 0,
    capacityIndex: 0,
    memberRooms: [],
    boardId: "classic",
    boardName: "阿瓦隆 · 经典基础",
    boardDescription: "梅林、刺客与普通阵营角色；原版基础规则",
    name: "",
    code: "",
    capacity: 6,
    capacities: [6, 7, 8, 9, 10, 11, 12],
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
        this.handleError(new Error("连接已断开，请恢复网络后重试"));
      }
    };
    wx.onNetworkStatusChange(this.networkListener);
    this.bootstrap();
  },
  onShow() {
    this.foreground = true;
    if (this.alive) this.schedule();
  },
  onHide() {
    this.foreground = false;
    clearTimeout(this.timer);
    this.mask();
  },
  onUnload() {
    this.alive = false;
    this.foreground = false;
    clearTimeout(this.timer);
    wx.offNetworkStatusChange(this.networkListener);
    this.mask();
  },
  mask() {
    this.generation = (this.generation || 0) + 1;
    this.setData({
      revealed: false,
      secret: null,
      choiceButtons: [],
      targetButtons: [],
    });
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
    if (this.alive) this.setData({ memberRooms: rooms, serverConnected: true });
  },
  handleError(e) {
    this.mask();
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
  schedule() {
    clearTimeout(this.timer);
    if (this.foreground && this.alive && this.roomCode)
      this.timer = setTimeout(async () => {
        if (
          this.roomCode &&
          !this.data.busy &&
          !this.pending &&
          !this.data.error
        )
          try {
            await this.refresh();
          } catch (e) {
            this.handleError(e);
          }
        this.schedule();
      }, 2500);
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
          notice: e.status === 404 ? "牌桌已删除或不存在" : "你已离开这张牌桌",
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
    if (this.data.room?.stage !== room.stage) {
      this.mask();
      this.setData({ selected: [] });
    }
    const seats = Array.from({ length: room.capacity }, (_, i) => {
      const seat = i + 1,
        p = room.players.find((p) => p.seat === seat);
      return {
        seat,
        name: p ? p.name : "空位",
        occupied: !!p,
        ready: !!p?.ready,
        mine: seat === room.me.seat,
        host: !!p?.isHost,
        inTeam: room.team.includes(seat),
        selected: this.data.selected.includes(seat),
      };
    });
    const history = room.history.map((h, i) => ({
      key: i,
      text:
        h.kind === "team"
          ? `第${h.round}轮 · ${h.leader}号组队 ${h.team.join("、")}：${h.approved ? "通过" : "否决"}`
          : h.kind === "quest"
            ? "任务结算"
            : "最终行动",
      detail:
        h.kind === "team"
          ? h.votes
              .map((v) => `${v.seat}号${v.approve ? "赞成" : "反对"}`)
              .join(" / ")
          : h.kind === "quest"
            ? `第${h.round}轮 · ${h.success ? "任务成功" : "任务失败"} · ${h.fails}张失败（需${h.threshold}张才失败）`
            : `最终目标 ${h.target}号 · ${h.hit ? "命中梅林" : "未命中梅林"}`,
    }));
    this.setData({
      room,
      seats,
      history,
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
  },
  clearRoom() {
    clearTimeout(this.timer);
    this.refreshSequence = (this.refreshSequence || 0) + 1;
    this.mask();
    this.roomCode = null;
    wx.removeStorageSync("roomCode");
    this.setData({
      room: null,
      seats: [],
      history: [],
      selected: [],
      code: "",
      error: "",
      entryMode: "join",
      showRoomSettings: false,
      showTransfer: false,
    });
  },
  async deleteRoom(e) {
    if (this.data.busy || this.pending) return;
    const code = e.currentTarget.dataset.code;
    this.setData({ busy: true, error: "" });
    try {
      const room = await api.request("/api/rooms/" + code);
      if (!room.me.isHost) throw new Error("只有当前房主可以删除牌桌");
      if (
        !(await this.confirm(
          "删除牌桌 " + code + "？",
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
    if (this.data.busy || this.pending) return;
    this.mask();
    this.roomCode = e.currentTarget.dataset.code;
    this.setData({ loading: true, error: "" });
    try {
      await this.refresh();
      if (this.roomCode) wx.setStorageSync("roomCode", this.roomCode);
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ loading: false });
      this.schedule();
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
    });
  },
  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },
  toggleRoomSettings() {
    this.setData({ showRoomSettings: !this.data.showRoomSettings });
  },
  toggleTransfer() {
    this.setData({ showTransfer: !this.data.showTransfer });
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
      boardName: b.name,
      boardDescription: b.description,
      boardIndex: availableBoards.indexOf(b),
      boardAssisted: b.mode === "assisted",
      showRules: false,
    });
  },
  pickBoard(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget?.dataset?.index ?? e.detail.value);
    const b = this.data.availableBoards[index];
    if (!b) return;
    this.setData({
      boardId: b.id,
      boardName: b.name,
      boardDescription: b.description,
      boardIndex: index,
      boardAssisted: b.mode === "assisted",
      showRules: false,
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
    this.setData({ busy: true, error: "", notice: "" });
    try {
      await api.login();
      const result = await api.request(
        pending.path,
        "POST",
        pending.data,
        pending.id,
      );
      this.pending = null;
      this.setData({
        serverConnected: true,
        hasPendingRequest: false,
        recoverableError: false,
      });
      if (pending.after === "enter") wx.removeStorageSync("pendingEntry");
      this.mask();
      if (pending.after === "enter") {
        this.roomCode = result.code;
        wx.setStorageSync("roomCode", result.code);
        wx.setStorageSync("nickname", this.data.name);
      }
      if (pending.after === "leave" || pending.after === "delete") {
        this.clearRoom();
        this.setData({
          notice: pending.after === "delete" ? "牌桌已删除" : "已离开房间",
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
      this.setData({ busy: false });
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
  seat(e) {
    const seat = Number(e.currentTarget.dataset.seat),
      r = this.data.room;
    if (r.phase === "lobby") {
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
  async start() {
    return this.confirmCommand(
      "开始这一局？",
      "按当前人数随机分配身份，所有人须已准备。",
      "start",
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
      "仅结束本局，不向服务器录入或推断胜方。",
      "closeOffline",
    );
  },
  rematch() {
    this.cmd("rematch");
  },
  async leave() {
    if (this.data.busy || this.pending || !this.data.room) return;
    const room = this.data.room;
    if (room.me.isHost && room.players.length > 1) {
      this.setData({ showTransfer: true });
      this.handleError({ message: "请先转交房主，再离开房间", status: 400 });
      return;
    }
    if (
      !(await this.confirm(
        "离开房间？",
        room.players.length === 1
          ? "离开后，这张空牌桌将自动关闭。"
          : "离开后将释放你的座位，重新加入需要输入房间码。",
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
  connectionInfo() {
    const content =
      !this.data.network || this.data.needsLogin || !this.data.serverConnected
        ? "连接尚未确认，请检查网络或重试。"
        : this.data.busy || this.data.loading || this.pending
          ? "正在确认操作，请稍候。"
          : "最近一次服务器请求成功。";
    wx.showModal({ title: "连接状态", content, showCancel: false });
  },
  transfer(e) {
    this.cmd("transfer", { seat: Number(e.currentTarget.dataset.seat) });
  },
  async reveal() {
    if (this.data.revealed) {
      this.mask();
      return;
    }
    if (this.data.busy || !this.data.network) return;
    const generation = ++this.generation,
      stage = this.data.room.stage;
    this.setData({ busy: true, error: "" });
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
        this.setData({
          revealed: true,
          secret,
          choiceButtons: (secret.action?.choices || []).map((value) => ({
            value,
            label: CHOICES[value],
          })),
          targetButtons: secret.action?.targets || [],
        });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  submitChoice(e) {
    this.cmd("submit", { value: e.currentTarget.dataset.value });
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
      title: "影中执刃 · 一起入座",
      path: "/pages/table/table?code=" + (this.roomCode || ""),
    };
  },
});
