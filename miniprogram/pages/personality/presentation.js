(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./quiz-data"));
  else root.shadowtablePersonalityPresentation = factory(root.shadowtablePersonalityQuiz);
})(typeof window === "object" ? window : this, function(quiz) {
  "use strict";
  const art = { loyal: "servant" };
  const roleNames = Object.fromEntries(quiz.roles.map(role => [role.id, role.name]));
  const names = { ...roleNames, lancelot_initial_good: "初始蓝兰", lancelot_initial_evil: "初始红兰", observer: "旁观者" };
  const english = { merlin:"MERLIN", percival:"PERCIVAL", loyal:"LOYAL SERVANT", morgana:"MORGANA", mordred:"MORDRED", assassin:"ASSASSIN", oberon:"OBERON", lancelot:"LANCELOT" };
  function lineup(roles) {
    return [...new Set(roles)].map(id => {
      const count=roles.filter(role=>role===id).length;
      return names[id]+(count>1 ? " × "+count : "");
    }).join("、");
  }
  const guideTopics = [
    { id:"terms", label:"常用术语", rows:[
      {label:"失败票", text:"任务中的破坏牌。翻出一张，说明上车的人里至少有一名红方。"},
      {label:"上车", text:"被选进本轮执行任务的队伍。"},
      {label:"成功车", text:"完成了任务的队伍。车上仍可能有红方。"},
      {label:"票型", text:"组队表决时，谁赞成这份名单、谁反对。"},
      {label:"挡刀", text:"替别人分担被刺客认作梅林的风险。"},
      {label:"排水", text:"让自己的发言符合普通好人的视角，减少知情身份留下的痕迹。"},
    ] },
    ...Object.entries(quiz.rulesets).map(([id,rule])=>({
      id, label:rule.players+" 人局", title:rule.name,
      rows:[
        ...rule.specialRules.map((text,i)=>({label:(id==="C10"?["奥伯伦","梅林","刺杀"]:["换边","出牌"])[i],text})),
        {label:"任务人数",text:"五轮依次为 "+rule.teamSizes.join("、")+" 人。第四轮至少 "+rule.failThresholds[3]+" 张失败票才会失败。"},
        {label:"蓝方角色",text:lineup(rule.goodRoles)},
        {label:"红方角色",text:lineup(rule.evilRoles)},
      ],
    })),
  ];
  function portrait(roleId) { return "/assets/roles/" + (art[roleId] || roleId) + ".png"; }
  const scenes = quiz.questions.filter(q => q.scene);
  function question(id, selected) {
    const q = quiz.questions.find(row => row.id === id) || Object.values(quiz.tieBreakers).find(row => row.id === id);
    if (!q) return null;
    const index = quiz.questions.findIndex(row => row.id === id);
    const split = q.kind === "short" && !q.situation ? q.prompt.lastIndexOf("。")+1 : 0;
    return {
      id:q.id, title:q.title || "补充一个选择", prompt:q.prompt, situation:q.situation || q.prompt.slice(0,split),
      ask:q.prompt.slice(split), rulesetId:q.rulesetId, numberLabel:String(index+1).padStart(2,"0"),
      scene:q.scene, scenePortrait:q.scene && portrait(q.selfRole === "lancelot_initial_good" ? "lancelot" : q.selfRole),
      stageLabel:q.scene ? "牌局情景 · " + (scenes.indexOf(q) + 1) + " / " + scenes.length : "",
      number:index + 1, supplemental:index < 0, last:index === quiz.questions.length - 1,
      ruleset:quiz.rulesets[q.rulesetId]?.name, selfRole:names[q.selfRole] || q.selfRole,
      progress:index < 0 ? 100 : Math.round((index + 1) / quiz.questions.length * 100),
      progressClass:"p" + (index < 0 ? 100 : Math.round((index + 1) / quiz.questions.length * 100)),
      ruleNote:q.ruleNote || "",
      options:q.options.map((option,i) => ({ id:option.id, label:String.fromCharCode(65+i), text:option.text, selected:selected === option.id })),
      selected:selected || "",
    };
  }
  function result(value, config = quiz) {
    if (!value || value.status !== "complete" || value.version !== config.version) throw new Error("人格结果尚未完成或版本不受支持");
    const role = config.roles.find(row => row.id === value.roleId), subtype = role?.subtypes[value.subtype];
    if (!subtype) throw new Error("人格结果无效");
    const dimensions = config.dimensions.map(d => {
      const score = value.profile[d.id], position = Math.round(Math.max(0,Math.min(100,(score+1)*50)));
      return { id:d.id, label:d.label, negative:d.negative, positive:d.positive, position,
        positionClass:"p"+position, tendency:Math.abs(score) < .1 ? "两端接近" : score < 0 ? "偏向 · " + d.negative : "偏向 · " + d.positive };
    });
    const moments = value.moments && [
      { heading:"角色线索 · " + role.name, evidence:value.moments.role },
      { heading:value.subtype === "A" ? "介入方式 · 主动介入" : "介入方式 · 择机介入", evidence:value.moments.style },
    ].filter(row => row.evidence).map(({heading,evidence}) => ({heading,...evidence}));
    const explanations=(value.explanations || []).map(item => ({ questionId:item.questionId, optionId:item.optionId,
      title:config.questions.find(q => q.id === item.questionId)?.title || item.questionId, text:item.text, interpretation:item.interpretation }));
    // Keep the original option behind each of the two short first-person summaries.
    const details=moments ? [...moments, ...explanations].filter((item,index,rows) =>
      rows.findIndex(row=>row.questionId === item.questionId) === index).slice(0,3) : explanations;
    return {
      version:value.version, typeId:value.typeId, roleId:role.id, roleName:role.name, english:english[role.id], title:subtype.title,
      portrait:portrait(role.id), summary:role.summary, description:subtype.description,
      ...(moments ? { moments } : {}),
      strength:role.strength, blindspot:role.blindspot, tip:role.tip, tendencyLabel:value.tendencyLabel,
      dimensions:dimensions.filter(d => d.id !== "E"), style:dimensions.find(d => d.id === "E"),
      secondary:(value.secondaryRoleIds || []).map(id => ({ id, name:roleNames[id], portrait:portrait(id) })),
      explanations:details,
      note:"娱乐性对局风格探索，反映本次选择，不代表能力、胜率或固定人格。",
    };
  }
  function catalogue() { return quiz.roles.flatMap(role => Object.entries(role.subtypes).map(([id, subtype]) => ({ typeId:role.code+"-"+id, roleName:role.name, title:subtype.title, portrait:portrait(role.id), description:subtype.description }))); }
  const preferenceLabels = {
    D: ["从哪里找线索", "任务与票型", "信息与保护链"],
    H: ["公开多少判断", "讲清依据", "控制身份暴露"],
    S: ["怎样掩护队友", "保留行动空间", "替人承担嫌疑"],
    W: ["优先争取什么", "推进任务", "争取终局身份收益"],
    F: ["如何解释局面", "沿可核验依据", "提出替代解释"],
    U: ["如何和队友配合", "整合队友判断", "独立推进"],
    R: ["如何调整计划", "延续原计划", "按新信息重排"],
  };
  function preferences(view) {
    return (view?.dimensions || []).map(axis => {
      const [label, negative, positive] = preferenceLabels[axis.id] || [axis.label, axis.negative, axis.positive];
      const tendency = axis.tendency === "两端接近" || axis.position === 50
        ? "两端接近" : "偏向" + (axis.position < 50 ? negative : positive);
      return { ...axis, label, negative, positive, tendency };
    });
  }
  function date(at) { const d = new Date(at + 8*3600000); return d.toISOString().slice(0,10).replace(/-/g,"."); }
  return { question, result, preferences, catalogue, guideTopics, portrait, date, version:quiz.version, total:quiz.questions.length };
});
