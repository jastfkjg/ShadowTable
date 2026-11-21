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
    const styleExamples = value.moments?.styleExamples;
    const styleNote = styleExamples && [
      value.tendencyLabel === "混合倾向" ? "你的选择带有几种角色的特点，其中包括"+role.name+"。" : "你的判断方式很像"+role.name+"。",
      value.subtypeResolution === "style_tiebreak" ? "主动开口和择机介入两种倾向持平。" :
        "主动和择机两种倾向接近，这次略偏"+(value.subtype === "A" ? "先开口。" : "等时机。"),
    ].join("");
    const dimensions = config.dimensions.map(d => {
      const score = value.profile[d.id], position = Math.round(Math.max(0,Math.min(100,(score+1)*50)));
      const close = (d.id === config.styleDimension && !!styleExamples) || Math.abs(score) < .1;
      return { id:d.id, label:d.label, negative:d.negative, positive:d.positive, position,
        positionClass:"p"+position, tendency:close ? "两端接近" : score < 0 ? "偏向 · " + d.negative : "偏向 · " + d.positive };
    });
    const moments = value.moments && [
      { heading:"角色线索 · " + role.name, evidence:value.moments.role },
      ...(styleExamples ? [
        {heading:"你会主动开口的局面", evidence:styleExamples.A},
        {heading:"你会择机介入的局面", evidence:styleExamples.B},
        {heading:"决定本次称号的补充选择", evidence:value.subtypeResolution === "style_tiebreak" && value.moments.style},
      ] : [{heading:value.subtype === "A" ? "介入方式 · 主动介入" : "介入方式 · 择机介入", evidence:value.moments.style}]),
    ].filter(row => row.evidence).map(({heading,evidence}) => ({heading,...evidence}));
    const explanations=(value.explanations || []).map(item => ({ questionId:item.questionId, optionId:item.optionId,
      title:config.questions.find(q => q.id === item.questionId)?.title || item.questionId, text:item.text, interpretation:item.interpretation }));
    // Keep the original option for every moment, including the deciding supplemental answer.
    const details=moments ? [...moments, ...explanations].filter((item,index,rows) =>
      rows.findIndex(row=>row.questionId === item.questionId) === index).slice(0,Math.max(3,moments.length)) : explanations;
    return {
      version:value.version, typeId:value.typeId, roleId:role.id, roleName:role.name, english:english[role.id], title:subtype.title,
      portrait:portrait(role.id), summary:role.summary, description:subtype.description,
      ...(moments ? { moments } : {}),
      ...(styleNote ? { styleNote } : {}),
      strength:role.strength, blindspot:role.blindspot, tip:role.tip, tendencyLabel:value.tendencyLabel,
      dimensions:dimensions.filter(d => d.id !== "E"), style:dimensions.find(d => d.id === "E"),
      secondary:(value.secondaryRoleIds || []).map(id => ({ id, name:roleNames[id], portrait:portrait(id) })),
      explanations:details,
      note:"娱乐性对局风格探索，反映本次选择，不代表能力、胜率或固定人格。",
    };
  }
  function sharedResult(view) {
    const result = {...view};
    for (const key of ["summary","description","strength","blindspot","tip","styleNote"]) {
      // A question quoted at the table is still addressed to the other player.
      const pronoun = key === "tip" ? "自己" : "TA";
      if (typeof view[key] === "string") result[key] = view[key].replace(/「[^」]*」|你/g, word => word === "你" ? pronoun : word);
    }
    return result;
  }
  function catalogue() { return quiz.roles.flatMap(role => Object.entries(role.subtypes).map(([id, subtype]) => ({ typeId:role.code+"-"+id, roleName:role.name, title:subtype.title, portrait:portrait(role.id), description:subtype.description }))); }
  function momentRows(view) {
    return (view?.moments || []).map(({heading,moment}) => ({
      heading, phrases:moment.match(/[^，。！？；]+[，。！？；]*|[，。！？；]+/g) || [],
    }));
  }
  const preferenceLabels = {
    D: ["任务结束后，你先看什么？", "谁上车、谁投了赞成票", "谁提前知情、谁在护谁"],
    H: ["说出判断时，你会讲多少理由？", "把自己的依据讲清楚", "少讲会暴露身份的细节"],
    S: ["队友被追问时，你怎么接话？", "让队友自己解释", "替队友接下追问"],
    W: ["选任务队伍时，你更看重什么？", "这轮任务的成败", "谁的身份可能暴露"],
    F: ["同一件事有两种说法，你怎么办？", "用已有记录核对说法", "试着从另一个角度解释"],
    U: ["和队友意见不同时，你怎么办？", "一起找都能接受的方案", "说出自己的不同判断"],
    R: ["新线索和原计划有冲突，你怎么办？", "先按原计划，再找证据", "根据新线索调整计划"],
    E: ["没人提方案时，你会怎么做？", "先听大家说，再补充", "先提个方案让大家讨论"],
  };
  function preferences(view) {
    const dimensions = view?.dimensions || [];
    const axes = view?.style ? dimensions.concat(view.style) : dimensions;
    return axes.map(axis => {
      const [label, negative, positive] = preferenceLabels[axis.id] || [axis.label, axis.negative, axis.positive];
      const tendency = axis.tendency === "两端接近" || axis.position === 50
        ? "两端接近" : "偏向" + (axis.position < 50 ? negative : positive);
      return { ...axis, label, negative, positive, tendency };
    });
  }
  function date(at) { const d = new Date(at + 8*3600000); return d.toISOString().slice(0,10).replace(/-/g,"."); }
  return { question, result, sharedResult, momentRows, preferences, catalogue, guideTopics, portrait, date, version:quiz.version, total:quiz.questions.length };
});
