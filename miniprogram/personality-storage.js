(function(root,factory) {
  if(typeof module === "object" && module.exports) module.exports=factory();
  else root.shadowtablePersonalityStorage=factory();
})(typeof window === "object" ? window : this,function() {
  "use strict";
  const prefix="avalon16:";
  const validAccount=key=>typeof key === "string" && /^[a-f0-9]{64}$/.test(key);
  function create(storage) {
    const read=key=>{try{return storage.get(prefix+key)||null;}catch{return null;}};
    const write=(key,value)=>{storage.set(prefix+key,value);};
    function account(credential) {const binding=read("binding");return credential && binding?.credential===credential && validAccount(binding.accountKey) ? read("account:"+binding.accountKey) : null;}
    function bind(credential,value) {if(!credential || !validAccount(value.accountKey)) throw new Error("账号尚未确认");write("account:"+value.accountKey,value);write("binding",{credential,accountKey:value.accountKey});}
    function draft(key,version) {return validAccount(key) ? read("draft:"+key+":"+version) : null;}
    function saveDraft(key,value) {if(!validAccount(key))throw new Error("账号尚未确认");write("draft:"+key+":"+value.version,value);write("draft-version:"+key,value.version);}
    function removeDraft(key,version) {storage.remove(prefix+"draft:"+key+":"+version);if(read("draft-version:"+key)===version)storage.remove(prefix+"draft-version:"+key);}
    function summary(credential) {
      const empty = { title:"我的阿瓦隆人格", entryLabel:"开始测试", caption:"探索你的牌桌决策风格", portrait:"/assets/roles/merlin.png" };
      const value = account(credential);
      if (!value) return empty;
      const version = read("draft-version:" + value.accountKey);
      const saved = draft(value.accountKey, version);
      const answered = Object.keys(saved?.answers || {}).length;
      if (saved?.total && !saved.completed && answered) return {
        title:"继续探索你的牌桌风格",
        entryLabel:"继续测试",
        caption:"已完成 " + answered + " / " + saved.total + " 题 · 进度已保存",
        portrait:empty.portrait,
      };
      const result = saved?.completed && saved.localView || value.latest?.view;
      if (!result) return empty;
      return {
        title:result.roleName + " · " + result.title,
        entryLabel:result.title,
        caption:saved?.completed ? "查看结果 · 待同步到账号" : "我的阿瓦隆人格 · 查看结果",
        portrait:result.portrait,
      };
    }
    return {account,bind,draft,saveDraft,removeDraft,summary,previousVersion:key=>read("draft-version:"+key)};
  }
  return {create};
});
