// Project production WXML/WXSS into HTML for visual QA; native behavior needs device QA.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { wxmlToJs } = require('miniprogram-compiler');
const { presentStats, presentMatches, presentProfile, presentFun } = require('../miniprogram/profile');
const createHistory = require('../miniprogram/pages/matches/controller');
const root = path.resolve(__dirname, '../miniprogram');
const output = path.resolve(__dirname, '../output/playwright/stats');
const context = { window: {}, global: {}, console };
vm.createContext(context);
const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
const safe = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = file => fs.readFileSync(path.join(root, file), 'utf8')
  .replace(/@import\s+"([^"]+)";/g, (_, name) => css(path.relative(root, path.resolve(root, path.dirname(file), name))))
  .replace(/([\s>+~])(text|image|picker)(?=[\s.:#\[>+~,{])/g, (_, prefix, tag) => prefix + ({text:'span',image:'img',picker:'div'})[tag])
  .replace(/^page\s*\{/m, 'body {').replace(/(-?[\d.]+)rpx/g, 'calc($1 * 100vw / 750)');
function html(node) {
  if (typeof node === 'string' || typeof node === 'number') return safe(node);
  if (!node.tag || node.tag === 'wx-block') return (node.children || []).map(html).join('');
  if (node.tag === 'wx-app-nav') return '<div class="preview-nav">' + html(factory('components/app-nav/app-nav.wxml')({ ...node.attr, statusBarHeight: 44, navHeight: 44, totalHeight: 88 })) + '<span class="preview-clock">11:41</span><div class="preview-capsule">•••<i></i><b>⊙</b></div></div>';
  if (node.tag === 'wx-scroll-view') node = {...node,attr:{...node.attr,style:(node.attr?.style || '') + ';overflow-y:' + (node.attr?.scrollY?'auto':'hidden')}};
  const tag = ({ 'wx-text': 'span', 'wx-button': 'button', 'wx-image': 'img', 'wx-navigator': 'a' })[node.tag] || 'div';
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === 'hidden' || key === 'disabled') return value ? [key] : [];
    if (key.startsWith('aria')) key = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    if (key === 'src' && value.startsWith('/')) {
      const mime = ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(value)] || 'application/octet-stream';
      value = 'data:' + mime + ';base64,' + fs.readFileSync(path.join(root, value)).toString('base64');
    }
    if (key === 'style') value = String(value).replace(/(-?[\d.]+)rpx/g, 'calc($1 * 100vw / 750)');
    return ['class', 'src', 'style', 'role', 'aria-label', 'aria-pressed', 'aria-expanded', 'aria-hidden', 'aria-modal'].includes(key) ? [`${key}="${safe(value)}"`] : [];
  }).join(' ');
  return `<${tag} ${attrs}>${(node.children || []).map(html).join('')}${tag === 'img' ? '' : `</${tag}>`}`;
}
const fun = require('../server/fun');
const labels = Object.fromEntries(Object.values(fun.metrics).map(def => [def.id, def.label]));
const metric = (id, count, opportunities, positive) => ({ id, label: labels[id], count, value: count, opportunities, rate: opportunities ? count / opportunities * 100 : null, knownGames: opportunities, unknownGames: 0, mode: 'knights', unit: '次', positive, ranked: positive, byRole: [] });
const shield = metric('good_shield', 1, 3, true);
const honorGroups = new Map();
for (const def of fun.publicMetrics()) {
  const card = honorGroups.get(def.group) || {id:'knights:'+def.group,title:fun.metrics[def.id].title,metrics:[]};
  card.metrics.push({...metric(def.id, def.positive ? 3 : 1, 8, def.positive), ranked:true});
  honorGroups.set(def.group, card);
}
const knife = [metric('knife_enemy', 0, 3, true), metric('knife_ally', 0, 3, false), metric('knife_failed', 3, 3, false)];
knife[0].byRole = [{role:'gaheris',label:'蓝刀客·加赫雷斯',value:0,count:0,opportunities:3}];
const score = { total: 9, month: 9, games: 6, average: 1.5 };
const stats = presentStats({ total: 8, wins: 3, losses: 5, winRate: 37.5, score,
  byFaction: [{faction:'good',label:'好人阵营',total:6,wins:2,losses:4,winRate:33.3,score:{total:6,games:4,average:1.5}}, {faction:'evil',label:'坏人阵营',total:2,wins:1,losses:1,winRate:50,score:{total:3,games:2,average:1.5}}],
    byRole: [
      {role:'亚瑟的忠臣',faction:'good',total:2,wins:0,winRate:0,score:{total:1,games:2,average:.5}},
      {role:'派西维尔',faction:'good',total:1,wins:0,winRate:0},
      {role:'蓝兰斯洛特',faction:'good',total:1,wins:1,winRate:100},
      {role:'蓝刀客·加赫雷斯',faction:'good',total:1,wins:1,winRate:100,score:{total:4,games:1,average:4}},
      {role:'蓝刀客·加雷斯',faction:'good',total:1,wins:0,winRate:0,score:{total:1,games:1,average:1}},
      {role:'莫甘娜',faction:'evil',total:1,wins:1,winRate:100,score:{total:3,games:1,average:3}},
      {role:'刺客',faction:'evil',total:1,wins:0,winRate:0},
    ],
  byBoard: [], recent: [], fun: {legacyGames:0,cards:[
    ...honorGroups.values(),
    {id:'knights:shield',title:'好人',metrics:[shield]},
    {id:'knights:knife',title:'刀客刀法',metrics:knife},
  ]},
});
const match = { boardName:'阿瓦隆 · 十二骑士（12人）', capacity:12, faction:'evil', winner:'evil', source:'manual', seat:1,
  members:[{seat:1,name:'林间'},{seat:2,name:'晚风'}], replayAvailable:true };
const matchRecords = presentMatches([
  {...match,id:'lancelot',role:'蓝兰斯洛特',winner:null,endedAt:new Date(2026,9,11,23,33).getTime(),outcome:'excluded',excludedReason:'对局终止',score:{status:'excluded',reason:'对局终止'}},
  {...match,id:'assassin',boardName:'阿瓦隆 · 十二骑士（11人）',capacity:11,role:'刺客',winner:'good',endedAt:new Date(2026,9,11,23,29).getTime(),outcome:'loss',score:{status:'scored',total:0,breakdown:[]},fun:{status:'complete',highlights:[{id:'assassin_miss',label:'歪刀',count:1}],events:[{id:'assassin_miss',role:'刺客',label:'歪刀',detail:'目标：2号'}]}},
  {...match,id:'gareth',role:'蓝刀客·加雷斯',faction:'good',endedAt:new Date(2026,9,11,22,11).getTime(),outcome:'loss',score:{status:'scored',total:1,breakdown:[{id:'knife',label:'刀中敌方',points:1}]}},
  {...match,id:'morgana',role:'莫甘娜',endedAt:new Date(2026,9,11,20,21).getTime(),outcome:'win',score:{status:'scored',total:3,breakdown:[{id:'win',label:'阵营获胜',points:3}]}},
  ...Array.from({length:13},(_,i)=>({...match,id:'earlier-'+i,role:'莫甘娜',endedAt:new Date(2026,9,10,22,59-i).getTime(),outcome:i<2?'win':i<5?'loss':'excluded',replayAvailable:false,score:{status:'legacy'}})),
]);
const history = {...createHistory().data,loading:false,loaded:true,filtersAvailable:true,records:matchRecords,total:17,outcomeSummary:'3 胜 · 5 负 · 9 场不计入',outcomeCounts:{wins:3,losses:5,excluded:9}};
const compactStats = presentStats({ total: 3, wins: 1, winRate: 33.3, byFaction: [], byRole: [], byBoard: [], recent: [], fun: { legacyGames: 1, cards: [
  { id: 'knights:survival', metrics: [{ ...metric('survival_revive', 0, 0, true), value: null }, metric('survival_knifed', 1, 0, true)] },
  { id: 'knights:shield', title: '好人', metrics: [shield] },
  { id: 'knights:assassin', title: '刺客', metrics: [metric('assassin_hit', 0, 1, true), metric('assassin_miss', 1, 1, false)] },
  { id: 'knights:kill', metrics: [{ ...metric('kill_enemy', 0, 3, true), byRole: knife[0].byRole }, metric('kill_ally', 0, 3, false)] },
  { id: 'knights:knife', metrics: knife },
] } });
const stressRecords = presentMatches([{...match,id:'long',role:'觉醒蓝刀客·加赫雷斯',boardName:'阿瓦隆 · 十二骑士与扩展角色（12人）',faction:'good',outcome:'loss',endedAt:new Date(2026,9,11,23,33).getTime(),score:{status:'scored',total:-12},fun:{highlights:[{id:'good_shield',label:'成功挡刀',count:1},{id:'knife_enemy',label:'刀中敌方',count:12}]}}]);
const timelineEvents = [
  ...[1,2,3].map(round=>({id:'revive-'+round,round,kind:'revive',label:'复活',detail:'抽取新身份复活'})),
  ...[1,2,3].map(round=>({id:'received-'+round,round,kind:'receivedKnife',label:'被刀',detail:["2号出刀 · 目标出局","4号出刀 · 目标出局","5号出刀 · 目标已出局"][round-1]})),
  ...[1,2,3].map(round=>({id:'attack-'+round,round,kind:round===3?'duel':'knife',role:['蓝刀客·加雷斯','觉醒蓝刀客','红骑士'][round-1],label:round===3?'未生效':'刀中友方',detail:round===3?'5号同阵营 · 决斗失败':(round+1)+'号同阵营 · 目标出局'})),
];
const timelineRecord = {...presentMatches([{...match,id:'timeline',role:'红骑士',faction:'evil',outcome:'loss',winner:'good',endedAt:new Date(2026,9,16,20,38).getTime(),score:{status:'scored',total:0,breakdown:[]},fun:{status:'recorded',initialRole:'蓝刀客·加雷斯',events:timelineEvents},members:Array.from({length:12},(_,i)=>({seat:i+1,name:i?'同桌玩家'+(i+1):'林间'}))}])[0],expanded:true};
const scenes = {
  overview: {tab:'records',statistics:{stats}}, fun: {tab:'fun',statistics:{stats}},
  'fun-compact': {tab:'fun',statistics:{stats:compactStats}},
  'fun-compact-roles': {tab:'fun',statistics:{stats:compactStats,funRoles:{'knights:knife_enemy':true,'knights:kill_enemy':true}}},
  expanded: {tab:'records',statistics:{stats:{...stats,byFaction:stats.byFaction.map(row=>({...row,expanded:true}))}}},
  'good-roles': {tab:'records',statistics:{stats,roleFilter:'good',roleRows:stats.byRole.filter(row=>row.faction==='good')}},
  'evil-roles': {tab:'records',statistics:{stats,roleFilter:'evil',roleRows:stats.byRole.filter(row=>row.faction==='evil')}},
  'role-detail': {tab:'records',statistics:{stats,statsDetail:{...stats.byRole[3],kind:'role',title:stats.byRole[3].role,losses:0}}},
  'faction-detail': {tab:'records',statistics:{stats,statsDetail:{...stats.byFaction[0],kind:'faction',title:stats.byFaction[0].label,losses:4}}},
  roles: {tab:'fun',statistics:{stats,funRoles:{'knights:knife_enemy':true}}},
  empty: {tab:'records',statistics:{stats:presentStats({total:0,wins:0,winRate:null,byFaction:[],byRole:[],byBoard:[],recent:[]})}},
  history: {tab:'matches',historyStarted:true,history},
  'history-expanded': {tab:'matches',historyStarted:true,history:{...history,records:matchRecords.map((record,index)=>({...record,expanded:index<2,membersExpanded:index===1}))}},
  'history-timeline': {tab:'matches',historyStarted:true,history:{...history,records:[timelineRecord],total:1,outcomeSummary:'0 胜 · 1 负',outcomeCounts:{wins:0,losses:1,excluded:0}}},
  'history-timeline-long': {tab:'matches',historyStarted:true,history:{...history,records:[{...timelineRecord,fun:require('../miniprogram/fun-copy').story({...timelineRecord.fun,events:[...timelineEvents,{id:'long',round:1,kind:'knife',role:'觉醒蓝刀客·加赫雷斯',label:'刀中友方',detail:'9号同阵营 · 目标因魔术师换号避开伤害 · 实际承受者12号'},{id:'final',role:'红骑士',label:'未生效',detail:'本局最终结果未记录'}]})}],total:1,outcomeSummary:''}},
  'history-filters': {tab:'matches',historyStarted:true,history:{...history,filtersExpanded:true}},
  'history-empty': {tab:'matches',historyStarted:true,history:{...history,records:[],total:0,outcomeSummary:'',outcomeCounts:null}},
  'history-long': {tab:'matches',historyStarted:true,history:{...history,records:stressRecords,total:1,outcomeSummary:'0 胜 · 1 负',outcomeCounts:{wins:0,losses:1,excluded:0}}},
};
// Accepted title grid, using the counts from the design review as sample data.
const gridCounts = { honor_mvp:1, honor_svp:0, survival_revive:0, survival_knifed:4,
  percival_green:0, percival_bust:1, merlin_evade:1, merlin_hit:0, good_shield:2, assassin_hit:0, assassin_miss:2 };
const gridFun = fun.aggregate(fun.publicMetrics().map(def => ({ metric:def.id, mode:def.countOnly && def.id.startsWith('honor_')?'voted':'knights',
  role:'all', role_label:def.title, match_id:'preview', status:Object.hasOwn(gridCounts,def.id)?'known':'unknown', count:gridCounts[def.id]||0,
  opportunities:def.countOnly?0:def.id==='good_shield'?6:def.id.startsWith('assassin_')?2:Object.hasOwn(gridCounts,def.id)?1:0 })));
const gridStats = { ...stats, fun:presentFun(gridFun) };
scenes['fun-grid'] = {tab:'fun',statistics:{stats:gridStats,funFilter:'all'}};
scenes['fun-grid-counted'] = {tab:'fun',statistics:{stats:gridStats,funFilter:'counted'}};
scenes['fun-grid-empty-filter'] = {tab:'fun',statistics:{stats:{...stats,fun:presentFun({cards:[{id:'knights:survival',metrics:[{...metric('survival_revive',0,0,true),value:null}]}]})},funFilter:'counted'}};
for (const [name, id] of [['fun-grid-info','survival_knifed'],['fun-grid-info-long','kill_enemy'],['fun-grid-info-rate','good_shield'],['fun-grid-info-zero','percival_green']]) {
  const tile = gridStats.fun.tiles.find(row => row.id === id);
  scenes[name] = { ...scenes['fun-grid'], info:require('../miniprogram/dialog').present(require('../miniprogram/fun-copy').recordInfo(tile)) };
}
const styles = css('app.wxss') + css('components/app-nav/app-nav.wxss') + css('pages/stats/stats.wxss') + css('components/app-dialog/app-dialog.wxss');
const projection = 'body{margin:0}button{font:inherit;border:0;width:100%}span{display:inline}img{object-fit:contain}body .records-shell{padding-bottom:28px}.records-pane{overflow-y:auto}.preview-nav{position:relative;flex-shrink:0}.preview-clock{position:absolute;z-index:101;top:14px;left:28px;font-size:14px;font-weight:600}.preview-capsule{position:absolute;z-index:101;right:16px;top:50px;height:32px;width:87px;border:1px solid #65747b;border-radius:18px;display:flex;align-items:center;justify-content:space-evenly;font-size:14px;background:#0c171d}.preview-capsule i{height:17px;width:1px;background:#65747b}.preview-capsule b{font-size:24px;font-weight:500}.preview-homebar{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);height:4px;width:132px;border-radius:4px;background:#c5cbd0;pointer-events:none}';
fs.mkdirSync(output, { recursive: true });
for (const [name, data] of Object.entries(scenes)) fs.writeFileSync(path.join(output, name + '.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>战绩 · ${name}</title><style>${projection}${styles}</style>${html(factory('pages/stats/stats.wxml')({statistics:{},history:{},historyStarted:false,scrollTops:{},...data}))}${data.info ? html(factory('components/app-dialog/app-dialog.wxml')({dialog:data.info,bodyHeight:0})) : ''}<div class="preview-homebar"></div></html>`);
const meProfile=presentProfile({nickname:'子龙',identityType:'wx',avatarUrl:''});
meProfile.avatarUrl='/pages/profile/assets/avatars/crayon-07.jpg';
const meStyles=css('app.wxss')+css('components/app-nav/app-nav.wxss')+css('pages/me/me.wxss')+css('custom-tab-bar/index.wxss');
for (const [name,personal] of Object.entries({
  me:{profile:meProfile,stats,currentRoom:{code:'620816',status:'lobby',statusLabel:'待开局',boardLabel:'十二骑士',capacity:12,relationLabel:'我在 3 号'}},
  'me-empty':{profile:meProfile,stats:scenes.empty.statistics.stats},
  'me-loading':{profile:meProfile,loading:true},
})) {
  const page=html(factory('pages/me/me.wxml')({activeTab:1,lobby:{},personal}));
  const tabs=html(factory('custom-tab-bar/index.wxml')({selected:1,list:[
    {pagePath:'pages/lobby/lobby',text:'对局',icon:'/assets/tab-table.png',activeIcon:'/assets/tab-table-active.png'},
    {pagePath:'pages/me/me',text:'我的',icon:'/assets/tab-me.png',activeIcon:'/assets/tab-me-active.png'},
  ]}));
  fs.writeFileSync(path.join(output,name+'.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>我的 · 实际模板</title><style>${projection}${meStyles}a{text-decoration:none;cursor:pointer}</style>${page}${tabs}<div class="preview-homebar"></div></html>`);
}
fs.writeFileSync(path.join(output, 'gallery.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>战绩 · 实际模板</title><style>body{margin:0;background:#0c151b;color:#f2eee5;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.board{display:flex;gap:64px;padding:32px 48px 36px;width:844px}h2{font-size:15px;font-weight:500;margin:0 0 16px;height:38px;display:flex;align-items:center;gap:12px}h2 span{font-size:12px;color:#e5c68b}iframe{border:1px solid #3a4750;border-radius:30px;width:390px;height:844px;background:#101c24;display:block}</style><div class="board">' + [['overview','统计'],['fun','趣味记录']].map(([name,label],index)=>`<section><h2><span>0${index+1}</span>${label}</h2><iframe src="${name}.html" title="${label}"></iframe></section>`).join('') + '</div></html>');
console.log('Production WXML projections: ' + output);
fs.writeFileSync(path.join(output,'personal-gallery.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>桌边助手 · 我的与统计</title><style>body{margin:0;background:#09141c;color:#f2eee5;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.board{width:900px;padding:36px 48px 24px}.heading{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}.heading strong{font-size:26px}.heading span{font-size:12px;color:#b1bfc6}.screens{display:flex;gap:48px}h2{margin:0 0 12px;font-size:14px;font-weight:500}h2 span{color:#e5c68b;margin-right:10px;font-size:12px}iframe{display:block;width:390px;height:1200px;border:1px solid #344752;border-radius:28px;background:#101c24}.note{margin-top:20px;color:#b1bfc6;font-size:11px}</style><main class="board"><header class="heading"><strong>桌边助手</strong><span>深色改造 · 实际页面模板</span></header><div class="screens"><section><h2><span>01</span>我的</h2><iframe src="me.html" title="我的"></iframe></section><section><h2><span>02</span>数据统计</h2><iframe src="overview.html" title="数据统计"></iframe></section></div><p class="note">透明角色插画 · 阵营筛选 · 点击查看战绩详情</p></main></html>`);
