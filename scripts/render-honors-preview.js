// Render real WXML/WXSS with example election data for visual verification.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { wxmlToJs } = require('miniprogram-compiler');
const hp = require('../miniprogram/honors');
const { presentStats } = require('../miniprogram/profile');
const { presentBoard } = require('../miniprogram/leaderboard-presentation');
const fun = require('../server/fun');
const root = path.resolve(__dirname, '../miniprogram'), output = path.resolve(__dirname, '../output/playwright/honors');
const context = { window:{}, global:{}, console }; vm.createContext(context);
const factory = vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const css = file => fs.readFileSync(path.join(root,file),'utf8').replace(/@import\s+"([^"]+)";/g,(_,name)=>css(path.relative(root,path.resolve(root,path.dirname(file),name)))).replace(/([\s>+~])(text|image|picker)(?=[\s.:#\[>+~,{])/g,(_,prefix,tag)=>prefix+({text:'span',image:'img',picker:'div'})[tag]).replace(/^page\s*\{/m,'body {').replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');
function html(n) {
  if(typeof n==='string'||typeof n==='number')return esc(n);
  if(!n.tag||n.tag==='wx-block')return(n.children||[]).map(html).join('');
  if(n.tag==='wx-app-nav')return html(factory('components/app-nav/app-nav.wxml')({...n.attr,statusBarHeight:24,navHeight:44,totalHeight:68}));
  const tag=({'wx-text':'span','wx-button':'button','wx-image':'img'})[n.tag]||'div';
  const attrs=Object.entries(n.attr||{}).flatMap(([k,v])=>{
    if(k==='hidden'||k==='disabled')return v?[k]:[];
    if(k==='src'&&v.startsWith('/'))v='data:image/'+(v.endsWith('.svg')?'svg+xml':'jpeg')+';base64,'+fs.readFileSync(path.join(root,v)).toString('base64');
    if(k==='style')v=String(v).replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');
    return ['class','style','src','role'].includes(k)?[k+'="'+esc(v)+'"']:[];
  }).join(' ');
  return '<'+tag+' '+attrs+'>'+(n.children||[]).map(html).join('')+(tag==='img'?'':'</'+tag+'>');
}
const players=['小鱼','林间','阿风','大野','晚风','小树'].map((name,i)=>({seat:i+1,name,avatarUrl:'/pages/profile/assets/avatars/avatar-0'+(i+1)+'.jpg',disabled:i===0}));
const poll=hp.present({matchId:'example',status:'open',canVote:true,canClose:true,ballot:null,completed:3,total:6,required:3,deadline:120000,serverNow:35000,groups:[{key:'mvp',title:'最强 MVP',side:'胜方',players:players.slice(0,4),skip:false},{key:'svp',title:'最强 SVP',side:'败方',players:players.slice(4),skip:false}]});
const awards=hp.present({status:'settled',completed:6,total:6,required:3,mvp:[{...players[1],votes:3},{...players[2],votes:3}],svp:[{...players[4],votes:4}]});
const single=hp.present({...awards,mvp:[{...players[1],votes:4}]});
const longNames=hp.present({...awards,mvp:[{...players[1],name:'长昵称测试玩家甲乙丙丁戊己庚辛',votes:3},{...players[2],name:'CaptainLongNames',votes:3}]});
const room={code:'628419',boardName:'阿瓦隆 · 6 人局',phase:'ended',stage:4,game:1,capacity:6,players:[],me:{seat:1,isHost:true},result:{winner:'good',source:'manual'},scoreSettings:{enabled:false},myScore:{status:'excluded',reason:'本局未开启计分'},history:[],team:[]};
const base={room,loading:false,network:true,busy:false,hasPendingRequest:false,isLobby:false,history:[],seats:[],seatsExpanded:false};
const stats=presentStats({total:12,wins:8,losses:4,winRate:66.7,byFaction:[],byRole:[],byBoard:[],recent:[],fun:fun.aggregate(['honor_mvp','honor_svp'].flatMap((metric,i)=>Array.from({length:12},(_,n)=>({metric,mode:'voted',role:'all',role_label:'玩家票选',match_id:String(n),status:'known',count:n<(i?5:8)?1:0,opportunities:0}))))});
const rank=presentBoard({fun:true,countOnly:true,metric:'fun_honor_mvp',metricLabel:'获奖次数',period:'all',sort:'count',unit:'次',availableFunMetrics:fun.publicMetrics(),rows:players.slice(1,4).map((p,i)=>({...p,nickname:p.name,publicId:'p'+i,initial:p.name[0],rank:i+1,count:[12,9,8][i],knownGames:12,isSelf:i===2})),me:{rank:3,count:8,knownGames:12,status:'ranked'},eligibleCount:3});
const scenes={
  entry:['pages/table/table.wxml',{...base,honors:hp.present({status:'not_started',matchId:'example',canStart:true})}],
  ballot:['pages/table/table.wxml',{...base,honors:poll,honorDialog:true,...hp.selection(poll,{mvp:2,svp:5})}],
  awards:['pages/table/table.wxml',{...base,honors:awards}],
  'awards-single':['pages/table/table.wxml',{...base,honors:single}],
  'awards-long':['pages/table/table.wxml',{...base,honors:longNames}],
  stats:['pages/stats/stats.wxml',{tab:'fun',statistics:{stats},history:{},scrollTops:{}}],
  rank:['pages/leaderboard/leaderboard.wxml',{board:rank,metric:rank.metric,period:'all',funSelected:true,funSort:'count',pointsAvailable:true,funAvailable:true,groups:require('../miniprogram/leaderboard').groups,funOptions:require('../miniprogram/leaderboard-presentation').funOptions(fun.publicMetrics()),funRoleOptions:[],visible:true}],
  archive:['pages/match-detail/match-detail.wxml',{record:{...room,boardName:room.boardName,honors:awards,score:{},members:[],dayLabel:'2026年10月12日',timeLabel:'22:00',winner:'good',winnerLabel:'好人',sourceLabel:'房主登记'}}],
};
const styles=css('app.wxss')+css('components/app-nav/app-nav.wxss')+css('pages/stats/stats.wxss')+css('pages/leaderboard/leaderboard.wxss');
fs.mkdirSync(output,{recursive:true});
for(const[name,[template,data]]of Object.entries(scenes))fs.writeFileSync(path.join(output,name+'.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>最佳玩家 · '+name+'</title><style>button{font:inherit;border:0;width:100%}'+styles+'body{margin:0}button{font:inherit}span{display:inline}img{object-fit:cover}.honor-player-copy .honor-player-name,.honor-player-copy .honor-help{display:block}</style>'+html(factory(template)(data))+'</html>');
fs.writeFileSync(path.join(output,'gallery.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MVP / SVP · 已实现界面</title><style>body{margin:0;background:#0c151b;color:#f2eee5;font:16px -apple-system,"PingFang SC",sans-serif;padding:32px}h1{font-size:26px;margin:0 0 12px}p{color:#b1bfc6;margin:0 0 28px}.grid{display:flex;gap:24px}h2{font-size:16px;font-weight:500}iframe{width:375px;height:812px;border:1px solid #536570;border-radius:24px;background:#101c24}</style><h1>MVP / SVP 玩家票选</h1><p>真实小程序模板 · 示例数据 · 结算页展示全部并列获奖玩家</p><div class="grid">'+[['ballot','01 玩家投票'],['awards','02 本局最佳 · 平票'],['stats','03 趣味记录'],['rank','04 趣味排行榜']].map(([name,label])=>'<section><h2>'+label+'</h2><iframe src="'+name+'.html" title="'+label+'"></iframe></section>').join('')+'</div></html>');
console.log(output);
