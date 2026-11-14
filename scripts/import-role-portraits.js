// Cut the generated transparent atlas into small, package-safe role portraits.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");
const input = process.argv[2] || path.join(root, "docs/sources/role-portraits-atlas.png");
const rows = [0, 340, 633, 926, 1254];
const columns = [[0, 307, 603, 922, 1254], [0, 320, 614, 919, 1254], [0, 315, 622, 940, 1254], [0, 309, 614, 941, 1254]];
const names = ["merlin", "percival", "servant", "assassin", "morgana", "mordred", "oberon", "lancelot",
  "swordsman", "hunter", "guard", "paladin", "magician", "prophet", "witch", "thief"];
// Reviewed crops for the approved November artwork. Null cells are superseded
// knight/spy drafts; never import them over the separately approved revisions.
const atlases = [
  { input, width: 1254, height: 1254, rows, columns, names },
  {
    input: path.join(root, "docs/sources/role-portraits-factions.png"),
    width: 1122, height: 1402,
    rows: [0, 280, 554, 820, 1095, 1402],
    columns: [[0, 290, 550, 840, 1122], [0, 280, 560, 825, 1122],
      [0, 288, 560, 835, 1122], [0, 285, 565, 840, 1122], [0, 280, 560, 840, 1122]],
    names: ["gargoyle", "oberon", null, null,
      "lancelot-blue", "lancelot-red", "gareth", "gaheris",
      "hunter-blue", "hunter-red", "guard-blue", "guard-red",
      "magician-blue", "magician-red", "thief-blue", "thief-red",
      "awakened-blue", "awakened-red", null, null],
  },
  {
    input: path.join(root, "docs/sources/role-portraits-knights-spies.png"),
    width: 1199, height: 1312,
    rows: [0, 600, 1312], columns: [[0, 600, 1199], [0, 600, 1199]],
    names: ["knight-blue", "knight-red", "spy-blue", "spy-red"],
  },
];
async function main() {
  for (const atlas of atlases) {
    const metadata = await sharp(atlas.input).metadata();
    if (metadata.width !== atlas.width || metadata.height !== atlas.height || !metadata.hasAlpha)
      throw new Error("Expected the reviewed " + atlas.width + "×" + atlas.height + " transparent atlas: " + atlas.input);
  }
  const output = path.join(root, "miniprogram/assets/roles");
  fs.mkdirSync(output, { recursive: true });
  const imported = new Set();
  for (const atlas of atlases) {
    const { input, rows, columns, names } = atlas;
    const columnCount = columns[0].length - 1;
    for (let i = 0; i < names.length; i++) {
      if (!names[i]) continue;
      const row = Math.floor(i / columnCount), col = i % columnCount;
      const crop = await sharp(input).extract({ left: columns[row][col], top: rows[row], width: columns[row][col + 1] - columns[row][col], height: rows[row + 1] - rows[row] }).png().toBuffer();
      const tile = await sharp(crop).trim().png().toBuffer();
      // The largest portrait slot is 80 CSS pixels. Keep the shared thumbnails
      // compact enough for all role variants to fit in the mini program's main package.
      await sharp(tile).resize(100, 100, { fit: "contain", background: "#00000000" })
        .extend({ top: 6, bottom: 6, left: 6, right: 6, background: "#00000000" })
        .png({ palette: true, quality: 50, dither: 0.15, compressionLevel: 9, effort: 10 })
        .toFile(path.join(output, names[i] + ".png"));
      imported.add(names[i]);
    }
  }
  console.log("Imported " + imported.size + " transparent portraits into " + output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
