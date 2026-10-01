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

test("所有页面的导航初次挂载及再次显示时恢复 iOS 上下窗口底色", () => {
  const calls = [];
  const nav = definition("components/app-nav/app-nav.js", {
    getWindowInfo: () => ({ statusBarHeight: 47 }),
    setBackgroundColor: options => calls.push(options),
  });
  nav.lifetimes.attached();
  nav.pageLifetimes.show();
  nav.pageLifetimes.show();
  assert.equal(calls.length, 3);
  for (const options of calls) {
    for (const key of ["backgroundColor", "backgroundColorTop", "backgroundColorBottom"]) {
      assert.equal(options[key], config.window[key]);
    }
  }
});

test("后台仍遮盖身份，不再通过原生底栏外观 API 重绘；缺少外观 API 可正常执行", () => {
  let masked = 0;
  const pages = [{ mask() { masked++; } }, {}];
  const app = definition("app.js", { setTabBarStyle() { throw new Error('不应重绘原生底栏'); } }, pages);
  app.onShow?.(); app.onHide(); app.onShow?.();
  assert.equal(masked, 1);
  const legacyNav = definition("components/app-nav/app-nav.js", { getSystemInfoSync: () => ({}) });
  assert.doesNotThrow(() => legacyNav.lifetimes.attached());
  assert.doesNotThrow(() => legacyNav.pageLifetimes.show());
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
