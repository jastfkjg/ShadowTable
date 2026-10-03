"use strict";

// Keep native selects as the source of truth for forms and existing API handlers.
// The visible control and its popup only change presentation and navigation.
(() => {
  const tabs = ["rooms", "scores", "audit"];
  const panels = ["room-overview", "score-management", "audit-section"];
  const tabButtons = tabs.map((tab) => document.getElementById("dashboard-tab-" + tab));
  function activateTab(index, focus = false) {
    tabButtons.forEach((button, i) => {
      button.setAttribute("aria-selected", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      document.getElementById(panels[i]).hidden = i !== index;
    });
    closePicker();
    document.querySelectorAll(".room-more[open]").forEach((menu) => { menu.open = false; });
    if (focus) tabButtons[index].focus();
  }
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => activateTab(index));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? 2 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(next, true);
    });
  });

  const popup = document.createElement("div");
  popup.id = "select-options";
  popup.className = "select-options";
  popup.setAttribute("role", "listbox");
  popup.setAttribute("popover", "manual");
  popup.hidden = true;
  document.body.append(popup);
  let current = null, activeIndex = -1, typeAhead = "", typedAt = 0;
  const controls = new Map();

  function closePicker() {
    if (!current) return;
    current.trigger.setAttribute("aria-expanded", "false");
    current.trigger.removeAttribute("aria-activedescendant");
    if (popup.hidePopover && popup.matches(":popover-open")) popup.hidePopover();
    popup.hidden = true;
    current = null;
    typeAhead = "";
  }
  function sync(control) {
    const { select, trigger, value } = control;
    value.textContent = select.selectedOptions[0]?.textContent || "请选择";
    trigger.disabled = select.disabled;
    trigger.setAttribute("aria-required", String(select.required));
    trigger.classList.toggle("is-placeholder", !select.value);
    if (current === control) closePicker();
  }
  function highlight(index) {
    if (!current) return;
    const rows = [...popup.children];
    if (!rows[index] || rows[index].getAttribute("aria-disabled") === "true") return;
    activeIndex = index;
    rows.forEach((row, i) => row.classList.toggle("is-active", i === index));
    current.trigger.setAttribute("aria-activedescendant", rows[index].id);
    const row = rows[index];
    if (row.offsetTop < popup.scrollTop) popup.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > popup.scrollTop + popup.clientHeight)
      popup.scrollTop = row.offsetTop + row.offsetHeight - popup.clientHeight;
  }
  function choose(index) {
    if (!current) return;
    const control = current, option = control.select.options[index];
    if (!option || option.disabled || control.select.disabled) return;
    const changed = control.select.selectedIndex !== index;
    control.select.selectedIndex = index;
    closePicker();
    sync(control);
    control.trigger.focus();
    if (changed) {
      control.select.dispatchEvent(new Event("input", { bubbles: true }));
      control.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function openPicker(control, edge) {
    if (control.select.disabled) return;
    closePicker();
    current = control;
    activeIndex = -1;
    popup.replaceChildren();
    popup.setAttribute("aria-label", control.label.textContent);
    [...control.select.options].forEach((option, index) => {
      const row = document.createElement("div");
      row.id = "select-option-" + index;
      row.className = "select-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option.selected));
      row.setAttribute("aria-disabled", String(option.disabled));
      const copy = document.createElement("span"), title = document.createElement("span");
      title.className = "select-option-title";
      title.textContent = option.textContent;
      copy.append(title);
      if (option.dataset.hint) {
        const hint = document.createElement("span");
        hint.className = "select-option-hint";
        hint.textContent = option.dataset.hint;
        copy.append(hint);
      }
      const check = document.createElement("span");
      check.className = "select-option-check";
      check.setAttribute("aria-hidden", "true");
      row.append(copy, check);
      row.addEventListener("pointermove", () => highlight(index));
      row.addEventListener("click", () => choose(index));
      popup.append(row);
    });
    // Top-layer popovers avoid clipping inside cards or expanded details.
    popup.hidden = false;
    if (popup.showPopover) popup.showPopover();
    positionPicker();
    control.trigger.setAttribute("aria-expanded", "true");
    const available = [...control.select.options].map((option, i) => option.disabled ? -1 : i).filter((i) => i >= 0);
    const index = edge === "last" ? available.at(-1) : edge === "first" ? available[0] : control.select.selectedIndex;
    highlight(available.includes(index) ? index : available[0]);
  }
  function positionPicker() {
    if (!current) return;
    const rect = current.trigger.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return closePicker();
    const gutter = 12, gap = 8;
    const below = window.innerHeight - rect.bottom - gutter - gap;
    const above = rect.top - gutter - gap;
    const up = below < Math.min(240, popup.children.length * 52 + 12) && above > below;
    popup.style.width = Math.min(rect.width, window.innerWidth - gutter * 2) + "px";
    popup.style.left = Math.max(gutter, Math.min(rect.left, window.innerWidth - rect.width - gutter)) + "px";
    popup.style.maxHeight = Math.max(44, Math.min(320, up ? above : below)) + "px";
    popup.style.top = (up ? rect.top - gap - popup.getBoundingClientRect().height : rect.bottom + gap) + "px";
  }
  document.querySelectorAll("select").forEach((select) => {
    const label = document.querySelector('label[for="' + select.id + '"]');
    if (!label) return;
    const wrapper = document.createElement("div");
    wrapper.className = "select-control";
    const trigger = document.createElement("button"), value = document.createElement("span");
    trigger.type = "button";
    trigger.id = select.id + "-trigger";
    trigger.className = "select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", popup.id);
    label.id ||= select.id + "-label";
    value.id = select.id + "-value";
    trigger.setAttribute("aria-labelledby", label.id + " " + value.id);
    if (select.hasAttribute("aria-describedby")) trigger.setAttribute("aria-describedby", select.getAttribute("aria-describedby"));
    label.htmlFor = trigger.id;
    trigger.append(value);
    select.before(wrapper);
    wrapper.append(select, trigger);
    select.classList.add("select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const control = { select, trigger, value, label };
    controls.set(select, control);
    sync(control);
    trigger.addEventListener("click", () => current === control ? closePicker() : openPicker(control));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Tab") { closePicker(); return; }
      if (event.key === "Escape" && current === control) { event.preventDefault(); closePicker(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (current !== control) return openPicker(control, event.key === "Home" ? "first" : event.key === "End" ? "last" : undefined);
        const available = [...select.options].map((option, i) => option.disabled ? -1 : i).filter((i) => i >= 0);
        const position = available.indexOf(activeIndex);
        const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 :
          Math.max(0, Math.min(available.length - 1, position + (event.key === "ArrowDown" ? 1 : -1)));
        highlight(available[next]);
      } else if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (current === control) choose(activeIndex);
        else openPicker(control);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (current !== control) openPicker(control);
        const now = Date.now();
        typeAhead = now - typedAt > 700 ? event.key : typeAhead + event.key;
        typedAt = now;
        const match = [...select.options].findIndex((option) => !option.disabled && option.textContent.trim().toLocaleLowerCase().startsWith(typeAhead.toLocaleLowerCase()));
        if (match >= 0) highlight(match);
      }
    });
    select.addEventListener("change", () => sync(control));
    select.addEventListener("invalid", (event) => {
      event.preventDefault();
      trigger.focus();
      openPicker(control);
    });
    new MutationObserver(() => sync(control)).observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  popup.addEventListener("pointerdown", (event) => event.preventDefault());
  document.addEventListener("pointerdown", (event) => {
    if (current && !popup.contains(event.target) && !current.trigger.contains(event.target)) closePicker();
  });
  document.addEventListener("focusin", (event) => {
    if (current && event.target !== current.trigger) closePicker();
  });
  window.addEventListener("resize", closePicker);
  document.addEventListener("scroll", (event) => {
    if (current && !popup.contains(event.target)) positionPicker();
  }, true);
  document.addEventListener("reset", () => queueMicrotask(() => controls.forEach(sync)));

  const confirmation = document.getElementById("score-confirm-dialog");
  window.AdminUI = {
    confirm({ title, description, danger = false }) {
      if (confirmation.open) return Promise.resolve(false);
      document.getElementById("score-confirm-title").textContent = title;
      document.getElementById("score-confirm-description").textContent = description;
      const accept = document.getElementById("score-confirm-accept");
      accept.className = danger ? "danger" : "primary";
      accept.textContent = danger ? "确认更正结果" : "确认保存";
      confirmation.returnValue = "cancel";
      closePicker();
      return new Promise((resolve) => {
        confirmation.addEventListener("close", () => resolve(confirmation.returnValue === "confirm"), { once: true });
        confirmation.showModal();
      });
    },
  };
})();
