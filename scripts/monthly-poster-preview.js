// Project the same monthly bitmap into the browser previews of native pages.
const fs = require("node:fs");
const path = require("node:path");
const renderer = require("../miniprogram/monthly-report-card");
const monthly = require("../miniprogram/monthly-report");
const avatars = require("../miniprogram/builtin-avatars");
const root = path.resolve(__dirname, "../miniprogram");
const library = ["fun-copy.js", "monthly-report.js", "poster-canvas.js", "monthly-report-card.js"]
  .map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const urls = Object.fromEntries(avatars.map(item => ["/api/avatars/" + item.hash, "/miniprogram" + item.path]));
urls[renderer.BACKGROUND_PATH] = "/miniprogram" + renderer.BACKGROUND_PATH;
const placeholder = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
function homeData(response) {
  const report = monthly.presentReport(response);
  const card = report.canShare && renderer.cardFromReport(report);
  return { month:report.month, report, navTop:68, loading:false, imagePath:card ? placeholder : "",
    targets:card ? renderer.playerTargets(card, report) : [], description:card ? renderer.describe(card) : "" };
}
function posterScript(response, selector) {
  if (!response) return "<script>window.posterReady=true;</script>";
  return `<script>${library}</script><script>(async()=>{
    const renderer=window.shadowtableMonthlyCard, card=renderer.cards(${JSON.stringify(response).replace(/</g,"\\u003c")})[0];
    const urls=${JSON.stringify(urls)};
    const images=new Map(await Promise.all(renderer.imagePaths(card).map(path=>new Promise(resolve=>{
      const image=new Image(); image.onload=()=>resolve([path,image]); image.onerror=()=>resolve([path,null]); image.src=urls[path]||(path.startsWith("/assets/")?"/miniprogram"+path:path);
    }))));
    const canvas=document.createElement('canvas'), size=renderer.renderDimensions(card);
    Object.assign(canvas,{width:size.width,height:size.height});
    const context=canvas.getContext('2d'); context.scale(size.scale,size.scale); renderer.drawCard(context,card,images);
    const image=document.querySelector(${JSON.stringify(selector)});
    if(image){ image.src=canvas.toDataURL('image/png'); await image.decode(); } else document.body.appendChild(canvas);
    window.monthlyCard=card; window.monthlyLayout=renderer.layout(card); window.posterReady=true;
  })().catch(error=>{console.error(error);window.posterError=error.message;});</script>`;
}
module.exports = { homeData, posterScript, placeholder };
