const shares = require("../../records-share");
const api = require("../../api");
const { present } = require("../../shared-record-view");
const recordCover = require("../../record-share-cover");
const { renderImage } = require("../../share-image");
const reportCard = require("../../shared-report-card");
module.exports = function createSharedPage() { return {
  data: { loading: true, error: "", sharedRecord: null, intro: null, singlePage: false, authoring: false, posterAvailable: false,
    imagePath:"", rendering:false, acting:false, actionError:"", albumDenied:false, imageMenu:true },
  onLoad(options = {}) {
    this.alive = true;
    this.foreground = true;
    this.singlePage = shares.isSinglePage();
    this.setData({ imageMenu:typeof wx.showShareImageMenu === "function" && (!wx.canIUse || wx.canIUse("showShareImageMenu")) });
    this.shareId = options.share;
    if (options.share == null && shares.introFor(options.intro)) {
      this.introTab = options.intro;
      this.setData({ loading: false, intro: shares.introFor(options.intro), singlePage: this.singlePage });
      wx.setNavigationBarTitle?.({ title: this.data.intro.label });
      if (!this.singlePage) wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      return;
    }
    if (!this.shareId && !this.singlePage && ["stats", "match", "fun"].includes(options.kind)) {
      this.selection = options.kind === "stats" ? { kind: "stats" } : options.kind === "match" ? { kind: "match", match: options.match }
        : { kind: "fun", metric: options.metric, mode: options.mode };
      this.setData({ authoring: true, posterAvailable: options.kind === "stats" });
    }
    return this.loadSharedRecord();
  },
  onReady() {
    this.shareCanvasReady = true;
    recordCover.prepare(this, this.introTab || "records", this.snapshot);
    return this.prepareImage();
  },
  async loadSharedRecord() {
    if (this.fetching) return;
    this.fetching = true;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.snapshot = null;
    this.imageSequence = (this.imageSequence || 0) + 1;
    this.imageKey = "";
    this.setData({ loading: true, error: "", imagePath:"", rendering:false, actionError:"", albumDenied:false });
    if (!this.singlePage) wx.hideShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
    try {
      const snapshot = this.selection ? await shares.create(this.selection) : await shares.read(this.shareId);
      if (!this.alive || sequence !== this.sequence) return;
      if (!shares.validId(snapshot?.id)) throw new Error("分享内容暂时不可用，请重试。");
      const sharedRecord = present(snapshot, api.assetUrl);
      this.snapshot = snapshot;
      this.setData({ sharedRecord });
      recordCover.prepare(this, this.introTab || "records", snapshot);
      if (this.foreground) {
        wx.setNavigationBarTitle?.({ title: sharedRecord.pageTitle });
        if (!this.singlePage) wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
      }
    } catch (error) {
      if (this.alive && sequence === this.sequence) this.setData({ error: error.message,
        ...(error.status && error.status < 500 && ![401,429].includes(error.status) ? { sharedRecord:null } : {}) });
    } finally {
      this.fetching = false;
      if (this.alive && sequence === this.sequence) this.setData({ loading: false });
    }
    if (this.alive && sequence === this.sequence) return this.prepareImage();
  },
  retrySharedRecord() { if (!this.introTab) return this.loadSharedRecord(); },
  openPersonalRecords() {
    if (!this.alive || this.singlePage || !this.introTab || this.openingPersonal) return;
    this.openingPersonal = true;
    wx.redirectTo({ url: "/pages/stats/stats?tab=" + this.introTab,
      fail: () => { if (this.alive) wx.showToast?.({ title: "暂时无法打开，请重试", icon: "none" }); },
      complete: () => { this.openingPersonal = false; },
    });
  },
  onShow() {
    this.foreground = true;
    if (this.alive && (this.snapshot || this.introTab)) {
      wx.setNavigationBarTitle?.({ title: this.data.intro?.label || this.data.sharedRecord.pageTitle });
      if (!this.singlePage) wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
    }
  },
  onHide() { this.foreground = false; },
  sharedAvatarError() {
    if (this.data.sharedRecord?.avatar) {
      this.setData({ sharedRecord:{ ...this.data.sharedRecord, avatar:"" } });
      return this.prepareImage(true);
    }
  },
  prepareImage(force = false) {
    if (!this.alive || !this.shareCanvasReady || this.data.loading || !this.data.authoring || !this.data.posterAvailable || this.snapshot?.kind !== "stats") return null;
    const snapshot=this.snapshot, view={ ...this.data.sharedRecord, reportWidth:Math.min(430,Math.max(320,wx.getWindowInfo?.().windowWidth || 390)) };
    const key=JSON.stringify(view);
    if (!force && this.imageKey === key && (this.data.imagePath || this.data.rendering)) return this.imageRender;
    const sequence=this.imageSequence=(this.imageSequence || 0)+1;
    const current=()=>this.alive && this.snapshot === snapshot && this.imageSequence === sequence;
    this.imageKey=key;
    this.setData({ imagePath:"", rendering:true, actionError:"", albumDenied:false });
    // Serialize access to this page's export canvas, including retries and late snapshots.
    const previous=this.imageRender || Promise.resolve();
    this.imageRender=previous.catch(()=>null).then(async()=>{
      if (!current()) return null;
      try {
        const path=await renderImage(this,view,{renderer:reportCard,selector:"#shared-report-canvas"});
        if (current() && path) this.setData({imagePath:path});
        return path;
      } catch (error) {
        if (current()) this.setData({actionError:error.message || "图片准备失败，请重试。"});
        return null;
      } finally { if (current()) this.setData({rendering:false}); }
    });
    return this.imageRender;
  },
  retrySharedImage() {
    if (!this.data.rendering && !this.data.acting) return this.prepareImage(true);
  },
  sharedImageReady() {
    const d=this.data;
    return this.alive && this.foreground && d.authoring && d.imagePath && !d.loading && !d.rendering && !d.acting;
  },
  sendSharedImage() {
    if (!this.sharedImageReady()) return;
    if (!this.data.imageMenu) { this.setData({actionError:"当前微信不支持直接发送，请保存图片后在聊天中发送。"}); return; }
    this.setData({acting:true,actionError:"",albumDenied:false});
    wx.showShareImageMenu({path:this.data.imagePath,
      fail:error=>{if(this.alive && !/cancel/i.test(error.errMsg || ""))this.setData({actionError:"暂时无法发送，可重试或保存图片后发送。"});},
      complete:()=>{if(this.alive)this.setData({acting:false});},
    });
  },
  saveSharedImage() {
    if (!this.sharedImageReady()) return;
    this.setData({acting:true,actionError:"",albumDenied:false});
    wx.saveImageToPhotosAlbum({filePath:this.data.imagePath,
      success:()=>{if(this.alive)wx.showToast?.({title:"已保存到相册",icon:"success"});},
      fail:error=>{
        if(!this.alive || /cancel/i.test(error.errMsg || ""))return;
        const denied=/auth|denied|authorize/i.test(error.errMsg || "");
        this.setData({albumDenied:denied,actionError:denied?"保存需要相册权限，可前往设置开启。":"保存失败，请重试。"});
      },
      complete:()=>{if(this.alive)this.setData({acting:false});},
    });
  },
  openSharedAlbumSettings() {
    if (!this.alive || !this.data.albumDenied) return;
    wx.openSetting({success:result=>{
      if(this.alive && result.authSetting?.["scope.writePhotosAlbum"])this.setData({albumDenied:false,actionError:"权限已开启，请再次点击保存图片。"});
    }});
  },
  onShareAppMessage() { return recordCover.friendContent(this, this.introTab || "records", this.snapshot); },
  onShareTimeline() { return recordCover.timelineContent(this, this.introTab || "records", this.snapshot); },
  onUnload() { this.alive = false; this.sequence = (this.sequence || 0) + 1; this.imageSequence=(this.imageSequence || 0)+1; this.snapshot = null; },
}; };
