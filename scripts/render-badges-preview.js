// Static visual fixtures rendered from the real mini-program templates.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {wxmlToJs}=require('miniprogram-compiler');
const {catalogue}=require('../miniprogram/badges');
const root=path.resolve(__dirname,'../miniprogram'),output=path.resolve(__dirname,'../output/playwright/badges');
const context={window:{},global:{},console};vm.createContext(context);
const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function css(file){return fs.readFileSync(path.join(root,file),'utf8').replace(/@import\s+"([^"]+)";/g,(_,name)=>css(path.relative(root,path.resolve(root,path.dirname(file),name)))).replace(/([\s>+~])(text|image)(?=[\s.:#\[>+~,{])/g,(_,p,t)=>p+({text:'span',image:'img'})[t]).replace(/^page\s*\{/m,'body {').replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');}
function html(n){
 if(typeof n==='string'||typeof n==='number')return esc(n);
 if(!n.tag||n.tag==='wx-block')return(n.children||[]).map(html).join('');
 const tag=({'wx-text':'span','wx-button':'button','wx-image':'img'})[n.tag]||'div';
 const attrs=Object.entries(n.attr||{}).flatMap(([k,v])=>{
  if(k==='hidden'||k==='disabled')return v?[k]:[];
  if(k==='src'&&v.startsWith('/'))v='data:image/'+(v.endsWith('.png')?'png':'jpeg')+';base64,'+fs.readFileSync(path.join(root,v)).toString('base64');
  if(k==='style')v=String(v).replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');
  return ['class','style','src','role','aria-label'].includes(k)?[k+'="'+esc(v)+'"']:[];
 }).join(' ');
 return '<'+tag+' '+attrs+'>'+(n.children||[]).map(html).join('')+(tag==='img'?'':'</'+tag+'>');
}
const base={playerCard:{id:'preview',scope:'leaderboard',name:'阿伟',initial:'阿',avatarUrl:'/pages/profile/assets/avatars/sketch-01.jpg',badges:catalogue.slice(0,3)},playerCardStats:{total:6,wins:6,rateLabel:'100.0%',scoreTotal:19,byFaction:[{faction:'evil',label:'坏人阵营',total:4,wins:4,rateLabel:'100.0%',winRate:100},{faction:'good',label:'好人阵营',total:2,wins:2,rateLabel:'100.0%',winRate:100}]},playerCardStatus:'available'};
const scenes={card:base,detail:{...base,playerCardBadge:catalogue[0]},many:{...base,playerCard:{...base.playerCard,name:'昵称很长的阿瓦隆玩家甲乙丙丁',badges:catalogue.slice(3,6)}}};
const single = {...base, playerCard:{id:'preview',seat:8,name:'月下江头',initial:'月',badges:[catalogue.find(b=>b.id==='merlin_evade')]},playerCardStats:{total:5,wins:2,rateLabel:'40.0%',scoreTotal:6,byFaction:[{faction:'evil',label:'坏人阵营',total:2,wins:1,winRate:50,rateLabel:'50.0%'},{faction:'good',label:'好人阵营',total:3,wins:1,winRate:100/3,rateLabel:'33.3%'}]}};
scenes.single=single;
scenes.singleDetail={...single,playerCardBadge:single.playerCard.badges[0]};
scenes.two={...single,playerCard:{...single.playerCard,badges:catalogue.slice(0,2)}};
scenes.empty={...single,playerCard:{...single.playerCard,badges:[]},playerCardStats:{total:0,wins:0,rateLabel:'—',scoreTotal:0,byFaction:[]}};
const standin=catalogue.find(b=>b.id==='good_shield');
scenes.standin={...single,playerCard:{...single.playerCard,badges:[standin]},playerCardBadge:standin};
fs.mkdirSync(output,{recursive:true});
const styles=css('app.wxss');
const meData={activeTab:1,personal:{profile:{displayName:'阿伟',initial:'阿',identityType:'wx'},badgeManagerOpen:true,badgeCollection:{equippedCount:3,badges:catalogue.slice(0,5).map((b,i)=>({...b,equipped:i<3}))}}};
fs.writeFileSync(path.join(output,'me.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>button{font:inherit;border:0;width:100%}'+styles+css('pages/me/me.wxss')+'body{margin:0}</style>'+html(factory('pages/me/me.wxml')(meData))+'</html>');
for(const[name,data]of Object.entries(scenes))fs.writeFileSync(path.join(output,name+'.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>荣誉徽章 · '+name+'</title><style>button{font:inherit;border:0}'+styles+'body{margin:0}img{object-fit:contain}.player-card-badges{overflow-x:auto}.player-card-body{overflow-y:auto}.player-card-identity img{object-fit:cover}</style>'+html(factory('player-card.wxml')(data))+'</html>');
const badgeCollection = require('../miniprogram/badges').presentCollection({badges:catalogue.filter(b=>['games','assassin_miss'].includes(b.id)).map(b=>({...b,equipped:true})),periodStart:Date.UTC(2026,8,30,16)});
const standinCollection=require('../miniprogram/badges').presentCollection({badges:[{...standin,equipped:true}],periodStart:Date.UTC(2026,8,30,16)});
for(const [name,data] of Object.entries({collection:{badgeCollection,badgeFilter:'all'},collectionEmpty:{badgeCollection:require('../miniprogram/badges').presentCollection({badges:[]}),badgeFilter:'all'},collectionDetail:{badgeCollection,badgeFilter:'all',selectedBadge:badgeCollection.items.find(b=>b.id==='games')},standinCollection:{badgeCollection:standinCollection,badgeFilter:'all'},standinDetail:{badgeCollection:standinCollection,badgeFilter:'all',selectedBadge:standinCollection.items.find(b=>b.id==='good_shield')}})) {
  const nav='<div style="height:64px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600">荣誉徽章</div>';
  fs.writeFileSync(path.join(output,name+'.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>荣誉徽章</title><style>button{font:inherit;border:0;width:100%}'+styles+css('pages/badges/badges.wxss')+'body{margin:0}img{object-fit:contain}</style>'+nav+html(factory('pages/badges/badges.wxml')(data))+'</html>');
}
fs.writeFileSync(path.join(output,'gallery.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>暗金荣誉 · 全部'+catalogue.length+'枚</title><style>body{background:#101c24;color:#f2eee5;font:16px -apple-system,"PingFang SC",sans-serif;padding:32px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:24px;text-align:center}img{width:160px;height:160px}h1{font-size:24px}</style><h1>暗金荣誉 · 全部 '+catalogue.length+' 枚</h1><div class="grid">'+catalogue.map(b=>'<div><img src="data:image/png;base64,'+fs.readFileSync(path.join(root,b.imageUrl)).toString('base64')+'"><div>'+esc(b.title)+'</div></div>').join('')+'</div></html>');
console.log(output);
