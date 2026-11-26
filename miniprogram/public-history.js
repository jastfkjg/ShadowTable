/* Shared presentation state for public records. Never reads private identity data. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./quest-team-sizes"));
  else root.shadowtablePublicHistory = factory(root.shadowtableQuestTeamSizes);
})(typeof window === "undefined" ? this : window, function (teamSizes) {
  const filters = [
    { value: "all", label: "全部" }, { value: "vote", label: "投票" },
    { value: "quest", label: "任务" }, { value: "skill", label: "技能" },
    { value: "other", label: "其他" },
  ];
  function initialData() {
    return {
      historyOpen: false, historyFilter: "all",
      historySeenKey: -1, historySnapshotKey: -1, historyNewSinceKey: -1,
      historyUnreadCount: 0, historyExpandedRows: {}, historyFilters: [],
      historyScrollTarget: "", focusedHistoryKey: null, visibleHistory: [], historyLatest: null,
    };
  }
  function category(source, room) {
    if (["toolVote", "team"].includes(source.kind)) return "vote";
    if (["toolQuest", "quest"].includes(source.kind)) return "quest";
    if (source.kind === "variant" && (["conversion", "fairy"].includes(source.resultType) || /^(?:本轮(?:阵营转换|不转换)|仙女查验已完成)$/.test(source.text || ""))) return "other";
    if (room.knights && ["skillDetail", "skillResult", "variant", "toolReverse", "toolKnife", "assassination"].includes(source.kind)) return "skill";
    return "other";
  }
  function voteRecord(source, key) {
    const team = (source.team || []).join("、");
    const standard = source.kind === "team";
    const text = standard
      ? `第${source.round}轮 · ${source.leader}号组队 ${team}：${source.approved ? "通过" : "否决"}`
      : "投票" + (source.approved ? "通过" : "未通过") + (source.earlyClosed ? " · 提前截止" : "");
    const teamLabel = !standard && team ? team + " 号" : "";
    const entry = { key, text, teamLabel, resultTeam: teamLabel };
    if (!Array.isArray(source.votes)) return { ...entry, detail: source.detail || "" };
    const voteGroups = [
      { approve: true, label: "赞成", tone: "approve" },
      { approve: false, label: "反对", tone: "reject" },
      { approve: null, label: "弃权", tone: "abstain" },
    ].map(({ approve, label, tone }) => {
      const seatNumbers = source.votes.filter(v => v.approve === approve).map(v => v.seat).sort((a, b) => a - b);
      return { label, tone, seatNumbers, count: seatNumbers.length };
    }).filter(group => group.tone !== "abstain" || group.count);
    const latestDetail = voteGroups.map(g => `${g.count}票${g.label}：${g.seatNumbers.join("，") || "无"}`).join("\n");
    return { ...entry, voteGroups, latestDetail, detail: (teamLabel ? "队伍 " + team + "号\n" : "") + latestDetail };
  }
  function inspectionLabel(source) {
    if (source.kind !== "variant" || (source.resultType !== "fairy" && source.text !== "仙女查验已完成")) return "";
    return Number.isInteger(source.actor) && source.actor > 0 && Number.isInteger(source.target) && source.target > 0
      ? `${source.actor}号查验了${source.target}号` : "";
  }
  function isProtectedRound(room, number, threshold, source) {
    return threshold != null ? threshold === 2
      : (!room.flexible || source?.kind === "quest") && room.capacity >= 7 && number === 4;
  }
  function questThresholdLabel(room, source) {
    if (source.kind !== "quest" && source.kind !== "toolQuest") return "";
    return isProtectedRound(room, source.round, source.threshold, source) ? "至少 2 张失败票才失败" : "";
  }
  function questProgress(room, quests, revealingQuest = null) {
    if (room.phase === "lobby") return { questRounds: [] };
    // A vote or proposal may also carry a team. Only a dispatched quest supplies an actual count.
    const activeQuest = revealingQuest || (room.phase === "quest" ? { team: room.team, threshold: room.activity?.threshold } : null);
    const length = Math.max(5, quests.length + (activeQuest ? 1 : 0));
    const questRounds = Array.from({ length }, (_, index) => {
      const number = index + 1;
      const entry = quests[index];
      const source = entry ? room.history[entry.key] : index === quests.length ? activeQuest : null;
      const actualSize = Array.isArray(source?.team) ? source.team.length : 0;
      const teamSize = actualSize || teamSizes[room.capacity]?.[index];
      const sizeLabel = teamSize ? (actualSize ? "实上" : "应上") + teamSize + "人，" : "人数未记录，";
      const protectedRound = source ? isProtectedRound(room, number, source.threshold, source)
        : room.capacity >= 7 && number === 4;
      const result = entry?.questResult || "pending";
      const status = { success: "成功", failure: "失败", pending: "未结算" }[result];
      return { number, key: entry?.key ?? null, teamSize: teamSize ?? "—", result, protectedRound,
        label: `第${number}次任务，${sizeLabel}${protectedRound ? "保护轮，" : ""}${status}${entry ? "，查看详情" : ""}` };
    });
    return { questRounds };
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
  function seatNumbers(value) {
    return /^\d+(?:、\d+)*\s*号$/.test(value)
      ? value.match(/\d+/g).map(Number) : [];
  }
  function resultRow(row) {
    const tone = ["本轮出局", "最终仍出局"].includes(row.label) ? "failure"
      : ["抽牌复活", "原牌复活"].includes(row.label) ? "success" : "";
    // Only turn an explicit seat list into chips; preserve other public result text.
    return { ...row, tone, seatNumbers: seatNumbers(row.value) };
  }
  function rows(state, history) {
    if (!state.historyOpen) return [];
    // Number public records before category filtering; keep keys for lookup and reading state.
    return history.map((entry, index) => ({ ...entry, recordNumber: index + 1 }))
      .filter(entry => entry.key <= state.historySnapshotKey &&
      (state.historyFilter === "all" || entry.category === state.historyFilter)).slice().reverse().map(entry => ({
        ...entry,
        eventIcon: eventIcon(entry),
        isLatest: entry.key === state.historySnapshotKey,
        teamSeatNumbers: seatNumbers(entry.teamLabel),
        expanded: !!state.historyExpandedRows[entry.key],
        isNew: entry.key > state.historyNewSinceKey,
        hasDetails: !!(entry.teamLabel || entry.cards?.length || entry.voteGroups?.length || entry.resultRows?.length || entry.historyNote || entry.thresholdLabel || entry.detail),
        ...(entry.voteGroups ? { voteGroups: entry.voteGroups.map(group => ({
          ...group, seatNumbers: group.seatNumbers || (group.seats.match(/\d+/g) || []).map(Number),
        })) } : {}),
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
    if (key !== null) expanded[key] = true;
    const patch = {
      historyOpen: true, historyFilter: "all",
      historyFilters: state.room?.knights ? filters : filters.filter(item => item.value !== "skill"),
      historySnapshotKey: lastKey(history), historySeenKey: lastKey(history),
      historyNewSinceKey: state.historySeenKey, historyUnreadCount: 0,
      historyExpandedRows: expanded, focusedHistoryKey: key, historyScrollTarget: "",
    };
    return { ...patch, visibleHistory: rows({ ...state, ...patch }, history) };
  }
  function filter(state, value) {
    if (!state.historyFilters.some(item => item.value === value)) return {};
    const patch = { historyFilter: value, focusedHistoryKey: null, historyScrollTarget: "" };
    return { ...patch, visibleHistory: rows({ ...state, ...patch }, state.history || []) };
  }
  function toggleRow(state, key) {
    if (!state.visibleHistory.some(entry => entry.key === key && entry.hasDetails)) return {};
    const patch = { historyExpandedRows: { ...state.historyExpandedRows, [key]: !state.historyExpandedRows[key] } };
    return { ...patch, visibleHistory: rows({ ...state, ...patch }, state.history || []) };
  }
  return { initialData, category, voteRecord, inspectionLabel, questThresholdLabel, questProgress, sync, open, filter, toggleRow };
});
