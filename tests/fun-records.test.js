const { test } = require('node:test');
const assert = require('node:assert/strict');
const copy = require('../miniprogram/fun-copy');
const row = (id, mode, count, opportunities, extra = {}) => ({ id, mode, count, value: count, opportunities,
  label: id, unit: '次', positive: true, ranked: true, knownGames: 1, unknownGames: 0,
  rate: opportunities ? count / opportunities * 100 : null, byRole: [], ...extra });

test('称号网格区分玩法、已知零次和未知，保留原始顺序且不修改输入', () => {
  const input = { cards: [
    { id: 'classic:merlin', metrics: [row('merlin_evade', 'classic', 1, 2)] },
    { id: 'knights:merlin', metrics: [row('merlin_evade', 'knights', 0, 0)] },
    { id: 'knights:assassin', metrics: [row('assassin_miss', 'knights', 2, 3, { positive: false })] },
    { id: 'knights:survival', metrics: [row('survival_revive', 'knights', 9, 0, { value: null })] },
  ] };
  const before = JSON.stringify(input), result = copy.records(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.totalCount, 4); assert.equal(result.recordedCount, 2);
  assert.deepEqual(result.tiles.map(tile => tile.key), ['classic:merlin_evade', 'knights:merlin_evade', 'knights:assassin_miss', 'knights:survival_revive']);
  assert.deepEqual(result.recordedTiles.map(tile => tile.id), ['merlin_evade', 'assassin_miss']);
  assert.match(result.tiles[0].roleLabel, /^经典 · 梅林$/);
  assert.equal(result.tiles[0].rateLabel, '成功率 50%'); assert.equal(result.tiles[0].sampleLabel, '1 / 2 次');
  assert.equal(result.tiles[1].valueLabel, '0'); assert.equal(result.tiles[1].stateLabel, '暂无有效机会');
  assert.equal(result.tiles[2].rateLabel, '发生率 66.7%');
  assert.equal(result.tiles[3].valueLabel, '—'); assert.equal(result.tiles[3].rateLabel, ''); assert.equal(result.tiles[3].unit, '');
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
  assert.equal(zero.contextValue,'0 次'); assert.deepEqual(zero.info.rules,[{label:'成功率',value:'0% · 0 / 1 次'}]);
  assert.match(zero.content,/初始身份.*三蓝后仍有梅林在场/);
});
