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
async function main() {
  const metadata = await sharp(input).metadata();
  if (metadata.width !== 1254 || metadata.height !== 1254 || !metadata.hasAlpha) throw new Error("Expected the reviewed 1254×1254 transparent atlas");
  const output = path.join(root, "miniprogram/assets/roles");
  fs.mkdirSync(output, { recursive: true });
  for (let i = 0; i < names.length; i++) {
    const row = Math.floor(i / 4), col = i % 4;
    const crop = await sharp(input).extract({ left: columns[row][col], top: rows[row], width: columns[row][col + 1] - columns[row][col], height: rows[row + 1] - rows[row] }).png().toBuffer();
    const tile = await sharp(crop).trim().png().toBuffer();
    await sharp(tile).resize(144, 144, { fit: "contain", background: "#00000000" })
      .extend({ top: 8, bottom: 8, left: 8, right: 8, background: "#00000000" })
      .png({ palette: true, colours: 128, compressionLevel: 9 }).toFile(path.join(output, names[i] + ".png"));
  }
  console.log("Imported " + names.length + " transparent portraits into " + output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
