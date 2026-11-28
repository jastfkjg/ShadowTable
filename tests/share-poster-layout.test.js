const test = require("node:test");
const assert = require("node:assert/strict");
const shares = require("../miniprogram/share-card");
const monthly = require("../miniprogram/monthly-report-card");
const ranks = require("../miniprogram/leaderboard-share-card");
const canvas = require("../miniprogram/poster-canvas");
const { monthlyFixture } = require("./helpers/monthly-fixtures");
const { shareMonthlyFixture, shareRankFixture } = require("./helpers/share-poster-fixtures");

function trace(card) {
  const texts = [];
  const ctx = new Proxy({ fillText(value,x,y,maxWidth) { texts.push({value:String(value),x,y,maxWidth,font:this.font}); } }, { get(target,key) { return key in target ? target[key] : () => {}; } });
  shares.drawCard(ctx,card);
  return texts;
}

test("月报各主榜完整保留、同级展示，综合和荣誉连续排入一张长图且不丢并列玩家", () => {
  const report=monthlyFixture();
  report.mainBoards[3].rows=[{...report.mainBoards[1].rows[0]}];
  report.mainBoards[4].rows=[{...report.mainBoards[1].rows[0]}];
  report.funBoards[0].rows=Array.from({length:105},(_,i)=>({...report.funBoards[0].rows[0],nickname:"并列玩家"+i,rank:1,tied:true}));
  const pages=monthly.cards(report), sections=pages.flatMap(page=>page.sections);
  assert.deepEqual(sections.filter(s=>s.type==="board").map(s=>s.id),["points","overall","games","good","evil"]);
  assert.equal(sections.filter(s=>s.id==="merlin_evade").flatMap(s=>s.rows).length,105);
  assert.equal(pages.length,1);
  assert.equal(new Set(pages[0].sections.map(section=>section.type)).size,2);
  const box=monthly.layout(pages[0]),last=box.sections[box.sections.length-1];
  assert.equal(monthly.dimensions(pages[0]).width,1080);
  assert.ok(last.top+last.box.height<=box.footerTop,"all content clears the footer");
  assert.ok(box.height/(1080/480)-(last.top+last.box.height)<540,"the footer does not add a page of empty space");
  assert.ok(box.sections.every(s=> s.box.lanes.flatMap(l=>l.tiles).length===s.section.rows.length));
  assert.deepEqual(box.sections.map(s=>s.chapter).filter(Boolean),["趣味荣誉","娱乐榜"]);
  const labels=trace(pages[0]).map(t=>t.value);
  assert.equal(labels.filter(label=>label==="炉边来信").length,1);
  assert.doesNotMatch(shares.describe(pages[0]),/第 .* 张|续/);
  const sample=monthly.cards(shareMonthlyFixture());
  assert.deepEqual(sample[0].sections.map(s=>s.id),["points","games","merlin_evade","assassin_hit","percival_green"]);
  assert.equal(sample[0].sections[0].rows.filter(row=>row.tied).length,2);
  assert.ok(sample[0].sections.filter(s => s.type === "honor").every(s => s.rows.every(row => row.secondary === "")));
  assert.ok(monthly.imagePaths(sample[0]).includes("/assets/room-share-background.jpg"));
  const sparse=shareMonthlyFixture(); sparse.mainBoards.slice(1).forEach(board=>board.rows=[]); sparse.featuredIds=[];
  assert.ok(monthly.dimensions(monthly.cards(sparse)[0]).height<monthly.dimensions(sample[0]).height,"short reports shrink with their content");
});

test("中央领奖台与可点击头像一一对应，并列第三名保留各自的计分局数", () => {
  const report = require("../miniprogram/monthly-report").presentReport(shareMonthlyFixture());
  const card = monthly.cardFromReport(report), { box } = monthly.layout(card).sections[0];
  const [first, second, third] = box.lanes;
  assert.ok(box.podium && second.x < first.x && first.x < third.x);
  assert.ok(first.plinthTop < second.plinthTop && second.plinthTop < third.plinthTop);
  assert.equal(first.x + first.width / 2, box.width / 2);
  assert.deepEqual(third.tiles.map(t => t.sampleLines.join("")), ["6 场计分局", "4 场计分局"]);
  const targets = monthly.playerTargets(card, report).filter(t => t.key.startsWith("points/"));
  assert.deepEqual(targets.map(t => t.publicId), report.mainBoards[0].rows.map(r => r.publicId));
  assert.ok(targets[1].x < targets[0].x && targets[0].x < targets[2].x);
  assert.ok(targets[2].x + targets[2].width <= targets[3].x);
});

test("积分卡显示昵称、总分和计分局数，趣味与娱乐榜只画上榜次数", () => {
  const report=shareMonthlyFixture(),name="与梅林一起守护圆桌的长昵称玩家😀".repeat(3);
  Object.assign(report.mainBoards[0].rows[0],{nickname:name,points:-123456789,adjustmentPoints:-34,tied:true});
  Object.assign(report.mainBoards[0].rows[1],{points:0,adjustmentPoints:36});
  const pages=monthly.cards(report),texts=pages.flatMap(trace);
  assert.ok(texts.map(t=>t.value).join("").includes(name)); assert.ok(monthly.describe(pages[0]).includes(name));
  assert.ok(texts.some(t=>t.value==="6 场计分局")); assert.doesNotMatch(texts.map(t=>t.value).join(""),/调整/);
  assert.ok(texts.some((t,i)=>t.value==="-123456789" && t.maxWidth>0 && texts[i+1]?.value==="分"));
  assert.ok(texts.some((t,i)=>t.value==="0" && texts[i+1]?.value==="分"));
  assert.equal(pages.length,1);
  const complete=monthly.cards(monthlyFixture());
  assert.doesNotMatch(complete.flatMap(trace).map(t=>t.value).join(""), /成功率|发生率|次机会/);
  assert.ok(complete.flatMap(trace).some((t, i, all) => t.value === "73.3" && all[i + 1]?.value === "%"));
  assert.doesNotMatch(complete.flatMap(trace).map(t=>t.value).join(""),/娱乐版/);
});

test("完整月报不受精选和三项上限限制，所有有记录的荣誉与娱乐榜仅导出一次", () => {
  const report=monthlyFixture();report.featuredIds=[];
  const positive=report.funBoards.find(b=>b.id==='merlin_evade:count'),negative=report.funBoards.find(b=>b.id==='assassin_miss:count');
  report.funBoards.push({...positive,id:'extra_positive:count',metric:'extra_positive',title:'其他荣誉'});
  for(let i=1;i<=4;i++)report.funBoards.push({...negative,id:'extra_negative_'+i+':count',metric:'extra_negative_'+i,title:'娱乐指标'+i});
  const [card]=monthly.cards(report),honors=card.sections.filter(s=>s.type==='honor');
  assert.deepEqual(honors.map(s=>s.id),['merlin_evade','assassin_hit','defense_ally','extra_positive','assassin_miss','extra_negative_1','extra_negative_2','extra_negative_3','extra_negative_4']);
  assert.equal(card.edition,undefined);assert.equal(card.title,'月度战报');
  assert.deepEqual(monthly.cards(report,true),[card]);
  report.mainBoards.forEach(b=>b.rows=[]);report.funBoards.filter(b=>b.positive).forEach(b=>b.rows=[]);
  const onlyEntertainment=monthly.layout(monthly.cards(report)[0]);
  assert.ok(onlyEntertainment.sections.every(s=>s.section.groupTitle==="娱乐榜"));
  assert.deepEqual(onlyEntertainment.sections.map(s=>s.chapter).filter(Boolean),["娱乐榜"]);
});

test("并列荣誉的长昵称换行完整绘制，在头像区域内与次数分开排列", () => {
  const report=monthlyFixture(),board=report.funBoards.find(b=>b.id===report.featuredIds[0]);
  Object.assign(board.rows[0],{nickname:"圆桌旁的长昵称玩家".repeat(5),count:123456789,opportunities:370370367,rate:33.3,tied:true});
  const card=monthly.cards(report)[0],texts=trace(card);
  const drawn=texts.find((t,i)=>t.value==="123456789" && texts[i+1]?.value==="次");
  const section=monthly.layout(card).sections.find(s=>s.section.id===board.metric);
  const tile=section.box.lanes[0].tiles[0];
  assert.ok(texts.map(t=>t.value).join("").includes(board.rows[0].nickname));
  assert.equal(tile.nameLines.join(""),board.rows[0].nickname);
  assert.deepEqual(tile.sampleLines,[]);
  assert.ok(section.box.heading + tile.y + tile.textTop + tile.nameLines.length * 18 <= section.box.height);
  assert.ok(drawn.maxWidth>0);
  assert.ok(section.box.heading + tile.y + tile.diameter < section.box.height);
  assert.doesNotMatch(texts.map(t=>t.value).join(""),/发给好友|保存图片|点图放大/);
});

test("个人榜单用同分分组保留五位玩家，积分统计沿用接口并保护未公开排名", () => {
  const {profile,board}=shareRankFixture(),card=shares.leaderboardCard(profile,board),box=ranks.layout(card);
  const visible=[...box.before.map(e=>e.row),box.ownLane.row,...box.peerGroups.flatMap(g=>g.peers.map(p=>p.row)),...box.after.map(e=>e.row)];
  assert.deepEqual(visible.map(r=>r.name).sort(),["玉虚宫","大V","子龙","老高","月下江头"].sort());
  assert.equal(box.columns,2);
  assert.deepEqual(card.performance,{total:7,wins:2,losses:5,rate:"28.6%"});
  assert.ok(trace(card).some(t=>t.value==="同为第 6 名"));
  const hidden=shares.leaderboardCard(profile,{...board,me:{...board.me,status:"hidden",rank:null}});
  assert.equal(ranks.layout(hidden).showNeighborhood,false);
  assert.ok(trace(hidden).some(t=>t.value==="未公开"));
  assert.ok(!trace(hidden).some(t=>t.value==="第 6 名"));
  const unknown=shares.leaderboardCard(profile,{...board,me:{...board.me,total:0,wins:0,points:-5,winRate:null}});
  assert.equal(unknown.performance.rate,"—");
});

test("同分玩家的长昵称与大数值换行完整展示，画布增加高度且数值不挤成窄列", () => {
  const {profile,board}=shareRankFixture(),name="与梅林一起守护圆桌的长昵称玩家😀".repeat(2);
  board.me.points=-123456789;
  board.nearby=board.nearby.map(row=>({...row,nickname:name,points:row.points-123456798}));
  const card=shares.leaderboardCard({...profile,nickname:name},board),box=ranks.layout(card),texts=trace(card);
  assert.equal(box.columns,1);
  assert.ok(shares.dimensions(card).height>1920);
  assert.ok(box.peerGroups.every(g=>g.peers.every(p=>p.wide)));
  for (const row of card.nearby) {
    const drawn=texts.filter(t=>t.value===row.value);
    assert.ok(drawn.length>0);
    for (const text of drawn) {
      const size=Number(text.font.match(/([\d.]+)px/)[1]);
      assert.ok(canvas.width(row.value,size)<=text.maxWidth,"numeric text has its own width");
    }
  }
  assert.ok(texts.map(t=>t.value).join("").includes(name));
  assert.ok(box.notesTop<box.height-150);
});
