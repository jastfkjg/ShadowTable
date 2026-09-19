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
          titleHasCapacity: /[（(]\d+人[）)]/.test(board.name),
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
  toggleRole(e) {
    const section = Number(e.currentTarget.dataset.section);
    const role = Number(e.currentTarget.dataset.role);
    const item = this.data.sections[section]?.items[role];
    if (item?.brief) this.setData({ [`sections[${section}].items[${role}].expanded`]: !item.expanded });
  },
  jumpSection(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.sections[index]) return;
    const query = wx.createSelectorQuery();
    query.select(".detail-sticky").boundingClientRect();
    query.select("#detail-section-" + index).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec(([header, section, viewport]) => {
      if (this.alive && header && section && viewport)
        wx.pageScrollTo({ scrollTop: viewport.scrollTop + section.top - header.height - 16, duration: 0 });
    });
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/table/table" });
  },
});