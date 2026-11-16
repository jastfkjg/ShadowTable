const {test}=require("node:test");
const assert=require("node:assert/strict");
const flow=require("../miniprogram/pages/personality/flow");
const cacheFactory=require("../miniprogram/personality-storage");
const quiz=require("../miniprogram/pages/personality/quiz.json");
const scoring=require("../miniprogram/pages/personality/scoring");
const presentation=require("../miniprogram/pages/personality/presentation");
const lastQuestion=quiz.questions.at(-1);
const fixtures=require("./fixtures/personality/reachability-v3.json").fixtures;
function harness(values=new Map()) {
  let credential="session-one",offline=false,failSave=false,attempt=0,posts=0;
  const account={accountKey:"a".repeat(64),identityType:"wx",latest:null,history:[]};
  const storage={get:key=>values.get(key),set:(key,value)=>values.set(key,structuredClone(value)),remove:key=>values.delete(key)};
  const deps={storage,credential:()=>credential,login:async()=>{},requestId:()=>"personality_attempt_"+(++attempt),onChange:()=>{},
    publicRequest:async()=>({id:"f".repeat(48),name:"朋友",view:{title:"静默猎手"}}),
    request:async(path,method,data)=>{
      if(offline)throw new Error("离线");
      if(path==="/api/me/personality")return structuredClone(account);
      if(path==="/api/me/personality/results"){
        posts++;if(failSave)throw new Error("同步失败");
        const record={id:"b".repeat(48),version:quiz.version,createdAt:1700000000000,view:presentation.result(scoring.scoreQuiz(quiz,data.answers,data.tieAnswers))};
        account.latest=record;return record;
      }
      if(path==="/api/me/personality/shares")return {id:"f".repeat(48),view:account.latest.view};
      if(path.startsWith("/api/me/personality/results/"))return account.latest;
      throw new Error("unexpected "+path);
    }};
  return {values,storage,deps,account,create:()=>flow.create(deps),offline:value=>offline=value,failSave:value=>failSave=value,credential:value=>credential=value,posts:()=>posts};
}
async function complete(session,answers) {session.start();for(const q of quiz.questions){assert.equal(session.state().question.id,q.id);session.answer(answers[q.id]);await session.next();}}
test("断点续答恢复选项与位置，上一题修改按稳定ID保存",async()=>{
  const h=harness();let session=h.create();await session.load();session.start();
  session.answer("C");session.next();session.answer("A");session.next();session.dispose();
  session=h.create();await session.load();assert.equal(session.state().hasDraft,true);assert.equal(session.state().completedCount,2);
  session.start();assert.equal(session.state().question.id,"Q03");session.previous();assert.equal(session.state().question.selected,"A");
  session.answer("B");session.previous();assert.equal(session.state().question.selected,"C");
  const saved=cacheFactory.create(h.storage).draft(h.account.accountKey,quiz.version);assert.equal(saved.answers.Q02,"B");
  session.dispose();
});
test("断网可恢复已绑定账号进度，完整结果本地保留，联网重试仅保存当前答卷",async()=>{
  const h=harness();let session=h.create();await session.load();session.start();session.answer(fixtures[0].answers.Q01);session.dispose();
  h.offline(true);session=h.create();await session.load();assert.equal(session.state().hasDraft,true);assert.match(session.state().notice,/本机记录/);
  await complete(session,fixtures[0].answers);assert.equal(session.state().result.typeId,fixtures[0].expectedTypeId);assert.equal(session.state().record,null);assert.ok(session.state().saveError);
  session.dispose();h.offline(false);session=h.create();await session.load();assert.ok(session.state().record);assert.equal(session.state().hasDraft,false);assert.equal(h.posts(),1);
  assert.equal(cacheFactory.create(h.storage).draft(h.account.accountKey,quiz.version),null);
  const saved=await session.share();assert.equal(saved.id,"f".repeat(48));session.dispose();
});
test("真实风格同分进入补题，返回修改清除旧补题，完成后才展示人格",async()=>{
  let seed=19,answers,result;
  for(let i=0;i<2000;i++){
    answers=Object.fromEntries(quiz.questions.map(q=>{seed=(seed*1664525+1013904223)>>>0;return [q.id,q.options[seed%3].id];}));
    result=scoring.scoreQuiz(quiz,answers);if(result.status==="needs_tiebreak"&&result.pendingQuestionIds.includes("T_STYLE"))break;
  }
  assert.equal(result.status,"needs_tiebreak");
  const h=harness(),session=h.create();await session.load();await complete(session,answers);
  assert.equal(session.state().mode,"quiz");assert.equal(session.state().result,null);
  if(session.state().question.id==="T_ROLE"){session.answer("A");await session.next();}
  assert.equal(session.state().question.id,"T_STYLE");assert.equal(session.state().question.options.length,2);
  session.answer("B");session.previous();
  while(session.state().question.supplemental)session.previous();
  const option=lastQuestion.options.find(o=>o.id!==answers[lastQuestion.id]).id;session.answer(option);
  assert.deepEqual(cacheFactory.create(h.storage).draft(h.account.accountKey,quiz.version).tieAnswers,{});
  session.answer(answers[lastQuestion.id]);await session.next();
  while(session.state().mode==="quiz"){session.answer(session.state().question.id==="T_STYLE"?"B":"A");await session.next();}
  assert.match(session.state().result.typeId,/-B$/);session.dispose();
});
test("旧版进度保留且不套用新权重，账号切换不显示或提交上一账号答案",async()=>{
  const h=harness(),cache=cacheFactory.create(h.storage);cache.bind("session-one",h.account);
  cache.saveDraft(h.account.accountKey,{version:"1.0.0",answers:{Q01:"A"}});
  const session=h.create();await session.load();assert.equal(session.state().oldDraft,true);assert.equal(session.state().hasDraft,false);
  session.start();assert.equal(session.state().question.id,"Q01");assert.ok(cache.draft(h.account.accountKey,"1.0.0"));
  session.answer("A");h.credential("another-account");session.next();assert.equal(session.state().question,null);assert.match(session.state().error,/账号已变化/);assert.equal(h.posts(),0);
  assert.equal(cache.account("another-account"),null);session.dispose();
});
test("升级后将已完成但尚未同步的 v2 答卷原样提交",async()=>{
  const legacy=require("../server/personality-quiz-v2.json");
  const {answers}=require("./fixtures/personality/reachability-fixtures.json").fixtures[0];
  const localView=presentation.result(scoring.scoreQuiz(legacy,answers),legacy);
  const h=harness(),cache=cacheFactory.create(h.storage);
  cache.bind("session-one",h.account);
  cache.saveDraft(h.account.accountKey,{version:legacy.version,completed:true,current:"Q28",answers,tieAnswers:{},localView,attemptId:"legacy_attempt_0001"});
  const request=h.deps.request;
  let submitted;
  h.deps.request=(path,method,data)=>{
    if(path!=="/api/me/personality/results")return request(path,method,data);
    submitted=data;
    return Promise.resolve({id:"b".repeat(48),version:legacy.version,view:localView,createdAt:1700000000000});
  };
  const session=h.create();
  await session.load();
  assert.deepEqual(submitted,{version:legacy.version,answers,tieAnswers:{},attemptId:"legacy_attempt_0001"});
  assert.equal(session.state().result.version,legacy.version);
  assert.equal(cache.draft(h.account.accountKey,legacy.version),null);
  session.start(true);
  assert.equal(session.state().questionTotal,15);
  assert.equal(session.state().question.id,"Q01");
  session.dispose();
});
test("晚到的保存响应不会泄露到切换后的账号，分享读取无需登录与本地存储",async()=>{
  const h=harness();let release;
  const original=h.deps.request;
  h.deps.request=(path,...args)=>path==="/api/me/personality/results"?new Promise(r=>{release=()=>original(path,...args).then(r);}):original(path,...args);
  const session=h.create();await session.load();session.start();
  for(const q of quiz.questions){session.answer(fixtures[0].answers[q.id]);if(q.id!==lastQuestion.id)await session.next();}
  const pending=session.next();await Promise.resolve();h.credential("session-two");release();await pending;assert.equal(session.state().record,null);session.dispose();
  const publicFlow=flow.create({...h.deps,login:()=>{throw new Error("must not login");},storage:{get(){throw new Error("no storage");}},credential:()=>{throw new Error("no credential");}});
  await publicFlow.load({share:"f".repeat(48)});assert.equal(publicFlow.state().mode,"shared");assert.equal(publicFlow.state().result.title,"静默猎手");publicFlow.dispose();
});
test("本地存储失败明确反馈，不伪称已保存；重测保留账号历史",async()=>{
  const h=harness();const session=h.create();await session.load();await complete(session,fixtures[0].answers);assert.equal(session.state().history.length,1);
  session.start(true);session.answer("B");assert.equal(h.account.latest.view.typeId,fixtures[0].expectedTypeId);
  session.dispose();
  const broken=h.create();h.storage.set=()=>{throw new Error("quota");};await broken.load();broken.start();broken.answer("A");assert.match(broken.state().storageError,/无法保存/);broken.dispose();
});
test("保存和分享响应丢失后各自用相同参数重试，分享等待同一次账号保存",async()=>{
  const h=harness();
  const original=h.deps.request;
  const writes=[];
  h.deps.request=async(path,method,data)=>{
    const response=await original(path,method,data);
    if(method==="POST"){
      const first=!writes.some(write=>write.path===path);
      writes.push({path,data:structuredClone(data)});
      if(first)throw Object.assign(new Error("模拟响应丢失"),{retryable:true});
    }
    return response;
  };
  const session=h.create();
  await session.load();
  session.start();
  for(const q of quiz.questions){
    session.answer(fixtures[0].answers[q.id]);
    if(q.id!==lastQuestion.id)session.next();
  }
  const saving=session.next();
  assert.equal(session.state().mode,"result");
  const sharing=session.share();
  await saving;
  assert.equal((await sharing).id,"f".repeat(48));
  assert.equal(writes.length,4);
  assert.deepEqual(writes[0],writes[1]);
  assert.deepEqual(writes[2],writes[3]);
  assert.equal(writes[2].data.resultId,session.state().record.id);
  assert.equal(session.state().saveError,"");
  assert.equal(session.state().shareError,"");
  session.dispose();
});
test("两次超时后保留本机结果，分享反馈等待同步并可在恢复联网后重试",async()=>{
  const h=harness();
  const original=h.deps.request;
  let fail=true, attempts=0;
  h.deps.request=(path,method,data)=>{
    if(path==="/api/me/personality/results"){
      attempts++;
      if(fail)throw Object.assign(new Error("模拟超时"),{retryable:true});
    }
    return original(path,method,data);
  };
  const session=h.create();
  await session.load();
  await complete(session,fixtures[0].answers);
  assert.equal(attempts,2);
  assert.match(session.state().saveError,/暂未确认账号保存/);
  assert.ok(cacheFactory.create(h.storage).draft(h.account.accountKey,quiz.version).completed);
  assert.equal(await session.share(),null);
  assert.match(session.state().shareError,/先保存图片/);
  fail=false;
  await session.save();
  assert.equal(session.state().shareError,"");
  assert.ok((await session.share()).id);
  session.dispose();
});
