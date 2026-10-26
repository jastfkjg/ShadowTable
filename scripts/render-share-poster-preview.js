// Inspect exported PNGs using the same Canvas modules as the mini-program.
const fs = require("node:fs");
const path = require("node:path");
const cards = require("../miniprogram/share-card");
const monthlyCards = require("../miniprogram/monthly-report-card").cards;
const { monthlyFixture } = require("../tests/helpers/monthly-fixtures");
const { shareMonthlyFixture, shareRankFixture } = require("../tests/helpers/share-poster-fixtures");
const root = path.resolve(__dirname, "../miniprogram"), output = path.resolve(__dirname, "../output/playwright/share-poster-implemented");
const { profile, board } = shareRankFixture(), report = shareMonthlyFixture();
const long = structuredClone(report);
long.mainBoards[0].rows[0] = { ...long.mainBoards[0].rows[0], nickname: "与梅林一起守护圆桌的长昵称玩家😀", points:-123456789, tied:true };
long.funBoards[0].rows[0] = { ...long.funBoards[0].rows[0], nickname:"与梅林一起守护圆桌的长昵称玩家😀", count:123456789, opportunities:123456789 };
const longBoard = structuredClone(board);
longBoard.me.points = -123456789;
longBoard.nearby = longBoard.nearby.map(row => ({ ...row, nickname: row.nickname + "与梅林一起守护圆桌的长昵称玩家😀", points:row.points-123456798 }));
const scenes = {
  "stats-summary":[cards.statsCard(require('../tests/helpers/share-fixtures').profile,require('../tests/helpers/share-fixtures').stats,Date.UTC(2026,9,26,10))],
  monthly:monthlyCards(report),
  full:monthlyCards(monthlyFixture()),
  entertainment:monthlyCards(report,true),
  long:monthlyCards(long),
  rank:[cards.leaderboardCard(profile,board)],
  "rank-long":[cards.leaderboardCard({...profile,nickname:"与梅林一起守护圆桌的长昵称玩家😀"},longBoard)],
  hidden:[cards.leaderboardCard(profile,{...board,me:{...board.me,status:"hidden",rank:null}})],
  games:[cards.leaderboardCard(profile,{...board,metric:"games",nearby:[],me:{...board.me,rank:1,total:9,wins:3,winRate:33.3}})],
  rate:[cards.leaderboardCard(profile,{...board,metric:"fun_merlin_evade",fun:true,title:"闪身步大神",metricLabel:"成功躲刀",unit:"%",sort:"rate",mode:"classic",nearby:[],me:{...board.me,rate:100,count:5,opportunities:5,knownGames:5}})],
};
let source = ["fun-copy.js","monthly-report.js","poster-canvas.js","monthly-report-card.js","leaderboard-share-card.js"].map(file=>fs.readFileSync(path.join(root,file),"utf8")).join("\n");
source += "\n{const module={exports:{}};" + fs.readFileSync(path.join(root,"share-card.js"),"utf8")
  .replace('require("./fun-copy")',"window.shadowtableFunCopy")
  .replace('require("./monthly-report-card")',"window.shadowtableMonthlyCard")
  .replace('require("./leaderboard-share-card")',"window.shadowtableLeaderboardCard") + "\nwindow.shareCards=module.exports;}";
const urls = Object.fromEntries(require("../miniprogram/builtin-avatars").map(item=>["/api/avatars/"+item.hash,"/miniprogram"+item.path]));
fs.mkdirSync(output,{recursive:true});
const body = `<script>${source}</script><script>(async()=>{const scenes=${JSON.stringify(scenes)},renderer=window.shareCards,urls=${JSON.stringify(urls)};window.posterScenes=scenes;const selected=new URLSearchParams(location.search).get('scene');
const images=new Map(await Promise.all([...new Set(Object.values(scenes).flat().flatMap(card=>renderer.imagePaths(card)))].map(key=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([key,image]);image.onerror=()=>{console.error('Missing poster image',key);resolve([key,null])};image.src=urls[key]||(key.startsWith('/assets/')?'/miniprogram'+key:key)}))));
window.posterImages=images;for(const [name,pages]of Object.entries(scenes)){if(selected&&name!==selected)continue;for(const [i,card]of pages.entries()){const section=document.createElement('section');section.dataset.scene=name;section.dataset.page=i;const heading=document.createElement('p');heading.textContent=name;section.appendChild(heading);const canvas=document.createElement('canvas');const size=renderer.renderDimensions(card);Object.assign(canvas,{width:size.width,height:size.height});const context=canvas.getContext('2d');context.save();try{if(size.scale!==1)context.scale(size.scale,size.scale);renderer.drawCard(context,card,null,images)}finally{context.restore()};section.appendChild(canvas);document.body.appendChild(section)}}window.posterReady=true;})().catch(error=>{console.error(error);window.posterError=error.message});</script>`;
fs.writeFileSync(path.join(output,"index.html"),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>分享图 · 生产 Canvas 验证</title><link rel="icon" href="data:,"><style>body{margin:32px;background:#e9e5dd;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;font:16px sans-serif;color:#101c24}section{width:360px}canvas{display:block;width:100%;height:auto}p{margin:0 0 12px}</style>${body}</html>`);
console.log(output);
