const connection = require("../../page-connection");
const { initial } = require("../../connection-feedback");
Component({
  properties: { context: { type: String, value: "", observer() { this.connect(); } } },
  data: { ...initial, loading: false, network: true, reconnecting: false, needsLogin: false, connectionVisible: false },
  lifetimes: {
    attached() { this.connect(); },
    detached() { this.disconnect(); },
  },
  pageLifetimes: {
    show() { this.connect(); },
    hide() { this.disconnect(); },
  },
  methods: {
    connect() {
      if (typeof getCurrentPages !== "function") return;
      const page = getCurrentPages().slice(-1)[0];
      if (page !== this.page) this.disconnect();
      this.page = page;
      this.listener ||= value => {
        const changed = {};
        for (const key of Object.keys(value)) if (this.data[key] !== value[key]) changed[key] = value[key];
        if (Object.keys(changed).length) this.setData(changed);
      };
      if (this.page) this.release = connection.activate(this.page, this.listener);
    },
    disconnect() { this.release?.();this.release = null;this.setData({ connectionVisible: false }); },
    retryLobbyConnection() { if (this.page) return connection.retry(this.page); },
  },
});
