const labels = {
  success: "成功票",
  fail: "失败票",
  thiefFail: "盗贼失败票",
  magic: "魔法票",
};

const timing = { leadInMs: 1000, turnMs: 520, readMs: 800, finalReadMs: 800 };

// Shuffle public totals, never individual submissions. The public event ID
// gives every device the same draw even if their polls arrive at different times.
function shuffle(cards, id) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  for (let i = cards.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((seed / 4294967296) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

function forResult(room, entry) {
  if (!entry?.questResult || !["tools", "questResult", "offlineFinal", "ended"].includes(room.phase)) return null;
  const event = room.history[entry.key];
  const number = event.number ?? event.round;
  const id = [room.code, room.createdAt, room.game, event.kind, number ?? entry.key, event.startedAt].join("/");
  const total = event.team?.length;
  if (!total || !Number.isInteger(event.fails) || event.fails < 0 || event.fails > total) return null;
  const counts = event.counts ?? { success: total - event.fails, fail: event.fails };
  const cards = [];
  for (const [kind, label] of Object.entries(labels)) {
    const count = counts[kind] ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > total) return null;
    for (let n = 0; n < count; n++) cards.push({ kind, label });
  }
  if (cards.length !== total) return null;
  shuffle(cards, id);
  const columns = total <= 6 ? total : Math.ceil(total / 2);
  return { id, key: entry.key, cards: cards.map((card, index) => ({ ...card, index })), columns };
}

function reveal(room, tickets, previous, active) {
  if (!tickets || !previous?.history || previous.phase === "lobby" ||
      previous.code !== room.code || previous.createdAt !== room.createdAt || previous.game !== room.game) return null;
  if (active?.id === tickets.id && previous.stage === room.stage) return active;
  const event = room.history[tickets.key];
  const number = event.number ?? event.round;
  const known = number == null ? tickets.key < previous.history.length
    : previous.history.some(h => h.kind === event.kind && (h.number ?? h.round) === number);
  return known ? null : { id: tickets.id, revealed: 0, turnMs: timing.turnMs };
}

module.exports = { forResult, reveal, timing };
