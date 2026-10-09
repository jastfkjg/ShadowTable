const { test } = require('node:test');
const assert = require('node:assert/strict');
const historyUI = require('../miniprogram/public-history');

const room = { code: '123456', game: 1, phase: 'tools' };
function model() {
  const history = [
    { key: 0, category: 'vote', text: '投票通过', voteGroups: [{ count: 3, label: '赞成', tone: 'approve', seats: '1、10、12 号' }, { count: 0, label: '反对', tone: 'reject', seats: '无' }] },
    { key: 2, category: 'quest', text: '任务成功', cards: [{ label: '成功', count: 3 }] },
    { key: 3, category: 'other', text: '仙女查验已完成', detail: '' },
  ];
  const state = { ...historyUI.initialData(), history };
  Object.assign(state, historyUI.sync(state, history, room), { room });
  return state;
}

test('普通打开默认收起，任务牌数和队伍可展开；定位打开只展开目标记录', () => {
  const state = model();
  state.history[0].teamLabel = '1、10、12 号';
  Object.assign(state, historyUI.open(state));
  assert.ok(state.visibleHistory.every(row => !row.expanded));
  assert.equal(state.visibleHistory.find(row => row.key === 2).hasDetails, true);
  Object.assign(state, historyUI.toggleRow(state, 2));
  assert.equal(state.visibleHistory.find(row => row.key === 2).expanded, true);
  Object.assign(state, historyUI.open(state, 0));
  assert.deepEqual(state.visibleHistory.filter(row => row.expanded).map(row => row.key), [0]);
});

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
  assert.equal(state.visibleHistory[0].recordNumber, 4);
  assert.equal(state.visibleHistory[0].isNew, true);
  assert.equal(state.visibleHistory[0].isLatest, true);
  assert.equal(state.visibleHistory[1].isNew, false);
  assert.equal(state.visibleHistory[1].isLatest, false);
});

test('打开最近结果清除筛选并展开原始序号，票型显示两位数座位且不改写原记录', () => {
  const state = model(), before = structuredClone(state.history);
  Object.assign(state, historyUI.open(state, 0));
  assert.deepEqual(state.visibleHistory.map(row => row.recordNumber), [3, 2, 1]);
  const vote = state.visibleHistory.find(row => row.key === 0);
  assert.equal(vote.expanded, true);
  assert.deepEqual(vote.voteGroups[0].seatNumbers, [1, 10, 12]);
  assert.deepEqual(vote.voteGroups[1].seatNumbers, []);
  assert.equal(state.visibleHistory.find(row => row.key === 3).hasDetails, false);
  assert.deepEqual(state.history, before);
  Object.assign(state, historyUI.filter(state, 'quest'));
  assert.equal(state.visibleHistory[0].recordNumber, 2);
  assert.equal(state.visibleHistory[0].key, 2);
  Object.assign(state, historyUI.filter(state, 'other'));
  assert.deepEqual(state.visibleHistory.map(row => row.key), [3]);
  assert.deepEqual(historyUI.filter(state, 'private'), {});
});

test('新阶段保留阅读状态；同房重开、换房、回到准备阶段清除旧抽屉和未读状态', () => {
  for (const changedRoom of [{ ...room, game: 2 }, { ...room, code: '654321' }, { ...room, phase: 'lobby' }]) {
    const state = model();
    Object.assign(state, historyUI.open(state));
    Object.assign(state, historyUI.sync(state, state.history, { ...room, phase: 'teamVote' }));
    assert.equal(state.historyOpen, true);
    Object.assign(state, historyUI.sync(state, state.history, changedRoom));
    assert.equal(state.historyOpen, false);
    assert.equal(state.historyUnreadCount, 0);
    assert.equal(state.visibleHistory.length, 0);
  }
});

test('记录图标和技能座位只派生公开内容，保留复活过程、空值和原始文本', () => {
  const state = model();
  state.history = [
    { key: 0, category: 'other', text: '仙女查验已完成' },
    { key: 1, category: 'other', text: '本轮阵营转换' },
    { key: 2, category: 'skill', text: '技能最终结果', historyText: '技能结算', historyNote: '提前截止', resultRows: [
      { label: '最终仍出局', value: '12 号', final: true },
      { label: '本轮出局', value: '3、7、12 号' },
      { label: '抽牌复活', value: '3、7 号' },
      { label: '原牌复活', value: '无' },
      { label: '说明', value: '第3轮结果待确认' },
    ] },
  ];
  const before = structuredClone(state.history);
  Object.assign(state, historyUI.open(state, 2));
  const [skill, conversion, fairy] = state.visibleHistory;
  assert.equal(skill.eventIcon, 'skill');
  assert.equal(conversion.eventIcon, 'conversion');
  assert.equal(fairy.eventIcon, 'inspect');
  assert.deepEqual(skill.resultRows.map(row => row.seatNumbers), [[12], [3, 7, 12], [3, 7], [], []]);
  assert.deepEqual(skill.resultRows.map(row => row.tone), ['failure', 'failure', 'success', 'success', '']);
  assert.equal(skill.resultRows[0].final, true);
  assert.equal(skill.resultRows[4].value, '第3轮结果待确认');
  assert.deepEqual(state.history, before);
});

test('队伍标签只解析明确的公开座位列表；最新标记在筛选和新记录到达时保留浏览快照', () => {
  const state = model();
  state.history[0].teamLabel = '1、10、12 号';
  state.history[1].teamLabel = '等待3人入队';
  state.history[2].teamLabel = '无';
  const before = structuredClone(state.history);
  Object.assign(state, historyUI.open(state));
  assert.deepEqual(state.visibleHistory.map(row => row.teamSeatNumbers), [[], [], [1, 10, 12]]);
  assert.deepEqual(state.visibleHistory.filter(row => row.isLatest).map(row => row.key), [3]);
  Object.assign(state, historyUI.filter(state, 'vote'));
  assert.equal(state.visibleHistory[0].isLatest, false);
  Object.assign(state, historyUI.filter(state, 'all'));
  state.history.push({ key: 4, category: 'skill', text: '技能结算' });
  Object.assign(state, historyUI.sync(state, state.history, room));
  assert.equal(state.historyUnreadCount, 1);
  assert.deepEqual(state.visibleHistory.filter(row => row.isLatest).map(row => row.key), [3]);
  assert.deepEqual(state.history.slice(0, 3), before);
});

test('转换、查验及旧记录归其他，技能结算和最终行动仍归技能', () => {
  for (const text of ['本轮阵营转换', '本轮不转换', '仙女查验已完成'])
    assert.equal(historyUI.category({ kind: 'variant', text }), 'other');
  for (const resultType of ['conversion', 'fairy'])
    assert.equal(historyUI.category({ kind: 'variant', resultType }), 'other');
  assert.equal(historyUI.category({ kind: 'variant', text: '3号使用技能' }), 'skill');
  for (const kind of ['skillDetail', 'skillResult', 'toolReverse', 'toolKnife', 'assassination'])
    assert.equal(historyUI.category({ kind }), 'skill');
});
