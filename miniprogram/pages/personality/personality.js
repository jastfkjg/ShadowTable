const api = require("../../api");
const flow = require("./flow");
const { renderImage } = require("../../share-image");
const poster = require("./poster");
const dialog = require("../../dialog");
const { backToMe } = require("../../profile");
const { isSinglePage } = require("../../records-share");
Page({
  data:{mode:"intro",loading:true,result:null,error:"",singlePage:false,imagePath:"",rendering:false,imageError:"",albumDenied:false,sharePanel:false},
  onLoad(options={}) {
    this.alive=true;this.options=options;const singlePage=isSinglePage();
    this.lastCredential=singlePage?"":wx.getStorageSync("session")||"";
    this.setData({singlePage});
    this.flow=flow.create({
      login:()=>api.login(),request:(...args)=>api.request(...args),requestId:()=>api.requestId(),credential:()=>wx.getStorageSync("session")||"",
      publicRequest:path=>new Promise((resolve,reject)=>wx.request({url:api.assetUrl(path),method:"GET",timeout:10000,
        success:r=>r.statusCode===200?resolve(r.data):reject(Object.assign(new Error(r.data?.error||"分享暂时无法读取"),{status:r.statusCode})),
        fail:()=>reject(new Error("分享暂时无法读取，请检查网络后重试"))})),
      storage:{get:key=>wx.getStorageSync(key),set:(key,value)=>wx.setStorageSync(key,value),remove:key=>wx.removeStorageSync(key)},
      onChange:state=>{
        if(!this.alive)return;
        const changedQuestion=state.question?.id!==this.data.question?.id,changedMode=state.mode!==this.data.mode;
        const changedResult=state.result?.typeId!==this.data.result?.typeId || state.record?.id!==this.data.record?.id;
        this.setData({...state,...(changedResult?{imagePath:"",imageError:"",sharePanel:false}:{})});
        if(changedResult)this.imageEpoch=(this.imageEpoch||0)+1;
        if(changedQuestion||changedMode)wx.pageScrollTo?.({scrollTop:0,duration:0});
        if(state.mode==="quiz")wx.hideShareMenu?.();
        else if(!this.data.singlePage)wx.showShareMenu?.({menus:["shareAppMessage","shareTimeline"]});
      },
    });
    if(singlePage&&!options.share){this.setData({loading:false,mode:"shared",error:"打开小程序，探索你的阿瓦隆人格。"});return;}
    return this.flow.load(options).then(()=>{this.lastCredential=singlePage?"":wx.getStorageSync("session")||"";});
  },
  onReady(){this.canvasReady=true;},
  onShow(){
    if(!this.flow||this.data.singlePage||this.options?.share)return;
    const credential=wx.getStorageSync("session")||"";
    if(credential!==this.lastCredential&&!this.data.loading){this.lastCredential=credential;return this.flow.load();}
  },
  onHide(){if(this.data.mode==="quiz")this.flow?.persist();},
  onUnload(){this.alive=false;this.flow?.dispose();this.imageEpoch=(this.imageEpoch||0)+1;},
  retry(){if(this.data.singlePage&&!this.options?.share)return;return this.flow.load(this.options);},
  start(){return this.flow.start();},
  answer(event){this.flow.answer(event.currentTarget.dataset.id);},
  next(){return this.flow.next();},
  previous(){this.flow.previous();},
  rules(){this.flow.toggle("rulesOpen");},
  details(){this.flow.toggle("detailsOpen");},
  catalogue(){this.flow.toggle("catalogueOpen");},
  retrySave(){return this.flow.save();},
  retryLocalSave(){this.flow.persist();},
  openHistory(event){return this.flow.openResult(event.currentTarget.dataset.id);},
  async retest(){
    if(this.data.saving||this.data.sharing)return;
    const result=await dialog.show({title:"重新测试？",content:this.data.hasDraft?"将开始一份新答卷，替换本机尚未完成的进度。已保存的账号结果仍会保留。":"将开始一份新答卷，已保存的结果和分享卡仍会保留。",confirmText:"开始新测试"});
    if(result.confirm&&this.alive)this.flow.start(true);
  },
  async testMine(){
    if(this.data.singlePage)return;
    this.options={};await this.flow.load();if(this.alive&&!this.data.error)this.flow.start();
    this.lastCredential=wx.getStorageSync("session")||"";
  },
  back(){
    if(this.data.mode==="quiz"){this.flow.persist();this.flow.intro();return;}
    return backToMe();
  },
  async prepareShare(){
    const shared=await this.flow.share();if(shared&&this.alive){this.setData({sharePanel:true});wx.showShareMenu?.({menus:["shareAppMessage","shareTimeline"]});}
  },
  async prepareImage(){
    if(!this.alive||!this.canvasReady||!this.data.result||this.data.rendering)return null;
    if(this.data.imagePath)return this.data.imagePath;
    const at=this.imageEpoch=(this.imageEpoch||0)+1;
    this.setData({rendering:true,imageError:"",albumDenied:false});
    try{
      const path=await renderImage(this,{view:this.data.result},{renderer:poster,selector:"#personality-canvas"});
      if(this.alive&&at===this.imageEpoch&&path){this.setData({imagePath:path});return path;}
    }catch(error){if(this.alive&&at===this.imageEpoch)this.setData({imageError:error.message});}
    finally{if(this.alive)this.setData({rendering:false});}
    return null;
  },
  async saveImage(){
    if(this.data.rendering||this.data.singlePage)return;
    const path=await this.prepareImage();if(!path||!this.alive)return;
    wx.saveImageToPhotosAlbum({filePath:path,
      success:()=>{if(this.alive)wx.showToast?.({title:"已保存到相册",icon:"success"});},
      fail:error=>{if(!this.alive||/cancel/i.test(error.errMsg||""))return;const denied=/auth|denied|authorize/i.test(error.errMsg||"");this.setData({albumDenied:denied,imageError:denied?"保存需要相册权限，可在设置中开启。":"图片保存失败，请重试。"});},
    });
  },
  albumSettings(){wx.openSetting({success:r=>{if(this.alive&&r.authSetting?.["scope.writePhotosAlbum"])this.setData({albumDenied:false,imageError:"权限已开启，请再次保存图片。"});}});},
  onShareAppMessage(){
    const shared=this.data.shared;
    return {title:shared?"我是"+shared.view.title+"，你是哪种阿瓦隆人格？":"28 个情境，探索你的阿瓦隆人格",path:"/pages/personality/personality"+(shared?"?share="+shared.id:""),imageUrl:shared?.view.portrait||"/assets/roles/merlin.png"};
  },
  onShareTimeline(){const content=this.onShareAppMessage();return {title:content.title,query:this.data.shared?"share="+this.data.shared.id:"",imageUrl:content.imageUrl};},
});
