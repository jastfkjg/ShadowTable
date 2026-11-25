const { wxmlToJs, wxssToJs } = require("miniprogram-compiler");

// The debug output for all templates and styles exceeds the native compiler wrapper's
// default 1 MiB stdout limit. This limit applies only to local previews/tests.
module.exports = {
  wxmlToJs(root, options) {
    return wxmlToJs(root, { maxBuffer: 8 * 1024 * 1024, ...options });
  },
  wxssToJs(root, options) {
    return wxssToJs(root, { maxBuffer: 8 * 1024 * 1024, ...options });
  },
};
