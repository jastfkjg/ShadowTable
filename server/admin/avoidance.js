"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let page = null, offset = 0, busy = false, loading = false, pending = null, sequence = 0;
  function lock() {
    for (const node of $("card-management").querySelectorAll("input,select,button")) node.disabled = busy || !!pending || loading;
    $("cards-submit").disabled = busy || loading || !pending && (!page || !page.total || $("cards-scope").value === "player" && !$("cards-player").value);
    $("cards-submit").textContent = busy ? "正在发放…" : pending ? "重试并核对发放结果" : "确认发放";
    $("cards-prev").disabled = busy || !!pending || loading || offset === 0;
    $("cards-next").disabled = busy || !!pending || loading || !page?.hasMore;
  }
  function scope() {
    const all = $("cards-scope").value === "all";
    $("cards-player-field").hidden = all;
    $("cards-pager").hidden = all || !page || offset === 0 && !page.hasMore;
    $("cards-count").textContent = all ? `将向全部 ${page?.total || 0} 个现有玩家账号发放，请核对数量。` : "请选择玩家；同名玩家请核对账号标识。";
    lock();
  }
  async function load(start = 0) {
    if (busy || pending) return;
    const turn = ++sequence, selected = $("cards-player").value;
    loading = true; lock();
    try {
      const result = await api("avoidance?q=" + encodeURIComponent($("cards-query").value.trim()) + "&offset=" + start);
      if (turn !== sequence) return;
      page = result; offset = start;
      $("cards-player").replaceChildren(new Option(result.players.length ? "请选择玩家" : "未找到玩家", ""), ...result.players.map(p => new Option(`${p.name} · ${p.balance} 张 · ${p.uid}`, p.uid)));
      if (result.players.some(p => p.uid === selected)) $("cards-player").value = selected;
      $("cards-page").textContent = `第 ${start / 50 + 1} 页`;
      $("cards-status").textContent = result.players.length ? "" : "没有匹配的玩家，可修改关键词后重试。";
    } catch (error) { if (turn === sequence) { page = null; $("cards-status").textContent = error.message; } }
    finally { if (turn === sequence) { loading = false; scope(); } }
  }
  $("cards-grant").addEventListener("submit", async event => {
    event.preventDefault(); if (busy || loading) return;
    if (!pending) {
      const amount = Number($("cards-amount").value), reason = $("cards-reason").value.trim(), scope = $("cards-scope").value;
      const player = page?.players.find(p => p.uid === $("cards-player").value);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100 || !reason || !page || scope === "player" && !player) return;
      const data = { scope, amount, reason, ...(scope === "all" ? { expectedCount: page.total } : { uid: player.uid }), requestId: crypto.randomUUID() };
      busy = true; lock();
      const confirmed = await window.AdminUI.confirm({ title: "发放回避卡", description: scope === "all" ? `向全部 ${page.total} 个现有玩家账号每人发放 ${amount} 张，共 ${page.total * amount} 张。原因：${reason}` : `向 ${player.name}（${player.uid}）发放 ${amount} 张。原因：${reason}` });
      busy = false; if (!confirmed) { lock(); return; } pending = data;
    }
    busy = true; lock(); $("cards-status").textContent = "正在发放…";
    try {
      const result = await api("avoidance", pending); pending = null; busy = false;
      await load(offset); $("cards-status").textContent = `已向 ${result.recipients} 位玩家每人发放 ${result.amount} 张回避卡。`;
    } catch (error) {
      if (error.status && error.status < 500 && ![401, 429].includes(error.status)) pending = null;
      $("cards-status").textContent = error.message + (pending ? "；结果尚未确认，请重试核对，不会重复发放。" : "；请刷新后重新操作。");
    } finally { busy = false; lock(); }
  });
  $("dashboard-tab-cards").addEventListener("click", () => load());
  $("dashboard-tab-cards").addEventListener("focus", () => { if ($("dashboard-tab-cards").getAttribute("aria-selected") === "true" && !page && !loading) load(); });
  $("cards-refresh").addEventListener("click", () => load(offset));
  $("cards-search").addEventListener("submit", event => { event.preventDefault(); load(); });
  $("cards-prev").addEventListener("click", () => load(Math.max(0, offset - 50)));
  $("cards-next").addEventListener("click", () => load(offset + 50));
  $("cards-player").addEventListener("change", lock);
  $("cards-scope").addEventListener("change", scope);
  window.AvoidanceAdmin = { clear() { sequence++; loading = false; page = null; $("cards-player").replaceChildren(new Option("请先载入玩家", "")); lock(); } };
})();
