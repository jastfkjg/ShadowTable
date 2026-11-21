/* Native and web use the same question, scoring, persistence and flow modules. */
(()=>{
  "use strict";
  const poster=window.shadowtablePersonalityPoster;
  const root=document.getElementById("personality"),announcement=document.getElementById("persona-announcement");
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const safeGet=key=>{try{return localStorage.getItem(key)||"";}catch{return "";}};
  const storage={get:key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},set:(key,value)=>localStorage.setItem(key,JSON.stringify(value)),remove:key=>localStorage.removeItem(key)};
  let webTag="",initializing=null,retryAt=0,ui=null,previous=null,options=Object.fromEntries(new URLSearchParams(location.search)),imageBusy=false,imageError="",pageAlive=true,announcementTimer;
  let manualShareId="";
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
  const button=(label,action,classes="persona-text-button",disabled=false,extra="",icon="")=>`<button type="button" class="${classes}" data-action="${action}"${disabled?" disabled":""}${extra}>${icon?img(icon,"persona-action-icon"):""}${esc(label)}</button>`;
  const img=(src,classes="",alt="")=>`<img src="${esc(src)}" class="${classes}" alt="${esc(alt)}">`;
  const message=(text,action,label)=>text?`<div class="persona-message persona-error" role="alert">${esc(text)}${action?button(label,action):""}</div>`:"";
  function insight(label, text) {
    return `<div class="persona-insight"><span class="persona-insight-label">${label}</span><div>${esc(text)}</div></div>`;
  }
  function resultPanel(state) {
    const v=state.result;
    if(state.resultTab==="preferences"){
      return state.preferences.map(d=>`<div class="persona-dimension">
        <div class="persona-dimension-heading">${esc(d.label)}</div>
        <div class="persona-axis-labels"><span>${esc(d.negative)}</span><span>${esc(d.positive)}</span></div>
        <div class="persona-axis ${esc(d.positionClass)}" role="img" aria-label="${esc(d.label+" "+d.tendency)}"><div class="persona-axis-center"></div><div class="persona-axis-dot"></div></div>
      </div>`).join("");
    }
    if(state.resultTab==="evidence"){
      const evidence=v.explanations?.map(e=>`<div class="persona-evidence">
        <span class="persona-evidence-source">${esc(e.title)}</span>
        <blockquote class="persona-quote">“${esc(e.text)}”</blockquote><div class="persona-small">${esc(e.interpretation)}</div>
      </div>`).join("");
      return `<h2 class="persona-report-title">哪些选择影响了结果</h2>
        ${evidence?`<div class="persona-evidence-list">${evidence}</div>`:'<div class="persona-small">你的选择比较均衡，这次没有特别突出的单题依据。</div>'}`;
    }
    const related=state.mode==="result" && v.secondary?.length?`<div class="persona-related">
      <h2 class="persona-section-title">也接近这些风格</h2>
      <div class="persona-small">${v.tendencyLabel==="混合倾向"?"你的选择呈现混合倾向，主角色是本次最接近的方向。":"部分选择也与这些角色的策略取向接近。"}</div>
      <div class="persona-secondary-roles">${v.secondary.map(r=>`<div>${img(r.portrait)}<span>${esc(r.name)}</span></div>`).join("")}</div>
    </div>`:"";
    return `<h2 class="persona-report-title">${state.mode==="shared"?"TA 的牌桌风格":"你的牌桌风格"}</h2><div class="persona-prose">${esc(v.summary)}</div>
      <div class="persona-insights">${insight(state.mode==="shared"?"TA 的长处":"你的长处",v.strength)}${insight("容易错过",v.blindspot)}</div>
      <div class="persona-tip"><span class="persona-tip-label">${state.mode==="shared"?"给 TA 的建议":"下次试试"}</span><div>${esc(v.tip)}</div></div>${related}`;
  }

  function sceneBrief(q) {
    if (!q.scene) return q.ruleset
      ? `<div class="persona-context"><span>${esc(q.ruleset)}</span><span>本题你是 · ${esc(q.selfRole)}</span></div>` : "";
    const facts=q.scene.facts.map(row => `<div class="persona-scene-fact"><span class="persona-fact-label">${esc(row.label)}</span><span>${esc(row.text)}</span></div>`).join("");
    return `<section class="persona-scene" aria-labelledby="scene-title">
      <div class="persona-scene-head"><div class="persona-scene-copy">
        <span class="persona-scene-stage">${esc(q.stageLabel)}</span>
        <h2 id="scene-title" class="persona-scene-title" tabindex="-1">${esc(q.scene.title)}</h2>
        <div class="persona-scene-role">${esc(q.ruleset)} · 你是${esc(q.scene.role)}</div>
      </div>${img(q.scenePortrait,"persona-scene-art")}</div>
      ${q.scene.context?`<div class="persona-scene-context">${esc(q.scene.context)}</div>`:""}${facts}</section>`;
  }

  const guideDialog=document.getElementById("persona-guide");
  function syncGuide(state) {
    if(!state.rulesOpen){
      if(guideDialog.open){
        guideDialog.close();
        root.querySelector('[data-action="rules"]')?.focus({preventScroll:true});
      }
      return;
    }
    const tabs=guideDialog.querySelector(".persona-guide-tabs");
    if(!tabs.children.length){
      tabs.innerHTML=state.guideTabs.map(t=>`<button type="button" class="persona-guide-tab" data-topic="${esc(t.id)}">${esc(t.label)}</button>`).join("");
    }
    if(!guideDialog.open || previous?.guide!==state.guide){
      const guide=state.guide;
      for(const item of tabs.children){
        const active=item.dataset.topic===guide.id;
        item.classList.toggle("is-current",active);
        item.setAttribute("aria-pressed",String(active));
      }
      guideDialog.querySelector(".persona-guide-source").textContent=state.mode==="quiz"?"当前题目 · "+state.question.title:"阿瓦隆十六人格";
      const title=guide.title?`<div class="persona-guide-board">${esc(guide.title)}</div>`:"";
      const rows=guide.rows.map(row=>`<div class="persona-guide-row"><span class="persona-guide-term">${esc(row.label)}</span><span class="persona-guide-definition">${esc(row.text)}</span></div>`).join("");
      const note=guide.id==="terms"?'<div class="persona-guide-note">每题都是独立局面。按你平时会做的事选，结果只描述这次的打法。</div>':"";
      guideDialog.querySelector(".persona-guide-content").innerHTML=title+rows+note;
      guideDialog.querySelector(".persona-guide-scroll").scrollTop=0;
    }
    if(!guideDialog.open)guideDialog.showModal();
  }
  function questionPage(state) {
    const q=state.question,short=!q.scene && !q.supplemental;
    const reference=`<button type="button" class="persona-guide-trigger" data-action="rules" aria-haspopup="dialog">${img("/assets/sheet-book.svg","persona-book-icon")}<span>规则与术语</span></button>`;
    const options=q.options.map(o=>`<button type="button" data-action="answer" data-id="${esc(o.id)}" role="radio" aria-checked="${o.selected}" class="persona-option${o.selected?" is-selected":""}">
      <span class="persona-option-mark" aria-hidden="true">${esc(o.label)}</span><span class="persona-option-copy">${esc(o.text)}</span><span class="persona-option-radio" aria-hidden="true">${o.selected?"✓":""}</span></button>`).join("");
    return `<div class="persona-progress-meta">
      <div class="persona-progress-count" aria-label="${q.supplemental?"补充选择":"第 "+q.number+" 题，共 "+state.questionTotal+" 题"}"><span class="persona-current-number">${q.supplemental?"补题":q.numberLabel}</span>${q.supplemental?"":`<span class="persona-total-number">/ ${state.questionTotal}</span>`}</div>
      <span class="persona-save-status">${state.storageError?"进度待保存":"进度自动保存"}</span>${reference}</div>
      <div class="persona-progress ${q.progressClass}" aria-hidden="true"><div class="persona-progress-fill"></div></div>
      <div class="persona-question${q.scene?" persona-scene-question":""}">${sceneBrief(q)}
        ${q.supplemental?'<div class="persona-small">两种倾向很接近，再选一个更像你的做法。</div>':""}
        <div class="persona-question-head${short?" persona-short-head":""}"><div class="persona-question-copy">
          ${q.situation?`<div class="persona-situation" id="persona-situation">${esc(q.situation)}</div>`:""}
          <h1 class="persona-prompt" tabindex="-1" id="persona-prompt"${q.situation?' aria-describedby="persona-situation"':""}>${esc(q.ask)}</h1></div>
          ${short?`<div class="persona-deck" aria-hidden="true">${img("/assets/identity-card-back.webp")}</div>`:""}</div>
        <div class="persona-options" role="radiogroup" aria-labelledby="persona-prompt">${options}</div>
        ${q.ruleNote?`<div class="persona-rule-note">${esc(q.ruleNote)}</div>`:""}</div>
      <div class="persona-answer-actions">${button("上一题","previous","persona-secondary",q.number===1)}${button(q.supplemental||q.last?"查看结果":"下一题","next","persona-primary",!q.selected)}</div>`;
  }

  function resultPage(state) {
    const v=state.result;
    const shared=state.mode==="shared";
    const report=resultPanel(state);
    const personal=!shared && state.momentRows.length;
    const mixed=personal && v.tendencyLabel==="混合倾向" && v.secondary?.length;
    const moments=personal ? `<section class="persona-moments" aria-labelledby="persona-moments-title">
      <h2 id="persona-moments-title" class="persona-moments-title">为什么像你</h2>
      <div class="persona-moment-list">${state.momentRows.map(item=>`<div class="persona-moment"><div class="persona-moment-heading">${esc(item.heading)}</div><div class="persona-moment-copy">${item.phrases.map(phrase=>`<span class="persona-moment-phrase">${esc(phrase)}</span>`).join("")}</div></div>`).join("")}</div>
      ${mixed?`<div class="persona-mixed-note">这次也接近${esc(v.secondary[0].name)}的打法</div>`:""}</section>` : "";
    const hero=`<section class="persona-result-hero">
      <span class="persona-eyebrow">阿瓦隆十六人格</span>
      <div class="persona-portrait-stage"><div class="persona-orbit" aria-hidden="true"></div>${img(v.portrait,"persona-portrait",v.roleName+"角色形象")}</div>
      <div class="persona-role-line"><span>${esc(v.roleName)}</span><span class="persona-role-english">${esc(v.english)}</span></div>
      <h1 class="persona-subtype" tabindex="-1">${esc(v.title)}</h1>
      <div class="persona-result-summary">${esc(v.styleNote||v.description||v.summary)}</div>
    </section>`;
    if(shared){
      return `<div class="persona-shared-by">${esc(state.shared.name)} 的牌桌风格</div>${hero}
        <section class="persona-result-panel">${report}</section>
        <div class="persona-shared-action">${button("测测我的人格","mine","persona-primary")}<div class="persona-small persona-center">${state.questionTotal} 道题 · 支持暂停续答</div></div>`;
    }
    const retry=state.saveError&&!state.saving;
    const tabs=state.tabs.map(tab=>{
      const active=tab.id===state.resultTab;
      return button(tab.label,"resultTab","persona-result-tab"+(active?" is-active":""),false,
        ` data-id="${tab.id}" id="persona-tab-${tab.id}" role="tab" aria-selected="${active}" aria-controls="persona-panel-${tab.id}" tabindex="${active?0:-1}"`);
    }).join("");
    const manualShare=state.shared?.id===manualShareId;
    return `${hero}<div class="persona-result-tools${personal?" has-moments":""}">${moments}
      <div class="persona-result-actions">
        ${button(imageBusy?"正在准备图片…":"保存图片","image","persona-primary",imageBusy,"",imageBusy?"":"/assets/share-save-dark.svg")}
        ${button(state.sharing?"正在准备…":manualShare?"复制分享链接":"分享结果","share","persona-secondary",state.sharing,"",state.sharing?"":manualShare?"/assets/sheet-copy.svg":"/assets/share.svg")}
      </div>
    </div>
    ${retry?`<div class="persona-sync-error" role="alert">${img("/assets/record-info.svg","persona-sync-icon")}<span>${esc(state.saveError)}</span>${button("重试同步","save")}</div>`:""}
    ${message(imageError)}${message(state.shareError)}
    ${manualShare?`<input class="persona-share-link" aria-label="人格分享链接" readonly value="${esc(shareLink(state.shared))}">`:""}
    <div class="persona-result-tabs" role="tablist" aria-label="人格报告">${tabs}</div>
    <section class="persona-result-panel" id="persona-panel-${state.resultTab}" role="tabpanel" aria-labelledby="persona-tab-${state.resultTab}" tabindex="0">${report}</section>
    <div class="persona-result-dock">
      <button type="button" class="persona-dock-catalogue" data-action="catalogue" aria-controls="persona-catalogue" aria-expanded="${state.catalogueOpen}">
        <span>${state.catalogueOpen?"收起十六人格":"看看全部十六人格"}</span>${img("/assets/chevron-left.svg","persona-dock-chevron"+(state.catalogueOpen?" is-expanded":""))}
      </button>
      <button type="button" class="persona-dock-retest" data-action="retest"${state.saving||state.sharing?" disabled":""}>
        ${img("/assets/home-refresh.svg","persona-dock-refresh")}<span>重新测试</span>
      </button>
    </div>`;
  }
  const shareLink=shared=>location.origin+"/personality?share="+shared.id;
  function render(state) {
    ui=state;
    const scrollToTop=previous&&(state.mode!==previous.mode||state.question?.id!==previous.question?.id);
    if(poster.imageKey(state.result)!==poster.imageKey(previous?.result))imageError="";
    const focused=document.activeElement?.dataset,focusAction=focused?.action,focusId=focused?.id;
    root.className="persona-page"+(state.mode==="quiz"?" persona-answering":!state.loading&&state.result&&state.mode==="result"?" persona-has-result-dock":"");
    let html=state.loading?'<p class="persona-status" role="status">正在读例牌桌故事…</p>':"";
    html+=message(state.error,"retry","重新载入")+(state.notice?`<div class="persona-message" role="status">${esc(state.notice)}</div>`:"")+message(state.storageError,state.mode==="quiz"?"persist":null,"重试保存进度");
    if(!state.loading&&state.mode==="intro"){
      html+=`<section class="persona-intro"><span class="persona-eyebrow">AVALON · 16 PERSONALITIES</span><h1 class="persona-intro-title" tabindex="-1">你是哪一种<span>阿瓦隆人格？</span></h1><div class="persona-intro-art" aria-hidden="true">${img("/assets/roles/assassin.png","persona-intro-side persona-intro-left")}${img("/assets/roles/merlin.png","persona-intro-main")}${img("/assets/roles/percival.png","persona-intro-side persona-intro-right")}</div><div class="persona-intro-copy">从看人、站边到藏身份，<span>发现你习惯的牌桌决策方式。</span></div><div class="persona-facts"><div><span>${state.questionTotal}</span>道题</div><div><span>16</span>种风格</div><div><span>随时</span>暂停续答</div></div>${button(state.hasDraft?"继续答题 · "+state.completedCount+"/"+state.questionTotal:"开始探索","start","persona-primary",!!state.error)}<div class="persona-small persona-center">10 道短题，5 个独立牌局。选你平时会做的事。</div></section>`;
      if(state.upgradedDraft)html+='<div class="persona-message">已带入旧版选择，可以从上次的进度继续。</div>';
      if(state.oldDraft)html+='<div class="persona-message">发现旧版未完成进度，已保留。当前题库已更新，请开始一次新测试。</div>';
      if(["guest","dev"].includes(state.identityType))html+='<div class="persona-small persona-account-note">当前为游客或开发账号，清除登录信息后无法自动找回结果。<a href="/#/me">前往我的</a></div>';
      html+=`<button type="button" class="persona-disclosure" data-action="rules" aria-haspopup="dialog"><span>规则与术语</span>${img("/assets/sheet-book.svg","persona-book-icon")}</button>`;
      if(state.hasDraft)html+=button("重新开始","retest");
    }
    if(!state.loading&&state.mode==="quiz"&&state.question)html+=questionPage(state);
    if(!state.loading&&state.result&&["result","shared"].includes(state.mode))html+=resultPage(state);
    if(state.catalogueOpen)html+=`<div class="persona-catalogue" id="persona-catalogue" tabindex="-1" role="region" aria-label="全部十六人格">${state.catalogue.map(t=>`<div class="persona-catalogue-item">${img(t.portrait)}<div><span class="persona-small">${esc(t.roleName)}</span><div class="persona-section-title">${esc(t.title)}</div><div class="persona-small">${esc(t.description)}</div></div></div>`).join("")}</div>`;
    if(!state.loading&&!["quiz","shared"].includes(state.mode)&&state.history.length)html+=`<section class="persona-section${state.mode==="result"?" persona-result-history":""}"><h2 class="persona-section-title">最近的测试</h2>${state.history.map(h=>`<button class="persona-history-result" type="button" data-action="history" data-id="${h.id}"${state.saving||state.sharing?" disabled":""}>${img(h.portrait)}<span>${esc(h.roleName+" · "+h.title)}<span class="persona-small">${esc(h.dateLabel)}</span></span><span aria-hidden="true">›</span></button>`).join("")}</section>`;
    root.innerHTML=html;
    if(scrollToTop){window.scrollTo(0,0);(root.querySelector("#scene-title") || root.querySelector("h1"))?.focus({preventScroll:true});}
    else if(focusAction){[...root.querySelectorAll("[data-action]")].find(e=>e.dataset.action===focusAction&&e.dataset.id===focusId)?.focus({preventScroll:true});}
    syncGuide(state);
    previous=state;
  }
  const session=window.shadowtablePersonalityFlow.create({storage,credential,login,request:fetchJSON,publicRequest:path=>fetchJSON(path,"GET",undefined,true),requestId:()=>"personality_"+crypto.randomUUID(),onChange:render});
  function announce(text){clearTimeout(announcementTimer);announcement.textContent=text;announcementTimer=setTimeout(()=>{announcement.textContent="";},4000);}
  async function copyShareLink(pendingShare,currentLink){
    const clipboard=navigator.clipboard;
    if(!clipboard)return false;
    if(clipboard.write&&typeof ClipboardItem==="function"){
      // Start the write in the click handler, then resolve the clipboard item with the URL.
      const content=pendingShare.then(shared=>{
        const link=currentLink(shared);
        if(!link)throw new Error("分享链接尚未生成");
        return new Blob([link],{type:"text/plain"});
      });
      content.catch(()=>{});
      try{
        await clipboard.write([new ClipboardItem({"text/plain":content})]);
        return true;
      }catch{}
    }
    const link=currentLink(await pendingShare);
    if(!link||!clipboard.writeText)return false;
    try{await clipboard.writeText(link);return true;}
    catch{return false;}
  }
  async function shareResult(){
    const pendingShare=session.share();
    const currentLink=shared=>shared&&pageAlive&&ui.mode==="result"&&ui.shared?.id===shared.id?shareLink(shared):"";
    const copied=await copyShareLink(pendingShare,currentLink);
    const shared=await pendingShare;
    if(!currentLink(shared))return;
    const fallback=copied?"":shared.id;
    if(fallback!==manualShareId){manualShareId=fallback;render(ui);}
    if(copied)announce("分享链接已复制");
    else{
      const input=root.querySelector(".persona-share-link");
      input.focus();
      input.select();
      announce("请复制已选中的分享链接");
    }
  }
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
  const actions={retry:()=>session.load(options),start:()=>session.start(),answer:el=>session.answer(el.dataset.id),next:()=>session.next(),previous:()=>session.previous(),rules:()=>session.openGuide(),save:()=>session.save(),persist:()=>session.persist(),history:el=>session.openResult(el.dataset.id),
    catalogue:()=>{
      session.toggleCatalogue();
      const catalogue=root.querySelector("#persona-catalogue");
      if(catalogue){
        catalogue.focus({preventScroll:true});
        catalogue.scrollIntoView();
      }
    },
    retest:()=>{
      const dialog=document.getElementById("persona-retest");
      dialog.returnValue="";
      dialog.showModal();
    },
    mine:async()=>{options={};history.replaceState(null,"","/personality");await session.load();if(!ui.error)session.start();},
    resultTab:el=>session.selectTab(el.dataset.id),
    share:shareResult,
    image:imageDownload,
  };
  guideDialog.addEventListener("click",event=>{
    const tab=event.target.closest("[data-topic]");
    if(tab)session.selectGuide(tab.dataset.topic);
    else if(event.target===guideDialog || event.target.closest(".persona-guide-close"))session.closeGuide();
  });
  guideDialog.addEventListener("cancel",event=>{event.preventDefault();session.closeGuide();});
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
