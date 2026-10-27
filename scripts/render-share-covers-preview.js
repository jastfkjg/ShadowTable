// Production Canvas renderers with public sample snapshots; no running app needed.
const fs = require("node:fs"), path = require("node:path");
const roomShare = require("../miniprogram/room-share");
const records = require("../miniprogram/record-share-cover");
const fixtures = require("../tests/helpers/record-share-fixtures");
const { BOARDS } = require("../server/engine");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(__dirname, "../output/playwright/share-covers-crayon");
const imageUrl = file => "data:image/jpeg;base64," + fs.readFileSync(path.join(root, file)).toString("base64");
const image = imageUrl("/assets/share-cover.jpg"), background = imageUrl(roomShare.assets.background);
const brand = "data:image/png;base64," + fs.readFileSync(path.join(root, "assets/room-share-brand.png")).toString("base64");
const scenes = [{ id: "general", label: "通用分享", title: "桌边助手 · 阿瓦隆线下助手", image }];
for (const [id, code] of [["classic", "012345"], ["knights", "628159"], ["chaos", "372338"], ["knights-13", "858201"]]) {
  const room = { boardName: BOARDS.find(board => board.id === id).name, code, me: { name: "子龙" } };
  scenes.push({ id: "room-" + id, label: "房间邀请 · " + room.boardName, title: roomShare.shareContent(room).title, room });
}
for (const [kind, snapshot] of Object.entries(fixtures)) scenes.push({ id: kind, label: records.coverContent("records", snapshot).title,
  title: snapshot.title, snapshot });
scenes.push({ id: "long-room", label: "长玩法名称", title: "房间邀请 · 长名称边界",
  room: { boardName: "阿瓦隆 · 经典基础与圆桌骑士的长名称扩展玩法", code: "085201" } });
scenes.push({ id: "other-game", label: "动态游戏名称", title: "房间邀请 · 狼人杀", room: { boardName: "狼人杀 · 预女猎白", code: "037291" } });
const long = structuredClone(fixtures.fun);long.player.name = "圆桌旁一起玩阿瓦隆的长昵称玩家😀";
long.data.count = 123456789;long.data.label = "验证两行完整展示的长名称趣味记录";
scenes.push({ id: "long-record", label: "长昵称与大数字", title: "趣味记录 · 数据边界", snapshot: long });
const zero = structuredClone(fixtures.stats);Object.assign(zero.data, { total: 0, wins: 0, losses: 0, winRate: 0 });
scenes.push({ id: "zero", label: "真实零值", title: "战绩统计 · 零值", snapshot: zero });
for (const tab of ["records", "matches", "fun"]) scenes.push({ id: "intro-" + tab, tab, label: "未准备好快照时的品牌介绍", title: "桌边助手 · " + tab });
function moduleSource(name, file, bindings = {}) {
  return `window.${name}=(()=>{const module={exports:{}};const require=name=>(${JSON.stringify(bindings)}[name] ? window[${JSON.stringify(bindings)}[name]] : null);${fs.readFileSync(path.join(root, file), "utf8")}\nreturn module.exports;})();`;
}
const sources = moduleSource("Cover", "share-cover.js") + moduleSource("RecordShares", "records-share.js")
  + moduleSource("RoomShares", "room-share.js", { "./share-cover": "Cover" })
  + moduleSource("RecordCovers", "record-share-cover.js", { "./share-cover": "Cover", "./records-share": "RecordShares" });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>雾蓝蜡笔 · 分享封面</title>
<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#e9e7e2;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#22343e}h1{font-size:24px;margin:0 0 8px}.note{margin:0 0 24px;color:#65727b}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start}.label{font-size:14px;margin:0 0 10px}.card{background:white;padding:14px;border-radius:10px}.brand{display:flex;gap:7px;align-items:center;color:#7a8388;font-size:13px}.brand img{width:24px;height:24px;border-radius:50%}.title{font-size:16px;line-height:1.5;margin:8px 0 12px;min-height:48px}canvas{display:block;width:100%;height:auto;border-radius:3px}.footer{font-size:12px;color:#8b9499;margin-top:10px}body.summary section:not(.primary){display:none}@media(max-width:700px){body{padding:16px}.grid{grid-template-columns:1fr}}</style>
<h1>雾蓝蜡笔 · 分享封面</h1><p class="note">实际资源与动态画布绘制 · 示例数据</p><div class="grid" id="previews"></div>
<script>${sources}
(async()=>{const background=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=${JSON.stringify(background)}});
const scenes=${JSON.stringify(scenes)},primary=['general','room-classic','room-knights','stats','matches','funSummary'];window.coverQA=[];
for(const scene of scenes){const section=document.createElement('section');section.dataset.scene=scene.id;if(primary.includes(scene.id))section.className='primary';
const label=document.createElement('p');label.className='label';label.textContent=scene.label;const card=document.createElement('div');card.className='card';const brand=document.createElement('div');brand.className='brand';const icon=document.createElement('img');icon.src=${JSON.stringify(brand)};brand.append(icon,document.createTextNode('桌边助手'));const title=document.createElement('div');title.className='title';title.textContent=scene.title;
const canvas=document.createElement('canvas');canvas.dataset.scene=scene.id;canvas.width=Cover.width;canvas.height=Cover.height;const ctx=canvas.getContext('2d'),texts=[];const fill=ctx.fillText.bind(ctx);ctx.fillText=(value,x,y)=>{texts.push({value,x,y,width:ctx.measureText(value).width,font:ctx.font});fill(value,x,y)};
if(scene.image){const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=scene.image});ctx.drawImage(image,0,0,Cover.width,Cover.height)}else if(scene.room)RoomShares.drawRoomCover(ctx,scene.room,{background});else RecordCovers.drawRecordCover(ctx,scene.tab||'records',scene.snapshot,{background});
window.coverQA.push({id:scene.id,texts,overflow:texts.filter(row=>row.x+row.width>Cover.layout.left+Cover.layout.textWidth+1)});
const footer=document.createElement('div');footer.className='footer';footer.textContent='小程序 · 桌边助手';card.append(brand,title,canvas,footer);section.append(label,card);document.getElementById('previews').append(section)}window.coverReady=true;
})().catch(error=>{window.coverError=String(error);console.error(error)});</script></html>`);
console.log(path.join(output, "index.html"));
