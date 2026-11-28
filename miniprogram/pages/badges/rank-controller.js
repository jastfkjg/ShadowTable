(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("../../badges"));
  else root.shadowtableBadgeRanks = factory(root.shadowtableBadges);
})(typeof window === "object" ? window : this, function (badges) {
  const types = {
    honor: { label: "荣誉徽章", badgeId: "october_2026_crown" },
    fun: { label: "趣味徽章", badgeId: "good_shield" },
  };
  function create(
    { request, update, assetUrl = (path) => path },
    kind = "honor",
    player = "",
    badgeId = "",
  ) {
    let sequence = 0;
    const lookup = kind === "lookup";
    let catalogue = [];
    const lookupBadge = id => {
      const badge = badges.presentPlayerBadge({ id }, assetUrl);
      if (!badge) return null;
      return { id, title: badge.title, imageUrl: badge.imageUrl, condition: badges.badgeCriteria(badge).detailCondition,
        scope: badge.periodLabel || (badge.permanent ? "永久" : "本月"), achievement: !!badge.achievement };
    };
    const state = {
      lookup, badgeId, badge: lookup && badgeId ? lookupBadge(badgeId) : null, query: "", matches: [],
      countLabel: "当前持有",
      choices: Object.entries(types).map(([kind, type]) => {
        const badge = badges.presentPlayerBadge({ id: type.badgeId }, assetUrl);
        return { kind, title: type.label + "榜", art: badge.imageUrl, artStyle: badge.artStyle };
      }),
    };
    function patch(values) {
      Object.assign(state, values);
      update({ ...state });
    }
    function start(category, id) {
      const type = types[category] || types.honor;
      patch({
        kind: category,
        player: id,
        label: type.label,
        board: null,
        detail: null,
        selectedBadge: null,
        error: "",
        loading: true,
        saving: false,
      });
    }
    function present(row) {
      return {
        ...row,
        initial: Array.from(row.nickname || "友")[0],
        avatarUrl: row.avatarUrl ? assetUrl(row.avatarUrl) : "",
      };
    }
    async function load(more = false) {
      const { kind, player, board } = state;
      if (more && (state.loading || !board || board.nextOffset === null))
        return;
      const token = ++sequence;
      patch({ loading: true, error: "", ...(player ? { detail: null, selectedBadge: null } : {}) });
      const endpoint = lookup ? "/api/leaderboard/badges" + (badgeId ? "/" + encodeURIComponent(badgeId) : "") : "/api/badge-ranks/" + kind;
      const suffix = player
        ? "/" + player
        : more
          ? "?offset=" + board.nextOffset + "&version=" + board.version
          : "";
      try {
        const value = await request(endpoint + suffix);
        if (token !== sequence) return;
        if (lookup && !badgeId) {
          catalogue = value.ids.map(lookupBadge).filter(Boolean).sort((a, b) => Number(b.achievement) - Number(a.achievement));
          search(state.query);
        } else if (player) {
          patch({
            detail: {
              ...value,
              player: present(value.player),
              badges: value.badges
                .map((item) => badges.presentPlayerBadge(item, assetUrl))
                .filter(Boolean),
            },
          });
        } else {
          const rows = value.rows.map(present);
          patch({
            board: {
              ...value,
              rows: more ? board.rows.concat(rows) : rows,
              ...(value.me ? { me: present(value.me) } : {}),
            },
          });
        }
      } catch (error) {
        if (token !== sequence) return;
        if (more && error.status === 409) return load();
        patch({ error: error.message });
      } finally {
        if (token === sequence) patch({ loading: false });
      }
    }
    async function visibility(visible) {
      if (!state.detail?.isSelf || state.saving) return;
      const token = sequence;
      patch({ saving: true, error: "" });
      try {
        const value = await request(
          "/api/badge-ranks/" + state.kind + "/self",
          "POST",
          { visible },
        );
        if (token === sequence)
          patch({ detail: { ...state.detail, visible: value.visible } });
      } catch (error) {
        if (token === sequence) {
          await load();
          if (sequence === token + 1)
            patch({ error: error.message, saving: false });
        }
      } finally {
        if (token === sequence) patch({ saving: false });
      }
    }
    function search(query) {
      const term = query.trim().toLowerCase();
      patch({ query, matches: catalogue.filter(b => (b.title + b.scope + b.id).toLowerCase().includes(term)) });
    }
    start(kind, player);
    return {
      state,
      load,
      visibility,
      search,
      openBadge(id) {
        const detail = state.detail;
        if (!detail || (!detail.visible && !detail.isSelf)) return;
        const item = detail.badges.find(b => b.id === id);
        if (item) patch({ selectedBadge: { ...item, ...badges.badgeCriteria(item) } });
      },
      closeBadge() { if (state.selectedBadge) patch({ selectedBadge: null }); },
      select(category) {
        if (!types[category] || state.kind === category) return;
        start(category, "");
        return load();
      },
      pause() {
        sequence++;
        patch({ loading: false, saving: false, selectedBadge: null });
      },
    };
  }
  return { create };
});
