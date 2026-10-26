(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.shadowtableIdentityVision = factory();
})(typeof window !== "undefined" ? window : this, function () {
  // Format only information already disclosed by the private endpoint. Never
  // join public seats with hidden roles or assign identities to ambiguous seats.
  function parse(information) {
    const text = String(information || "");
    const named = text.match(/^(初始见面匪|你的坏人同伴)：([1-9]\d*号（[^（）]+）(?:、[1-9]\d*号（[^（）]+）)*)(?:。([\s\S]*))?$/);
    if (named) return { label: named[1], players: named[2].split("、").map(value => {
      const entry = value.match(/^([1-9]\d*)号（([^（）]+)）$/);
      return { seat: Number(entry[1]), role: entry[2] };
    }), note: (named[3] || "").trim(), text };
    const numbered = text.match(/^(你看见的坏人座位|你看见的举手座位|梅林与莫甘娜位于|蓝术士与红术士位于|你的坏人同伴|你的盗贼同伴|刺客位于)：([1-9]\d*(?:、[1-9]\d*)*)号?([。（][\s\S]*)?$/);
    if (numbered) return { label: numbered[1], players: numbered[2].split("、").map(seat => ({ seat: Number(seat), role: "" })),
      note: (numbered[3] || "").replace(/^。/, ""), text };
    return { label: "", players: [], note: "", text };
  }
  function present(information, players) {
    const vision = parse(information);
    if (!Array.isArray(players)) return vision;
    const profiles = new Map(players.filter(player => player.occupied !== false).map(player => [Number(player.seat), player]));
    return { ...vision, players: vision.players.map(entry => {
      const profile = profiles.get(entry.seat);
      const name = String(profile?.name || "");
      // Explicitly copy public profile fields; roles come only from the parsed
      // private vision, including when a caller supplies extra player fields.
      return { ...entry, name: name || "玩家", avatarInitial: Array.from(name || "友")[0],
        avatarUrl: profile?.avatarUrl || "", avatarFailed: !!profile?.avatarFailed };
    }) };
  }
  return { present };
});
