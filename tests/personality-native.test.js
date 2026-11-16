const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const folder=path.resolve(__dirname,"../miniprogram/pages/personality");
const quiz=require("../miniprogram/pages/personality/quiz.json"),scoring=require("../miniprogram/pages/personality/scoring"),present=require("../miniprogram/pages/personality/presentation");
const fixture=require("./fixtures/personality/reachability-fixtures.json").fixtures.find(row=>row.expectedTypeId==="ASS-B");
const view=present.result(scoring.scoreQuiz(quiz,fixture.answers));
function native({single=false,latest=null}={}){
  const values=new Map([["session","native-session"]]),reads=[],events=[];let definition;
  const account={accountKey:"a".repeat(64),identityType:"wx",latest,history:[]};
  const api={assetUrl:path=>"https://example.test"+path,login:async()=>{reads.push("login");},requestId:()=>"native_attempt_0000001",
    request:async(path,method,data)=>{reads.push(path);if(path==="/api/me/personality")return account;if(path==="/api/me/personality/shares")return {id:"c".repeat(48),name:"测试玩家",view};throw Error("unexpected "+path);}};
  const wx={getStorageSync:key=>{if(single)throw Error("single page cannot read storage");return values.get(key);},setStorageSync:(k,v)=>values.set(k,v),removeStorageSync:key=>values.delete(key),
    pageScrollTo:()=>{},showShareMenu:()=>{},hideShareMenu:()=>{},showToast:()=>{},
    request:options=>{reads.push(options.url);options.success({statusCode:200,data:{id:"c".repeat(48),name:"朋友",view}});},
    saveImageToPhotosAlbum:options=>{events.push("album");options.fail({errMsg:"auth denied"});},
    openSetting:options=>{events.push("settings");options.success({authSetting:{"scope.writePhotosAlbum":true}});}};
  const requireLocal=name=>name==="../../api"?api:name==="../../share-image"?{renderImage:async()=>"/tmp/personality.png"}:name==="../../dialog"?{show:async()=>({confirm:true})}:name==="../../profile"?{backToMe:()=>events.push("back")}:name==="../../records-share"?{isSinglePage:()=>single}:require(path.resolve(folder,name));
  vm.runInNewContext(fs.readFileSync(path.join(folder,"personality.js"),"utf8"),{require:requireLocal,Page:value=>definition=value,wx,console});
  const page={...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  return {page,reads,events,values};
}
test("原生朋友圈单页只读公开摘要，首次进入与重试都不登录、不读取本地账号",async()=>{
  const h=native({single:true});await h.page.onLoad({share:"c".repeat(48)});h.page.onShow();await h.page.retry();
  assert.equal(h.page.data.mode,"shared");assert.equal(h.page.data.result.title,"静默猎手");
  assert.ok(h.reads.every(url=>url==="https://example.test/api/personality/shares/"+"c".repeat(48)));
  assert.equal(h.page.onShareAppMessage().path,"/pages/personality/personality?share="+"c".repeat(48));h.page.onUnload();
  const intro=native({single:true});await intro.page.onLoad({});await intro.page.retry();assert.equal(intro.reads.length,0);intro.page.onUnload();
});
test("原生已保存结果不自动公开，主动分享生成稳定路径，图片权限拒绝可恢复",async()=>{
  const h=native({latest:{id:"b".repeat(48),view,createdAt:1700000000000,version:quiz.version}});
  await h.page.onLoad();h.page.onReady();assert.equal(h.page.data.mode,"result");assert.ok(!h.reads.includes("/api/me/personality/shares"));
  assert.equal(h.page.onShareAppMessage().path,"/pages/personality/personality");
  await h.page.prepareShare();assert.equal(h.page.data.sharePanel,true);assert.match(h.page.onShareAppMessage().path,/\?share=c{48}$/);
  await h.page.saveImage();assert.equal(h.page.data.albumDenied,true);assert.match(h.page.data.imageError,/相册权限/);
  h.page.albumSettings();assert.equal(h.page.data.albumDenied,false);assert.deepEqual(h.events,["album","settings"]);
  h.page.onUnload();
});
test("原生退出保存答题进度，返回原页面后继续，卸载屏蔽晚到回调",async()=>{
  const h=native();await h.page.onLoad();h.page.start();h.page.answer({currentTarget:{dataset:{id:"B"}}});h.page.next();h.page.onHide();
  const draft=[...h.values.entries()].find(([key])=>key.startsWith("avalon16:draft:"))[1];assert.equal(draft.answers.Q01,"B");assert.equal(draft.current,"Q02");
  h.page.back();assert.equal(h.page.data.mode,"intro");h.page.start();assert.equal(h.page.data.question.id,"Q02");
  h.page.onUnload();const old=JSON.stringify(h.page.data);h.page.flow.answer("C");assert.equal(JSON.stringify(h.page.data),old);
});
