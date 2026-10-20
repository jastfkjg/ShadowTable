const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { wxmlToJs, wxssToJs } = require("miniprogram-compiler");
const root = path.resolve(__dirname, "../miniprogram");
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext(
  "(function(global){" + wxmlToJs(root) + "})(global)",
  context,
);
const renderStatsShell = data => factory('pages/stats/stats.wxml')({tab:data.tab || 'records', statistics:data, history:{}, historyStarted:false, scrollTops:{}});
const renderHistoryShell = data => factory('pages/matches/matches.wxml')({tab:'matches', statistics:{}, history:data, historyStarted:true, scrollTops:{}});
const renderTable = factory("pages/table/table.wxml");
const renderLobby = data => factory("pages/lobby/lobby.wxml")({ activeTab: 0, lobby: data, personal: {} });
const render = data => (data.room ? renderTable : renderLobby)({ ...data, isLobby: !data.room });
test('已准备仍能选择回避，无卡提示优先；发牌后隐藏入口', () => {
  const room = { code: '123456', phase: 'lobby', capacity: 6, players: [], team: [], history: [], me: { seat: 1, ready: true, avoidance: { balance: 1 } } };
  const data = { ...base, room, avoidanceOpen: true, avoidanceLoading: false,
    avoidance: { balance: 1, editable: true }, avoidanceDraft: 'merlin', avoidanceDraftName: '梅林',
    avoidanceGroups: [{ faction: 'good', label: '好人阵营', entries: [{ id: 'merlin', name: '梅林', portrait: '/assets/roles/merlin.png', selected: true }] }] };
  const tree = renderTable(data);
  assert.equal(byHandler(tree, 'chooseAvoidance').attr.disabled, false);
  assert.equal(byHandler(tree, 'saveAvoidance').attr.disabled, false);
  const actionRow = nodes(tree).find(n => n.attr?.class === 'lobby-action-inner');
  assert.equal(actionRow.children[0].attr.bindtap, 'openAvoidance');
  assert.ok(byHandler(actionRow, 'ready'));
  assert.equal(nodes(tree).some(n => n.attr?.class === 'lobby-action-meta'), false);
  assert.deepEqual(Array.from(byHandler(tree, 'saveAvoidance').children), ['避开梅林']);
  const saved = { ...data, avoidance: { ...data.avoidance, selected: 'merlin' } };
  const unchanged = renderTable(saved);
  assert.deepEqual(Array.from(byHandler(unchanged, 'cancelAvoidance').children), ['不避开了（不扣卡）']);
  assert.equal(byHandler(unchanged, 'saveAvoidance'), undefined);
  const modified = renderTable({ ...saved, avoidanceDraft: 'percival', avoidanceDraftName: '派西维尔' });
  assert.deepEqual(Array.from(byHandler(modified, 'saveAvoidance').children), ['改成避开派西维尔']);
  assert.equal(byHandler(modified, 'cancelAvoidance'), undefined);
  assert.equal(byHandler(renderTable({ ...data, avoidanceDraft: '', avoidanceDraftName: '' }), 'saveAvoidance').attr.disabled, true);
  const empty = renderTable({ ...data, avoidance: { balance: 0, editable: false } });
  const note = nodes(empty).find(n => n.attr?.class === 'avoidance-note');
  assert.deepEqual(Array.from(note.children), ['暂无回避卡']);
  assert.equal(byHandler(empty, 'chooseAvoidance').attr.disabled, true);
  for (const phase of ['lobby', 'identity', 'tools', 'quest', 'ended', 'terminated']) {
    const page = renderTable({ ...base, room: { ...room, phase } });
    assert.equal(!!byHandler(page, 'openAvoidance'), phase === 'lobby');
  }
  const personal = factory('pages/me/me.wxml')({ activeTab: 1, personal: { loading: false, profile: { nickname: '子龙', avoidance: { balance: 5 } } }, lobby: { isLobby: true } });
  assert.doesNotMatch(JSON.stringify(personal), /回避卡|openAvoidanceWallet/);
  assert.match(JSON.stringify(personal), /对局记录/);
});
test('首页装饰不进入牌桌，准备阶段继续使用原有座位和发放身份操作', () => {
  const room = { code:'123456', phase:'lobby', capacity:6, boardName:'经典基础', players:[], team:[], history:[], me:{seat:1,isHost:true,ready:false} };
  const text = JSON.stringify(renderTable({ ...base, isLobby:false, room }));
  assert.match(text, /发放身份/);
  assert.doesNotMatch(text, /home-brand-symbol|home-table-blue|home-action-symbol|home-clock/);
});
test('身份历程入口只在已揭示且发生变化时出现，旧身份仅回看且遮盖不渲染', () => {
  const history = [{ id: 1, current: true, role: '觉醒红刀客', faction: '坏人阵营', factionTone: 'evil', sinceLabel: '第1轮 · 换牌', skillHistory: [{ id: 0, round: 2, text: '刀8号' }] },
    { id: 0, current: false, initial: true, role: '红兰斯洛特', faction: '坏人阵营', factionTone: 'evil', detailAvailable: true, information: '旧视野', sinceLabel: '开局 · A牌', skillHistory: [{ id: 0, round: 1, text: '刀9号' }] }];
  const data = { ...base, room: { code: '123456', phase: 'tools', capacity: 12, me: { seat: 1 }, players: [], team: [], history: [] }, revealed: true, identityHistoryOpen: true, identityHistoryExpandedId: 0,
    secret: { role: '觉醒红刀客', faction: '坏人阵营', identityHistory: history, skillHistory: history[0].skillHistory } };
  let tree = renderTable(data), text = JSON.stringify(tree);
  assert.ok(byHandler(tree, 'openIdentityHistory'));
  assert.ok(byHandler(tree, 'closeIdentityHistory'));
  assert.ok(byHandler(tree, 'hideIdentityHistory'));
  assert.match(text, /旧视野|初始|当前/);
  assert.match(text, /刀8号/); assert.match(text, /刀9号/);
  const card = nodes(tree).find(node => node.attr?.class === 'identity open');
  assert.match(JSON.stringify(card), /技能记录/); assert.match(JSON.stringify(card), /刀8号/);
  const collapsed = JSON.stringify(renderTable({ ...data, identityHistoryExpandedId: null }));
  assert.match(collapsed, /刀9号/); assert.doesNotMatch(collapsed, /旧视野/);
  assert.equal(byHandler(tree, 'toggleIdentityHistory').attr.ariaExpanded, true);
  tree = renderTable({ ...data, revealed: false });
  assert.doesNotMatch(JSON.stringify(tree), /红兰斯洛特|旧视野|刀8号|刀9号/);
  tree = renderTable({ ...data, identityHistoryOpen: false, secret: { identityHistory: [history[0]] } });
  assert.equal(byHandler(tree, 'openIdentityHistory'), undefined);
  history[1].detailAvailable = false;
  assert.match(JSON.stringify(renderTable(data)), /旧对局未记录当时视野/);
});
test('准备阶段显示房间邀请，开局后只保留身份入口；首次昵称与失效提示保留在目标页面', () => {
  for (const phase of ['lobby', 'identity', 'proposal', 'quest', 'tools', 'offlineFinal', 'ended']) {
    const room = { code: '372338', phase, capacity: 6, boardName: '阿瓦隆', players: [], team: [], me: { seat: 2, isHost: false } };
    const tree = renderTable({ ...base, room, isLobby: false, loading: false });
    const button = nodes(tree).find(node => node.attr?.openType === 'share');
    if (phase === 'lobby') {
      assert.ok(button);
      assert.equal(button.attr.disabled, false);
      assert.match(button.attr.ariaLabel, /372338/);
      assert.equal(byHandler(tree, 'reveal'), undefined);
      const loading = renderTable({ ...base, room, isLobby: false, loading: true });
      assert.equal(nodes(loading).find(node => node.attr?.openType === 'share').attr.disabled, true);
    } else {
      assert.equal(button, undefined);
      const summary = nodes(tree).find(node => node.attr?.class === 'room-summary');
      assert.ok(byHandler(summary, 'copyRoomCode'));
      assert.ok(byHandler(summary, 'reveal'));
      assert.match(JSON.stringify(byHandler(summary, 'reveal')), /查看身份/);
      assert.equal(byHandler(summary, 'reveal').attr.ariaLabel, '2号 · 查看我的身份');
    }
  }
  const data = { ...base, isLobby: false, loading: false, invitation: { code: '372338', boardName: '阿瓦隆 · 十二骑士', capacity: 12, occupied: 12 }, invitationNeedsName: true };
  const tree = renderTable(data);
  assert.ok(nodes(tree).find(node => node.attr?.bindsubmit === 'submitInvitation'));
  assert.equal(nodes(tree).filter(node => node.tag === 'wx-input').length, 1);
  assert.match(JSON.stringify(tree), /372338|十二骑士|旁观者/);
  const expired = renderTable({ ...data, invitationError: '该房间已解散', invitationNeedsName: false });
  assert.ok(!nodes(expired).find(node => node.attr?.bindsubmit === 'submitInvitation'));
  assert.ok(byHandler(expired, 'returnHome'));
  assert.match(JSON.stringify(expired), /该房间已解散/);
});
test('小程序网页登录确认页显示真实网站与账号，加载、过期后不可确认，成功后有返回入口', () => {
  const renderLogin = factory('pages/web-login/web-login.wxml');
  const ready = { loading: false, busy: false, terminal: false, status: 'scanned', profile: { displayName: '小程序玩家', initial: '小' }, request: { website: 'https://play.example.com', device: 'Mac' } };
  const tree = renderLogin(ready);
  assert.match(JSON.stringify(tree), /https:\/\/play.example.com/);
  assert.match(JSON.stringify(tree), /小程序玩家/);
  assert.equal(byHandler(tree, 'confirm').attr.disabled, false);
  assert.equal(byHandler(renderLogin({ ...ready, busy: true }), 'confirm').attr.disabled, true);
  assert.ok(!byHandler(renderLogin({ ...ready, terminal: true, error: '小程序码已过期' }), 'confirm'));
  assert.ok(!byHandler(renderLogin({ ...ready, loading: true }), 'confirm'));
  const done = renderLogin({ ...ready, status: 'confirmed' });
  assert.ok(!byHandler(done, 'confirm')); assert.ok(byHandler(done, 'back'));
});
test('对局记录保留单局调整原因，不再混入独立积分调整',()=>{
  const renderMatches=renderHistoryShell,record={id:'m',members:[],expanded:true,score:{status:'scored',total:8,breakdown:[{id:'admin',label:'管理员调整',points:4}],manualOverride:{reason:'挡刀核对'} }};
  const data={records:[record],adjustments:[{id:'a',dateLabel:'今天',pointsLabel:'+2 分',beforePoints:8,afterPoints:10,reason:'额外奖励'}],adjustmentsTotal:1};
  const html=JSON.stringify(renderMatches(data));assert.match(html,/挡刀核对/);assert.doesNotMatch(html,/额外奖励|管理员积分调整/);
  delete record.score.manualOverride;assert.doesNotMatch(JSON.stringify(renderMatches(data)),/挡刀核对/);
});
const base = {
  loading: false,
  busy: false,
  hasPendingRequest: false,
  error: "",
  notice: "",
  room: null,
  entryMode: "join",
  boards: [],
  seats: [],
  history: [],
  revealed: false,
  secret: null,
  capacity: 6,
  boardId: "classic",
  network: true,
};
function nodes(node) {
  return typeof node === "string"
    ? []
    : [node, ...(node.children || []).flatMap(nodes)];
}
const byHandler = (tree, name) =>
  nodes(tree).find(
    (n) => n.attr?.bindtap === name || n.attr?.catchtap === name || n.attr?.["data-action"] === name,
  );
test('移除结果是导航上方的非模态状态提示，页面顶部不保留成功公告', () => {
  const tree=renderLobby({...base,roomFeedback:'已移除'}),all=nodes(tree);
  const toast=all.find(node=>node.attr?.class?.includes('room-feedback'));
  assert.ok(toast);assert.match(toast.attr.class,/above-tab/);
  assert.equal(toast.attr.role,'status');assert.equal(toast.attr.ariaLive,'polite');
  assert.equal(toast.attr.catchtap,undefined);assert.equal(toast.attr.catchtouchmove,undefined);
  assert.equal(all.some(node=>node.attr?.class==='notice'),false);
  assert.equal(nodes(renderLobby(base)).some(node=>node.attr?.class?.includes('room-feedback')),false);
});
test('对局列表同日合并，详情不提前显示成员，旧过程说明与真实事件分别展示', () => {
  const { presentMatches } = require('../miniprogram/profile');
  const record = { boardName: '阿瓦隆 · 十二骑士', capacity: 12, role: '派西维尔', faction: 'good', outcome: 'loss', winner: 'evil', source: 'manual', seat: 2,
    score: { status: 'legacy', reason: '积分功能启用前的记录' },
    fun: { status: 'legacy', reason: '旧对局未记录完整过程', events: [], highlights: [] }, members: [{ seat: 2, name: '林间' }] };
  const records = presentMatches([
    { ...record, id: 'one', endedAt: new Date(2026, 9, 1, 21, 26, 21).getTime() },
    { ...record, id: 'two', endedAt: new Date(2026, 9, 1, 20, 48, 19).getTime(), score: { status: 'scored', total: 0, breakdown: [] } },
    { ...record, id: 'three', endedAt: new Date(2026, 8, 30, 23, 30).getTime() },
  ]);
  const renderMatches = renderHistoryShell;
  const render = () => renderMatches({ records, total: 3, loaded: true });
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children || []).map(text).join(' ');
  assert.equal(nodes(render()).filter(n => n.attr?.class === 'match-day').length, 2);
  assert.match(text(render()), /21:26/);
  assert.doesNotMatch(text(render()), /21:26:21|我的身份|积分未启用|林间|房主登记/);
  assert.match(text(render()), /未计分/);
  assert.match(text(render()), /\+0 分/);

  records[0].expanded = true;
  assert.match(text(render()), /坏人获胜/);
  assert.match(text(render()), /同桌成员/);
  assert.match(text(render()), /本局暂无过程记录/);
  assert.doesNotMatch(text(render()), /我的趣味记录|林间/);
  assert.equal(byHandler(render(), 'historyToggleMembers').attr.ariaExpanded, false);
  records[0].membersExpanded = true;
  assert.match(text(render()), /林间/);
  assert.match(text(render()), /（我）/);

  records[0] = { ...presentMatches([{ ...record, id: 'one', endedAt: 1,
    fun: { status: 'partial', initialRole: '梅林', reason: '最终结果未记录；已完成的技能仍可查看', events: [{ id: 'knife', round: 2, role: '派西维尔', label: '刀中敌方', detail: '目标：3号' }], highlights: [] } }])[0], expanded: true };
  assert.match(text(render()), /我的趣味记录/);
  assert.match(text(render()), /初始身份：梅林/);
  assert.match(text(render()), /刀中敌方/);
  assert.match(text(render()), /最终结果未记录/);
});
test('对局摘要合并板子人数阵营，角色旁保留有效表现，复盘与详情独立操作', () => {
  const { presentMatches } = require('../miniprogram/profile');
  const highlights = [
    { id: 'final_miss', label: '最终歪刀', count: 1 },
    { id: 'knife_failed', label: '未生效', count: 2 },
    { id: 'good_shield', label: '成功挡刀', count: 1 },
    { id: 'knife_enemy', label: '命中敌方', count: 2 },
  ];
  const base = { boardName: '阿瓦隆 · 十二骑士（12人）', capacity: 12, role: '蓝刀客·加赫雷斯', faction: 'good', outcome: 'win', members: [], endedAt: 1, replayAvailable: true,
    score: { status: 'scored', total: 0 }, fun: { events: [{ id: 'knife', label: '未生效', detail: '目标已被挡下' }], highlights } };
  const before = JSON.stringify(base);
  const [shown, empty, assassin] = presentMatches([
    { ...base, id: 'shown' },
    { ...base, id: 'empty', replayAvailable: false, fun: { highlights: highlights.slice(0, 2) } },
    { ...base, id: 'assassin', fun: { highlights: [{ id: 'assassin_miss', label: '歪刀', count: 1 }, highlights[0]] } },
  ]);
  assert.deepEqual(shown.funHighlights.map(item => item.label), ['成功挡刀', '刀中敌方 ×2']);
  assert.equal(shown.funLabel, '成功挡刀 · 刀中敌方 ×2');
  assert.deepEqual(empty.funHighlights, []); assert.equal(empty.funLabel, '');
  assert.deepEqual(assassin.funHighlights.map(item => item.label), ['刺错梅林']);
  assert.equal(shown.fun.highlights.length, 4); assert.equal(shown.fun.events[0].label, '未生效');
  assert.equal(JSON.stringify(base), before);
  const tree = renderHistoryShell({ records: [shown, empty, assassin], total: 3, loaded: true });
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children || []).map(text).join('');
  const rendered = nodes(tree);
  assert.equal(text(rendered.find(node => node.attr?.class === 'match-board')), '阿瓦隆 · 十二骑士 · 12人 · 好人');
  assert.equal(text(rendered.find(node => node.attr?.class === 'match-identity')), '蓝刀客·加赫雷斯成功挡刀刀中敌方 ×2');
  assert.equal(rendered.filter(node => node.attr?.class === 'match-highlights').length, 2);
  const toggle = byHandler(tree, 'historyToggleRecord');
  assert.match(text(toggle), /\+0 分/);
  assert.equal(byHandler(toggle, 'historyOpenReplay'), undefined);
  const replays = rendered.filter(node => node.attr?.bindtap === 'historyOpenReplay');
  assert.deepEqual(replays.map(node => node.attr['data-id']), ['shown', 'assassin']);
  assert.match(replays[0].attr.ariaLabel, /查看.*复盘/);
  assert.doesNotMatch(text(tree), /最终歪刀|未生效/);
});
test('统计页显示本月积分，阵营和角色弹层只展示战绩', () => {
  const renderStats = renderStatsShell;
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children || []).map(text).join(' ');
  const score = { total: 30, month: 0, games: 0, average: null, current: 0, best: 0 };
  const role = { role: '派西维尔', total: 2, wins: 1, rateLabel: '50%', score, scoreAverageLabel: '—' };
  const faction = { faction: 'good', label: '好人阵营', ...role, expanded: true, roles: [role] };
  const stats = { total: 2, wins: 1, rateLabel: '50%', score, scoreAverageLabel: '—', byFaction: [faction], byRole: [role] };
  const show = value => text(renderStats({ loading: false, tab: 'records', stats: value }));
  const unscored = show(stats);
  assert.match(unscored, /本月积分 0/);
  assert.match(unscored, /派西维尔/);
  assert.doesNotMatch(unscored, /场均|局计分|暂无计分对局|来自积分调整|累计积分|本月积分 30/);

  const scored = { ...score, games: 1, average: 0 };
  const zeroPoints = show({ ...stats, score: scored, scoreAverageLabel: '0.00', byFaction: [{ ...faction, score: scored, scoreAverageLabel: '0.00', roles: [{ ...role, score: scored, scoreAverageLabel: '0.00' }] }] });
  assert.doesNotMatch(zeroPoints, /暂无计分对局/);
  assert.doesNotMatch(zeroPoints, /连胜/);
  assert.match(zeroPoints, /本月积分 0/);
  assert.doesNotMatch(zeroPoints, /场均|局计分/);
  const details = text(renderStats({loading:false,tab:'records',stats,statsDetail:{...role,kind:'role',title:role.role,score:scored,scoreAverageLabel:'0.00'}}));
  assert.doesNotMatch(details,/累计积分|场均积分|查看战绩与积分/);
  assert.match(details,/派西维尔/);
  const factionDetails = text(renderStats({loading:false,tab:'records',stats,statsDetail:{...faction,kind:'faction',title:faction.label,score:scored,scoreAverageLabel:'0.00'}}));
  assert.doesNotMatch(factionDetails,/累计积分|计分对局|场均积分/);
  assert.match(factionDetails,/好人阵营.*全部有效对局/);
  assert.match(factionDetails,/胜率仅统计有效对局/);

  for (const total of [-5, 5]) {
    const adjusted = show({ ...stats, score: { ...score, total: 30, month: total } });
    assert.match(adjusted, new RegExp('本月积分\\s+' + total));
    assert.doesNotMatch(adjusted, /场均|局计分|来自积分调整|本月积分 30/);
  }
});
test('图片预览准备完成后才能发送或保存；不支持发送与相册拒绝均有明确出口', () => {
  const renderShare=factory('pages/share/share.wxml');
  const loading=renderShare({loading:true,imageMenu:true,imagePath:''});
  assert.equal(byHandler(loading,'send').attr.disabled,true);assert.equal(byHandler(loading,'save').attr.disabled,true);
  assert.equal(byHandler(loading,'send').attr.loading,true);assert.match(JSON.stringify(byHandler(loading,'send')),/正在读取/);
  const rendering=renderShare({loading:false,rendering:true,imageMenu:true,imagePath:''});
  assert.equal(byHandler(rendering,'save').attr.loading,true);assert.match(JSON.stringify(byHandler(rendering,'save')),/正在生成/);
  const ready=renderShare({loading:false,rendering:false,acting:false,imagePath:'wxfile://preview',description:'小林，62.5%胜率',imageMenu:true});
  assert.equal(byHandler(ready,'send').attr.disabled,false);
  assert.equal(nodes(ready).find(node=>node.tag==='wx-image').attr.src,'wxfile://preview');
  assert.match(byHandler(ready,'preview').attr.ariaLabel,/小林，62.5%胜率/);
  assert.ok(!nodes(ready).some(node=>node.attr?.openType==='share'));
  const fallback=renderShare({imagePath:'wxfile://preview',imageMenu:false,actionError:'需要相册权限',albumDenied:true});
  assert.equal(byHandler(fallback,'send'),undefined);assert.ok(byHandler(fallback,'save'));assert.ok(byHandler(fallback,'openAlbumSettings'));
  assert.ok(!nodes(ready).some(node=>node.attr?.bindtap==='chooseMode'));
  assert.doesNotMatch(JSON.stringify(ready),/榜单前三位/);
});
test('榜单顶部移除分享入口，保留规则与忙碌状态提示', () => {
  const template=factory('pages/leaderboard/leaderboard.wxml');
  const renderRank=data=>template({loading:false,loadingMore:false,visibilitySaving:false,shareOpening:false,...data});
  const own=renderRank({board:{rows:[],metric:'games'}});
  assert.equal(byHandler(own,'shareLeaderboard'),undefined);
  assert.ok(byHandler(own,'toggleRules'));
  assert.match(JSON.stringify(own),/暂无公开排名/);
  const board={rows:[],metric:'games'};
  const empty=renderRank({board,shareNotice:'当前榜单暂无本人成绩，完成相关对局后再来分享。'});
  assert.equal(byHandler(empty,'shareLeaderboard'),undefined);
  assert.ok(nodes(empty).some(node=>node.attr?.role==='alert'));
  assert.match(JSON.stringify(empty),/暂无本人成绩/);
  for (const key of ['loading','loadingMore','visibilitySaving','shareOpening']) {
    const busy=renderRank({board,[key]:true});
    const entry=byHandler(busy,'shareLeaderboard');
    assert.equal(entry,undefined);
    assert.ok(nodes(busy).some(node=>node.attr?.role==='status'));
  }
});
test('趣味榜指标在分组弹层中选择，排序独立且不显示重复说明和样本门槛', () => {
  const presentation=require('../miniprogram/leaderboard-presentation');
  const options=presentation.funOptions(require('../server/fun').publicMetrics());
  const renderRank=factory('pages/leaderboard/leaderboard.wxml');
  const data={groups:require('../miniprogram/leaderboard').groups,metric:'fun_defense_ally',funSelected:true,funAvailable:true,
    funOptions:options,funSort:'count',metricsExpanded:false,funCategories:presentation.categories,
    pendingFunMetric:'fun_defense_ally',pendingFunOption:options.find(item=>item.key==='fun_defense_ally'),
    board:{fun:true,threshold:1,rows:[],me:{}}};
  const collapsed=renderRank(data);
  assert.match(JSON.stringify(byHandler(collapsed,'toggleMetrics')),/保护友方/);
  assert.equal(byHandler(collapsed,'toggleMetrics').attr.ariaExpanded,false);
  assert.ok(!byHandler(collapsed,'previewFunMetric'));
  assert.ok(!nodes(collapsed).some(n=>n.attr?.role==='dialog'));
  const sorts=nodes(collapsed).filter(n=>n.attr?.bindtap==='chooseFunSort');
  assert.equal(sorts.length,2);assert.equal(sorts[0].attr.ariaPressed,true);
  assert.doesNotMatch(JSON.stringify(collapsed),/技能身份|全部身份|由高到低|排名 \/ 玩家/);
  assert.doesNotMatch(JSON.stringify(byHandler(collapsed,'toggleMetrics')),/蓝守卫|魔术师/);
  const keys=[];
  for(const category of presentation.categories) {
    const filtered=presentation.filterFunOptions(options,category.id);
    const tree=renderRank({...data,metricsExpanded:true,funCategory:category.id,filteredFunOptions:filtered});
    assert.ok(nodes(tree).some(n=>n.attr?.role==='dialog' && n.attr.ariaLabel==='选择趣味指标'));
    const choices=nodes(tree).filter(n=>n.attr?.bindtap==='previewFunMetric');
    assert.equal(choices.length,filtered.length);
    assert.ok(choices.every(n=>n.tag==='wx-button'));
    if(category.id!=='all')keys.push(...choices.map(n=>n.attr['data-id']));
    assert.ok(byHandler(tree,'confirmFunMetric'));
    assert.doesNotMatch(JSON.stringify(tree), /查看不同角色的高光|至少|次数榜/);
  }
  assert.deepEqual(keys.sort(),options.map(item=>item.key).sort());
  const adverse=renderRank({...data,metric:'fun_kill_ally',funSort:'rate',board:{...data.board,rateLabel:'发生率',threshold:10}});
  assert.match(JSON.stringify(byHandler(adverse,'toggleMetrics')),/击杀友方/);
  assert.match(JSON.stringify(nodes(adverse).find(n=>n.attr?.['data-id']==='rate')),/发生率/);
  assert.doesNotMatch(JSON.stringify(adverse),/至少.*次机会/);
});

test('结束牌桌显示本人得分或房主关闭计分的原因，准备页没有历史结算',()=>{
  const room={phase:'ended',capacity:6,me:{seat:1},team:[],players:[],history:[],result:{winner:'good',reason:'对局已归档',source:'system'},myScore:{status:'scored',total:7,breakdown:[{id:'remote',label:'服务端奖励',points:7}]}};
  const ended=render({...base,room});assert.match(JSON.stringify(ended),/本局 \+7 分/);assert.match(JSON.stringify(ended),/服务端奖励/);
  room.myScore={status:'excluded',reason:'本局未开启计分'};assert.match(JSON.stringify(render({...base,room})),/不计积分 · 本局未开启计分/);
  room.phase='lobby';assert.doesNotMatch(JSON.stringify(render({...base,room})),/不计积分 · 本局未开启计分/);
});
test('最终结果替换顶部最近操作，积分和再开一局在同一卡片，覆盖零分、排除及终止', () => {
  const room = { phase:'ended', phaseName:'对局结束', flexible:true, capacity:6, team:[], me:{seat:1,isHost:true}, scoreSettings:{enabled:true} };
  for (const [winner, title] of [['good','好人获胜'],['evil','坏人获胜'],['third','盗贼阵营获胜'],[null,'以线下结算为准']]) {
    for (const total of [0, 7, -2]) {
      const data = { ...base, room:{...room,result:{winner,reason:'房主已登记',source:'manual'},myScore:{status:'scored',total,breakdown:[{id:'win',label:'本局奖励',points:total}]}}, latestResult:{text:'本轮不转换'} };
      const tree = render(data), flat = nodes(tree);
      const dynamic = flat.find(n => n.attr?.class?.startsWith('table-dynamics '));
      const final = nodes(dynamic).find(n => n.attr?.class === 'final-result');
      assert.ok(final);
      assert.match(JSON.stringify(final), new RegExp(title));
      assert.ok(JSON.stringify(final).includes(`本局 ${total>=0?'+':''}${total} 分`));
      const scoreHeading = nodes(final).find(n => n.attr?.class === 'final-result-score-heading');
      assert.ok(JSON.stringify(scoreHeading).includes(`本局 ${total>=0?'+':''}${total} 分`));
      assert.ok(byHandler(scoreHeading, 'viewScoreRecord'));
      assert.equal(nodes(final).filter(n => n.attr?.bindtap === 'viewScoreRecord').length, 1);
      assert.ok(byHandler(final, 'rematch'));
      assert.equal(flat.filter(n => n.attr?.class === 'final-result').length, 1);
      assert.ok(!flat.some(n => n.attr?.class === 'latest-result' || n.attr?.class === 'phase-strip' || n.attr?.class === 'score-result'));
      assert.doesNotMatch(JSON.stringify(dynamic), /本轮不转换|最近结果/);
      assert.ok(flat.indexOf(final) < flat.findIndex(n => n.attr?.class === 'seats'));
      assert.equal(byHandler(render({...data,hasPendingRequest:true}), 'rematch').attr.disabled, true);
      const guest = render({...data,room:{...data.room,me:{seat:null,isHost:false},myScore:null}});
      assert.ok(!byHandler(guest, 'rematch'));
      assert.match(JSON.stringify(guest), /等待房主开启下一局/);
    }
  }
  for (const phase of ['ended', 'terminated']) {
    const tree = render({...base,room:{...room,phase,result:{winner:null,reason:'本局不判胜负'},myScore:{status:'excluded',reason:'本局未开启计分'}}});
    const final = nodes(tree).find(n => n.attr?.class === 'final-result');
    assert.match(JSON.stringify(final), /不计积分 · 本局未开启计分/);
    assert.ok(!byHandler(final, 'viewScoreRecord'));
  }
});
test('房主始终位于座位右上角，湖仙徽章独立于头像并保留任务和出局状态', () => {
  const seat = {seat:1,name:'甲',occupied:true,mine:true,host:true,alive:false,inTeam:true};
  for (const phase of ['lobby','tools','quest','ended']) {
    const room = {phase,capacity:6,team:[1],me:{seat:1},fairyHolder:1};
    const button = byHandler(render({...base,room,seats:[seat]}), 'seat');
    const head = nodes(button).find(n => n.attr?.class === 'seat-head-tags');
    assert.deepEqual(Array.from(nodes(head).find(n => n.attr?.class === 'seat-flag').children), ['房主']);
    assert.equal(nodes(button).filter(n => n.attr?.class === 'seat-flag').length, 1);
    const avatar = nodes(button).find(n => n.attr?.class === 'seat-avatar-wrap');
    assert.ok(!nodes(avatar).some(n => n.attr?.class === 'seat-fairy'));
    const fairy = (button.children || []).find(n => n.attr?.class === 'seat-fairy');
    assert.equal(!!fairy, phase !== 'lobby');
    if (phase !== 'lobby') {
      assert.match(button.attr.class, /has-fairy/);
      assert.match(JSON.stringify(button), /任务队员|已出局/);
    }
  }
});
test("座位头像固定占位且失败回退，保留座位按钮和全部公开状态", () => {
  const room = { phase: "proposal", flexible: false, leader: 1, fairyHolder: 1, capacity: 6, me: { seat: 1 } };
  const seat = { seat: 1, name: "甲", occupied: true, mine: true, host: true, alive: false, selected: true,
    avatarUrl: "https://table.example/api/avatars/a", avatarInitial: "甲" };
  const tree = render({ ...base, room, seats: [seat] });
  const button = byHandler(tree, "seat");
  assert.equal(button.attr.disabled, false);
  assert.equal(button.attr["data-seat"], 1);
  assert.equal(button.attr.ariaLabel, "1号，甲，你的座位，房主，已出局，已选入队，湖中仙女持有者，点击查看战绩");
  const image = nodes(button).find(n => n.tag === "wx-image");
  assert.equal(image.attr.src, seat.avatarUrl);
  assert.equal(image.attr.binderror, "seatAvatarError");
  assert.equal(image.attr["data-url"], seat.avatarUrl);
  assert.deepEqual(Array.from(nodes(button).find(n => n.attr?.class === "seat-self").children), ["你"]);
  assert.deepEqual(Array.from(nodes(button).find(n => n.attr?.class === "seat-flag").children), ["房主"]);
  assert.match(JSON.stringify(button), /已出局/);
  assert.match(button.attr.ariaLabel, /湖中仙女持有者/);
  assert.match(JSON.stringify(button), /已选入队/);
  assert.ok(nodes(button).find(n => n.attr?.class?.startsWith("seat-status")).children.includes("已选入队"));
  assert.ok(nodes(button).find(n => n.attr?.class === "seat-tags"));
  const failed = byHandler(render({ ...base, room, seats: [{ ...seat, avatarFailed: true }] }), "seat");
  assert.ok(!nodes(failed).some(n => n.attr?.class === "seat-avatar-image"));
  assert.ok(nodes(failed).some(n => n.attr?.class === "seat-avatar-fallback"));
  assert.ok(nodes(failed).some(n => n.attr?.class === "seat-fairy-icon"));
  const lobby = { ...room, phase: "lobby" };
  const empty = byHandler(render({ ...base, room: lobby, seats: [{ seat: 2, name: "空位", occupied: false, mine: false, avatarInitial: "+" }] }), "seat");
  assert.equal(empty.attr.disabled, false);
  assert.equal(empty.attr.ariaLabel, "2号，空位，可入座");
  assert.match(empty.attr.class, /seat-empty/);
  assert.deepEqual(Array.from(nodes(empty).find(n => n.attr?.class === "seat-empty-label").children), ["入座"]);
  assert.ok(!nodes(empty).some(n => n.tag === "wx-image" || n.attr?.class === "seat-meta"));
  const gameEmpty = byHandler(render({ ...base, room, seats: [{ seat: 2, name: "空位", occupied: false }] }), "seat");
  assert.doesNotMatch(JSON.stringify(gameEmpty), /点击入座/);
  const occupied = byHandler(render({ ...base, room: lobby, seats: [{ ...seat, mine: false }] }), "seat");
  assert.equal(occupied.attr.disabled, false);
  assert.equal(nodes(occupied).find(n => n.attr?.class === "seat-self"), undefined);
  assert.match(occupied.attr.ariaLabel, /未准备/);
  assert.ok(!nodes(occupied).some(n => n.attr?.class?.startsWith("seat-status")));
  assert.ok(!nodes(occupied).some(n => n.attr?.class === "seat-ready-badge"));
  const ready = byHandler(render({ ...base, room: lobby, seats: [{ ...seat, ready: true }] }), "seat");
  assert.match(ready.attr.ariaLabel, /已准备/);
  assert.ok(nodes(ready).some(n => n.attr?.class === "seat-ready-badge"));
  assert.ok(!nodes(ready).some(n => n.attr?.class === "seat-meta" || n.attr?.class === "seat-fairy"));
  assert.doesNotMatch(JSON.stringify(ready), /未准备/);
});
test("座位区保留人数和准备统计，长昵称保留在原卡片且不显示名单入口", () => {
  const room = { phase: "lobby", capacity: 13, me: { seat: 1 }, team: [] };
  const seats = [{ seat: 1, name: "这是一个很长的完整玩家昵称", occupied: true, mine: true, host: true, role: "秘密角色" },
    { seat: 2, name: "乙", occupied: true, ready: true }, { seat: 3, name: "空位", occupied: false }];
  const tree = render({ ...base, room, seats, seatOccupiedCount: 2, seatReadyCount: 1 });
  assert.doesNotMatch(JSON.stringify(tree), /玩家名单|关闭名单|秘密角色/);
  const count = nodes(tree).find(n => n.attr?.class === "seat-count");
  assert.equal(count.attr.ariaLabel, "已入座2人，共13个座位，1人已准备");
  assert.deepEqual(Array.from(count.children), ["2/13 人入座 · 1 人已准备"]);
  assert.ok(!nodes(tree).some(n => n.attr?.class === "seat-section-caption"));
  const button = byHandler(tree, "seat");
  assert.match(button.attr.ariaLabel, /这是一个很长的完整玩家昵称/);
  assert.deepEqual(Array.from(nodes(button).find(n => n.attr?.class === "seat-name").children), ["这是一个很长的完整玩家昵称"]);
});
test("初次发牌提醒默认遮盖，可稍后查看；关闭后只有身份入口气泡，不渲染旧秘密", () => {
  const data = { ...base, room: { phase: "tools", code: "123456", capacity: 6, team: [], me: { seat: 1 } }, dealtIdentityDialog: true };
  const hidden = render(data);
  assert.ok(byHandler(hidden, "revealDealtIdentity"));
  assert.ok(byHandler(hidden, "closeDealtIdentity"));
  assert.match(JSON.stringify(hidden), /稍后查看/);
  const secret = { role: "梅林", faction: "好人阵营", information: "秘密视野" };
  const shown = render({ ...data, dealtIdentitySecret: secret });
  assert.match(JSON.stringify(shown), /秘密视野/);
  assert.match(JSON.stringify(shown), /记住了，遮盖身份/);
  const closed = render({ ...data, dealtIdentityDialog: false, dealtIdentitySecret: secret, identityHintVisible: true });
  assert.ok(!JSON.stringify(closed).includes("秘密视野"));
  assert.match(JSON.stringify(closed), /随时点这里/);
  assert.ok(byHandler(closed, "dismissIdentityHint"));
  const covered = render({ ...data, identityHintVisible: true });
  assert.equal(byHandler(covered, "dismissIdentityHint"), undefined);
});
test('身份插画与视野一起受主动查看和关闭状态保护', () => {
  const room = {phase:'tools',code:'123456',capacity:12,team:[],me:{seat:1}};
  const secret = {role:'梅林',faction:'好人阵营',portrait:'/assets/roles/merlin.png',information:'秘密视野'};
  const data = {...base,room,secret,dealtIdentityDialog:true};
  const hidden = JSON.stringify(render(data));
  assert.doesNotMatch(hidden,/merlin\.png|秘密视野/);
  const revealed = JSON.stringify(render({...data,dealtIdentitySecret:secret}));
  assert.match(revealed,/merlin\.png/);
  assert.match(revealed,/秘密视野/);
  for (const state of [{dealtIdentityDialog:false,dealtIdentitySecret:secret},{dealtIdentitySecret:secret,error:'连接需要恢复'}])
    assert.doesNotMatch(JSON.stringify(render({...data,...state})),/merlin\.png|秘密视野/);
  const inline = JSON.stringify(render({...data,dealtIdentityDialog:false,revealed:true}));
  assert.match(inline,/merlin\.png/);
  assert.doesNotMatch(JSON.stringify(render({...data,dealtIdentityDialog:false,revealed:false})),/merlin\.png/);
});
test('任务牌只展示当前允许选项，先选后确认且固定操作在滚动内容之外', () => {
  const room = {phase:'quest',code:'123456',capacity:12,team:[1,6,8],needsSubmission:true,me:{seat:1,submitted:false}};
  const data = {...base,room,actionDialog:true,stagedChoice:true,actionChoices:[{value:'success',label:'任务成功'}]};
  const tree = render(data);
  const choices = nodes(tree).filter(n=>n.attr?.bindtap==='submitChoice');
  assert.equal(choices.length,1);
  assert.equal(choices[0].attr['data-value'],'success');
  assert.equal(choices[0].attr.ariaPressed,false);
  assert.equal(byHandler(tree,'confirmChoice').attr.disabled,true);
  const scroll = nodes(tree).find(n=>n.attr?.class?.split(' ').includes('task-choice-body'));
  assert.ok(scroll);
  assert.equal(byHandler(scroll,'confirmChoice'),undefined);
  const selected = render({...data,draftChoice:'success',draftLabel:'任务成功'});
  assert.equal(byHandler(selected,'confirmChoice').attr.disabled,false);
  assert.equal(byHandler(selected,'submitChoice').attr.ariaPressed,true);
  assert.match(JSON.stringify(selected),/确认提交后不可更改/);
  for(const blocked of [{network:false},{busy:true},{hasPendingRequest:true}]) {
    const disabled=render({...data,draftChoice:'success',...blocked});
    assert.equal(byHandler(disabled,'confirmChoice').attr.disabled,true);
    assert.equal(byHandler(disabled,'submitChoice').attr.disabled,true);
  }
  const evil=render({...data,actionChoices:[...data.actionChoices,{value:'fail',label:'任务失败'}]});
  assert.deepEqual(nodes(evil).filter(n=>n.attr?.bindtap==='submitChoice').map(n=>n.attr['data-value']),['success','fail']);
  assert.equal(byHandler(render({...data,room:{...room,me:{...room.me,submitted:true}}}),'confirmChoice'),undefined);
});
test("WXML入口加载/错误/禁用绑定为真实布尔条件", () => {
  const tree = render(base),
    text = JSON.stringify(tree);
  assert.ok(!text.includes("正在连接牌桌"));
  assert.equal(byHandler(tree, "join").attr.disabled, false);
  assert.equal(byHandler(tree, "retry"), undefined);
  const loading = render({ ...base, loading: true });
  assert.equal(byHandler(loading, "join").attr.disabled, true);
  assert.ok(JSON.stringify(loading).includes("正在连接牌桌"));
  assert.ok(
    byHandler(
      render({ ...base, error: "连接断开", recoverableError: true }),
      "retry",
    ),
  );
});
test("WXML私密卡被遮盖时不把角色和行动渲染到树，非房主无推进按钮", () => {
  const room = {
    phase: "quest",
    code: "123456",
    capacity: 6,
    me: { seat: 1, isHost: false, submitted: false },
    needsSubmission: true,
    canAdvance: false,
    team: [],
  };
  const secret = {
    role: "梅林",
    faction: "好人阵营",
    information: "坏人2号",
    skillStatus: { title: "技能已用完", detail: "私密技能原因" },
    action: { label: "选择任务牌" },
  };
  const hidden = render({ ...base, room, secret });
  assert.ok(!JSON.stringify(hidden).includes("梅林"));
  assert.ok(!JSON.stringify(hidden).includes("私密技能原因"));
  assert.equal(byHandler(hidden, "advance"), undefined);
  assert.equal(byHandler(hidden, "submitChoice"), undefined);
  const shown = render({
    ...base,
    room,
    secret,
    revealed: true,
    choiceButtons: [{ value: "success", label: "任务成功" }],
  });
  assert.ok(JSON.stringify(shown).includes("梅林"));
  assert.ok(JSON.stringify(shown).includes("私密技能原因"));
  assert.equal(byHandler(shown, "submitChoice"), undefined);
  const submitted = render({
    ...base,
    room: { ...room, me: { ...room.me, submitted: true } },
    secret,
    revealed: true,
    choiceButtons: [{ value: "success", label: "任务成功" }],
  });
  assert.equal(byHandler(submitted, "submitChoice"), undefined);
});
test("WXSS官方编译器封装可编译全局样式", () => {
  const output = wxssToJs(root);
  assert.ok(output.length > 100);
});

test("历史仅展示有效牌桌，失效房间和批量清理入口自动隐藏", () => {
  const now=Date.now(),rooms=[{code:"111111",status:"lobby",available:true},
    {code:"222222",status:"ended",statusLabel:"已结束",available:true,lastActivityAt:now-4*86400000},
    {code:"333333",status:"unavailable",available:false}];
  const roomList=require("../miniprogram/room-list");
  const data={...base,memberRooms:roomList.availableRooms(rooms),...roomList.present(rooms,"all",now),historyExpanded:false};
  const text=n=>typeof n==="string"||typeof n==="number"?String(n):(n.children||[]).map(text).join("");
  let tree=render(data);
  assert.equal(nodes(tree).filter(n=>n.attr?.catchtap==="openRoomMenu").length,1);
  assert.equal(byHandler(tree,"toggleRoomHistory").attr.ariaExpanded,false);
  assert.equal(text(byHandler(tree,"toggleRoomHistory")),"历史牌桌");
  tree=render({...data,historyExpanded:true});
  assert.equal(nodes(tree).filter(n=>n.attr?.catchtap==="openRoomMenu").length,2);
  assert.equal(byHandler(tree,"toggleRoomHistory").attr.ariaExpanded,true);
  const history=nodes(tree).find(n=>n.attr?.id==="room-history-list");
  assert.equal(byHandler(history,"openRoom").attr["data-code"],"222222");
  assert.equal(byHandler(history,"cleanupUnavailableRooms"),undefined);
  assert.equal(nodes(history).some(n=>n.attr?.["data-code"]==="333333"),false);
  assert.doesNotMatch(text(history),/已失效|战绩与复盘保留/);
  const locked=render({...data,historyExpanded:true,roomsRefreshing:true});
  assert.equal(byHandler(locked,"toggleRoomHistory").attr.disabled,true);
  const expiredOnly=render({...base,memberRooms:roomList.availableRooms([rooms[2]]),...roomList.present([rooms[2]],"all",now),historyExpanded:true});
  assert.equal(byHandler(expiredOnly,"toggleRoomHistory"),undefined);
  assert.equal(byHandler(expiredOnly,"cleanupUnavailableRooms"),undefined);
  assert.match(text(expiredOnly),/还没有牌桌/);assert.doesNotMatch(text(expiredOnly),/没有符合条件|已失效/);
});
test("牌桌空态与有效列表一致，计数缺失或过期不会和卡片、历史及筛选提示同时出现", () => {
  const roomList = require("../miniprogram/room-list"), now = Date.now();
  const rooms = [{ code: "696130", status: "lobby", available: true },
    { code: "464905", status: "ended", available: true, lastActivityAt: now }];
  const data = { ...base, memberRooms: rooms, ...roomList.present(rooms, "all", now) };
  for (const availableRoomCount of [0, undefined]) {
    const shown = JSON.stringify(render({ ...data, availableRoomCount }));
    assert.match(shown, /696130/); assert.match(shown, /464905/); assert.match(shown, /最近结束/);
    assert.doesNotMatch(shown, /还没有牌桌|没有符合条件的牌桌/);
    const historyRooms = [{ ...rooms[1], lastActivityAt: now - roomList.HISTORY_AFTER }];
    const history = JSON.stringify(render({ ...base, memberRooms: historyRooms,
      ...roomList.present(historyRooms, "all", now), availableRoomCount, historyExpanded: false }));
    assert.match(history, /历史牌桌/); assert.doesNotMatch(history, /还没有牌桌|没有符合条件的牌桌/);
    const filtered = JSON.stringify(render({ ...data, ...roomList.present(rooms, "playing", now), availableRoomCount }));
    assert.match(filtered, /没有符合条件的牌桌/); assert.doesNotMatch(filtered, /还没有牌桌/);
  }
  const empty = { ...base, memberRooms: [], ...roomList.present([], "all", now), availableRoomCount: 2 };
  assert.match(JSON.stringify(render(empty)), /还没有牌桌/);
  assert.doesNotMatch(JSON.stringify(render({ ...empty, loading: true })), /还没有牌桌|没有符合条件的牌桌/);
});
test("我的牌桌统一更多入口，只有房主菜单显示解散，非房主仍可移除记录", () => {
  const rooms = [{ code: "123456", isHost: true, available: true }, { code: "234567", isHost: false, available: true }];
  const data = { ...base, memberRooms: rooms, visibleMemberRooms: rooms };
  const tree = render(data);
  assert.ok(byHandler(tree, "join"));
  assert.equal(nodes(tree).filter(n => n.attr?.catchtap === "openRoomMenu").length, 2);
  assert.equal(byHandler(tree, "deleteRoom"), undefined);
  for (const room of rooms) {
    const menu = render({ ...data, roomMenu: room });
    const actions = nodes(menu).filter(n => n.attr?.bindtap === "roomMenuAction").map(n => n.attr["data-kind"]);
    assert.ok(actions.includes("hide"));
    assert.ok(!actions.includes("note"));
    assert.equal(actions.includes("delete"), room.isHost);
  }
  const empty = render({ ...base, memberRooms: [], visibleMemberRooms: [] });
  assert.ok(JSON.stringify(empty).includes("还没有牌桌"));
});

test("房间管理按有效性与权限显示操作，关闭入口可访问且不展示额外失效或战绩说明", () => {
  for (const available of [true, false]) for (const isHost of [true, false]) for (const canLeave of [true, false, undefined]) {
    const roomMenu = { code: "273843", boardName: "阿瓦隆 · 十二骑士", statusLabel: "已结束", available, isHost, isMember: true, canLeave };
    const tree = render({ ...base, roomMenu });
    const dialog = nodes(tree).find(n => n.attr?.class?.includes("room-menu-dialog"));
    const text = JSON.stringify(dialog);
    const kinds = nodes(dialog).filter(n => n.attr?.bindtap === "roomMenuAction").map(n => n.attr["data-kind"]);
    assert.deepEqual(kinds, ["hide", ...(available && canLeave === true ? ["leave"] : []), ...(available && isHost ? ["delete"] : [])]);
    assert.ok(text.includes(available ? "从列表移除" : "移除失效记录"));
    assert.ok(text.includes(available ? "已结束" : "已失效"));
    assert.doesNotMatch(text, /连续.*3.*天|战绩与复盘|当前状态暂不可离开|离开权限暂未同步/);
    const closers = nodes(dialog).filter(n => n.attr?.bindtap === "closeRoomMenu");
    assert.equal(closers.length, 2);
    assert.equal(closers[0].attr.ariaLabel, "关闭房间管理");
    const locked = render({ ...base, roomMenu, busy: true });
    assert.ok(nodes(locked).filter(n => ["roomMenuAction", "closeRoomMenu"].includes(n.attr?.bindtap)).every(n => n.attr.disabled));
  }
  const guest = render({ ...base, roomMenu: { code: "273843", available: true, isMember: false, canLeave: true } });
  assert.ok(!nodes(guest).some(n => n.attr?.["data-kind"] === "leave"));
});

test("业务错误居中弹窗只提供关闭，连接错误才提供重试", () => {
  const tree = render({ ...base, error: "阶段尚未完成" });
  assert.ok(nodes(tree).some((n) => n.attr?.role === "dialog"));
  assert.ok(byHandler(tree, "dismissError"));
  assert.equal(byHandler(tree, "retry"), undefined);
  const recovery = render({
    ...base,
    error: "连接中断",
    recoverableError: true,
    hasPendingRequest: true,
  });
  assert.ok(byHandler(recovery, "retry"));
  assert.equal(byHandler(recovery, "returnHome"), undefined);
});

test("房间设置仅房主可见，普通玩家仍可准备和复制房间号", () => {
  const room = {
    code: "123456",
    phase: "lobby",
    players: [],
    me: { isHost: false, seat: 2, avoidance: { balance: 0, selected: false } },
  };
  const guest = render({ ...base, room, showRoomSettings: true });
  assert.equal(byHandler(guest, "toggleRoomSettings"), undefined);
  assert.equal(
    nodes(guest).some((n) => n.attr?.bindchange === "configureCapacity"),
    false,
  );
  assert.equal(byHandler(guest, "start"), undefined);
  assert.ok(byHandler(guest, "ready"));
  assert.ok(byHandler(guest, "copyRoomCode"));
  const footer = nodes(guest).find(n => n.attr?.class === "lobby-action-bar");
  assert.ok(byHandler(footer, "ready"));
  assert.ok(byHandler(footer, "openAvoidance"));
  const row = nodes(footer).find(n => n.attr?.class === 'lobby-action-inner');
  assert.equal(row.children[0].attr.bindtap, 'openAvoidance');
  assert.equal(byHandler(row, 'openAvoidance').attr.disabled, false);
  assert.deepEqual(Array.from(byHandler(guest, "ready").children), ["准备"]);
  for (const blocked of [{ network: false }, { busy: true }, { hasPendingRequest: true }]) {
    assert.equal(byHandler(render({ ...base, room, ...blocked }), "ready").attr.disabled, true);
  }
  const prepared = render({ ...base, room: { ...room, me: { ...room.me, ready: true } } });
  assert.deepEqual(Array.from(byHandler(prepared, "ready").children), ["取消准备"]);
  const spectator = render({ ...base, room: { ...room, me: { ...room.me, seat: null } } });
  assert.equal(byHandler(spectator, "ready"), undefined);
  assert.ok(byHandler(spectator, "leave"));
  const host = render({
    ...base,
    room: { ...room, me: { isHost: true, seat: 1, avoidance: { balance: 1, selected: true } } },
    showRoomSettings: true,
  });
  assert.ok(byHandler(host, "toggleRoomSettings"));
  const hostRow = nodes(host).find(n => n.attr?.class === 'lobby-action-inner');
  assert.ok(byHandler(hostRow, 'openAvoidance')); assert.ok(byHandler(hostRow, 'ready')); assert.ok(byHandler(hostRow, 'start'));
  assert.ok(
    !nodes(host).some((n) => n.attr?.bindchange === "configureCapacity"),
  );
});

test("说明仅列阵营角色，房间内玩家可打开当前配置弹窗", () => {
  const { BOARDS } = require("../server/engine");
  const roles = BOARDS[0].roleConfigurations[6];
  const home = render({
    ...base,
    entryMode: "create",
    entrySheet: true,
    showRules: true,
    boardRoleConfiguration: roles,
    boardDescription: "不应显示的玩法描述",
  });
  assert.ok(JSON.stringify(home).includes("梅林，派西维尔，忠臣×2"));
  assert.ok(!JSON.stringify(home).includes("不应显示的玩法描述"));
  const room = {
    phase: "lobby",
    me: { isHost: false },
    roleConfiguration: roles,
  };
  assert.ok(byHandler(render({ ...base, room }), "openRoomRules"));
  assert.equal(
    byHandler(render({ ...base, room }), "closeRoomRules"),
    undefined,
  );
  const open = render({ ...base, room, showRoomRules: true });
  assert.ok(byHandler(open, "closeRoomRules"));
  assert.ok(JSON.stringify(open).includes("莫甘娜，刺客"));
});

test("投票和私密操作只在弹窗显示，已提交后弹窗消失且入口显示完成", () => {
  const room = {
    code: "123456",
    phase: "teamVote",
    team: [],
    me: { submitted: false },
    needsSubmission: true,
  };
  const data = {
    ...base,
    room,
    actionDialog: true,
    actionLabel: "是否同意",
    actionChoices: [
      { value: "approve", label: "赞成" },
      { value: "reject", label: "反对" },
    ],
    secret: { role: "测试私密身份", information: "不可见" },
  };
  const open = render(data);
  assert.ok(byHandler(open, "submitChoice"));
  assert.ok(byHandler(open, "closeAction"));
  assert.ok(!JSON.stringify(open).includes("测试私密身份"));
  const closed = render({ ...data, actionDialog: false });
  assert.equal(byHandler(closed, "submitChoice"), undefined);
  assert.ok(byHandler(closed, "openAction"));
  const done = render({ ...data, room: { ...room, me: { submitted: true } } });
  assert.equal(byHandler(done, "submitChoice"), undefined);
  assert.equal(byHandler(done, "openAction"), undefined);
  assert.ok(JSON.stringify(done).includes("已提交，等待其他玩家"));
});

test("房主工具入口覆盖任意发牌后阶段，普通玩家不能看见管理入口", () => {
  for (const phase of [
    "tools",
    "identity",
    "teamVote",
    "quest",
    "assassination",
  ]) {
    const room = {
      phase,
      flexible: true,
      canUseTools: true,
      hasActiveOperation: phase !== "tools",
      knifeOffline: false,
      hasReverse: true,
      team: [],
      me: { isHost: true },
    };
    const host = render({ ...base, room });
    assert.equal(
      nodes(host).filter((n) => n.attr?.bindtap === "openTool").length,
      3,
    );
    assert.equal(byHandler(host, "advance"), undefined);
    assert.ok(byHandler(host, "finishTools"));
    const guest = render({
      ...base,
      room: { ...room, canUseTools: false, me: { isHost: false } },
    });
    assert.equal(byHandler(guest, "openTool"), undefined);
    assert.equal(byHandler(guest, "finishTools"), undefined);
  }
  const room = {
    phase: "tools",
    flexible: true,
    canUseTools: true,
    team: [],
    me: { isHost: true },
  };
  const dialog = render({
    ...base,
    room,
    toolType: "quest",
    toolSeats: [],
    toolThreshold: 1,
    toolPlayers: [{ seat: 1, name: "甲" }],
  });
  assert.ok(byHandler(dialog, "toggleToolSeat"));
  assert.equal(byHandler(dialog, "launchTool").attr.disabled, true);
});

test("身份默认只显示一行入口，进度仅房主可见，结束按钮位于记录之后", () => {
  const room = {
    phase: "teamVote",
    canUseTools: true,
    hasActiveOperation: true,
    team: [1],
    me: { isHost: true },
    operationProgress: {
      total: 2,
      completed: 1,
      players: [
        { seat: 1, name: "甲", required: true, completed: true },
        { seat: 2, name: "乙", required: true, completed: false },
        { seat: 3, name: "丙", required: false, completed: false },
      ],
    },
  };
  const tree = render({
    ...base,
    room,
    operationProgressExpanded: true,
    history: [{ key: 0, text: "已有记录", detail: "已结算" }],
    secret: { role: "测试私密角色", information: "隐私" },
  });
  const serialized = JSON.stringify(tree);
  assert.ok(!serialized.includes("身份已遮盖"));
  assert.ok(!serialized.includes("测试私密角色"));
  assert.ok(byHandler(tree, "reveal"));
  assert.ok(serialized.includes("未完成"));
  assert.ok(!serialized.includes("无需操作"));
  assert.ok(!serialized.includes("丙"));
  const collapsed = render({ ...base, room, operationProgressExpanded: false });
  assert.ok(byHandler(collapsed, "toggleOperationProgress"));
  assert.equal(nodes(collapsed).filter(n => n.attr?.class === "progress-player").length, 0);
  assert.match(JSON.stringify(byHandler(collapsed, "toggleOperationProgress")), /展开/);
  assert.match(JSON.stringify(byHandler(tree, "toggleOperationProgress")), /收起/);
  const all = nodes(tree);
  const footerIndex = all.findIndex((n) => n.attr?.bindtap === "finishTools");
  assert.ok(
    footerIndex > all.findIndex((n) => n.attr?.class === "table-dynamics operation-first"),
  );
  const guest = render({
    ...base,
    room: {
      ...room,
      canUseTools: false,
      operationProgress: null,
      me: { isHost: false },
    },
  });
  assert.ok(!JSON.stringify(guest).includes("当前操作进度"));
});

test("发身份弹窗默认隐藏，展开后在确认按钮前展示身份和视角", () => {
  const data = {
    ...base,
    room: {
      phase: "identity",
      needsSubmission: true,
      me: { submitted: false },
    },
    actionDialog: true,
    actionChoices: [{ value: "confirm", label: "确认" }],
  };
  const hidden = render(data);
  assert.ok(byHandler(hidden, "revealActionIdentity"));
  const shown = render({
    ...data,
    actionSecret: { role: "梅林", faction: "好人阵营", information: "坏人2号" },
  });
  const text = JSON.stringify(shown);
  assert.ok(text.includes("梅林"));
  assert.ok(text.includes("好人阵营"));
  assert.ok(text.includes("坏人2号"));
  assert.ok(text.includes("立即遮盖"));
  assert.ok(text.indexOf("坏人2号") < text.indexOf("submitChoice"));
  assert.ok(!JSON.stringify(hidden).includes("坏人2号"));
  const closed = render({
    ...data,
    actionDialog: false,
    actionSecret: { role: "梅林" },
  });
  assert.ok(!JSON.stringify(closed).includes("梅林"));
  const vote = render({ ...data, room: { ...data.room, phase: "teamVote" } });
  assert.equal(byHandler(vote, "revealActionIdentity"), undefined);
});

test("十二骑士不提供主动先知查验和刀梅林入口，新身份提醒默认遮盖，主动查看才显示新牌", () => {
  const room = {
    phase: "tools",
    canUseTools: true,
    knights: { round: 2 },
    team: [],
    me: { isHost: true },
  };
  const tree = render({ ...base, room });
  const kinds = nodes(tree)
    .filter((n) => n.attr?.bindtap === "openTool")
    .map((n) => n.attr["data-kind"]);
  assert.ok(!kinds.includes("assassination"));
  assert.ok(!kinds.includes("offline"));
  assert.ok(!kinds.includes("night"));
  assert.ok(!kinds.includes("nextRound"));
  const popupData = {
    ...base,
    room,
    identityChange: {
      role: "石像鬼",
      faction: "坏人阵营",
      information: "没有视野。",
    },
  };
  const hidden = render(popupData);
  for (const value of ["石像鬼", "坏人阵营", "没有视野。"])
    assert.ok(!JSON.stringify(hidden).includes(value));
  assert.ok(byHandler(hidden, "revealChangedIdentity"));
  assert.ok(!byHandler(hidden, "acknowledgeIdentity"));
  const popup = render({ ...popupData, identityChangeRevealed: true });
  assert.ok(JSON.stringify(popup).includes("石像鬼"));
  assert.ok(byHandler(popup, "acknowledgeIdentity"));
});

test("技能过程开关仅房主可见，默认不可见", () => {
  const room = {
    phase: "tools",
    board: "knights",
    canUseTools: true,
    knights: { round: 1 },
    showSkillDetails: false,
    team: [],
    me: { isHost: true },
  };
  assert.equal(
    byHandler(render({ ...base, room }), "toggleSkillVisibility"),
    undefined,
  );
  const tree = render({ ...base, room, showRoomSettings: true });
  assert.equal(byHandler(tree, "toggleSkillVisibility"), undefined);
  assert.ok(byHandler(tree, "toggleRoomSettings"));
  const guest = render({
    ...base,
    room: { ...room, canUseTools: false, me: { isHost: false } },
  });
  assert.equal(byHandler(guest, "toggleSkillVisibility"), undefined);
});

test("独立设置页使用原生开关自动保存，仅失败时显示重试", () => {
  const settingsRender = factory("pages/settings/settings.wxml");
  const data = {
    loading: false,
    authorized: true,
    busy: false,
    room: {
      code: "123456",
      boardName: "十二骑士",
      capacity: 12,
      phase: "tools",
    },
    boardId: "knights",
    visible: false,
    dirty: false,
    pendingTransfer: false,
    pendingKick: false,
  };
  const tree = settingsRender(data);
  assert.ok(
    nodes(tree).some(
      (n) => n.tag === "wx-switch" && n.attr.bindchange === "toggleVisibility",
    ),
  );
  assert.equal(byHandler(tree, "save"), undefined);
  assert.ok(!JSON.stringify(tree).includes("7人局默认关闭"));
  assert.ok(!JSON.stringify(tree).includes("开启后公开出手人"));
  const dirty = settingsRender({ ...data, dirty: true, error: "网络错误" });
  assert.equal(byHandler(dirty, "save").attr.disabled, false);
  assert.equal(
    byHandler(settingsRender({ ...data, authorized: false }), "save"),
    undefined,
  );
  assert.ok(!nodes(tree).some((n) => n.attr?.bindchange === "pickCapacity"));
});

test("仙女目标弹窗禁用不合法座位，未选目标不能确认，传递提示与选中目标一致", () => {
  const data = { ...base, room: { phase: "fairy", needsSubmission: true, me: { submitted: false }, team: [] },
    actionDialog: true, stagedChoice: true, skillAction: true, skillTargetMode: "fairy", skillTitle: "仙女查验", skillHint: "查验并传递",
    skillTargetMeta: "第 2 轮 · 2 号持有仙女", skillBodyHeight: 264, skillTargetCaption: "结果仅你可见", skillEligibility: "历任持有者不可选",
    skillTargets: [{ value: "target:3", label: "查验 3号", seat: 3, name: "玩家三" }, { value: "disabled:2", label: "2号", seat: 2, name: "玩家二", disabledReason: "你 · 当前持有者" }],
    skillOtherChoices: [], swapOptions: [], swapPlayers: [], swapSeats: [], draftChoice: "", skillSummary: "尚未选择目标", skillConfirmLabel: "请先选择目标", skillConsequence: "确认提交后不可更改" };
  let tree = render(data);
  assert.equal(byHandler(tree, "confirmChoice").attr.disabled, true);
  assert.ok(nodes(tree).find(n => n.attr?.class?.includes("skill-option-unavailable")).attr.disabled);
  assert.equal(nodes(tree).filter(n => n.attr?.class === "skill-other-choices").length, 0);
  tree = render({ ...data, draftChoice: "target:3", skillSummary: "查验目标：3 号 · 玩家三", skillConfirmLabel: "确认查验 3 号", skillConsequence: "仙女将传给 3 号 · 确认后不可更改" });
  assert.equal(byHandler(tree, "confirmChoice").attr.disabled, false);
  assert.match(JSON.stringify(tree), /仙女将传给 3 号/);
  assert.match(JSON.stringify(tree), /查验目标：3 号 · 玩家三/);
});

test("仙女结果弹窗默认不渲染目标与阵营，点击查看后才显示", () => {
  const data = {
    ...base,
    fairyResult: { revision: 1, information: "4号查验结果：坏人" },
  };
  const hidden = render(data);
  assert.ok(!JSON.stringify(hidden).includes("4号查验结果：坏人"));
  assert.ok(byHandler(hidden, "revealFairyResult"));
  assert.ok(!byHandler(hidden, "acknowledgeFairyResult"));
  const shown = render({ ...data, fairyResultRevealed: true });
  assert.ok(JSON.stringify(shown).includes("4号查验结果：坏人"));
  assert.ok(byHandler(shown, "acknowledgeFairyResult"));
  assert.ok(byHandler(shown, "hidePrivatePreview"));
});
test('新身份的派生插画、能力说明及结构化查验结果均受主动查看保护，确认在滚动区之外', () => {
  const {presentPrivateIdentity,presentFairyResult}=require('../miniprogram/room-sheet-presentation');
  const identity=presentPrivateIdentity({role:'红猎人',faction:'坏人阵营',information:'没有视野。 私密角色能力说明。',skillStatus:{title:'尚未启用',detail:'下一轮可用。'}},'evil');
  const data={...base,room:{phase:'tools',code:'123456',team:[],me:{seat:1}},identityChange:identity};
  assert.doesNotMatch(JSON.stringify(render(data)),/hunter\.png|红猎人|私密角色能力说明/);
  const shown=render({...data,identityChangeRevealed:true});
  assert.match(JSON.stringify(shown),/hunter\.png|私密角色能力说明/);
  const body=nodes(shown).find(n=>n.attr?.class==='process-sheet-body');
  assert.equal(byHandler(body,'acknowledgeIdentity'),undefined);
  assert.ok(byHandler(shown,'acknowledgeIdentity'));assert.ok(byHandler(shown,'hidePrivatePreview'));
  const fairy={...data,identityChange:null,fairyResult:presentFairyResult({revision:1,summary:'7号 · 盗贼阵营'})};
  assert.doesNotMatch(JSON.stringify(render(fairy)),/盗贼阵营|process-shield-third/);
  const result=render({...fairy,fairyResultRevealed:true});
  assert.match(JSON.stringify(result),/盗贼阵营|process-shield-third/);
  assert.equal(byHandler(nodes(result).find(n=>n.attr?.class==='process-sheet-body'),'acknowledgeFairyResult'),undefined);
});

test("拓展板子不显示线下辅助提示，身份确认使用线上视野文案", () => {
  const tree = render({
    ...base,
    boardAssisted: true,
    room: {
      assisted: true,
      phase: "identity",
      me: { isHost: false },
      players: [],
    },
    actionDialog: true,
    actionChoices: [{ value: "confirm", label: "确认" }],
  });
  const text = JSON.stringify(tree);
  assert.ok(!text.includes("线下辅助"));
  assert.ok(!text.includes("互认、起刀与最终胜负在线下完成"));
  assert.ok(!text.includes("已完成互认，确认"));
});

test("换号显示12个座位而非66个组合，投票需要单独确认", () => {
  const room = { phase: "skillPrepare", needsSubmission: true, me: { submitted: false }, team: [] };
  const swapPlayers = Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, name: "玩家", selected: i < 2 }));
  const tree = render({ ...base, room, actionDialog: true, swapOptions: ["swap:1:2"], swapPlayers, swapSeats: [1, 2], actionChoices: [{ value: "pass", label: "不使用技能" }] });
  assert.equal(nodes(tree).filter((n) => n.attr?.bindtap === "toggleSwapSeat").length, 12);
  assert.equal(byHandler(tree, "confirmSwap").attr.disabled, false);
  const vote = { ...base, room: { ...room, phase: "teamVote" }, actionDialog: true, stagedChoice: true, actionChoices: [{ value: "approve", label: "赞成" }] };
  assert.equal(byHandler(render(vote), "confirmChoice").attr.disabled, true);
  assert.equal(byHandler(render({ ...vote, draftChoice: "approve", draftLabel: "赞成" }), "confirmChoice").attr.disabled, false);
});

test("房主开局与结算按钮未满足条件时禁用并展示等待人数", () => {
  const room = { phase: "lobby", me: { isHost: true }, team: [] };
  assert.equal(byHandler(render({ ...base, room, canStart: false, startHint: "还差 2 人准备" }), "start").attr.disabled, true);
  assert.equal(byHandler(render({ ...base, room, canStart: true }), "start").attr.disabled, false);
  const playing = { ...room, phase: "quest", canUseTools: true, hasActiveOperation: true };
  const waiting = render({ ...base, room: playing, canSettle: false, settleHint: "还差 2 人提交" });
  assert.equal(byHandler(waiting, "settleTool").attr.disabled, true);
  assert.ok(JSON.stringify(waiting).includes("还差 2 人提交"));
  assert.equal(byHandler(render({ ...base, room: playing, canSettle: true }), "settleTool").attr.disabled, false);
});

test("移交入口仅在管理员设置页显示，玩家列表按需弹出", () => {
  const renderSettings = factory("pages/settings/settings.wxml");
  for (const phase of ["lobby", "tools", "ended"]) {
    const data = { loading: false, authorized: true, busy: false, pendingSave: false, pendingTransfer: false, room: { phase }, transferPlayers: [{ seat: 2, name: "乙" }] };
    const closed = renderSettings(data);
    const button = byHandler(closed, "openTransfer");
    assert.ok(button);
    assert.equal(button.attr.disabled, false);
    assert.equal(byHandler(closed, "transfer"), undefined);
    const opened = renderSettings({ ...data, showTransferPicker: true });
    assert.ok(byHandler(opened, "transfer"));
    assert.ok(byHandler(opened, "closeTransfer"));
    assert.equal(byHandler(renderSettings({ ...data, authorized: false }), "openTransfer"), undefined);
    assert.equal(byHandler(renderSettings({ ...data, pendingTransfer: true }), "openTransfer").attr.disabled, true);
    assert.equal(byHandler(renderSettings({ ...data, transferPlayers: [] }), "openTransfer").attr.disabled, true);
  }
});

test("自动结算牌桌展示个人状态和持久结果，房主可结束等待而不需点结算", () => {
  const room = {
    phase: "quest", flexible: true, canUseTools: true, hasActiveOperation: true,
    closeWaiting: { mode: "cancel" },
    operationStatus: { title: "本次你无需操作", detail: "参与者全部提交后自动结算" },
    needsSubmission: false, team: [2, 3], me: { isHost: true, submitted: false },
  };
  const data = { ...base, room, settleHint: "还差 1 人提交", latestResult: { text: "投票通过 · 提前截止", detail: "4票赞成\n2票弃权" } };
  const tree = render(data);
  assert.equal(byHandler(tree, "settleTool"), undefined);
  assert.equal(byHandler(tree, "cancelTool"), undefined);
  assert.equal(byHandler(tree, "openAction"), undefined);
  assert.equal(byHandler(tree, "closeWaiting").attr.disabled, false);
  assert.ok(JSON.stringify(tree).includes("本次你无需操作"));
  assert.ok(!JSON.stringify(tree).includes("2票弃权"));
  const waiting = render({ ...data, room: { ...room, phase: "tools" } });
  assert.ok(JSON.stringify(waiting).includes("2票弃权"));
  assert.equal(byHandler(render({ ...data, network: false }), "closeWaiting").attr.disabled, true);
  const submitted = render({ ...data, room: { ...room, canUseTools: false, closeWaiting: null, needsSubmission: true, me: { submitted: true }, operationStatus: { title: "已提交，等待其他玩家" } } });
  assert.equal(byHandler(submitted, "closeWaiting"), undefined);
  assert.equal(byHandler(submitted, "openAction"), undefined);
  assert.ok(JSON.stringify(submitted).includes("已提交，等待其他玩家"));
});

test("房间设置仅在可移出阶段开放成员选择，对局中说明原因，待确认请求可重试", () => {
  const renderSettings = factory("pages/settings/settings.wxml");
  const data = { loading: false, authorized: true, room: { phase: "lobby", canKick: true }, transferPlayers: [{ seat: 2, name: "玩家2" }] };
  assert.equal(byHandler(renderSettings(data), "openKick").attr.disabled, false);
  const playing = renderSettings({ ...data, room: { phase: "tools", canKick: false } });
  assert.equal(byHandler(playing, "openKick").attr.disabled, true);
  assert.ok(JSON.stringify(playing).includes("对局进行中不能移出玩家"));
  const legacy = renderSettings({ ...data, room: { phase: "lobby" } });
  assert.equal(byHandler(legacy, "openKick").attr.disabled, true);
  assert.ok(JSON.stringify(legacy).includes("暂不支持移出玩家"));
  assert.ok(!JSON.stringify(legacy).includes("对局进行中不能移出玩家"));
  const picker = renderSettings({ ...data, showKickPicker: true });
  assert.equal(byHandler(picker, "kick").attr["data-seat"], 2);
  assert.ok(byHandler(picker, "closeKick"));
  const pending = renderSettings({ ...data, pendingKick: true });
  assert.equal(byHandler(pending, "openKick").attr.disabled, true);
  assert.equal(byHandler(pending, "openTransfer").attr.disabled, true);
  assert.ok(byHandler(pending, "sendKick"));
  assert.equal(byHandler(renderSettings({ ...data, authorized: false }), "openKick"), undefined);
});

test("创建页提供板子详情入口，目录采用文字链接", () => {
  const tree = render({ ...base, entryMode: "create", entrySheet: true, availableBoards: [{ id: "classic", name: "经典" }] });
  assert.ok(byHandler(tree, "openBoardDetails"));
  const board = require('../miniprogram/board-detail').presentBoard({ name: '测试板子', detail: { sections: [{ title: '规则说明', kind: 'lines', items: ['完整规则'] }] } }, 12);
  const detail = factory("pages/board-details/board-details.wxml")({ loading: false, board, tab: 'rules', directoryExpanded: true, chapters: board.chapters });
  const link = byHandler(detail, "jumpSection");
  assert.equal(link.tag, "wx-view");
  assert.equal(link.attr.role, "link");
  assert.ok(JSON.stringify(detail).includes("返回"));
});

test("等待确认时禁用写入入口但允许遮盖身份，房主工具位于座位之前", () => {
  const room = { phase: "tools", code: "123456", capacity: 6, canUseTools: true, flexible: true, me: { seat: 1, isHost: true }, team: [] };
  const tree = render({ ...base, room, hasPendingRequest: true, busy: true, network: false, revealed: true, secret: { role: "梅林" } });
  assert.equal(byHandler(tree, "openTool").attr.disabled, true);
  assert.equal(byHandler(tree, "finishTools").attr.disabled, true);
  assert.ok(!byHandler(tree, "reveal").attr.disabled);
  const flat = nodes(tree);
  assert.ok(flat.indexOf(byHandler(tree, "openTool")) < flat.findIndex(n => n.attr?.class === "seats"));
});

test("普通玩家座位公开湖仙标记且随传递移动；关闭后无标记和查验入口", () => {
  const room = { phase: "tools", code: "123456", capacity: 8, flexible: true,
    me: { seat: 2, isHost: false }, fairyEnabled: true, fairyHolder: 1, team: [] };
  const seats = [1, 2].map(seat => ({ seat, name: `玩家${seat}`, occupied: true }));
  for (const holder of [1, 2, null]) {
    const tree = render({ ...base, room: { ...room, fairyHolder: holder }, seats });
    const marked = nodes(tree).filter(n => n.attr?.bindtap === "seat" && JSON.stringify(n).includes('seat-fairy'));
    assert.deepEqual(marked.map(n => n.attr["data-seat"]), holder ? [holder] : []);
    if (holder) {
      const icon = nodes(marked[0]).find(n => n.attr?.class === "seat-fairy-icon");
      assert.equal(icon.attr.src, "/assets/lake-fairy.svg");
      assert.ok(require("node:fs").existsSync(path.join(root, icon.attr.src)));
      assert.match(marked[0].attr.ariaLabel, /湖中仙女持有者/);
      assert.ok(!nodes(marked[0]).some(n => n.tag === "wx-text" && n.children.includes("湖仙")));
    }
  }
  const host = { ...room, canUseTools: true, me: { isHost: true }, fairyEnabled: false, fairyHolder: null };
  const disabled = render({ ...base, room: host, seats });
  assert.ok(!nodes(disabled).some(n => n.attr?.["data-kind"] === "fairy"));
  const enabled = render({ ...base, room: { ...host, fairyEnabled: true }, seats });
  assert.ok(nodes(enabled).some(n => n.attr?.["data-kind"] === "fairy"));
});

test("湖仙设置所有板子可见，5/6人及查验进行中禁用开关", () => {
  const settingsRender = factory("pages/settings/settings.wxml");
  for (const capacity of [5, 6, 7, 8, 12]) {
    for (const phase of ["lobby", "tools", "fairy"]) {
      const tree = settingsRender({ loading: false, authorized: true, capacity, boardId: "classic",
        room: { phase }, fairyEnabled: capacity >= 8 });
      const toggle = nodes(tree).find(n => n.attr?.bindchange === "toggleFairy");
      assert.ok(toggle);
      assert.equal(toggle.attr.disabled, capacity < 7 || phase === "fairy");
      assert.equal(toggle.attr.checked, capacity >= 8);
    }
  }
});

test("结果卡和表决展示队伍，座位可折叠，公开记录入口固定且不会挤掉待办", () => {
  const entry = { key: 3, text: "投票通过", resultTone: "success", resultTeam: "1、4号", latestDetail: "2票赞成", timeLabel: "23:38", recordLabel: "记录 4" };
  const data = { ...base, room: { phase: "teamVote", team: [1, 4], me: { submitted: false }, needsSubmission: true }, teamText: "1、4", actionDialog: true, seatsExpanded: false, latestResult: entry, history: [entry, entry, entry, entry], visibleHistory: [entry], questTimeline: [{ key: 1, number: 2, text: "任务成功", questResult: "success" }] };
  const tree = render(data);
  const text = JSON.stringify(tree);
  assert.ok(text.includes("任务队伍：1、4号"));
  assert.match(JSON.stringify(byHandler(tree, "openHistory")), /共4条/);
  assert.ok(text.includes("第2次"));
  assert.ok(!text.includes("最近三条"));
  assert.ok(!nodes(tree).some(n => n.attr?.class === "seats"));
  assert.ok(byHandler(tree, "toggleSeats"));
  assert.ok(byHandler(tree, "openHistory"));
  assert.equal(nodes(tree).filter(n => n.attr?.id?.startsWith("history-record-")).length, 0);
});

test("查验结果突出座位阵营，可临时遮盖且仅有一个永久关闭入口", () => {
  const tree = render({ ...base, fairyResult: { revision: 1, information: "6号查验结果：坏人（第1轮）", summary: "6号 · 坏人" }, fairyResultRevealed: true });
  const text = JSON.stringify(tree);
  assert.ok(text.includes("6号 · 坏人"));
  assert.ok(!text.includes("第1轮"));
  assert.ok(byHandler(tree, "hidePrivatePreview"));
  assert.equal(nodes(tree).filter(n => n.attr?.bindtap === "acknowledgeFairyResult").length, 1);
  assert.ok(byHandler(tree, "acknowledgeFairyResult"));
});

test("牌桌阶段集中待办、结果可回看，任务进度与座位明确分区", () => {
  const room = { phase: "tools", phaseName: "等待房主发起操作", flexible: true, capacity: 12, me: { seat: 1 }, team: [] };
  const data = { ...base, room, seatsExpanded: false, questSummary: { total: 1, success: 1, failure: 0 }, questTimeline: [{ key: 1, number: 1, questResult: "success" }], latestResult: { text: "任务成功", detail: "成功1张" } };
  const tree = render(data), text = JSON.stringify(tree);
  assert.equal((text.match(/等待房主发起操作/g) || []).length, 1);
  assert.ok(byHandler(tree, "showLatestRecord"));
  const progress = nodes(tree).find(n => n.attr?.class === "task-progress");
  assert.ok(JSON.stringify(progress).includes("任务进度"));
  assert.ok(byHandler(progress, "toggleSeats"));
  assert.ok(byHandler(progress, "showQuestRecord"));
  assert.ok(!text.includes("我在1号"));
  assert.ok(!text.includes("本阶段你无需操作"));
  const located = render({ ...data, historyOpen: true, focusedHistoryKey: 0, visibleHistory: [{ key: 0, text: "任务成功" }] });
  const record = nodes(located).find(n => n.attr?.id === "history-record-0");
  assert.match(record.attr.class, /public-history-row is-focused/);
  const pending = render({ ...data, room: { ...room, phase: "quest", needsSubmission: true }, actionEntryLabel: "提交任务牌" });
  const phase = nodes(pending).find(n => n.attr?.class === "phase-strip");
  assert.ok(byHandler(phase, "openAction"));
  assert.equal(byHandler(phase, "openAction").attr.class, "primary");
});

test('公开记录抽屉独立滚动，保留最近结果卡和房主按钮，私密弹窗优先', () => {
  const historyUI = require('../miniprogram/public-history');
  const record = { key: 4, category: 'vote', text: '投票通过', resultTone: 'success', timeLabel: '16:32',
    latestDetail: '2票赞成', teamLabel: '1、12 号', voteGroups: [{ label: '赞成', count: 2, tone: 'approve', seats: '1、12 号' }] };
  const data = { ...base, ...historyUI.initialData(), room: { phase: 'tools', capacity: 12, team: [], me: { seat: 1 }, canUseTools: true },
    history: [record], historyLatest: record, latestResult: record };
  const closed = render(data), openedData = { ...data, ...historyUI.open(data, 4) }, opened = render(openedData);
  const meta = nodes(opened).find(n => n.attr?.class === 'public-history-meta');
  assert.match(JSON.stringify(meta), /16:32/);
  assert.doesNotMatch(JSON.stringify(meta), /#/);
  assert.equal(nodes(opened).filter(n => n.attr?.class === 'public-history-latest-mark').length, 1);
  assert.equal(nodes(opened).filter(n => n.attr?.class === 'public-history-team-seat').length, 2);
  const result = tree => nodes(tree).find(n => n.attr?.class === 'latest-result');
  assert.deepEqual(result(opened), result(closed));
  assert.ok(byHandler(opened, 'showLatestRecord'));
  assert.ok(byHandler(opened, 'finishTools'));
  assert.ok(byHandler(opened, 'closeHistory'));
  assert.ok(!byHandler(opened, 'toggleHistoryFullscreen'));
  assert.ok(!JSON.stringify(opened).includes('全屏'));
  assert.equal(nodes(opened).filter(n => n.attr?.bindtap === 'openHistory').length, 1);
  assert.ok(nodes(opened).find(n => n.tag === 'wx-scroll-view' && n.attr?.class === 'public-history-body'));
  assert.equal(nodes(opened).filter(n => n.attr?.class === 'public-history-seat').length, 2);
  assert.ok(!byHandler(render({ ...openedData, dealtIdentityDialog: true }), 'closeHistory'));
  const host = render({ ...data, room: { ...data.room, phase: 'teamVote', hasActiveOperation: true } });
  const dock = nodes(host).find(n => n.attr?.class?.includes('public-history-dock'));
  assert.ok(byHandler(dock, 'openHistory'));
  assert.ok(byHandler(dock, 'settleTool'));
  assert.ok(byHandler(dock, 'cancelTool'));
});

test('任务和投票收起仅显示摘要，展开后完整展示队伍票数，所有记录保留时间与箭头列', () => {
  const historyUI = require('../miniprogram/public-history');
  const history = [
    { key: 0, category: 'quest', text: '任务成功', timeLabel: '15:50', teamLabel: '2、4、6 号', cards: [{ label: '成功', count: 3, tone: 'success' }], thresholdLabel: '至少 1 张失败票才失败' },
    { key: 1, category: 'vote', text: '投票通过', timeLabel: '15:51', teamLabel: '10、12 号', voteGroups: [{ label: '赞成', count: 2, tone: 'approve', seats: '10、12 号' }] },
    { key: 2, category: 'other', text: '本轮不转换', timeLabel: '15:52' },
  ];
  const state = { ...base, ...historyUI.initialData(), room: { phase: 'tools', capacity: 12, team: [], me: { seat: 1 } }, history };
  Object.assign(state, historyUI.open(state));
  const records = tree => nodes(tree).filter(n => n.attr?.id?.startsWith('history-record-'));
  const collapsed = records(render(state));
  assert.equal(collapsed.length, 3);
  for (const record of collapsed) {
    const children = nodes(record);
    assert.equal(children.filter(n => n.attr?.class === 'public-history-meta').length, 1);
    assert.equal(children.filter(n => n.attr?.class === 'public-history-chevron-slot').length, 1);
    assert.ok(!children.some(n => ['public-history-details', 'public-history-team', 'public-history-counts'].includes(n.attr?.class)));
  }
  for (const key of [0, 1]) {
    Object.assign(state, historyUI.toggleRow(state, key));
    const record = records(render(state)).find(n => n.attr.id === `history-record-${key}`);
    const summary = nodes(record).find(n => n.attr?.class === 'public-history-summary');
    const details = nodes(record).find(n => n.attr?.class === 'public-history-details');
    assert.equal(state.visibleHistory.find(row => row.key === key).expanded, true);
    assert.equal(byHandler(record, 'toggleHistoryRow').attr.ariaExpanded, true);
    assert.ok(!nodes(summary).some(n => ['public-history-team', 'public-history-counts'].includes(n.attr?.class)));
    assert.ok(nodes(details).some(n => n.attr?.class === 'public-history-team'));
    assert.ok(nodes(details).some(n => n.attr?.class === 'public-history-counts'));
    assert.match(JSON.stringify(details), key === 0 ? /至少 1 张失败票才失败/ : /2票赞成/);
    Object.assign(state, historyUI.toggleRow(state, key));
    assert.ok(!nodes(records(render(state)).find(n => n.attr.id === `history-record-${key}`)).some(n => n.attr?.class === 'public-history-details'));
  }
});


test("查验座位在公开记录收起时和最近结果中直接可见", () => {
  const historyUI = require('../miniprogram/public-history');
  const label = '10号查验了12号';
  const record = { key: 0, category: 'other', text: '仙女查验已完成', inspectionLabel: label, latestDetail: label };
  const data = { ...base, ...historyUI.initialData(), room: { phase: 'tools', capacity: 12, team: [], me: { seat: 1 } },
    history: [record], latestResult: record, historyLatest: record };
  const opened = { ...data, ...historyUI.open(data), historyExpandedRows: {} };
  Object.assign(opened, historyUI.sync(opened, opened.history, opened.room));
  const tree = render(opened);
  const summary = nodes(tree).find(n => n.attr?.class === 'public-history-inspection');
  assert.match(JSON.stringify(summary), /10号查验了12号/);
  const latest = nodes(tree).find(n => n.attr?.class === 'latest-result');
  assert.match(JSON.stringify(latest), /仙女查验已完成/);
  assert.match(JSON.stringify(latest), /10号查验了12号/);
  assert.ok(!nodes(tree).some(n => n.attr?.class === 'public-history-details'));
});

test("动态区仅等待及结束时显示结果，操作中提交前后均隐藏旧结果", () => {
  const room = { code: "123456", phase: "tools", phaseName: "等待房主发起操作", team: [], me: { seat: 1 }, capacity: 6 };
  const latestResult = { key: 0, text: "任务成功" };
  for (const [phase, submitted] of [["tools", false], ["ended", false], ["quest", false], ["quest", true], ["skillPrepare", false], ["skillPrepare", true], ["fairy", false], ["identity", false]]) {
    const tree = render({ ...base, room: { ...room, phase, needsSubmission: phase === "quest", me: { seat: 1, submitted } }, latestResult });
    const dynamic = nodes(tree).find(n => n.attr?.class?.startsWith("table-dynamics "));
    const children = nodes(dynamic);
    const phaseIndex = children.findIndex(n => n.attr?.class === "phase-strip");
    const resultIndex = children.findIndex(n => n.attr?.class === "latest-result");
    if (["tools", "ended"].includes(phase)) assert.ok(resultIndex >= 0 && resultIndex < phaseIndex);
    else {
      assert.equal(resultIndex, -1);
      assert.ok(phaseIndex >= 0);
      assert.ok(!JSON.stringify(dynamic).includes("任务成功"));
    }
    const summary = nodes(tree).find(n => n.attr?.class === "room-summary");
    assert.ok(byHandler(summary, "reveal"));
  }
  const empty = render({ ...base, room });
  assert.ok(!nodes(empty).some(n => n.attr?.class === "latest-result"));
});

test("旧房间摘要缺少字段时不伪造房主、活动时间或离开限制", () => {
  const legacy = { code: "438671", isHost: true, isMember: true, capacity: 12, phaseName: "入座与准备" };
  const data = { ...base, memberRooms: [legacy], visibleMemberRooms: [legacy], roomMenu: legacy };
  const tree = render(data);
  const text = JSON.stringify(tree);
  assert.ok(!text.includes("房主：未知"));
  assert.ok(!text.includes("最近活动"));
  assert.ok(!text.includes("对局中不能离开"));
  assert.ok(!text.includes("离开权限暂未同步"));
  const leave = nodes(tree).find(n => n.attr?.["data-kind"] === "leave");
  assert.equal(leave, undefined);
  const current = { ...legacy, hostName: "小王", isHost: false, compactRelation: "房主：小王 · 我在3号", updatedAt: 123, activityLabel: "9/22 11:10", canLeave: true };
  const fresh = render({ ...data, visibleMemberRooms: [current], roomMenu: current });
  assert.ok(JSON.stringify(fresh).includes("小王"));
  assert.ok(JSON.stringify(fresh).includes("9/22 11:10"));
  assert.equal(nodes(fresh).find(n => n.attr?.["data-kind"] === "leave").attr.disabled, false);
});

test("读取身份只让身份入口加载，不触发提交或结算动画", () => {
  const data = { ...base, busy: true, busyAction: "identity", room: { phase: "tools", me: { seat: 1 }, canUseTools: true, hasActiveOperation: true }, canSettle: true };
  const tree = render(data);
  assert.equal(byHandler(tree, "reveal").attr.loading, true);
  const settle = byHandler(tree, "settleTool");
  assert.ok(settle);
  assert.equal(settle.attr.loading, false);
  const action = render({ ...data, busyAction: "actionIdentity", room: { phase: "identity", needsSubmission: true, me: { seat: 1 } }, actionDialog: true, stagedChoice: true, draftChoice: "confirm" });
  assert.equal(byHandler(action, "revealActionIdentity").attr.loading, true);
  assert.equal(byHandler(action, "confirmChoice").attr.loading, false);
});

test("技能网格独立选择，底部确认默认禁用并显示明确目标", () => {
  const data = { ...base, room: { phase: "skillPrepare", needsSubmission: true, me: { submitted: false }, team: [] },
    actionDialog: true, skillAction: true, skillTitle: "使用技能 · 开刀", skillHint: "请选择目标", skillBodyHeight: 164,
    skillTargets: [{ value: "target:2", label: "对 2号开刀", seat: 2, name: "玩家乙" }],
    skillOtherChoices: [{ value: "pass", label: "本轮不使用技能" }], swapOptions: [], swapPlayers: [], swapSeats: [],
  };
  const initial = render(data);
  assert.equal(nodes(initial).filter(n => n.attr?.bindtap === "submitChoice").length, 2);
  assert.equal(byHandler(initial, "confirmChoice").attr.disabled, true);
  assert.ok(!byHandler(initial, "confirmSwap"));
  const selected = render({ ...data, draftChoice: "target:2", draftLabel: "对 2号开刀" });
  assert.equal(byHandler(selected, "confirmChoice").attr.disabled, false);
  assert.match(JSON.stringify(byHandler(selected, "confirmChoice")), /确认对 2号开刀/);
  assert.ok(nodes(selected).some(n => n.attr?.class?.includes("skill-option is-selected")));
  const offline = render({ ...data, draftChoice: "target:2", network: false });
  assert.equal(byHandler(offline, "confirmChoice").attr.disabled, true);
});

test("十二骑士原生选人弹窗统一座位与禁用原因，猎人返回不伪装成选项", () => {
  const source = require("node:fs").readFileSync(require.resolve("../miniprogram/pages/table/controller.js"), "utf8");
  const presentation = vm.runInNewContext("(function(){" + source.slice(source.indexOf("function skillView("), source.indexOf("function factionTone(")) + "return { skillView, skillSelectionView };})()");
  const { cases, fixture } = require("./helpers/skill-target-fixtures");
  for (const [role, mode, value] of cases) {
    const { room, secret } = fixture(role, mode);
    const swapOptions = (secret.action.choices || []).filter(v => v.startsWith("swap:"));
    const options = mode === "final" ? secret.action.targets.map(t => ({ value: "target:" + t.seat, label: "目标" + t.seat }))
      : secret.action.hunterModes ? secret.action.options.filter(c => c.value.startsWith(mode + ":")).concat([{ value: "mode:", label: "返回选择技能方式" }])
      : secret.action.options.filter(c => !c.value.startsWith("swap:"));
    const data = { ...base, room, actionDialog: true, stagedChoice: true, draftChoice: "", swapOptions, swapSeats: [], swapPlayers: [],
      ...presentation.skillView(room, options, !!secret.action.hunterModes, secret.action.hunterModes ? mode : "", swapOptions) };
    const initial = render(data);
    const seats = nodes(initial).filter(n => n.attr?.class?.split(" ").includes("skill-option"));
    assert.equal(seats.length, 12, role);
    assert.ok(seats.some(n => n.attr.disabled && n.attr.ariaLabel.includes("已出局")), role);
    assert.equal(byHandler(initial, "confirmChoice").attr.disabled, true);
    assert.ok(nodes(initial).some(n => n.attr?.class?.split(" ").includes("process-skill")));
    if (secret.action.hunterModes) {
      const back = nodes(initial).find(n => n.attr?.["data-value"] === "mode:");
      assert.ok(back.attr.class.includes("skill-navigation"));
      assert.ok(!nodes(back).some(n => n.attr?.class === "skill-pass-mark"));
    }
    const selected = render({ ...data, draftChoice: value,
      ...(mode === "swap" ? { swapSeats: [2, 7], swapPlayers: data.swapPlayers.map(p => ({ ...p, selected: [2, 7].includes(p.seat) })) } : {}),
      ...presentation.skillSelectionView(room, value, mode) });
    assert.equal(byHandler(selected, "confirmChoice").attr.disabled, false, role);
    assert.ok(!byHandler(selected, "confirmSwap"));
  }
});

test("结算需要主动选择胜方，支持第三阵营；零有效局不显示0%", () => {
  const room = { code: "123456", phase: "tools", capacity: 12, canUseTools: true, me: { isHost: true }, team: [], winnerOptions: [{ value: "good", label: "好人胜" }, { value: "evil", label: "坏人胜" }, { value: "third", label: "盗贼阵营胜" }] };
  const dialog = render({ ...base, room, resultDialog: true, resultStep: "reason", resultChoice: "" });
  assert.equal(byHandler(dialog, "nextResult").attr.disabled, true);
  assert.match(JSON.stringify(dialog), /盗贼阵营胜|不计战绩/);
  assert.equal(byHandler(render({ ...base, room, hasPendingRequest: false, resultDialog: true, resultStep: "review", resultReady: true, resultChoice: "third" }), "saveResult").attr.disabled, false);
  const knightRoom = { ...room, knights: {}, scoreSettlement: [{ id: 'early_assassination', label: '三绿前提前盘刀', requiresTarget: true }], players: [{ seat: 1, name: '已出局', alive: false }, { seat: 2, name: '在场', alive: true }] };
  const knifeDialog = render({ ...base, room: knightRoom, resultDialog: true, resultStep:'target',resultStepTitle:'实际刺杀目标',resultPlayers:knightRoom.players.filter(p=>p.alive!==false), resultReason: 'early_assassination', resultRequiresTarget: true, resultTarget: null });
  assert.deepEqual(nodes(knifeDialog).filter(n => n.attr?.bindtap === 'pickScoreTarget').map(n => Number(n.attr['data-seat'])), [2, 0]);
  assert.match(JSON.stringify(knifeDialog), /实际刺杀目标/);
  const stats = renderStatsShell({ ...base, stats: { total: 0, wins: 0, losses: 0, excluded: 2, rateLabel: "—", byFaction: [], byBoard: [], recent: [] } });
  assert.doesNotMatch(JSON.stringify(stats), /还没有有效战绩|去开一局|按阵营与角色查看/);
  assert.doesNotMatch(JSON.stringify(stats), /0%/);
});

test('登记首页显示不计战绩，其他方式仅登记胜方，删去重复说明', () => {
  const registration = require('../miniprogram/result-registration');
  const data = { ...base, resultDialog: true, resultStep: 'reason', resultOther: false, resultReason: 'quest_fail',
    room: { canUseTools: true, scoreSettlement: [{ id: 'quest_fail', label: '三次任务失败', winner: 'evil' },
      { id: 'five_rejections', label: '连续五次组队被否决' }], winnerOptions: [{ value: 'good', label: '好人胜' }, { value: 'evil', label: '坏人胜' }] } };
  const normal = render({ ...data, ...registration.flow(data) });
  assert.equal(byHandler(normal, 'pickResult').attr['data-value'], 'none');
  assert.match(JSON.stringify(normal), /score-choice-mark/);
  assert.match(JSON.stringify(normal), /score-footer/);
  const body = nodes(normal).find(node => node.attr?.class?.split(' ').includes('score-body'));
  const footer = nodes(normal).find(node => node.attr?.class?.split(' ').includes('score-footer'));
  assert.equal(byHandler(body, 'toggleResultOther'), undefined);
  assert.ok(byHandler(footer, 'toggleResultOther'));
  assert.doesNotMatch(JSON.stringify(normal), /其他登记方式/);
  const scroll = nodes(body).find(node => node.tag === 'wx-scroll-view');
  assert.equal(scroll.attr.class, 'score-scroll');
  assert.ok(nodes(scroll).some(node => node.attr?.class?.split(' ').includes('score-content')));
  assert.doesNotMatch(JSON.stringify(normal), /连续五次组队被否决|下一步核对结果|score-helper|score-next-hint/);
  const draft = { ...data, ...registration.switchMode(data), resultChoice: 'good' };
  const other = render({ ...draft, ...registration.flow(draft) });
  assert.equal(byHandler(other, 'pickScoreReason'), undefined);
  assert.match(JSON.stringify(other), /仅登记胜方/);
  assert.match(JSON.stringify(other), /不计积分/);
  assert.doesNotMatch(JSON.stringify(other), /不计战绩|信息不完整|保留未知|score-helper|score-next-hint/);
  assert.equal(byHandler(other, 'nextResult').attr.disabled, false);
  const otherBody = nodes(other).find(node => node.attr?.class?.split(' ').includes('score-body'));
  const otherFooter = nodes(other).find(node => node.attr?.class?.split(' ').includes('score-footer'));
  assert.equal(byHandler(otherBody, 'toggleResultOther'), undefined);
  assert.ok(byHandler(otherFooter, 'toggleResultOther'));
});

test('统计与趣味记录页移除顶部说明、分享和卡片更多菜单，保留次数回查',()=>{
  const { presentStats } = require('../miniprogram/profile');
  const fixture = require('./helpers/fun-copy-fixtures');
  const stats = presentStats(fixture.stats);
  for (const tab of ['records', 'fun']) {
    const tree = renderStatsShell({tab,loading:false,error:'',stats});
    assert.ok(!byHandler(tree,'shareStats'));
    assert.ok(!byHandler(tree,'openFunMenu'));
    assert.ok(!byHandler(tree,'toggleFunRules'));
    assert.ok(!nodes(tree).some(node=>node.attr?.class?.includes('records-scope')));
    assert.ok(byHandler(tree,'openFunMatches'));
  }
});

test('筛选弹层在滚动区域外，关闭时不渲染，展示时锁定列表滚动并显示草稿选项', () => {
  const history = { filtersAvailable: true, filtersExpanded: true, filters: { outcome: 'win' },
    draftFilterGroups: [{ key: 'outcome', label: '胜负', index: 2, valueLabel: '失利', active: true, options: [{id:'',label:'全部结果'},{id:'win',label:'胜利'},{id:'loss',label:'失利'}] }], records: [], total: 0, loaded: true };
  const tree = renderHistoryShell(history);
  const body = nodes(tree).find(n => n.attr?.class === 'records-body');
  assert.ok(!byHandler(body, 'historyConfirmFilters'));
  assert.equal(body.attr.ariaHidden, true);
  const pane = nodes(tree).find(n => n.attr?.['data-tab'] === 'matches');
  assert.equal(pane.attr.scrollY, false);
  const picker = nodes(tree).find(n => n.tag === 'wx-picker');
  assert.equal(picker.attr.value, 2);
  assert.ok(byHandler(tree, 'historyResetDraftFilters')); assert.ok(byHandler(tree, 'historyConfirmFilters'));
  assert.ok(!byHandler(renderHistoryShell({ ...history, filtersExpanded: false }), 'historyConfirmFilters'));
});

test('趣味单指标把比例和样本一起呈现，未知与零机会不显示成功率，已知零次仍可回查', () => {
  const { presentFun } = require('../miniprogram/profile');
  const metric = { id:'good_shield', label:'成功挡刀', mode:'classic', positive:true, ranked:true, unit:'次', count:0, value:0, opportunities:1, knownGames:1, unknownGames:0, rate:0 };
  const renderMetric = extra => renderStatsShell({tab:'fun',stats:{fun:presentFun({legacyGames:0,cards:[{id:'classic:shield',title:'好人',metrics:[{...metric,...extra}]}]})}});
  const textOf = tree => nodes(tree).flatMap(n => (n.children || []).filter(c => typeof c === 'string')).join('');
  const zero = renderMetric({});
  assert.match(textOf(zero), /1 次机会.*0%.*成功率/);
  assert.ok(byHandler(zero,'openFunMatches'));
  const unknown = textOf(renderMetric({value:null,rate:null}));
  assert.match(unknown,/暂无完整样本.*—/); assert.doesNotMatch(unknown,/成功率|成功 0/);
  const noChance = textOf(renderMetric({opportunities:0,rate:null}));
  assert.match(noChance,/暂无有效机会/); assert.doesNotMatch(noChance,/成功率|0%/);
});

test('趣味页按玩法和终局／轮内技能分组，保持全部指标与回查入口', () => {
  const { presentFun } = require('../miniprogram/profile');
  const metric = (id,mode) => ({id,mode,label:id,unit:'次',count:1,value:1,rate:100,opportunities:1,knownGames:1,unknownGames:0,positive:true,ranked:true,byRole:[]});
  const fun = presentFun({legacyGames:0,cards:[
    {id:'classic:shield',title:'好人',metrics:[metric('good_shield','classic')]},
    {id:'classic:assassin',title:'刺客',metrics:[metric('assassin_hit','classic')]},
    {id:'knights:knife',title:'刀客刀法',metrics:[metric('knife_enemy','knights')]},
  ]});
  assert.deepEqual(fun.cards.map(card=>card.sectionTitle),['经典 · 终局表现','','十二骑士 · 轮内技能']);
  assert.equal(fun.cards[0].icon,'/assets/record-shield-good.svg');
  const tree=renderStatsShell({tab:'fun',stats:{fun}});
  assert.equal(nodes(tree).filter(node=>node.attr?.bindtap==='openFunMatches').length,3);
  assert.equal(nodes(tree).filter(node=>node.attr?.class==='fun-card').length,3);
});

test('趣味精简卡片保留称号、未知次数和回查，移除释义说明', () => {
  const { presentFun } = require('../miniprogram/profile');
  const metric = { mode:'knights', unit:'次', count:0, opportunities:0, rate:null, knownGames:1, unknownGames:0, positive:true, ranked:true, byRole:[] };
  const fun = presentFun({ legacyGames:1, cards:[{ id:'knights:survival', metrics:[
    { ...metric, id:'survival_revive', value:null }, { ...metric, id:'survival_knifed', value:0 },
  ] }] });
  assert.equal(fun.cards[0].sectionTitle, '');
  assert.equal(fun.cards[0].headerNote, '');
  const textOf = tree => nodes(tree).flatMap(n => (n.children || []).filter(c => typeof c === 'string')).join('');
  const compact = renderStatsShell({ tab:'fun', stats:{fun} });
  assert.match(textOf(compact), /—我在阿瓦隆玩重生.*0全民公敌/);
  assert.doesNotMatch(textOf(compact), /复活按实际回场|缺失数据|按实际发生次数/);
  assert.ok(!byHandler(compact, 'toggleFunRules'));
  assert.equal(nodes(compact).filter(n => n.attr?.bindtap === 'openFunMatches').length, 2);
});
test('积分页只有真实空数据才显示空态，按北京日期分组，调整不可点，对局可点且零分不遗漏', () => {
  const { presentEntries } = require('../miniprogram/pages/scores/presentation');
  const time = Date.parse('2026-10-02T16:05:00Z');
  const records = presentEntries([
    { id: 'a', type: 'adjustment', occurredAt: time, points: -2, beforePoints: 4, afterPoints: 2, reason: '现场核对' },
    { id: 'm', type: 'match', matchId: 'm', occurredAt: time - 600000, points: 0, boardName: '经典', role: '梅林', outcome: 'loss' },
  ]);
  assert.equal(records[0].dayLabel, '2026年10月3日'); assert.equal(records[1].dayLabel, '2026年10月2日');
  const render = factory('pages/scores/scores.wxml');
  const ready = { loaded: true, records, total: 2, summary: { total: 2, matchPoints: 4, adjustmentLabel: '-2', games: 1, adjustments: 1 } };
  const tree = render(ready), content = JSON.stringify(tree);
  assert.match(content, /操作时总积分|现场核对/); assert.doesNotMatch(content, /暂无计分对局|暂无积分记录/);
  assert.equal(nodes(tree).filter(n => n.attr?.bindtap === 'openMatch').length, 1);
  assert.equal(byHandler(tree, 'openMatch').attr['data-id'], 'm');
  assert.match(JSON.stringify(render({ ...ready, records: [], total: 0 })), /暂无积分记录/);
  assert.doesNotMatch(JSON.stringify(render({ loading: true })), /暂无积分记录|当前总积分/);
  const error = render({ error: '断网', loading: false }); assert.ok(byHandler(error, 'load')); assert.doesNotMatch(JSON.stringify(error), /暂无积分记录/);
  const record = { ...require('../miniprogram/profile').presentMatches([require('./helpers/fun-copy-fixtures').match])[0], expanded: true, members: [{ seat: 1, name: '甲' }], score: { status: 'scored', total: 8, breakdown: [{ id: 'bonus', label: '挡刀奖励', points: 8 }], manualOverride: { reason: '本局核对' } } };
  const detail = JSON.stringify(renderHistoryShell({ records: [record], loaded: true, total: 1 }));
  assert.match(detail, /挡刀奖励/); assert.match(detail, /本局核对/); assert.match(detail, /同桌成员/);
});

test('定位目标使用列表现有详情模板，滚动锚点有效且只高亮所选对局', () => {
  const record = require('../miniprogram/profile').presentMatches([require('./helpers/fun-copy-fixtures').match])[0];
  const tree = renderHistoryShell({ records: [{ ...record, id: 'target/id', expanded: true }, { ...record, id: 'other' }],
    focusId: 'target/id', highlightedId: 'target/id', scrollTarget: 'match-record-0', startOffset: 40, total: 42, loaded: true });
  const entries = nodes(tree).filter(node => node.attr?.class?.startsWith('match-entry '));
  assert.equal(entries[0].attr.id, 'match-record-0');
  assert.match(entries[0].attr.class, /match-focused/); assert.doesNotMatch(entries[1].attr.class, /match-focused/);
  assert.match(JSON.stringify(entries[0]), /match-details/); assert.doesNotMatch(JSON.stringify(entries[1]), /match-details/);
  const pane = nodes(tree).find(node => node.attr?.['data-tab'] === 'matches');
  assert.equal(pane.attr.scrollIntoView, 'match-record-0');
  assert.ok(byHandler(tree, 'historyClearFocus'));
  assert.match(JSON.stringify(tree), /没有更早的对局了/);
  assert.doesNotMatch(JSON.stringify(tree), /已显示全部 42/);
});

test('排行榜有图与无图头像均为可点击入口，并复用无座位标记的战绩卡', () => {
  const rank=factory('pages/leaderboard/leaderboard.wxml');
  const data={loading:false,board:{rows:[{publicId:'a',nickname:'甲',initial:'甲',avatarUrl:'/a.svg'},{publicId:'b',nickname:'乙',initial:'乙'}],me:{status:'ranked'}},playerCard:{scope:'leaderboard',id:'b',name:'乙',initial:'乙'},playerCardStats:{total:0,wins:0,rateLabel:'—',scoreTotal:0,byFaction:[]}};
  const tree=rank(data),buttons=nodes(tree).filter(n=>n.attr?.bindtap==='openRankPlayerCard');
  assert.equal(buttons.length,2);assert.equal(buttons[0].tag,'wx-button');assert.equal(buttons[1].attr['data-id'],'b');
  assert.equal(buttons[0].attr.ariaLabel,'查看甲的玩家战绩');
  assert.match(JSON.stringify(tree),/暂无有效战绩/);assert.doesNotMatch(JSON.stringify(tree),/号位|全部历史|历史有效对局|不含进行中的对局/);
  assert.ok(byHandler(tree,'closePlayerCard'));
  assert.equal(byHandler(rank({...data,loading:true}),'openRankPlayerCard').attr.disabled,true);
});

test('玩家战绩卡呈现加载、陪测、空数据、阵营及积分，空座位不可在游戏中触发', () => {
  const room={phase:'tools',capacity:6,me:{seat:1},team:[]};
  const card={id:'a',seat:2,name:'乙',initial:'乙',isHost:true};
  const data={...base,room,playerCard:card};
  assert.match(JSON.stringify(render({...data,playerCardLoading:true})),/正在读取战绩/);
  for (const status of ['hidden','unknown','']) {
    const unavailable=render({...data,playerCardStatus:status,playerCardLoading:false});
    assert.match(JSON.stringify(unavailable),/战绩暂时无法读取/);assert.ok(byHandler(unavailable,'retryPlayerCard'));
  }
  assert.match(JSON.stringify(render({...data,playerCardStatus:'untracked'})),/陪测玩家不记录个人战绩/);
  assert.match(JSON.stringify(render({...data,playerCardError:'网络中断'})),/retryPlayerCard/);
  const stats={total:0,wins:0,rateLabel:'—',scoreTotal:0,byFaction:[]};
  assert.match(JSON.stringify(render({...data,playerCardStats:stats})),/暂无有效战绩/);
  assert.doesNotMatch(JSON.stringify(render({...data,playerCardStats:stats})),/历史有效对局|不含正在进行|未开放战绩/);
  assert.match(JSON.stringify(render({...data,playerCardStats:{...stats,total:2,wins:1,rateLabel:'50.0%',scoreTotal:3,byFaction:[{faction:'good',label:'好人阵营',total:2,wins:1,rateLabel:'50.0%'}]}})),/好人阵营/);
  assert.ok(!byHandler(render({...data,actionDialog:true}),'closePlayerCard'));
  assert.equal(byHandler(render({...base,room,seats:[{seat:2,occupied:false}]}),'seat').attr.disabled,true);
});

test('首页仅展示快捷入口，表单按需展开，复制与更多使用独立的非冒泡按钮', () => {
  const room = { code: '123456', boardName: '阿瓦隆 · 十二骑士', status: 'lobby', statusLabel: '待开局', peopleLabel: '1/12 人已入座', compactRelation: '我是房主 · 1号', entryLabel: '返回牌桌' };
  const tree = render({ ...base, entrySheet: false, memberRooms: [room], visibleMemberRooms: [room] });
  assert.equal(nodes(tree).filter(n => n.tag === 'wx-form').length, 0);
  assert.equal(nodes(tree).filter(n => n.attr?.class?.includes('home-action-title')).length, 2);
  assert.equal(byHandler(tree, 'copyListedRoom').attr.catchtap, 'copyListedRoom');
  assert.equal(byHandler(tree, 'openRoomMenu').attr.catchtap, 'openRoomMenu');
  const sheet = render({ ...base, entrySheet: true, name: '子龙', nicknameSetup: false, entryKeyboardHeight: 280, entryCodeError: '请输入完整的 6 位数字房间码' });
  const form = nodes(sheet).find(n => n.tag === 'wx-form');
  assert.match(form.attr.style, /bottom: 280px/);
  assert.equal(form.attr.role, 'dialog');
  const nickname = nodes(sheet).find(n => n.tag === 'wx-input' && n.attr.name === 'nickname');
  assert.equal(nickname.attr.value, '子龙');
  assert.equal(nickname.attr.bindfocus, 'entryInputFocus');
  assert.ok(byHandler(sheet, 'pasteRoomCode'));
  const code = nodes(sheet).find(n => n.tag === 'wx-input' && n.attr.name === 'code');
  assert.equal(code.attr.adjustPosition, false);
  assert.equal(code.attr.type, 'number');
  assert.equal(nodes(sheet).filter(n => n.attr?.role === 'alert').length, 1);
});

test('创建和加入表单的铅笔为可点击按钮，昵称焦点绑定生效，请求期间禁用', () => {
  for (const entryMode of ['create', 'join']) {
    for (const state of [{}, { busy: true }, { hasPendingRequest: true }]) {
      const tree = render({ ...base, entryMode, entrySheet: true, entryFocusedField: 'nickname', ...state });
      const edit = byHandler(tree, 'editEntryName');
      assert.equal(edit.tag, 'wx-button');
      assert.equal(edit.attr.ariaLabel, '修改昵称');
      assert.equal(edit.attr.disabled, !!(state.busy || state.hasPendingRequest));
      assert.equal(edit.attr.formType, undefined);
      assert.equal(nodes(tree).find(n => n.tag === 'wx-input' && n.attr.name === 'nickname').attr.focus, true);
    }
  }
});

test('创建表单在原生 form 包装层内用普通 view 分配高度，提交按钮位于滚动区之外', () => {
  const tree = render({ ...base, entryMode: 'create', entrySheet: true, name: '子龙', entryKeyboardHeight: 280 });
  const form = nodes(tree).find(n => n.tag === 'wx-form');
  const layout = form.children.find(n => n.attr?.class === 'entry-sheet-layout');
  assert.equal(layout?.tag, 'wx-view');
  const region = layout.children.find(n => n.attr?.class === 'entry-sheet-scroll-region');
  assert.equal(region?.tag, 'wx-view');
  const scroll = nodes(region).find(n => n.tag === 'wx-scroll-view');
  assert.equal(scroll.attr.scrollY, true);
  assert.ok(nodes(scroll).some(n => n.tag === 'wx-input' && n.attr.name === 'nickname'));
  assert.equal(byHandler(scroll, 'create'), undefined);
  const footer = layout.children.find(n => n.attr?.class === 'entry-sheet-footer');
  assert.equal(byHandler(footer, 'create').attr.formType, 'submit');
});

test('小程序左滑按钮仅展开时出现，按房主状态提供解散且保留卡片内容和菜单', () => {
  const swipe = require('../miniprogram/room-swipe');
  for (const [status, isHost, available] of [['lobby',true,true],['ended',true,true],['playing',true,true],['lobby',false,true],['unavailable',false,false]]) {
    const room = {code:'123456',status,isHost,available};
    room.canSwipeDissolve = swipe.canDissolve(room);
    const data = {...base,memberRooms:[room],visibleMemberRooms:[room],roomSwipeCode:'',roomSwipeOffset:0,roomSwipeDragging:false,roomsRefreshing:false};
    assert.equal(nodes(render(data)).filter(n=>n.attr?.catchtap==='swipeRoomAction').length,0);
    const tree = render({...data,roomSwipeCode:room.code,roomSwipeOffset:-swipe.width(room)});
    const buttons = nodes(tree).filter(n=>n.attr?.catchtap==='swipeRoomAction');
    assert.equal(buttons.length,room.canSwipeDissolve?2:1);
    assert.equal(buttons[0].attr['data-kind'],'hide');
    assert.equal(buttons[0].attr.disabled,false);
    assert.deepEqual(nodes(tree).filter(n=>n.attr?.class==='room-swipe-label').map(n=>n.children.join('')),room.canSwipeDissolve?['移除记录','解散房间']:['移除记录']);
    assert.ok(byHandler(tree,'openRoomMenu'));
    const wrapper = nodes(tree).find(n=>n.attr?.bindtouchmove==='moveRoomSwipe');
    assert.equal(wrapper.attr.bindtouchstart,'startRoomSwipe');
    const card = nodes(tree).find(n=>n.attr?.class?.includes('room-swipe-content'));
    assert.equal(card.attr.catchtap,'openRoom');
    const page = nodes(tree).find(n=>n.attr?.bindtap==='tapRoomSwipePage');
    assert.equal(page.attr.bindtouchstart,'startRoomSwipePageTouch');
    assert.match(card.attr.style,/translateX\(-124px\)/);
    assert.equal(nodes(render({...data,roomSwipeCode:room.code,roomSwipeOffset:-20,roomSwipeDragging:true})).find(n=>n.attr?.catchtap==='swipeRoomAction').attr.disabled,true);
  }
});

test('小程序移除后的房间列表不显示撤销条', () => {
  const tree = render({...base,undoRoom:{code:'123456',until:Date.now()+8000}});
  assert.equal(nodes(tree).some(n=>n.attr?.bindtap==='undoRemoveRoom'),false);
  assert.equal(nodes(tree).some(n=>n.attr?.class?.includes('room-undo')),false);
});

test('点击卡片标题、房间号文字和空白进入房间，仅复制图标捕获复制事件', () => {
  const room = { code: '123456', boardName: '阿瓦隆 · 十二骑士', status: 'lobby', statusLabel: '待开局', compactRelation: '我是房主 · 1号' };
  const tree = render({ ...base, memberRooms: [room], visibleMemberRooms: [room] });
  const card = nodes(tree).find(n => n.attr?.class?.includes('room-list-item'));
  const copy = byHandler(tree, 'copyListedRoom');
  const codeRow = nodes(card).find(n => n.attr?.class === 'room-list-code');
  const title = nodes(card).find(n => n.attr?.class === 'room-list-title');
  const more = byHandler(tree, 'openRoomMenu');
  function pathTo(node, target) {
    if (node === target) return [node];
    for (const child of node.children || []) {
      if (typeof child !== 'object') continue;
      const path = pathTo(child, target);
      if (path) return [node, ...path];
    }
  }
  function tap(target) {
    const handlers = [];
    for (const node of pathTo(card, target).reverse()) {
      if (node.attr?.catchtap) { handlers.push(node.attr.catchtap); break; }
      if (node.attr?.bindtap) handlers.push(node.attr.bindtap);
    }
    return handlers;
  }
  assert.deepEqual(tap(card), ['openRoom']);
  assert.deepEqual(tap(title), ['openRoom']);
  assert.deepEqual(tap(codeRow), ['openRoom']);
  assert.deepEqual(tap(codeRow.children[0]), ['openRoom']);
  assert.deepEqual(tap(copy), ['copyListedRoom']);
  assert.deepEqual(tap(copy.children[0]), ['copyListedRoom']);
  assert.deepEqual(tap(more), ['openRoomMenu']);
  assert.ok(!nodes(copy).some(n => n.tag === 'wx-text'));
});

test('表单、房间管理和键盘任意一项打开时移除底栏节点，均关闭后恢复', () => {
  const renderTabBar = factory('custom-tab-bar/index.wxml');
  for (const entrySheetVisible of [false, true]) {
    for (const keyboardVisible of [false, true]) {
      for (const roomMenuVisible of [false, true]) {
        const tree = renderTabBar({ entrySheetVisible, keyboardVisible, roomMenuVisible, selected: 0, list: [] });
        const hasTabBar = nodes(tree).some(n => n.attr?.role === 'tablist');
        assert.equal(hasTabBar, !entrySheetVisible && !keyboardVisible && !roomMenuVisible);
      }
    }
  }
});
test('最终结果为所有玩家显示获奖头像昵称号码票数，平票渲染全部，票选弹层排除本人',()=>{
  const hp=require('../miniprogram/honors');
  const room={code:'123456',phase:'ended',result:{winner:'good'},capacity:6,me:{seat:1,isHost:false},players:[],history:[],team:[]};
  const honors=hp.present({status:'settled',completed:6,total:6,mvp:[{seat:2,name:'林间',avatarUrl:'/api/avatars/test',votes:3},{seat:3,name:'阿风',votes:3}],svp:[{seat:5,name:'晚风',votes:4}]});
  const tree=renderTable({...base,room,honors,network:true});const text=JSON.stringify(tree);
  for(const name of ['林间','阿风','晚风','最强 MVP','最强 SVP','并列获奖'])assert(text.includes(name),name);
  assert.equal(nodes(tree).filter(n=>n.attr?.class==='honor-winner').length,3);
  assert(nodes(tree).some(n=>n.tag==='wx-image' && n.attr.src==='/api/avatars/test'));
  const ballot=hp.present({status:'open',matchId:'x',canVote:true,groups:[{key:'mvp',title:'最强 MVP',side:'胜方',players:[{seat:1,name:'我',disabled:true},{seat:2,name:'林间',disabled:false}]}]});
  const polling=renderTable({...base,room,honors:ballot,...hp.sync({},ballot),network:true});
  const options=nodes(polling).filter(n=>n.attr?.bindtap==='chooseHonor');assert.equal(options.length,2);assert.equal(options[0].attr.disabled,true);
  assert.equal(byHandler(polling,'submitHonors').attr.disabled,true);
  assert.doesNotMatch(JSON.stringify(polling),/剩余|截止前可修改|关闭后可从牌桌继续|NaN/);
});

test('等待票选仅显示简短提示，房主显示未投名单和结束入口',()=>{
  const hp=require('../miniprogram/honors');
  const room={code:'123456',phase:'ended',result:{winner:'good'},capacity:6,me:{seat:1,isHost:false},players:[],history:[],team:[]};
  const data={...base,room,network:true};
  const waiting=JSON.stringify(renderTable({...data,honors:hp.present({status:'not_started',canStart:false})}));
  assert.match(waiting,/等待房主发起票选/);
  assert.doesNotMatch(waiting,/胜方 MVP|可选环节|每局仅一次|等待房主选择/);
  const start=renderTable({...data,honors:hp.present({status:'not_started',canStart:true})});
  assert.ok(byHandler(start,'startHonors'));
  const open=hp.present({status:'open',canVote:true,canClose:true,total:6,completed:2,required:3,
    pendingPlayers:[{seat:3,name:'林间'},{seat:5,name:'晚风'}]});
  const host=renderTable({...data,honors:open});
  assert.match(JSON.stringify(host),/未投票：3号 林间、5号 晚风/);
  assert.ok(byHandler(host,'closeHonors'));
  assert.doesNotMatch(JSON.stringify(host),/剩余|NaN/);
  const player=renderTable({...data,honors:hp.present({...open,canClose:false})});
  assert.doesNotMatch(JSON.stringify(player),/未投票：/);
  assert.equal(byHandler(player,'closeHonors'),undefined);
});

test('票选趣味记录展示两个称号和获奖局数，排行榜仅显示次数排序',()=>{
  const fun=require('../server/fun');const {presentStats}=require('../miniprogram/profile');
  const rows=['honor_mvp','honor_svp'].map((metric,i)=>({metric,mode:'voted',role:'all',role_label:'玩家票选',match_id:'m',status:'known',count:i?0:1,opportunities:0}));
  const stats=presentStats({total:1,wins:1,byFaction:[],byRole:[],byBoard:[],recent:[],fun:fun.aggregate(rows)});
  const text=JSON.stringify(renderStatsShell({tab:'fun',stats}));
  assert.match(text,/最强 MVP/);assert.match(text,/最强 SVP/);assert.doesNotMatch(text,/按获奖局数统计/);
  assert.doesNotMatch(text,/成功率/);
  const presentation=require('../miniprogram/leaderboard-presentation');
  for(const metric of ['fun_honor_mvp','fun_honor_svp']) {
    const board=presentation.presentBoard({fun:true,countOnly:true,metric,sort:'count',period:'all',unit:'次',availableFunMetrics:fun.publicMetrics(),rows:[],me:{knownGames:1,count:1,status:'ranked',rank:1}});
    const tree=factory('pages/leaderboard/leaderboard.wxml')({board,metric,funSelected:true,funSort:'count'});
    assert.match(JSON.stringify(tree),/获奖次数/);
    assert.equal(nodes(tree).filter(n=>n.attr?.bindtap==='chooseFunSort' && n.attr['data-id']==='rate').length,0);
    assert.match(board.ruleLines.join(),/每局每项荣誉最多增加一次/);
  }
});

test('六位分格只展示原生数字输入框的值，前导零可见且表单保留昵称与粘贴入口', () => {
  const tree=render({...base,entrySheet:true,entryMode:'join',code:'062819',codeSlots:[0,1,2,3,4,5],nicknameSetup:false,name:'子龙'});
  const inputs=nodes(tree).filter(n=>n.tag==='wx-input');
  assert.equal(inputs.length,2);
  assert.equal(inputs.find(n=>n.attr.name==='code').attr.type,'number');
  const slots=nodes(tree).filter(n=>n.attr?.class==='entry-code-slot');
  const plain=n=>typeof n==='string'?n:(n.children||[]).map(plain).join('');
  assert.deepEqual(slots.map(plain),['0','6','2','8','1','9']);
  assert.ok(byHandler(tree,'pasteRoomCode'));
  assert.equal(nodes(tree).find(n=>n.tag==='wx-form').attr.bindsubmit,'submitEntry');
});

test('房间码光标随输入和删除落在下一格，满六码在末位之后，失焦后隐藏', () => {
  const codeSlots = [0,1,2,3,4,5];
  for (const code of ['', '1', '14', '142', '1420', '14205', '142059', '14205', '1420', '', '062819']) {
    for (const entryFocusedField of ['code', '', 'nickname']) {
      const tree = render({...base,entrySheet:true,entryMode:'join',code,codeSlots,entryFocusedField});
      const slots = nodes(tree).filter(n=>n.attr?.class==='entry-code-slot');
      const hasCaret = n=>nodes(n).some(child=>child.attr?.class?.includes('entry-code-caret'));
      assert.deepEqual(slots.map(hasCaret), codeSlots.map(i=>entryFocusedField==='code' && i===Math.min(code.length,5)));
      const input = nodes(tree).find(n=>n.tag==='wx-input' && n.attr.name==='code');
      assert.equal(input.attr.cursor, code.length);
      assert.equal(input.attr.selectionStart, code.length);
      assert.equal(input.attr.selectionEnd, code.length);
      assert.equal(input.attr.alwaysEmbed, true);
      assert.equal(input.attr.value, code);
      assert.ok(byHandler(tree,'editEntryCode'));
      if (entryFocusedField==='code') {
        const caret = nodes(tree).find(n=>n.attr?.class?.includes('entry-code-caret'));
        assert.equal(caret.attr.class.includes('is-complete'), code.length===6);
        if (code.length<6) assert.ok(!nodes(slots[code.length]).some(n=>n.attr?.class==='entry-code-dash'));
      }
    }
  }
});

test('对局趣味时间线按轮次归组，保留同轮多身份、长详情及无轮次记录', () => {
  const copy = require('../miniprogram/fun-copy');
  const events = [
    {id:'r2',round:2,kind:'revive',label:'复活',detail:'抽取新身份复活'},
    {id:'r1',round:1,kind:'receivedKnife',label:'被刀',detail:'2号出刀 · 目标出局'},
    {id:'a1',round:1,role:'蓝刀客·加雷斯',kind:'knife',label:'命中同伴',detail:'3号同阵营 · 实际承受者5号'},
    {id:'a2',round:1,role:'红骑士',kind:'duel',label:'未生效',detail:'决斗失败'},
    {id:'final',role:'梅林',label:'成功躲刀',detail:'最终目标：4号'},
    {id:'unknown',label:'新增事件',detail:'保留旧记录的说明'},
  ];
  const before = JSON.stringify(events), story = copy.story({events});
  assert.deepEqual(story.eventGroups.map(g=>g.id),['round-1','round-2','final','other']);
  assert.deepEqual(story.eventGroups[0].events.map(e=>e.id),['r1','a1','a2']);
  assert.equal(story.eventGroups[0].showEventRoles,true);
  assert.equal(story.eventGroups[0].role,'');
  assert.equal(story.eventGroups[0].events[1].label,'刀中友方');
  assert.equal(JSON.stringify(events),before);
  assert.equal(story.eventGroups.flatMap(g=>g.events).length,events.length);
  assert.deepEqual(copy.story(story).eventGroups,story.eventGroups);
  const record={...require('../miniprogram/profile').presentMatches([{endedAt:1,members:[],fun:{events}}])[0],expanded:true};
  const text=JSON.stringify(renderHistoryShell({records:[record],loaded:true,total:1}));
  for(const value of ['第 1 轮','第 2 轮','蓝刀客·加雷斯','红骑士','实际承受者5号','最终目标：4号','保留旧记录的说明']) assert.ok(text.includes(value),value);
});

test('徽章收藏默认紧凑展示，管理时才出现摘下按钮，详情不含冗余说明', () => {
  const {catalogue,presentCollection}=require('../miniprogram/badges');
  const badgeCollection=presentCollection({badges:[{...catalogue.find(b=>b.id==='games'),equipped:true}],periodStart:Date.UTC(2026,8,30,16)});
  const render=factory('pages/badges/badges.wxml'),data={badgeCollection,badgeFilter:'all'};
  assert.equal(byHandler(render(data),'toggleOwnedBadge'),undefined);
  assert.ok(byHandler(render(data),'manageBadges'));
  assert.ok(byHandler(render({...data,badgeManaging:true}),'toggleOwnedBadge'));
  const detail=render({...data,selectedBadge:badgeCollection.items.find(b=>b.id==='games')});
  const text=JSON.stringify(detail);
  assert.match(text,/获取条件|持有规则|常驻牌桌/);
  assert.doesNotMatch(text,/按北京时间本月|摘下后仍保留/);
  assert.match(byHandler(detail,'toggleOwnedBadge').attr.class,/secondary/);
  const locked=render({...data,selectedBadge:badgeCollection.items.find(b=>!b.owned)});
  assert.equal(byHandler(locked,'toggleOwnedBadge'),undefined);
});
