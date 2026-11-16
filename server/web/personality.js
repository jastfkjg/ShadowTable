/* Native and web use the same question, scoring, persistence and flow modules. */
(()=>{
  "use strict";
  const poster=window.shadowtablePersonalityPoster;
  const root=document.getElementById("personality"),announcement=document.getElementById("persona-announcement");
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const safeGet=key=>{try{return localStorage.getItem(key)||"";}catch{return "";}};
  const storage={get:key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},set:(key,value)=>localStorage.setItem(key,JSON.stringify(value)),remove:key=>localStorage.removeItem(key)};
  let webTag="",initializing=null,retryAt=0,ui=null,previous=null,options=Object.fromEntries(new URLSearchParams(location.search)),imageBusy=false,imageError="",pageAlive=true,announcementTimer;
  const revision=safeGet("accountRevision");
  try{const saved=JSON.parse(sessionStorage.getItem("avalon16-web"));if(saved?.revision===revision&&safeGet("webAccount")==="wechat")webTag=saved.tag;}catch{}
  const credential=()=>safeGet("accountRevision")!==revision?"account-changed":webTag||safeGet("session");
  async function fetchJSON(path,method="GET",data,publicRead=false) {
    if(Date.now()<retryAt)throw Object.assign(new Error("请求冷却中，请稍后重试"),{status:429});
    const captured=credential(),headers={"Content-Type":"application/json"};
    if(!publicRead){if(webTag)headers["X-Web-Session"]=webTag;else if(safeGet("session"))headers.Authorization="Bearer "+safeGet("session");}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(path,{method,headers,credentials:publicRead?"omit":"same-origin",signal:controller.signal,...(data===undefined?{}:{body:JSON.stringify(data)})});
      if(!publicRead&&captured!==credential())throw Object.assign(new Error("账号已变化，请重新载入"),{status:409});
      if(!response.ok){
        if(response.status===429)retryAt=Date.now()+Math.max(1,Number(response.headers.get("Retry-After"))||60)*1000;
        const error=await response.json().catch(()=>null);
        throw Object.assign(new Error(error?.error||"请求失败，请重试。"),{status:response.status});
      }
      return await response.json();
    }catch(error){
      if(error.status)throw error;
      if(error.name==="AbortError" || error instanceof TypeError){
        throw Object.assign(new Error("暂时无法连接服务，请检查网络后重试。"),{retryable:true});
      }
      throw new Error("暂时无法读取服务响应，请重试。");
    }
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
  function axis(d) {
    return `<div class="persona-axis-labels"><span>${esc(d.negative)}</span><span>${esc(d.positive)}</span></div>
      <div class="persona-axis ${d.positionClass}" role="img" aria-label="${esc(d.tendency)}"><div class="persona-axis-center"></div><div class="persona-axis-dot"></div></div>`;
  }
  function insight(label, text) {
    return `<div class="persona-insight"><span class="persona-insight-label">${label}</span><div>${esc(text)}</div></div>`;
  }
  function resultPanel(state) {
    const v=state.result;
    if(state.resultTab==="preferences"){
      const shown=state.detailsOpen?state.preferences:state.preferences.slice(0,3);
      const dimensions=shown.map(d=>`<div class="persona-dimension">
        <div class="persona-dimension-heading"><span>${esc(d.label)}</span><span>${esc(d.tendency)}</span></div>${axis(d)}
      </div>`).join("");
      const more=state.preferences.length>3?button(
        state.detailsOpen?"收起其他维度":"查看其余 "+(state.preferences.length-3)+" 项",
        "details","persona-text-button persona-more",false,` aria-expanded="${state.detailsOpen}"`
      ):"";
      return `<h2 class="persona-section-title">你在两种做法之间的位置</h2>
        <div class="persona-small">来自本次作答，两端各有用途。</div>${dimensions}${more}
        <div class="persona-style">
          <div class="persona-dimension-heading"><span>介入风格</span><span>${state.activeStyle==="A"?"主动介入":"择机介入"}</span></div>
          <div class="persona-small">${esc(v.description)}</div>
          ${v.style?axis({...v.style,negative:"择机介入",positive:"主动介入"}):""}
        </div>`;
    }
    if(state.resultTab==="evidence"){
      const evidence=v.explanations?.map(e=>`<div class="persona-evidence">
        <span class="persona-evidence-source">${esc(e.title)}</span>
        <div class="persona-quote">“${esc(e.text)}”</div><div class="persona-small">${esc(e.interpretation)}</div>
      </div>`).join("");
      return `<h2 class="persona-section-title">哪些选择影响了结果</h2>
        ${evidence||'<div class="persona-small">你的选择比较均衡，这次没有特别突出的单题依据。</div>'}`;
    }
    const related=state.mode==="result" && v.secondary?.length?`<div class="persona-related">
      <h2 class="persona-section-title">也接近这些风格</h2>
      <div class="persona-small">${v.tendencyLabel==="混合倾向"?"你的选择呈现混合倾向，主角色是本次最接近的方向。":"部分选择也与这些角色的策略取向接近。"}</div>
      <div class="persona-secondary-roles">${v.secondary.map(r=>`<div>${img(r.portrait)}<span>${esc(r.name)}</span></div>`).join("")}</div>
    </div>`:"";
    return `<h2 class="persona-section-title">你的牌桌风格</h2><div class="persona-prose">${esc(v.summary)}</div>
      ${insight("你的长处",v.strength)}${insight("容易错过",v.blindspot)}
      <div class="persona-tip"><span>下次试试</span><div>${esc(v.tip)}</div></div>${related}`;
  }

  function resultPage(state) {
    const v=state.result;
    const shared=state.mode==="shared";
    const hero=`<section class="persona-result-hero">
      <span class="persona-eyebrow">阿瓦隆十六人格</span>
      <div class="persona-portrait-stage"><div class="persona-orbit" aria-hidden="true"></div>${img(v.portrait,"persona-portrait",v.roleName+"角色形象")}</div>
      <div class="persona-role-line"><span>${esc(v.roleName)}</span><span class="persona-role-english">${esc(v.english)}</span></div>
      <h1 class="persona-subtype" tabindex="-1">${esc(v.title)}</h1>
      <div class="persona-result-summary">${esc(v.description||v.summary)}</div>
    </section>`;
    if(shared){
      return `<div class="persona-shared-by">${esc(state.shared.name)} 的牌桌风格</div>${hero}
        <section class="persona-result-panel">${resultPanel(state)}</section>
        <div class="persona-footnote">${esc(v.note)}</div>
        <div class="persona-shared-action">${button("测测我的人格","mine","persona-primary")}<div class="persona-small persona-center">${state.questionTotal} 道题 · 支持暂停续答</div></div>`;
    }
    const stateText=state.record?"✓ 已保存到账号":state.saving?"正在同步到账号…":state.storageError?"当前结果尚未同步":"结果已保存在本机";
    const retry=state.saveError&&!state.saving;
    const tabs=state.tabs.map(tab=>{
      const active=tab.id===state.resultTab;
      return button(tab.label,"resultTab","persona-result-tab"+(active?" is-active":""),false,
        ` data-id="${tab.id}" id="persona-tab-${tab.id}" role="tab" aria-selected="${active}" aria-controls="persona-panel-${tab.id}" tabindex="${active?0:-1}"`);
    }).join("");
    const sharePanel=state.shared?`<div class="persona-share-panel">
      <h2 class="persona-section-title">结果链接已准备好</h2><div class="persona-small">好友可以看到角色卡和风格解读。</div>
      <input aria-label="人格分享链接" readonly value="${esc(shareLink(state.shared))}">${button("复制分享链接","copy","persona-primary")}
    </div>`:"";
    return `${hero}<div class="persona-result-actions">
      ${button(imageBusy?"正在准备图片…":"保存图片","image","persona-primary",imageBusy)}
      ${button(state.sharing?"正在准备…":"分享结果","share","persona-secondary",state.sharing)}
    </div>
    <div class="persona-save-state ${state.record?"confirmed":""}" role="status"><span>${stateText}</span>${retry?button("重试同步","save"):""}</div>
    ${retry?`<div class="persona-small persona-action-note" role="alert">${esc(state.saveError)}</div>`:""}
    ${message(imageError)}${message(state.shareError)}${sharePanel}
    <div class="persona-result-tabs" role="tablist" aria-label="人格报告">${tabs}</div>
    <section class="persona-result-panel" id="persona-panel-${state.resultTab}" role="tabpanel" aria-labelledby="persona-tab-${state.resultTab}" tabindex="0">${resultPanel(state)}</section>
    <div class="persona-footnote">${esc(v.note)}</div>
    <div class="persona-bottom-links">
      ${button(state.catalogueOpen?"收起十六人格":"看看全部十六人格","catalogue","persona-text-button",false,` aria-expanded="${state.catalogueOpen}"`)}
      ${button("重新测试","retest","persona-text-button",state.saving||state.sharing)}
    </div>`;
  }
  const shareLink=shared=>location.origin+"/personality?share="+shared.id;
  function render(state) {
    ui=state;
    const scrollToTop=previous&&(state.mode!==previous.mode||state.question?.id!==previous.question?.id);
    if(poster.imageKey(state.result)!==poster.imageKey(previous?.result))imageError="";
    const focused=document.activeElement?.dataset,focusAction=focused?.action,focusId=focused?.id;
    root.className="persona-page"+(state.mode==="quiz"?" persona-answering":"");
    let html=state.loading?'<p class="persona-status" role="status">正在读取你的牌桌故事…</p>':"";
    html+=message(state.error,"retry","重新载入")+(state.notice?`<div class="persona-message" role="status">${esc(state.notice)}</div>`:"")+message(state.storageError,state.mode==="quiz"?"persist":null,"重试保存进度");
    if(!state.loading&&state.mode==="intro"){
      html+=`<section class="persona-intro"><span class="persona-eyebrow">AVALON · 16 PERSONALITIES</span><h1 class="persona-intro-title" tabindex="-1">你是哪一种<span>阿瓦隆人格？</span></h1><div class="persona-intro-art" aria-hidden="true">${img("/assets/roles/assassin.png","persona-intro-side persona-intro-left")}${img("/assets/roles/merlin.png","persona-intro-main")}${img("/assets/roles/percival.png","persona-intro-side persona-intro-right")}</div><div class="persona-intro-copy">从看人、站边到藏身份，<span>发现你习惯的牌桌决策方式。</span></div><div class="persona-facts"><div><span>${state.questionTotal}</span>道题</div><div><span>16</span>种风格</div><div><span>随时</span>暂停续答</div></div>${button(state.hasDraft?"继续答题 · "+state.completedCount+"/"+state.questionTotal:"开始探索","start","persona-primary",!!state.error)}<div class="persona-small persona-center">每题独立，按你通常会采取的行动选择</div></section>`;
      if(state.oldDraft)html+='<div class="persona-message">发现旧版未完成进度，已保留。当前题库已更新，请开始一次新测试。</div>';
      if(["guest","dev"].includes(state.identityType))html+='<div class="persona-small persona-account-note">当前为游客或开发账号，清除登录信息后无法自动找回结果。<a href="/#/me">前往我的</a></div>';
      html+=button(state.rulesOpen?"收起规则约定":"开始前，了解这些约定","rules","persona-disclosure",false,` aria-expanded="${state.rulesOpen}"`);
      if(state.hasDraft)html+=button("重新开始","retest");
    }
    if(!state.loading&&state.mode==="quiz"&&state.question){
      const q=state.question;
      html+=`<div class="persona-progress-meta"><span>${q.supplemental?"补充选择":"第 "+q.number+" / "+state.questionTotal+" 题"}</span><span>${state.storageError?"进度待保存":"进度自动保存"}</span></div><div class="persona-progress ${q.progressClass}" aria-hidden="true"><div class="persona-progress-fill"></div></div><div class="persona-question">${q.ruleset?`<div class="persona-context"><span>${esc(q.ruleset)}</span>${q.selfRole?`<span>本题你是 · ${esc(q.selfRole)}</span>`:""}</div>`:""}${q.supplemental?'<div class="persona-small">还差一个选择，帮助区分你的倾向。</div>':""}${q.situation?`<div class="persona-situation">${esc(q.situation)}</div>`:""}<h1 class="persona-prompt" tabindex="-1" id="persona-prompt">${esc(q.prompt)}</h1><div class="persona-options" role="radiogroup" aria-labelledby="persona-prompt">${q.options.map(o=>button("","answer","persona-option"+(o.selected?" is-selected":""),false,` data-id="${o.id}" role="radio" aria-checked="${o.selected}"`).replace('</button>',`<span class="persona-option-mark">${o.selected?"✓":o.label}</span><span class="persona-option-copy">${esc(o.text)}</span></button>`)).join("")}</div>${q.ruleNote?`<div class="persona-rule-note">${esc(q.ruleNote)}</div>`:""}${button(state.rulesOpen?"收起规则与术语":"查看规则与术语","rules","persona-text-button",false,` aria-expanded="${state.rulesOpen}"`)}</div><div class="persona-answer-actions">${button("上一题","previous","persona-secondary",q.number===1)}${button(q.supplemental||q.last?"查看结果":"下一题","next","persona-primary",!q.selected)}</div>`;
    }
    if(state.rulesOpen)html+=`<div class="persona-rules">${state.terms.map(t=>`<section class="persona-rule"><h2 class="persona-section-title">${esc(t.title)}</h2><div>${esc(t.text)}</div></section>`).join("")}</div>`;
    if(!state.loading&&state.result&&["result","shared"].includes(state.mode))html+=resultPage(state);
    if(state.catalogueOpen)html+=`<div class="persona-catalogue">${state.catalogue.map(t=>`<div class="persona-catalogue-item">${img(t.portrait)}<div><span class="persona-small">${esc(t.roleName)}</span><div class="persona-section-title">${esc(t.title)}</div><div class="persona-small">${esc(t.description)}</div></div></div>`).join("")}</div>`;
    if(!state.loading&&!["quiz","shared"].includes(state.mode)&&state.history.length)html+=`<section class="persona-section"><h2 class="persona-section-title">最近的测试</h2>${state.history.map(h=>`<button class="persona-history-result" type="button" data-action="history" data-id="${h.id}"${state.saving||state.sharing?" disabled":""}>${img(h.portrait)}<span>${esc(h.roleName+" · "+h.title)}<span class="persona-small">${esc(h.dateLabel)}</span></span>›</button>`).join("")}</section>`;
    root.innerHTML=html;
    if(scrollToTop){window.scrollTo(0,0);root.querySelector("h1")?.focus({preventScroll:true});}
    else if(focusAction){[...root.querySelectorAll("[data-action]")].find(e=>e.dataset.action===focusAction&&e.dataset.id===focusId)?.focus({preventScroll:true});}
    previous=state;
  }
  const session=window.shadowtablePersonalityFlow.create({storage,credential,login,request:fetchJSON,publicRequest:path=>fetchJSON(path,"GET",undefined,true),requestId:()=>"personality_"+crypto.randomUUID(),onChange:render});
  function announce(text){clearTimeout(announcementTimer);announcement.textContent=text;announcementTimer=setTimeout(()=>{announcement.textContent="";},4000);}
  async function imageDownload(){
    if(imageBusy||!ui.result)return;
    const view=ui.result, imageKey=poster.imageKey(view);
    const currentImage=()=>pageAlive&&poster.imageKey(ui.result)===imageKey;
    imageBusy=true;imageError="";render(ui);
    try{
      const images=new Map(await Promise.all(poster.imagePaths({view}).map(path=>new Promise(resolve=>{
        const image=new Image();
        function finish(value){
          clearTimeout(timer);
          image.onload=image.onerror=null;
          resolve([path,value]);
        }
        const timer=setTimeout(()=>finish(null),5000);
        image.onload=()=>finish(image);
        image.onerror=()=>finish(null);
        image.src=path;
      }))));
      const canvas=document.createElement("canvas");Object.assign(canvas,poster.renderDimensions({view}));poster.drawCard(canvas.getContext("2d"),{view},null,images);
      const blob=await new Promise(r=>canvas.toBlob(r,"image/png"));if(!blob)throw new Error("图片生成失败");
      if(!currentImage())return;
      const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="阿瓦隆人格-"+view.title+".png";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);announce("人格卡已生成");
    }catch(error){if(currentImage())imageError=error.message;}
    finally{imageBusy=false;if(pageAlive)render(ui);}
  }
  const actions={retry:()=>session.load(options),start:()=>session.start(),answer:el=>session.answer(el.dataset.id),next:()=>session.next(),previous:()=>session.previous(),rules:()=>session.toggle("rulesOpen"),details:()=>session.toggle("detailsOpen"),catalogue:()=>session.toggle("catalogueOpen"),save:()=>session.save(),persist:()=>session.persist(),history:el=>session.openResult(el.dataset.id),
    retest:()=>document.getElementById("persona-retest").showModal(),
    mine:async()=>{options={};history.replaceState(null,"","/personality");await session.load();if(!ui.error)session.start();},
    resultTab:el=>session.selectTab(el.dataset.id),
    share:async()=>{if(await session.share())root.querySelector(".persona-share-panel input")?.focus({preventScroll:true});},
    copy:async()=>{if(!ui.shared)return;try{await navigator.clipboard.writeText(shareLink(ui.shared));announce("分享链接已复制");}catch{root.querySelector(".persona-share-panel input")?.select();announce("请复制已选中的分享链接");}},
    image:imageDownload,
  };
  root.addEventListener("click",event=>{const el=event.target.closest("[data-action]");if(el&&!el.disabled)Promise.resolve(actions[el.dataset.action]?.(el)).catch(error=>announce(error.message));});
  root.addEventListener("keydown",event=>{
    const el=event.target.closest('[role="radio"],[role="tab"]');
    if(!el)return;
    const role=el.getAttribute("role"),isTab=role==="tab";
    const keys=isTab?["ArrowLeft","ArrowRight","Home","End"]:["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"];
    if(!keys.includes(event.key))return;
    event.preventDefault();
    const items=[...root.querySelectorAll(`[role="${role}"]`)], index=items.indexOf(el);
    const direction=["ArrowRight","ArrowDown"].includes(event.key)?1:-1;
    const nextIndex=event.key==="Home"?0:event.key==="End"?items.length-1:(index+direction+items.length)%items.length;
    const nextId=items[nextIndex].dataset.id;
    if(isTab)session.selectTab(nextId);else session.answer(nextId);
    root.querySelector(`[role="${role}"][data-id="${nextId}"]`)?.focus();
  });
  document.getElementById("persona-retest").addEventListener("close",event=>{if(event.target.returnValue==="confirm")session.start(true);});
  window.addEventListener("storage",event=>{if(["accountRevision","session","webAccount"].includes(event.key)&&!options.share)location.reload();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&ui.mode==="quiz")session.persist();});
  window.addEventListener("pagehide",()=>{pageAlive=false;session.dispose();clearTimeout(announcementTimer);});
  window.addEventListener("pageshow",event=>{if(event.persisted)location.reload();});
  session.load(options);
})();
