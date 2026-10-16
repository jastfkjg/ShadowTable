const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BOARDS } = require('../server/engine');
const { presentRoleGroups, fitBody } = require('../miniprogram/room-sheet-presentation');

test('公开角色配置添加插画，所有板子人数、原始文本和阵营保持一致', () => {
  for (const board of BOARDS.filter(b => b.available)) for (const [capacity, groups] of Object.entries(board.roleConfigurations)) {
    const before = JSON.stringify(groups), rows = presentRoleGroups(groups);
    assert.equal(JSON.stringify(groups), before);
    assert.equal(rows.reduce((sum, row) => sum + row.count, 0), Number(capacity));
    rows.forEach((row, index) => {
      assert.equal(row.faction, groups[index].faction);
      assert.equal(row.roles, groups[index].roles);
      assert.equal(row.entries.map(role => role.name + role.countLabel).join('，'), row.roles);
      assert.ok(row.entries.every(role => role.portrait.startsWith('/assets/roles/')));
    });
  }
  const future = presentRoleGroups([{ faction:'third', count:2, label:'未来阵营', roles:'未来角色×2' }])[0];
  assert.equal(future.label, '未来阵营');
  assert.equal(future.entries[0].name, '未来角色');
  assert.equal(future.entries[0].countLabel, '×2');
  assert.equal(future.entries[0].factionLabel, '盗贼阵营');
});

test('原生滚动区按内容收紧，键盘和变高的底栏占用可用空间，横屏保留顶部空隙', () => {
  const rects = [{width:390,height:844},{height:86},{height:800},{height:100}];
  assert.equal(fitBody(rects), 570);
  assert.equal(fitBody(rects,320), 250);
  assert.equal(fitBody([{...rects[0]},{height:86},{height:220},{height:100}]),220);
  assert.equal(fitBody([{...rects[0]},{height:86},{height:800},{height:150}],320),200);
  assert.equal(fitBody([{width:844,height:390},{height:56},{height:800},{height:80}]),234);
  assert.equal(fitBody([null,...rects.slice(1)]),null);
});
