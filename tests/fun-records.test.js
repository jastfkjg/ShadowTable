const { test } = require('node:test');
const assert = require('node:assert/strict');
const copy = require('../miniprogram/fun-copy');
const row = (id, mode, count, opportunities, extra = {}) => ({ id, mode, count, value: count, opportunities,
  label: id, unit: '次', positive: true, ranked: true, knownGames: 1, unknownGames: 0,
  rate: opportunities ? count / opportunities * 100 : null, byRole: [], ...extra });

test('梅林和派西称号跨玩法累加有效样本，其他称号按原玩法显示', () => {
  const input = { cards: [
    { id: 'classic:merlin', metrics: [row('merlin_evade', 'classic', 1, 2), row('merlin_hit', 'classic', 1, 2, { positive: false })] },
    { id: 'classic:percival', metrics: [row('percival_green', 'classic', 0, 0)] },
    { id: 'knights:merlin', metrics: [row('merlin_evade', 'knights', 3, 3), row('merlin_hit', 'knights', 0, 3, { positive: false })] },
    { id: 'knights:percival', metrics: [row('percival_green', 'knights', 0, 0), row('percival_bust', 'knights', 1, 1)] },
    { id: 'knights:assassin', metrics: [row('assassin_miss', 'knights', 2, 3, { positive: false })] },
    { id: 'other:merlin', metrics: [row('merlin_hit', 'other', 9, 10, { positive: false, value: null, knownGames: 0, unknownGames: 1 })] },
    { id: 'knights:survival', metrics: [row('survival_revive', 'knights', 0, 0, { value: null })] },
  ] };
  const before = JSON.stringify(input), result = copy.records(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.totalCount, 6); assert.equal(result.recordedCount, 4);
  assert.deepEqual(result.tiles.map(tile => tile.key), [
    'all:merlin_evade', 'all:merlin_hit', 'all:percival_green', 'all:percival_bust', 'knights:assassin_miss', 'knights:survival_revive',
  ]);
  const [evade, hit, green, bust, miss, revive] = result.tiles;
  assert.equal(evade.roleLabel, '全部玩法 · 梅林');
  assert.equal(evade.rateLabel, '成功率 80%'); assert.equal(evade.sampleLabel, '4 / 5 次');
  assert.equal(hit.knownGames, 2); assert.equal(hit.unknownGames, 1);
  assert.equal(hit.rateLabel, '发生率 20%'); assert.equal(hit.sampleLabel, '1 / 5 次');
  assert.equal(hit.url, '/pages/matches/matches?fun=merlin_hit&mode=all');
  assert.equal(green.valueLabel, '0'); assert.equal(green.stateLabel, '暂无有效机会');
  assert.equal(bust.roleLabel, '全部玩法 · 派西维尔');
  assert.equal(miss.rateLabel, '发生率 66.7%');
  assert.equal(revive.valueLabel, '—'); assert.equal(revive.rateLabel, ''); assert.equal(revive.unit, '');
  const split = copy.records(input, { splitModes: true }).tiles;
  assert.equal(split.find(tile => tile.key === 'classic:merlin_hit').rateLabel, '发生率 50%');
});

test('轮内技能的角色回查保留所选指标和玩法，未知角色不伪造次数', () => {
  const result = copy.records({ cards: [{ id: 'knights:kill', metrics: [
    row('kill_ally', 'knights', 1, 3, { positive: false, byRole: [
      { role: 'gareth', label: '加雷斯', value: 0, count: 0 },
      { role: 'unknown role', label: '未知', value: null, count: 0 },
    ] }),
    row('knife_aim_enemy', 'knights', 1, 3),
  ] }] });
  assert.equal(result.totalCount, 1);
  assert.equal(result.tiles[0].roles[0].countLabel, '0'); assert.equal(result.tiles[0].roles[1].countLabel, '—');
  assert.equal(result.tiles[0].roles[1].url, '/pages/matches/matches?fun=kill_ally&mode=knights&role=unknown%20role');
  assert.deepEqual(copy.records(null).tiles, []);
});

test('趣味说明呈现称号真实含义、适用身份和个人次数，零与未知不混淆', () => {
  const tiles = copy.records({ cards: [{ id:'knights:survival', metrics:[
    row('survival_knifed','knights',4,0), row('survival_revive','knights',0,0,{value:null}),
  ] }, { id:'knights:percival', metrics:[row('percival_green','knights',0,1)] }] }).tiles;
  const info = copy.recordInfo(tiles[0]);
  assert.equal(info.variant,'fun-record'); assert.equal(info.title,'全民公敌');
  assert.equal(info.contextValue,'4 次'); assert.equal(info.info.category,'生存趣事 · 十二骑士');
  assert.match(info.content,/轮内刀和最终刀/); assert.match(info.content,/无论是否生效或复活/);
  assert.match(info.content,/不含枪和决斗/); assert.equal(info.info.identity,'十二骑士全体玩家');
  assert.equal(info.info.rules.find(r=>r.label==='不计入').value,'枪、决斗');
  assert.equal(info.confirmText,undefined);
  assert.equal(copy.recordInfo(tiles[1]).contextValue,'尚无完整记录');
  const zero=copy.recordInfo(tiles[2]);
  assert.equal(zero.info.category,'全部玩法 · 派西维尔');
  assert.equal(zero.contextValue,'0 次'); assert.deepEqual(zero.info.rules,[{label:'成功率',value:'0% · 0 / 1 次'}]);
  assert.match(zero.content,/初始身份.*三蓝后仍有梅林在场/);
});
