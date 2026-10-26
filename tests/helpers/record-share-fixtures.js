const createdAt = Date.UTC(2026, 9, 26, 10);
const base = { version: 1, player: { name: "子龙", avatarUrl: "" }, createdAt };
const stats = { ...base, id: "1".repeat(48), kind: "stats", title: "子龙的阿瓦隆战绩 · 胜率 52.6%", data: {
  total: 19, wins: 10, losses: 9, winRate: 52.6, scoreMonth: 35, scorePeriod: "2026.10",
  factions: [{ faction: "good", total: 12, wins: 7, losses: 5, winRate: 58.3 }, { faction: "evil", total: 7, wins: 3, losses: 4, winRate: 42.9 }],
  roles: [{ role: "梅林", faction: "good", total: 6, wins: 4, losses: 2, winRate: 66.7 }, { role: "派西维尔", faction: "good", total: 4, wins: 2, losses: 2, winRate: 50 }],
} };
const match = { ...base, id: "2".repeat(48), kind: "match", title: "子龙的阿瓦隆 · 经典基础对局", data: {
  boardName: "阿瓦隆 · 经典基础", capacity: 10, endedAt: createdAt - 18 * 60000,
  role: "梅林", faction: "good", seat: 3, outcome: "win", winner: "good", score: 3, questSuccess: 3, questTotal: 3,
  events: [{ round: 1, label: "任务成功" }, { round: 2, label: "任务成功" }, { round: 3, label: "任务成功" }, { round: null, label: "最终刺杀未命中梅林" }],
} };
const fun = { ...base, id: "3".repeat(48), kind: "fun", title: "子龙的成功躲刀 · 3次", data: {
  metric: "merlin_evade", mode: "knights", modeLabel: "十二骑士", label: "成功躲刀", roleLabel: "梅林", icon: "/assets/roles/merlin.png", iconTone: "portrait", unit: "次",
  count: 3, opportunities: 5, knownGames: 5, countOnly: false, rate: 60, rateName: "成功率",
  description: "担任梅林时，在针对自己的出刀中成功躲过的次数。",
  records: [0, 4, 8].map((days, index) => ({ boardName: "阿瓦隆 · 十二骑士", role: "梅林", faction: "good", endedAt: createdAt - days * 86400000 - 18 * 60000, count: 1 })),
} };
const matches = { ...base, id:"4".repeat(48), kind:"matches", title:"子龙的阿瓦隆对局记录 · 19局", data:{
  total:19,wins:10,losses:8,excluded:1,scope:"全部时间 · 全部玩法",
  records:Array.from({length:5},(_,i)=>({boardName:"阿瓦隆 · 经典基础",role:i%2?"刺客":"梅林",faction:i%2?"evil":"good",endedAt:createdAt-i*86400000,outcome:i%2?"loss":"win",score:i%2?-1:3})),
} };
const funSummary = { ...base,id:"5".repeat(48),kind:"funSummary",title:"子龙的阿瓦隆趣味记录",data:{
  total:3,recorded:1,known:2,scope:"全部时间 · 全部趣味记录",items:[
    {label:"闪身步大神",roleLabel:"梅林",icon:"/assets/roles/merlin.png",known:true,count:3,unit:"次",rateLabel:"成功率 60%",sampleLabel:"3 / 5 次",stateLabel:"查看说明"},
    {label:"最强派西",roleLabel:"派西维尔",icon:"/assets/roles/percival.png",known:true,count:0,unit:"局",rateLabel:"成功率 0%",sampleLabel:"0 / 1 局",stateLabel:"暂无次数"},
    {label:"职业刺客",roleLabel:"刺客",icon:"/assets/roles/assassin.png",known:false,count:null,unit:"",rateLabel:"",sampleLabel:"",stateLabel:"尚无完整记录"},
  ],
} };
module.exports = { stats, match, fun, matches, funSummary };
