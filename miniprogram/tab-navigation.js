// A custom tab bar belongs to each tab page. Update it before starting any reads.
function selectTab(page, selected) {
  const tabBar = page.getTabBar?.();
  if (tabBar && tabBar.data.selected !== selected) tabBar.setData({ selected });
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
