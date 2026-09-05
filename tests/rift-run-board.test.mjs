/**
 * The Rift Run board.
 *
 * The rule these exist to protect: **a Rift Run is ranked on depth, and it is
 * ranked on its own board.** Both halves are easy to break invisibly. Depth
 * and score climb together during a normal run, so a board mistakenly sorted
 * by score looks right in almost every screenshot and is wrong exactly when it
 * matters — a cautious deep run losing to a reckless shallow one that farmed a
 * single rift. And before this board existed a Rift Run was quietly writing
 * into the arcade device best, which holds one score from a completed victory;
 * nothing on screen said so.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RIFT_RUN_BOARD_LIMIT,
  compareRiftRunEntries,
  deepestRiftRun,
  parseRiftRunEntry,
  placeRiftRunEntry,
  rankRiftRunEntries,
  riftRunEntryFromRun,
} from "../app/rift-run-board.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

let nextId = 0;
/** A board entry with sensible defaults, so each test names only what it means. */
function entry(overrides = {}) {
  return {
    runId: `run-${(nextId += 1)}`,
    initials: "PJM",
    depth: 0,
    level: 1,
    score: 0,
    durationSeconds: 60,
    achievedAt: 1_000,
    ...overrides,
  };
}

test("depth outranks score, however big the score", () => {
  // The failure this prevents: a pilot who farmed one rift for a huge score
  // outranking a pilot who actually got somewhere.
  const shallow = entry({ depth: 1, score: 500_000 });
  const deep = entry({ depth: 4, score: 900 });

  const board = rankRiftRunEntries([shallow, deep]);
  assert.equal(board[0], deep, "the deeper run is first");
  assert.ok(compareRiftRunEntries(deep, shallow) < 0);
});

test("score breaks a tie on depth, which is where most ties are", () => {
  // Depth is a small number, so a real board is mostly ties. Score is what
  // actually does the separating, and it has to be doing it correctly.
  const better = entry({ depth: 3, score: 40_000 });
  const worse = entry({ depth: 3, score: 39_999 });

  assert.deepEqual(rankRiftRunEntries([worse, better]), [better, worse]);
});

test("the earlier run keeps the higher rank on a total tie", () => {
  const first = entry({ depth: 2, score: 100, achievedAt: 1_000 });
  const later = entry({ depth: 2, score: 100, achievedAt: 9_000 });

  // Whoever got there first is not pushed down by a later equal.
  assert.deepEqual(rankRiftRunEntries([later, first]), [first, later]);
});

test("level is deliberately not a tie-break", () => {
  // It tracks the same rift energy the score does, so it would only ever break
  // a tie score had already broken. Two runs equal on depth, score and time
  // stay in achievedAt order regardless of how far apart their levels are.
  const early = entry({ depth: 2, score: 100, level: 3, achievedAt: 1_000 });
  const late = entry({ depth: 2, score: 100, level: 30, achievedAt: 2_000 });
  assert.deepEqual(rankRiftRunEntries([late, early]), [early, late]);
});

test("one run cannot appear on the board twice", () => {
  // The result card can be restored and re-rendered, so the same finished run
  // can reach the board more than once. Two copies would also mean a run
  // beating itself for the top slot.
  const once = entry({ runId: "same", depth: 5 });
  const again = { ...once, score: 999 };

  const board = rankRiftRunEntries([once, again]);
  assert.equal(board.length, 1);
  assert.equal(board[0].score, once.score, "the first copy is the one kept");
});

test("the board stays a readable length", () => {
  const many = Array.from({ length: RIFT_RUN_BOARD_LIMIT + 20 }, (_, i) =>
    entry({ depth: i })
  );
  assert.equal(rankRiftRunEntries(many).length, RIFT_RUN_BOARD_LIMIT);
});

test("a run that did not place is told so, rather than given a rank", () => {
  const full = Array.from({ length: RIFT_RUN_BOARD_LIMIT }, () => entry({ depth: 10 }));
  const shallow = entry({ depth: 0 });

  const placement = placeRiftRunEntry(full, shallow);
  assert.equal(placement.rank, null, "off the board is a real answer, not an error");
  assert.equal(placement.board.length, RIFT_RUN_BOARD_LIMIT);

  // And a run that does place is told where.
  const deep = entry({ depth: 99 });
  assert.equal(placeRiftRunEntry(full, deep).rank, 1);
});

test("placing never mutates the board it was given", () => {
  const board = [entry({ depth: 1 })];
  const copy = [...board];
  placeRiftRunEntry(board, entry({ depth: 5 }));
  assert.deepEqual(board, copy);
});

test("only a Rift Run becomes an entry", () => {
  // `depth` is what identifies one. An arcade or Survival run carries no depth
  // and must not land on this board wearing a depth of zero.
  const arcadeRun = { runId: "a", score: 90_000, durationSeconds: 120, ship: "Starling" };
  assert.equal(riftRunEntryFromRun(arcadeRun), null);

  const riftRun = { runId: "r", score: 12_000, durationSeconds: 300, depth: 4, riftLevel: 9, initials: "ABC" };
  const made = riftRunEntryFromRun(riftRun, 5_000);
  assert.deepEqual(made, {
    runId: "r",
    initials: "ABC",
    depth: 4,
    level: 9,
    score: 12_000,
    durationSeconds: 300,
    achievedAt: 5_000,
  });

  // A depth of zero is a real result — you died in the first rift — and must
  // still be recorded, so the check cannot be a truthiness test.
  assert.equal(riftRunEntryFromRun({ runId: "z", score: 10, durationSeconds: 9, depth: 0 })?.depth, 0);
});

test("an unsigned run is recorded, and can be signed afterwards", () => {
  // Initials are asked for after the run is recorded, so an entry must be
  // valid without them.
  const made = riftRunEntryFromRun({ runId: "r", score: 1, durationSeconds: 1, depth: 2 });
  assert.equal(made.initials, "");
});

test("corrupt storage degrades to fewer rows, never to a crash", () => {
  assert.equal(parseRiftRunEntry(null), null);
  assert.equal(parseRiftRunEntry("nope"), null);
  assert.equal(parseRiftRunEntry({ score: 10 }), null, "no depth is not a Rift Run row");
  assert.equal(parseRiftRunEntry({ depth: Number.NaN }), null);

  // Nonsense in the supporting fields is repaired rather than thrown away:
  // the row still names a real run at a real depth.
  const repaired = parseRiftRunEntry({ depth: -3, level: 0, score: "x", initials: "TOOLONG" });
  assert.equal(repaired.depth, 0);
  assert.equal(repaired.level, 1, "a level is at least 1");
  assert.equal(repaired.score, 0);
  assert.equal(repaired.initials, "TOO", "trimmed to three, like everywhere else");
});

test("the deepest run is the first row", () => {
  assert.equal(deepestRiftRun([]), null, "an empty board has no best");
  const board = rankRiftRunEntries([entry({ depth: 2 }), entry({ depth: 7 })]);
  assert.equal(deepestRiftRun(board).depth, 7);
});

// ------------------------------------------------------------- the wiring --

test("a Rift Run is kept out of the arcade device best", () => {
  // This is the bug the board was built to close. The arcade record holds one
  // score from a completed victory; an endless mode has no victory, so a Rift
  // Run's score was competing for a record that does not describe it -- and
  // could take it from a real arcade win.
  assert.ok(game.includes("const placement = recordRiftRun(identifiedRun);"));

  // The Rift Run branch must come before the fall-through that calls
  // saveLocalRun, which is what wrote into the arcade record.
  const riftAt = game.indexOf("if (riftRun) {");
  const localAt = game.indexOf("const local = saveLocalRun(identifiedRun);");
  assert.ok(riftAt > 0 && localAt > riftAt, "the Rift Run branch is reached first");
});

test("depth is read off the run, not off the Survival HUD", () => {
  // `hud.riftLevel` and `hud.breaches` are fed by `game.survival`, which a Rift
  // Run never populates. Reading depth from there would record every run at
  // depth zero, and nothing else in the suite would notice.
  assert.ok(game.includes("depth: riftRun ? riftRun.riftBreaches : undefined,"));
  assert.ok(game.includes('const riftRun = replay.kind === "rift-run" ? riftRunRef.current : null;'));
});

test("the run is identified by what actually ran, not by its difficulty", () => {
  // A Rift Run's difficulty id is a normal PvE one -- the escalation re-stamps
  // the launch ruleset -- so `difficulty` cannot tell a Rift Run from an
  // ordinary run. `replay.kind` is the only thing that can.
  assert.ok(game.includes('summary.replay.kind === "rift-run"'));
  assert.ok(game.includes("const placement = nameRiftRun(run.runId, initials);"), "signing re-stamps the row");
});

test("the result card leads with depth and the board button opens the right board", () => {
  assert.ok(game.includes("<p className=\"run-score\"><span>DEPTH REACHED</span><b>{summary.run.depth ?? 0}</b></p>"));
  assert.ok(game.includes('`DEPTH ${summary.run.depth ?? 0} REACHED`'));
  assert.ok(game.includes('"RIFT RUN BOARD"'), "the card links to the board its run is ranked on");
});

test("the leaderboard screen offers the Rift Run board", () => {
  assert.ok(game.includes('type BoardKind = "arcade" | "survival" | "rift-run";'));
  assert.ok(game.includes("function RiftRunBoard()"));
  assert.ok(game.includes("<RiftRunBoard />"));
});
