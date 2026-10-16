const { portrait } = require("./role-portraits");

// Only decorate the public composition supplied by the server. Counts and
// factions remain authoritative, including future roles and third factions.
function presentRoleGroups(groups) {
  return (groups || []).map(group => ({ ...group,
    entries: typeof group.roles === "string" ? group.roles.split("，").filter(Boolean).map((label, index) => {
      const match = label.trim().match(/^(.*?)(?:×([1-9]\d*))?$/);
      const name = match[1];
      return { ...portrait(name, group.faction), key: group.faction + ":" + index,
        name, countLabel: match[2] ? "×" + match[2] : "" };
    }) : [],
  }));
}

// Native scroll-view needs an explicit height. Measure the rendered chrome and
// content so short sheets fit their content while long/keyboard sheets scroll.
function fitBody(rects, keyboardHeight = 0) {
  if (!Array.isArray(rects) || rects.length !== 4 || rects.some(rect => !rect || !Number.isFinite(rect.height))) return null;
  const [backdrop, top, fields, footer] = rects;
  const clearance = backdrop.width > backdrop.height && backdrop.height <= 500 ? 20 : 88;
  return Math.max(1, Math.floor(Math.min(fields.height, backdrop.height - keyboardHeight - clearance - top.height - footer.height)));
}

function presentPrivateIdentity(secret, factionTone) {
  const information = String(secret.information || "");
  // Split only the existing explicit no-vision prefix; never infer hidden roles
  // or skill rules. Other server descriptions stay intact in the vision block.
  const split = information.match(/^(没有视野。)\s*([\s\S]+)$/);
  const timingNote = secret.passiveVision ? "视野随技能结算自动更新" : /下次技能环节可用|下一轮可用/.test(secret.skillStatus?.detail || "") ? "" : "新技能下一轮可用";
  return { ...secret, factionTone, portrait: portrait(secret.role, factionTone).portrait, timingNote,
    visionText: split ? split[1] : information, abilityText: split ? split[2] : "" };
}
function presentFairyResult(result) {
  const summary = result.summary || result.information || "";
  const match = summary.match(/^(\d+)号(?: · |查验结果：)(好人|坏人|盗贼阵营)(?:（第\d+轮）)?$/);
  return { ...result, displaySeat: match ? Number(match[1]) : null,
    displayFaction: match ? match[2] : "", factionTone: match ? ({好人:"good",坏人:"evil",盗贼阵营:"third"})[match[2]] : "unknown" };
}
module.exports = { presentRoleGroups, fitBody, presentPrivateIdentity, presentFairyResult };
