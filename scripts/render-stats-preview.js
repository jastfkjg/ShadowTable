// Project production WXML/WXSS into HTML for visual QA; native behavior needs device QA.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { wxmlToJs } = require('miniprogram-compiler');
const { presentStats, presentMatches } = require('../miniprogram/profile');
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
  const tag = ({ 'wx-text': 'span', 'wx-button': 'button', 'wx-image': 'img' })[node.tag] || 'div';
  const attrs = Object.entries(node.attr || {}).flatMap(([key, value]) => {
    if (key === 'hidden' || key === 'disabled') return value ? [key] : [];
    if (key.startsWith('aria')) key = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    if (key === 'src' && value.startsWith('/')) value = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, value)).toString('base64');
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
  byFaction: [{faction:'good',label:'好人阵营',total:6,wins:2,winRate:33.3,score:{total:6,games:4,average:1.5}}, {faction:'evil',label:'坏人阵营',total:2,wins:1,winRate:50,score:{total:3,games:2,average:1.5}}],
  byRole: ['梅林','派西维尔','忠臣','守护者','猎人','刺客','莫甘娜'].map((role, index) => ({role,faction:index<5?'good':'evil',total:index?1:2,wins:index<2||index===5?1:0,winRate:index?index<2||index===5?100:0:50})),
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
const stressRecords = presentMatches([{...match,id:'long',role:'觉醒蓝刀客·加赫雷斯',boardName:'阿瓦隆 · 十二骑士与扩展角色（12人）',faction:'good',outcome:'loss',endedAt:new Date(2026,9,11,23,33).getTime(),score:{status:'scored',total:-12},fun:{highlights:[{id:'good_shield',label:'成功挡刀',count:1},{id:'knife_enemy',label:'刀中敌方',count:12}]}}]);
const scenes = {
  overview: {tab:'records',statistics:{stats}}, fun: {tab:'fun',statistics:{stats}},
  expanded: {tab:'records',statistics:{stats:{...stats,byFaction:stats.byFaction.map(row=>({...row,expanded:true}))}}},
  roles: {tab:'fun',statistics:{stats,funRoles:{'knights:knife':true},funRulesExpanded:true}},
  empty: {tab:'records',statistics:{stats:presentStats({total:0,wins:0,winRate:null,byFaction:[],byRole:[],byBoard:[],recent:[]})}},
  history: {tab:'matches',historyStarted:true,history},
  'history-expanded': {tab:'matches',historyStarted:true,history:{...history,records:matchRecords.map((record,index)=>({...record,expanded:index<2,membersExpanded:index===1}))}},
  'history-filters': {tab:'matches',historyStarted:true,history:{...history,filtersExpanded:true}},
  'history-empty': {tab:'matches',historyStarted:true,history:{...history,records:[],total:0,outcomeSummary:'',outcomeCounts:null}},
  'history-long': {tab:'matches',historyStarted:true,history:{...history,records:stressRecords,total:1,outcomeSummary:'0 胜 · 1 负',outcomeCounts:{wins:0,losses:1,excluded:0}}},
};
const styles = css('app.wxss') + css('components/app-nav/app-nav.wxss') + css('pages/stats/stats.wxss');
const projection = 'body{margin:0}button{font:inherit;border:0;width:100%}span{display:inline}img{object-fit:contain}body .records-shell{padding-bottom:28px}.records-pane{overflow-y:auto}.preview-nav{position:relative;flex-shrink:0}.preview-clock{position:absolute;z-index:101;top:14px;left:28px;font-size:14px;font-weight:600}.preview-capsule{position:absolute;z-index:101;right:16px;top:50px;height:32px;width:87px;border:1px solid #65747b;border-radius:18px;display:flex;align-items:center;justify-content:space-evenly;font-size:14px;background:#0c171d}.preview-capsule i{height:17px;width:1px;background:#65747b}.preview-capsule b{font-size:24px;font-weight:500}.preview-homebar{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);height:4px;width:132px;border-radius:4px;background:#c5cbd0;pointer-events:none}';
fs.mkdirSync(output, { recursive: true });
for (const [name, data] of Object.entries(scenes)) fs.writeFileSync(path.join(output, name + '.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>战绩 · ${name}</title><style>${projection}${styles}</style>${html(factory('pages/stats/stats.wxml')({statistics:{},history:{},historyStarted:false,scrollTops:{},...data}))}<div class="preview-homebar"></div></html>`);
fs.writeFileSync(path.join(output, 'gallery.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><title>战绩 · 实际模板</title><style>body{margin:0;background:#0c151b;color:#f2eee5;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.board{display:flex;gap:64px;padding:32px 48px 36px;width:844px}h2{font-size:15px;font-weight:500;margin:0 0 16px;height:38px;display:flex;align-items:center;gap:12px}h2 span{font-size:12px;color:#e5c68b}iframe{border:1px solid #3a4750;border-radius:30px;width:390px;height:844px;background:#101c24;display:block}</style><div class="board">' + [['overview','统计'],['fun','趣味记录']].map(([name,label],index)=>`<section><h2><span>0${index+1}</span>${label}</h2><iframe src="${name}.html" title="${label}"></iframe></section>`).join('') + '</div></html>');
console.log('Production WXML projections: ' + output);
