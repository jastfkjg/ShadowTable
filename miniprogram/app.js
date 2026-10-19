App({
  onShow() {
    if (!this.grantNotifier) this.grantNotifier = require("./avoidance-notices").create();
    this.grantNotifier.start();
  },
  onHide() {
    this.grantNotifier?.stop();
    getCurrentPages().forEach((page) => {
      if (page.mask) page.mask();
    });
  },
});
