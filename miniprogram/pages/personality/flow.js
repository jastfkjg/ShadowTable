(function(root,factory){
  if(typeof module === "object" && module.exports) module.exports=factory(require("./quiz-data"),require("./scoring"),require("./presentation"),require("../../personality-storage"));
  else root.shadowtablePersonalityFlow=factory(root.shadowtablePersonalityQuiz,root.shadowtablePersonalityScoring,root.shadowtablePersonalityPresentation,root.shadowtablePersonalityStorage);
})(typeof window === "object" ? window : this,function(quiz,scoring,present,cacheFactory){
  "use strict";
  const validId=value=>typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
  const validAttempt=value=>typeof value === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(value);
  const firstQuestion=quiz.questions[0].id;
  const lastQuestion=quiz.questions[quiz.questions.length-1].id;
  const legacyVersion="2.0.0";
  const tabs = [
    { id:"overview", label:"风格解读" },
    { id:"preferences", label:"本次偏好" },
    { id:"evidence", label:"作答依据" },
  ];
  const transient = error => [408, 502, 503, 504].includes(error.status) || error.retryable === true;
  function validateDraft(value) {
    if(!value || value.version!==quiz.version || !validAttempt(value.attemptId))return null;
    try {
      if(!value.tieAnswers || Array.isArray(value.tieAnswers) || typeof value.tieAnswers!=="object")return null;
      scoring.scoreQuiz(quiz,value.answers,value.tieAnswers);
      const ids=[...quiz.questions.map(q=>q.id),"T_ROLE","T_STYLE"];
      if(!ids.includes(value.current))return null;
      return JSON.parse(JSON.stringify(value));
    }catch{return null;}
  }
  function create(deps) {
    const cache=cacheFactory.create(deps.storage);
    let alive=true,epoch=0,account=null,credential="",draft=null,saving=null;
    let state={ mode:"intro",loading:true,error:"",storageError:"",saveError:"",shareError:"",notice:"",saving:false,sharing:false,
      hasDraft:false,completedCount:0,question:null,result:null,record:null,shared:null,history:[],rulesOpen:false,detailsOpen:false,catalogueOpen:false,
      terms:present.terms,catalogue:present.catalogue(),version:quiz.version,questionTotal:quiz.questions.length,identityType:"",oldDraft:false,
      resultTab:"overview",tabs,preferences:[] };
    const emit=patch=>{
      if(!alive)return;
      if("result" in patch && patch.result!==state.result){
        patch.preferences=present.preferences(patch.result);
        patch.activeStyle=patch.result?.typeId?.slice(-1) || "";
      }
      state={...state,...patch};deps.onChange?.(state);
    };
    const current=(at=epoch)=>alive && at===epoch && credential===deps.credential();
    const guard=()=>{if(!current()){emit({error:"账号已变化，请重新载入测试",question:null,result:null,record:null,hasDraft:false,mode:"intro"});return false;}return !!account;};
    function persist() {
      try {cache.saveDraft(account.accountKey,draft);emit({storageError:""});return true;}
      catch {emit({storageError:"本机进度暂时无法保存，请保持此页打开，稍后重试保存。"});return false;}
    }
    function readDraft() {
      const raw=cache.draft(account.accountKey,quiz.version);
      const oldVersion=cache.previousVersion(account.accountKey);
      draft=validateDraft(raw);
      // An older, finished attempt may have lost its save response. Its local
      // view can be shown immediately; the server recomputes it with v2 weights.
      if(!draft){
        const legacy=cache.draft(account.accountKey,legacyVersion);
        if(legacy?.completed && legacy.version===legacyVersion && validAttempt(legacy.attemptId) &&
          legacy.localView?.version===legacyVersion && legacy.localView.typeId && legacy.answers && legacy.tieAnswers){
          draft=JSON.parse(JSON.stringify(legacy));
        }
      }
      emit({hasDraft:!!draft,completedCount:Object.keys(draft?.answers||{}).length,oldDraft:!draft && !!oldVersion && oldVersion!==quiz.version,
        ...(raw&&!draft?{storageError:"本地进度无法识别，原记录已保留。请开始一次新测试。"}:{})});
    }
    function showQuestion(id) {
      draft.current=id;persist();
      const selected=id.startsWith("T_")?draft.tieAnswers[id]:draft.answers[id];
      emit({mode:"quiz",question:present.question(id,selected),rulesOpen:false,error:"",hasDraft:true,completedCount:Object.keys(draft.answers).length,result:null,record:null,shared:null});
    }
    function restore() {
      emit({identityType:account.identityType,history:(account.history||[]).map(row=>({...row,dateLabel:present.date(row.createdAt)}))});readDraft();
      if(draft?.completed){
        if(draft.version!==quiz.version) {
          emit({mode:"result",result:draft.localView,record:null,hasDraft:true});
          return;
        }
        const result=scoring.scoreQuiz(quiz,draft.answers,draft.tieAnswers);
        if(result.status==="complete")emit({mode:"result",result:present.result(result),record:null,hasDraft:true});
        else {draft.completed=false;persist();emit({mode:"intro"});}
      } else if(!draft && account.latest) emit({mode:"result",result:account.latest.view,record:account.latest});
      else emit({mode:"intro"});
    }
    async function load(options={}) {
      const at=++epoch;
      saving=null;
      emit({loading:true,saving:false,sharing:false,error:"",saveError:"",shareError:"",shared:null,question:null,result:null,record:null,resultTab:"overview",detailsOpen:false});
      if(options.share){
        if(!validId(options.share)){emit({loading:false,error:"分享不存在或已失效",mode:"shared"});return;}
        try{const shared=await deps.publicRequest("/api/personality/shares/"+options.share);if(!alive||at!==epoch)return;emit({mode:"shared",shared,result:shared.view});}
        catch(error){if(alive&&at===epoch)emit({mode:"shared",error:error.message});}
        finally{if(alive&&at===epoch)emit({loading:false});}
        return;
      }
      try {
        await deps.login();if(!alive||at!==epoch)return;credential=deps.credential();
        const response=await deps.request("/api/me/personality");if(!current(at))return;
        account=response;
        try{cache.bind(credential,account);}catch{emit({storageError:"本机无法保存进度，答题期间请保持页面打开。"});}
        restore();
        if(options.result){
          if(!validId(options.result))throw new Error("人格结果不存在");
          const record=await deps.request("/api/me/personality/results/"+options.result);if(!current(at))return;
          emit({mode:"result",result:record.view,record});
        }
      }catch(error){
        if(!alive||at!==epoch)return;
        // Authentication failures must not display or submit cached private data.
        const cached=(!error.status || error.status>=500 || error.status===429) && cache.account(deps.credential());
        if(cached){credential=deps.credential();account=cached;restore();emit({notice:"暂时无法同步账号，已恢复本机记录。联网后可重试保存。"});}
        else {account=null;draft=null;emit({mode:"intro",error:error.message,hasDraft:false,result:null,record:null});}
      }finally{if(alive&&at===epoch)emit({loading:false});}
      if(current(at) && draft?.completed && !state.record)return save();
    }
    function start(fresh=false) {
      if(!guard()||state.loading||state.saving||state.sharing)return;
      if(!draft||fresh){
        draft={version:quiz.version,total:quiz.questions.length,attemptId:deps.requestId(),answers:{},tieAnswers:{},current:firstQuestion,completed:false};
        emit({shared:null,record:null,saveError:"",shareError:"",notice:"",resultTab:"overview",detailsOpen:false,catalogueOpen:false,oldDraft:false});
      }
      if(draft.completed){
        const view=draft.version===quiz.version?present.result(scoring.scoreQuiz(quiz,draft.answers,draft.tieAnswers)):draft.localView;
        emit({mode:"result",result:view,record:null});
        return save();
      }
      const score=scoring.scoreQuiz(quiz,draft.answers,draft.tieAnswers);
      const id=draft.current.startsWith("T_") ? score.status==="needs_tiebreak" ? score.pendingQuestionIds[0] : score.status==="incomplete" ? score.missingQuestionIds[0] : lastQuestion : draft.current;
      showQuestion(id);
    }
    function answer(id) {
      if(!guard()||state.mode!=="quiz"||!state.question?.options.some(option=>option.id===id))return;
      const qid=state.question.id;
      if(qid.startsWith("T_"))draft.tieAnswers[qid]=id;
      else if(draft.answers[qid]!==id){draft.answers[qid]=id;draft.tieAnswers={};}
      draft.completed=false;delete draft.localView;persist();
      emit({question:present.question(qid,id),completedCount:Object.keys(draft.answers).length,saveError:""});
    }
    function next() {
      if(!guard()||state.mode!=="quiz"||!state.question?.selected)return;
      const index=quiz.questions.findIndex(q=>q.id===state.question.id);
      if(index>=0 && index<quiz.questions.length-1){showQuestion(quiz.questions[index+1].id);return;}
      const result=scoring.scoreQuiz(quiz,draft.answers,draft.tieAnswers);
      if(result.status==="incomplete"){showQuestion(result.missingQuestionIds[0]);return;}
      if(result.status==="needs_tiebreak"){showQuestion(result.pendingQuestionIds[0]);return;}
      draft.completed=true;draft.localView=present.result(result);persist();
      emit({mode:"result",result:draft.localView,record:null,question:null,rulesOpen:false});return save();
    }
    function previous() {
      if(!guard()||!draft||state.mode!=="quiz")return;
      const id=state.question.id,index=quiz.questions.findIndex(q=>q.id===id);
      showQuestion(index>0?quiz.questions[index-1].id:id==="T_STYLE" && draft.tieAnswers.T_ROLE?"T_ROLE":index===0?firstQuestion:lastQuestion);
    }
    async function idempotentWrite(path, data, at) {
      try {
        return await deps.request(path,"POST",data);
      } catch(error) {
        if(!transient(error) || !current(at)) throw error;
        return deps.request(path,"POST",data);
      }
    }
    async function save() {
      if(!guard()||!draft?.completed||state.record)return state.record;
      if(saving)return saving;
      const at=epoch,attempt=draft;emit({saving:true,saveError:""});
      const run=async()=>{
        try{
          if(!current(at) || draft!==attempt)return null;
          const record=await idempotentWrite("/api/me/personality/results",{version:attempt.version,attemptId:attempt.attemptId,answers:attempt.answers,tieAnswers:attempt.tieAnswers},at);
          if(!current(at)||draft!==attempt)return null;
          account={...account,latest:record,history:[{id:record.id,version:record.version,createdAt:record.createdAt,roleName:record.view.roleName,title:record.view.title,portrait:record.view.portrait},...(account.history||[]).filter(row=>row.id!==record.id)].slice(0,20)};
          try{cache.bind(credential,account);cache.removeDraft(account.accountKey,attempt.version);emit({storageError:""});}catch{emit({storageError:"结果已保存到账号，本机缓存更新失败。"});}
          draft=null;emit({result:record.view,record,hasDraft:false,history:account.history.map(row=>({...row,dateLabel:present.date(row.createdAt)})),notice:"",saveError:"",shareError:""});return record;
        }catch(error){if(alive&&at===epoch){if(!current(at))guard();else emit({saveError:transient(error)?"暂未确认账号保存，请重试。":error.message});}return null;}
        finally{if(saving===pending)saving=null;if(alive&&at===epoch)emit({saving:false});}
      };
      const pending=Promise.resolve().then(run);
      saving=pending;
      return pending;
    }
    async function share() {
      if(!guard()||state.mode!=="result"||state.loading||state.sharing)return null;
      if(state.shared)return state.shared;
      const at=epoch;emit({sharing:true,shareError:""});
      try{
        const record=state.record||await save();
        if(!current(at))return null;
        if(!record){emit({shareError:"账号同步后即可分享链接，也可以先保存图片。"});return null;}
        const shared=await idempotentWrite("/api/me/personality/shares",{resultId:record.id},at);
        if(!current(at)||state.record?.id!==record.id)return null;
        emit({shared});return shared;
      }catch(error){if(current(at))emit({shareError:transient(error)?"暂未生成分享链接，请再试一次。":error.message});return null;}
      finally{if(alive&&at===epoch)emit({sharing:false});}
    }
    async function openResult(id) {
      if(!guard()||state.loading||state.saving||state.sharing||!validId(id))return;
      const at=++epoch;emit({loading:true,error:"",shared:null});
      try{const record=await deps.request("/api/me/personality/results/"+id);if(current(at))emit({mode:"result",result:record.view,record,resultTab:"overview",detailsOpen:false,catalogueOpen:false,shareError:""});}
      catch(error){if(current(at))emit({error:error.message});}
      finally{if(current(at))emit({loading:false});}
    }
    return {load,start,answer,next,previous,save,share,openResult,
      selectTab(id){if(state.mode==="result"&&tabs.some(tab=>tab.id===id))emit({resultTab:id});},
      intro(){if(guard())emit({mode:"intro",rulesOpen:false});},
      toggle(key){if(["rulesOpen","detailsOpen","catalogueOpen"].includes(key))emit({[key]:!state[key]});},
      persist(){if(guard()&&draft)persist();},
      state:()=>state,
      dispose(){alive=false;epoch++;},
    };
  }
  return {create,validateDraft};
});
