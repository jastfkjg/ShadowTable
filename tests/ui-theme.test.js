const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../miniprogram");
const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));

function definition(entry, wx, pages = []) {
  let result;
  const capture = value => { result = value; };
  function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
      module, require: name => load(path.resolve(path.dirname(file), name + ".js")),
      App: capture, Component: capture, wx, getCurrentPages: () => pages,
    }, { filename: file });
    return module.exports;
  }
  load(path.join(root, entry));
  return result;
}

test("深色窗口由静态配置提供，导航挂载和页面显示不再写入原生背景", () => {
  const nav = definition("components/app-nav/app-nav.js", {
    getWindowInfo: () => ({ statusBarHeight: 47 }),
    setBackgroundColor() { throw new Error('切换期间不应重绘原生背景'); },
  });
  for (const key of ["backgroundColor", "backgroundColorTop", "backgroundColorBottom"]) {
    assert.equal(config.window[key], '#101c24');
  }
  assert.match(fs.readFileSync(path.join(root, 'app.wxss'), 'utf8'), /page\s*\{[^}]*background:\s*#101c24;/);
  nav.lifetimes?.attached?.();
  nav.pageLifetimes?.show?.();
  nav.pageLifetimes?.show?.();
});

test("后台仍遮盖身份，不再通过原生底栏外观 API 重绘；缺少外观 API 可正常执行", () => {
  let masked = 0;
  const pages = [{ mask() { masked++; } }, {}];
  const app = definition("app.js", { setTabBarStyle() { throw new Error('不应重绘原生底栏'); } }, pages);
  app.onShow?.(); app.onHide(); app.onShow?.();
  assert.equal(masked, 1);
  const legacyNav = definition("components/app-nav/app-nav.js", { getSystemInfoSync: () => ({}) });
  assert.doesNotThrow(() => legacyNav.lifetimes?.attached?.());
  assert.doesNotThrow(() => legacyNav.pageLifetimes?.show?.());
});

function tabBar(pages, wx = {}) {
  const spec = definition("custom-tab-bar/index.js", wx, pages);
  const instance = { ...spec.methods, data: structuredClone(spec.data),
    setData(patch) { Object.assign(this.data, patch); } };
  return { spec, instance };
}

test("底栏延迟挂载和返回时按当前路由选中，每页实例互不污染", () => {
  const pages = [{ route: 'pages/me/me' }];
  const { spec, instance: me } = tabBar(pages);
  spec.lifetimes.attached.call(me);
  assert.equal(me.data.selected, 1);
  assert.deepEqual(Array.from(me.data.list, item => item.pagePath.slice(1)), config.tabBar.list.map(item => item.pagePath));
  pages[0] = { route: 'pages/lobby/lobby' };
  const { instance: lobby } = tabBar(pages);
  spec.lifetimes.attached.call(lobby);
  assert.equal(lobby.data.selected, 0);
  assert.equal(me.data.selected, 1);
  pages[0] = { route: 'pages/me/me' };
  spec.pageLifetimes.show.call(me);
  assert.equal(me.data.selected, 1);
});

test("快速重复点击只发起一次切换，失败保留选中态并允许重试", () => {
  const requests = [];
  const { spec, instance } = tabBar([{ route: 'pages/lobby/lobby' }], {
    switchTab: options => requests.push(options),
  });
  const tap = index => instance.switchTab({ currentTarget: { dataset: { index } } });
  tap(0); tap(99); tap(1); tap(1); tap(0);
  assert.equal(requests.length, 1);
  assert.equal(instance.data.selected, 0);
  assert.equal(requests[0].url, '/pages/me/me');
  requests[0].complete({ errMsg: 'switchTab:fail' });
  tap(1);
  assert.equal(requests.length, 2);
  spec.pageLifetimes.show.call(instance);
  assert.equal(instance.switching, false);
});

test("底栏在同一首页切换内容，选中态跟随内容而非入口路由，不调用原生页面切换", () => {
  const selections = [];
  const home = { route: 'pages/lobby/lobby', data: { activeTab: 0 }, switchMainTab(index) {
    selections.push(index); this.data.activeTab = index;
  } };
  const { spec, instance } = tabBar([home], { switchTab() { throw Error('底栏不应切换窗口'); } });
  spec.lifetimes.attached.call(instance);
  instance.switchTab({ currentTarget: { dataset: { index: 1 } } });
  instance.syncSelection();
  assert.equal(home.route, 'pages/lobby/lobby');
  assert.equal(instance.data.selected, 1);
  instance.switchTab({ currentTarget: { dataset: { index: 1 } } });
  instance.switchTab({ currentTarget: { dataset: { index: 0 } } });
  instance.syncSelection();
  assert.equal(instance.data.selected, 0);
  assert.deepEqual(selections, [1, 0]);
});

test("键盘弹出时收起底栏，关闭后恢复，卸载移除自己的键盘监听", () => {
  let listener, removed;
  const { spec, instance } = tabBar([{ route: 'pages/lobby/lobby' }], {
    onKeyboardHeightChange: callback => { listener = callback; },
    offKeyboardHeightChange: callback => { removed = callback; },
  });
  spec.lifetimes.attached.call(instance);
  listener({ height: 300 });
  assert.equal(instance.data.keyboardVisible, true);
  listener({ height: 0 });
  assert.equal(instance.data.keyboardVisible, false);
  spec.lifetimes.detached.call(instance);
  assert.equal(removed, listener);
});

test('表单打开时底栏独立于键盘保持隐藏，延迟挂载和重新显示均恢复表单状态', () => {
  let keyboard;
  const selections = [];
  const home = { route: 'pages/lobby/lobby', data: { activeTab: 0, lobby: { entrySheet: true } }, switchMainTab: index => selections.push(index) };
  const { spec, instance } = tabBar([home], { onKeyboardHeightChange: fn => { keyboard = fn; } });
  spec.lifetimes.attached.call(instance);
  assert.equal(instance.data.entrySheetVisible, true);
  assert.equal(instance.data.keyboardVisible, false);
  keyboard({ height: 280 });
  keyboard({ height: 0 });
  assert.equal(instance.data.entrySheetVisible, true);
  instance.switchTab({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(selections.length, 0);
  home.data.lobby.entrySheet = false;
  spec.pageLifetimes.show.call(instance);
  assert.equal(instance.data.entrySheetVisible, false);
  instance.switchTab({ currentTarget: { dataset: { index: 1 } } });
  assert.deepEqual(selections, [1]);
  home.data.lobby.entrySheet = true;
  home.data.activeTab = 1;
  spec.pageLifetimes.show.call(instance);
  assert.equal(instance.data.entrySheetVisible, false);
});
