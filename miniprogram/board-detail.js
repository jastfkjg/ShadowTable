// Shared, read-only presentation for board details. All rule text comes from /api/boards.
(function (root, factory) {
  const presentation = factory();
  if (typeof module === "object" && module.exports)
    module.exports = presentation;
  else root.shadowtableBoardDetail = presentation;
})(typeof window === "object" ? window : this, function () {
  const roleTypes = {
    圣骑士: "被动 · 反伤",
    魔术师: "主动 · 换号",
    月下先知: "被动 · 视野",
    觉醒蓝刀客: "主动 · 攻击",
    觉醒红刀客: "主动 · 攻击",
    蓝骑士: "主动 · 决斗",
    红骑士: "主动 · 决斗",
    蓝守卫: "主动 · 守护",
    石像鬼: "主动 · 查验",
    蓝猎人: "主动 / 被动",
    红猎人: "主动 / 被动",
    女巫: "主动 · 替死",
  };
  const labels = {
    圣骑士: ["方式", "效果"],
    魔术师: ["效果"],
    月下先知: ["方式", "视野"],
    蓝骑士: ["效果"],
    红骑士: ["效果"],
    蓝守卫: ["效果"],
    蓝猎人: ["方式", "主动", "被动", "次数"],
    红猎人: ["方式", "主动", "被动", "次数"],
    女巫: ["效果"],
    石像鬼: ["方式", "视野"],
  };
  function roleDetails(role) {
    const sentences =
      String(role.text || "").match(/[^。！？]+[。！？]?/g) || [];
    const facts = [],
      exceptions = [];
    sentences.forEach((text, index) => {
      if (/不能反伤|莫德雷德在决斗|替女巫出局/.test(text)) {
        exceptions.push(text);
      } else if (role.name === "圣骑士" && text.includes("；")) {
        const split = text.indexOf("；");
        facts.push({ label: "效果", text: text.slice(0, split + 1) });
        facts.push({ label: "消耗", text: text.slice(split + 1) });
      } else
        facts.push({
          label: labels[role.name]?.[index] || (index ? "补充" : "说明"),
          text,
        });
    });
    return {
      facts,
      exceptionTitle: role.name === "圣骑士" ? "女巫例外" : "特殊约定",
      exception: exceptions.join(""),
    };
  }
  // Recognize the existing deck prose; unknown/new formats keep their original paragraphs.
  function deckPresentation(section) {
    if (section.title !== "AB 牌堆与身份构成" || section.items.length !== 2)
      return null;
    const a = section.items[0].match(
      /^A\s*牌\s*(\d+)\s*张（([^）]+)）：蓝方\s*(\d+)\s*张——([^；]+)；红方\s*(\d+)\s*张——([^。]+)。(.*)$/,
    );
    const b = section.items[1].match(
      /^B\s*牌\s*(\d+)\s*张：蓝方\s*(\d+)\s*张、红方\s*(\d+)\s*张，分\s*(\d+)\s*层混洗——(.+?)。(.*)$/,
    );
    if (!a || !b) return null;
    const layers = Array.from(
      b[5].matchAll(/(\d+)\s*红\s*(\d+)\s*蓝/g),
      (match, index) => ({
        label: "第" + ["一", "二", "三"][index] + "层",
        text: match[1] + " 红 + " + match[2] + " 蓝",
      }),
    );
    if (layers.length !== Number(b[4])) return null;
    return [
      {
        name: "A 牌",
        purpose: a[2],
        count: Number(a[1]),
        good: Number(a[3]),
        evil: Number(a[5]),
        factions: [
          { tone: "good", label: "蓝方", roles: a[4] },
          { tone: "evil", label: "红方", roles: a[6] },
        ],
        note: a[7],
      },
      {
        name: "B 牌",
        purpose: "复活身份",
        count: Number(b[1]),
        good: Number(b[2]),
        evil: Number(b[3]),
        layers,
        layerHint: "分 " + b[4] + " 层混洗，按顺序抽取",
        note: b[6],
      },
    ];
  }
  function presentBoard(board = {}, capacity) {
    capacity =
      Number(capacity) || Number(board.capacity) || board.counts?.[0] || 0;
    const name = board.namesByCapacity?.[capacity] || board.name || "板子详情";
    const title = name
      .replace(/^阿瓦隆\s*[·/]\s*/, "")
      .replace(/[（(]\d+人[）)]$/, "")
      .trim();
    const source = board.detail?.sections || [];
    const groups = [],
      roles = [],
      chapters = [];
    source.forEach((section, sectionIndex) => {
      if (section.kind === "roles") {
        const isA = /A\s*牌/.test(section.title),
          isB = /B\s*牌/.test(section.title);
        const groupId = isA
          ? "a"
          : isB
            ? "b-" + (section.items[0]?.tone || "other")
            : "group-" + sectionIndex;
        const label = isA
          ? "A 牌角色"
          : isB
            ? "B 牌 · " +
              (/红方|坏人/.test(section.title)
                ? "红方"
                : /蓝方|好人/.test(section.title)
                  ? "蓝方"
                  : "其他")
            : section.navTitle || section.title;
        if (!groups.some((group) => group.id === groupId))
          groups.push({ id: groupId, label });
        section.items.forEach((role, roleIndex) =>
          roles.push({
            ...role,
            ...roleDetails(role),
            id: sectionIndex + ":" + roleIndex,
            groupId,
            groupLabel: label,
            type:
              roleTypes[role.name] ||
              (/刀客|刺客/.test(role.name) ? "主动 · 攻击" : role.meta || ""),
            brief:
              role.brief ||
              role.text.split("。")[0] + (role.text.includes("。") ? "。" : ""),
          }),
        );
      } else
        chapters.push({
          ...section,
          id: "section-" + sectionIndex,
          decks: deckPresentation(section),
        });
    });
    const roleConfiguration =
      board.roleConfigurations?.[capacity] || board.roleConfiguration || [];
    if (!roles.length && roleConfiguration.length)
      chapters.unshift({
        id: "configuration",
        title: "角色配置",
        kind: "configuration",
        configuration: roleConfiguration,
      });
    chapters.forEach((chapter, index) => {
      chapter.number = String(index + 1).padStart(2, "0");
      chapter.displayTitle = chapter.decks
        ? "身份构成与牌堆"
        : chapter.title === "B 牌、复活与转换"
          ? "复活与转换"
          : chapter.title;
      chapter.expanded = index === 0;
    });
    const hasRoles = roles.length > 0;
    return {
      title,
      capacity,
      name,
      hasRoles,
      hasDetail: !!board.detail,
      groups,
      roles,
      chapters,
      eyebrow: "阿瓦隆 / " + (/经典/.test(title) ? "经典玩法" : "扩展玩法"),
      summary: /^B\s*牌技能速查/.test(board.detail?.summary || "")
        ? ""
        : board.detail?.summary || "",
      subtitle: groups.some((group) => group.id === "a")
        ? "A 牌初始身份 · B 牌复活身份"
        : "",
      roleHint: groups.some((group) => group.id.startsWith("b-"))
        ? "新抽 B 牌从下一轮技能环节启用"
        : "点角色展开完整说明",
      defaultTab: hasRoles ? "roles" : "rules",
      roleConfiguration,
    };
  }
  function visibleRoles(board, groupId, query = "", expanded = {}) {
    const tokens = query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return board.roles
      .filter((role) =>
        tokens.length
          ? tokens.every((token) =>
              [
                role.name,
                role.text,
                role.brief,
                role.type,
                role.meta,
                role.groupLabel,
              ]
                .join(" ")
                .toLocaleLowerCase()
                .includes(token),
            )
          : role.groupId === groupId,
      )
      .map((role) => ({
        ...role,
        expanded: !!expanded[role.id],
        showGroup: tokens.length > 0,
      }));
  }
  return { presentBoard, visibleRoles };
});
