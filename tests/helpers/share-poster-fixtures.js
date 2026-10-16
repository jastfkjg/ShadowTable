const { monthlyFixture } = require("./monthly-fixtures");
const { monthRange } = require("../../miniprogram/monthly-report");
const avatars = require("../../miniprogram/builtin-avatars");
const avatar = id => "/api/avatars/" + avatars.find(item => item.id === id).hash;
const portraits = ["crayon-07", "crayon-03", "crayon-01", "crayon-05", "crayon-09"];
const person = (nickname, i, data) => ({ publicId: "poster-player-" + i, nickname, avatarUrl: avatar(portraits[i % portraits.length]), tied: false, ...data });

function shareMonthlyFixture() {
  const report = monthlyFixture();
  Object.assign(report, { month: "2026-10", ...{ periodStart: monthRange("2026-10").start, periodEnd: monthRange("2026-10").end },
    status: "preview", asOf: Date.parse("2026-10-16T14:13:00Z"), overview: { games: 9, players: 18, activeDays: 2 } });
  report.mainBoards[0].rows = [["阿伟",19,6,1],["wyc",12,6,2],["元",11,6,3],["橙C",11,4,3]].map(([name,points,scoredGames,rank], i) => person(name,i,{points,scoredGames,rank,tied:rank===3}));
  report.mainBoards[1].rows = [];
  report.mainBoards[2].rows = [["子龙",9,3,1],["玉虚宫",8,4,2],["wyc",8,5,2]].map(([name,total,wins,rank], i) => person(name,i,{total,wins,rank,tied:rank===2}));
  const specs = { merlin_evade: [["月下江头",1,1],["阿伟",1,1]], assassin_hit: [["元",2,2]], percival_green: [["玉虚宫",1,1],["wyc",1,2]] };
  const percival = report.funBoards.filter(board => board.metric === "defense_ally").map(board => ({ ...board, id: "percival_green:" + board.sort, metric:"percival_green", title:"最强派西", label:"三蓝并保护梅林" }));
  report.funBoards = [...report.funBoards.filter(board => board.metric !== "defense_ally"), ...percival].map(board => ({ ...board,
    rows: board.sort === "count" && specs[board.metric] ? specs[board.metric].map(([name,count,opportunities],i) => person(name,i,{count,opportunities,rate:count/opportunities*100,rank:1,tied:specs[board.metric].length>1,knownGames:opportunities,unknownGames:0})) : [] }));
  report.featuredIds = ["merlin_evade:count","assassin_hit:count","percival_green:count"];
  return report;
}

function shareRankFixture() {
  const profile = person("子龙",0,{});
  const board = { metric:"points", period:"month", periodStart:monthRange("2026-10").start, updatedAt:Date.parse("2026-10-16T14:13:00Z"),
    me:{status:"ranked",rank:6,points:9,total:7,wins:2,losses:5,winRate:28.6},
    nearby:[["玉虚宫",5,10],["大V",6,9],["子龙",6,9],["老高",6,9],["月下江头",9,6]].map(([name,rank,points],i) => person(name,i,{rank,points,isSelf:i===2})) };
  return { profile, board };
}
module.exports = { shareMonthlyFixture, shareRankFixture };
