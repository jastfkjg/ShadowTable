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

module.exports = { presentRoleGroups, fitBody };
