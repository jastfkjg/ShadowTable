App({
  onHide() {
    getCurrentPages().forEach((page) => {
      if (page.mask) page.mask();
    });
  },
});
