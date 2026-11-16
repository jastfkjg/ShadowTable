(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./quiz.json"));
  else root.shadowtablePersonalityPresentation = factory(root.shadowtablePersonalityQuiz);
})(typeof window === "object" ? window : this, function(quiz) {
  "use strict";
  const art = { loyal: "servant" };
  const roleNames = Object.fromEntries(quiz.roles.map(role => [role.id, role.name]));
  const names = { ...roleNames, lancelot_initial_good: "初始蓝兰", lancelot_initial_evil: "初始红兰", observer: "旁观者" };
  const english = { merlin:"MERLIN", percival:"PERCIVAL", loyal:"LOYAL SERVANT", morgana:"MORGANA", mordred:"MORDRED", assassin:"ASSASSIN", oberon:"OBERON", lancelot:"LANCELOT" };
  const ruleNames = { R9:"九人局", O7:"七人奥伯伦局", L9:"九人兰斯局" };
  const terms = [
    { title:"每题都是独立局面", text:"座位、身份和已知信息不跨题继承。任务记录可能只列出部分轮次，当前进度以题目文字为准。没有标准答案，选择你通常会采取的行动。" },
    { title:"单边派与任务记录", text:"单边派只是唯一宣称派西维尔的人，不是已经验明的好人。一张失败票只证明至少一人出了失败；成功任务也可能藏红。" },
    { title:"排水与挡刀", text:"排水指梅林呈现普通好人能够拥有的依据与不确定性，控制身份暴露，并不要求故意送任务。挡刀指通过身份表演、真实行为或保留多候选，为梅林分担嫌疑。" },
    { title:"红方已知信息", text:"本题库 R9 九人局额外约定：互认的红方知道彼此具体角色。O7、L9 不继承此约定。梅林不自动区分红方具体角色，也不自动识别派与忠；R9 的梅林看不到莫德雷德。" },
    { title:"第四任务", text:"本题库三种配置的第四任务都需要至少两张失败票才失败。好人必须出成功，红方可出成功或失败。" },
    { title:"测试专用兰斯规则", text:"L9 采用九人兰斯变体1：两兰不互认，初始红兰不睁眼但其他红方认识他。每个任务开始、组队前，从4张不变和2张转换中不放回抽牌并公开；转换时两兰同时换阵营，不换身份、不重开互认。当前蓝兰必须成功，当前红兰可成功或失败。请按本题规则作答。" },
    { title:"刺杀与合法行动", text:"刺杀题统一约定：落刀前可进行一次简短公开发言，此时不再出任务。只使用公开发言、组队、投票与合法任务牌，不翻牌证明或私聊串通。" },
    ...Object.values(quiz.rulesets).map(rule=>({title:rule.name,text:"蓝方："+rule.goodRoles.map(id=>names[id]).join("、")+"。红方："+rule.evilRoles.map(id=>names[id]).join("、")+"。五次任务人数依次为 "+rule.teamSizes.join(" / ")+"。派西维尔看到梅林与莫甘娜两名候选，但不能直接区分。"})),
  ];
  function portrait(roleId) { return "/assets/roles/" + (art[roleId] || roleId) + ".png"; }
  function question(id, selected) {
    const q = quiz.questions.find(row => row.id === id) || Object.values(quiz.tieBreakers).find(row => row.id === id);
    if (!q) return null;
    const index = quiz.questions.findIndex(row => row.id === id);
    return {
      id:q.id, title:q.title || "补充一个选择", prompt:q.prompt, situation:q.situation,
      number:index + 1, supplemental:index < 0, ruleset:ruleNames[q.rulesetId], selfRole:names[q.selfRole] || q.selfRole,
      progress:index < 0 ? 100 : Math.round((index + 1) / quiz.questions.length * 100),
      progressClass:"p" + (index < 0 ? 100 : Math.round((index + 1) / quiz.questions.length * 100)),
      ruleNote:q.rulesetId === "L9" ? "本组采用测试专用九人兰斯规则：当前红兰可成功或失败。" : q.rulesetId === "R9" ? "本题九人局约定：互认红方知道彼此具体角色。" : "本题第四任务需两张失败；奥伯伦与其他红方互不认识。",
      history:(q.history || []).map(row => ({ label:"任务 " + row.quest, team:row.team.join("、") + " 号", outcome:row.failCards + " 张失败" })),
      options:q.options.map((option,i) => ({ id:option.id, label:String.fromCharCode(65+i), text:option.text, selected:selected === option.id })),
      selected:selected || "",
    };
  }
  function result(value) {
    if (!value || value.status !== "complete" || value.version !== quiz.version) throw new Error("人格结果尚未完成或版本不受支持");
    const role = quiz.roles.find(row => row.id === value.roleId), subtype = role?.subtypes[value.subtype];
    if (!subtype) throw new Error("人格结果无效");
    const dimensions = quiz.dimensions.map(d => {
      const score = value.profile[d.id], position = Math.round(Math.max(0,Math.min(100,(score+1)*50)));
      return { id:d.id, label:d.label, negative:d.negative, positive:d.positive, position,
        positionClass:"p"+position, tendency:Math.abs(score) < .1 ? "两端接近" : score < 0 ? "偏向 · " + d.negative : "偏向 · " + d.positive };
    });
    return {
      version:value.version, typeId:value.typeId, roleId:role.id, roleName:role.name, english:english[role.id], title:subtype.title,
      portrait:portrait(role.id), summary:role.summary, description:subtype.description,
      strength:role.strength, blindspot:role.blindspot, tip:role.tip, tendencyLabel:value.tendencyLabel,
      dimensions:dimensions.filter(d => d.id !== "E"), style:dimensions.find(d => d.id === "E"),
      secondary:(value.secondaryRoleIds || []).map(id => ({ id, name:roleNames[id], portrait:portrait(id) })),
      explanations:(value.explanations || []).map(item => ({ questionId:item.questionId, optionId:item.optionId,
        title:quiz.questions.find(q => q.id === item.questionId)?.title || item.questionId, text:item.text, interpretation:item.interpretation })),
      note:"娱乐性对局风格探索，反映本次选择，不代表能力、胜率或固定人格。",
    };
  }
  function catalogue() { return quiz.roles.flatMap(role => Object.entries(role.subtypes).map(([id, subtype]) => ({ typeId:role.code+"-"+id, roleName:role.name, title:subtype.title, portrait:portrait(role.id), description:subtype.description }))); }
  function date(at) { const d = new Date(at + 8*3600000); return d.toISOString().slice(0,10).replace(/-/g,"."); }
  return { question, result, catalogue, terms, portrait, date, version:quiz.version, total:quiz.questions.length };
});
