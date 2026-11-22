const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const { createContext, runInContext } = require("node:vm");

const context = createContext();
for (const file of ["go.js", "lessons.js", "pachi-data.js", "sgf-book.js", "explorer.js"]) {
  runInContext(readFileSync(join(__dirname, "..", file), "utf8"), context, { filename: file });
}
const { Go, GoExplorer, lessons, explorationLines, pachiJoseki } = runInContext("({ Go, GoExplorer, lessons, explorationLines, pachiJoseki })", context);
const courses = lessons.map((lesson) => ({
  ...lesson,
  paths: [lesson.main, ...lesson.variations].map((path) => ({ ...path, frames: Go.replay(path.moves) })),
}));
const explorer = GoExplorer.create(courses, explorationLines, pachiJoseki);

function analyze(points, focus = "auto") {
  const moves = points.map((point) => ({ point }));
  return explorer.analyze({ moves, focus, step: moves.length, frames: Go.replay(moves) });
}

test("所有精选定式线路和变招都能完整重放", () => {
  for (const course of courses) {
    for (const { title, moves, frames } of course.paths) {
      assert.equal(frames.length, moves.length + 1, title);
      assert.ok(moves.every((move) => move.why.trim()), title);
    }
  }
});

test("新手试摆能识别右上角星位点三三并给出挡法", () => {
  const result = analyze(["Q16", "R17"]);
  assert.equal(result.title, "星位点三三");
  assert.ok(result.candidates.some(({ point, why }) => point === "R16" && why));
});

test("扩展棋谱能显示夹攻并在偏离后给出反击", () => {
  const result = analyze(["Q16", "O17"]);
  assert.ok(explorer.referencePositions >= 1948);
  assert.ok(result.candidates.some(({ point }) => point === "M17"));
  assert.ok(!result.candidates.some(({ point }) => point === "Q18"));

  const deviation = analyze(["Q16", "O17", "Q18"]);
  assert.match(deviation.phase, /变招/);
  assert.ok(deviation.candidates.some(({ kind }) => kind === "counter"));
});

test("自由变化仍有棋形建议，每个候选都能合法落下", () => {
  const points = ["Q16", "R17", "R16", "Q17", "P16", "P17", "O16", "O17", "N16", "N17"];
  const { candidates } = analyze(points);
  const frames = Go.replay(points.map((point) => ({ point })));
  assert.ok(candidates.some(({ title }) => title.includes("扳")));
  for (const { point, why } of candidates) {
    assert.ok(why);
    Go.play(frames.at(-1).board, point, points.length + 1, frames.at(-2).board);
  }
});
