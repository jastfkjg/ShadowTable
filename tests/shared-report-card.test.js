const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const report=require("../miniprogram/shared-report-card"),{present}=require("../miniprogram/shared-record-view"),{stats}=require("./helpers/record-share-fixtures");
function context(texts=[]) {
  return new Proxy({measureText:value=>({width:Array.from(String(value)).length*7}),fillText:(value,x,y)=>texts.push({value:String(value),x,y})},{get:(target,key)=>key in target?target[key]:()=>{}});
}
test("同款战报 PNG 包含当前积分、角色插画及快照时间，不含导航或操作按钮",()=>{
  const card=present(stats),texts=[];
  report.drawCard(context(texts),card,null);
  const output=texts.map(row=>row.value).join(",");
  for(const value of ["52.6","10 胜 · 9 负","35","10月积分","梅林","派西维尔","数据截至 2026.10.26 18:00"])assert.ok(output.includes(value),value);
  assert.doesNotMatch(output,/发给好友|保存图片|生成战绩图片|返回|must-not-export/);
  assert.ok(report.imagePaths(card).includes("/assets/roles/merlin.png"));
  assert.equal(report.renderDimensions(card).width,1080);
  const box=report.layout(card);
  assert.ok(texts.every(row=>row.y>=0 && row.y<box.height));
  assert.ok(box.roles.every(row=>row.y+73+row.nameH+5+45+18<box.endTop));
});
test("长昵称、零胜率、负积分、多阵营及窄屏角色布局完整且动态增加高度",()=>{
  const snapshot=structuredClone(stats);snapshot.player.name="圆桌旁一起玩阿瓦隆的长昵称玩家";
  snapshot.data.winRate=0;snapshot.data.scoreMonth=-12345678;snapshot.data.total=1234567;snapshot.data.wins=0;snapshot.data.losses=1234567;
  snapshot.data.factions.push({faction:"third",total:3,wins:1,winRate:33.3});
  snapshot.data.roles=Array.from({length:4},(_,i)=>({role:i?"亚瑟的忠臣":"蓝刀客·加赫雷斯",faction:"good",wins:0,total:2,losses:2,winRate:0}));
  const card={...present(snapshot),reportWidth:320},texts=[],box=report.layout(card);
  report.drawCard(context(texts),card,null);
  const output=texts.map(row=>row.value).join("");
  assert.match(output,/圆桌旁一起玩阿瓦隆的长昵称玩家/);assert.match(output,/-12345678 分/);assert.match(output,/盗贼阵营/);
  assert.equal(box.roles[0].y,box.roles[1].y);assert.ok(box.roles[2].y>box.roles[1].y);
  assert.ok(box.height>report.layout(present(stats)).height);assert.ok(box.stampTop>box.bottom);
});
test("原生导出使用独立画布和同款渲染器，绝对头像 URL 不重复添加域名",async()=>{
  const selected=[],urls=[],texts=[],ctx=context(texts);
  const canvas={getContext:()=>ctx,createImage:()=>({set src(value){urls.push(value);this.onerror();}})};
  let exported;
  const wx={createSelectorQuery(){const q={in(){return q},select(value){selected.push(value);return q},fields(){return q},exec(callback){callback([{node:canvas}]);}};return q;},canvasToTempFilePath(options){exported=options;options.success({tempFilePath:"wxfile://native-report"});}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../miniprogram/share-image.js"),"utf8"),{module,wx,setTimeout,clearTimeout,require:name=>name==="./api"?{assetUrl:value=>"https://test.invalid"+value}:{}});
  const card={...present(stats),avatar:"https://cdn.test.invalid/avatar.png"};
  assert.equal(await module.exports.renderImage({alive:true},card,{renderer:report,selector:"#shared-report-canvas"}),"wxfile://native-report");
  assert.deepEqual(selected,["#shared-report-canvas"]);assert.ok(urls.includes(card.avatar));
  assert.equal(exported.destWidth,1080);assert.equal(exported.destHeight,report.renderDimensions(card).height);assert.equal(exported.fileType,"png");
});
