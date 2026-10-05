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
    (n) => n.attr?.bindtap === name || n.attr?.["data-action"] === name,
  );
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
test('战绩区分未计分与零分计分局，没有计分局也保留独立调分', () => {
  const renderStats = renderStatsShell;
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children || []).map(text).join(' ');
  const score = { total: 0, games: 0, average: null, current: 0, best: 0 };
  const role = { role: '派西维尔', total: 2, wins: 1, rateLabel: '50%', score, scoreAverageLabel: '—' };
  const faction = { faction: 'good', label: '好人阵营', ...role, expanded: true, roles: [role] };
  const stats = { total: 2, wins: 1, rateLabel: '50%', score, scoreAverageLabel: '—', byFaction: [faction] };
  const show = value => text(renderStats({ loading: false, tab: 'records', stats: value }));
  const unscored = show(stats);
  assert.match(unscored, /暂无计分对局/);
  assert.match(unscored, /派西维尔/);
  assert.doesNotMatch(unscored, /场均|计分局连胜|0 分/);

  const scored = { ...score, games: 1, average: 0 };
  const zeroPoints = show({ ...stats, score: scored, scoreAverageLabel: '0.00', byFaction: [{ ...faction, score: scored, scoreAverageLabel: '0.00', roles: [{ ...role, score: scored, scoreAverageLabel: '0.00' }] }] });
  assert.doesNotMatch(zeroPoints, /暂无计分对局/);
  assert.match(zeroPoints, /计分局连胜/);
  assert.match(zeroPoints, /0 分 · 场均 0.00/);

  for (const total of [-5, 5]) {
    const adjusted = show({ ...stats, score: { ...score, total } });
    assert.match(adjusted, new RegExp('积分\\s+' + total));
    assert.match(adjusted, /暂无计分对局/);
    assert.match(adjusted, /来自积分调整/);
    assert.doesNotMatch(adjusted, /场均|计分局连胜/);
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
test('榜单分享入口在本人未上榜或暂无记录时均可点击，忙碌时显示等待状态', () => {
  const template=factory('pages/leaderboard/leaderboard.wxml');
  const renderRank=data=>template({loading:false,loadingMore:false,visibilitySaving:false,shareOpening:false,...data});
  const own=renderRank({board:{rows:[],metric:'games'}});
  assert.equal(byHandler(own,'shareLeaderboard').attr.disabled,false);
  assert.match(JSON.stringify(own),/暂无公开排名/);
  const board={rows:[],metric:'games'};
  const empty=renderRank({board,shareNotice:'当前榜单暂无本人成绩，完成相关对局后再来分享。'});
  assert.equal(byHandler(empty,'shareLeaderboard').attr.disabled,false);
  assert.ok(nodes(empty).some(node=>node.attr?.role==='alert'));
  assert.match(JSON.stringify(empty),/暂无本人成绩/);
  for (const key of ['loading','loadingMore','visibilitySaving','shareOpening']) {
    const busy=renderRank({board,[key]:true});
    const entry=byHandler(busy,'shareLeaderboard');
    assert.equal(entry.attr.disabled,true);assert.equal(entry.attr.loading,true);
    assert.match(entry.attr.ariaLabel,/正在/);
    assert.ok(nodes(busy).some(node=>node.attr?.role==='status'));
  }
});
test('趣味榜显示当前指标，展开后可选全部指标，排序独立呈现并保留样本门槛', () => {
  const defs=require('../server/fun').publicMetrics().filter(m=>m.key!=='fun_final_hit');
  const renderRank=factory('pages/leaderboard/leaderboard.wxml');
  const data={
    groups:require('../miniprogram/leaderboard').groups,metric:'fun_good_shield',funSelected:true,funAvailable:true,
    funOptions:defs.map(m=>({...m,title:m.key==='fun_good_shield'?'好人':m.title,tabLabel:(m.key==='fun_good_shield'?'好人':m.title)+' · '+m.label})),funSort:'count',funRoleOptions:[],metricsExpanded:false,
    board:{fun:true,threshold:5,rows:[],me:{}},
  };
  const collapsed=renderRank(data);
  assert.match(JSON.stringify(byHandler(collapsed,'toggleMetrics')),/好人 · 成功挡刀/);
  assert.equal(byHandler(collapsed,'toggleMetrics').attr.ariaExpanded,false);
  assert.ok(!byHandler(collapsed,'chooseFunMetric'));
  assert.doesNotMatch(JSON.stringify(collapsed),/如何计算|累计次数|参与排名/);
  const sorts=nodes(collapsed).filter(n=>n.attr?.bindtap==='chooseFunSort');
  assert.equal(sorts.length,2);
  assert.equal(sorts.find(n=>n.attr['data-id']==='count').attr.ariaPressed,true);
  assert.match(JSON.stringify(sorts),/按次数/);assert.match(JSON.stringify(sorts),/按成功率/);
  const rate=renderRank({...data,funSort:'rate'});
  assert.match(JSON.stringify(rate),/次机会参与排名/);
  assert.equal(nodes(rate).find(n=>n.attr?.['data-id']==='rate').attr.ariaPressed,true);
  const tree=renderRank({...data,metricsExpanded:true});
  const all=nodes(tree), tabs=all.filter(n=>n.attr?.bindtap==='chooseFunMetric');
  assert.equal(tabs.length,defs.length);assert.ok(tabs.every(n=>n.tag==='wx-button'));
  assert.equal(byHandler(tree,'toggleMetrics').attr.ariaExpanded,true);
  assert.ok(tabs.find(n=>n.attr['data-id']==='fun_good_shield').attr.ariaPressed);
  assert.equal(tabs.find(n=>n.attr['data-id']==='fun_knife_enemy').attr.ariaLabel,'刀客刀法 · 刀中敌方');
  for (const key of ['fun_percival_bust','fun_merlin_hit','fun_assassin_miss','fun_knife_ally','fun_duel_ally']) {
    assert.ok(tabs.some(n=>n.attr['data-id']===key));
  }
  const adverse=renderRank({...data,metric:'fun_knife_ally',funSort:'rate',board:{...data.board,rateLabel:'发生率',threshold:10}});
  assert.match(JSON.stringify(byHandler(adverse,'toggleMetrics')),/刀客刀法 · 刀中友方/);
  assert.match(JSON.stringify(nodes(adverse).find(n=>n.attr?.['data-id']==='rate')),/按发生率/);
  assert.match(JSON.stringify(adverse),/至少 10 次机会/);
  assert.ok(!all.some(n=>n.attr?.bindchange==='chooseFunMode' || n.attr?.bindchange==='chooseFunMetric'));
});
test('结束牌桌显示本人得分或房主关闭计分的原因，准备页没有历史结算',()=>{
  const room={phase:'ended',capacity:6,me:{seat:1},team:[],players:[],history:[],myScore:{status:'scored',total:7,breakdown:[{id:'remote',label:'服务端奖励',points:7}]}};
  const ended=render({...base,room});assert.match(JSON.stringify(ended),/本局 \+7 分/);assert.match(JSON.stringify(ended),/服务端奖励/);
  room.myScore={status:'excluded',reason:'本局未开启计分'};assert.match(JSON.stringify(render({...base,room})),/不计积分 · 本局未开启计分/);
  room.phase='lobby';assert.doesNotMatch(JSON.stringify(render({...base,room})),/不计积分 · 本局未开启计分/);
});
test("座位头像固定占位且失败回退，保留座位按钮和全部公开状态", () => {
  const room = { phase: "proposal", flexible: false, leader: 1, fairyHolder: 1, capacity: 6, me: { seat: 1 } };
  const seat = { seat: 1, name: "甲", occupied: true, mine: true, host: true, alive: false, selected: true,
    avatarUrl: "https://table.example/api/avatars/a", avatarInitial: "甲" };
  const tree = render({ ...base, room, seats: [seat] });
  const button = byHandler(tree, "seat");
  assert.equal(button.attr.disabled, false);
  assert.equal(button.attr["data-seat"], 1);
  assert.equal(button.attr.ariaLabel, "1号，甲，你的座位，房主，已出局，已选入队，湖仙");
  const image = nodes(button).find(n => n.tag === "wx-image");
  assert.equal(image.attr.src, seat.avatarUrl);
  assert.equal(image.attr.binderror, "seatAvatarError");
  assert.equal(image.attr["data-url"], seat.avatarUrl);
  assert.deepEqual(Array.from(nodes(button).find(n => n.attr?.class === "seat-self").children), ["你"]);
  assert.deepEqual(Array.from(nodes(button).find(n => n.attr?.class === "seat-flag").children), ["房主"]);
  assert.match(JSON.stringify(button), /已出局/);
  assert.match(JSON.stringify(button), /湖仙/);
  assert.match(JSON.stringify(button), /已选入队/);
  assert.ok(nodes(button).find(n => n.attr?.class?.startsWith("seat-status")).children.includes("已选入队"));
  assert.ok(nodes(button).find(n => n.attr?.class === "seat-tags"));
  const failed = byHandler(render({ ...base, room, seats: [{ ...seat, avatarFailed: true }] }), "seat");
  assert.ok(!nodes(failed).some(n => n.tag === "wx-image"));
  assert.ok(nodes(failed).some(n => n.attr?.class === "seat-avatar-fallback"));
  const lobby = { ...room, phase: "lobby" };
  const empty = byHandler(render({ ...base, room: lobby, seats: [{ seat: 2, name: "空位", occupied: false, mine: false, avatarInitial: "+" }] }), "seat");
  assert.equal(empty.attr.disabled, false);
  assert.equal(empty.attr.ariaLabel, "2号，空位，可入座");
  assert.match(empty.attr.class, /seat-empty/);
  assert.match(JSON.stringify(empty), /点击入座/);
  assert.ok(!nodes(empty).some(n => n.tag === "wx-image" || n.attr?.class === "seat-meta"));
  const gameEmpty = byHandler(render({ ...base, room, seats: [{ seat: 2, name: "空位", occupied: false }] }), "seat");
  assert.doesNotMatch(JSON.stringify(gameEmpty), /点击入座/);
  const occupied = byHandler(render({ ...base, room: lobby, seats: [{ ...seat, mine: false }] }), "seat");
  assert.equal(occupied.attr.disabled, true);
  assert.equal(nodes(occupied).find(n => n.attr?.class === "seat-self"), undefined);
  assert.match(JSON.stringify(occupied), /未准备/);
  const ready = byHandler(render({ ...base, room: lobby, seats: [{ ...seat, ready: true }] }), "seat");
  assert.match(JSON.stringify(ready), /已准备/);
  assert.doesNotMatch(JSON.stringify(ready), /未准备/);
});
test("座位区保留人数和准备统计，长昵称保留在原卡片且不显示名单入口", () => {
  const room = { phase: "lobby", capacity: 13, me: { seat: 1 }, team: [] };
  const seats = [{ seat: 1, name: "这是一个很长的完整玩家昵称", occupied: true, mine: true, host: true, role: "秘密角色" },
    { seat: 2, name: "乙", occupied: true, ready: true }, { seat: 3, name: "空位", occupied: false }];
  const tree = render({ ...base, room, seats, seatOccupiedCount: 2, seatReadyCount: 1 });
  assert.doesNotMatch(JSON.stringify(tree), /玩家名单|关闭名单|秘密角色/);
  const count = nodes(tree).find(n => n.attr?.class === "seat-count");
  assert.equal(count.attr.ariaLabel, "已入座2人，共13个座位");
  const caption = nodes(tree).find(n => n.attr?.class === "seat-section-caption");
  assert.match(JSON.stringify(caption), /已准备 1\/2/);
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

test("我的牌桌统一更多入口，只有房主菜单显示解散，非房主仍可移除记录", () => {
  const rooms = [{ code: "123456", isHost: true, available: true }, { code: "234567", isHost: false, available: true }];
  const data = { ...base, memberRooms: rooms, visibleMemberRooms: rooms };
  const tree = render(data);
  assert.ok(byHandler(tree, "join"));
  assert.equal(nodes(tree).filter(n => n.attr?.bindtap === "openRoomMenu").length, 2);
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
    me: { isHost: false, seat: 2 },
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
  const host = render({
    ...base,
    room: { ...room, me: { isHost: true, seat: 1 } },
    showRoomSettings: true,
  });
  assert.ok(byHandler(host, "toggleRoomSettings"));
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
    footerIndex > all.findIndex((n) => n.attr?.class === "history-row"),
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
  const tree = render({ ...base, entryMode: "create", availableBoards: [{ id: "classic", name: "经典" }] });
  assert.ok(byHandler(tree, "openBoardDetails"));
  const detail = factory("pages/board-details/board-details.wxml")({ loading: false, hasDetail: true, directoryExpanded: true, sections: [{ title: "角色技能", navTitle: "B牌 · 蓝方", kind: "roles", items: [] }] });
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

test("结果卡和表决展示队伍，座位可折叠，公开记录底部展开且没有冗余说明", () => {
  const entry = { key: 3, text: "投票通过", resultTone: "success", resultTeam: "1、4号", latestDetail: "2票赞成", timeLabel: "23:38", recordLabel: "记录 4" };
  const data = { ...base, room: { phase: "teamVote", team: [1, 4], me: { submitted: false }, needsSubmission: true }, teamText: "1、4", actionDialog: true, seatsExpanded: false, latestResult: entry, history: [entry, entry, entry, entry], visibleHistory: [entry], questTimeline: [{ key: 1, number: 2, text: "任务成功", questResult: "success" }] };
  const tree = render(data);
  const text = JSON.stringify(tree);
  assert.ok(text.includes("任务队伍：1、4号"));
  assert.ok(text.includes("共4条"));
  assert.ok(text.includes("23:38"));
  assert.ok(text.includes("第2次"));
  assert.ok(!text.includes("最近三条"));
  assert.ok(!nodes(tree).some(n => n.attr?.class === "seats"));
  assert.ok(byHandler(tree, "toggleSeats"));
  assert.ok(byHandler(tree, "toggleHistory"));
  assert.ok(nodes(tree).some(n => n.attr?.class?.includes("quest-result-icon success")));
});

test("查验结果突出座位阵营，仅保留一个关闭入口", () => {
  const tree = render({ ...base, fairyResult: { revision: 1, information: "6号查验结果：坏人（第1轮）", summary: "6号 · 坏人" }, fairyResultRevealed: true });
  const text = JSON.stringify(tree);
  assert.ok(text.includes("6号 · 坏人"));
  assert.ok(!text.includes("第1轮"));
  assert.ok(!text.includes("立即遮盖"));
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
  const located = render({ ...data, focusedHistoryKey: 0, visibleHistory: [{ key: 0, text: "任务成功" }] });
  const record = nodes(located).find(n => n.attr?.id === "history-record-0");
  assert.equal(record.attr.class, "history-row history-row-focused");
  const pending = render({ ...data, room: { ...room, phase: "quest", needsSubmission: true }, actionEntryLabel: "提交任务牌" });
  const phase = nodes(pending).find(n => n.attr?.class === "phase-strip");
  assert.ok(byHandler(phase, "openAction"));
  assert.equal(byHandler(phase, "openAction").attr.class, "primary");
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
  assert.ok(text.includes("离开权限暂未同步"));
  const leave = nodes(tree).find(n => n.attr?.["data-kind"] === "leave");
  assert.equal(leave.attr.disabled, true);
  const current = { ...legacy, hostName: "小王", updatedAt: 123, activityLabel: "9/22 11:10", canLeave: true };
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

test('趣味记录页顶部显示完整分享入口，暂无完整记录时隐藏，单项分享仍可使用',()=>{
  const renderStats=renderStatsShell;
  const data={tab:'fun',loading:false,error:'',stats:{total:0,fun:{available:true,shareable:true,cards:[{id:'knights:knife',title:'刀客刀法',metrics:[],roles:[],shareMetric:'knife_enemy',shareLabel:'刀中敌方'}]}}};
  const ready=renderStats(data),nav=nodes(ready).find(node=>node.tag==='wx-app-nav');
  assert.equal(nav.attr.share,true);assert.equal(nav.attr.shareLabel,'分享完整趣味记录图片');
  assert.ok(byHandler(ready,'shareFun'));
  const empty=renderStats({...data,stats:{...data.stats,fun:{...data.stats.fun,shareable:false}}});
  assert.equal(nodes(empty).find(node=>node.tag==='wx-app-nav').attr.share,false);
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
  const record = { ...require('../miniprogram/profile').presentMatches([require('./helpers/fun-copy-fixtures').match])[0], members: [{ seat: 1, name: '甲' }], score: { status: 'scored', total: 8, breakdown: [{ id: 'bonus', label: '挡刀奖励', points: 8 }], manualOverride: { reason: '本局核对' } } };
  const detail = JSON.stringify(factory('pages/match-detail/match-detail.wxml')({ record }));
  assert.match(detail, /挡刀奖励/); assert.match(detail, /本局核对/); assert.match(detail, /同桌成员/);
});
