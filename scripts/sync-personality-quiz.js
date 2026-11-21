const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const folder = join(__dirname, "../miniprogram/pages/personality");
const quiz = readFileSync(join(folder, "quiz.json"), "utf8");
JSON.parse(quiz);
writeFileSync(
  join(folder, "quiz-data.js"),
  "// Generated from quiz.json by scripts/sync-personality-quiz.js.\nmodule.exports = " + quiz.trimEnd() + ";\n",
);
