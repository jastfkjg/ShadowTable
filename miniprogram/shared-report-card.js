// Export the displayed B report snapshot.
const { painter, wrap } = require("./poster-canvas");
const BRAND = "/assets/home-wordmark.png";
const C = { bg:"#101c24", surface:"#172831", text:"#f4ead7", muted:"#b0c3cf", gold:"#e8c780", line:"rgba(177,191,198,.13)", good:"#a3dfbe", evil:"#f2b6ae", third:"#8ab8d9" };
function layout(card) {
  const width = Math.max(320, Math.min(430, card.reportWidth || 390));
  const inset = width <= 350 ? 16 : 20, padding = width <= 350 ? 14 : 17;
  const x = inset + 1 + padding, inner = width - x * 2;
  const name = wrap(card.name, 13, inner - 33);
  let y = 20 + 22 + 37 + 7 + 36.4 + 11;
  const ownerTop = y, ownerH = Math.max(26, name.length * 19.5);
  y += ownerH + 7;
  const scopeTop = y;
  y += 19.8 + 8;
  const sealTop = y;
  y += 218 + 9 + 17;
  const metricTop = y, stacked = card.metrics[0].value.length > 6 || card.metrics[2].value.length > 6;
  const values = card.metrics.map((row,i) => wrap(row.value + (stacked ? i===0?" 局":i===2?" 分":"" : ""), stacked ? 24 : width <= 350 ? 22 : 26, stacked ? inner : inner / 3 - 8));
  y += stacked ? values.reduce((sum, lines) => sum + lines.length * 29 + 21, 0) + 24 : 76;
  const factions = [];
  if (card.factions.length) {
    y += 20;
    const top = y; y += 22.4 + 15;
    for (let i = 0; i < card.factions.length; i += 2) {
      const count = Math.min(2, card.factions.length - i), column = (inner - (count - 1) * 22) / count;
      for (let j = 0; j < count; j++) factions.push({ ...card.factions[i+j], x:x+j*(column+22), y, width:column });
      y += 93 + (i + 2 < card.factions.length ? 20 : 0);
    }
    factions.headingY = top;
  }
  const roles = [];
  if (card.roles.length) {
    y += 20;
    const top = y; y += 22.4 + 15;
    const perRow = width <= 350 ? 2 : 4, gap = perRow === 2 ? 10 : 7;
    for (let i = 0; i < card.roles.length; i += perRow) {
      const count = Math.min(perRow, card.roles.length - i);
      const column = Math.min(inner / perRow, (inner - gap * (count - 1)) / count);
      const left = (width - (column * count + gap * (count-1))) / 2;
      const fontSize = width <= 350 ? 11 : 12;
      const rows = card.roles.slice(i,i+count).map(row => ({ ...row, nameLines:wrap(row.role,fontSize,column) }));
      const nameH = Math.max(34,...rows.map(row => row.nameLines.length * 16.8));
      rows.forEach((row,j) => roles.push({ ...row, x:left+j*(column+gap), y, width:column, nameH, fontSize }));
      y += 68 + 5 + nameH + 5 + 23.4 + 2 + 17.6 + 2 + 17.6 + (i + perRow < card.roles.length ? 18 : 0);
    }
    roles.headingY = top;
  }
  const endTop = y + 22, bottom = endTop + 2 + 23;
  const stampTop = bottom + 18, height = Math.ceil(stampTop + 17.6 + 24);
  return { width,inset,x,inner,height,name,ownerTop,ownerH,scopeTop,sealTop,metricTop,values,stacked,factions,roles,endTop,bottom,stampTop };
}
function imagePaths(card) { return [...new Set([BRAND,card.avatar,...card.roles.map(row => row.portrait)].filter(Boolean))]; }
function renderDimensions(card) {
  const b = layout(card), scale = 1080 / b.width;
  return { width:1080, height:Math.ceil(b.height * scale), scale };
}
function drawCard(ctx, card, avatar, images = new Map()) {
  const b = layout(card), p = painter(ctx), cx = b.width / 2;
  const text = (value,x,y,size=12,color=C.text,limit=b.inner,align="left",weight=400,serif=false) => p.text(value,x,y,size,color,limit,align,weight,serif);
  const line = (x,y,end,color=C.line,weight=1) => p.line(x,y,end,color,weight);
  const tracked = (value,y,size,spacing,color,serif=false) => {
    p.font(size,600,serif);
    const chars=Array.from(value), widths=chars.map(char=>ctx.measureText(char).width);
    let x=cx-(widths.reduce((sum,width)=>sum+width,0)+spacing*(chars.length-1))/2;
    chars.forEach((char,i)=>{text(char,x,y,size,color,b.inner,"left",600,serif);x+=widths[i]+spacing;});
  };
  const value = (main,unit,x,y,size,us,color=C.text,limit=b.inner) => {
    p.font(size,600);const mw=ctx.measureText(String(main)).width;
    p.font(us);const uw=unit?ctx.measureText(unit).width+3:0;
    const total=mw+uw, scale=Math.min(1,limit/Math.max(1,total));
    const left=x-total*scale/2;
    text(main,left,y,size*scale,color,limit,"left",600);
    if(unit)text(unit,left+mw*scale+3,y+(size-us)*scale*.85,us*scale,color,limit);
  };
  p.rect(0,0,b.width,b.height,C.bg);
  p.round(b.inset,20,b.width-b.inset*2,b.bottom-20,25,C.surface);
  ctx.strokeStyle="rgba(229,198,139,.22)";ctx.lineWidth=1;ctx.stroke();
  for(const right of [false,true]){
    const edge=right?b.width-b.inset-16:b.inset+16, d=right?-1:1;
    ctx.strokeStyle="rgba(229,198,139,.35)";ctx.beginPath();ctx.moveTo(edge,60);ctx.lineTo(edge,43);
    ctx.quadraticCurveTo(edge,36,edge+d*7,36);ctx.lineTo(edge+d*24,36);ctx.stroke();
  }
  const brand=images.get(BRAND);
  if(brand?.width)ctx.drawImage(brand,cx-55,42,110,37);
  else text("桌边助手",cx,44,24,C.text,b.inner,"center",600);
  tracked("阿瓦隆 · 圆桌战报",86,b.width<=350?23:26,b.width<=350?1:3,C.text,true);
  p.font(13,600);const nameWidth=Math.max(...b.name.map(row=>ctx.measureText(row).width)), groupWidth=Math.min(b.inner,33+nameWidth);
  const ownerX=cx-groupWidth/2, avatarY=b.ownerTop+(b.ownerH-26)/2;
  ctx.save();p.round(ownerX,avatarY,26,26,9,C.bg);ctx.clip();
  if(avatar?.width&&avatar?.height){const side=Math.min(avatar.width,avatar.height);ctx.drawImage(avatar,(avatar.width-side)/2,(avatar.height-side)/2,side,side,ownerX,avatarY,26,26);}
  else text(card.initial,ownerX+13,avatarY+3,14,C.gold,24,"center");
  ctx.restore();
  p.lines(b.name,ownerX+33,b.ownerTop+(b.ownerH-b.name.length*19.5)/2,13,C.text,b.inner-33,19.5,600);
  text(card.scope,cx,b.scopeTop,11,C.muted,b.inner,"center");
  const cy=b.sealTop+109;
  for(const [radius,opacity,dash]of [[96,.13,[]],[87,.28,[2,8]]]){ctx.strokeStyle=`rgba(232,199,128,${opacity})`;ctx.lineWidth=1;ctx.setLineDash?.(dash);ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();}
  ctx.setLineDash?.([]);ctx.strokeStyle="rgba(232,199,128,.5)";
  const path=points=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(cx+x,cy+y):ctx.moveTo(cx+x,cy+y));ctx.stroke();};
  path([[0,-105],[0,-87]]);path([[-5,-96],[5,-96]]);path([[0,87],[0,105]]);path([[-5,96],[5,96]]);
  for(const sign of [-1,1]){
    ctx.fillStyle=C.gold;ctx.beginPath();ctx.moveTo(cx+sign*92-5,cy);ctx.lineTo(cx+sign*92,cy-5);ctx.lineTo(cx+sign*92+5,cy);ctx.lineTo(cx+sign*92,cy+5);ctx.closePath();ctx.fill();
    path([[sign*79,54],[sign*90,36],[sign*95,14],[sign*95,-20]]);
    for(const [x,y,dx,dy]of [[85,42,13,-5],[89,31,12,-7],[91,18,12,-10],[91,4,10,-12]])path([[sign*x,y],[sign*(x+dx),y+dy]]);
  }
  tracked(card.heroLabel,cy-43,12,4,C.muted);
  value(card.hero,card.unit,cx,cy-20,Math.min(58,b.width*.15),24,C.gold,200);
  text(card.resultLabel,cx,cy+51,12,C.muted,b.inner,"center");
  if(b.stacked){
    let top=b.metricTop;
    card.metrics.forEach((row,i)=>{p.lines(b.values[i],b.x,top,24,i===2?C.gold:C.text,b.inner,29,600);top+=b.values[i].length*29;text(i===0?"累计对局":row.label,b.x,top+4,11,C.muted);top+=21;});
    line(b.x,top+24,b.width-b.x);
  } else {
    const column=b.inner/3;
    card.metrics.forEach((row,i)=>{
      const x=b.x+column*(i+.5),size=b.width<=350?22:26;
      value(row.value,i===0?"局":i===2?"分":"",x,b.metricTop,size,12,i===2?C.gold:C.text,column-8);
      text(i===0?"累计对局":row.label,x,b.metricTop+38,11,C.muted,column-6,"center");
      if(i){ctx.strokeStyle=C.line;ctx.beginPath();ctx.moveTo(b.x+column*i,b.metricTop);ctx.lineTo(b.x+column*i,b.metricTop+54);ctx.stroke();}
    });
    line(b.x,b.metricTop+76,b.width-b.x);
  }
  const heading=(label,note,top)=>{text(label,b.x,top,14,C.text,b.inner,"left",600);text(note,b.width-b.x,top+2,11,C.muted,b.inner,"right");};
  if(b.factions.length)heading("阵营表现","胜场 / 局数",b.factions.headingY);
  b.factions.forEach(row=>{
    const color=C[row.faction]||C.third;
    if(["good","evil"].includes(row.faction))p.icon(row.faction==="good"?"shield":"swords",row.x,row.y+1,16,color);
    text(row.label,row.x+(["good","evil"].includes(row.faction)?21:0),row.y,12,C.text,row.width);
    text(row.rate,row.x,row.y+26,26,C.text,row.width,"left",600);
    p.round(row.x,row.y+65,row.width,4,2,C.line);
    const ratio=Math.max(0,Math.min(1,(row.winRate||0)/100));if(ratio)p.round(row.x,row.y+65,row.width*ratio,4,2,color);
    text(`${row.wins} 胜 / ${row.total} 局`,row.x,row.y+74,11,C.muted,row.width);
  });
  if(b.roles.length)heading("常玩角色",`按对局数 · 前 ${card.roles.length} 位`,b.roles.headingY);
  b.roles.forEach(row=>{
    const x=row.x+row.width/2,art=images.get(row.portrait),side=Math.min(60,row.width);
    if(art?.width){const scale=Math.min(side/art.width,68/art.height);ctx.drawImage(art,x-art.width*scale/2,row.y+(68-art.height*scale)/2,art.width*scale,art.height*scale);}
    p.lines(row.nameLines,x,row.y+73,row.fontSize,C.text,row.width,16.8,500,"center");
    const top=row.y+73+row.nameH+5;
    text(row.rate,x,top,b.width<=350?17:18,C.gold,row.width,"center",600);
    text(`${row.total} 局`,x,top+25.4,11,C.muted,row.width,"center");
    text(`${row.wins} 胜 ${row.losses} 负`,x,top+45,11,C.muted,row.width,"center");
  });
  line(cx-17.5,b.endTop,cx+17.5,C.gold,2);
  text("数据截至 "+card.asOf,cx,b.stampTop,11,C.muted,b.inner,"center");
}
module.exports = { layout, imagePaths, renderDimensions, drawCard };
