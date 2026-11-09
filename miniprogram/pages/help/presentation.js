// Keep the original answers as the source for reading and search. Presentation
// splits that copy into small blocks without changing rules or scoring details.
const terms = ["全体参与玩家", "结算后公开", "只有被选中的队员", "仅展示汇总", "不公开每张牌是谁出的", "不代表", "全员准备", "房主", "自动结算"];
function parts(text) {
  const pattern = new RegExp("(" + terms.join("|") + ")", "g");
  return String(text).split(pattern).filter(Boolean).map((text, id) => ({ id, text, strong: terms.includes(text) }));
}
function paragraphs(text, splitClauses = true) {
  const pattern = splitClauses ? /[^。！？；]+[。！？；]?/g : /[^。！？]+[。！？]?/g;
  return (String(text).match(pattern) || []).map(text => {
    text = text.replace(/；$/, "。");
    return { text, parts: parts(text) };
  });
}
const faqLeads = [
  "我的 → 趣味记录",
  "从「我的」查看资料与战绩",
  "坐满、全员准备，由房主发牌",
  "按页面提示，完成与你有关的操作",
  "房主也看不到你的秘密",
  "切到后台后，身份会自动遮盖",
  "回到「我的牌桌」找回房间",
  "不会退出，当前座位会保留",
  "下一步由房主按现场进度发起",
];

function presentItem(section, item, index, state, searching) {
  const id = section + "-" + index;
  const answer = { ...item, id, heading: item.title, paragraphs: paragraphs(item.text) };
  if (section === "basics") {
    const [heading, caption] = item.title.split("：");
    answer.heading = heading;
    answer.caption = caption || "";
    if (index === 0) {
      const match = item.text.match(/^经典阿瓦隆中，好人(.*?)；坏人(.*?)。(.*)$/);
      if (match) {
        answer.factions = [
          { label: "好人", tone: "good", parts: parts(match[1] + "。") },
          { label: "坏人", tone: "evil", parts: parts(match[2] + "。") },
        ];
        answer.paragraphs = paragraphs(match[3]);
      }
    }
  } else if (section === "host") {
    answer.number = index < 4 ? String(index + 1) : "";
    answer.heading = item.title.replace(/^\d+\.\s*/, "");
    answer.notes = answer.paragraphs.filter(p => p.text.startsWith("小程序不会"));
    answer.paragraphs = answer.paragraphs.filter(p => !p.text.startsWith("小程序不会"));
    answer.lastStep = index === 3;
  } else if (section === "faq") {
    answer.paragraphs = paragraphs(item.text, false);
    answer.lead = faqLeads[index] || "";
    answer.path = index === 0;
    answer.expanded = searching || !!state.faqExpanded[id];
    answer.detailsExpanded = searching || !!state.faqDetailsExpanded[id];
    if (index === 0) {
      const introEnd = item.text.indexOf("。") + 1;
      const detailsAt = item.text.indexOf("结束时");
      const prefix = "从“我的”进入趣味记录，可查看";
      if (item.text.startsWith(prefix) && introEnd > prefix.length && detailsAt > introEnd) {
        const topics = item.text.slice(prefix.length, introEnd - 1).split("、");
        answer.topics = [topics[0], topics[1], topics.slice(2).join("、")].filter(Boolean);
        answer.paragraphs = paragraphs(item.text.slice(introEnd, detailsAt), false);
        answer.details = paragraphs(item.text.slice(detailsAt), false);
      }
    }
  }
  return answer;
}

module.exports = { presentItem };
