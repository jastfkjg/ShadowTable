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
    fairyEnabled: false,
    dirty: false,
    transferPlayers: [],
    showTransferPicker: false,
    pendingTransfer: false,
    pendingSave: false,
    pendingKick: false,
    showKickPicker: false,
  },
  onLoad(query) {
    this.alive = true;
    this.code = query.code;
  },
  onShow() {
    this.foreground = true;
    if (
      !this.pending &&
      !this.transferPending &&
      !this.kickPending &&
      !this.data.dirty
    )
      this.load();
  },
  onHide() {
    this.foreground = false;
  },
  onUnload() {
    this.alive = false;
  },
  async load({ quiet = false } = {}) {
    if (this.data.busy && !quiet) return;
    this.setData(quiet ? { error: "" } : { loading: true, error: "", authorized: false });
    try {
      if (!/^\d{6}$/.test(this.code || "")) throw new Error("房间号无效");
      await api.login();
      const room = await api.request("/api/rooms/" + this.code);
      if (!room.me.isHost) throw Object.assign(new Error("仅房主管理员可访问房间设置"), { status: 403 });
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
        transferPlayers: room.players.filter((p) => p.seat !== room.me.seat),
        boards,
        capacities,
        capacity: room.capacity,
        boardId: room.board,
        visible: room.showSkillDetails === true,
        fairyEnabled: room.fairyEnabled === true,
        dirty: false,
      });
      this.updateChoices(room.capacity, room.board);
    } catch (e) {
      if (this.alive) this.setData({ error: e.message, authorized: e.status === 403 ? false : this.data.authorized });
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
      fairyEnabled: capacity !== this.data.capacity ? capacity >= 8 : this.data.fairyEnabled,
      capacity,
      boardId: selected.id,
      choices,
      capacityIndex: Math.max(0, this.data.capacities.indexOf(capacity)),
      boardIndex: choices.indexOf(selected),
      visible: ["knights", "knights-10", "knights-11"].includes(selected.id) ? this.data.visible : false,
    });
    this.updateDirty();
  },
  updateDirty() {
    const r = this.original;
    this.setData({
      dirty:
        !!r &&
        (this.data.fairyEnabled !== (r.fairyEnabled === true) ||
          this.data.capacity !== r.capacity ||
          this.data.boardId !== r.board ||
          this.data.visible !==
            (["knights", "knights-10", "knights-11"].includes(r.board) &&
              r.showSkillDetails === true)),
    });
  },
  pickCapacity(e) {
    if (this.settingsLocked() || this.data.room.phase !== "lobby") return;
    this.updateChoices(
      this.data.capacities[Number(e.detail.value)],
      this.data.boardId,
    );
    return this.save();
  },
  pickBoard(e) {
    if (this.settingsLocked() || this.data.room.phase !== "lobby") return;
    this.updateChoices(
      this.data.capacity,
      this.data.choices[Number(e.detail.value)].id,
    );
    return this.save();
  },
  settingsLocked() {
    return this.data.busy || this.data.loading || !this.data.authorized ||
      this.pending || this.transferPending || this.kickPending;
  },
  toggleFairy(e) {
    if (this.settingsLocked() || this.data.capacity < 7 || this.data.room.phase === "fairy") return;
    this.setData({ fairyEnabled: e.detail.value });
    this.updateDirty();
    return this.save();
  },
  toggleVisibility(e) {
    if (this.settingsLocked()) return;
    this.setData({ visible: e.detail.value });
    this.updateDirty();
    return this.save();
  },
  async save() {
    if (
      this.data.busy ||
      this.transferPending ||
      this.kickPending ||
      !this.data.authorized
    )
      return;
    if (this.pending) return this.sendPending();
    if (!this.data.dirty) return;
    this.pending = {
      id: api.requestId(),
      data: {
        type: "updateSettings",
        stage: this.original.stage,
        board: this.data.boardId,
        capacity: this.data.capacity,
        visible: this.data.visible,
        fairyEnabled: this.data.fairyEnabled,
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
        this.setData({ dirty: false, pendingSave: false });
        await this.load({ quiet: true });
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
  openTransfer() {
    if (
      this.data.busy ||
      this.pending ||
      this.transferPending ||
      this.kickPending ||
      !this.data.authorized ||
      !this.data.transferPlayers.length
    )
      return;
    this.setData({ showTransferPicker: true });
  },
  closeTransfer() {
    if (!this.data.busy) this.setData({ showTransferPicker: false });
  },
  stopPropagation() {},
  async transfer(e) {
    if (
      this.data.busy ||
      this.pending ||
      this.transferPending ||
      this.kickPending ||
      !this.data.authorized
    )
      return;
    const seat = Number(e.currentTarget.dataset.seat);
    const target = this.data.transferPlayers.find((p) => p.seat === seat);
    if (!target) return;
    this.setData({ busy: true });
    const answer = await new Promise((resolve) =>
      wx.showModal({
        title: "移交房主？",
        content: `将房主移交给 ${seat}号 · ${target.name}，新房主立即接管流程，你将不再拥有管理权限。${this.data.dirty ? "未保存的设置将放弃。" : ""}`,
        success: resolve,
        fail: () => resolve({ confirm: false }),
      }),
    );
    if (!this.alive) return;
    this.setData({ busy: false });
    if (!answer.confirm || !this.foreground) return;
    this.setData({ showTransferPicker: false });
    this.transferPending = {
      id: api.requestId(),
      data: { type: "transfer", stage: this.original.stage, seat },
    };
    return this.sendTransfer();
  },
  async sendTransfer() {
    if (!this.transferPending || this.data.busy) return;
    const pending = this.transferPending;
    this.setData({ busy: true, error: "", pendingTransfer: true });
    try {
      await api.login();
      await api.request(
        "/api/rooms/" + this.code + "/commands",
        "POST",
        pending.data,
        pending.id,
      );
      this.transferPending = null;
      if (!this.alive) return;
      this.setData({ dirty: false, authorized: false, pendingTransfer: false });
      if (this.foreground) {
        wx.showToast({ title: "房主已移交", icon: "success" });
        wx.navigateBack({
          fail: () =>
            wx.redirectTo({ url: "/pages/table/table?code=" + this.code }),
        });
      }
    } catch (e) {
      if (e.status && e.status < 500 && ![429, 401].includes(e.status))
        this.transferPending = null;
      if (!this.alive) return;
      this.setData({
        error: e.message,
        pendingTransfer: !!this.transferPending,
        authorized: e.status === 403 ? false : this.data.authorized,
      });
      if (e.status === 409) {
        this.setData({ busy: false });
        await this.load();
        this.setData({ error: "房间状态已变化，已刷新，请重新选择新房主。" });
      }
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  openKick() {
    if (
      this.data.busy ||
      this.pending ||
      this.transferPending ||
      this.kickPending ||
      !this.data.authorized ||
      !this.data.room?.canKick ||
      !this.data.transferPlayers.length
    )
      return;
    this.setData({ showKickPicker: true });
  },
  closeKick() {
    if (!this.data.busy) this.setData({ showKickPicker: false });
  },
  async kick(e) {
    if (
      this.data.busy ||
      this.pending ||
      this.transferPending ||
      this.kickPending ||
      !this.data.authorized ||
      !this.data.room?.canKick
    )
      return;
    const target = this.data.transferPlayers.find(
      (p) => p.seat === Number(e.currentTarget.dataset.seat),
    );
    if (!target) return;
    const data = {
      type: "kick",
      stage: this.original.stage,
      seat: target.seat,
      targetId: target.managementId,
      confirm: true,
    };
    this.setData({ busy: true });
    const answer = await new Promise((resolve) =>
      wx.showModal({
        title: "移出玩家？",
        content: `将 ${target.seat}号 · ${target.name} 移出房间，其他玩家和已有对局记录保留。准备阶段可凭房间码重新加入。`,
        confirmText: "移出",
        confirmColor: "#b5473a",
        cancelText: "取消",
        success: resolve,
        fail: () => resolve({ confirm: false }),
      }),
    );
    if (!this.alive) return;
    this.setData({ busy: false });
    if (!answer.confirm || !this.foreground) return;
    this.kickPending = { id: api.requestId(), data };
    this.setData({ showKickPicker: false });
    return this.sendKick();
  },
  async sendKick() {
    if (!this.kickPending || this.data.busy) return;
    const pending = this.kickPending;
    const draft = this.data.dirty
      ? {
          capacity: this.data.capacity,
          boardId: this.data.boardId,
          visible: this.data.visible,
        fairyEnabled: this.data.fairyEnabled,
        }
      : null;
    this.setData({ busy: true, error: "", pendingKick: true });
    try {
      await api.login();
      await api.request(
        "/api/rooms/" + this.code + "/commands",
        "POST",
        pending.data,
        pending.id,
      );
      this.kickPending = null;
      if (!this.alive) return;
      this.setData({ busy: false, pendingKick: false });
      await this.load();
      if (this.data.authorized && draft) {
        this.setData({ visible: draft.visible });
        this.updateChoices(draft.capacity, draft.boardId);
        this.setData({ fairyEnabled: draft.fairyEnabled });
        this.updateDirty();
      }
      if (this.foreground && this.data.authorized)
        wx.showToast({ title: "玩家已移出", icon: "success" });
    } catch (e) {
      if (e.status && e.status < 500 && ![401, 429].includes(e.status))
        this.kickPending = null;
      if (!this.alive) return;
      this.setData({
        error: e.message,
        pendingKick: !!this.kickPending,
        authorized: e.status === 403 ? false : this.data.authorized,
      });
      if (e.status === 409) {
        this.setData({ busy: false });
        await this.load();
        this.setData({
          error: "房间或座位已变化，已刷新，请重新选择要移出的玩家。",
        });
      }
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  async back() {
    if (this.data.busy) return;
    if (
      this.data.dirty ||
      this.pending ||
      this.transferPending ||
      this.kickPending
    ) {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "返回牌桌？",
          content: this.kickPending
            ? "移出结果尚未确认，返回后请核对房间成员。"
            : this.transferPending
              ? "移交结果尚未确认，返回后请核对最新房主。"
              : this.pending
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
