const { test } = require('node:test');
const assert = require('node:assert/strict');
const swipe = require('../miniprogram/room-swipe');
const host = { code: '123456', isHost: true, available: true, status: 'lobby' };

test('解散快捷操作仅提供给待开局和已结束房间的房主', () => {
  assert.equal(swipe.canDissolve(host), true);
  assert.equal(swipe.canDissolve({ ...host, status: 'ended' }), true);
  for (const room of [{ ...host, status: 'playing' }, { ...host, status: 'unavailable' },
    { ...host, isHost: false }, { ...host, available: false }, { ...host, status: 'unknown' }]) {
    assert.equal(swipe.canDissolve(room), false);
    assert.equal(swipe.width(room), 124);
  }
});

test('左滑展开、右滑收起；短滑和取消收起，纵向和斜向滚动不会展开', () => {
  const gesture = (dx, dy, opened = false) => swipe.move(swipe.start(host, { x: 200, y: 400 }, opened), { x: 200 + dx, y: 400 + dy });
  assert.equal(swipe.settle(gesture(-200, 4)), -124);
  assert.equal(swipe.settle(gesture(-24, 2)), 0);
  assert.equal(swipe.settle(gesture(145, 0, true)), 0);
  assert.equal(swipe.settle(gesture(10, 0, true)), -124);
  assert.equal(swipe.settle(gesture(-100, 2), true), 0);
  for (const [dx, dy] of [[4, 100], [-50, 90], [-80, -100]]) assert.equal(swipe.settle(gesture(dx, dy)), 0);
  const vertical = gesture(2, 30);
  swipe.move(vertical, { x: 0, y: 432 });
  assert.equal(swipe.settle(vertical), 0);
});
