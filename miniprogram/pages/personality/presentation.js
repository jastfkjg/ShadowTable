(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./quiz-data"));
  else root.shadowtablePersonalityPresentation = factory(root.shadowtablePersonalityQuiz);
})(typeof window === "object" ? window : this, function(quiz) {
  "use strict";
  const art = { loyal: "servant" };
  const roleNames = Object.fromEntries(quiz.roles.map(role => [role.id, role.name]));
  const names = { ...roleNames, lancelot_initial_good: "初始蓝兰", lancelot_initial_evil: "初始红兰", observer: "旁观者" };
  const english = { merlin:"MERLIN", percival:"PERCIVAL", loyal:"LOYAL SERVANT", morgana:"MORGANA", mordred:"MORDRED", assassin:"ASSASSIN", oberon:"OBERON", lancelot:"LANCELOT" };
  const terms = [
    { title:"作答约定", text:quiz.contentRules.join("\n") },
    ...Object.values(quiz.rulesets).map(rule=>({
      title:rule.name,
      text:[
        "蓝方："+rule.goodRoles.map(id=>names[id]).join("、")+"。红方："+rule.evilRoles.map(id=>names[id]).join("、")+"。",
        "五次任务人数依次为 "+rule.teamSizes.join(" / ")+"，第四任务至少两张失败票才失败。",
        ...rule.specialRules,
      ].join("\n"),
    })),
  ];
  function portrait(roleId) { return "/assets/roles/" + (art[roleId] || roleId) + ".png"; }
  function question(id, selected) {
    const q = quiz.questions.find(row => row.id === id) || Object.values(quiz.tieBreakers).find(row => row.id === id);
    if (!q) return null;
    const index = quiz.questions.findIndex(row => row.id === id);
    return {
      id:q.id, title:q.title || "补充一个选择", prompt:q.prompt, situation:q.situation,
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
    return {
      version:value.version, typeId:value.typeId, roleId:role.id, roleName:role.name, english:english[role.id], title:subtype.title,
      portrait:portrait(role.id), summary:role.summary, description:subtype.description,
      strength:role.strength, blindspot:role.blindspot, tip:role.tip, tendencyLabel:value.tendencyLabel,
      dimensions:dimensions.filter(d => d.id !== "E"), style:dimensions.find(d => d.id === "E"),
      secondary:(value.secondaryRoleIds || []).map(id => ({ id, name:roleNames[id], portrait:portrait(id) })),
      explanations:(value.explanations || []).map(item => ({ questionId:item.questionId, optionId:item.optionId,
        title:config.questions.find(q => q.id === item.questionId)?.title || item.questionId, text:item.text, interpretation:item.interpretation })),
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
  return { question, result, preferences, catalogue, terms, portrait, date, version:quiz.version, total:quiz.questions.length };
});
