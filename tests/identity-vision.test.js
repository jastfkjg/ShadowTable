const { test } = require('node:test');
const assert = require('node:assert/strict');
const { present } = require('../miniprogram/identity-vision');

test('初始视野突出服务端明确披露的座位与角色，不修改原文', () => {
  const text = '初始见面匪：3号（莫德雷德）、7号（刺客）。';
  const vision = present(text);
  assert.equal(vision.text, text);
  assert.equal(vision.label, '初始见面匪');
  assert.deepEqual(vision.players, [{ seat: 3, role: '莫德雷德' }, { seat: 7, role: '刺客' }]);
  const withAbility = present('初始见面匪：3号（莫德雷德）、7号（莫甘娜）。 可刀刀客或B角色一次。');
  assert.deepEqual(withAbility.players, [{ seat: 3, role: '莫德雷德' }, { seat: 7, role: '莫甘娜' }]);
  assert.equal(withAbility.note, '可刀刀客或B角色一次。');
});
test('匿名视野只突出座位，保留无法区分身份及不可见角色的限制', () => {
  for (const text of [
    '梅林与莫甘娜位于：3、7号。你无法区分谁是梅林。',
    '你看见的举手座位：3、7（莫德雷德不在视野中）',
    '你的坏人同伴：3、7号（不区分身份）。',
  ]) {
    const vision = present(text);
    assert.deepEqual(vision.players, [{ seat: 3, role: '' }, { seat: 7, role: '' }]);
    assert.equal(vision.text, text);
    assert.match(vision.note, /无法区分|不在视野|不区分/);
  }
});
test('无视野、无同伴、未来格式和混合说明保留全文，不尝试推断座位身份', () => {
  for (const text of ['没有视野。', '初始见面匪：无可见同伴。', '未来角色：3号拥有特殊状态。', '未知格式：3号（刺客）。另外还有特殊说明。']) {
    assert.deepEqual(present(text), { label: '', players: [], note: '', text });
  }
});
test('视野仅补充可见座位的公开头像昵称，不从玩家对象推断角色或泄露其他座位', () => {
  const profiles = [{ seat: 3, name: '林间', avatarUrl: '/api/avatars/fox', role: '莫德雷德', secret: '不能复制' },
    { seat: 7, name: '阿木', avatarUrl: '', role: '刺客' }, { seat: 9, name: '不在视野中' }];
  const before = JSON.stringify(profiles);
  const anonymous = present('你看见的举手座位：3、7（莫德雷德不在视野中）', profiles);
  assert.deepEqual(anonymous.players, [
    { seat: 3, role: '', name: '林间', avatarInitial: '林', avatarUrl: '/api/avatars/fox', avatarFailed: false },
    { seat: 7, role: '', name: '阿木', avatarInitial: '阿', avatarUrl: '', avatarFailed: false },
  ]);
  assert.doesNotMatch(JSON.stringify(anonymous), /不能复制|刺客/);
  assert.ok(!anonymous.players.some(player => player.seat === 9));
  const named = present('初始见面匪：3号（莫德雷德）、7号（刺客）。', profiles);
  assert.deepEqual(named.players.map(p => p.role), ['莫德雷德', '刺客']);
  assert.equal(JSON.stringify(profiles), before);
});
test('缺失玩家资料和失败头像保留座位及首字回退，未知说明不附加玩家信息', () => {
  const profiles = [{ seat: 3, name: '🌙月亮', avatarUrl: '/api/avatars/broken', avatarFailed: true },
    { seat: 7, name: '空位', occupied: false }];
  const result = present('你看见的举手座位：3、7', profiles);
  assert.equal(result.players[0].avatarInitial, '🌙');
  assert.equal(result.players[0].avatarFailed, true);
  assert.deepEqual(result.players[1], { seat: 7, role: '', name: '玩家', avatarInitial: '友', avatarUrl: '', avatarFailed: false });
  assert.deepEqual(present('未来格式：3号拥有特殊状态。', profiles).players, []);
});
