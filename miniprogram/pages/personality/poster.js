(function(root,factory){
  if(typeof module === "object" && module.exports)module.exports=factory(require("../../poster-canvas"));
  else root.shadowtablePersonalityPoster=factory(root.shadowtablePosterCanvas);
})(typeof window === "object" ? window : this,function(canvas){
  "use strict";
  const QR="/pages/personality/assets/miniprogram-qrcode.jpg";
  const WIDTH=1080,HEIGHT=1560;
  function imagePaths(card){return [card.view.portrait,QR];}
  function drawCard(ctx,card,avatar,images){
    images=images||new Map();
    const v=card.view,p=canvas.painter(ctx),colors=canvas.colors;
    if(!images.get(v.portrait)?.width || !images.get(QR)?.width)throw new Error("角色图片或小程序码未能读取，请重试生成。");
    p.rect(0,0,WIDTH,HEIGHT,colors.bg);p.brand("阿瓦隆 · 十六人格");
    p.line(72,110,1008);p.text("我的阿瓦隆人格是",540,152,28,colors.muted,850,"center");
    p.text(v.roleName,540,208,v.roleName.length>5?65:80,colors.text,920,"center",600);
    p.text(v.english,540,312,28,colors.gold,850,"center",500);
    ctx.strokeStyle="rgba(229,198,139,.22)";ctx.lineWidth=2;ctx.beginPath();ctx.arc(540,595,215,0,Math.PI*2);ctx.stroke();
    const art=images.get(v.portrait);
    if(art?.width&&art?.height){const factor=Math.min(480/art.width,480/art.height);const w=art.width*factor,h=art.height*factor;ctx.drawImage(art,540-w/2,595-h/2,w,h);}
    p.text(v.title,540,856,64,colors.gold,920,"center",600);
    const summary=canvas.wrap(v.summary,31,870);
    if(summary.length>1 && Array.from(summary[summary.length-1]).length<8){
      const tail=Array.from(summary.splice(-2).join("")),middle=Math.ceil(tail.length/2);
      summary.push(tail.slice(0,middle).join(""),tail.slice(middle).join(""));
    }
    p.lines(summary,540,958,31,colors.text,900,49,400,"center");
    p.text(v.typeId+"  ·  "+v.tendencyLabel,540,1090,24,colors.muted,900,"center");
    p.line(72,1160,1008);
    const qr=images.get(QR);
    if(qr?.width&&qr?.height){p.round(790,1210,210,210,24,"#fff");ctx.drawImage(qr,800,1220,190,190);}
    p.text("你习惯怎样看人、站边和藏身份？",72,1226,29,colors.text,680);
    p.text("28 个情境，探索你的牌桌风格",72,1285,27,colors.muted,680);
    p.text("扫码打开桌边助手 → 我的 → 人格",72,1352,23,colors.gold,680);
    p.text("本次选择的相对偏好，不代表能力或固定人格。",540,1470,22,colors.muted,930,"center");
  }
  return {imagePaths,drawCard,renderDimensions:()=>({width:WIDTH,height:HEIGHT,scale:1})};
});
