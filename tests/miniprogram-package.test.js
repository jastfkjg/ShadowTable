const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../miniprogram");
const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const packages = config.subPackages || [];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

test("主包及各分包源码低于 2MiB，保留编译前包体积检查", t => {
  const sizes = new Map([["main", 0], ...packages.map(pkg => [pkg.root, 0])]);
  for (const file of files(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const owner = packages.find(pkg => relative.startsWith(pkg.root + "/"))?.root || "main";
    sizes.set(owner, sizes.get(owner) + fs.statSync(file).size);
  }
  for (const [name, bytes] of sizes) {
    t.diagnostic(`${name}: ${(bytes / 1024).toFixed(1)} KiB（源码；上传以微信编译结果为准）`);
    assert.ok(bytes < 2 * 1024 * 1024, `${name} 源码超过 2MiB，请压缩资源或调整分包`);
  }
});

test("资料编辑原路由仅注册在普通分包，头像随该分包加载，一级导航留在主包", () => {
  const route = "pages/profile/profile";
  const registrations = packages.flatMap(pkg => pkg.pages.map(page => ({ route: pkg.root + "/" + page, pkg })));
  assert.ok(!config.pages.includes(route));
  const matches = registrations.filter(entry => entry.route === route);
  assert.equal(matches.length, 1);
  assert.ok(!matches[0].pkg.independent, "资料页需要主包共享模块与导航组件");
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    assert.ok(fs.statSync(path.join(root, route + "." + extension)).isFile());
  }
  for (const avatar of require("../miniprogram/builtin-avatars")) {
    assert.ok(avatar.path.startsWith("/" + matches[0].pkg.root + "/"), avatar.id + " 未放入资料分包");
    assert.ok(fs.statSync(path.join(root, avatar.path)).size > 0);
  }
  assert.ok(!fs.existsSync(path.join(root, "assets/avatars")), "旧目录不能重复计入主包");
  for (const tab of config.tabBar.list) assert.ok(config.pages.includes(tab.pagePath));
});
