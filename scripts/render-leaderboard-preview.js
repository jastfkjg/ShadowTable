// Layout-only projection of production WXML/WXSS. Native WeChat behavior still needs device QA.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { wxmlToJs } = require('miniprogram-compiler');
const presentation = require('../miniprogram/leaderboard-presentation');
const { presentLeaderboard } = require('../miniprogram/leaderboard');
const root = path.resolve(__dirname, '../miniprogram');
const output = path.resolve(__dirname, '../output/playwright/leaderboard');
const pageFile = path.join(root, 'pages/leaderboard/leaderboard.js');
let definition;
vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), { require: createRequire(pageFile), Page: value => definition = value });
const context = {window:{}, global:{}, console}; vm.createContext(context);
const factory = vm.runInContext('(function(global){' + wxmlToJs(root) + '})(global)', context);
const safe = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const css = file => fs.readFileSync(path.join(root,file),'utf8').replace(/@import\s+"([^"]+)";/g, (_,name)=>css(path.relative(root,path.resolve(root,path.dirname(file),name))))
  .replace(/([\s>+~])(text|image)(?=[\s.:#\[>+~,{])/g, (_,prefix,tag)=>prefix+({text:'span',image:'img'})[tag])
  .replace(/^page\s*\{/m,'body {').replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');
function html(node) {
  if(typeof node==='string'||typeof node==='number')return safe(node);
  if(node.tag==='wx-app-nav')return '<div class="preview-nav">'+html(factory('components/app-nav/app-nav.wxml')({...node.attr,statusBarHeight:44,navHeight:44,totalHeight:88}))+'<span class="preview-clock">13:56</span><div class="preview-capsule">•••<i></i><b>⊙</b></div></div>';
  if(node.tag==='wx-switch')return '<input type="checkbox" role="switch" aria-label="在排行榜公开展示" '+(node.attr.checked?'checked':'')+'>';
  const tag=({'wx-text':'span','wx-button':'button','wx-image':'img','wx-label':'label'})[node.tag]||'div';
  const attrs=Object.entries(node.attr||{}).flatMap(([key,value])=>{
    if(key==='disabled')return value?['disabled']:[];
    if(key==='src'&&value.startsWith('/')) {
      const mime=({'.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(value)]||'application/octet-stream';
      value='data:'+mime+';base64,'+fs.readFileSync(path.join(root,value)).toString('base64');
    }
    if(key.startsWith('aria'))key=key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    if(key==='style')value=String(value).replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');
    return ['class','src','style','role','aria-label','aria-pressed','aria-expanded','aria-hidden'].includes(key)?[`${key}="${safe(value)}"`]:[];
  }).join(' ');
  return `<${tag} ${attrs}>${(node.children||[]).map(html).join('')}${tag==='img'?'':`</${tag}>`}`;
}
const defs=require('../server/fun').publicMetrics();
const rows=Array.from({length:7},(_,i)=>({publicId:'p'+i,nickname:i?'新朋友':'子龙',isSelf:i===0,rank:i?2:1,tied:i>0,total:i?2:3,wins:i<2?2:1,winRate:i===0?66.7:i===1?100:50,points:i?24:36}));
const base={period:'all',availableFunMetrics:defs,availableMetrics:['points','games','overall','good','evil'],rows,me:{...rows[0],status:'ranked'},eligibleCount:7,hasMore:false,threshold:1};
const shield={...base,metric:'fun_defense_ally',fun:true,title:'绝对防御',metricLabel:'保护友方次数',sort:'count',unit:'次',rows:[{...rows[0],count:1,opportunities:1,knownGames:1,rate:100}],me:{...rows[0],status:'ranked',count:1,opportunities:1,knownGames:1,rate:100},eligibleCount:1};
function scene(response,extra={}) {
  const board=presentLeaderboard(response),options=presentation.funOptions(defs),option=options.find(item=>item.key===response.metric)||options[0];
  return {...definition.data,loading:false,funAvailable:true,board,metric:response.metric,period:response.period,funSelected:!!response.fun,funSort:response.sort||'count',funOptions:options,
    funCategory:'all',pendingFunMetric:option.key,pendingFunOption:option,filteredFunOptions:options,funOptionsCanScroll:true,...extra};
}
const scenes=Object.fromEntries(['points','games','overall','good','evil'].map(metric=>[metric,scene({...base,metric,period:metric==='points'?'month':base.period})]));
scenes['points-day']=scene({...base,metric:'points',period:'day'});
const previewPlayers=[['阿伟',1,19,6,3],['wyc',2,12,6],['元',3,11,6,10],['橙C',3,11,4],['玉虚宫',5,10,6],['大V',6,9,5,8],['子龙',6,9,6,7],['老高',6,9,6,4],['小明',9,7,3]]
  .map(([nickname,rank,points,total,avatar],i)=>({publicId:'preview-'+i,nickname,rank,points,total,wins:1,winRate:16.7,isSelf:nickname==='子龙',avatarUrl:avatar?'/pages/profile/assets/avatars/crayon-'+String(avatar).padStart(2,'0')+'.jpg':''}));
scenes.redesign=scene({...base,metric:'points',period:'month',rows:previewPlayers,eligibleCount:9,me:{...previewPlayers[6],status:'ranked'}});
const allyRows=[{publicId:'ally-a',nickname:'玥玥子',rank:1,count:1,opportunities:4,knownGames:4,rate:25},{publicId:'ally-b',nickname:'元',rank:1,count:1,opportunities:5,knownGames:5,rate:20}];
const ally={...shield,metric:'fun_kill_ally',title:'痛击队友',metricLabel:'击杀友方次数',rows:allyRows,eligibleCount:2,me:{status:'not_enough',rank:null,count:0,opportunities:1,knownGames:1,rate:0,remaining:1}};
scenes.ally=scene(ally);
scenes['ally-rate']=scene({...ally,sort:'rate',unit:'%',rows:allyRows.map((row,i)=>({...row,rank:i+1})),metricLabel:'击杀友方发生率'});
scenes['ally-rules']=scene(ally,{rulesExpanded:true});
scenes.honor=scene({...ally,metric:'fun_honor_mvp',countOnly:true});
scenes.fun=scene(shield);scenes.sheet=scene(shield,{metricsExpanded:true});
scenes.good=scene(shield,{metricsExpanded:true,funCategory:'good',filteredFunOptions:presentation.filterFunOptions(presentation.funOptions(defs),'good')});
const standin={...shield,metric:'fun_good_shield',title:'金牌替身',metricLabel:'成功挡刀次数'};
scenes.standin=scene(standin);
scenes['standin-good']=scene(standin,{metricsExpanded:true,funCategory:'good',filteredFunOptions:presentation.filterFunOptions(presentation.funOptions(defs),'good')});
scenes['standin-rules']=scene(standin,{rulesExpanded:true});
scenes.evil=scene(shield,{metricsExpanded:true,funCategory:'evil',filteredFunOptions:presentation.filterFunOptions(presentation.funOptions(defs),'evil'),funOptionsCanScroll:false});
scenes.other=scene(shield,{metricsExpanded:true,funCategory:'other',filteredFunOptions:presentation.filterFunOptions(presentation.funOptions(defs),'other'),funOptionsCanScroll:false});
scenes.rules=scene({...base,metric:'overall'},{rulesExpanded:true});
scenes.mine=scene(shield,{mineExpanded:true});
scenes.empty=scene({...base,metric:'games',rows:[],eligibleCount:0,me:{status:'hidden',rank:null,total:0,wins:0,winRate:null}});
scenes.rate=scene({...shield,sort:'rate',unit:'%',metricLabel:'成功挡刀率',threshold:1},{mineExpanded:true});
scenes.long=scene({...base,metric:'points',period:'month',rows:[{...rows[0],nickname:'很长的玩家昵称用于检查换行与对齐',points:-1234567,rank:12345}],me:{...base.me,rank:12345,points:-1234567}});
const styles=css('app.wxss')+css('components/app-nav/app-nav.wxss')+css('pages/leaderboard/leaderboard.wxss');
const projection='.preview-nav{position:relative}.preview-clock{position:absolute;top:14px;left:28px;z-index:101;font-size:14px;font-weight:600}.preview-capsule{position:absolute;right:16px;top:50px;z-index:101;display:flex;align-items:center;justify-content:space-evenly;width:87px;height:32px;border:1px solid #65747b;border-radius:18px;background:#0c171d;font-size:14px}.preview-capsule i{width:1px;height:17px;background:#65747b}.preview-capsule b{font-size:24px;font-weight:500}';
fs.mkdirSync(output,{recursive:true});
for(const [name,data] of Object.entries(scenes))fs.writeFileSync(path.join(output,name+'.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>排行榜 · ${name}</title><style>body{margin:0}button{font:inherit;border:0;width:100%}img{object-fit:cover}.fun-metric-options,.rank-details-body,.rank-rules-body{overflow-y:auto}${projection}${styles}</style>${html(factory('pages/leaderboard/leaderboard.wxml')(data))}</html>`);
fs.writeFileSync(path.join(output,'gallery.html'),`<!doctype html><meta charset="utf-8"><title>排行榜 · 实际模板</title><style>body{background:#e9e5dd;font:14px sans-serif;margin:28px;display:flex;gap:24px;flex-wrap:wrap}iframe{width:375px;height:812px;border:0;border-radius:20px}a{color:#23333a}h2{font-size:16px}</style>`+Object.keys(scenes).map(name=>`<section><h2><a href="${name}.html">${name}</a></h2><iframe src="${name}.html" title="${name}"></iframe></section>`).join(''));
console.log('Production WXML projections: '+output);
