App({
  onShow() {
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
