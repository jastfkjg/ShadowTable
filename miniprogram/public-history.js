/* Shared presentation state for public records. Never reads private identity data. */
(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtablePublicHistory = value;
})(typeof window === "undefined" ? this : window, function () {
  const filters = [
    { value: "all", label: "全部" }, { value: "vote", label: "投票" },
    { value: "quest", label: "任务" }, { value: "skill", label: "技能" },
    { value: "other", label: "其他" },
  ];
  function initialData() {
    return {
      historyOpen: false, historyFilter: "all",
      historySeenKey: -1, historySnapshotKey: -1, historyNewSinceKey: -1,
      historyUnreadCount: 0, historyExpandedRows: {}, historyFilters: filters,
      historyScrollTarget: "", focusedHistoryKey: null, visibleHistory: [], historyLatest: null,
    };
  }
  function category(source) {
    if (["toolVote", "team"].includes(source.kind)) return "vote";
    if (["toolQuest", "quest"].includes(source.kind)) return "quest";
    if (["skillDetail", "skillResult", "variant", "toolReverse", "toolKnife", "assassination"].includes(source.kind)) return "skill";
    return "other";
  }
  function lastKey(history) { return history.length ? history[history.length - 1].key : -1; }
  function eventIcon(entry) {
    if (entry.resultTone) return entry.resultTone;
    const title = entry.historyText || entry.text || "";
    if (title.includes("查验")) return "inspect";
    if (/本轮(?:阵营转换|不转换)/.test(title)) return "conversion";
    if (entry.category === "skill") return "skill";
    return "record";
  }
  function resultRow(row) {
    const tone = ["本轮出局", "最终仍出局"].includes(row.label) ? "failure"
      : ["抽牌复活", "原牌复活"].includes(row.label) ? "success" : "";
    // Only turn an explicit seat list into chips; preserve other public result text.
    const seats = /^\d+(?:、\d+)*\s*号$/.test(row.value)
      ? row.value.match(/\d+/g).map(Number) : [];
    return { ...row, tone, seatNumbers: seats };
  }
  function rows(state, history) {
    if (!state.historyOpen) return [];
    return history.filter(entry => entry.key <= state.historySnapshotKey &&
      (state.historyFilter === "all" || entry.category === state.historyFilter)).slice().reverse().map(entry => ({
        ...entry,
        eventIcon: eventIcon(entry),
        expanded: !!state.historyExpandedRows[entry.key],
        isNew: entry.key > state.historyNewSinceKey,
        hasDetails: !!(entry.voteGroups || entry.resultRows || entry.historyNote || entry.thresholdLabel || (entry.detail && !entry.cards)),
        ...(entry.voteGroups ? { voteGroups: entry.voteGroups.map(group => ({ ...group, seatNumbers: (group.seats.match(/\d+/g) || []).map(Number) })) } : {}),
        ...(entry.resultRows ? { resultRows: entry.resultRows.map(resultRow) } : {}),
      }));
  }
  function sync(state, history, room) {
    const sameGame = state.room?.code === room.code && state.room?.game === room.game &&
      state.room?.phase !== "lobby" && room.phase !== "lobby" && lastKey(history) >= state.historySeenKey;
    const patch = sameGame ? {} : { ...initialData(), historySeenKey: lastKey(history) };
    const next = { ...state, ...patch };
    return { ...patch, historyLatest: history[history.length - 1] || null,
      historyUnreadCount: history.filter(entry => entry.key > next.historySeenKey).length,
      visibleHistory: rows(next, history) };
  }
  function open(state, key = null) {
    const history = state.history || [];
    const expanded = {};
    history.slice(-2).forEach(entry => { expanded[entry.key] = true; });
    if (key !== null) expanded[key] = true;
    const patch = {
      historyOpen: true, historyFilter: "all",
      historySnapshotKey: lastKey(history), historySeenKey: lastKey(history),
      historyNewSinceKey: state.historySeenKey, historyUnreadCount: 0,
      historyExpandedRows: expanded, focusedHistoryKey: key, historyScrollTarget: "",
    };
    return { ...patch, visibleHistory: rows({ ...state, ...patch }, history) };
  }
  function filter(state, value) {
    if (!filters.some(item => item.value === value)) return {};
    const patch = { historyFilter: value, focusedHistoryKey: null, historyScrollTarget: "" };
    return { ...patch, visibleHistory: rows({ ...state, ...patch }, state.history || []) };
  }
  function toggleRow(state, key) {
    if (!state.visibleHistory.some(entry => entry.key === key && entry.hasDetails)) return {};
    const patch = { historyExpandedRows: { ...state.historyExpandedRows, [key]: !state.historyExpandedRows[key] } };
    return { ...patch, visibleHistory: rows({ ...state, ...patch }, state.history || []) };
  }
  return { initialData, category, sync, open, filter, toggleRow };
});
