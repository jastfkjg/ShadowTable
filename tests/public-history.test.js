const { test } = require('node:test');
const assert = require('node:assert/strict');
const historyUI = require('../miniprogram/public-history');

const room = { code: '123456', game: 1, phase: 'tools' };
test('任务上车人数按配置预告，发车、翻票和回看时取实际队伍', () => {
  const history = [
    { kind: 'toolVote', team: [4, 5] },
    { kind: 'toolQuest', team: [1, 2, 3], threshold: 1 },
    { kind: 'toolCanceled' },
    { kind: 'toolQuest', team: [1, 3, 5], threshold: 1 },
    { kind: 'toolQuest', team: [2, 3, 4, 5], threshold: 1 },
  ];
  const quests = [{ key: 1, questResult: 'success' }, { key: 3, questResult: 'failure' }, { key: 4, questResult: 'success' }];
  const track = (phase, count, extra = {}, reveal = null) => historyUI.questProgress(
    { phase, history, capacity: 10, flexible: true, ...extra }, quests.slice(0, count), reveal).questRounds;
  const sizes = rounds => rounds.map(r => r.teamSize);

  assert.deepEqual(track('lobby', 0), []);
  assert.deepEqual(sizes(track('tools', 0)), [3, 4, 4, 5, 5]);
  for (const phase of ['proposal', 'teamVote', 'teamResult', 'tools']) {
    const rounds = track(phase, 1, { team: [1, 3, 5] });
    assert.equal(rounds[1].teamSize, 4);
    assert.equal(rounds[3].protectedRound, true);
  }
  const firstDispatch = track('quest', 1, { team: [1, 3, 5] });
  assert.equal(firstDispatch[1].teamSize, 3);
  assert.equal(firstDispatch[1].result, 'pending');
  assert.equal(firstDispatch[1].key, null);
  assert.match(firstDispatch[1].label, /实上3人/);
  assert.deepEqual(sizes(track('tools', 2)), [3, 3, 4, 5, 5]);

  const shield = { kind: 'toolQuest', number: 12, threshold: 2, team: [1, 2, 3, 4, 5] };
  // A manual one-fail threshold overrides the fourth slot's default shield.
  assert.equal(track('quest', 3, { team: shield.team, activity: { kind: 'quest', threshold: 1 } })[3].protectedRound, false);
  const flipping = track('ended', 3, { team: [] }, shield)[3];
  assert.equal(flipping.teamSize, 5);
  assert.equal(flipping.protectedRound, true);
  assert.equal(flipping.result, 'pending');
  assert.equal(flipping.key, null);
  for (const result of ['success', 'failure']) {
    const room = { phase: 'ended', capacity: 10, flexible: true, history: [...history, shield] };
    const rounds = historyUI.questProgress(room, [...quests, { key: 5, questResult: result }]).questRounds;
    assert.deepEqual(sizes(rounds), [3, 3, 4, 5, 5]);
    assert.equal(rounds[3].result, result);
    assert.equal(rounds[3].protectedRound, true);
    assert.equal(rounds[3].key, 5);
  }
});

test('人数表适配各局人数，追加任务只在发车后增加节点', () => {
  const { TEAMS } = require('../server/engine');
  for (const [capacity, expected] of Object.entries(TEAMS)) {
    const rounds = historyUI.questProgress({ capacity: Number(capacity), phase: 'identity' }, []).questRounds;
    assert.deepEqual(rounds.map(r => r.teamSize), expected);
    assert.equal(rounds[3].protectedRound, Number(capacity) >= 7);
  }
  const room = { phase: 'quest', capacity: 6, flexible: true, history: Array.from({ length: 5 }, () => ({ team: [1, 2] })), team: [1, 2, 3, 4] };
  const quests = room.history.map((_, key) => ({ key, questResult: 'success' }));
  assert.equal(historyUI.questProgress(room, quests).questRounds[5].teamSize, 4);
  assert.equal(historyUI.questProgress({ ...room, phase: 'tools' }, quests).questRounds.length, 5);
});
test('公开任务详情只在保护轮说明失败票门槛', () => {
  const standard = { capacity: 8, flexible: false };
  const custom = { capacity: 8, flexible: true };
  const note = '至少 2 张失败票才失败';
  for (const kind of ['quest', 'toolQuest']) {
    assert.equal(historyUI.questThresholdLabel(standard, { kind, round: 4, threshold: 1 }), '');
    assert.equal(historyUI.questThresholdLabel(custom, { kind, round: 1, threshold: 2 }), note);
  }
  assert.equal(historyUI.questThresholdLabel(standard, { kind: 'quest', round: 4 }), note);
  assert.equal(historyUI.questThresholdLabel(custom, { kind: 'toolQuest', number: 4 }), '');
});

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

test('公开记录按板子显示技能分类，技能尚未发动时也可筛选', () => {
  const state = model();
  for (const knights of [{ round: 1 }, null]) {
    state.room = { ...room, knights };
    Object.assign(state, historyUI.open(state));
    const labels = state.historyFilters.map(item => item.label);
    assert.deepEqual(labels, knights ? ['全部', '投票', '任务', '技能', '其他'] : ['全部', '投票', '任务', '其他']);
    Object.assign(state, historyUI.filter(state, 'skill'));
    assert.equal(state.historyFilter, knights ? 'skill' : 'all');
  }
});

test('转换、查验及旧记录归其他，最终行动只在有技能的板子归技能', () => {
  const knights = { ...room, knights: { round: 1 } };
  for (const text of ['本轮阵营转换', '本轮不转换', '仙女查验已完成'])
    assert.equal(historyUI.category({ kind: 'variant', text }, knights), 'other');
  for (const resultType of ['conversion', 'fairy'])
    assert.equal(historyUI.category({ kind: 'variant', resultType }, knights), 'other');
  assert.equal(historyUI.category({ kind: 'variant', text: '3号使用技能' }, knights), 'skill');
  for (const kind of ['skillDetail', 'skillResult', 'toolReverse', 'toolKnife', 'assassination'])
    assert.equal(historyUI.category({ kind }, knights), 'skill');
  for (const kind of ['toolReverse', 'toolKnife', 'assassination'])
    assert.equal(historyUI.category({ kind }, room), 'other');
});
