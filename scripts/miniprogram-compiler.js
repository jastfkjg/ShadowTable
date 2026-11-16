// The complete WXML tree exceeds the compiler's 1 MiB stdout default as pages
// grow. Keep preview/test compilation bounded without changing runtime bundles.
const compiler = require("miniprogram-compiler");
module.exports = {
  ...compiler,
  wxmlToJs(root, options = {}) {
    return compiler.wxmlToJs(root, { maxBuffer: 8 * 1024 * 1024, ...options });
  },
  wxssToJs(root, options = {}) {
    return compiler.wxssToJs(root, { maxBuffer: 8 * 1024 * 1024, ...options });
  },
};
