(function (root, factory) {
  const value = factory(typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport);
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation) {
  const WIDTH = 1080, MAX_HEIGHT = 3600, HEADER = 528, FOOTER = 224;
  const BACKGROUND_PATH = "/assets/monthly-report-background.jpg";
  const colors = { bg: "#0e2028", surface: "#1b313b", text: "#f5f0e6", muted: "#adc1cc", accent: "#efd091", border: "#557079", silver: "#a9c2ce", bronze: "#bf9278" };
  const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  const rowProjection = row => ({ rank: row.rank, tied: row.tied, name: clean(row.nickname) || "新朋友", avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(row.avatarUrl || "") ? row.avatarUrl : "",
    value: clean(row.value), secondary: clean(row.secondaryLabel) });
  const rowHeight = section => section.id === "overall" ? 94 : 116;
  function sectionHeight(section) {
    return section.type === "featured" ? 180 + Math.max(...section.boards.map(board => board.rows.length), 1) * 52
      : 88 + Math.max(section.rows.length, 1) * rowHeight(section);
  }
  function imagePaths(card) {
    return [...new Set([BACKGROUND_PATH, ...card.sections.flatMap(section => section.type === "featured"
      ? section.boards.flatMap(board => board.rows.map(row => row.avatar)) : section.rows.map(row => row.avatar))].filter(Boolean))];
  }
  function cards(response, entertainment = false) {
    const report = presentation.presentReport(response);
    if (!report.canShare) throw new Error("这个月还没有有效对局，暂时无法生成月报图片。");
    const sections = report.coreBoards.map(board => ({ type: "board", id: board.id, title: board.title + " TOP 3", subtitle: board.subtitle, unit: board.unit,
      rows: board.rows.map(rowProjection), emptyHint: board.emptyHint }));
    const featured = entertainment ? presentation.detailBoards(report, "count", true).filter(board => board.rows.length).slice(0, 3) : report.featured;
    // Small leaderboards share a three-column section; ties get full-width rows so nobody disappears.
    if (featured.length && featured.every(board => board.rows.length <= 3)) sections.push({ type: "featured", title: entertainment ? "本月娱乐榜" : "本月趣味荣誉",
      boards: featured.map(board => ({ id: board.metric, title: board.title, subtitle: board.label, unit: board.unit, rows: board.rows.map(rowProjection) })) });
    else for (const board of featured) sections.push({ type: "board", id: board.metric, title: board.title + " TOP 3", subtitle: board.subtitle, unit: board.unit, rows: board.rows.map(rowProjection) });
    const metadata = { kind: "monthly", title: entertainment ? "月度战报 · 娱乐版" : "月度战报", month: report.monthTitle, range: report.rangeLabel,
      asOf: report.asOfLabel, overview: { games: report.overview.games, players: report.overview.players } };
    const pages = []; let current = { ...metadata, sections: [] }, used = HEADER + FOOTER;
    const flush = () => { pages.push(current); current = { ...metadata, sections: [] }; used = HEADER + FOOTER; };
    for (const section of sections) {
      const maximumRows = Math.floor((MAX_HEIGHT - HEADER - FOOTER - 88) / rowHeight(section));
      const chunks = section.type === "featured" || section.rows.length <= maximumRows ? [section]
        : Array.from({ length: Math.ceil(section.rows.length / maximumRows) }, (_, index) => ({ ...section, title: section.title + (index ? " · 续" : ""), rows: section.rows.slice(index * maximumRows, (index + 1) * maximumRows) }));
      for (const chunk of chunks) {
        const height = sectionHeight(chunk);
        if (used + height > MAX_HEIGHT && current.sections.length) flush();
        current.sections.push(chunk); used += height;
      }
    }
    flush();
    return pages.map((page, index) => ({ ...page, page: index + 1, pages: pages.length }));
  }
  function dimensions(card) {
    return { width: WIDTH, height: HEADER + card.sections.reduce((height, section) => height + sectionHeight(section), 0) + FOOTER };
  }
  function describe(card) {
    return [card.month + " " + card.title, "第 " + card.page + " / " + card.pages + " 张", ...card.sections.flatMap(section => section.type === "featured"
      ? section.boards.flatMap(board => [board.title, ...board.rows.map(row => (row.tied ? "并列" : "") + "第" + row.rank + "名 " + row.name + " " + row.value + board.unit)])
      : [section.title, ...section.rows.map(row => (row.tied ? "并列" : "") + "第" + row.rank + "名 " + row.name + " " + row.value + section.unit)]), "统计范围 " + card.range, "截至 " + card.asOf].filter(Boolean).join("，");
  }
  function drawCard(ctx, card, avatars = new Map()) {
    const { height } = dimensions(card), left = 48, right = 1032, inner = right - left;
    const font = (size, weight = 400, serif = false) => { ctx.font = weight + " " + size + "px " + (serif ? "'Songti SC', 'Noto Serif CJK SC', serif" : "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"); };
    const text = (value, x, y, size, color = colors.text, maxWidth = inner, align = "left", weight = 400, serif = true) => {
      const original = Array.from(clean(value)), chars = original.slice();
      ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic"; font(size, weight, serif);
      while (chars.length && ctx.measureText(chars.join("") + (chars.length < original.length ? "…" : "")).width > maxWidth) chars.pop();
      ctx.fillText(chars.join("") + (chars.length < original.length ? "…" : ""), x, y);
    };
    const fit = (value, size, width, minimum = 26, serif = true) => { for (; size > minimum; size -= 2) { font(size, 600, serif); if (ctx.measureText(clean(value)).width <= width) break; } return size; };
    const line = (x1, y1, x2, y2, color = colors.border, width = 1) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const rect = (x, y, width, size, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, width, size); };
    const polygon = (points, fill = true) => { ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); fill ? ctx.fill() : ctx.stroke(); };
    const gradient = (paint, stops, fallback) => { if (!paint?.addColorStop) return fallback; for (const [at, color] of stops) paint.addColorStop(at, color); return paint; };
    const rankColor = rank => rank === 1 ? colors.accent : rank === 2 ? colors.silver : colors.bronze;
    const icon = (kind, x, y, size = 46, color = colors.accent) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(size / 48, size / 48); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const sword = () => { polygon([[-3,15],[-3,-14],[0,-24],[3,-14],[3,15]]); line(-9,9,9,9,color,3); line(0,15,0,23,color,4); };
      if (kind === "crown") { polygon([[-22,-9],[-13,8],[0,-19],[13,8],[22,-9],[17,18],[-17,18]]); rect(-18,21,36,4,color); for (const [a,b] of [[-22,-9],[0,-19],[22,-9]]) { ctx.beginPath();ctx.arc(a,b,3,0,Math.PI*2);ctx.fill(); } }
      else if (kind === "swords") { ctx.save();ctx.rotate(.75);sword();ctx.restore();ctx.rotate(-.75);sword(); }
      else if (kind === "sword") sword();
      else if (kind === "moon") { ctx.beginPath();ctx.arc(0,0,21,.30,Math.PI*1.73);ctx.bezierCurveTo(-7,-17,-14,8,20,7);ctx.closePath();ctx.stroke(); }
      else if (kind === "shield") { polygon([[-19,-21],[19,-21],[18,5],[10,17],[0,25],[-10,17],[-18,5]],false); line(0,-18,0,20,color,2); }
      else if (kind === "players") { for (const [a,b,r] of [[0,-12,8],[-16,-8,6],[16,-8,6]]) { ctx.beginPath();ctx.arc(a,b,r,0,Math.PI*2);ctx.fill(); } for (const [a,b,w,h] of [[-10,0,20,22],[-25,4,12,17],[13,4,12,17]]) { ctx.beginPath();ctx.moveTo(a,b+h);ctx.lineTo(a,b+7);ctx.quadraticCurveTo(a+w/2,b-7,a+w,b+7);ctx.lineTo(a+w,b+h);ctx.closePath();ctx.fill(); } }
      else { polygon(Array.from({length:8},(_,i)=>{const angle=-Math.PI/2+i*Math.PI/4,r=i%2?5:23;return [Math.cos(angle)*r,Math.sin(angle)*r];})); }
      ctx.restore();
    };
    const laurel = (rank, x, y, tied) => {
      const color = rankColor(rank);
      ctx.save();ctx.translate(x,y);ctx.fillStyle=color;
      for (const side of [-1,1]) {
        ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(side*12,34);ctx.bezierCurveTo(side*46,24,side*46,-15,side*28,-36);ctx.stroke();
        for(let i=0;i<6;i++) {
          const t=(i+.4)/6,u=1-t,a=side*(12*u*u*u+132*u*u*t+132*u*t*t+28*t*t*t),b=34*u*u*u+60*u*u*t-54*u*t*t-36*t*t*t;
          ctx.save();ctx.translate(a,b);
          for(const direction of [side,-side]) { ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(direction*11,-3,direction*10,-13);ctx.quadraticCurveTo(direction*2,-11,0,0);ctx.fill(); }
          ctx.restore();
        }
      }
      ctx.restore();
      text(String(rank).padStart(2,"0"),x,y+15,44,color,54,"center",600);
      if(tied)text("并列",x,y+44,19,colors.muted,66,"center",400,false);
    };
    const avatar = (row, x, y, radius = 43) => {
      ctx.save();ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();
      rect(x-radius,y-radius,radius*2,radius*2,gradient(ctx.createLinearGradient(x-radius,y-radius,x+radius,y+radius),[[0,"#294c5b"],[1,"#102731"]],colors.surface));
      const source=avatars.get(row.avatar);
      if(source) { const side=Math.min(source.width,source.height);ctx.drawImage(source,(source.width-side)/2,(source.height-side)/2,side,side,x-radius,y-radius,radius*2,radius*2); }
      else text(Array.from(row.name)[0],x,y+15,39,colors.text,radius*1.7,"center",400);
      ctx.restore();ctx.strokeStyle=rankColor(row.rank);ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(x,y,radius+1,0,Math.PI*2);ctx.stroke();
    };
    rect(0,0,WIDTH,height,gradient(ctx.createLinearGradient(0,0,WIDTH,height),[[0,"#10252e"],[.52,colors.bg],[1,"#0a1b23"]],colors.bg));
    const artwork=avatars.get(BACKGROUND_PATH);
    if(artwork?.width && artwork?.height) {
      ctx.drawImage(artwork,0,artwork.height*.25,artwork.width,artwork.height*.55,0,376,WIDTH,height-676);
      ctx.drawImage(artwork,0,0,artwork.width,artwork.height*.25,0,0,WIDTH,376);
      ctx.drawImage(artwork,0,artwork.height*.80,artwork.width,artwork.height*.20,0,height-300,WIDTH,300);
      rect(0,0,WIDTH,376,gradient(ctx.createLinearGradient(0,0,WIDTH,0),[[0,"rgba(14,32,40,.65)"],[.45,"rgba(14,32,40,.20)"],[.73,"rgba(14,32,40,0)"]],"transparent"));
      rect(0,316,WIDTH,60,gradient(ctx.createLinearGradient(0,316,0,376),[[0,"rgba(14,32,40,0)"],[1,colors.bg]],"transparent"));
      rect(0,height-300,WIDTH,300,gradient(ctx.createLinearGradient(0,height-300,0,height),[[0,"rgba(14,32,40,0)"],[.35,"rgba(14,32,40,.20)"],[1,"rgba(14,32,40,.12)"]],"transparent"));
    } else {
      icon("moon",738,112,58);
      for(const [x,y] of [[643,60],[836,128],[940,202]])icon("star",x,y,10);
    }
    text("桌边助手 · ShadowTable",left,64,32,colors.text,700,"left",400);
    text(card.month,left,182,100,colors.accent,570,"left",600);
    text(card.title,left,293,card.title.length>6?73:112,colors.text,700,"left",600);
    text(card.range.slice(5).replace(/—20\d{2}\./," — "),left,345,27,colors.muted,680);
    line(left,376,right,376,colors.accent);
    for(const x of [left,right]) { ctx.fillStyle=colors.accent;polygon([[x,370],[x+4,376],[x,382],[x-4,376]]); }
    [[card.overview.games,"有效对局","swords"],[card.overview.players,"参赛玩家","players"]].forEach(([value,label,kind],index)=>{
      const x=left+index*492;
      ctx.strokeStyle=colors.silver;ctx.lineWidth=1;ctx.beginPath();ctx.arc(x+106,448,43,0,Math.PI*2);ctx.stroke();
      icon(kind,x+106,448,44,kind==="players"?colors.silver:colors.accent);
      text(String(value),x+302,463,fit(value,82,240),colors.accent,240,"center",600);
      text(label,x+302,501,29,colors.text,240,"center");
      if(!index)line(x+492,407,x+492,505,colors.border);
    });
    let cursor=HEADER;
    const boardIcon = id => id==="points"?"crown":id==="overall"?"swords":id?.includes("shield")?"shield":id?.includes("assassin")?"moon":"sword";
    for(const section of card.sections) {
      const top=cursor;line(left,top,right,top,colors.accent);
      icon(section.type==="featured"?"star":boardIcon(section.id),left+30,top+41,44);
      if(section.type==="featured") {
        text(section.title,left+78,top+55,43,colors.text,650,"left",600);
        text("按次数排名 · 每榜前三",right,top+52,24,colors.muted,320,"right");
      } else {
        const heading=section.title.split(" TOP 3")[0];font(44,600,true);
        const titleWidth=Math.min(ctx.measureText(heading).width,440);
        text(heading,left+78,top+55,44,colors.text,440,"left",600);
        text("TOP 3"+(section.title.includes("续")?" · 续":""),left+92+titleWidth,top+55,42,colors.accent,230,"left",600);
        text(section.subtitle,right,top+52,24,colors.muted,350,"right");
      }
      line(left,top+78,right,top+78,colors.accent);
      if(section.type==="featured") {
        const columnWidth=inner/section.boards.length;
        section.boards.forEach((board,index)=>{
          const x=left+index*columnWidth+22,width=columnWidth-44;
          if(index)line(x-22,top+100,x-22,top+sectionHeight(section)-20,colors.border);
          icon(boardIcon(board.id),x+24,top+119,44);
          text(board.title,x+70,top+122,31,colors.accent,width-66,"left",600);
          text(board.subtitle,x+70,top+153,22,colors.muted,width-66);
          board.rows.forEach((row,i)=>{
            const y=top+196+i*52;
            text(row.rank,x+4,y,30,rankColor(row.rank),32,"left",600);
            text(row.name,x+58,y,29,colors.text,Math.max(70,width-142),"left",500);
            text(row.value+" "+board.unit,x+width,y,fit(row.value+" "+board.unit,30,85),colors.text,85,"right");
            if(i<board.rows.length-1)line(x,y+13,x+width,y+13,colors.border);
          });
        });
      } else {
        const step=rowHeight(section),compact=section.id==="overall";
        if(!section.rows.length)text(section.emptyHint||"暂无公开成绩",left+30,top+144,30,colors.muted);
        section.rows.forEach((row,index)=>{
          const y=top+88+index*step,cy=y+step/2;
          laurel(row.rank,left+58,cy-3,row.tied);avatar(row,left+197,cy-2,compact?39:46);
          text(row.name,left+284,cy+(compact?13:-1),42,colors.text,compact?175:354,"left",600);
          if(compact)text(row.secondary,left+471,cy+13,26,colors.muted,224);
          else text(row.secondary,left+284,cy+35,26,colors.muted,555);
          const result=row.value+section.unit;
          text(result,right-12,cy+17,fit(result,compact?60:68,300),row.rank===1?colors.accent:colors.text,300,"right",600);
          if(index<section.rows.length-1)line(left,y+step-2,right,y+step-2,colors.border);
        });
      }
      cursor+=sectionHeight(section);
    }
    line(left,cursor,right,cursor,colors.border);
    text("统计范围：北京时间 "+card.range,left,cursor+44,22,colors.muted,720);
    text("榜单仅展示已公开玩家 · 趣味榜仅统计完整记录",left,cursor+79,22,colors.muted,850);
    text("截至 "+card.asOf,left,cursor+112,21,colors.muted,760);
    text(card.page+"/"+card.pages,right,cursor+112,22,colors.accent,190,"right");
    text("在桌边，遇见更好的朋友",left,cursor+182,29,colors.accent,650);
    line(left+365,cursor+173,right-270,cursor+173,colors.border);
    text("桌边助手 · ShadowTable",right,cursor+172,22,colors.text,275,"right");
    text("GOOD PLAYERS  BETTER STORIES",right,cursor+196,12,colors.muted,275,"right",400,false);
  }
  return { cards, dimensions, describe, drawCard, imagePaths, BACKGROUND_PATH, MAX_HEIGHT };
});
