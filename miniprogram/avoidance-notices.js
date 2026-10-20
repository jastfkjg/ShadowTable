const api = require("./api");
const dialog = require("./dialog");
const { createGrantNotifier } = require("./avoidance");

function surface() {
  const pages = getCurrentPages(), host = pages[pages.length - 1];
  const controller = host?.data?.activeTab === 0 ? host.lobbyController : host?.data?.activeTab === 1 ? host.personalController : host;
  return { host, controller, data: controller?.data || {} };
}
function create() {
  return createGrantNotifier({
    account: () => wx.getStorageSync("session"),
    read: () => api.request("/api/me/avoidance/notice"),
    ack: through => api.request("/api/me/avoidance/notice", "POST", { through }),
    canShow() {
      const { host, controller, data } = surface();
      if (!host || !controller?.foreground || !controller.alive || !host.selectComponent?.("#app-dialog")) return false;
      if (host.route !== "pages/table/table" || data.room?.phase !== "lobby") return false;
      const shared = host.selectComponent("#app-dialog");
      if (shared.currentDialog || shared.dialogQueue?.length || controller.pending || controller.grantNoticeOpen) return false;
      return !["loading", "busy", "error", "reconnecting", "entrySheet", "invitation", "roomMenu", "noteRoom", "monthlyReset", "resetSaving", "avoidanceOpen", "actionDialog", "actionLoading", "identityChange", "fairyResult", "identityHistoryOpen", "historyOpen", "toolType", "showRoomRules", "showRoomSettings", "dealtIdentityDialog", "honorDialog", "resultDialog", "revealed", "playerCard", "statsOpen", "showTransfer"].some(key => data[key]);
    },
    update(value) {
      const { controller, data } = surface();
      if (data.profile?.avoidance) controller.setData({ profile: { ...data.profile, avoidance: { ...data.profile.avoidance, balance: value.balance } } });
      if (data.room?.me?.avoidance && data.room.me.avoidance.balance !== value.balance) controller.setData({ room: { ...data.room, me: { ...data.room.me, avoidance: { ...data.room.me.avoidance, balance: value.balance } } } });
    },
    async show(value) {
      const { host, controller } = surface(), shared = host.selectComponent("#app-dialog");
      const options = { title: value.title, content: value.content, contextLabel: "本次获得", contextValue: "+" + value.amount + " 张", contextIcon: "/assets/table-cards.svg", showCancel: false, confirmText: "知道了" };
      controller.grantNoticeOpen = true;
      controller.dismissGrantNotice = () => { if (shared.currentDialog?.options === options) shared.finish(false, shared.data.dialog.id); };
      try { return (await dialog.show(options)).confirm; }
      finally { controller.grantNoticeOpen = false; controller.dismissGrantNotice = null; }
    },
  });
}
module.exports = { create, surface };
