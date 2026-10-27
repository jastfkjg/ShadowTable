// Production Canvas artwork, shown at chat-card size and with real board names.
const fs = require("node:fs");
const path = require("node:path");
const { BOARDS } = require("../server/engine");
const shares = require("../miniprogram/room-share");
const root = path.resolve(__dirname, "../miniprogram");
const output = path.resolve(__dirname, "../output/playwright/room-share-a");
const scenes = ["knights", "classic", "chaos", "knights-13"].map((id, index) => ({
  id, code: index ? "372338" : "858201", boardName: BOARDS.find(board => board.id === id).name, me: { name: "子龙" },
}));
scenes.push({ id: "long", code: "123456", boardName: "阿瓦隆 · 经典基础与圆桌骑士的长名称扩展玩法", me: { name: "子龙" } });
const images = Object.fromEntries(Object.entries(shares.assets).map(([key, file]) => [key,
  `data:image/${file.endsWith(".jpg") ? "jpeg" : "png"};base64,${fs.readFileSync(path.join(root, file)).toString("base64")}`]));
const common = fs.readFileSync(path.join(root, "share-cover.js"), "utf8");
const source = fs.readFileSync(path.join(root, "room-share.js"), "utf8").replace('require("./share-cover")', 'window.shareCover');
images.brand = `data:image/png;base64,${fs.readFileSync(path.join(root, "assets/room-share-brand.png")).toString("base64")}`;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>雾蓝蜡笔 · 房间邀请</title>
<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#faf9f6;font:16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#19242b}h1{font-size:22px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start}.label{font-size:14px;color:#68747b;margin:0 0 12px}.card{padding:16px;background:#ededed;border-radius:12px}.brand{display:flex;gap:8px;align-items:center;font-size:14px;color:#92949a}.brand img{width:28px;height:28px;border-radius:50%}.title{font-size:19px;font-weight:500;line-height:1.45;margin:12px 0}canvas{display:block;width:100%;height:auto;border-radius:5px}.footer{font-size:14px;color:#92949a;margin-top:14px}@media(max-width:700px){body{padding:12px}.grid{grid-template-columns:1fr}.title{font-size:17px}}</style>
<h1>雾蓝蜡笔 · 房间数据动态绘制</h1><div class="grid" id="previews"></div>
<script>window.shareCover=(()=>{const module={exports:{}};${common}\nreturn module.exports;})();window.roomShare=(()=>{const module={exports:{}};${source}\nreturn module.exports;})();
(async()=>{const renderer=window.roomShare,scenes=${JSON.stringify(scenes)},urls=${JSON.stringify(images)};
const images=Object.fromEntries(await Promise.all(Object.entries(urls).map(([key,url])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([key,image]);image.onerror=reject;image.src=url}))));
window.coverScenes=scenes;
for(const room of scenes){const section=document.createElement('section');section.dataset.scene=room.id;const label=document.createElement('p');label.className='label';label.textContent=room.boardName;section.appendChild(label);
const card=document.createElement('div');card.className='card';const brand=document.createElement('div');brand.className='brand';const icon=document.createElement('img');icon.src=urls.brand;brand.append(icon,document.createTextNode('桌边助手'));card.appendChild(brand);
const title=document.createElement('div');title.className='title';title.textContent=renderer.shareContent(room).title;card.appendChild(title);
const canvas=document.createElement('canvas');canvas.dataset.scene=room.id;canvas.width=renderer.width;canvas.height=renderer.height;renderer.drawRoomCover(canvas.getContext('2d'),room,images);card.appendChild(canvas);
const footer=document.createElement('div');footer.className='footer';footer.textContent='小程序 · 桌边助手';card.appendChild(footer);section.appendChild(card);document.getElementById('previews').appendChild(section)}window.coverReady=true;
})().catch(error=>{window.coverError=String(error);console.error(error)});</script></html>`);
console.log(path.join(output, "index.html"));
