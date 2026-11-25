"use strict";
window.shadowtableBadgeRankView = function (s, esc, renderDetail) {
  if (!s) return '<div class="br-status" role="status">正在读取徽章榜…</div>';
  const { board, detail, kind, label } = s;
  const chevron = '<i class="br-chevron" aria-hidden="true"></i>';
  const avatar = (p) =>
    p.avatarUrl
      ? '<img class="br-avatar" alt="" src="' + esc(p.avatarUrl) + '">'
      : '<span class="br-avatar" aria-hidden="true">' +
        esc(p.initial) +
        "</span>";
  const back = s.player ? "badge-ranks/" + kind : "badges";
  let html =
    '<section class="br-page br-' +
    kind +
    '"' + (s.selectedBadge ? ' inert' : '') + '><header class="badge-web-header"><button class="badge-web-back" data-action="brBack" data-page="' +
    back +
    '" aria-label="返回' +
    (s.player ? "徽章榜" : "徽章收藏") +
    '">‹</button><h1 tabindex="-1" data-page-heading>' +
    (s.player ? label : "徽章榜") +
    "</h1><span></span></header>";
  if (!s.player) {
    const choices = s.choices.map((choice) => {
      const selected = choice.kind === kind;
      return `<button type="button" class="br-choice${selected ? " selected" : ""}" data-action="brSelect" data-kind="${esc(choice.kind)}" aria-pressed="${selected}">
        <img class="br-choice-art" src="${esc(choice.art)}" alt="">
        <span>${esc(choice.title)}</span>
        ${selected ? '<i class="br-choice-check" aria-hidden="true"></i>' : ""}
      </button>`;
    });
    html += `<div class="br-selector">
      <div class="br-choices" role="group" aria-label="切换徽章榜">${choices.join("")}</div>
      <div class="br-selector-meta">${s.countLabel}${board ? " · " + board.total + " 位玩家上榜" : ""}</div>
    </div>`;
    if (board) {
      if (board.total)
        html +=
          '<div class="br-columns"><span class="br-rank-label">名次</span><span class="br-player-label">玩家</span><span>' + s.countLabel + '</span></div>';
      for (const p of board.rows)
        html +=
          '<button class="br-row ' +
          (p.rank === 1 ? "first" : "") +
          '" data-action="brPlayer" data-id="' +
          esc(p.publicId) +
          '"><span class="br-place">' +
          p.rank +
          '</span><span class="br-player">' +
          avatar(p) +
          '<span class="br-name">' +
          esc(p.nickname) +
          '</span></span><span class="br-number">' +
          p.count +
          " <small>枚</small></span>" +
          chevron +
          "</button>";
      if (!board.total)
        html += '<div class="br-status">暂无玩家持有' + label + "</div>";
      if (board.nextOffset !== null && !s.error)
        html +=
          '<button class="br-more" data-action="brMore"' +
          (s.loading ? " disabled" : "") +
          ">" +
          (s.loading ? "加载中…" : "查看更多玩家") +
          "</button>";
      html +=
        '<button class="br-mine" data-action="brPlayer" data-id="self"><span class="br-me-name">我的排名<br><span class="br-muted">' +
        esc(board.me.nickname) +
        "</span></span><strong>" +
        (board.me.rank
          ? "第 " + board.me.rank + " 名 · " + board.me.count + " 枚"
          : "暂未上榜") +
        "</strong>" +
        chevron +
        "</button>";
    }
  } else if (detail) {
    const p = detail.player;
    html +=
      '<div class="br-person">' +
      avatar(p) +
      '<div><h2 class="br-person-name">' +
      esc(p.nickname) +
      '</h2><div class="br-muted">' +
      (p.rank ? "第 " + p.rank + " 名 · " : "") +
      s.countLabel + " " +
      p.count +
      " 枚" +
      label +
      "</div></div></div>";
    if (detail.isSelf)
      html +=
        '<button class="br-privacy" role="switch" aria-checked="' +
        detail.visible +
        '" data-action="brToggle"' +
        (s.saving ? " disabled" : "") +
        "><span>公开我的" +
        label +
        '明细<br><span class="br-muted">关闭后，他人仍可看到名次和数量</span></span><i class="br-switch" aria-hidden="true"></i></button>';
    if (!detail.isSelf && !detail.visible)
      html += '<div class="br-status">该玩家已隐藏徽章明细</div>';
    else if (!p.count)
      html += '<div class="br-status">当前未持有' + label + "</div>";
    else
      html +=
        '<div class="br-grid">' +
        detail.badges
          .map(
            (b) =>
              '<button type="button" class="br-tile" aria-haspopup="dialog" data-action="brOpenBadge" data-id="' + esc(b.id) + '"><img src="' +
              esc(b.imageUrl) +
              '" alt=""><div>' +
              esc(b.title) +
              '</div><div class="br-muted">' +
              esc(b.periodLabel || (b.permanent ? "永久徽章" : "月度徽章")) +
              "</div></button>",
          )
          .join("") +
        "</div>";
  }
  if (s.loading && !board)
    html += '<div class="br-status" role="status">正在读取…</div>';
  if (s.error)
    html +=
      '<div class="br-status" role="alert">' +
      esc(s.error) +
      '<button class="br-more" data-action="brReload">重新加载</button></div>';
  return html + "</section>" + (s.selectedBadge ? renderDetail(s.selectedBadge) : "");
};
