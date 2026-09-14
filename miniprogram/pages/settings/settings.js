const api = require("../../api");
Page({
  data: {
    loading: true,
    busy: false,
    authorized: false,
    error: "",
    room: null,
    boards: [],
    capacities: [],
    choices: [],
    boardIndex: 0,
    capacityIndex: 0,
    boardId: "",
    capacity: 0,
    visible: false,
    dirty: false,
  },
  onLoad(query) {
    this.alive = true;
    this.code = query.code;
  },
  onShow() {
    this.foreground = true;
    if (!this.pending && !this.data.dirty) this.load();
  },
  onHide() {
    this.foreground = false;
  },
  onUnload() {
    this.alive = false;
  },
  async load() {
    if (this.data.busy) return;
    this.setData({ loading: true, error: "", authorized: false });
    try {
      if (!/^\d{6}$/.test(this.code || "")) throw new Error("房间号无效");
      await api.login();
      const room = await api.request("/api/rooms/" + this.code);
      if (!room.me.isHost) throw new Error("仅房主管理员可访问房间设置");
      const { boards } = await api.request("/api/boards");
      if (!this.alive) return;
      this.original = room;
      const capacities = [
        ...new Set(boards.filter((b) => b.available).flatMap((b) => b.counts)),
      ]
        .filter((n) => room.players.every((p) => p.seat <= n))
        .sort((a, b) => a - b);
      this.setData({
        authorized: true,
        room,
        boards,
        capacities,
        capacity: room.capacity,
        boardId: room.board,
        visible: room.showSkillDetails === true,
        dirty: false,
      });
      this.updateChoices(room.capacity, room.board);
    } catch (e) {
      if (this.alive) this.setData({ error: e.message });
    } finally {
      if (this.alive) this.setData({ loading: false });
    }
  },
  updateChoices(capacity, boardId) {
    const choices = this.data.boards.filter(
      (b) => b.available && b.counts.includes(capacity),
    );
    const selected = choices.find((b) => b.id === boardId) || choices[0];
    this.setData({
      capacity,
      boardId: selected.id,
      choices,
      capacityIndex: Math.max(0, this.data.capacities.indexOf(capacity)),
      boardIndex: choices.indexOf(selected),
      visible: selected.id === "knights" ? this.data.visible : false,
    });
    this.updateDirty();
  },
  updateDirty() {
    const r = this.original;
    this.setData({
      dirty:
        !!r &&
        (this.data.capacity !== r.capacity ||
          this.data.boardId !== r.board ||
          this.data.visible !==
            (r.board === "knights" && r.showSkillDetails === true)),
    });
  },
  pickCapacity(e) {
    if (this.data.busy || this.data.room.phase !== "lobby") return;
    this.updateChoices(
      this.data.capacities[Number(e.detail.value)],
      this.data.boardId,
    );
  },
  pickBoard(e) {
    if (this.data.busy || this.data.room.phase !== "lobby") return;
    this.updateChoices(
      this.data.capacity,
      this.data.choices[Number(e.detail.value)].id,
    );
  },
  toggleVisibility(e) {
    if (this.data.busy) return;
    this.setData({ visible: e.detail.value });
    this.updateDirty();
  },
  async save() {
    if (this.data.busy || !this.data.authorized) return;
    if (this.pending) return this.sendPending();
    if (!this.data.dirty) return;
    if (this.data.visible && !this.original.showSkillDetails) {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "公开技能过程？",
          content:
            "所有玩家将能查看已结算技能的出手人和目标，新身份牌面仍保密。",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!answer.confirm || !this.alive || !this.foreground) return;
    }
    this.pending = {
      id: api.requestId(),
      data: {
        type: "updateSettings",
        stage: this.original.stage,
        board: this.data.boardId,
        capacity: this.data.capacity,
        visible: this.data.visible,
      },
    };
    return this.sendPending();
  },
  async sendPending() {
    if (!this.pending || this.data.busy) return;
    const pending = this.pending;
    this.setData({ busy: true, error: "", pendingSave: true });
    try {
      await api.login();
      await api.request(
        "/api/rooms/" + this.code + "/commands",
        "POST",
        pending.data,
        pending.id,
      );
      this.pending = null;
      if (this.alive) {
        this.setData({ dirty: false, busy: false, pendingSave: false });
        await this.load();
        if (this.foreground && this.data.authorized)
          wx.showToast({ title: "设置已保存", icon: "success" });
      }
    } catch (e) {
      if (e.status && e.status < 500 && ![429, 401].includes(e.status))
        this.pending = null;
      if (this.alive) {
        this.setData({
          error: e.message,
          pendingSave: !!this.pending,
          authorized: e.status === 403 ? false : this.data.authorized,
        });
        if (e.status === 409) {
          this.setData({ busy: false });
          await this.load();
          this.setData({ error: "房间状态已变化，已刷新设置，请重新修改。" });
        }
      }
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  async back() {
    if (this.data.busy) return;
    if (this.data.dirty || this.pending) {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "返回牌桌？",
          content: this.pending
            ? "保存结果尚未确认，返回后请重新进入设置核对。"
            : "未保存的修改将放弃。",
          success: resolve,
        }),
      );
      if (!answer.confirm) return;
    }
    wx.navigateBack({
      fail: () =>
        wx.redirectTo({ url: "/pages/table/table?code=" + this.code }),
    });
  },
});
