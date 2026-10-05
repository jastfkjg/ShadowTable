const initialPlayerCardData = { playerCard: null, playerCardStats: null, playerCardLoading: false, playerCardError: "", playerCardStatus: "" };
// The caller supplies its API and context guard; lifecycle and presentation are shared.
function playerCardMethods(api) {
  return {
    closePlayerCard() {
      this.playerCardSequence = (this.playerCardSequence || 0) + 1;
      if (!this.data.playerCard && !this.data.playerCardStats && !this.data.playerCardLoading && !this.data.playerCardError && !this.data.playerCardStatus) return;
      if (this.updateChangedData) this.updateChangedData({ ...initialPlayerCardData });
      else this.setData({ ...initialPlayerCardData });
    },
    async loadPlayerCard(card, path, current = () => true) {
      const sequence = this.playerCardSequence = (this.playerCardSequence || 0) + 1;
      this.setData({ ...initialPlayerCardData, playerCard: card, playerCardLoading: true });
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
        const stats = result.status === "available" ? { ...result.stats, rateLabel: rateLabel(result.stats.winRate),
          byFaction: result.stats.byFaction.map(row => ({ ...row, rateLabel: rateLabel(row.winRate) })) } : null;
        const playerCard = card.scope === "leaderboard" ? { ...card, name: result.player.name,
          initial: Array.from(result.player.name || "友")[0], avatarUrl: result.player.avatarUrl ? api.assetUrl(result.player.avatarUrl) : "" } : card;
        this.setData({ playerCard, playerCardStats: stats, playerCardStatus: result.status });
      } catch (e) {
        if (active()) this.setData({ playerCardError: e.message || "战绩读取失败，请重试" });
      } finally {
        if (active()) this.setData({ playerCardLoading: false });
      }
    },
    playerCardAvatarError() { if (this.data.playerCard) this.setData({ playerCard: { ...this.data.playerCard, avatarFailed: true } }); },
  };
}
module.exports = { initialPlayerCardData, playerCardMethods };
