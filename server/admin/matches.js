"use strict";
(() => {
  let rows = [],
    selection = new Set(),
    filters = null,
    page = 0,
    total = 0;
  let busy = false,
    detailId = null,
    pending = null,
    preview = null,
    returnFocus = null;
  let people = [],
    peopleOffset = 0,
    peopleQuery = "",
    peopleMore = false;
  const actions = {
    delete: "删除记录",
    restore: "恢复记录",
    exclude: "不计战绩",
    include: "计入战绩",
  };
  const locked = () =>
    busy ||
    !!pending ||
    scoreBusy ||
    !!scoreWritePending ||
    correctionBusy ||
    !!correctionPending ||
    correctionLoading ||
    matchScoreLoading;
  const date = (value) =>
    new Date(value).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const status = (value) => {
    $("record-status").textContent = value;
  };
  function lock() {
    const disabled = locked();
    $("record-filter").inert = disabled;
    $("record-list").inert = disabled;
    $("record-bulk").inert = disabled;
    $("record-select-all").disabled = disabled || !rows.length;
    $("record-reload").disabled = disabled || !filters;
    $("record-prev").disabled = disabled || page === 0;
    $("record-next").disabled = disabled || page + rows.length >= total;
    $("record-detail").inert = busy || !!pending;
    $("record-workspace").setAttribute("aria-busy", String(busy));
  }
  function selected() {
    return rows.filter((row) => selection.has(row.id));
  }
  function updateSelection() {
    const records = selected();
    $("record-bulk").hidden = !records.length;
    $("record-selection").textContent =
      `已选 ${records.length} 场 · 操作影响整局所有参与者`;
    $("record-select-all").checked =
      !!rows.length && records.length === rows.length;
    $("record-select-all").indeterminate =
      records.length > 0 && records.length < rows.length;
    $("record-delete").disabled =
      !records.length || records.some((row) => row.state === "deleted");
    $("record-restore").disabled =
      !records.length || records.some((row) => row.state !== "deleted");
    $("record-exclude").disabled =
      !records.length || records.some((row) => row.state !== "active");
    $("record-include").disabled =
      !records.length || records.some((row) => row.state !== "excluded");
    document.querySelectorAll("[data-record-id]").forEach((input) => {
      input.checked = selection.has(input.dataset.recordId);
      input
        .closest(".record-row")
        .classList.toggle("is-selected", input.checked);
    });
  }
  function render() {
    $("record-list").replaceChildren();
    $("record-count").textContent = filters
      ? `共 ${total} 场对局 · 按结束时间倒序`
      : "查找用户或房间，查看已归档对局。";
    $("record-pager").hidden = !total;
    $("record-page").textContent =
      `第 ${page / 20 + 1} 页 · 共 ${Math.ceil(total / 20)} 页`;
    if (!rows.length)
      $("record-list").append(
        el(
          "p",
          filters
            ? "没有符合条件的对局。可调整日期、状态或查询对象。"
            : "选择查找方式，查询要管理的对局。",
          "record-empty",
        ),
      );
    for (const record of rows) {
      const row = el("div", "", "record-row"),
        checkLabel = el("label", "", "record-check-cell"),
        check = el("input");
      check.type = "checkbox";
      check.dataset.recordId = record.id;
      check.setAttribute(
        "aria-label",
        `选择 ${date(record.endedAt)} 房间 ${record.code} 第 ${record.game} 局`,
      );
      check.addEventListener("change", () => {
        check.checked ? selection.add(record.id) : selection.delete(record.id);
        updateSelection();
      });
      checkLabel.append(check);
      const content = el("div", "", "record-content"),
        title = el("div", "", "record-row-title");
      title.append(
        el("strong", record.boardName),
        el("span", record.stateLabel, "badge record-state-" + record.state),
      );
      if (record.test) title.append(el("span", "测试用途", "record-tag"));
      if (record.companion)
        title.append(el("span", "有陪测参与", "record-tag"));
      const names = record.players
        .map((p) => `${p.seat}号 ${p.name}${p.companion ? "（陪测）" : ""}`)
        .join("、");
      content.append(
        title,
        el(
          "p",
          `${date(record.endedAt)} · 房间 ${record.code} · 第 ${record.game} 局 · ${{ good: "好人胜", evil: "坏人胜", third: "第三方胜" }[record.winner] || "未登记胜负"}`,
          "record-meta",
        ),
      );
      const members = el("details", "", "record-members");
      members.append(
        el("summary", `${record.players.length} 位参与者`),
        el("p", names),
      );
      content.append(members);
      if (record.reason && record.state !== "active")
        content.append(el("p", record.reason, "record-meta"));
      const button = el(
        "button",
        detailId === record.id ? "正在查看" : "查看详情",
      );
      button.type = "button";
      button.addEventListener("click", () => openDetail(record, true));
      row.append(checkLabel, content, button);
      $("record-list").append(row);
    }
    updateSelection();
    lock();
  }
  async function discardEdits() {
    if (
      !detailId ||
      (!matchScoreChanges().length && !$("correction-result").value)
    )
      return true;
    return window.AdminUI.confirm({
      title: "离开对局详情",
      description: "当前输入尚未保存，离开后将清空输入。",
    });
  }
  async function openDetail(record, scroll = false) {
    if (scroll && (locked() || !(await discardEdits()))) return;
    detailId = record.id;
    $("record-detail").hidden = false;
    $("record-detail-title").textContent =
      `${record.boardName} · 第 ${record.game} 局`;
    $("record-detail-summary").textContent =
      `${date(record.endedAt)} · 房间 ${record.code} · ${record.players.length} 人`;
    $("record-detail-state").textContent =
      record.state === "active"
        ? "本局可更正结果或调整积分。"
        : `${record.stateLabel}：原始结果和得分保留。请先恢复记录并计入战绩，再编辑结果或积分。`;
    correctionMatches = [record];
    selectOptions("correction-match", [
      { value: record.id, label: record.boardName },
    ]);
    $("correction-match").value = record.id;
    await updateCorrectionMatch();
    $("correction-results").hidden = true;
    $("match-score-empty").hidden = true;
    if (scroll) {
      $("record-detail-title").tabIndex = -1;
      $("record-detail-title").focus();
      $("record-detail").scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    }
    render();
  }
  function closeDetail() {
    detailId = null;
    matchScoreDetail = null;
    correctionMatches = [];
    $("record-detail").hidden = true;
    $("match-score-editor").hidden = true;
  }
  async function load(start = 0, keepDetail = false) {
    if (locked() || !filters) return;
    busy = true;
    selection.clear();
    updateSelection();
    lock();
    status("正在读取对局…");
    try {
      const params = new URLSearchParams(filters);
      params.set("offset", String(start));
      const result = await api("match-records?" + params);
      rows = result.matches;
      total = result.total;
      page = result.offset;
      // Deleting the last row on a page returns to the previous available page.
      if (total && page >= total) {
        busy = false;
        return load(Math.floor((total - 1) / 20) * 20, keepDetail);
      }
      const record = keepDetail && rows.find((row) => row.id === detailId);
      busy = false;
      if (record) await openDetail(record);
      else closeDetail();
      render();
      status(`已加载 ${rows.length} 场对局。选择记录后可批量处理。`);
    } catch (error) {
      status(error.message + "；请重试查询。");
    } finally {
      busy = false;
      lock();
    }
  }
  function currentFilters() {
    const result = { state: $("record-state").value };
    if ($("record-mode").value === "player") {
      if (!$("record-player").value) throw Error("请先查找并选择一个玩家");
      result.uid = $("record-player").value;
    } else if ($("record-mode").value === "room") {
      const code = $("record-query").value.trim();
      if (!/^\d{6}$/.test(code)) throw Error("请输入6位房间号");
      result.code = code;
    }
    for (const key of ["from", "to"])
      if ($("record-" + key).value) result[key] = $("record-" + key).value;
    if (result.from && result.to && result.from > result.to)
      throw Error("开始日期不能晚于结束日期");
    if ($("record-companion").checked) result.companion = "1";
    return result;
  }
  function setMode() {
    const mode = $("record-mode").value;
    $("record-query-field").hidden = mode === "all";
    $("record-query").required = mode !== "all";
    $("record-player-field").hidden = true;
    $("record-player").replaceChildren();
    $("record-query-label").textContent =
      mode === "room" ? "6位房间号" : "玩家昵称或账号标识";
    $("record-query").placeholder =
      mode === "room" ? "输入6位房间号" : "输入昵称、公开 ID 或账号标识";
    $("record-query").value = "";
    people = [];
    peopleQuery = "";
  }
  async function searchPeople(start = 0) {
    if (locked()) return;
    const q = start ? peopleQuery : $("record-query").value.trim();
    if (!q) {
      status("请输入玩家昵称或账号标识。");
      return;
    }
    busy = true;
    lock();
    status("正在查找玩家…");
    try {
      const result = await api(
        "score-players?q=" + encodeURIComponent(q) + "&offset=" + start,
      );
      people = result.players;
      peopleOffset = start;
      peopleMore = result.hasMore;
      peopleQuery = q;
      selectOptions("record-player", [
        { value: "", label: people.length ? "请选择玩家" : "没有匹配的玩家" },
        ...people.map((p) => ({
          value: p.uid,
          label: `${p.name} · ${p.publicId || p.uid}`,
        })),
      ]);
      $("record-player-field").hidden = false;
      $("record-player-help").textContent =
        "昵称可能重复，请用账号标识核对用户。";
      $("record-player-pager").hidden = !(start || peopleMore);
      $("record-player-prev").disabled = !start;
      $("record-player-next").disabled = !peopleMore;
      $("record-player-page").textContent = `第 ${start / 50 + 1} 页`;
      busy = false;
      if (people.length === 1 && !start && !peopleMore) {
        $("record-player").value = people[0].uid;
        filters = currentFilters();
        await load();
      } else
        status(
          people.length
            ? "请选择玩家，随后加载其对局。"
            : "未找到玩家，请检查昵称或账号标识。",
        );
    } catch (error) {
      status(error.message);
    } finally {
      busy = false;
      lock();
    }
  }
  async function search() {
    if (locked() || !(await discardEdits())) return;
    closeDetail();
    rows = [];
    selection.clear();
    total = 0;
    filters = null;
    render();
    if (
      $("record-mode").value === "player" &&
      (peopleQuery !== $("record-query").value.trim() ||
        !$("record-player").value)
    )
      return searchPeople();
    try {
      filters = currentFilters();
      await load();
    } catch (error) {
      status(error.message);
    }
  }
  async function begin(action) {
    if (locked() || !selected().length || !(await discardEdits())) return;
    returnFocus = document.activeElement;
    const input = {
      action,
      matches: selected().map((row) => ({
        id: row.id,
        revision: row.revision,
      })),
    };
    busy = true;
    lock();
    status("正在计算所有参与者的统计变化…");
    try {
      preview = await api("match-records/preview", input);
      pending = { ...input, requestId: crypto.randomUUID() };
      closeDetail();
      $("record-confirm-title").textContent =
        `${actions[action]} · ${preview.matches.length} 场对局`;
      $("record-confirm-description").textContent =
        `本次操作影响整局所有参与者，共 ${preview.affectedPlayers} 个账号。` +
        {
          delete:
            "删除后普通对局列表隐藏，所有正式统计排除；原始数据保留，可在“已删除”中恢复。",
          restore: "恢复到删除前的状态；原来不计战绩的记录恢复后仍不计战绩。",
          exclude: "记录仍可回查，胜负、积分和趣味统计排除本局。",
          include:
            "恢复本局原有的统计资格；原本未计分或未登记胜负的局仍按原规则处理。",
        }[action];
      $("record-confirm-matches").replaceChildren(
        ...preview.matches.map((row) =>
          el(
            "p",
            `${date(row.endedAt)} · 房间 ${row.code} 第 ${row.game} 局 · ${row.boardName}`,
          ),
        ),
      );
      $("record-reason").value =
        action === "delete" || action === "exclude" ? "陪测清理" : "管理更正";
      $("record-note").value = "";
      $("record-impact-title").textContent =
        `查看 ${preview.affectedPlayers} 个账号的统计变化`;
      $("record-impact-players").replaceChildren(
        ...preview.players.map((p) => {
          const block = el("div", "", "record-impact-row");
          block.append(
            el("strong", p.name + (p.companion ? "（陪测）" : "")),
            el("small", p.uid),
            el(
              "p",
              `有效局 ${p.before.games} → ${p.after.games} · 胜场 ${p.before.wins} → ${p.after.wins} · 积分 ${p.before.points} → ${p.after.points} · 当前连胜 ${p.before.streak} → ${p.after.streak} · 趣味次数合计 ${p.before.fun} → ${p.after.fun}`,
            ),
          );
          return block;
        }),
      );
      $("record-confirm-error").textContent = "";
      $("record-confirm-submit").textContent = "确认" + actions[action];
      $("record-confirm-submit").className =
        action === "delete" ? "danger" : "primary";
      $("record-confirm-cancel").disabled = false;
      $("record-confirm-submit").disabled = false;
      $("record-reason").disabled = false;
      $("record-note").disabled = false;
      $("record-confirm").showModal();
      $("record-confirm-cancel").focus();
      status("请核对操作范围和统计变化。");
    } catch (error) {
      status(error.message + "；请刷新后重新选择。");
    } finally {
      busy = false;
      lock();
    }
  }
  async function submit() {
    if (busy || !pending) return;
    if (!pending.submitted) {
      pending.reason =
        $("record-reason").value +
        ($("record-note").value.trim()
          ? " · " + $("record-note").value.trim()
          : "");
      pending.submitted = true;
    }
    busy = true;
    lock();
    $("record-confirm-submit").disabled = true;
    $("record-confirm-cancel").disabled = true;
    $("record-reason").disabled = true;
    $("record-note").disabled = true;
    $("record-confirm-error").textContent = "正在保存…";
    try {
      const { submitted, ...input } = pending;
      await api("match-records/manage", input);
      const message = `已${actions[input.action]} ${input.matches.length} 场对局，统计及排行榜已更新。`;
      pending = null;
      preview = null;
      $("record-confirm").close();
      busy = false;
      await load(page, false);
      status(message);
      $("record-status").tabIndex = -1;
      $("record-status").focus();
      if (selectedScorePlayer) await loadPlayerScore();
    } catch (error) {
      const uncertain =
        !error.status ||
        error.status >= 500 ||
        [401, 429].includes(error.status);
      if (!uncertain) {
        pending = null;
        $("record-confirm-cancel").disabled = false;
      }
      $("record-confirm-error").textContent =
        error.message +
        (uncertain
          ? "；结果尚未确认，请重试确认同一操作。"
          : "；请关闭窗口并刷新后重新预览。");
      $("record-confirm-submit").textContent = "重试确认结果";
      $("record-confirm-submit").disabled = !uncertain;
    } finally {
      busy = false;
      lock();
    }
  }
  $("record-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    search();
  });
  $("record-mode").addEventListener("change", async () => {
    if (!(await discardEdits())) {
      $("record-mode").value = filters?.uid
        ? "player"
        : filters?.code
          ? "room"
          : "all";
      return;
    }
    setMode();
    closeDetail();
    rows = [];
    selection.clear();
    filters = null;
    total = 0;
    render();
    status("");
  });
  $("record-query").addEventListener("input", () => {
    if (peopleQuery !== $("record-query").value.trim()) {
      $("record-player").value = "";
      $("record-player-field").hidden = true;
    }
  });
  $("record-player").addEventListener("change", search);
  $("record-player-prev").addEventListener("click", () =>
    searchPeople(Math.max(0, peopleOffset - 50)),
  );
  $("record-player-next").addEventListener("click", () =>
    searchPeople(peopleOffset + 50),
  );
  $("record-reload").addEventListener("click", async () => {
    if (await discardEdits()) load(page, true);
  });
  $("record-prev").addEventListener("click", async () => {
    if (await discardEdits()) load(Math.max(0, page - 20));
  });
  $("record-next").addEventListener("click", async () => {
    if (await discardEdits()) load(page + 20);
  });
  $("record-select-all").addEventListener("change", () => {
    selection = $("record-select-all").checked
      ? new Set(rows.map((row) => row.id))
      : new Set();
    updateSelection();
  });
  $("record-clear").addEventListener("click", () => {
    selection.clear();
    updateSelection();
  });
  for (const action of Object.keys(actions))
    $("record-" + action).addEventListener("click", () => begin(action));
  $("record-detail-close").addEventListener("click", async () => {
    if (locked() || !(await discardEdits())) return;
    closeDetail();
    render();
    $("record-reload").focus();
  });
  $("record-confirm-submit").addEventListener("click", submit);
  $("record-confirm-cancel").addEventListener("click", () => {
    if (busy || pending?.submitted) return;
    pending = null;
    preview = null;
    $("record-confirm").close();
    lock();
  });
  $("record-confirm").addEventListener("cancel", (event) => {
    if (busy || pending?.submitted) event.preventDefault();
    else {
      pending = null;
      preview = null;
      lock();
    }
  });
  $("record-confirm").addEventListener("close", () => {
    if (!pending && returnFocus?.isConnected && !returnFocus.disabled)
      returnFocus.focus();
  });
  $("records-for-player").addEventListener("click", async () => {
    if (locked() || !selectedScorePlayer || !(await discardEdits())) return;
    $("dashboard-tab-scores").click();
    selectScoreTab("match");
    $("record-mode").value = "player";
    setMode();
    const p = selectedScorePlayer;
    $("record-query").value = p.uid;
    peopleQuery = p.uid;
    selectOptions("record-player", [
      { value: p.uid, label: `${p.name} · ${p.uid}` },
    ]);
    $("record-player").value = p.uid;
    $("record-player-field").hidden = false;
    filters = currentFilters();
    await load();
  });
  window.MatchRecords = {
    syncLock: lock,
    refresh: () => load(page, true),
    clear: () => {
      rows = [];
      selection.clear();
      filters = null;
      total = 0;
      closeDetail();
      render();
      if ($("record-confirm").open) $("record-confirm").close();
    },
    resume: () => {
      if (pending?.submitted) {
        $("record-confirm").showModal();
        $("record-confirm-submit").disabled = false;
        lock();
      }
    },
  };
})();
