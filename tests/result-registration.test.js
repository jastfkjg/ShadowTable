const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRoom, enter, command, publicView } = require('../server/engine');
function deal(knights = true, scoring = true) {
  const room = newRoom('123456', 'wx:1', '房主', knights ? 'knights' : 'classic', knights ? 12 : 6);
  for (let i = 2; i <= room.capacity; i++) enter(room, `wx:${i}`, `玩家${i}`);
  room.players.forEach(player => player.ready = true);
  command(room, room.host, { type: 'start', stage: room.stage, flexible: true });
  room.scoreEnabled = scoring;
  room.players.forEach(player => room.roles[player.uid] = 'servant');
  room.roles['wx:1'] = 'merlin';
  room.roles['wx:2'] = 'percival';
  room.roles['wx:6'] = 'assassin';
  room.fun.initialRoles = { ...room.roles };
  return room;
}
function finish(room, extra = {}) {
  command(room, room.host, { type: 'finishTools', stage: room.stage, ...(room.scoreEnabled
    ? { scoreReason: 'assassination', scoreTarget: 1 }
    : { funReason: 'assassination', funTarget: 1 }), ...extra });
}
test('登记原因只保留三绿和三炸，当前刺客自动带刀且不被旧客户端覆盖', () => {
  for (const knights of [false, true]) for (const scoring of [false, true]) {
    const room = deal(knights, scoring);
    const view = publicView(room, room.host);
    assert.deepEqual(view.funSettlement.map(option => option.id), ['assassination', 'quest_fail']);
    if (scoring) assert.deepEqual(view.scoreSettlement.map(option => option.id), ['assassination', 'quest_fail']);
    assert.equal(view.settlementRequiresActor, false);
    assert.equal(publicView(room, 'wx:2').settlementRequiresActor, null);
    assert.throws(() => finish(room, { funActor: 3 }), /场上有刺客/);
    finish(room);
    assert.equal(room.fun.terminal.actor.uid, 'wx:6');
    assert.equal(room.fun.terminal.reason, 'assassination');
  }
});
test('刺客出局或当前板上没有刺客时允许登记其他在场带刀人', () => {
  for (const scenario of ['dead', 'changed', 'absent']) {
    const room = deal(scenario !== 'absent', false);
    if (scenario === 'dead') room.knights.players['wx:6'].alive = false;
    else room.roles['wx:6'] = 'servant';
    assert.equal(publicView(room, room.host).settlementRequiresActor, true);
    finish(room, { funActor: 3 });
    assert.equal(room.fun.terminal.actor.uid, 'wx:3');
  }
});
test('作废未完成技能后按恢复的刺客身份自动归档', () => {
  const room = deal();
  command(room, room.host, { type: 'beginActivity', stage: room.stage, kind: 'skills' });
  assert.ok(room.knights.snapshot);
  room.roles['wx:6'] = 'servant';
  room.knights.players['wx:6'].alive = false;
  assert.equal(publicView(room, room.host).settlementRequiresActor, false);
  finish(room, { replace: true });
  assert.equal(room.fun.terminal.actor.uid, 'wx:6');
});
