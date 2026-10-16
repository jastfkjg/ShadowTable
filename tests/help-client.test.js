const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const tap = dataset => ({ currentTarget: { dataset } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function help(request) {
  let definition;
  const links = [];
  vm.runInNewContext(fs.readFileSync(require.resolve("../miniprogram/pages/help/help.js"), "utf8"), {
    Page: page => { definition = page; },
    require: name => name === "../../api" ? { request } : { switchHomeTab() {} },
    wx: { navigateTo: ({ url }) => links.push(url) },
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const keys = key.replace(/\[(\d+)\]/g, ".$1").split(".");
      let target = this.data;
      for (const part of keys.slice(0, -1)) target = target[part];
      target[keys.at(-1)] = value;
    }
  } };
  return { page, links };
}
const scoring = { scopeLabel: "当前计分范围", items: [{ id: "test", label: "积分奖励", text: "保留服务端规则" }], notes: ["补充说明"] };
const boards = [{ id: "classic", name: "经典基础", available: true, counts: [6, 9], description: "经典玩法" }];
test("新人引导区分玩家与房主，搜索后可读完整答案、折叠并恢复原来的参考展开状态", async () => {
  const { page } = help(async url => url === "/api/boards" ? { boards } : scoring);
  page.onLoad(); await tick();
  const original = JSON.stringify(page.data.sections);
  assert.equal(page.data.references.length, 5);
  assert.equal(page.data.guideSteps.length, 4);
  page.toggleStep(tap({ index: 2 })); assert.equal(page.data.guideSteps[2].expanded, true);
  page.setGuideMode(tap({ mode: "host" }));
  assert.equal(page.data.guideSteps[0].title, "建桌与邀请");
  assert.equal(page.data.guideSteps.filter(step => step.expanded).length, 1);
  page.toggleReference(tap({ id: "basics", index: 1 }));
  assert.equal(page.data.references.find(r => r.id === "basics").expanded, true);
  page.searchHelp({ detail: { value: "为什么不能发牌" } });
  assert.equal(page.data.references.length, 1);
  assert.equal(page.data.references[0].id, "faq");
  assert.match(page.data.references[0].items[0].text, /只有房主可以发牌/);
  page.toggleReference(tap({ id: "faq", index: 2 })); assert.equal(page.data.references[0].expanded, false);
  page.searchHelp({ detail: { value: "积分奖励" } }); assert.equal(page.data.references[0].id, "scoring");
  page.searchHelp({ detail: { value: "不存在的词" } }); assert.equal(page.data.references.length, 0);
  page.clearSearch();
  assert.equal(page.data.references.length, 5);
  assert.equal(page.data.references.find(r => r.id === "basics").expanded, true);
  page.toggleReference(tap({ id: "basics", index: 1 }));
  assert.equal(JSON.stringify(page.data.sections), original);
});
test("板子搜索保留合法人数入口；板子加载失败不影响静态引导和计分专页", async () => {
  const { page, links } = help(async url => url === "/api/boards" ? { boards } : scoring);
  page.onLoad(); await tick(); page.searchHelp({ detail: { value: "9人" } });
  assert.equal(page.data.references[0].id, "boards");
  page.openBoard(tap({ board: "classic", capacity: 9 }));
  page.openBoard(tap({ board: "classic", capacity: 12 }));
  assert.equal(links.length, 1); assert.match(links[0], /capacity=9/);
  const failed = help(async url => { if (url === "/api/boards") throw Error("offline"); return scoring; }).page;
  failed.onLoad(); await tick(); assert.match(failed.data.boardError, /其他帮助内容仍可阅读/);
  assert.equal(failed.data.guideSteps.length, 4); assert.equal(failed.data.scoringRules, scoring);
  const calls = [], scorePage = help(async url => { calls.push(url); return scoring; }).page;
  scorePage.onLoad({ section: "scoring" }); await tick();
  assert.deepEqual(calls, ["/api/scoring/rules"]); assert.equal(scorePage.data.scoringExpanded, true);
});
test("异步帮助内容在页面卸载后不再写入，也不会覆盖现有静态内容", async () => {
  const pending = [], { page } = help(() => new Promise(resolve => pending.push(resolve)));
  page.onLoad(); const snapshot = JSON.stringify(page.data); page.onUnload();
  pending[0]({ boards }); pending[1](scoring); await tick();
  assert.equal(JSON.stringify(page.data), snapshot);
});
