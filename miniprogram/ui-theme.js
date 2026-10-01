const backgroundColor = "#101c24";

// Keep the native iOS underlay dark as pages and the safe area are repainted.
function restorePageBackground() {
  wx.setBackgroundColor?.({
    backgroundColor,
    backgroundColorTop: backgroundColor,
    backgroundColorBottom: backgroundColor,
    fail() { /* An unavailable appearance API must not interrupt navigation. */ },
  });
}

module.exports = { restorePageBackground };
