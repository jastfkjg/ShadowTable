const { present } = require("../../dialog");

Component({
  data: { dialog: null, bodyHeight: 0 },
  lifetimes: {
    attached() { this.dialogQueue = []; this.dialogHidden = false; },
    detached() { this.dialogHidden = true; this.dismissAll(); },
  },
  pageLifetimes: {
    show() { this.dialogHidden = false; },
    hide() { this.dialogHidden = true; this.dismissAll(); },
    resize() { this.measureBody(); },
  },
  methods: {
    show(options) {
      return new Promise(resolve => {
        if (this.dialogHidden) { this.deliver({ options, resolve }, false); return; }
        this.dialogQueue.push({ options, resolve });
        this.showNext();
      });
    },
    showNext() {
      if (this.currentDialog || !this.dialogQueue.length) return;
      this.currentDialog = this.dialogQueue.shift();
      const pages = getCurrentPages();
      this.dialogTabBar = pages[pages.length - 1]?.getTabBar?.();
      this.dialogTabBar?.setData({ dialogVisible: true });
      const id = this.dialogSequence = (this.dialogSequence || 0) + 1;
      this.setData({ dialog: { ...present(this.currentDialog.options), id }, bodyHeight: 0 }, () => this.measureBody());
    },
    measureBody() {
      if (!(this.data.dialog?.content || this.data.dialog?.lead) || !this.createSelectorQuery) return;
      const id = this.data.dialog.id;
      const grant = this.data.dialog.variant === "avoidance-grant";
      const query = this.createSelectorQuery();
      for (const selector of ['.app-dialog-backdrop', grant ? '.app-dialog-grant-header' : '.app-dialog-title', '.app-dialog-context', '.app-dialog-actions', '.app-dialog-message']) query.select(selector).boundingClientRect();
      query.exec(rects => {
        if (this.data.dialog?.id !== id || !rects?.[0] || !rects[4]) return;
        const [backdrop, title, context, actions, message] = rects;
        const available = Math.max(44, backdrop.height - 160 - (title?.height || 0) - (context ? context.height + (grant ? 22 : 16) : 0) - (actions?.height || 48));
        this.setData({ bodyHeight: Math.min(message.height, available) });
      });
    },
    finish(confirm, id) {
      if (!this.currentDialog || id !== this.data.dialog?.id) return;
      const job = this.currentDialog;
      this.currentDialog = null;
      this.setData({ dialog: null });
      if (this.dialogQueue.length) this.showNext();
      else this.releaseTabBar();
      this.deliver(job, confirm);
    },
    deliver(job, confirm) {
      const result = { confirm, cancel: !confirm, errMsg: "showDialog:ok" };
      try { job.options.success?.(result); }
      finally {
        try { job.options.complete?.(result); }
        finally { job.resolve(result); }
      }
    },
    releaseTabBar() {
      this.dialogTabBar?.setData({ dialogVisible: false });
      this.dialogTabBar = null;
    },
    dismissAll() {
      const jobs = [this.currentDialog, ...(this.dialogQueue || [])].filter(Boolean);
      this.currentDialog = null;
      this.dialogQueue = [];
      this.setData({ dialog: null });
      this.releaseTabBar();
      for (const job of jobs) this.deliver(job, false);
    },
    confirm(e) { this.finish(true, e.currentTarget.dataset.id); },
    cancel(e) { this.finish(false, e.currentTarget.dataset.id); },
    blockScroll() {},
  },
});
