const api = require("../../api");
const presentation = require("../../board-detail");
const { switchHomeTab } = require("../../tab-navigation");
Page({
  data: {
    directoryExpanded: false,
    loading: true,
    error: "",
    board: null,
    tab: "rules",
    query: "",
    selectedGroup: "",
    visibleRoles: [],
    chapters: [],
    allExpanded: false,
    navTop: 64,
  },
  onLoad(query) {
    this.alive = true;
    this.boardId = query.board || "";
    this.capacity = Number(query.capacity) || 0;
    const info = wx.getWindowInfo?.() || wx.getSystemInfoSync();
    const status = info.statusBarHeight || 20,
      menu = wx.getMenuButtonBoundingClientRect?.();
    const gap = menu && menu.top > status ? menu.top - status : 6;
    this.setData({
      navTop: status + (menu?.height ? menu.height + gap * 2 : 44),
    });
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
      const source = (boards || []).find((board) => board.id === this.boardId);
      if (!source) throw new Error("未找到该板子");
      const board = presentation.presentBoard(source, this.capacity);
      this.expandedRoles = {};
      const selectedGroup = board.groups[0]?.id || "";
      wx.setNavigationBarTitle({ title: board.name });
      this.setData({
        board,
        selectedGroup,
        tab: board.defaultTab,
        query: "",
        chapters: board.chapters,
        visibleRoles: presentation.visibleRoles(board, selectedGroup),
        allExpanded: board.chapters.length === 1,
        error: "",
        loading: false,
      });
    } catch (error) {
      if (this.alive) this.setData({ error: error.message, loading: false });
    } finally {
      this._loading = false;
    }
  },
  retry() {
    this.setData({ loading: true, error: "" });
    this.load();
  },
  setTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === "rules" || (tab === "roles" && this.data.board?.hasRoles))
      this.setData({ tab });
  },
  searchRoles(event) {
    const query = event.detail.value;
    this.setData({
      query,
      visibleRoles: presentation.visibleRoles(
        this.data.board,
        this.data.selectedGroup,
        query,
        this.expandedRoles,
      ),
    });
  },
  clearSearch() {
    this.searchRoles({ detail: { value: "" } });
  },
  selectGroup(event) {
    const selectedGroup = event.currentTarget.dataset.group;
    if (!this.data.board.groups.some((group) => group.id === selectedGroup))
      return;
    this.setData({
      selectedGroup,
      query: "",
      visibleRoles: presentation.visibleRoles(
        this.data.board,
        selectedGroup,
        "",
        this.expandedRoles,
      ),
    });
  },
  toggleRole(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.board.roles.some((role) => role.id === id)) return;
    this.expandedRoles[id] = !this.expandedRoles[id];
    this.setData({
      visibleRoles: presentation.visibleRoles(
        this.data.board,
        this.data.selectedGroup,
        this.data.query,
        this.expandedRoles,
      ),
    });
  },
  toggleChapter(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.chapters[index]) return;
    const chapters = this.data.chapters.map((chapter, i) =>
      i === index ? { ...chapter, expanded: !chapter.expanded } : chapter,
    );
    this.setData({
      chapters,
      allExpanded: chapters.every((chapter) => chapter.expanded),
    });
  },
  toggleAll() {
    const allExpanded = !this.data.allExpanded;
    this.setData({
      allExpanded,
      chapters: this.data.chapters.map((chapter) => ({
        ...chapter,
        expanded: allExpanded,
      })),
    });
  },
  blockScroll() {},
  closeDirectory() {
    this.setData({ directoryExpanded: false });
  },
  toggleDirectory() {
    this.setData({ directoryExpanded: !this.data.directoryExpanded });
  },
  jumpSection(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.chapters[index]) return;
    const chapters = this.data.chapters.map((chapter, i) =>
      i === index ? { ...chapter, expanded: true } : chapter,
    );
    this.setData(
      {
        directoryExpanded: false,
        tab: "rules",
        chapters,
        allExpanded: chapters.every((chapter) => chapter.expanded),
      },
      () => {
        const query = wx.createSelectorQuery();
        query.select(".detail-tabs").boundingClientRect();
        query.select("#detail-section-" + index).boundingClientRect();
        query.selectViewport().scrollOffset();
        query.exec(([tabs, section, viewport]) => {
          if (this.alive && tabs && section && viewport)
            wx.pageScrollTo({
              scrollTop: Math.max(
                0,
                viewport.scrollTop +
                  section.top -
                  this.data.navTop -
                  tabs.height -
                  12,
              ),
              duration: 0,
            });
        });
      },
    );
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else switchHomeTab(0);
  },
});
