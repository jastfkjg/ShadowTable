// The custom tab bar is outside the page stacking context, so page sheets must hide it.
function tabBarVisibility(page, selected) {
  const data = page.data || {};
  const panel = (selected === 0 ? data.lobby : data.personal) || data;
  return {
    entrySheetVisible: selected === 0 ? !!panel.entrySheet : !!panel.monthlyReset || !!panel.avoidanceWalletOpen,
    roomMenuVisible: selected === 0 && !!(panel.roomMenu || panel.noteRoom),
  };
}

// A custom tab bar belongs to each tab page. Update it before starting any reads.
function selectTab(page, selected) {
  const tabBar = page.getTabBar?.();
  if (!tabBar) return;
  const patch = {};
  if (tabBar.data.selected !== selected) patch.selected = selected;
  for (const [key, value] of Object.entries(tabBarVisibility(page, selected))) {
    if (!!tabBar.data[key] !== value) patch[key] = value;
  }
  if (Object.keys(patch).length) tabBar.setData(patch);
}

// Compatibility entry points still use native routing from independent pages.
function switchHomeTab(selected, options = {}) {
  if (![0, 1].includes(selected)) return;
  const app = typeof getApp === "function" ? getApp() : null;
  const request = { selected };
  if (app) app.homeTabRequest = request;
  wx.switchTab({
    ...options,
    url: selected === 0 ? "/pages/lobby/lobby" : "/pages/me/me",
    fail(error) {
      if (app?.homeTabRequest === request) delete app.homeTabRequest;
      options.fail?.(error);
    },
  });
}

module.exports = { selectTab, switchHomeTab, tabBarVisibility };
