const api = require('./api');
const dialog = require('./dialog');
const { surface } = require('./avoidance-notices');
const { createNotifier } = require('./badge-awards');
function create() {
  let showing;
  const notifier = createNotifier({
    account: () => wx.getStorageSync('session'),
    read: () => api.request('/api/me/badges/notice'),
    ack: through => api.request('/api/me/badges/notice', 'POST', { through }),
    canShow() {
      const { host, controller, data } = surface();
      if (!['pages/lobby/lobby', 'pages/me/me'].includes(host?.route) || !host.foreground || !controller?.alive || !controller.foreground) return false;
      const shared = host.selectComponent?.('#app-dialog');
      if (!shared || shared.currentDialog || shared.dialogQueue?.length || controller.pending) return false;
      return !['loading', 'busy', 'error', 'reconnecting', 'entrySheet', 'invitation', 'roomMenu', 'noteRoom', 'monthlyReset', 'resetSaving', 'playerCard', 'grantNoticeOpen'].some(k => data[k] || controller[k]);
    },
    async show(awards) {
      const image = b => b ? { ...b, imageUrl: api.assetUrl(b.imageUrl), ...(b.largeImageUrl ? {largeImageUrl: api.assetUrl(b.largeImageUrl)} : {}) } : null;
      awards = { ...awards, badges: awards.badges.map(image), hero: image(awards.hero), secondary: awards.secondary.map(image) };
      const { host } = surface();
      const options = { variant: 'badge-awards', title: awards.title, awards, showCancel: false };
      showing = { host: host.selectComponent('#app-dialog'), options };
      try {
        const result = await dialog.show(options);
        if (result.confirm && result.action === 'badges') wx.navigateTo({ url: '/pages/badges/badges' });
        return result.confirm;
      } finally { showing = null; }
    },
  });
  return { start: notifier.start, check: notifier.check, stop() {
    notifier.stop();
    if (showing && showing.host?.currentDialog?.options === showing.options) showing.host.finish(false, showing.host.data.dialog.id);
  } };
}
module.exports = { create };
