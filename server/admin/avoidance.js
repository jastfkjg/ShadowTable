"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let page = null, offset = 0, busy = false, confirming = false, loading = false, pending = null, sequence = 0;
  const selectedPlayer = () => page?.players.find(p => p.uid === $("cards-player").value);
  const validAmount = () => Number.isSafeInteger(Number($("cards-amount").value)) && Number($("cards-amount").value) >= 1 && Number($("cards-amount").value) <= 100;
  function status(message, tone = "") { $("cards-status").textContent = message; $("cards-status").dataset.tone = tone; }
  function summary() {
    const all = $("cards-scope").value === "all", player = selectedPlayer(), amount = Number($("cards-amount").value);
    const count = all ? page?.total || 0 : player ? 1 : 0;
    $("cards-summary-target").textContent = all ? "所有现有玩家" : player?.name || "请先选择玩家";
    $("cards-summary-recipients").textContent = count ? count + " 人" : "—";
    $("cards-summary-amount").textContent = validAmount() ? amount + " 张" : "—";
    $("cards-summary-total").textContent = count && validAmount() ? count * amount + " 张" : "—";
    $("cards-summary-balance").hidden = all || !player || !validAmount();
    $("cards-summary-balance").textContent = player ? `当前 ${player.balance} 张 → 发放后 ${player.balance + amount} 张` : "";
    $("cards-player-detail").textContent = player ? "账号：" + player.uid : "同名玩家请核对账号标识。";
    $("cards-amount-error").hidden = validAmount();
    $("cards-amount").setAttribute("aria-invalid", String(!validAmount()));
    for (const button of $("card-management").querySelectorAll("[data-card-amount]")) button.setAttribute("aria-pressed", String(Number(button.dataset.cardAmount) === amount));
  }
  function lock() {
    for (const node of $("card-management").querySelectorAll("input,select,button")) node.disabled = busy || !!pending || loading;
    $("cards-submit").disabled = busy || loading || !pending && (!validAmount() || !page || !page.total || $("cards-scope").value === "player" && !selectedPlayer());
    $("cards-submit").textContent = confirming ? "等待确认…" : busy ? "正在发放…" : pending ? "重试并核对发放结果" : "确认发放";
    $("cards-prev").disabled = busy || !!pending || loading || offset === 0;
    $("cards-next").disabled = busy || !!pending || loading || !page?.hasMore;
    summary();
  }
  function scope() {
    const all = $("cards-scope").value === "all";
    $("cards-player-field").hidden = all;
    $("cards-pager").hidden = all || !page || offset === 0 && !page.hasMore;
    $("cards-count").textContent = loading ? "正在读取玩家…" : all ? `共 ${page?.total || 0} 位玩家，发放前请核对发放摘要。` : page?.players.length ? `本页 ${page.players.length} 位玩家，可按昵称查找。` : "没有匹配的玩家，请换个关键词查找。";
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
      $("cards-player").replaceChildren(new Option(result.players.length ? "请选择玩家" : "未找到玩家", ""), ...result.players.map(p => new Option(`${p.name} · ${p.balance} 张 · ${p.uid.length > 18 ? p.uid.slice(0, 7) + "…" + p.uid.slice(-6) : p.uid}`, p.uid)));
      if (result.players.some(p => p.uid === selected)) $("cards-player").value = selected;
      $("cards-page").textContent = `第 ${start / 50 + 1} 页`;
      status("");
    } catch (error) { if (turn === sequence) { page = null; status(error.message, "error"); } }
    finally { if (turn === sequence) { loading = false; scope(); } }
  }
  $("cards-grant").addEventListener("submit", async event => {
    event.preventDefault(); if (busy || loading) return;
    if (!pending) {
      const amount = Number($("cards-amount").value), reason = $("cards-reason").value.trim(), scope = $("cards-scope").value;
      const player = page?.players.find(p => p.uid === $("cards-player").value);
      if (!validAmount() || !page || !page.total || scope === "player" && !player) return;
      const data = { scope, amount, reason, ...(scope === "all" ? { expectedCount: page.total } : { uid: player.uid }), requestId: crypto.randomUUID() };
      busy = true; confirming = true; lock();
      const confirmed = await window.AdminUI.confirm({ title: "确认发放回避卡", confirmText: "确认发放", description: (scope === "all" ? `向全部 ${page.total} 个现有玩家账号每人发放 ${amount} 张，共 ${page.total * amount} 张。` : `向 ${player.name}（${player.uid}）发放 ${amount} 张，发放后可用 ${player.balance + amount} 张。`) + (reason ? `原因：${reason}` : "") });
      busy = false; confirming = false; if (!confirmed) { lock(); return; } pending = data;
    }
    busy = true; lock(); status("正在发放…");
    try {
      const result = await api("avoidance", pending); pending = null; busy = false;
      await load(offset); status(`发放成功：${result.recipients} 位玩家每人获得 ${result.amount} 张，共 ${result.recipients * result.amount} 张回避卡。`, "success");
    } catch (error) {
      if (error.status && error.status < 500 && ![401, 429].includes(error.status)) pending = null;
      status(error.message + (pending ? "；结果尚未确认，请重试核对，不会重复发放。" : "；请刷新后重新操作。"), "error");
    } finally { busy = false; lock(); }
  });
  $("dashboard-tab-cards").addEventListener("click", () => load());
  $("dashboard-tab-cards").addEventListener("focus", () => { if ($("dashboard-tab-cards").getAttribute("aria-selected") === "true" && !page && !loading) load(); });
  $("cards-refresh").addEventListener("click", () => load(offset));
  $("cards-search").addEventListener("submit", event => { event.preventDefault(); load(); });
  $("cards-prev").addEventListener("click", () => load(Math.max(0, offset - 50)));
  $("cards-next").addEventListener("click", () => load(offset + 50));
  $("cards-player").addEventListener("change", () => { status(""); lock(); });
  $("cards-amount").addEventListener("input", () => { status(""); lock(); });
  $("cards-reason").addEventListener("input", () => status(""));
  for (const button of $("card-management").querySelectorAll("[data-card-amount]")) button.addEventListener("click", () => { $("cards-amount").value = button.dataset.cardAmount; status(""); lock(); });
  $("cards-scope").addEventListener("change", () => { status(""); scope(); });
  window.AvoidanceAdmin = { clear() { sequence++; loading = false; page = null; $("cards-player").replaceChildren(new Option("请先载入玩家", "")); lock(); } };
})();
