/* Native and web use the same question, scoring, persistence and flow modules. */
(()=>{
  "use strict";
  const present=window.shadowtablePersonalityPresentation,poster=window.shadowtablePersonalityPoster;
  const root=document.getElementById("personality"),announcement=document.getElementById("persona-announcement");
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const safeGet=key=>{try{return localStorage.getItem(key)||"";}catch{return "";}};
  const storage={get:key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},set:(key,value)=>localStorage.setItem(key,JSON.stringify(value)),remove:key=>localStorage.removeItem(key)};
  let webTag="",initializing=null,retryAt=0,ui=null,previous=null,options=Object.fromEntries(new URLSearchParams(location.search)),imageBusy=false,sharePanel=false,shareUrl="",announcementTimer;
  const revision=safeGet("accountRevision");
  try{const saved=JSON.parse(sessionStorage.getItem("avalon16-web"));if(saved?.revision===revision&&safeGet("webAccount")==="wechat")webTag=saved.tag;}catch{}
  const credential=()=>safeGet("accountRevision")!==revision?"account-changed":webTag||safeGet("session");
  async function fetchJSON(path,method="GET",data,publicRead=false) {
    if(Date.now()<retryAt)throw new Error("请求冷却中，请稍后重试");
    const captured=credential(),headers={"Content-Type":"application/json"};
    if(!publicRead){if(webTag)headers["X-Web-Session"]=webTag;else if(safeGet("session"))headers.Authorization="Bearer "+safeGet("session");}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(path,{method,headers,credentials:publicRead?"omit":"same-origin",signal:controller.signal,...(data===undefined?{}:{body:JSON.stringify(data)})});
      if(!publicRead&&captured!==credential())throw Object.assign(new Error("账号已变化，请重新载入"),{status:409});
      const value=await response.json();
      if(!response.ok){if(response.status===429)retryAt=Date.now()+Math.max(1,Number(response.headers.get("Retry-After"))||60)*1000;throw Object.assign(new Error(value.error||"请求失败"),{status:response.status});}
      return value;
    }catch(error){if(error.name==="AbortError")throw new Error("请求超时，请稍后重试；本机进度会保留。");if(error.status)throw error;throw new Error("暂时无法连接服务，请检查网络后重试。");}
    finally{clearTimeout(timer);}
  }
  async function login() {
    if(initializing)return initializing;
    initializing=(async()=>{
      // Probe the existing same-origin login, never silently switch an expired WeChat account to a guest.
      const session=await fetchJSON("/api/web-auth/session");
      if(session.authenticated){webTag=session.sessionTag;sessionStorage.setItem("avalon16-web",JSON.stringify({tag:webTag,revision}));return;}
      webTag="";
      if(safeGet("webAccount"))throw Object.assign(new Error("小程序账号登录已过期，请返回「我的」重新登录。"),{status:401});
      if(!safeGet("session")){const result=await fetchJSON("/api/guest-login","POST",{});localStorage.setItem("session",result.token);}
    })().finally(()=>{initializing=null;});
    return initializing;
  }
  const button=(label,action,classes="persona-text-button",disabled=false,extra="")=>`<button type="button" class="${classes}" data-action="${action}"${disabled?" disabled":""}${extra}>${esc(label)}</button>`;
  const img=(src,classes="",alt="")=>`<img src="${esc(src)}" class="${classes}" alt="${esc(alt)}">`;
  const message=(text,action,label)=>text?`<div class="persona-message persona-error" role="alert">${esc(text)}${action?button(label,action):""}</div>`:"";
  const section=(number,title,body)=>`<section class="persona-section"><div class="persona-section-heading"><span class="persona-section-number">${number}</span><h2 class="persona-section-title">${esc(title)}</h2></div>${body}</section>`;
  function dimension(d){return `<div class="persona-dimension ${d.id==="E"?"persona-style":""}"><div class="persona-dimension-name">${esc(d.label)}</div><div class="persona-axis-labels"><span>${esc(d.negative)}</span><span>${esc(d.positive)}</span></div><div class="persona-axis ${d.positionClass}" role="img" aria-label="${esc(d.tendency)}"><div class="persona-axis-center"></div><div class="persona-axis-dot"></div></div>${d.id==="E"?'<div class="persona-small">介入风格只决定亚型，不改变主角色。</div>':""}</div>`;}
  function render(state) {
    ui=state;
    const scrollToTop=previous&&(state.mode!==previous.mode||state.question?.id!==previous.question?.id);
    if(state.result?.typeId!==previous?.result?.typeId||state.record?.id!==previous?.record?.id){sharePanel=false;shareUrl="";}
    const focused=document.activeElement?.dataset,focusAction=focused?.action,focusId=focused?.id;
    root.className="persona-page"+(state.mode==="quiz"?" persona-answering":"");
    let html=state.loading?'<p class="persona-status" role="status">正在读取你的牌桌故事…</p>':"";
    html+=message(state.error,"retry","重新载入")+(state.notice?`<div class="persona-message" role="status">${esc(state.notice)}</div>`:"")+message(state.storageError,state.mode==="quiz"?"persist":null,"重试保存进度");
    if(!state.loading&&state.mode==="intro"){
      html+=`<section class="persona-intro"><span class="persona-eyebrow">AVALON · 16 PERSONALITIES</span><h1 class="persona-intro-title" tabindex="-1">你是哪一种<span>阿瓦隆人格？</span></h1><div class="persona-intro-art" aria-hidden="true">${img("/assets/roles/assassin.png","persona-intro-side persona-intro-left")}${img("/assets/roles/merlin.png","persona-intro-main")}${img("/assets/roles/percival.png","persona-intro-side persona-intro-right")}</div><div class="persona-intro-copy">从看人、站边到藏身份，<span>发现你习惯的牌桌决策方式。</span></div><div class="persona-facts"><div><span>28</span>个情境</div><div><span>16</span>种风格</div><div><span>随时</span>暂停续答</div></div>${button(state.hasDraft?"继续答题 · "+state.completedCount+"/28":"开始探索","start","persona-primary",!!state.error)}<div class="persona-small persona-center">每题独立，按你通常会采取的行动选择</div></section>`;
      if(state.oldDraft)html+='<div class="persona-message">发现旧版未完成进度，已保留。当前题库已更新，请开始一次新测试。</div>';
      if(["guest","dev"].includes(state.identityType))html+='<div class="persona-small persona-account-note">当前为游客或开发账号，清除登录信息后无法自动找回结果。<a href="/#/me">前往我的</a></div>';
      html+=button(state.rulesOpen?"收起规则约定":"开始前，了解这些约定","rules","persona-disclosure",false,` aria-expanded="${state.rulesOpen}"`);
      if(state.hasDraft)html+=button("重新开始","retest");
    }
    if(!state.loading&&state.mode==="quiz"&&state.question){
      const q=state.question;
      html+=`<div class="persona-progress-meta"><span>${q.supplemental?"补充选择":"第 "+q.number+" / 28 题"}</span><span>${state.storageError?"进度待保存":"进度自动保存"}</span></div><div class="persona-progress ${q.progressClass}" aria-hidden="true"><div class="persona-progress-fill"></div></div><div class="persona-question"><div class="persona-context"><span>${esc(q.ruleset)}</span><span>本题你是 · ${esc(q.selfRole)}</span></div>${q.supplemental?'<div class="persona-small">还差一个选择，帮助区分你的倾向。</div>':""}<div class="persona-situation">${esc(q.situation)}</div>${q.history.length?`<div class="persona-history" aria-label="题目给出的任务记录">${q.history.map(h=>`<div class="persona-history-row"><span>${esc(h.label)}</span><span>${esc(h.team)}</span><span>${esc(h.outcome)}</span></div>`).join("")}</div>`:""}<h1 class="persona-prompt" tabindex="-1" id="persona-prompt">${esc(q.prompt)}</h1><div class="persona-options" role="radiogroup" aria-labelledby="persona-prompt">${q.options.map(o=>button("","answer","persona-option"+(o.selected?" is-selected":""),false,` data-id="${o.id}" role="radio" aria-checked="${o.selected}"`).replace('</button>',`<span class="persona-option-mark">${o.selected?"✓":o.label}</span><span class="persona-option-copy">${esc(o.text)}</span></button>`)).join("")}</div><div class="persona-rule-note">${esc(q.ruleNote)}</div>${button(state.rulesOpen?"收起规则与术语":"查看规则与术语","rules","persona-text-button",false,` aria-expanded="${state.rulesOpen}"`)}</div><div class="persona-answer-actions">${button("上一题","previous","persona-secondary",q.number===1)}${button(q.supplemental||q.number===28?"查看结果":"下一题","next","persona-primary",!q.selected)}</div>`;
    }
    if(state.rulesOpen)html+=`<div class="persona-rules">${state.terms.map(t=>`<section class="persona-rule"><h2 class="persona-section-title">${esc(t.title)}</h2><div>${esc(t.text)}</div></section>`).join("")}</div>`;
    const v=state.result;
    if(!state.loading&&v&&["result","shared"].includes(state.mode)){
      if(state.mode==="shared")html+=`<div class="persona-shared-by">${esc(state.shared.name)} 的牌桌风格</div>`;
      html+=`<section class="persona-result-hero"><span class="persona-eyebrow">${state.mode==="shared"?"TA":"你"}的阿瓦隆人格是</span><h1 class="persona-role-name" tabindex="-1">${esc(v.roleName)}</h1><div class="persona-role-english">${esc(v.english)}</div><div class="persona-portrait-stage"><div class="persona-orbit" aria-hidden="true"></div>${img(v.portrait,"persona-portrait",v.roleName+"角色形象")}</div><div class="persona-subtype">${esc(v.title)}</div><div class="persona-result-summary">${esc(v.summary)}</div><div class="persona-type-line"><span>${esc(v.typeId)}</span><span>${esc(v.tendencyLabel)}</span></div></section>`;
      if(state.mode==="result")html+=`<div class="persona-save-state" role="status">${state.saving?"正在保存到账号…":state.record?"已保存到账号 · 可随时回来查看":"结果已生成 · 等待账号同步"}</div>${message(state.saveError,"save","重试保存到账号")}<div class="persona-result-actions">${button(state.sharing?"正在准备…":"分享我的人格","share","persona-primary",state.sharing||state.saving)}${button(imageBusy?"正在生成…":"保存人格卡","image","persona-secondary",imageBusy)}</div>${message(state.shareError)}`;
      if(sharePanel)html+=`<div class="persona-share-panel"><h2 class="persona-section-title">人格卡已准备好</h2><div class="persona-small">分享人格摘要，详细答案仅自己可见。</div><input aria-label="人格分享链接" readonly value="${esc(shareUrl)}">${button("复制分享链接","copy","persona-primary")}</div>`;
      html+=section("01","你的介入方式",`<div class="persona-prose">${esc(v.description)}</div>`);
      html+=section("02","让这种风格发挥作用",`<div class="persona-insight"><span class="persona-insight-label">可能有帮助</span><div>${esc(v.strength)}</div></div><div class="persona-insight"><span class="persona-insight-label">留意它的代价</span><div>${esc(v.blindspot)}</div></div><div class="persona-tip"><span>下次可以试试</span><div>${esc(v.tip)}</div></div>`);
      if(state.mode==="result"){
        if(v.explanations?.length)html+=section("03","从你的选择中看见",v.explanations.map(e=>`<div class="persona-evidence"><span class="persona-evidence-source">${esc(e.questionId+" · "+e.title)}</span><div class="persona-quote">“${esc(e.text)}”</div><div class="persona-small">${esc(e.interpretation)}</div></div>`).join(""));
        html+=`<section class="persona-section"><button type="button" class="persona-disclosure" data-action="details" aria-expanded="${state.detailsOpen}"><span><span class="persona-section-title">本次相对偏好</span><span class="persona-small">七个决策维度与独立的介入风格</span></span><span>${state.detailsOpen?"收起":"展开"}</span></button>${state.detailsOpen?'<div class="persona-small persona-dimension-note">两端都是策略取向，没有高低优劣。</div>'+v.dimensions.map(dimension).join("")+dimension(v.style):""}</section>`;
        if(v.secondary?.length)html+=section("","也接近这些风格",`<div class="persona-small">${v.tendencyLabel==="混合倾向"?"你的选择呈现混合倾向，主角色只是本次最接近的方向。":"部分选择也与这些角色的策略取向接近。"}</div><div class="persona-secondary-roles">${v.secondary.map(r=>`<div>${img(r.portrait)}<span>${esc(r.name)}</span></div>`).join("")}</div>`);
      }
      html+=`<div class="persona-footnote">${esc(v.note)}</div>`;
      if(state.mode==="shared")html+=`<div class="persona-shared-action">${button("测测我的人格","mine","persona-primary")}<div class="persona-small persona-center">28 个独立情境 · 支持暂停续答</div></div>`;
      else html+=`<div class="persona-bottom-links">${button(state.catalogueOpen?"收起十六人格":"看看全部十六人格","catalogue","persona-text-button",false,` aria-expanded="${state.catalogueOpen}"`)}${button("重新测试","retest","persona-text-button",state.saving||state.sharing)}</div>`;
    }
    if(state.catalogueOpen)html+=`<div class="persona-catalogue">${state.catalogue.map(t=>`<div class="persona-catalogue-item">${img(t.portrait)}<div><span class="persona-small">${esc(t.roleName)}</span><div class="persona-section-title">${esc(t.title)}</div><div class="persona-small">${esc(t.description)}</div></div></div>`).join("")}</div>`;
    if(!state.loading&&!["quiz","shared"].includes(state.mode)&&state.history.length)html+=section("","最近的测试",state.history.map(h=>`<button class="persona-history-result" type="button" data-action="history" data-id="${h.id}"${state.saving||state.sharing?" disabled":""}>${img(h.portrait)}<span>${esc(h.roleName+" · "+h.title)}<span class="persona-small">${esc(h.dateLabel)}</span></span>›</button>`).join(""));
    root.innerHTML=html;
    if(scrollToTop){window.scrollTo(0,0);root.querySelector("h1")?.focus({preventScroll:true});}
    else if(focusAction){[...root.querySelectorAll("[data-action]")].find(e=>e.dataset.action===focusAction&&e.dataset.id===focusId)?.focus({preventScroll:true});}
    previous=state;
  }
  const session=window.shadowtablePersonalityFlow.create({storage,credential,login,request:fetchJSON,publicRequest:path=>fetchJSON(path,"GET",undefined,true),requestId:()=>"personality_"+crypto.randomUUID(),onChange:render});
  function announce(text){clearTimeout(announcementTimer);announcement.textContent=text;announcementTimer=setTimeout(()=>{announcement.textContent="";},4000);}
  async function imageDownload(){
    if(imageBusy||!ui.result)return;
    imageBusy=true;render(ui);const view=ui.result;
    try{
      const images=new Map(await Promise.all(poster.imagePaths({view}).map(path=>new Promise((resolve,reject)=>{const image=new Image(),timer=setTimeout(()=>{image.onload=image.onerror=null;reject(new Error("图片读取超时，请重试"));},5000);image.onload=()=>{clearTimeout(timer);resolve([path,image]);};image.onerror=()=>{clearTimeout(timer);reject(new Error("图片读取失败，请重试"));};image.src=path;}))));
      const canvas=document.createElement("canvas");Object.assign(canvas,poster.renderDimensions({view}));poster.drawCard(canvas.getContext("2d"),{view},null,images);
      const blob=await new Promise(r=>canvas.toBlob(r,"image/png"));if(!blob)throw new Error("图片生成失败");
      const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="阿瓦隆人格-"+view.title+".png";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);announce("人格卡已生成");
    }catch(error){announce(error.message);}
    finally{imageBusy=false;render(ui);}
  }
  const actions={retry:()=>session.load(options),start:()=>session.start(),answer:el=>session.answer(el.dataset.id),next:()=>session.next(),previous:()=>session.previous(),rules:()=>session.toggle("rulesOpen"),details:()=>session.toggle("detailsOpen"),catalogue:()=>session.toggle("catalogueOpen"),save:()=>session.save(),persist:()=>session.persist(),history:el=>session.openResult(el.dataset.id),
    retest:()=>document.getElementById("persona-retest").showModal(),
    mine:async()=>{options={};history.replaceState(null,"","/personality");await session.load();if(!ui.error)session.start();},
    share:async()=>{const snapshot=await session.share();if(!snapshot)return;sharePanel=true;shareUrl=location.origin+"/personality?share="+snapshot.id;render(ui);},
    copy:async()=>{try{await navigator.clipboard.writeText(shareUrl);announce("分享链接已复制");}catch{root.querySelector(".persona-share-panel input")?.select();announce("请复制已选中的分享链接");}},
    image:imageDownload,
  };
  root.addEventListener("click",event=>{const el=event.target.closest("[data-action]");if(el&&!el.disabled)Promise.resolve(actions[el.dataset.action]?.(el)).catch(error=>announce(error.message));});
  root.addEventListener("keydown",event=>{const el=event.target.closest('[role="radio"]');if(!el||!["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const options=[...root.querySelectorAll('[role="radio"]')],i=options.indexOf(el),direction=["ArrowRight","ArrowDown"].includes(event.key)?1:-1;const next=options[(i+direction+options.length)%options.length];session.answer(next.dataset.id);root.querySelector('[data-action="answer"][data-id="'+next.dataset.id+'"]')?.focus();});
  document.getElementById("persona-retest").addEventListener("close",event=>{if(event.target.returnValue==="confirm")session.start(true);});
  window.addEventListener("storage",event=>{if(["accountRevision","session","webAccount"].includes(event.key)&&!options.share)location.reload();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&ui.mode==="quiz")session.persist();});
  window.addEventListener("pagehide",()=>{session.dispose();clearTimeout(announcementTimer);});
  window.addEventListener("pageshow",event=>{if(event.persisted)location.reload();});
  session.load(options);
})();
