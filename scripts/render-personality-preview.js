// Project the production WXML/WXSS with authored fixtures; no real player data.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {wxmlToJs}=require("./miniprogram-compiler");
const quiz=require("../miniprogram/pages/personality/quiz.json"),scoring=require("../miniprogram/pages/personality/scoring"),present=require("../miniprogram/pages/personality/presentation");
const fixtures=require("../tests/fixtures/personality/reachability-v3.1.json").fixtures;
const root=path.resolve(__dirname,"../miniprogram"),out=path.resolve(process.argv[2]||"output/playwright/personality/native");
const context={window:{},global:{},console};vm.createContext(context);
const factory=vm.runInContext("(function(global){"+wxmlToJs(root)+"})(global)",context);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
function css(file){return fs.readFileSync(path.join(root,file),"utf8").replace(/@import\s+["']([^"']+)["'];/g,(_,name)=>css(path.relative(root,path.resolve(root,path.dirname(file),name)))).replace(/(^|[\s>+~,])(page|view|text|image|navigator|scroll-view)(?=[\s.:#\[>+~,{])/gm,(_,before,tag)=>before+({page:"body",view:"div",text:"span",image:"img",navigator:"a","scroll-view":"div"})[tag]).replace(/(-?[\d.]+)rpx/g,"calc($1 * 100vw / 750)");}
function html(node){
  if(typeof node==="string"||typeof node==="number")return esc(node);
  if(!node)return "";
  if(["wx-canvas","wx-app-dialog","wx-connection-state"].includes(node.tag))return "";
  if(node.tag==="wx-page-container")return node.attr?.show
    ? `<div class="preview-native-sheet">${(node.children||[]).map(html).join("")}</div>` : "";
  if(node.tag==="wx-app-nav")return html(factory("components/app-nav/app-nav.wxml")({...node.attr,statusBarHeight:24,navHeight:44,totalHeight:68}));
  const tag=({"wx-text":"span","wx-button":"button","wx-image":"img","wx-navigator":"a"})[node.tag]||"div";
  const attrs=Object.entries(node.attr||{}).flatMap(([key,value])=>{
    if(key==="disabled"||key==="hidden")return value?[key]:[];
    if(key.startsWith("aria"))key=key.replace(/[A-Z]/g,c=>"-"+c.toLowerCase());
    return ["id","class","src","role","style"].includes(key)||key.startsWith("aria-")?[`${key}="${esc(value)}"`]:[];
  }).join(" ");
  return `<${tag} ${attrs}>${(node.children||[]).map(html).join("")}${tag==="img"?"":`</${tag}>`}`;
}
const base={...require("../miniprogram/pages/personality/flow").create({storage:{}}).state(),loading:false};
const scenes={intro:base,resume:{...base,hasDraft:true,completedCount:12},q01:{...base,mode:"quiz",question:present.question("Q01")},q08:{...base,mode:"quiz",question:present.question("Q08")},tiebreak:{...base,mode:"quiz",question:present.question("T_STYLE")},rules:{...base,rulesOpen:true}};
scenes["q01-selected"]={...scenes.q01,question:present.question("Q01","B")};
scenes["q01-guide"]={...scenes.q01,rulesOpen:true};
for(const f of fixtures){
  const view=present.result(scoring.scoreQuiz(quiz,f.answers));
  scenes[f.expectedTypeId]={...base,mode:"result",result:view,record:{id:"fixture"},preferences:present.preferences(view),momentRows:present.momentRows(view)};
}
for(const q of quiz.questions.filter(q=>q.scene)){
  scenes[q.id.toLowerCase()]={...base,mode:"quiz",question:present.question(q.id)};
}
scenes.preferences={...scenes["OBE-B"],resultTab:"preferences"};
scenes.evidence={...scenes["OBE-B"],resultTab:"evidence"};
scenes.shared={...scenes["OBE-B"],mode:"shared",result:present.sharedResult(scenes["OBE-B"].result),shared:{name:"演示玩家"},record:null};
const styles=css("app.wxss")+css("components/app-nav/app-nav.wxss")+css("pages/personality/personality.wxss")+
  ".preview-native-sheet{position:fixed;inset:0;z-index:1200;background:rgba(4,12,17,.68);display:flex;align-items:flex-end;justify-content:center}";
fs.mkdirSync(out,{recursive:true});
for(const [name,scene] of Object.entries(scenes))fs.writeFileSync(path.join(out,name+".html"),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>人格测试 · ${name}</title><style>body{margin:0}button{font:inherit}img{object-fit:contain}${styles}</style>${html(factory("pages/personality/personality.wxml")(scene))}</html>`);
console.log("Native previews: "+out);
