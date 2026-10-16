// Add existing artwork to the read-only rule presentation without changing its text.
const { portrait } = require("./role-portraits");
function decorateBoard(board) {
  return {
    ...board,
    roles: board.roles.map(role => ({ ...role, ...portrait(role.name, role.tone) })),
    chapters: board.chapters.map(chapter => ({
      ...chapter,
      ...(chapter.configuration ? { configuration: chapter.configuration.map(faction => ({
        ...faction,
        members: String(faction.roles).split(/[，、,]/).map(name => {
          const match = name.trim().match(/^(.*?)(?:×(\d+))?$/);
          const role = match[1].trim(), count = Number(match[2] || 1);
          return { name: role, count, ...portrait(role, faction.faction) };
        }).filter(role => role.name),
      })) } : {}),
      ...(chapter.decks ? { decks: chapter.decks.map(deck => ({ ...deck, ...(deck.layers ? {
        layers: deck.layers.map(layer => {
          const match = layer.text.match(/^(\d+) 红 \+ (\d+) 蓝$/);
          return { ...layer, cards: match ? [
            ...Array.from({ length: Number(match[1]) }, () => ({ tone: "evil" })),
            ...Array.from({ length: Number(match[2]) }, () => ({ tone: "good" })),
          ].map((card, index) => ({ ...card, id: index })) : [] };
        }),
      } : {}) })) } : {}),
    })),
  };
}
module.exports = { decorateBoard };
