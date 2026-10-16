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
  assert.ok(last.top+last.box.height<=box.height-162,"all content clears the footer");
  assert.equal(box.sections.filter(s=>s.groupTop!==null).length,1);
  const labels=trace(pages[0]).map(t=>t.value);
  assert.equal(labels.filter(label=>label==="月度战报").length,2); // One header and one footer.
  assert.doesNotMatch(shares.describe(pages[0]),/第 .* 张|续/);
  const sample=monthly.cards(shareMonthlyFixture());
  assert.deepEqual(sample[0].sections.map(s=>s.id),["points","games","merlin_evade","assassin_hit","percival_green"]);
  assert.equal(sample[0].sections[0].rows.filter(row=>row.tied).length,2);
  assert.equal(sample[0].sections.find(s=>s.type==="honor").rows[0].rate,100);
  assert.ok(monthly.imagePaths(sample[0]).includes("/assets/roles/merlin.png"));
  const sparse=shareMonthlyFixture(); sparse.mainBoards.slice(1).forEach(board=>board.rows=[]); sparse.featuredIds=[];
  assert.ok(monthly.dimensions(monthly.cards(sparse)[0]).height<1920,"short reports do not have page-sized blank space");
});

test("月报长昵称、大负数、零分均完整呈现，娱乐榜保留发生率口径", () => {
  const report=shareMonthlyFixture(),name="与梅林一起守护圆桌的长昵称玩家😀".repeat(3);
  Object.assign(report.mainBoards[0].rows[0],{nickname:name,points:-123456789,tied:true});
  report.mainBoards[0].rows[1].points=0;
  const pages=monthly.cards(report),texts=pages.flatMap(trace);
  assert.ok(texts.map(t=>t.value).join("").includes(name));
  assert.ok(texts.some(t=>t.value==="-123456789"&&t.maxWidth>200));
  assert.ok(texts.some(t=>t.value==="0"));
  assert.equal(pages.length,1);
  const entertainment=monthly.cards(monthlyFixture(),true).filter(page=>page.edition==="entertainment");
  assert.ok(entertainment.flatMap(trace).some(t=>t.value==="发生率"));
  assert.ok(!entertainment.flatMap(trace).some(t=>t.value==="成功率"));
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
