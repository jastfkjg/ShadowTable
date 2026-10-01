const builtinAvatars = require("./builtin-avatars");

const avatarStyles = [
  { id: "classic", label: "经典线稿", shortLabel: "线稿" },
  { id: "crayon", label: "彩色蜡笔", shortLabel: "蜡笔" },
  { id: "sketch", label: "黑白简笔", shortLabel: "简笔" },
  { id: "geometric", label: "极简几何", shortLabel: "几何" },
  { id: "pixel", label: "像素风", shortLabel: "像素" },
].map(style => ({ ...style, count: builtinAvatars.filter(avatar => avatar.style === style.id).length }));

function avatarPreset(url) {
  return builtinAvatars.find(item => url === item.path || url?.endsWith("/api/avatars/" + item.hash));
}

function avatarLibrary(styleId) {
  const style = avatarStyles.find(item => item.id === styleId) || avatarStyles[0];
  return {
    avatarStyles,
    avatarStyle: style.id,
    visibleAvatars: builtinAvatars.filter(item => item.style === style.id),
  };
}

module.exports = { avatarStyles, avatarPreset, avatarLibrary };
