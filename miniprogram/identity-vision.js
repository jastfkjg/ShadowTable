(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.shadowtableIdentityVision = factory();
})(typeof window !== "undefined" ? window : this, function () {
  const summaryLabels = new Map([["任务出牌", "任务"], ["阵营转换", "转换"]]);
  // Format only information already disclosed by the private endpoint. Never
  // join public seats with hidden roles or assign identities to ambiguous seats.
  function parse(information) {
    const text = String(information || "");
    const named = text.match(/^(初始见面匪|你的坏人同伴)：([1-9]\d*号（[^（）]+）(?:、[1-9]\d*号（[^（）]+）)*)(?:。([\s\S]*))?$/);
    if (named) return { label: named[1], players: named[2].split("、").map(value => {
      const entry = value.match(/^([1-9]\d*)号（([^（）]+)）$/);
      return { seat: Number(entry[1]), role: entry[2] };
    }), note: (named[3] || "").trim(), text };
    const numbered = text.match(/^(你看见的坏人座位|你看见的举手座位|梅林与莫甘娜位于|蓝术士与红术士位于|你的坏人同伴|你的盗贼同伴|刺客位于)：([1-9]\d*(?:、[1-9]\d*)*)号?([。（][\s\S]*)?$/);
    if (numbered) return { label: numbered[1], players: numbered[2].split("、").map(seat => ({ seat: Number(seat), role: "" })),
      note: (numbered[3] || "").replace(/^。/, ""), text };
    return { label: "", players: [], note: "", text };
  }
  function present(information, players) {
    const vision = parse(information);
    if (!Array.isArray(players)) return vision;
    const profiles = new Map(players.filter(player => player.occupied !== false).map(player => [Number(player.seat), player]));
    return { ...vision, players: vision.players.map(entry => {
      const profile = profiles.get(entry.seat);
      const name = String(profile?.name || "");
      // Explicitly copy public profile fields; roles come only from the parsed
      // private vision, including when a caller supplies extra player fields.
      return { ...entry, name: name || "玩家", avatarInitial: Array.from(name || "友")[0],
        avatarUrl: profile?.avatarUrl || "", avatarFailed: !!profile?.avatarFailed };
    }) };
  }
  // Presentation only: split the private text already returned by the server.
  // Unknown formats stay readable verbatim. Never consult roles on public seats,
  // and never replace an old identity snapshot with a current inspection.
  function presentIdentity(secret, players) {
    let text = String(secret.information || "").trim();
    let fairy = null, inspections = [], abilityText = "", passive = null;
    let roleAbility = null;
    const helpStart = text.indexOf("\n\n角色能力\n");
    if (helpStart !== -1) {
      const lines = text.slice(helpStart + "\n\n角色能力\n".length).split("\n");
      const parsed = lines.map(line => line.match(/^([^：\n]+)：(.+)$/));
      if (parsed.every(Boolean) && parsed[0]?.[1] === "一句话") {
        roleAbility = { brief: parsed[0][2], lines: parsed.slice(1).filter(m => m[1] !== "注意").map(m => ({label:m[1],text:m[2]})),
          note: parsed.filter(m => m[1] === "注意").map(m => m[2]).join(""), structured: true };
        text = text.slice(0, helpStart).trim();
      }
    }
    const fairyMatch = text.match(/(?:^|\s)([1-9]\d*)号查验结果：(好人|坏人|盗贼阵营)(?:（第\d+轮）)?$/);
    if (fairyMatch) {
      fairy = { seat: Number(fairyMatch[1]), faction: fairyMatch[2],
        tone: ({ 好人: "good", 坏人: "evil", 盗贼阵营: "third" })[fairyMatch[2]] };
      text = text.slice(0, fairyMatch.index).trim();
    }
    const historyStart = text.indexOf("\n\n查验记录\n");
    if (historyStart !== -1) {
      const records = text.slice(historyStart + "\n\n查验记录\n".length).split("\n");
      const parsed = records.map(line => line.match(/^(第\d+次查验(?:（(?:抽牌随机|更新后)）)?|历史查验（旧版仅保留最近一次）)：([1-9]\d*)号(拥有|没有)主动击杀能力。$/));
      if (parsed.every(Boolean)) {
        inspections = parsed.map((match, index) => ({ id: index,
          label: match[1].replace(/（.*$/, ""), source: (match[1].match(/（(.*)）/) || [])[1] || "",
          seat: Number(match[2]), result: match[3] === "拥有" ? "有主动击杀能力" : "无主动击杀能力" }));
        text = text.slice(0, historyStart).trim();
      }
    }
    const passiveMatch = text.match(/^(?:被动视野：每轮技能结束后自动更新存活B牌坏人座位，可随时在此查看。\s*)?(?:第(\d+)轮B牌坏人：(无|[1-9]\d*(?:、[1-9]\d*)*号)|等待技能结算后自动更新。)$/);
    if (passiveMatch) {
      passive = { round: passiveMatch[1] || "", result: passiveMatch[2] || "等待结算",
        note: "每轮技能全部结算后自动更新。" };
      text = "";
    }
    const noVisionAbility = text.match(/^(没有视野。)\s+([\s\S]+)$/);
    const knifeAbility = text.match(/^([\s\S]*?。)\s+(可刀刀客或B角色一次；[\s\S]+)$/);
    const split = noVisionAbility || knifeAbility;
    if (split) { text = split[1]; abilityText = split[2]; }
    const vision = present(text, players);
    vision.wide = vision.players.some(player => Array.from(player.name || "").length > 8 || Array.from(player.role || "").length > 8);
    vision.empty = text === "没有视野。";
    vision.text = vision.empty ? "无角色视野" : vision.text;
    // Empty results are different from unknown/not-yet-resolved results.
    const emptySeats = text.match(/^(初始见面匪|你的坏人同伴|你的盗贼同伴|你看见的坏人座位|你看见的举手座位|梅林与莫甘娜位于|蓝术士与红术士位于|刺客位于)：(?:无可见同伴|无号|号)?(?:。|（|$)([\s\S]*)$/);
    if (emptySeats) {
      vision.label = emptySeats[1]; vision.text = "无可见玩家";
      vision.note = emptySeats[2].replace(/）[。]?$/, "");
    }
    let ability = null;
    if (abilityText) {
      const hunter = abilityText.match(/^主动自爆带走相邻一人；或预选场上其他一人，出局时被动开枪；([\s\S]+)$/);
      if (hunter) ability = { lines: [{ label: "主动自爆", text: "带走相邻一人。" },
        { label: "被动开枪", text: "预选场上其他一人，出局时开枪。" }], note: hunter[1] };
      else {
        const sentence = abilityText.match(/^([^。；]+[。；])([\s\S]*)$/);
        ability = { lines: [{ label: "", text: sentence ? sentence[1] : abilityText }], note: sentence ? sentence[2].trim() : "" };
      }
    }
    ability = roleAbility || ability;
    const openingVision = vision.empty ? roleAbility?.lines.find(line => line.label === "初始视野")?.text : "";
    const summary = roleAbility ? [
      { label: "能力", text: roleAbility.brief },
      ...roleAbility.lines.filter(line => summaryLabels.has(line.label))
        .map(line => ({ label: summaryLabels.get(line.label), text: line.text })),
    ] : [];
    return { vision, passive, fairy, inspections, ability, summary,
      summaryVision: openingVision?.replace(/^没有初始视野，/, "无初始视野，") || vision.text,
      showRoleHelp: secret.knightBCard === true && !!secret.skillStatus && !!ability,
      showVision: !!passive || (!!text && !(vision.empty && inspections.length)) };
  }
  return { present, presentIdentity };
});
