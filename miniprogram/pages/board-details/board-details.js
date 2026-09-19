const api = require("../../api");
Page({
  data: {
    loading: true,
    error: "",
    title: "",
    capacity: 0,
    summary: "",
    sections: [],
    hasDetail: false,
    roleConfiguration: [],
  },
  onLoad(query) {
    this.alive = true;
    this.boardId = query.board || "";
    this.capacity = Number(query.capacity) || 0;
    this.load();
  },
  onUnload() {
    this.alive = false;
  },
  async load() {
    if (this._loading) return;
    this._loading = true;
    try {
      const { boards } = await api.request("/api/boards");
      if (!this.alive) return;
      const board = (boards || []).find((b) => b.id === this.boardId);
      if (!board) throw new Error("未找到该板子");
      const detail = board.detail;
      const fallback =
        detail || !board.roleConfigurations[this.capacity]
          ? []
          : board.roleConfigurations[this.capacity];
      if (this.alive) {
        wx.setNavigationBarTitle({ title: board.name });
        this.setData({
          title: board.name,
          capacity: this.capacity,
          summary: detail ? detail.summary : "",
          sections: detail ? detail.sections : [],
          hasDetail: !!detail,
          roleConfiguration: fallback,
          error: "",
          loading: false,
        });
      }
    } catch (e) {
      if (this.alive)
        this.setData({
          error: e.message,
          loading: false,
        });
    } finally {
      this._loading = false;
    }
  },
  retry() {
    this.setData({ loading: true, error: "" });
    this.load();
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/table/table" });
  },
});