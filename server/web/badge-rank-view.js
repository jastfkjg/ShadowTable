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
  const back = s.lookup ? (s.badgeId && !s.fromLeaderboard ? 'badge-ranks/lookup' : 'leaderboard') : s.player ? 'badge-ranks/' + kind : 'badges';
  const parent = s.lookup ? (s.badgeId ? '徽章查询' : '排行榜') : s.player ? '徽章榜' : '徽章收藏';
  const title = s.lookup ? '查徽章' : s.player ? label : '徽章榜';
  let html = `<section class="br-page br-${kind}"${s.selectedBadge ? ' inert' : ''}>
    <header class="badge-web-header">
      <button class="badge-web-back" data-action="brBack" data-page="${back}" aria-label="返回${parent}">‹</button>
      <h1 tabindex="-1" data-page-heading>${title}</h1><span></span>
    </header>`;
  if (s.lookup && !s.badgeId) {
    html += `<label class="br-search"><span>徽章名称</span>
      <input class="input" type="search" data-input="badgeLookup" placeholder="搜索徽章名称或月份" value="${esc(s.query)}"></label>`;
    for (const b of s.matches) {
      html += `<button class="br-lookup-item" data-action="navigate" data-page="badge-ranks/lookup/${esc(b.id)}">
        <img class="br-lookup-art" src="${esc(b.imageUrl)}" alt="" loading="lazy">
        <span class="br-name">${esc(b.title)}</span><span class="br-muted">${esc(b.scope)}</span>${chevron}
      </button>`;
    }
    if (!s.loading && !s.error && !s.matches.length) html += '<p class="br-status">没有找到徽章，试试更短的名称。</p>';
  } else if (s.lookup) {
    const b = s.badge;
    if (b) html += `<div class="br-person"><img class="br-lookup-art" src="${esc(b.imageUrl)}" alt="">
      <div><h2 class="br-person-name">${esc(b.title)}</h2><div class="br-muted">${esc(b.scope)} · ${esc(b.condition)}</div></div></div>`;
    if (board) {
      html += `<div class="br-selector-meta">${board.holdersOnly ? '公开获得者' : '公开排名'} · ${board.total} 人</div>`;
      for (const row of board.rows) {
        const place = row.rank ? `<span class="br-place">${row.rank}</span>` : '';
        const earned = row.earned && !board.holdersOnly ? '<span class="br-muted">已获得</span>' : '';
        const score = row.unit ? `<span class="br-number">${esc(row.value)} <small>${esc(row.unit)}</small></span>` : '';
        html += `<div class="br-lookup-item">${place}${avatar(row)}<span class="br-name">${esc(row.nickname)}</span>${earned}${score}</div>`;
      }
      if (!board.total) html += `<p class="br-status">${board.holdersOnly ? '暂无公开获得者' : '暂无符合条件的公开玩家'}</p>`;
      if (board.nextOffset !== null && !s.error) html += `<button class="br-more" data-action="brMore"${s.loading ? ' disabled' : ''}>${s.loading ? '加载中…' : '查看更多玩家'}</button>`;
    }
  } else if (!s.player) {
    const choices = s.choices.map((choice) => {
      const selected = choice.kind === kind;
      return `<button type="button" class="br-choice${selected ? " selected" : ""}" data-action="brSelect" data-kind="${esc(choice.kind)}" aria-pressed="${selected}">
        <img class="br-choice-art" style="${esc(choice.artStyle)}" src="${esc(choice.art)}" alt="">
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
              '<button type="button" class="br-tile" aria-haspopup="dialog" data-action="brOpenBadge" data-id="' + esc(b.id) + '"><img style="' + esc(b.artStyle) + '" src="' +
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
