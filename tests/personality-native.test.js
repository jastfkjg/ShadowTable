const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const folder=path.resolve(__dirname,"../miniprogram/pages/personality");
const quiz=require("../miniprogram/pages/personality/quiz.json"),scoring=require("../miniprogram/pages/personality/scoring"),present=require("../miniprogram/pages/personality/presentation");
const fixture=require("./fixtures/personality/reachability-v3.json").fixtures.find(row=>row.expectedTypeId==="ASS-B");
const view=present.result(scoring.scoreQuiz(quiz,fixture.answers));

// Load the page and its dependencies as JavaScript, without Node's JSON loader.
function loadNativePage(context, mocks) {
  const modules = new Map(Object.entries(mocks).map(([name, value]) => [path.resolve(folder, name + ".js"), { exports: value }]));
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const compile = vm.compileFunction(fs.readFileSync(filename, "utf8"), ["require", "module", "exports"], { filename, parsingContext: context });
    compile(name => load(path.resolve(path.dirname(filename), name.endsWith(".js") ? name : name + ".js")), module, module.exports);
    return module.exports;
  }
  load(path.join(folder, "personality.js"));
}

function native({single=false,latest=null,saveResult,renderImage=async()=>"/tmp/personality.png",saveAlbum}={}){
  const values=new Map([["session","native-session"]]),reads=[],events=[];let definition;
  const account={accountKey:"a".repeat(64),identityType:"wx",latest,history:[]};
  const api={assetUrl:path=>"https://example.test"+path,login:async()=>{reads.push("login");},requestId:()=>"native_attempt_0000001",
    request:async(path,method,data)=>{reads.push(path);if(path==="/api/me/personality")return account;if(path==="/api/me/personality/results"&&saveResult)return saveResult();if(path==="/api/me/personality/shares")return {id:"c".repeat(48),name:"测试玩家",view};throw Error("unexpected "+path);}};
  const wx={getStorageSync:key=>{if(single)throw Error("single page cannot read storage");return values.get(key);},setStorageSync:(k,v)=>values.set(k,v),removeStorageSync:key=>values.delete(key),
    pageScrollTo:()=>{},showShareMenu:()=>{},hideShareMenu:()=>{},showToast:()=>{},
    request:options=>{reads.push(options.url);options.success({statusCode:200,data:{id:"c".repeat(48),name:"朋友",view}});},
    saveImageToPhotosAlbum:options=>{events.push("album");if(saveAlbum)saveAlbum(options);else options.fail({errMsg:"auth denied"});},
    openSetting:options=>{events.push("settings");options.success({authSetting:{"scope.writePhotosAlbum":true}});}};
  loadNativePage(vm.createContext({Page:value=>definition=value,wx,console}), {
    "../../api": api,
    "../../share-image": { renderImage },
    "../../dialog": { show: async () => ({ confirm: true }) },
    "../../profile": { backToMe: () => events.push("back") },
    "../../records-share": { isSinglePage: () => single },
  });
  const page={...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  return {page,reads,events,values};
}
test("小程序 JS 题库与原始 JSON 完全一致", () => {
  assert.deepEqual(require("../miniprogram/pages/personality/quiz-data"), quiz);
});
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
test("出图期间同步同一份结果不会取消相册保存，页签仍能切换",async()=>{
  let confirmSync, finishImage;
  const h=native({
    saveResult:()=>new Promise(resolve=>{confirmSync=resolve;}),
    renderImage:()=>new Promise(resolve=>{finishImage=resolve;}),
    saveAlbum:options=>options.success(),
  });
  await h.page.onLoad();
  h.page.onReady();
  h.page.start();
  const questions=quiz.questions;
  for(const q of questions.slice(0,-1)){
    h.page.answer({currentTarget:{dataset:{id:fixture.answers[q.id]}}});
    h.page.next();
  }
  h.page.answer({currentTarget:{dataset:{id:fixture.answers[questions.at(-1).id]}}});
  const syncing=h.page.next();
  await Promise.resolve();
  const savingImage=h.page.saveImage();
  assert.equal(h.page.data.rendering,true);
  confirmSync({id:"b".repeat(48),view:structuredClone(view),createdAt:1700000000000,version:quiz.version});
  await syncing;
  assert.ok(h.page.data.record);
  finishImage("/tmp/personality-after-sync.png");
  await savingImage;
  assert.deepEqual(h.events,["album"]);
  assert.equal(h.page.data.imagePath,"/tmp/personality-after-sync.png");
  h.page.selectResultTab({currentTarget:{dataset:{tab:"preferences"}}});
  assert.equal(h.page.data.resultTab,"preferences");
  assert.equal(h.page.data.preferences.length,7);
  h.page.onUnload();
});
