(function(root,factory){
  if(typeof module === "object" && module.exports)module.exports=factory(require("../../poster-canvas"));
  else root.shadowtablePersonalityPoster=factory(root.shadowtablePosterCanvas);
})(typeof window === "object" ? window : this,function(canvas){
  "use strict";
  const QR="/pages/personality/assets/miniprogram-qrcode.jpg";
  const WIDTH=1080,HEIGHT=1560;
  function imagePaths(card){return [card.view.portrait,QR];}
  function imageKey(view) {
    return view ? JSON.stringify([view.roleName,view.english,view.typeId,view.portrait,view.title,view.description,view.styleNote,view.summary,view.tendencyLabel]) : "";
  }
  function drawCard(ctx,card,avatar,images){
    images=images||new Map();
    const v=card.view,p=canvas.painter(ctx),colors=canvas.colors;
    const art=images.get(v.portrait);
    if(!art?.width || !art.height)throw new Error("角色图片未能读取，请重试生成。");
    p.rect(0,0,WIDTH,HEIGHT,colors.bg);p.brand("阿瓦隆 · 十六人格");
    const background=ctx.createRadialGradient?.(540,465,40,540,465,620);
    background?.addColorStop(0,"#3b3a2a");
    background?.addColorStop(.52,"#232e2c");
    background?.addColorStop(1,"#172832");
    p.round(72,132,936,1010,48,"#68644c");
    p.round(74,134,932,1006,46,background||"#232e2c");
    p.text("阿瓦隆十六人格",540,187,28,colors.gold,850,"center",500);
    ctx.strokeStyle="rgba(229,198,139,.22)";ctx.lineWidth=2;
    for(const radius of [246,218]){
      ctx.beginPath();ctx.arc(540,498,radius,0,Math.PI*2);ctx.stroke();
    }
    const factor=Math.min(470/art.width,470/art.height);
    const w=art.width*factor,h=art.height*factor;
    ctx.drawImage(art,540-w/2,498-h/2,w,h);
    p.text(v.roleName+"   "+v.english,540,769,30,colors.gold,850,"center",500);
    p.text(v.title,540,826,72,colors.text,850,"center",600);
    const summary=canvas.wrap(v.styleNote||v.description||v.summary,31,770);
    if(summary.length>1 && Array.from(summary[summary.length-1]).length<8){
      const tail=Array.from(summary.splice(-2).join("")),middle=Math.ceil(tail.length/2);
      summary.push(tail.slice(0,middle).join(""),tail.slice(middle).join(""));
    }
    p.lines(summary,540,933,31,"#d4dfda",800,49,400,"center");
    p.text(v.typeId+"  ·  角色倾向"+(v.tendencyLabel==="混合倾向"?"混合":v.tendencyLabel),540,1080,24,colors.muted,850,"center");
    const qr=images.get(QR);
    const hasCode=qr?.width&&qr.height;
    if(hasCode){p.round(790,1210,210,210,24,"#fff");ctx.drawImage(qr,800,1220,190,190);}
    p.text("你习惯怎样看人、站边和藏身份？",72,1226,29,colors.text,680);
    p.text("探索你的牌桌决策风格",72,1285,27,colors.muted,680);
    p.text((hasCode?"扫码打开":"打开")+"桌边助手 → 我的 → 人格",72,1352,23,colors.gold,680);
    p.text("本次选择的相对偏好，不代表能力或固定人格。",540,1470,22,colors.muted,930,"center");
  }
  return {imagePaths,imageKey,drawCard,renderDimensions:()=>({width:WIDTH,height:HEIGHT,scale:1})};
});
