const api = require("../../api");
const { presentMatches, backToMe } = require("../../profile");
Page({
  data: { loading: true, error: "", record: null },
  onLoad(options = {}) { this.alive = true; this.id = options.id || ""; return this.load(); },
  onUnload() { this.alive = false; },
  async load() {
    if (this.fetching) return;
    if (!this.id) { this.setData({ loading: false, error: "对局记录不存在或已移除" }); return; }
    this.fetching = true; this.setData({ loading: true, error: "" });
    try {
      await api.login();
      const result = await api.request("/api/me/matches/" + encodeURIComponent(this.id));
      if (this.alive) this.setData({ record: presentMatches([result.record])[0] });
    } catch (error) { if (this.alive) this.setData({ error: error.message }); }
    finally { this.fetching = false; if (this.alive) this.setData({ loading: false }); }
  },
  historyToggleMembers() {
    if (this.data.record) this.setData({ record: { ...this.data.record, membersExpanded: !this.data.record.membersExpanded } });
  },
  back: backToMe,
});
