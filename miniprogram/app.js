const { isSinglePage, isSharedEntry } = require("./records-share");
App({
  onShow(options = {}) {
    if (isSinglePage(options) || isSharedEntry?.(options)) {
      this.grantNotifier?.stop();
      this.badgeNotifier?.stop();
      return;
    }
    if (!this.grantNotifier) this.grantNotifier = require("./avoidance-notices").create();
    this.grantNotifier.start();
    if (!this.badgeNotifier) this.badgeNotifier = require('./badge-notices').create();
    this.badgeNotifier.start();
  },
  onHide() {
    this.grantNotifier?.stop();
    this.badgeNotifier?.stop();
    getCurrentPages().forEach((page) => {
      if (page.mask) page.mask();
    });
  },
});
