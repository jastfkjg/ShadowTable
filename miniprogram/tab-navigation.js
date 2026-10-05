// A custom tab bar belongs to each tab page. Update it before starting any reads.
function selectTab(page, selected) {
  const tabBar = page.getTabBar?.();
  if (!tabBar) return;
  const entrySheetVisible = selected === 0 && !!(page.data?.lobby?.entrySheet || page.data?.entrySheet);
  const patch = {};
  if (tabBar.data.selected !== selected) patch.selected = selected;
  if (!!tabBar.data.entrySheetVisible !== entrySheetVisible) patch.entrySheetVisible = entrySheetVisible;
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

module.exports = { selectTab, switchHomeTab };
