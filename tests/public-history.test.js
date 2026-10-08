const { test } = require('node:test');
const assert = require('node:assert/strict');
const historyUI = require('../miniprogram/public-history');

const room = { code: '123456', game: 1, phase: 'tools' };
function model() {
  const history = [
    { key: 0, category: 'vote', text: '投票通过', voteGroups: [{ count: 3, label: '赞成', tone: 'approve', seats: '1、10、12 号' }, { count: 0, label: '反对', tone: 'reject', seats: '无' }] },
    { key: 2, category: 'quest', text: '任务成功', cards: [{ label: '成功', count: 3 }] },
    { key: 3, category: 'skill', text: '仙女查验已完成', detail: '' },
  ];
  const state = { ...historyUI.initialData(), history };
  Object.assign(state, historyUI.sync(state, history, room), { room });
  return state;
}

test('初次载入不把已有记录当作未读；新记录只提示，不插入正在浏览的列表', () => {
  const state = model();
  assert.equal(state.historyUnreadCount, 0);
  Object.assign(state, historyUI.open(state));
  Object.assign(state, historyUI.filter(state, 'vote'));
  Object.assign(state, historyUI.toggleRow(state, 0));
  const originalRows = structuredClone(state.visibleHistory);
  state.history.push({ key: 5, category: 'vote', text: '投票未通过' });
  Object.assign(state, historyUI.sync(state, state.history, room));
  assert.equal(state.historyUnreadCount, 1);
  assert.equal(state.historyLatest.key, 5);
  assert.deepEqual(state.visibleHistory, originalRows);
  assert.equal(state.historyFilter, 'vote');
  Object.assign(state, historyUI.open(state));
  assert.equal(state.historyUnreadCount, 0);
  assert.equal(state.visibleHistory[0].key, 5);
  assert.equal(state.visibleHistory[0].isNew, true);
  assert.equal(state.visibleHistory[1].isNew, false);
});

test('打开最近结果清除筛选并展开原始序号，票型显示两位数座位且不改写原记录', () => {
  const state = model(), before = structuredClone(state.history);
  Object.assign(state, historyUI.open(state, 0));
  const vote = state.visibleHistory.find(row => row.key === 0);
  assert.equal(vote.expanded, true);
  assert.deepEqual(vote.voteGroups[0].seatNumbers, [1, 10, 12]);
  assert.deepEqual(vote.voteGroups[1].seatNumbers, []);
  assert.equal(state.visibleHistory.find(row => row.key === 3).hasDetails, false);
  assert.deepEqual(state.history, before);
  Object.assign(state, historyUI.filter(state, 'other'));
  assert.equal(state.visibleHistory.length, 0);
  assert.deepEqual(historyUI.filter(state, 'private'), {});
});

test('新阶段保留阅读状态；同房重开、换房、回到准备阶段清除旧抽屉和未读状态', () => {
  for (const changedRoom of [{ ...room, game: 2 }, { ...room, code: '654321' }, { ...room, phase: 'lobby' }]) {
    const state = model();
    Object.assign(state, historyUI.open(state), { historyFullscreen: true });
    Object.assign(state, historyUI.sync(state, state.history, { ...room, phase: 'teamVote' }));
    assert.equal(state.historyOpen, true);
    assert.equal(state.historyFullscreen, true);
    Object.assign(state, historyUI.sync(state, state.history, changedRoom));
    assert.equal(state.historyOpen, false);
    assert.equal(state.historyFullscreen, false);
    assert.equal(state.historyUnreadCount, 0);
    assert.equal(state.visibleHistory.length, 0);
  }
});
