/**
 * The Rift Survival board.
 *
 * Ranking is where a leaderboard actually goes wrong — ties, duplicates, a run
 * that does not place — so the comparison rules are kept pure and checked here
 * without `localStorage`, which the test runner does not have and a private
 * window can refuse. The storage wrappers around them are thin by design.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SURVIVAL_BOARD_LIMIT,
  compareSurvivalEntries,
  parseSurvivalEntry,
  placeSurvivalEntry,
  rankSurvivalEntries,
  shipsOnSurvivalBoard,
  survivalEntriesForShip,
  survivalEntryFromRun,
} from "../app/survival-board.ts";
import { fetchSurvivalLeaderboard, saveSurvivalScoreToMurph } from "../app/arcade-scores.ts";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const hudCss = await readFile(new URL("../app/arena-hud.css", import.meta.url), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const gameCode = stripComments(game);

let nextId = 0;
/** A board entry with sane defaults, so each test states only what it is about. */
function entry(overrides = {}) {
  nextId += 1;
  return {
    runId: `run-${nextId}`,
    initials: "ABC",
    ship: "Starling",
    durationSeconds: 100,
    score: 1000,
    riftLevel: 2,
    breaches: 0,
    achievedAt: 1_000_000 + nextId,
    ...overrides,
  };
}

test("the board ranks on time, because that is what Survival scores", () => {
  const short = entry({ durationSeconds: 90, score: 999_999 });
  const long = entry({ durationSeconds: 300, score: 10 });

  // A huge score does not beat a longer run. Survival is not the arcade board.
  assert.deepEqual(
    rankSurvivalEntries([short, long]).map((row) => row.runId),
    [long.runId, short.runId]
  );
});

test("score breaks a tie on time, and the earlier run breaks a total tie", () => {
  const lowScore = entry({ durationSeconds: 240, score: 100, achievedAt: 5 });
  const highScore = entry({ durationSeconds: 240, score: 900, achievedAt: 9 });
  assert.deepEqual(
    rankSurvivalEntries([lowScore, highScore]).map((row) => row.runId),
    [highScore.runId, lowScore.runId]
  );

  // Same time, same score: whoever got there first keeps the higher rank
  // rather than being pushed down by a later equal.
  const first = entry({ durationSeconds: 240, score: 500, achievedAt: 10 });
  const later = entry({ durationSeconds: 240, score: 500, achievedAt: 20 });
  assert.deepEqual(
    rankSurvivalEntries([later, first]).map((row) => row.runId),
    [first.runId, later.runId]
  );

  // The comparator is a proper ordering: comparing a row with itself is a tie.
  assert.equal(compareSurvivalEntries(first, first), 0);
});

test("one run occupies one row, however many times it is recorded", () => {
  // A restored summary or a double-fired effect must not clone a run onto the
  // board and let it beat itself.
  const run = entry({ durationSeconds: 300 });
  const ranked = rankSurvivalEntries([run, { ...run }, { ...run }]);
  assert.equal(ranked.length, 1);
});

test("the board is capped, and a run that misses it is told so", () => {
  const full = Array.from({ length: SURVIVAL_BOARD_LIMIT }, (_, index) =>
    entry({ durationSeconds: 500 + index })
  );
  const ranked = rankSurvivalEntries(full);
  assert.equal(ranked.length, SURVIVAL_BOARD_LIMIT);

  // A short run on a full board does not place. Null is the honest answer —
  // the card must not claim a rank the player cannot find in the list.
  const missed = placeSurvivalEntry(ranked, entry({ durationSeconds: 30 }));
  assert.equal(missed.rank, null);
  assert.equal(missed.board.length, SURVIVAL_BOARD_LIMIT);
  assert.ok(!missed.board.some((row) => row.durationSeconds === 30));

  // A long one takes the top and pushes the last entry off.
  const placed = placeSurvivalEntry(ranked, entry({ durationSeconds: 9000 }));
  assert.equal(placed.rank, 1);
  assert.equal(placed.board.length, SURVIVAL_BOARD_LIMIT);
});

test("placing a run never mutates the board it was given", () => {
  const board = rankSurvivalEntries([entry({ durationSeconds: 200 })]);
  const snapshot = JSON.stringify(board);
  placeSurvivalEntry(board, entry({ durationSeconds: 400 }));
  assert.equal(JSON.stringify(board), snapshot);
});

test("the ship filter is a view of the board, not a second board", () => {
  const board = rankSurvivalEntries([
    entry({ ship: "Starling", durationSeconds: 400 }),
    entry({ ship: "Phantom", durationSeconds: 300 }),
    entry({ ship: "Starling", durationSeconds: 200 }),
  ]);

  // An empty ship means every ship, so All Ships needs no special case.
  assert.equal(survivalEntriesForShip(board, "").length, 3);
  assert.equal(survivalEntriesForShip(board, "Starling").length, 2);
  assert.equal(survivalEntriesForShip(board, "Phantom").length, 1);
  assert.equal(survivalEntriesForShip(board, "Leviathan").length, 0);

  // Filtered rows keep the board's own ordering.
  assert.deepEqual(
    survivalEntriesForShip(board, "Starling").map((row) => row.durationSeconds),
    [400, 200]
  );

  // Only ships with a run to show, so the filter never offers a dead end.
  assert.deepEqual(shipsOnSurvivalBoard(board), ["Starling", "Phantom"]);
});

test("only Survival runs become board entries", () => {
  const base = {
    runId: "abc",
    score: 1000,
    difficulty: "survival",
    outcome: "defeat",
    ship: "Talon",
    rivalHealth: 100,
    durationSeconds: 615,
    riftLevel: 11,
    breaches: 2,
    initials: "PJM",
  };

  const survival = survivalEntryFromRun(base, 42);
  assert.equal(survival?.durationSeconds, 615);
  assert.equal(survival?.riftLevel, 11);
  assert.equal(survival?.breaches, 2);
  assert.equal(survival?.achievedAt, 42);

  // An arcade run has no place on a board ranked by survival time.
  assert.equal(survivalEntryFromRun({ ...base, difficulty: "hard" }), null);

  // An unnamed run is still a run: initials arrive after the prompt.
  assert.equal(survivalEntryFromRun({ ...base, initials: undefined })?.initials, "");
});

test("a corrupt stored row is dropped rather than crashing the board", () => {
  assert.equal(parseSurvivalEntry(null), null);
  assert.equal(parseSurvivalEntry("nonsense"), null);
  assert.equal(parseSurvivalEntry({}), null);
  assert.equal(parseSurvivalEntry({ durationSeconds: "long" }), null);
  assert.equal(parseSurvivalEntry({ durationSeconds: Number.NaN }), null);

  // A row that is merely incomplete is repaired to something displayable.
  const sparse = parseSurvivalEntry({ durationSeconds: 120 });
  assert.equal(sparse?.ship, "Unknown");
  assert.equal(sparse?.initials, "");
  assert.equal(sparse?.riftLevel, 1);
  assert.equal(sparse?.breaches, 0);
});

test("the global Survival board is a separate endpoint from the arcade one", async () => {
  const scores = await readFile(new URL("../app/arcade-scores.ts", import.meta.url), "utf8");
  assert.match(scores, /\/api\/arcade\/survival-leaderboard\?/);
  assert.match(scores, /"\/api\/arcade\/survival-scores"/);
  // Ranked by time, so time is what the row carries as its metric.
  assert.match(scores, /durationSeconds: number;/);
});

test("a run with no initials is never submitted to the global board", async () => {
  for (const run of [
    { difficulty: "hard", initials: "ABC", durationSeconds: 100 },
    { difficulty: "survival", initials: "", durationSeconds: 100 },
    { difficulty: "survival", initials: "ab", durationSeconds: 100 },
    { difficulty: "survival", initials: "ABC", durationSeconds: 0 },
    { difficulty: "survival", initials: "ABC", durationSeconds: 100, practice: true },
  ]) {
    const result = await saveSurvivalScoreToMurph({
      runId: "r",
      score: 10,
      outcome: "defeat",
      ship: "Talon",
      rivalHealth: 100,
      ...run,
    });
    assert.equal(result.status, "failed", `submitted ${JSON.stringify(run)}`);
  }
});

test("an unreachable global board is a state, not a crash", async () => {
  // There is no server in the test runner, so this exercises the real failure
  // path: the read resolves to null rather than rejecting, which is what lets
  // the screen fall back to the device board.
  assert.equal(await fetchSurvivalLeaderboard(5), null);

  const submitted = await saveSurvivalScoreToMurph({
    runId: "r",
    score: 10,
    difficulty: "survival",
    outcome: "defeat",
    ship: "Talon",
    rivalHealth: 100,
    durationSeconds: 615,
    initials: "PJM",
  });
  assert.equal(submitted.status, "failed");
  assert.match(submitted.message, /Survival board/);
});

test("the shell records, names and ranks a Survival run in that order", () => {
  // Recorded when the run ends, whether or not the pilot has a name yet.
  assert.match(gameCode, /const placement = recordSurvivalRun\(identifiedRun\)/);
  // A run that placed is worth signing, so it asks for initials.
  assert.match(gameCode, /awaitingInitials: placement\.rank !== null && !storedInitials/);
  // Signing re-stamps the existing row instead of adding a second copy.
  assert.match(gameCode, /nameSurvivalRun\(run\.runId, initials\)/);
  // And only then does it go to the global board.
  assert.match(gameCode, /void saveSurvivalRunToBoard\(summary\.run\)/);
});

test("each result card links to the board its run is ranked on", () => {
  assert.match(gameCode, /setBoardKind\(summary\.run\.difficulty === "survival" \? "survival" : "arcade"\)/);
  assert.match(gameCode, /summary\.run\.difficulty === "survival" \? "SURVIVAL BOARD" : "GLOBAL BOARD"/);
});

test("the leaderboard screen keeps the two boards apart", () => {
  // Two components, because they rank different things in different orders.
  assert.match(gameCode, /function SurvivalBoard\(\)/);
  assert.match(gameCode, /function ArcadeBoard\(\)/);
  assert.match(gameCode, /initialBoard\?: BoardKind/);
  // The device board is always shown, so an unavailable global board still
  // leaves the player something to beat.
  assert.match(gameCode, /THIS DEVICE/);
  assert.match(gameCode, /global Survival board is not open yet/);
});

test("the board opens above the end-game menu that links to it", () => {
  // The end-game card is the surface that sends the player here, so a board
  // ranked below it was opening behind the very thing that opened it. The
  // ordering is a documented step on the one z-index scale, not a bare number
  // and not a race between whichever rendered later in the tree.
  const scale = css.slice(css.indexOf("--z-arena"), css.indexOf("--z-system") + 40);
  const layer = (name) => Number(scale.match(new RegExp(`--z-${name}:\\s*(\\d+)`))[1]);

  assert.ok(layer("modal") > layer("dialog"), "a modal has to outrank the end-game dialog");
  assert.ok(layer("dialog") > layer("screen"), "which still outranks the screens below it");
  assert.ok(layer("system") > layer("modal"), "Menu and Fullscreen stay on top of everything");

  // The leaderboard and the codex share one backdrop, and it sits on the
  // modal layer. The end-game card stays on the dialog layer beneath it.
  assert.match(css, /\.codex-backdrop\s*\{[^}]*z-index:\s*var\(--z-modal\)/s);
  assert.match(hudCss, /\.run-summary-layer\s*\{[^}]*z-index:\s*var\(--z-dialog\)/s);
  // No rule anywhere reaches past the scale to win this by brute force.
  assert.doesNotMatch(css, /z-index:\s*9{4,}/);
  assert.doesNotMatch(hudCss, /z-index:\s*9{4,}/);
});

test("the board is usable above the end-game menu on every form factor", () => {
  // Phone immersive promotes the end-game layer to a full-viewport fixed
  // element in both orientations. Nothing there may re-rank it above the
  // modal layer, or the board would be buried again on phones only.
  const summaryRules = hudCss.match(/[^}]*\.run-summary-layer[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(summaryRules.length > 0);
  for (const rule of summaryRules) {
    assert.ok(
      !/z-index/.test(rule) || /z-index:\s*var\(--z-dialog\)/.test(rule),
      `a form-factor override re-ranked the end-game layer: ${rule}`,
    );
  }
  // The backdrop is fixed and inset on all four sides, so it covers the
  // end-game card whatever box that card is anchored in.
  assert.match(css, /\.codex-backdrop\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
  // Its own controls stay hittable: the card stops the backdrop's dismiss
  // click rather than the backdrop swallowing presses meant for the buttons.
  assert.match(gameCode, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("closing the board returns to the end-game menu rather than dismissing it", () => {
  // The board is a route pushed on the menu stack; closing pops it. The run
  // summary is separate state and is never cleared on the way back, so the
  // player lands on the card they left.
  assert.match(gameCode, /route === "leaderboard" \? <Leaderboard onClose=\{back\}/);
  const boardLink = gameCode.slice(
    gameCode.indexOf('className="run-board-link"'),
    gameCode.indexOf('className="run-board-link"') + 400,
  );
  assert.match(boardLink, /go\("leaderboard"\)/);
  assert.doesNotMatch(boardLink, /setSummary\(null\)/);
});
