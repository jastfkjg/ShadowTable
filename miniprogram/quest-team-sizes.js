(function (root) {
  const teamSizes = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
    11: [3, 4, 5, 6, 6],
    12: [3, 4, 5, 6, 6],
    13: [3, 4, 5, 6, 6],
  };
  if (typeof module === "object" && module.exports) module.exports = teamSizes;
  else root.shadowtableQuestTeamSizes = teamSizes;
})(typeof window === "undefined" ? this : window);
