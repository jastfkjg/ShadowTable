const { test }=require("node:test");
const assert=require("node:assert/strict");
const { createHash }=require("node:crypto");
const { readFileSync }=require("node:fs");
const { pathToFileURL }=require("node:url");
const { join }=require("node:path");
const quiz=require("../miniprogram/pages/personality/quiz.json");
const legacyQuiz=require("../server/personality-quiz-v2.json");
const scoring=require("../miniprogram/pages/personality/scoring");
const presentation=require("../miniprogram/pages/personality/presentation");
const legacyFixtures=require("./fixtures/personality/reachability-fixtures.json").fixtures;
const fixtures=require("./fixtures/personality/reachability-v3.json").fixtures;
const { Store }=require("../server/store");
const personality=require("../server/personality");
const payload=(i=0,attemptId="personality_attempt_0001")=>({version:quiz.version,attemptId,answers:fixtures[i].answers,tieAnswers:{}});

test("归档题库逐字保留，旧版 16 种结果与原始计分器一致",async()=>{
  const manifest=require("./fixtures/personality/manifest.json");
  const bytes=readFileSync(join(__dirname,"../server/personality-quiz-v2.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),manifest.files["quiz.json"]);
  assert.equal(createHash("sha256").update(readFileSync(join(__dirname,"fixtures/personality/scoring.mjs"))).digest("hex"),manifest.files["scoring.mjs"]);
  const original=await import(pathToFileURL(join(__dirname,"fixtures/personality/scoring.mjs")));
  assert.equal(scoring.validateConfig(legacyQuiz),true);
  for(const fixture of legacyFixtures){
    const result=scoring.scoreQuiz(legacyQuiz,fixture.answers);
    assert.deepEqual(result,original.scoreQuiz(legacyQuiz,fixture.answers));
    assert.equal(result.typeId,fixture.expectedTypeId);
  }
});
test("新版 15 题覆盖全部 16 种结果，解释来自真实选项",()=>{
  assert.equal(scoring.validateConfig(quiz),true);
  assert.equal(quiz.questions.length,15);
  assert.deepEqual(quiz.questions.map(q=>q.kind),[...Array(10).fill("short"),...Array(5).fill("scenario")]);
  for(const fixture of fixtures){
    const result=scoring.scoreQuiz(quiz,fixture.answers);
    assert.equal(result.status,"complete");
    assert.equal(result.typeId,fixture.expectedTypeId);
    const reordered=structuredClone(quiz);reordered.questions.reverse();reordered.questions.forEach(q=>q.options.reverse());
    assert.equal(scoring.scoreQuiz(reordered,fixture.answers).typeId,result.typeId);
    const view=presentation.result(result);
    assert.equal(view.dimensions.length,7);assert.equal(view.style.id,"E");
    for(const e of view.explanations){assert.equal(fixture.answers[e.questionId],e.optionId);assert.equal(quiz.questions.find(q=>q.id===e.questionId).options.find(o=>o.id===e.optionId).text,e.text);}
  }
  assert.equal(new Set(fixtures.map(f=>f.expectedTypeId)).size,16);
});
test("新版情景符合任务人数，奥伯伦必失败，刺杀阶段只能落刀",()=>{
  const scenarios=quiz.questions.filter(q=>q.kind==="scenario");
  assert.deepEqual(scenarios.map(q=>quiz.rulesets[q.rulesetId].players),[10,10,10,10,11]);
  for(const q of scenarios){
    const rules=quiz.rulesets[q.rulesetId];
    const teams=Object.values(q.optionTeams || {}).map(team=>({team,quest:q.questNumber,failCards:0}));
    if(q.proposedTeam)teams.push({team:q.proposedTeam,quest:q.questNumber,failCards:0});
    for(const {team,quest,failCards} of [...teams,...(q.history || [])]){
      assert.equal(team.length,rules.teamSizes[quest-1],q.id);
      assert.equal(team.length,new Set(team).size,q.id);
      assert.ok(team.every(seat=>Number.isInteger(seat)&&seat>=1&&seat<=rules.players),q.id);
      assert.ok(failCards>=0 && failCards<=team.length,q.id);
    }
  }
  const [,oberon,,assassin]=scenarios;
  assert.match(oberon.situation,/只能出失败/);
  assert.equal(assassin.phase,"assassination");
  assert.match(assassin.situation,/全桌禁言/);
  assert.ok(assassin.options.every(option=>/^刀 [345]。/.test(option.text)));
});
test("缺答和非法答案不能定型，E独立于角色，精确同分按各自补题处理",()=>{
  assert.equal(scoring.scoreQuiz(quiz,{}).status,"incomplete");
  assert.throws(()=>scoring.scoreQuiz(quiz,{...fixtures[0].answers,Q01:"bad"}));
  const profile=scoring.aggregateProfile(quiz,fixtures[0].answers).profile;
  assert.deepEqual(scoring.rankRoles(quiz,{...profile,E:-1}),scoring.rankRoles(quiz,{...profile,E:1}));
  const ranked=scoring.rankRoles(quiz,Object.fromEntries(quiz.dimensions.map(d=>[d.id,0])));
  assert.equal(scoring.resolveRole(quiz,ranked).roleId,null);
  assert.ok(scoring.resolveRole(quiz,ranked,"A").roleId);
  for(const choice of ["A","B","C"]){
    const subset=ranked.map(r=>({...r,score:["merlin","lancelot"].includes(r.roleId)?0:-1})).sort((a,b)=>b.score-a.score);
    assert.ok(["merlin","lancelot"].includes(scoring.resolveRole(quiz,subset,choice).roleId));
  }
  assert.equal(scoring.resolveSubtype(quiz,0).subtype,null);
  assert.equal(scoring.resolveSubtype(quiz,0,"B").subtype,"B");
  assert.equal(presentation.question("T_STYLE").options.length,2);
});
test("账号结果复算、重试幂等、历史隔离，公开分享固定且不泄露答案",()=>{
  let now=1700000000000;const store=new Store(":memory:",{clock:()=>now});personality.initialize(store);
  try{
    const old={...payload(),version:legacyQuiz.version,answers:legacyFixtures[0].answers};
    const first=personality.save(store,"wx:one",old);
    assert.equal(first.view.typeId,legacyFixtures[0].expectedTypeId);
    assert.equal(first.view.version,legacyQuiz.version);
    assert.deepEqual(personality.save(store,"wx:one",old),first);
    assert.throws(()=>personality.save(store,"wx:one",payload(1)),e=>e.status===409);
    assert.throws(()=>personality.read(store,"wx:two",first.id),e=>e.status===404);
    assert.equal(personality.account(store,"wx:two").latest,null);
    const snapshot=personality.share(store,"wx:one",{resultId:first.id});
    assert.equal(personality.share(store,"wx:one",{resultId:first.id}).id,snapshot.id);
    assert.throws(()=>personality.share(store,"wx:two",{resultId:first.id}),e=>e.status===404);
    assert.doesNotMatch(JSON.stringify(snapshot),/answers|explanations|questionId|optionId|dimensions|profile|accountKey|attemptId|wx:one|uid/);
    now++;const second=personality.save(store,"wx:one",payload(1,"personality_attempt_0002"));
    assert.equal(second.view.version,quiz.version);
    assert.equal(personality.account(store,"wx:one").latest.id,second.id);
    assert.equal(personality.account(store,"wx:one").history.length,2);
    assert.deepEqual(personality.readShare(store,snapshot.id),snapshot);
    assert.throws(()=>personality.save(store,"wx:one",{...payload(),view:{typeId:"ASS-B"}}));
    assert.throws(()=>personality.save(store,"wx:one",{...payload(),version:"old"}),e=>e.status===409);
    assert.throws(()=>personality.save(store,"wx:one",{...payload(),answers:{}}),/全部题目/);
  }finally{store.close();}
});

test("HTTP端点保护个人结果，公开链接无需登录，服务重开保留数据",async()=>{
  const {createApp}=require("../server/app"),{mkdtempSync,rmSync}=require("node:fs"),{tmpdir}=require("node:os");
  const directory=mkdtempSync(join(tmpdir(),"personality-test-"));let app;
  async function start(){app=createApp({database:join(directory,"test.sqlite"),devAuth:true});await new Promise(r=>app.server.listen(0,"127.0.0.1",r));}
  async function close(){await new Promise(r=>app.server.close(r));app.store.close();app=null;}
  async function req(path,token,data){const response=await fetch("http://127.0.0.1:"+app.server.address().port+path,{method:data?"POST":"GET",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(token||"")},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};}
  try{
    await start();const token=(await req("/api/dev-login",null,{})).data.token;
    assert.equal((await req("/api/me/personality")).status,401);
    const saved=await req("/api/me/personality/results",token,payload());assert.equal(saved.status,200);
    const shared=await req("/api/me/personality/shares",token,{resultId:saved.data.id});assert.equal(shared.status,200);
    assert.equal((await req("/api/personality/shares/"+shared.data.id)).data.view.typeId,fixtures[0].expectedTypeId);
    await close();await start();
    assert.equal((await req("/api/me/personality",token)).data.latest.id,saved.data.id);
    assert.equal((await req("/api/personality/shares/"+shared.data.id)).status,200);
    const other=(await req("/api/dev-login",null,{})).data.token;
    assert.equal((await req("/api/me/personality/results/"+saved.data.id,other)).status,404);
  }finally{if(app)await close();rmSync(directory,{recursive:true,force:true});}
});
