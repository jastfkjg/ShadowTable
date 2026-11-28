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
  assert.ok(box.sections.every(s=> s.box.lanes.reduce((n,l)=>n+(l.folded?l.members.length:l.tiles.length),0)===s.section.rows.length));
  assert.deepEqual(box.sections.map(s=>s.chapter).filter(Boolean),["胜率与场次","趣味荣誉","娱乐榜"]);
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

test("大并列保留名单入口，只下载可见头像，展开后后续名次点击位置随之移动", () => {
  const response = monthlyFixture(), present = require("../miniprogram/monthly-report").presentReport;
  const board = response.funBoards[0], secretAvatar = "/api/avatars/" + "d".repeat(64);
  const crowd = Array.from({ length: 14 }, (_, i) => ({ ...board.rows[2], nickname: "并列" + i,
    publicId: "tied-" + i, avatarUrl: secretAvatar, tied: true }));
  board.rows = [...board.rows.slice(0, 2), ...crowd];
  response.mainBoards[3].rows = response.mainBoards[4].rows = response.mainBoards[1].rows;
  let report = present(response), card = monthly.cardFromReport(report);
  const sections = monthly.layout(card).sections, {box} = sections.find(s => s.section.id === board.metric);
  assert.ok(box.compact); assert.equal(box.lanes[0].x, box.lanes[1].x);
  assert.ok(box.lanes[1].top >= box.lanes[0].height && box.lanes[2].top >= box.lanes[1].top + box.lanes[1].height);
  const [overall, games, good, evil] = sections.filter(s => s.box.compact);
  assert.equal(overall.top, games.top); assert.ok(games.x > overall.x && good.top > overall.top);
  assert.equal(good.top, evil.top); assert.ok(good.x + good.box.width < evil.x);
  assert.ok(!monthly.imagePaths(card).includes(secretAvatar));
  assert.equal(monthly.rosterFor(report, board.metric, 3).members.length, 14);
  const targets = monthly.playerTargets(card, report).filter(t => t.key.startsWith(board.metric + "/"));
  assert.equal(targets.length, 3); assert.equal(targets[2].rank, 3);
  assert.ok(targets[2].x > 0 && targets[2].width > 10 && targets[2].x + targets[2].width < 50);
  assert.ok(trace(card).some(t => t.value === "各"));
  assert.ok(trace(card).some(t => t.value === "14 位玩家"));
  board.rows = [...crowd.map(r => ({...r,rank:1})), {...board.rows[1],rank:2}];
  report = present(response); card = monthly.cardFromReport(report);
  const other = monthly.playerTargets(card, report).filter(t => t.key.startsWith(board.metric + "/"));
  assert.deepEqual(other.map(t => t.rank || t.publicId), [1, "tied-0", board.rows.at(-1).publicId]);
  assert.ok(other[1].y >= other[0].y + other[0].height - .00002);
  assert.ok(other[2].y > other[1].y + other[1].height);
  assert.ok(monthly.imagePaths(card).includes(secretAvatar));
});
test("跨章节连续配对且分别标注章节，长标题不影响首行数据对齐，最后奇数项分列名次", () => {
  const [card] = monthly.cards(monthlyFixture());
  const sample = card.sections.find(s => s.type === "honor");
  const groups = ["玩家票选", "角色与牌桌高光", "趣味荣誉", "娱乐榜"];
  card.sections = groups.flatMap(groupTitle => [0, 1, 2].map((id) => ({
    ...sample, id: groupTitle + id, groupTitle, title: id === 1 ? "这是一项需要换行的称号".repeat(2) : "称号",
  })));
  const { sections } = monthly.layout(card);
  assert.deepEqual(sections.map(s => s.chapter).filter(Boolean), groups);
  for (let i = 0; i < sections.length; i += 2) {
    const [left, right] = sections.slice(i, i + 2);
    assert.ok(right.rightPanel && !left.rightPanel);
    assert.equal(left.top, right.top); assert.ok(left.x + left.box.width < right.x);
    assert.equal(left.box.heading, right.box.heading);
    if (left.section.groupTitle !== right.section.groupTitle) {
      assert.equal(left.caption, left.section.groupTitle); assert.equal(right.caption, right.section.groupTitle);
    }
  }
  card.sections.pop();
  const last = monthly.layout(card).sections.at(-1);
  assert.ok(last.box.divider);
  assert.ok(last.box.lanes[0].x < last.box.lanes.at(-1).x);
  assert.deepEqual(last.box.lanes.map(l => l.rank), [1, 2, 3]);
});

test("称号徽章紧接标题末行，胜率榜使用对应胜率徽章，未知称号留空", () => {
  const [card] = monthly.cards(monthlyFixture());
  const honor = card.sections.find(s => s.id === "merlin_evade");
  honor.title = "梅林".repeat(19);
  card.sections.push({ ...honor, id: "unknown", title: "未设徽章" });
  const sections = monthly.layout(card).sections;
  const {box, x, top} = sections.find(s => s.section === honor);
  assert.ok(box.title.length > 1);
  assert.equal(sections.find(s => s.section.id === "overall").box.badge, "/assets/badges/rate_overall.png");
  assert.equal(sections.at(-1).box.badge, undefined);
  const art = new Map(monthly.imagePaths(card).filter(p => p.startsWith("/assets/badges/"))
    .map(path => [path, {path, width: 128, height: 128}]));
  const draws = [];
  const ctx = new Proxy({
    measureText(text) { return {width: canvas.width(text, Number(this.font.match(/([\d.]+)px/)[1]))}; },
    drawImage(image, ...bounds) { draws.push({path: image.path, bounds}); },
  }, {get: (obj, key) => key in obj ? obj[key] : () => {}});
  monthly.drawCard(ctx, card, art);
  assert.deepEqual(draws.map(d => d.path), sections.map(s => s.box.badge).filter(Boolean));
  const [left, badgeTop, width, height] = draws.find(d => d.path === box.badge).bounds;
  const titleEnd = x + canvas.width(box.title.at(-1), box.titleSize);
  assert.ok(left > titleEnd && left - titleEnd < 10);
  assert.ok(badgeTop > top + 27 && left + width < x + box.width && width === height && width < 30);
});

test("唯一称号只有一个名次时称号在左、成员在右，三人共享一份成绩", () => {
  const response = monthlyFixture(), board = response.funBoards.find(b => b.id === "merlin_evade:count");
  board.rows = board.rows.map(r => ({ ...r, rank: 1, tied: true, count: 2 }));
  const [card] = monthly.cards(response), section = card.sections.find(s => s.id === board.metric);
  card.sections = [section];
  const box = monthly.layout(card).sections[0].box, group = box.lanes[0], text = trace(card);
  assert.ok(group.x > box.width && box.divider);
  assert.equal(text.filter(t => t.value === "并列第一").length, 1);
  assert.equal(text.filter(t => t.value === "各").length, 1);
  assert.deepEqual(group.tiles.map(t => t.row.name), board.rows.map(r => r.nickname));
});

test("图中四人并列利用另一栏空位展开，长名单保留总数，长昵称按实际高度计入", () => {
  const response = monthlyFixture(), present = require("../miniprogram/monthly-report").presentReport;
  const board = response.funBoards[0], sample = board.rows[0];
  const other = response.funBoards.find(b => b.id === "assassin_hit:count");
  other.rows = [...other.rows.slice(0, 2), ...[0, 1, 2].map(i => ({...sample, rank:3, tied:true, publicId:"right-"+i}))];
  const players = Array.from({length:14}, (_, i) => ({ ...sample, nickname: "玩家" + i, publicId: "p" + i,
    avatarUrl: "/api/avatars/" + i.toString(16).padStart(64, "0"), rank:1, tied:true }));
  const check = (rows, visible) => {
    board.rows = rows;
    const report = present(response), card = monthly.cardFromReport(report);
    const {box} = monthly.layout(card).sections.find(s => s.section.id === board.metric), lane = box.lanes[0];
    assert.deepEqual(lane.tiles.map(t => t.row.name), rows.slice(0,visible).map(r => r.nickname));
    assert.equal(monthly.rosterFor(report, board.metric, 1).members.length, rows.length);
    const targets = monthly.playerTargets(card, report).filter(t => t.key.startsWith(board.metric + "/"));
    assert.deepEqual(targets.slice(1).map(t => t.publicId), rows.slice(0,visible).map(r => r.publicId));
    assert.equal(targets[0].rank, 1);
    const paths = monthly.imagePaths(card);
    for (const [i,r] of rows.entries()) assert.equal(paths.includes(r.avatarUrl), i < visible);
    assert.ok(lane.top + lane.height <= box.height - box.heading);
    return box.height;
  };
  const height = check(players.slice(0,4), 4);
  assert.equal(check(players, 4), height);
  assert.equal(check([players[0], {...players[1], nickname:"这是一段很长的昵称".repeat(25)}, ...players.slice(2)], 1), height);
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
