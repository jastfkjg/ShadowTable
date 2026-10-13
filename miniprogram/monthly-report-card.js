(function (root, factory) {
  const value = factory(typeof module === "object" && module.exports ? require("./monthly-report") : root.shadowtableMonthlyReport);
  if (typeof module === "object" && module.exports) module.exports = value;
  else root.shadowtableMonthlyCard = value;
})(typeof window === "object" ? window : this, function (presentation) {
  const WIDTH = 1080, MAX_HEIGHT = 3600, HEADER = 676, FOOTER = 172;
  const BACKGROUND_PATH = "/assets/monthly-report-background.jpg";
  const colors = { bg: "#0e2028", surface: "#1b313b", text: "#f5f0e6", muted: "#adc1cc", accent: "#efd091", border: "#557079", silver: "#a9c2ce", bronze: "#bf9278" };
  const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  const rowProjection = row => ({ rank: row.rank, tied: row.tied, name: clean(row.nickname) || "新朋友", avatar: /^\/api\/avatars\/[a-f0-9]{64}$/.test(row.avatarUrl || "") ? row.avatarUrl : "",
    value: clean(row.value), secondary: clean(row.secondaryLabel) });
  const rowHeight = section => section.type === "honor" ? 90 : 152;
  function sectionHeight(section) {
    return 154 + section.rows.length * rowHeight(section) + (section.showGroupTitle ? 100 : 0);
  }
  function imagePaths(card) {
    return [...new Set([BACKGROUND_PATH, ...card.sections.filter(section => section.type === "board").flatMap(section => section.rows.map(row => row.avatar))].filter(Boolean))];
  }
  function cards(response, entertainment = false) {
    const report = presentation.presentReport(response);
    if (!report.canShare) throw new Error("这个月还没有有效对局，暂时无法生成月报图片。");
    const sections = report.coreBoards.map(board => ({ type: "board", id: board.id, title: board.title, subtitle: board.subtitle, unit: board.unit, rows: board.rows.map(rowProjection) }));
    const featured = entertainment ? presentation.detailBoards(report, "count", true).slice(0, 3) : report.featured;
    for (const board of featured) sections.push({ type: "honor", id: board.metric, title: board.title, subtitle: [board.roleLabel, board.label].filter(Boolean).join(" · "), unit: board.unit,
      groupTitle: entertainment ? "本月娱乐榜" : "本月趣味荣誉", rows: board.rows.map(rowProjection) });
    const metadata = { kind: "monthly", title: entertainment ? "月度战报 · 娱乐版" : "月度战报", month: report.monthTitle, range: report.rangeLabel,
      asOf: report.asOfLabel, overview: { games: report.overview.games, players: report.overview.players } };
    const pages = []; let current = { ...metadata, sections: [] }, used = HEADER + FOOTER;
    const flush = () => { pages.push(current); current = { ...metadata, sections: [] }; used = HEADER + FOOTER; };
    for (const section of sections) {
      // Reserve the repeated honor heading even when the first chunk follows a main board.
      const maximumRows = Math.floor((MAX_HEIGHT - HEADER - FOOTER - 154 - (section.type === "honor" ? 100 : 0)) / rowHeight(section));
      for (let offset = 0; offset < section.rows.length; offset += maximumRows) {
        const chunk = { ...section, continued: offset > 0, rows: section.rows.slice(offset, offset + maximumRows),
          showGroupTitle: section.type === "honor" && !current.sections.some(item => item.type === "honor") };
        if (used + sectionHeight(chunk) > MAX_HEIGHT && current.sections.length) {
          flush(); chunk.showGroupTitle = section.type === "honor";
        }
        current.sections.push(chunk); used += sectionHeight(chunk);
      }
    }
    flush();
    return pages.map((page, index) => ({ ...page, page: index + 1, pages: pages.length }));
  }
  function dimensions(card) {
    return { width: WIDTH, height: HEADER + card.sections.reduce((height, section) => height + sectionHeight(section), 0) + FOOTER };
  }
  function describe(card) {
    return [card.month + " " + card.title, "第 " + card.page + " / " + card.pages + " 张", ...card.sections.flatMap(section =>
      [section.title, ...section.rows.map(row => (row.tied ? "并列" : "") + "第" + row.rank + "名 " + row.name + " " + row.value + section.unit)])].join("，");
  }
  function drawCard(ctx, card, avatars = new Map()) {
    const { height } = dimensions(card), left = 60, right = 1020, inner = right - left;
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
      ctx.drawImage(artwork,0,artwork.height*.25,artwork.width,artwork.height*.55,0,490,WIDTH,height-790);
      ctx.drawImage(artwork,0,0,artwork.width,artwork.height*.25,0,0,WIDTH,490);
      ctx.drawImage(artwork,0,artwork.height*.80,artwork.width,artwork.height*.20,0,height-300,WIDTH,300);
      rect(0,0,WIDTH,490,gradient(ctx.createLinearGradient(0,0,WIDTH,0),[[0,"rgba(14,32,40,.65)"],[.45,"rgba(14,32,40,.20)"],[.73,"rgba(14,32,40,0)"]],"transparent"));
      rect(0,410,WIDTH,80,gradient(ctx.createLinearGradient(0,410,0,490),[[0,"rgba(14,32,40,0)"],[1,colors.bg]],"transparent"));
      rect(0,height-300,WIDTH,300,gradient(ctx.createLinearGradient(0,height-300,0,height),[[0,"rgba(14,32,40,0)"],[.35,"rgba(14,32,40,.20)"],[1,"rgba(14,32,40,.12)"]],"transparent"));
    } else {
      icon("moon",738,112,58);
      for(const [x,y] of [[643,60],[836,128],[940,202]])icon("star",x,y,10);
    }
    text("桌边助手 · ShadowTable",left,80,32,colors.text,700);
    text(card.month,left,212,84,colors.accent,540);
    text(card.title,left,350,card.title.length>6?76:112,colors.text,960,"left",600);
    text(card.range.slice(5).replace(/—20\d{2}\./," — "),left,428,26,colors.muted,680,"left",400,false);
    line(left,490,right,490,colors.accent);
    [[card.overview.games,"有效对局"],[card.overview.players,"参赛玩家"]].forEach(([value,label],index)=>{
      const x=left+index*480;
      text(String(value),x+185,613,fit(value,96,170),colors.accent,170,"right");
      text(label,x+215,600,30,colors.muted,235,"left",500,false);
      if(!index)line(x+480,530,x+480,628,colors.border);
    });
    line(left,HEADER-2,right,HEADER-2,colors.border);
    let cursor=HEADER;
    const boardIcon = id => id==="points"?"crown":id==="overall"?"swords":id?.includes("shield") || id?.startsWith("defense_")?"shield":id?.includes("assassin")?"moon":"sword";
    const drawValue = (row, unit, y, size = 70) => {
      text(unit,right,y-1,28,colors.muted,42,"right",400,false);
      text(row.value,right-44,y,fit(row.value,size,212,24),row.rank===1?colors.accent:colors.text,212,"right");
    };
    for(const section of card.sections) {
      let top=cursor;
      if(section.showGroupTitle) {
        icon("star",left+25,top+47,44);
        text(section.groupTitle,left+73,top+63,50,colors.text,650,"left",600);
        text("按次数 · 每榜前三",right,top+60,24,colors.accent,285,"right",400,false);
        top+=100;
      }
      if(section.type==="honor") {
        ctx.strokeStyle="#717663"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(left+46,top+62,44,0,Math.PI*2); ctx.stroke();
        icon(boardIcon(section.id),left+46,top+62,50);
        text(section.title+(section.continued?" · 续":""),left+126,top+60,50,colors.accent,inner-126,"left",600);
        text(section.subtitle,left+126,top+102,28,colors.muted,inner-126,"left",400,false);
        section.rows.forEach((row,index)=>{
          const y=top+174+index*90;
          text(String(row.rank).padStart(2,"0"),left+126,y,34,rankColor(row.rank),56);
          text(row.name,left+200,y,46,colors.text,row.tied?410:495,"left",500,false);
          if(row.tied) {
            font(46,500,false);
            const nameWidth=Math.min(ctx.measureText(row.name).width,410);
            text("并列",left+218+nameWidth,y-3,24,colors.muted,70,"left",400,false);
          }
          drawValue(row,section.unit,y,66);
        });
        line(left,cursor+sectionHeight(section)-1,right,cursor+sectionHeight(section)-1,colors.border);
      } else {
        icon(boardIcon(section.id),left+25,top+55,44);
        text(section.title,left+73,top+73,52,colors.text,inner-240,"left",600);
        text("TOP 3"+(section.continued?" · 续":""),right,top+65,26,colors.accent,220,"right",400,false);
        text(section.subtitle,left+73,top+111,26,colors.muted,inner-73,"left",400,false);
        section.rows.forEach((row,index)=>{
          const y=top+134+index*152,cy=y+76;
          if(row.rank===1) rect(left,y,inner,152,"rgba(229,198,139,.035)");
          laurel(row.rank,left+40,cy-1,false); avatar(row,left+161,cy-1,46);
          text(row.name,left+240,cy-4,46,colors.text,row.tied?365:450,"left",600,false);
          if(row.tied) {
            font(46,600,false);
            const nameWidth=Math.min(ctx.measureText(row.name).width,365);
            text("并列",left+258+nameWidth,cy-7,23,colors.muted,70,"left",400,false);
          }
          text(row.secondary,left+240,cy+36,26,colors.muted,440,"left",400,false);
          drawValue(row,section.unit,cy+20,74);
          if(index<section.rows.length-1)line(left,y+151,right,y+151,colors.border);
        });
      }
      cursor+=sectionHeight(section);
    }
    // The footer is a signature, without statistical/disclosure copy.
    text("在桌边，遇见更好的朋友",left,cursor+112,33,colors.accent,650);
    text("桌边助手",right,cursor+91,28,colors.text,240,"right");
    text("ShadowTable",right,cursor+128,23,colors.muted,240,"right");
    if(card.pages>1)text(card.page+" / "+card.pages,right,cursor+37,23,colors.muted,180,"right",400,false);

  }
  return { cards, dimensions, describe, drawCard, imagePaths, BACKGROUND_PATH, MAX_HEIGHT };
});
