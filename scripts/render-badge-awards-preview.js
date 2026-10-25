// Layout-only projection of the production shared dialog, not another client.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {wxmlToJs}=require('miniprogram-compiler');
const {catalogue}=require('../miniprogram/badges');
const {present,markup}=require('../miniprogram/badge-awards');
const root=path.resolve(__dirname,'../miniprogram'),out=path.resolve(__dirname,'../output/playwright/october-awards-implemented');
fs.mkdirSync(out,{recursive:true});
const context={window:{},global:{},console};vm.createContext(context);
const factory=vm.runInContext('(function(global){'+wxmlToJs(root)+'})(global)',context);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function asset(src) {
  const local=path.join(root,src),file=fs.existsSync(local)?local:path.resolve(__dirname,'../server/web/assets',path.basename(src));
  return 'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
}
function css(file) {
  return fs.readFileSync(path.join(root,file),'utf8').replace(/@import\s+"([^"]+)";/g,(_,p)=>css(path.relative(root,path.resolve(root,path.dirname(file),p))))
    .replace(/(^|[\s>+~,])(view|text|image|scroll-view)(?=[\s.:#\[>+~,{])/gm,(_,a,b)=>a+({view:'div',text:'span',image:'img','scroll-view':'div'})[b])
    .replace(/^page\s*\{/gm,'body {').replace(/(-?[\d.]+)rpx/g,'calc($1 * 100vw / 750)');
}
function html(n) {
  if(typeof n==='string'||typeof n==='number')return esc(n);
  if(!n.tag||n.tag==='wx-block')return(n.children||[]).map(html).join('');
  const tag=({'wx-text':'span','wx-button':'button','wx-image':'img'})[n.tag]||'div';
  const attrs=Object.entries(n.attr||{}).flatMap(([k,v])=>{
    if(k.startsWith('aria'))k=k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    if(k==='src'&&v.startsWith('/'))v=asset(v);
    return ['class','style','src','role','aria-label','aria-hidden','aria-modal'].includes(k)?[k+'="'+esc(v)+'"']:[];
  }).join(' ');
  return '<'+tag+' '+attrs+'>'+(n.children||[]).map(html).join('')+(tag==='img'?'':'</'+tag+'>');
}
const defs=catalogue.filter(b=>b.permanent),find=s=>defs.find(b=>b.id==='october_2026_'+s);
const scenes={champion:[find('crown'),find('table'),find('book')],runner:[find('silver'),find('table'),find('book')],third:[find('stag'),find('table'),find('book')],scored:[find('table'),find('book')],participant:[find('table')]};
const base=css('app.wxss')+css('components/app-dialog/app-dialog.wxss')+'body{margin:0}button{font-family:inherit}img{object-fit:contain}.award-scroll{overflow-y:auto}';
const fit=`<script>function fit(){const box=document.querySelector('.award-scroll'),body=document.querySelector('.award-scroll-content'),actions=document.querySelector('.award-actions');if(box&&body)box.style.height=Math.min(body.getBoundingClientRect().height,innerHeight-50-actions.getBoundingClientRect().height)+'px';}addEventListener('load',fit);addEventListener('resize',fit);</script>`;
for(const[name,badges]of Object.entries(scenes)) {
  const value=present({badges});
  const native=html(factory('components/app-dialog/app-dialog.wxml')({dialog:{variant:'badge-awards',title:value.title,awards:value,id:1},bodyHeight:0,awardDetail:null}));
  const wrap=(body,extra='')=>'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>十月徽章 · '+name+'</title><style>'+base+'</style><body>'+body+extra+'</body></html>';
  fs.writeFileSync(path.join(out,name+'.html'),wrap(native,fit));
  const inline=JSON.parse(JSON.stringify(value));for(const b of [...inline.badges,...inline.secondary,...(inline.hero?[inline.hero]:[])])b.imageUrl=asset(b.imageUrl);
  fs.writeFileSync(path.join(out,'web-'+name+'.html'),wrap('<div class="app-dialog-backdrop">'+markup(inline,esc)+'</div>'));
}
console.log(out);
