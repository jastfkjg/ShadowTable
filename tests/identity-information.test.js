const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presentIdentity } = require('../miniprogram/identity-vision');
const { BOARDS, newRoom, enter, command, privateView, publicView } = require('../server/engine');
const { roles } = require('../server/variants');
const prophetRule = '被动视野：每轮技能结束后自动更新存活B牌坏人座位，可随时在此查看。';

function setup(board, capacity) {
  const room = newRoom('123456', 'p1', '房主', board, capacity);
  for (let n = 2; n <= capacity; n++) enter(room, 'p' + n, '玩家' + n);
  for (const p of room.players) command(room, p.uid, {type:'ready', ready:true, stage:room.stage});
  command(room, 'p1', {type:'start', flexible:true, stage:room.stage});
  return room;
}

test('先知实时结果和仙女结果分区，轮次只从仙女展示中移除，不改写原数据', () => {
  const secret = { information: prophetRule + ' 第3轮B牌坏人：无 8号查验结果：好人（第1轮）', fairyResult: { information:'8号查验结果：好人（第1轮）' } };
  const before = JSON.stringify(secret), info = presentIdentity(secret);
  assert.deepEqual(info.passive, {round:'3',result:'无',note:'每轮技能全部结算后自动更新。'});
  assert.deepEqual(info.fairy, {seat:8,faction:'好人',tone:'good'});
  assert.equal(info.ability, null);
  assert.equal(JSON.stringify(secret), before);
  assert.equal(presentIdentity({information:prophetRule+' 等待技能结算后自动更新。'}).passive.result, '等待结算');
  assert.equal(presentIdentity({information:prophetRule+' 第4轮B牌坏人：2、12号'}).passive.result, '2、12号');
});

test('互认只展示私密文本已披露的座位身份，能力和仙女不混入视野', () => {
  const profiles = [{seat:3,name:'<小鱼>',role:'不能泄露',token:'secret'}, {seat:7,name:'阿青'}, {seat:9,name:'不可见昵称'}];
  const info = presentIdentity({information:'初始见面匪：3号（莫德雷德）、7号（莫甘娜）。 可刀刀客或B角色一次；刀错不出局，仍消耗技能。 8号查验结果：坏人（第2轮）'}, profiles);
  assert.deepEqual(info.vision.players.map(p=>[p.seat,p.role]), [[3,'莫德雷德'],[7,'莫甘娜']]);
  assert.equal(info.vision.note,'');
  assert.equal(info.ability.lines[0].text,'可刀刀客或B角色一次；');
  assert.equal(info.ability.note,'刀错不出局，仍消耗技能。');
  assert.doesNotMatch(JSON.stringify(info),/不能泄露|token|不可见昵称/);
  const ambiguous=presentIdentity({information:'梅林与莫甘娜位于：3、7号。你无法区分谁是梅林。 8号查验结果：好人'}, profiles);
  assert.ok(ambiguous.vision.players.every(p=>p.role===''));
  assert.equal(ambiguous.vision.note,'你无法区分谁是梅林。');
  assert.deepEqual(ambiguous.fairy,{seat:8,faction:'好人',tone:'good'});
  const converted=presentIdentity({information:'刺客位于：7号。你已被命中，现随坏人阵营结算。'});
  assert.equal(converted.vision.note,'你已被命中，现随坏人阵营结算。');
  assert.equal(converted.showRoleHelp,false);
});

test('石像鬼逐次展示并保留初始随机、旧版缺失及更新后标识，不把技能规则当作结果', () => {
  const prefix='没有视野。 抽到时随机查验一名在场玩家；每轮可查验一人是否拥有主动击杀能力，不获知具体身份。';
  const info=presentIdentity({information:prefix+'\n\n查验记录\n第1次查验（抽牌随机）：4号拥有主动击杀能力。\n第2次查验：10号没有主动击杀能力。 8号查验结果：盗贼阵营（第3轮）'});
  assert.equal(info.showVision,false);
  assert.deepEqual(info.inspections.map(r=>[r.label,r.source,r.seat,r.result]),[
    ['第1次查验','抽牌随机',4,'有主动击杀能力'],['第2次查验','',10,'无主动击杀能力']]);
  assert.match(info.ability.note,/不获知具体身份/);
  assert.equal(info.fairy.tone,'third');
  const legacy=presentIdentity({information:prefix+'\n\n查验记录\n历史查验（旧版仅保留最近一次）：6号没有主动击杀能力。\n第1次查验（更新后）：3号拥有主动击杀能力。'});
  assert.equal(legacy.inspections[0].source,'旧版仅保留最近一次');
  assert.equal(legacy.inspections[1].source,'更新后');
  const unknown=prefix+'\n\n查验记录\n第1次查验：未来结果，不可丢弃。';
  const fallback=presentIdentity({information:unknown});
  assert.deepEqual(fallback.inspections,[]);
  assert.match(JSON.stringify(fallback),/未来结果，不可丢弃/);
});

test('历史身份仅用快照文本，不读取后来查验结果或补充当前玩家身份', () => {
  const snapshot={information:'梅林与莫甘娜位于：2、5号。你无法区分谁是梅林。 8号查验结果：好人（第1轮）',fairyResult:{information:'9号查验结果：坏人（第4轮）'}};
  const info=presentIdentity(snapshot);
  assert.equal(info.fairy.seat,8);
  assert.ok(info.vision.players.every(p=>!p.name&&!p.role));
  assert.doesNotMatch(JSON.stringify(info),/第4轮|9号/);
});

test('长规则及未知信息完整保留；猎人分开主动被动，特殊限制不丢失', () => {
  const info=presentIdentity({information:'没有视野。 主动自爆带走相邻一人；或预选场上其他一人，出局时被动开枪；也可不使用技能。主动与被动共用一次技能，替女巫出局不触发被动枪。'});
  assert.equal(info.vision.empty,true);
  assert.deepEqual(info.ability.lines.map(l=>l.label),['主动自爆','被动开枪']);
  assert.match(info.ability.note,/可不使用技能/);
  assert.match(info.ability.note,/共用一次技能，替女巫出局不触发被动枪/);
  for (const information of ['未来角色的完整规则\n未知查验：4号有特殊状态。','你不知道其他坏人是谁，其他坏人也看不见你。','没有视野。你与其他坏人不互认。']) {
    assert.equal(presentIdentity({information}).vision.text,information);
  }
  const unknownFairy=presentIdentity({information:'没有视野。 8号查验结果：未来阵营（第1轮）'});
  assert.equal(unknownFairy.fairy,null);
  assert.match(JSON.stringify(unknownFairy),/未来阵营（第1轮）/);
});

test('全部可用板子与人数的实际私密数据均可展示，不修改游戏数据或额外公开信息', () => {
  let identities=0;
  for (const board of BOARDS.filter(b=>b.available)) for (const capacity of Object.keys(board.roleConfigurations)) {
    const room=setup(board.id,Number(capacity));
    const before=JSON.stringify(room);
    for (const p of room.players) {
      const secret=privateView(room,p.uid), snapshot=JSON.stringify(secret);
      const info=presentIdentity(secret,publicView(room,p.uid).players);
      assert.ok(info.showVision||info.inspections.length||info.ability,board.id+' '+secret.role);
      assert.equal(JSON.stringify(secret),snapshot);
      identities++;
    }
    assert.equal(JSON.stringify(room),before);
  }
  assert.ok(identities>100);
});

test('十二骑士保留全部规则文字，只有 B 牌获得卡内说明入口', () => {
  const room=setup('knights',12);
  const bCards=['blueGuard','gargoyle','witch','magician','paladin','blueKnight','redKnight','blueAwakened','redAwakened','blueHunter','redHunter','prophet'];
  const aCards=['gareth','gaheris','blueLancelot','redLancelot','redSwordsman','assassin','morgana'];
  for(const role of [...bCards,...aCards]) {
    room.roles.p1=role;room.knights.players.p1.b=bCards.includes(role);
    const secret=privateView(room,'p1'),info=presentIdentity(secret);
    assert.ok(info.ability,roles[role]?.[0]||role);
    assert.equal(info.showRoleHelp,bCards.includes(role),role);
    const help = require('../server/knight-role-help').roleHelp(role, 12);
    assert.equal(info.ability.brief, help.brief);
    assert.deepEqual(info.ability.lines, help.facts);
    assert.equal(info.ability.note, help.exception);
  }
});
