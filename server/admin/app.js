"use strict";
const $ = (id) => document.getElementById(id);
const labels = {
  "test-on": "开启陪测",
  "test-off": "关闭陪测",
  "clear-testers": "清理陪测座位",
  terminate: "终止对局",
  rematch: "同房重开",
  delete: "删除房间",
  login: "管理员登录",
  "correct-result": "更正对局结果",
  "adjust-player-score": "调整玩家积分",
  "adjust-match-scores": "调整本局积分",
  companion: "陪测玩家",
  player: "玩家",
};
let auditOffset = 0;
let auditCode = null;
let auditRooms = [];
let offset = 0,
  pending = null,
  loading = false,
  actionBusy = false;
async function api(path, data) {
  const response = await fetch("/api/admin/" + path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (response.status === 401) showSession(false);
  if (!response.ok) throw Object.assign(new Error(result.error || "请求失败"), { status: response.status });
  return result;
}
function showSession(on) {
  $("login").hidden = on;
  $("dashboard").hidden = !on;
  $("logout").hidden = !on;
  if (!on) {
    $("rooms").replaceChildren();
    $("audit").replaceChildren();
  }
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function feedback(error) {
  $("feedback").textContent = error.message || error;
}
async function currentRoomCodes(page) {
  const codes = page.rooms.map((room) => room.code);
  for (let start = 0; start < page.total; start += 50) {
    if (start === offset) continue;
    const next = await api("rooms?offset=" + start);
    codes.push(...next.rooms.map((room) => room.code));
  }
  return [...new Set(codes)].sort();
}
async function fetchAudit(code, start) {
  const path = "audit?grouped=1&code=" + encodeURIComponent(code || "");
  const result = await api(path + "&offset=" + start);
  if (result.filtered) return result;
  // Older running servers may still return account-creation events.
  // Filter before local pagination so counts and page boundaries stay correct.
  let groups = start === 0 ? [...result.groups] : [];
  for (let cursor = 0; cursor < result.total; cursor += result.pageSize) {
    if (cursor === start) {
      if (start !== 0) groups.push(...result.groups);
      continue;
    }
    const page = await api(path + "&offset=" + cursor);
    groups.push(...page.groups);
  }
  groups = groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => entry.action !== "actor"),
    }))
    .filter((group) => group.entries.length);
  return {
    groups: groups.slice(start, start + result.pageSize),
    total: groups.length,
    pageSize: result.pageSize,
  };
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  $("audit-room").disabled = true;
  try {
    let [roomPage, auditResult] = await Promise.all([
      api("rooms?offset=" + offset),
      fetchAudit(auditCode, auditOffset),
    ]);
    const { rooms, total } = roomPage;
    auditRooms = await currentRoomCodes(roomPage);
    showSession(true);
    $("count").textContent = `共 ${total} 个房间`;
    $("rooms").replaceChildren();
    if (!rooms.length)
      $("rooms").append(
        el("p", "暂无房间。可先在小程序创建牌桌，再刷新列表。"),
      );
    for (const room of rooms) $("rooms").append(renderRoom(room));
    $("prev").disabled = offset === 0;
    $("next").disabled = offset + 50 >= total;
    $("page").textContent = `第 ${offset / 50 + 1} 页`;
    if (auditCode === null || (auditCode && !auditRooms.includes(auditCode))) {
      auditCode = auditRooms[0] || "";
      auditOffset = 0;
      auditResult = await fetchAudit(auditCode, 0);
    }
    $("audit-room").textContent = auditCode
      ? "房间 " + auditCode
      : "平台操作（无房间）";
    renderAudit(auditResult);
    feedback("已更新 · " + new Date().toLocaleTimeString());
  } catch (error) {
    feedback(error);
  } finally {
    loading = false;
    $("refresh").disabled = actionBusy;
    $("audit-room").disabled = false;
  }
}
function renderRoom(room) {
  const row = el("div", "", "room");
  const details = el("div", "", "room-details");
  const title = el("div", "", "room-title");
  title.append(
    el("strong", room.code),
    el(
      "span",
      room.testRoom ? "陪测已开启" : "正式房间",
      room.testRoom ? "badge badge-test" : "badge",
    ),
  );
  details.append(title, el("p", room.boardName, "room-board"));
  const state = el("div", "", "room-state");
  const ended = ["ended", "terminated"].includes(room.phase);
  state.append(
    el(
      "span",
      room.phaseName,
      "room-phase" +
        (room.phase === "lobby" || ended ? "" : " room-phase-active"),
    ),
    el(
      "p",
      `${room.players}/${room.capacity} 人 · 第 ${room.game} 局`,
      "room-counts",
    ),
  );
  const actions = el("div", "", "actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", `房间 ${room.code} 的操作`);
  if (room.testRoom) {
    const link = el("a", "打开陪测台", "companion-link");
    link.href = "/admin/companion?room=" + encodeURIComponent(room.code);
    link.setAttribute("aria-label", `打开房间 ${room.code} 的陪测台`);
    actions.append(link);
  }
  const mainAction =
    room.phase === "lobby"
      ? room.testRoom
        ? "test-off"
        : "test-on"
      : ended
        ? "rematch"
        : "terminate";
  const more = el("details", "", "room-more");
  const trigger = el("summary", "更多操作");
  trigger.setAttribute("aria-label", `房间 ${room.code} 的更多操作`);
  const menu = el("div", "", "room-action-menu");
  const actionButton = (action) => {
    const button = el(
      "button",
      labels[action],
      action === "delete" ? "danger" : "",
    );
    button.type = "button";
    button.disabled =
      (action.startsWith("test-") || action === "clear-testers") &&
      room.phase !== "lobby";
    button.addEventListener("click", () => {
      more.open = false;
      // Keep the return focus on a visible control after the dialog closes.
      if (action !== mainAction) trigger.focus();
      openAction(room, action);
    });
    return button;
  };
  const primary = actionButton(mainAction);
  primary.classList.add("room-main-action");
  actions.append(primary);
  menu.append(el("p", "陪测管理", "room-menu-label"));
  for (const action of [
    room.testRoom ? "test-off" : "test-on",
    "clear-testers",
  ])
    if (action !== mainAction) menu.append(actionButton(action));
  if (room.phase !== "lobby")
    menu.append(el("p", "陪测设置仅在准备阶段可用", "room-menu-hint"));
  const destructive = el("div", "", "room-menu-danger");
  destructive.append(actionButton("delete"));
  menu.append(destructive);
  more.append(trigger, menu);
  trigger.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".room-more[open]"))
      if (other !== more) other.open = false;
  });
  more.addEventListener("focusout", (event) => {
    if (!more.contains(event.relatedTarget)) more.open = false;
  });
  actions.append(more);
  row.append(details, state, actions);
  return row;
}
document.addEventListener("click", (event) => {
  for (const more of document.querySelectorAll(".room-more[open]"))
    if (!more.contains(event.target)) more.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const more of document.querySelectorAll(".room-more[open]")) {
    const focused = more.contains(document.activeElement);
    more.open = false;
    if (focused) more.querySelector("summary").focus();
  }
});

function renderAudit({ groups, total, pageSize }) {
  $("audit").replaceChildren();
  $("audit-count").textContent = `共 ${total} 组 · 每页 ${pageSize} 组`;
  $("audit-page").textContent = `第 ${auditOffset / pageSize + 1} 页`;
  $("audit-prev").disabled = auditOffset === 0;
  $("audit-next").disabled = auditOffset + pageSize >= total;
  if (!groups.length) $("audit").append(el("p", "暂无操作记录"));
  for (const group of groups) {
    const entries = group.entries;
    const d = entries[0].details;
    const block = el("div", "", "audit-stage");
    const header = el("div", "", "audit-stage-heading");
    const title = d.phase
      ? d.phaseKey === "skillPrepare"
        ? "放技能阶段"
        : d.phase
      : d.label || labels[entries[0].action] || "房间操作";
    const startedAt = entries.find((entry) => entry.details.activityStartedAt)
      ?.details.activityStartedAt;
    const timestamp =
      startedAt || Math.min(...entries.map((entry) => entry.created));
    header.append(
      el("h3", title),
      el(
        "time",
        `${startedAt ? "发起于" : "记录于"} ${new Date(timestamp).toLocaleString()}`,
      ),
    );
    block.append(header);
    const players = new Map();
    for (const entry of [...entries].reverse()) {
      for (const player of entry.details.participants || [])
        players.set(player.seat, player);
      if (entry.details.player && !players.has(entry.details.player.seat))
        players.set(entry.details.player.seat, entry.details.player);
    }
    const summary = el("div", "", "audit-players");
    for (const player of [...players.values()].sort(
      (a, b) => a.seat - b.seat,
    )) {
      const actions = [...entries]
        .reverse()
        .filter((entry) => entry.details.player?.seat === player.seat);
      const submissions = actions.filter(
        (entry) => entry.details.command === "submit",
      );
      const primary = submissions.length
        ? submissions
        : actions.filter(
            (entry) =>
              !["ackIdentity", "ackFairyResult"].includes(
                entry.details.command,
              ),
          );
      let text;
      if (player.required && !submissions.length)
        text = group.active ? "未提交" : "未提交（阶段已结束）";
      else if (primary.length)
        text = [
          ...new Set(
            primary.map((entry) => {
              const detail = entry.details;
              if (detail.value === "pass") return "未使用技能";
              if (detail.choice) return detail.choice;
              if (detail.command === "ready")
                return detail.parameters.ready ? "已准备" : "取消准备";
              if (detail.command === "seat")
                return `换到${detail.parameters.seat}号`;
              return detail.label;
            }),
          ),
        ].join("、");
      else if (player.required)
        text = group.active ? "未提交" : "未提交（阶段已结束）";
      else if (actions.length)
        text = [...new Set(actions.map((entry) => entry.details.label))].join(
          "、",
        );
      else text = player.required === false ? "无需操作" : "未记录操作";
      // Prefer the actor snapshot over later participant snapshots (e.g. after drawing B).
      const actor =
        primary.at(-1)?.details.player ||
        actions.at(-1)?.details.player ||
        player;
      const role =
        actor.role === undefined && d.game ? "身份未记录" : actor.role;
      const line = el("span", "", "audit-player");
      line.append(
        el("strong", `${actor.seat}号·${actor.name}${role ? "·" + role : ""}`),
        document.createTextNode(" " + text),
      );
      summary.append(line);
    }
    if (players.size) block.append(summary);
    if (!d.stage && d.phase)
      block.append(
        el("p", "旧记录按连续阶段归组，未提交情况无法追溯。", "audit-note"),
      );
    if (!players.size) {
      for (const entry of entries) {
        const change=entry.details;
        if (entry.action==='adjust-player-score') block.append(el('p', `${change.uid} · ${change.before} → ${change.after} 分`, 'audit-note'));
        if (entry.action==='adjust-match-scores') for (const player of change.after || []) {
          const before=change.before?.find(row=>row.uid===player.uid);
          block.append(el('p', `${player.seat}号 ${player.name} · ${before?.points ?? '—'} → ${player.points} 分`, 'audit-note'));
        }
      }
      block.append(
        el(
          "p",
          [
            ...new Set(
              entries.map((entry) =>
                [
                  entry.details.label || labels[entry.action] || entry.action,
                  entry.reason,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
            ),
          ].join("；"),
        ),
      );
    }
    $("audit").append(block);
  }
}
function renderRoomOptions() {
  const query = $("room-search").value.trim();
  const codes = auditRooms.filter((code) => code.includes(query));
  $("room-picker-count").textContent = `共 ${auditRooms.length} 个现有房间`;
  $("room-options").replaceChildren();
  for (const code of [...(query ? [] : [""]), ...codes]) {
    const button = el("button", "", "room-option");
    button.setAttribute("aria-pressed", String(code === auditCode));
    button.append(
      el("span", code ? "房间 " + code : "平台操作", "room-option-title"),
      el(
        "span",
        code === auditCode ? "已选择" : code ? "查看记录" : "无房间",
        "room-option-hint",
      ),
    );
    button.addEventListener("click", () => {
      if (loading) return;
      auditCode = code;
      auditOffset = 0;
      $("room-picker").close();
      refresh();
    });
    $("room-options").append(button);
  }
  if (query && !codes.length)
    $("room-options").append(
      el("p", "没有匹配的现有房间", "room-picker-empty"),
    );
}
$("audit-room").addEventListener("click", () => {
  $("room-search").value = "";
  renderRoomOptions();
  $("room-picker").showModal();
  $("room-search").focus();
});
$("room-search").addEventListener("input", renderRoomOptions);
$("room-picker-close").addEventListener("click", () =>
  $("room-picker").close(),
);
$("audit-prev").addEventListener("click", () => {
  if (loading) return;
  auditOffset = Math.max(0, auditOffset - 20);
  refresh();
});
$("audit-next").addEventListener("click", () => {
  if (loading) return;
  auditOffset += 20;
  refresh();
});
function openAction(room, action) {
  if (actionBusy) return;
  if (["test-on", "clear-testers"].includes(action))
    return executeAction(room, action, false);
  pending = { room, action };
  $("action-title").textContent = `${labels[action]} · ${room.code}`;
  $("action-description").textContent = {
    "clear-testers":
      "仅清理本平台生成的陪测账号，真人玩家保留。旧陪测凭据立即失效；用于会话过期或浏览器关闭后的恢复。",
    delete: "房间和成员关系将删除，无法从平台撤销。",
    terminate: "当前对局将终止，不判胜负。",
    rematch: "清除上一局状态并回到准备阶段，保留房间与玩家座位。",
    "test-on": "允许管理员创建的陪测账号加入现有房间。所有玩家将看到测试标记。",
    "test-off": "关闭后陪测账号不能再访问该房间；需先清空陪测玩家。",
  }[action];
  $("action-form").reset();
  $("action-error").textContent = "";
  $("submit-action").textContent = labels[action];
  $("submit-action").className = ["delete", "terminate"].includes(action)
    ? "danger"
    : "primary";
  $("confirm-dialog").showModal();
  $("cancel").focus();
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("login", { key: $("key").value });
    $("key").value = "";
    await refresh();
  } catch (error) {
    feedback(error);
  } finally {
    button.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("logout", {});
    sessionStorage.removeItem("shadowtable-admin-companion-v1");
    showSession(false);
    feedback("已退出，陪测凭据已失效。");
  } catch (error) {
    feedback(error);
  }
});
async function executeAction(room, action, confirmed) {
  if (actionBusy) return;
  actionBusy = true;
  $("rooms").inert = true;
  $("refresh").disabled = true;
  $("submit-action").disabled = true;
  $("cancel").disabled = true;
  $("action-error").textContent = "";
  feedback(`正在${labels[action]} · ${room.code}`);
  try {
    await api("rooms/" + room.code, {
      action,
      stage: room.stage,
      ...(confirmed ? { confirm: true } : {}),
    });
    if (confirmed) $("confirm-dialog").close();
    pending = null;
    await refresh();
    feedback(`房间 ${room.code} · ${labels[action]}完成`);
  } catch (error) {
    const message = error.message + "；结果不确定时请刷新列表确认。";
    if (confirmed) $("action-error").textContent = message;
    feedback(message);
  } finally {
    actionBusy = false;
    $("rooms").inert = false;
    $("refresh").disabled = loading;
    $("submit-action").disabled = false;
    $("cancel").disabled = false;
  }
}
$("action-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pending || actionBusy) return;
  return executeAction(pending.room, pending.action, true);
});
$("confirm-dialog").addEventListener("cancel", (event) => {
  if (actionBusy) event.preventDefault();
});
$("confirm-dialog").addEventListener("close", () => {
  pending = null;
});
$("cancel").addEventListener("click", () => {
  if (!actionBusy) $("confirm-dialog").close();
});
$("refresh").addEventListener("click", refresh);
$("prev").addEventListener("click", () => {
  offset = Math.max(0, offset - 50);
  refresh();
});
$("next").addEventListener("click", () => {
  offset += 50;
  refresh();
});
api("session")
  .then((session) => {
    if (session.authenticated) return refresh();
    showSession(false);
  })
  .catch(feedback);

let correctionMatches = [], correctionPending = null, correctionBusy = false, correctionLoading = false;
function selectOptions(id, options) {
  $(id).replaceChildren(...options.map(item => {const option=el('option',item.label);option.value=item.value;return option;}));
}
function correctionMatch() { return correctionMatches.find(match=>match.id===$('correction-match').value); }
function updateCorrectionTarget() {
  const match=correctionMatch(), selected=match?.options.find(option=>option.id===$('correction-result').value);
  $('correction-target-row').hidden=!selected?.requiresTarget;
  $('correction-target').required=!!selected?.requiresTarget;
  $('correction-actor-row').hidden=!(selected?.requiresTarget && match?.needsActor);
}
function updateCorrectionMatch() {
  const match=correctionMatch();
  selectOptions('correction-result',[{value:'',label:'请选择结束原因'},...(match?.options || []).map(option=>({value:option.id,label:option.label}))]);
  selectOptions('correction-target',[{value:'',label:'请选择实际目标'},...(match?.players || []).filter(player=>player.alive !== false).map(player=>({value:String(player.seat),label:player.seat+'号 · '+player.name})),{value:'0',label:'空刀'}]);
  selectOptions('correction-actor',[{value:'',label:'保留原带刀记录（未登记则未知）'},...(match?.players || []).filter(player=>player.alive!==false).map(player=>({value:String(player.seat),label:player.seat+'号 · '+player.name}))]);
  $('correction-result').disabled=!match?.options.length;
  $('correction-submit').disabled=!match?.options.length;
  $('correction-status').textContent=match && !match.options.length ? '本局没有可更正的结果依据。' : '';
  updateCorrectionTarget();
  loadMatchScores();
}
async function loadCorrectionMatches() {
  if(correctionBusy || correctionPending || correctionLoading || scoreBusy || scoreWritePending || matchScoreLoading) return;
  const code=$('correction-code').value.trim();
  if(!/^\d{6}$/.test(code)) {$('correction-status').textContent='请输入6位房间号';return;}
  const selected=$('correction-match').value;correctionLoading=true;lockScoreControls();
  try {
    const result=await api('matches?code='+encodeURIComponent(code));correctionMatches=result.matches;
    selectOptions('correction-match',[{value:'',label:correctionMatches.length?'请选择对局':'暂无已归档对局'},...correctionMatches.map(match=>({value:match.id,label:new Date(match.endedAt).toLocaleString('zh-CN')+' · '+match.boardName+' · '+({good:'好人胜',evil:'坏人胜',third:'第三方胜'})[match.winner]}))]);
    if(correctionMatches.some(match=>match.id===selected))$('correction-match').value=selected;
    $('correction-match').disabled=!correctionMatches.length;updateCorrectionMatch();
  } catch(error) {$('correction-status').textContent=error.message;}
  finally {correctionLoading=false;lockScoreControls();}
}
$('correction-load').addEventListener('click',loadCorrectionMatches);
$('correction-match').addEventListener('change',updateCorrectionMatch);
$('correction-result').addEventListener('change',updateCorrectionTarget);
$('correction-form').addEventListener('submit',async event=>{
  event.preventDefault();if(correctionBusy || correctionLoading || scoreBusy || scoreWritePending || matchScoreLoading) return;
  const match=correctionMatch();if(!match || !match.options.length) return;
  if(!correctionPending) {
    if(!window.confirm('确认更正这场对局？战绩、趣味记录及适用的积分和连胜奖励会同步重算，并保留更正记录。')) return;
    const option=match.options.find(reason=>reason.id===$('correction-result').value);
    correctionPending={id:match.id,data:{requestId:crypto.randomUUID(),revision:match.revision,[match.correctionKind === "fun" ? "funReason" : "scoreReason"]:option.id,
      ...(option.requiresTarget ? {[match.correctionKind === "fun" ? "funTarget" : "scoreTarget"]:Number($('correction-target').value), ...(match.needsActor && $('correction-actor').value ? {funActor:Number($('correction-actor').value)} : {})} : {}),reason:$('correction-reason').value.trim()}};
  }
  correctionBusy=true;lockScoreControls();
  try {
    const result=await api('matches/'+correctionPending.id+'/correct',correctionPending.data);
    match.revision=result.revision;match.winner=result.winner;
    correctionPending=null;$('correction-status').textContent='已更正，战绩、趣味记录及适用的积分已同步。';$('correction-reason').value='';
  }catch(error){
    if(error.status && error.status < 500 && ![401,429].includes(error.status)) correctionPending=null;
    $('correction-status').textContent=error.message;
  }finally{
    correctionBusy=false;lockScoreControls();
    $('correction-submit').textContent=correctionPending?'重试同一更正':'确认更正整局结果';
    if(!correctionPending) {const status=$('correction-status').textContent;await loadCorrectionMatches();$('correction-status').textContent=status;}
    if(selectedScorePlayer && !correctionPending)await loadPlayerScore();
  }
});

let scorePlayers=[], scorePlayerQuery='', scorePlayerOffset=0, scorePlayerHasMore=false;
let selectedScorePlayer=null, scorePlayerHistoryOffset=0, scorePlayerHistoryMore=false, matchScoreDetail=null;
let scoreBusy=false, scoreWritePending=null, matchScoreSequence=0, matchScoreLoading=false;
const scoreControls=['score-player-query','score-player-find','score-player','score-player-prev','score-player-next','player-score-mode','player-score-points','player-score-reason','player-score-history-more','correction-load','correction-code','correction-match','correction-result','correction-target','correction-actor','correction-reason','match-score-reason'];
function lockScoreControls() {
  const locked=scoreBusy || !!scoreWritePending || correctionBusy || !!correctionPending || correctionLoading || matchScoreLoading;
  for(const id of scoreControls) $(id).disabled=locked;
  $('score-player').disabled=locked || !scorePlayers.length;
  $('score-player-prev').disabled=locked || !scorePlayerOffset;
  $('score-player-next').disabled=locked || !scorePlayerHasMore;
  $('player-score-submit').disabled=locked || !selectedScorePlayer;
  $('match-score-submit').disabled=locked || !matchScoreDetail?.players.some(player=>player.editable);
  $('correction-match').disabled=locked || !correctionMatches.length;
  $('correction-result').disabled=locked || !correctionMatch()?.options.length;
  $('correction-submit').disabled=locked || !correctionMatch()?.options.length;
  document.querySelectorAll('[data-score-uid]').forEach(node=>node.disabled=locked || node.dataset.editable==='false');
  $('player-score-submit').textContent=scoreWritePending?.kind==='player'?'重试确认玩家积分':'确认调整玩家积分';
  $('match-score-submit').textContent=scoreWritePending?.kind==='match'?'重试确认本局积分':'保存本局积分调整';
  if(scoreWritePending) {
    $('player-score-submit').disabled=scoreBusy || scoreWritePending.kind!=='player';
    $('match-score-submit').disabled=scoreBusy || scoreWritePending.kind!=='match';
  }
  if(correctionPending)$('correction-submit').disabled=correctionBusy;
}
function renderPlayerScoreSummary() {
  $('score-player-summary').textContent=selectedScorePlayer ? `${selectedScorePlayer.name} · 总积分 ${selectedScorePlayer.points} · 对局积分 ${selectedScorePlayer.matchPoints} · 管理调整 ${selectedScorePlayer.manualPoints}` : '';
}
async function searchScorePlayers(start=0) {
  if(scoreBusy || scoreWritePending || correctionBusy || correctionPending || correctionLoading || matchScoreLoading) return;
  const query=start===0?$('score-player-query').value.trim():scorePlayerQuery;if(!query)return;
  scoreBusy=true;lockScoreControls();
  try {
    const result=await api('score-players?q='+encodeURIComponent(query)+'&offset='+start);
    scorePlayerQuery=query;scorePlayerOffset=start;scorePlayerHasMore=result.hasMore;scorePlayers=result.players;selectedScorePlayer=null;
    selectOptions('score-player',[{value:'',label:scorePlayers.length?'请选择玩家':'没有匹配的玩家'},...scorePlayers.map(player=>({value:player.uid,label:`${player.name} · ${(player.publicId || player.uid).slice(-8)} · ${player.points}分`}))]);
    $('score-player-page').textContent=`第 ${start/50+1} 页`;$('player-score-history').replaceChildren();$('player-score-history-more').hidden=true;
    $('player-score-status').textContent='';renderPlayerScoreSummary();
  }catch(error){$('player-score-status').textContent=error.message;}
  finally{scoreBusy=false;lockScoreControls();}
}
function renderPlayerScoreHistory(records,append=false) {
  if(!append)$('player-score-history').replaceChildren(el('h3','玩家积分调整记录'));
  if(!records.length && !append)$('player-score-history').append(el('p','暂无调整记录'));
  for(const record of records) {
    const row=el('div','','score-history-row');row.append(el('strong',`${record.delta>=0?'+':''}${record.delta} 分 · ${record.beforePoints} → ${record.afterPoints}`),el('p',record.reason),el('p',new Date(record.created).toLocaleString()));$('player-score-history').append(row);
  }
}
async function loadPlayerScore(append=false) {
  if(scoreBusy || scoreWritePending || correctionBusy || correctionPending || correctionLoading)return;
  const player=append?selectedScorePlayer:scorePlayers.find(player=>player.uid===$('score-player').value);
  if(!player){selectedScorePlayer=null;renderPlayerScoreSummary();lockScoreControls();return;}
  scoreBusy=true;lockScoreControls();
  try {
    const start=append?scorePlayerHistoryOffset:0,result=await api('score-adjustments?uid='+encodeURIComponent(player.uid)+'&offset='+start);
    selectedScorePlayer={...player,...result};scorePlayerHistoryOffset=start+result.adjustments.records.length;scorePlayerHistoryMore=result.adjustments.hasMore;
    const option=Array.from($('score-player').options || []).find(option=>option.value===player.uid);
    if(option)option.textContent=`${player.name} · ${(player.publicId || player.uid).slice(-8)} · ${result.points}分`;
    renderPlayerScoreSummary();renderPlayerScoreHistory(result.adjustments.records,append);$('player-score-history-more').hidden=!scorePlayerHistoryMore;return true;
  }catch(error){selectedScorePlayer=null;renderPlayerScoreSummary();$('player-score-status').textContent=error.message;return false;}
  finally{scoreBusy=false;lockScoreControls();}
}
function renderMatchScorePlayers() {
  $('match-score-players').replaceChildren();
  for(const player of matchScoreDetail?.players || []) {
    const row=el('div','','score-editor-row'),label=el('label',`${player.seat}号 ${player.name}`),input=el('input'),reset=el('button','恢复自动计分');
    input.id='match-points-'+player.seat;label.htmlFor=input.id;
    label.append(el('small',player.editable?`当前 ${player.score.total} 分${player.score.manualOverride?' · 已手动设置':''}`:player.score?.reason || '本局未计分'));
    input.type='number';input.min='-1000000';input.max='1000000';input.step='1';input.value=player.editable?String(player.score.total):'';
    input.dataset.scoreUid=player.uid;input.dataset.editable=String(player.editable);input.setAttribute('aria-label',`${player.seat}号 ${player.name}的本局积分`);
    input.addEventListener('input',()=>{delete input.dataset.reset;});
    reset.type='button';reset.dataset.scoreUid=player.uid;reset.dataset.editable=String(player.editable);
    reset.addEventListener('click',()=>{input.dataset.reset='true';input.value='';label.querySelector('small').textContent='待恢复自动计分';});
    row.append(label,input,reset);$('match-score-players').append(row);
  }
  lockScoreControls();
}
async function loadMatchScores() {
  if(scoreWritePending)return;
  const sequence=++matchScoreSequence,match=correctionMatch();matchScoreDetail=null;matchScoreLoading=!!match;$('match-score-players').replaceChildren();lockScoreControls();
  if(!match){$('match-score-status').textContent='';return;}
  $('match-score-status').textContent='正在读取本局积分…';
  try {
    const result=await api('matches/'+match.id+'/scores');if(sequence!==matchScoreSequence)return;
    matchScoreDetail=result;match.revision=result.revision;renderMatchScorePlayers();$('match-score-status').textContent='';return true;
  }catch(error){if(sequence===matchScoreSequence)$('match-score-status').textContent=error.message;return false;}
  finally{if(sequence===matchScoreSequence){matchScoreLoading=false;lockScoreControls();}}
}
async function submitScoreWrite(kind) {
  if(scoreBusy || correctionBusy || correctionPending || correctionLoading || matchScoreLoading || scoreWritePending && scoreWritePending.kind!==kind)return;
  const status=$(kind==='player'?'player-score-status':'match-score-status');
  if(!scoreWritePending) {
    const reason=$(kind==='player'?'player-score-reason':'match-score-reason').value.trim();
    if(reason.length<2){status.textContent='请填写至少2字的调整原因';return;}
    let path,data;
    if(kind==='player') {
      if(!selectedScorePlayer)return;
      const raw=$('player-score-points').value,points=Number(raw);if(!raw || !Number.isSafeInteger(points)){status.textContent='请输入整数积分';return;}
      const mode=$('player-score-mode').value,after=mode==='set'?points:selectedScorePlayer.points+points;
      if(!window.confirm(`调整 ${selectedScorePlayer.name} 的总积分：${selectedScorePlayer.points} → ${after} 分？`))return;
      path='score-adjustments';data={uid:selectedScorePlayer.uid,revision:selectedScorePlayer.revision,mode,points};
    } else {
      if(!matchScoreDetail)return;
      const scores=[];
      for(const input of $('match-score-players').querySelectorAll('input[data-score-uid]')) {
        const player=matchScoreDetail.players.find(player=>player.uid===input.dataset.scoreUid);if(!player.editable)continue;
        if(input.dataset.reset==='true')scores.push({uid:player.uid,points:null});
        else if(input.value!==String(player.score.total)) {
          const points=Number(input.value);if(!input.value || !Number.isSafeInteger(points)){status.textContent='请填写整数得分，或选择恢复自动计分';return;}scores.push({uid:player.uid,points});
        }
      }
      if(!scores.length){status.textContent='没有需要保存的积分变化';return;}
      if(!window.confirm(`确认修改本局 ${scores.length} 名玩家的积分？胜负与连胜保持原结果。`))return;
      path='matches/'+matchScoreDetail.id+'/scores';data={revision:matchScoreDetail.revision,scores};
    }
    scoreWritePending={kind,path,data:{...data,reason,requestId:crypto.randomUUID()}};
  }
  scoreBusy=true;lockScoreControls();status.textContent='正在保存…';
  try {
    await api(scoreWritePending.path,scoreWritePending.data);scoreWritePending=null;
    $(kind==='player'?'player-score-reason':'match-score-reason').value='';
    if(kind==='player')$('player-score-points').value='';
    scoreBusy=false;const loaded=kind==='player'?await loadPlayerScore():await loadMatchScores();
    status.textContent=loaded?'已保存，积分及排行榜已更新。':'已保存；读取最新积分失败，请重新查询。';
    if(kind==='match' && selectedScorePlayer)await loadPlayerScore();
  }catch(error){
    if(error.status && error.status<500 && ![401,429].includes(error.status))scoreWritePending=null;
    status.textContent=error.message+(scoreWritePending?'；请重试确认结果。':'；请重新查询后操作。');
  }finally{scoreBusy=false;lockScoreControls();}
}
$('score-player-search').addEventListener('submit',event=>{event.preventDefault();searchScorePlayers();});
$('score-player-prev').addEventListener('click',()=>searchScorePlayers(Math.max(0,scorePlayerOffset-50)));
$('score-player-next').addEventListener('click',()=>searchScorePlayers(scorePlayerOffset+50));
$('score-player').addEventListener('change',()=>loadPlayerScore());
$('player-score-history-more').addEventListener('click',()=>loadPlayerScore(true));
$('player-score-form').addEventListener('submit',event=>{event.preventDefault();submitScoreWrite('player');});
$('match-score-form').addEventListener('submit',event=>{event.preventDefault();submitScoreWrite('match');});
