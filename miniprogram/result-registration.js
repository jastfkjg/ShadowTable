// Result form state shared by the mini-program and browser.
(function (root, factory) {
  const registration = factory();
  if (typeof module === "object" && module.exports) module.exports = registration;
  else root.shadowtableResultRegistration = registration;
})(typeof window === "object" ? window : this, function () {
  function reasons(room = {}) {
    room = room || {};
    return (room.scoreSettlement?.length ? room.scoreSettlement : room.funSettlement || [])
      .filter(reason => reason.id !== "five_rejections");
  }
  function flow(data) {
    const room = data.room || {}, options = reasons(room);
    const other = !!data.resultOther || !options.length;
    const reason = !other && options.find(item => item.id === data.resultReason);
    const option = other && (room.winnerOptions || []).find(item => item.value === data.resultChoice);
    const players = (room.players || []).filter(player => player.alive !== false);
    const actor = players.find(player => player.seat === data.resultActor);
    const target = players.find(player => player.seat === data.resultTarget);
    const needsActor = !!(reason?.requiresTarget && (room.settlementRequiresActor ?? (room.knights && room.funSettlement)));
    const steps = [{ id: "reason", label: "登记方式", shortLabel: "登记方式" }];
    if (needsActor) steps.push({ id: "actor", label: "实际带刀人", shortLabel: "带刀人" });
    if (reason?.requiresTarget) steps.push({ id: "target", label: "实际刺杀目标", shortLabel: "刺杀目标" });
    steps.push({ id: "review", label: "核对结果", shortLabel: "核对结果" });
    const index = Math.max(0, steps.findIndex(item => item.id === data.resultStep)), current = steps[index];
    const selected = !!reason || !!option || data.resultChoice === "none";
    const actorValid = !needsActor || !!actor;
    const targetValid = !reason?.requiresTarget || data.resultTarget === 0 || !!target && (!needsActor || target.seat !== actor?.seat);
    const ready = !!(selected && actorValid && targetValid);
    const nextEnabled = current.id === "reason" ? !!selected : current.id === "actor" ? actorValid : current.id === "target" ? targetValid : ready;
    const summary = [{ label: reason ? "结束原因" : "登记方式", value: reason?.label || (option ? "仅登记胜方 · " + option.label : "不计战绩") }];
    if (needsActor) summary.push({ label: "实际带刀人", value: actor ? actor.seat + "号 · " + actor.name : "尚未选择" });
    if (reason?.requiresTarget) summary.push({ label: "实际刺杀目标", value: data.resultTarget === 0 ? "空刀" : target ? target.seat + "号 · " + target.name : "尚未选择" });
    const notice = data.resultChoice === "none" ? "本局不计战绩及积分。" : reason ? room.scoreSettlement?.length ? "记录胜负、积分及趣味结果。" : "记录胜负及趣味结果，不计积分。" : "仅记录胜负，不计积分。";
    const nextHint = current.id === "review" ? "确认后归档，不能直接修改" : "";
    return {
      resultOther: other, resultReasonOptions: options,
      resultSteps: steps, resultStep: current.id, resultStepIndex: index, resultStepTitle: current.label,
      resultNextEnabled: nextEnabled, resultNeedsActor: needsActor, resultRequiresTarget: !!reason?.requiresTarget,
      resultReady: ready, resultSummary: summary, resultNotice: notice, resultPlayers: players, resultNextHint: nextHint,
    };
  }
  function switchMode(data) {
    const other = !flow(data).resultOther;
    if (other) {
      const choice = data.resultChoiceDraft;
      return {
        resultOther: true, resultStep: "reason",
        resultReasonDraft: { reason: data.resultReason, target: data.resultTarget, actor: data.resultActor, choice: data.resultChoice === "none" ? "none" : "" },
        resultReason: "", resultTarget: null, resultActor: null,
        resultChoice: data.room?.winnerOptions?.some(item => item.value === choice) ? choice : "",
      };
    }
    const draft = data.resultReasonDraft;
    const valid = reasons(data.room).some(reason => reason.id === draft?.reason);
    return {
      resultOther: false, resultStep: "reason", resultChoiceDraft: data.resultChoice, resultChoice: !valid && draft?.choice === "none" ? "none" : "",
      resultReason: valid ? draft.reason : "", resultTarget: valid ? draft.target : null, resultActor: valid ? draft.actor : null,
    };
  }
  return { reasons, flow, switchMode };
});
