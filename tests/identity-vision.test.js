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
