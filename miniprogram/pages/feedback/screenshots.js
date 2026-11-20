// Both the image component and the native viewer can use the same local JPEG.
const { requestId } = require("../../api");
let swept = false;
function remove(path) {
  if (path) wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
}
function write(bytes) {
  const fs = wx.getFileSystemManager();
  const directory = wx.env.USER_DATA_PATH;
  if (!swept) {
    // Recover only our own abandoned previews after a forced app exit.
    for (const name of fs.readdirSync(directory)) {
      if (/^feedback-preview-v1_[a-z0-9_]+\.jpg$/.test(name)) remove(directory + "/" + name);
    }
    swept = true;
  }
  const path = directory + "/feedback-preview-" + requestId() + ".jpg";
  return new Promise((resolve, reject) => fs.writeFile({ filePath: path, data: bytes,
    success: () => resolve(path), fail: error => { remove(path); reject(error); } }));
}
module.exports = { write, remove };
