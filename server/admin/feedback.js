"use strict";

(() => {
  const filters = $("feedback-filters");
  const list = $("feedback-items");
  const status = $("inbox-status");
  const more = $("feedback-more");
  const drafts = new Map();
  let filter = "pending", next = null, revision = 0, loading = false;
  const timestamp = value => new Date(value).toLocaleString("zh-CN", { hour12: false });

  function record(item) {
    const card = document.createElement("details");
    card.className = "feedback-ticket";
    const summary = document.createElement("summary");
    const meta = el("span", "", "ticket-meta");
    function updateMeta() {
      meta.replaceChildren();
      if (item.reply) meta.append(el("span", "已回复", "ticket-done"));
      if (item.acceptedAt != null) meta.append(el("span", "已采纳", "ticket-done"));
      else if (!item.reply) meta.append(el("span", "待回复", "ticket-pending"));
      meta.append(el("span", [item.category, item.area].filter(Boolean).join(" · ")));
    }
    updateMeta();
    summary.append(meta, el("strong", item.content, "ticket-excerpt"),
      el("span", (item.nickname || "玩家") + " · " + timestamp(item.created), "ticket-byline"));
    card.append(summary);
    const body = el("div", "", "ticket-body");
    body.append(el("p", item.content, "ticket-text"));
    if (item.photos) {
      const photos = el("div", "", "ticket-photos");
      for (let i = 0; i < item.photos; i++) {
        const link = document.createElement("a");
        link.href = "/api/admin/feedback/" + item.id + "/images/" + i;
        link.target = "_blank"; link.rel = "noopener";
        const image = document.createElement("img");
        image.alt = "查看截图 " + (i + 1) + " 大图";
        image.loading = "lazy";
        card.addEventListener("toggle", () => { if (card.open && !image.hasAttribute("src")) image.src = link.href; });
        link.append(image); photos.append(link);
      }
      body.append(photos);
    }
    const decision = el("div", "", "ticket-decision");
    const acceptedText = time => "已采纳 · " + timestamp(time);
    const decisionStatus = el("span", item.acceptedAt == null ? "尚未采纳" : acceptedText(item.acceptedAt));
    decisionStatus.setAttribute("role", "status");
    decision.append(decisionStatus);
    if (item.acceptedAt == null) {
      const accept = el("button", "采纳反馈");
      accept.type = "button";
      decision.append(accept);
      accept.addEventListener("click", async () => {
        if (accept.disabled) return;
        accept.disabled = true;
        accept.textContent = "正在采纳";
        try {
          const result = await api("feedback/" + item.id + "/accept", {});
          if (!list.contains(card)) return;
          item.acceptedAt = result.acceptedAt;
          updateMeta();
          decisionStatus.textContent = acceptedText(result.acceptedAt)
            + (result.awarded ? " · 已发放「共建者」徽章" : " · 玩家已拥有「共建者」徽章");
          accept.remove();
          if (filter === "pending") {
            card.remove();
            status.textContent = decisionStatus.textContent + "。" + (list.childElementCount || next ? "" : "当前没有待回复的反馈。");
          }
        } catch (error) {
          decisionStatus.textContent = error.message;
          accept.disabled = false;
          accept.textContent = "重试采纳";
        }
      });
    }
    body.append(decision);
    const renderReply = (text, date) => {
      const result = el("div", "", "ticket-reply");
      result.append(el("strong", "开发者回复"), el("p", text, "ticket-text"), el("small", timestamp(date)));
      body.append(result);
    };
    if (item.reply) renderReply(item.reply, item.repliedAt);
    else {
      const form = document.createElement("form");
      const label = el("label", "回复玩家");
      const input = document.createElement("textarea");
      input.id = "feedback-reply-" + item.id;
      label.htmlFor = input.id; input.maxLength = 1000; input.rows = 3;
      input.placeholder = "写下处理结果，或说明下一步安排";
      input.value = drafts.get(item.id) || "";
      const actions = el("div", "", "ticket-actions");
      const message = el("span", "");
      message.setAttribute("role", "status");
      const send = el("button", "发送回复", "primary");
      send.type = "submit"; send.disabled = !input.value.trim();
      input.addEventListener("input", () => {
        drafts.set(item.id, input.value); send.disabled = !input.value.trim(); message.textContent = "";
      });
      actions.append(message, send);
      form.append(label, input, actions); body.append(form);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (send.disabled || !input.value.trim()) return;
        const reply = input.value.trim();
        send.disabled = true; input.disabled = true; send.textContent = "正在发送";
        try {
          await api("feedback/" + item.id + "/reply", { reply });
          drafts.delete(item.id);
          if (!list.contains(card)) return;
          form.remove();
          renderReply(reply, Date.now());
          item.reply = reply;
          updateMeta();
          if (filter === "pending") card.remove();
          status.textContent = list.childElementCount || next ? "回复已发送。" : "回复已发送，当前没有待回复的反馈。";
        } catch (e) {
          message.textContent = e.message;
          send.disabled = false; input.disabled = false; send.textContent = "重试发送";
        }
      });
    }
    card.append(body);
    return card;
  }

  function syncFilters() {
    for (const button of filters.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  }
  async function load(append = false) {
    if (append && (loading || !next)) return;
    const version = ++revision;
    if (!append) { list.replaceChildren(); next = null; }
    loading = true; more.hidden = true; status.textContent = "正在读取反馈…";
    try {
      const page = await api("feedback?status=" + filter + (append ? "&before=" + next : ""));
      if (version !== revision) return;
      for (const item of page.items) list.append(record(item));
      next = page.next;
      status.textContent = list.childElementCount ? "" : ({ pending: "当前没有待回复的反馈。", replied: "还没有已回复的反馈。", accepted: "还没有已采纳的反馈。", all: "还没有玩家提交反馈。" })[filter];
    } catch (e) {
      if (revision === version) status.textContent = e.message + "，可点击「" + (append ? "加载更多" : "刷新列表") + "」重试。";
    } finally {
      if (revision === version) { loading = false; more.hidden = !next; }
    }
  }
  for (const button of filters.querySelectorAll("button")) button.addEventListener("click", () => {
    if (button.dataset.filter === filter) return;
    filter = button.dataset.filter; syncFilters(); load();
  });
  more.addEventListener("click", () => load(true));
  window.FeedbackInbox = {
    load, clear() {
      revision++; loading = false; next = null; filter = "pending"; syncFilters();
      list.replaceChildren(); status.textContent = ""; more.hidden = true; drafts.clear();
    },
  };
})();
