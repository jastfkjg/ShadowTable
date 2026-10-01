// A custom tab bar belongs to each tab page. Update it before starting any reads.
function selectTab(page, selected) {
  const tabBar = page.getTabBar?.();
  if (tabBar && tabBar.data.selected !== selected) tabBar.setData({ selected });
}

module.exports = { selectTab };
