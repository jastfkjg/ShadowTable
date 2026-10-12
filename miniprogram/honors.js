(function (root, factory) {
  const honors = factory();
  if (typeof module === "object" && module.exports) module.exports = honors;
  else root.shadowtableHonors = honors;
})(typeof window === "object" ? window : this, function () {
  const keys = ["mvp", "svp"];
  function present(value, asset = url => url, failed = new Set()) {
    if (!value) return null;
    const player = p => ({ ...p, initial: Array.from(p.name || "友")[0], avatarUrl: p.avatarUrl && !failed.has(p.avatarUrl) ? asset(p.avatarUrl) : "" });
    const seconds = Math.max(0, Math.ceil((value.deadline - value.serverNow) / 1000));
    return { ...value, timeLabel: Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"),
      groups: (value.groups || []).map(group => ({ ...group, players: group.players.map(player) })),
      awards: keys.map(key => ({ key, title: "最强 " + key.toUpperCase(), tied: value[key]?.length > 1, players: (value[key] || []).map(player) })),
      resultNote: value.status === "insufficient" ? `仅 ${value.completed} / ${value.total} 人投票，未达到 ${value.required} 人，本局不颁奖`
        : value.status === "invalidated" ? "本局结果已更正或作废，原票选已失效" : "",
    };
  }
  function sync(data, value, blocked = false) {
    const active = value?.status === "open" && value.canVote;
    const same = data.honorMatchId === value?.matchId;
    const draft = same && data.honorDialog ? data.honorDraft : value?.ballot || { mvp: null, svp: null };
    const dialog = !!active && (same && data.honorDialog || !blocked && !value.ballot && data.honorDismissed !== value.matchId);
    return { honorMatchId: value?.matchId || "", honorDialog: dialog, honorDraft: draft, ...selection(value, draft) };
  }
  function selection(value, draft = {}) {
    const groups = (value?.groups || []).map(group => ({ ...group,
      players: group.players.map(p => ({ ...p, selected: !p.disabled && draft[group.key] === p.seat })),
    }));
    const required = groups.filter(g => !g.skip).length;
    const completed = groups.filter(g => !g.skip && g.players.some(p => p.selected)).length;
    return { honorGroups: groups, honorReady: !!groups.length && required === completed, honorSelected: completed, honorRequired: required };
  }
  function withoutAvatar(value, url) {
    if (!value || !url) return value;
    const hide = group => ({ ...group, players: group.players.map(p => p.avatarUrl === url ? { ...p, avatarUrl: "" } : p) });
    return { ...value, groups: value.groups.map(hide), awards: value.awards.map(hide) };
  }
  return { present, sync, selection, withoutAvatar };
});
