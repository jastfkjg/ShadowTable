const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presentBoard, funOptions } = require('../miniprogram/leaderboard-presentation');
const availableFunMetrics = require('../server/fun').publicMetrics();
const stats = { publicId:'me', nickname:'我', total:3, wins:2, winRate:66.7, points:-12, rank:1, status:'ranked' };
test('积分周期规则区分今日和本月，今日不显示月初清零说明', () => {
  const day = presentBoard({ metric: 'points', period: 'day', rows: [stats], me: stats });
  assert.equal(day.periodLabel, '今日'); assert.match(day.ruleLines[0], /北京时间.*当日零点.*次日零点/);
  assert.doesNotMatch(day.ruleLines.join(), /每月|上月|全部榜/);
  const month = presentBoard({ metric: 'points', period: 'month', rows: [stats], me: stats });
  assert.equal(month.periodLabel, '本月'); assert.match(month.ruleLines.join(), /每月 1 日/);
});
test('所有常规榜单展示独立主值、单位和有效样本，负积分不丢失', () => {
  for (const [metric,value,unit,secondary] of [['points','-12','分','3 场计分局'],['games','3','局','2 胜 · 胜率 66.7%'],['overall','66.7','%','2 胜 · 3 局'],['good','66.7','%','2 胜 · 3 局'],['evil','66.7','%','2 胜 · 3 局']]) {
    const board=presentBoard({metric,rows:[stats],me:stats});
    assert.equal(board.rows[0].value,value);assert.equal(board.rows[0].unit,unit);assert.equal(board.rows[0].secondaryLabel,secondary);
  }
});
test('正向与反向指标不混用成功文案，一次机会可排名，未知样本保持未知', () => {
  const base={fun:true,sort:'rate',unit:'%',availableFunMetrics,rows:[],me:{count:1,opportunities:1,knownGames:1,rate:100,rank:1,status:'ranked',remaining:0}};
  const shield=presentBoard({...base,metric:'fun_defense_ally'});
  assert.equal(shield.rateThreshold,1);assert.equal(shield.me.sampleLabel,'成功 1 次 · 共 1 次机会');assert.equal(shield.me.statusLabel,'第 1 名');
  const adverse=presentBoard({...base,metric:'fun_kill_ally'});
  assert.equal(adverse.rateLabel,'发生率');assert.equal(adverse.rateThreshold,1);assert.equal(adverse.me.sampleLabel,'发生 1 次 · 共 1 次机会');
  assert.doesNotMatch(shield.ruleLines.join(), /至少|门槛/);
  const unknown=presentBoard({...base,metric:'fun_defense_ally',me:{count:0,opportunities:0,knownGames:0,status:'no_records'}});
  assert.equal(unknown.me.value,'—');assert.equal(unknown.me.sampleLabel,'暂无完整样本');
});
test('榜尾区分全部、截断与并列，保留服务器跨页并列信息', () => {
  const board=presentBoard({metric:'games',rows:[{...stats,rank:20,tied:true}],eligibleCount:120,maxRows:100,me:{...stats,status:'hidden',rank:null}});
  assert.equal(board.rows[0].tied,true);assert.match(board.endLabel,/已展示前 1 位.*120/);assert.doesNotMatch(board.endLabel,/全部/);assert.equal(board.me.placeLabel,'未公开');
  const legacy=presentBoard({metric:'games',rows:[{...stats,tied:false},{...stats,publicId:'other'}],me:stats});
  assert.ok(legacy.rows.every(row=>row.tied));
});
test('所有可选趣味指标仅出现一次，反向记录均可访问', () => {
  const options=funOptions(availableFunMetrics);
  assert.equal(new Set(options.map(item=>item.key)).size,options.length);
  for(const key of ['fun_percival_bust','fun_merlin_hit','fun_assassin_miss','fun_defense_enemy','fun_kill_ally'])assert.ok(options.some(item=>item.key===key));
  assert.ok(options.every(item=>['good','evil','other'].includes(item.category)));
  assert.equal(options.length,15);
  const standin=options.find(item=>item.key==='fun_good_shield');
  assert.equal(standin.title,'金牌替身');assert.equal(standin.category,'good');
  assert.equal(standin.roleLabel,'非梅林好人');assert.match(standin.conditionLabel,/最终刀落到本人/);
  assert.deepEqual(options.filter(item=>item.key.startsWith('fun_defense_')).map(item=>item.title),['绝对防御','卧龙凤雏']);
  assert.ok(options.filter(item=>item.key.startsWith('fun_defense_')).every(item=>item.category==='good'));
  assert.ok(options.every(item=>item.roleLabel && item.conditionLabel));
  assert.equal(options.find(item=>item.key==='fun_defense_ally').roleLabel,'蓝守卫／魔术师');
  assert.match(options.find(item=>item.key==='fun_kill_enemy').roleDetail,/刺客.*蓝骑士.*红猎人/);
  assert.equal(presentBoard({fun:true,metric:'fun_defense_ally',availableFunMetrics,rows:[],me:{}}).emptyTitle,'暂无记录');
});

test('趣味次数榜精简重复次数，比例榜与个人详情保留完整样本，榜尾不误报截断', () => {
  const row={publicId:'a',count:1,opportunities:4,knownGames:4,rate:25,rank:1};
  const base={fun:true,metric:'fun_kill_ally',availableFunMetrics,rows:[row],me:row,eligibleCount:2};
  const count=presentBoard({...base,sort:'count'});
  assert.equal(count.rows[0].secondaryLabel,'共 4 次机会');
  assert.equal(count.me.sampleLabel,'发生 1 次 · 共 4 次机会');
  assert.equal(count.participantLabel,'共 2 人上榜');
  assert.equal(count.compactEndLabel,'已展示前 1 位');
  assert.equal(presentBoard({...base,sort:'count',eligibleCount:1}).compactEndLabel,'已显示全部');
  const rate=presentBoard({...base,sort:'rate'});
  assert.equal(rate.rows[0].value,'25.0');
  assert.equal(rate.rows[0].secondaryLabel,'发生 1 次 · 共 4 次机会');
  const unknown=presentBoard({...base,sort:'count',rows:[{...row,knownGames:0}]});
  assert.equal(unknown.rows[0].secondaryLabel,'暂无完整样本');
  assert.equal(unknown.rows[0].value,'—');
});
