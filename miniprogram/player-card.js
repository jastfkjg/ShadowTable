const { fitBody } = require("./room-sheet-presentation");
const initialPlayerCardData = { playerCard: null, playerCardStats: null, playerCardLoading: false, playerCardError: "", playerCardStatus: "", playerCardBadge: null, playerCardBodyHeight: 0, playerCardMeasuring: false };
// The caller supplies its API and context guard; lifecycle and presentation are shared.
function playerCardMethods(api, platform = typeof wx === "undefined" ? null : wx) {
  return {
    closePlayerCard() {
      this.playerCardSequence = (this.playerCardSequence || 0) + 1;
      this.playerCardLayoutRevision = (this.playerCardLayoutRevision || 0) + 1;
      if (!this.data.playerCard && !this.data.playerCardStats && !this.data.playerCardLoading && !this.data.playerCardError && !this.data.playerCardStatus) return;
      if (this.updateChangedData) this.updateChangedData({ ...initialPlayerCardData });
      else this.setData({ ...initialPlayerCardData });
    },
    setPlayerCardData(values) {
      this.setData(values, () => this.syncPlayerCardLayout());
    },
    syncPlayerCardLayout() {
      if (!this.alive || this.foreground === false || !this.data.playerCard) return;
      const sequence = this.playerCardSequence;
      const revision = this.playerCardLayoutRevision = (this.playerCardLayoutRevision || 0) + 1;
      const active = () => this.alive && this.foreground !== false && this.data.playerCard &&
        this.playerCardSequence === sequence && this.playerCardLayoutRevision === revision;
      const apply = height => {
        if (!active()) return;
        const values = {};
        if (height !== null && height !== this.data.playerCardBodyHeight) values.playerCardBodyHeight = height;
        if (this.data.playerCardMeasuring) values.playerCardMeasuring = false;
        if (Object.keys(values).length) this.setData(values);
      };
      if (!platform?.createSelectorQuery) { apply(null); return; }
      const measure = () => {
        if (!active()) return;
        const query = platform.createSelectorQuery().in(this);
        for (const name of [".player-card-backdrop", ".player-card-top", ".player-card-content", ".player-card-bottom"])
          query.select(name).boundingClientRect();
        query.exec(rects => apply(fitBody(rects)));
      };
      if (platform.nextTick) platform.nextTick(measure); else measure();
    },
    async loadPlayerCard(card, path, current = () => true) {
      const sequence = this.playerCardSequence = (this.playerCardSequence || 0) + 1;
      this.setPlayerCardData({ ...initialPlayerCardData, playerCard: card, playerCardLoading: true, playerCardMeasuring: true });
      const active = () => this.alive && this.foreground !== false && this.playerCardSequence === sequence && current();
      try {
        if (!card.id) throw new Error("当前服务暂不支持查看玩家战绩，请更新服务端后重试");
        const result = await api.request(path);
        if (!active()) return;
        if (!result?.player || !["available", "untracked"].includes(result.status) ||
          result.status === "available" && (!result.stats || !Array.isArray(result.stats.byFaction)))
          throw new Error("战绩暂时无法读取，请稍后重试");
        if (result.player.id !== card.id || card.seat != null && result.player.seat !== card.seat) return this.closePlayerCard();
        const rateLabel = value => value == null ? "—" : value.toFixed(1) + "%";
        const rateValue = value => value == null ? "—" : value.toFixed(1);
        const stats = result.status === "available" ? { ...result.stats, rateLabel: rateLabel(result.stats.winRate), rateValue: rateValue(result.stats.winRate),
          byFaction: result.stats.byFaction.map(row => ({ ...row, rateLabel: rateLabel(row.winRate), rateValue: rateValue(row.winRate) })) } : null;
        let playerCard = card.scope === "leaderboard" ? { ...card, name: result.player.name,
          initial: Array.from(result.player.name || "友")[0], avatarUrl: result.player.avatarUrl ? api.assetUrl(result.player.avatarUrl) : "" } : card;
        // Monthly artwork is bundled; campaign artwork is shared with the web client.
        const { catalogue, MAX_EQUIPPED } = require('./badges');
        playerCard = { ...playerCard, badges: (result.player.badges || []).filter(badge => catalogue.some(b => b.id === badge.id)).slice(0, MAX_EQUIPPED)
          .map(badge => ({ ...badge, imageUrl: badge.permanent ? api.assetUrl(catalogue.find(b => b.id === badge.id).imageUrl) : catalogue.find(b => b.id === badge.id).imageUrl })) };
        this.setPlayerCardData({ playerCard, playerCardStats: stats, playerCardStatus: result.status });
      } catch (e) {
        if (active()) this.setPlayerCardData({ playerCardError: e.message || "战绩读取失败，请重试" });
      } finally {
        if (active()) this.setPlayerCardData({ playerCardLoading: false });
      }
    },
    playerCardAvatarError() { if (this.data.playerCard) this.setData({ playerCard: { ...this.data.playerCard, avatarFailed: true } }); },
    showPlayerCardBadge(e) {
      const badge = this.data.playerCard?.badges?.find(b => b.id === e.currentTarget.dataset.id);
      this.setPlayerCardData({ playerCardBadge: badge?.id === this.data.playerCardBadge?.id ? null : badge || null });
    },
    closePlayerCardBadge() { this.setPlayerCardData({ playerCardBadge: null }); },
  };
}
module.exports = { initialPlayerCardData, playerCardMethods };
