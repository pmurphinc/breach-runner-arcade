import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const scores = fs.readFileSync(new URL("../app/arcade-scores.ts", import.meta.url), "utf8");
const game = fs.readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("the global board is initials-only and sends no account credentials", () => {
  assert.match(scores, /credentials: "omit"/);
  assert.doesNotMatch(scores, /fetchArcadeSession|discordSignInUrl|signed-out/);
  assert.match(game, /Classic arcade high scores\. No account or login required\./);
  assert.doesNotMatch(game, /Best run per signed-in pilot|Sign in after a run/);
});

test("a completed solo victory submits its initials and arcade run details", () => {
  assert.match(game, /runId: createArcadeRunId\(\)/);
  assert.match(game, /difficulty: hud\.difficulty/);
  assert.match(
    scores,
    /runId: run\.runId,[\s\S]*initials: run\.initials,[\s\S]*score: run\.score,[\s\S]*ship: run\.ship,[\s\S]*difficulty: run\.difficulty,[\s\S]*durationSeconds: run\.durationSeconds/
  );
  assert.match(
    game,
    /mode !== "pve"[\s\S]*summary\.run\.outcome !== "victory"[\s\S]*summary\.run\.practice[\s\S]*!summary\.run\.initials/
  );
});

test("loading the full board preserves visible rows when expansion fails", () => {
  const board = game.slice(game.indexOf("function ArcadeBoard"), game.indexOf("function Leaderboard"));
  assert.match(board, /if \(boardLimit === 10\) setEntries\(null\)/);
  assert.match(board, /if \(rows\) setEntries\(rows\);[\s\S]*else setFailed\(true\)/);
  assert.match(board, /RETRY BOARD/);
});

test("difficulty filters use player-facing labels and exclude Simulation", () => {
  const board = game.slice(game.indexOf("function ArcadeBoard"), game.indexOf("function Leaderboard"));
  for (const label of ["ALL", "STABLE", "VOLATILE", "CRITICAL"]) {
    assert.match(board, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(board, /label: "(?:SIMULATION|PRACTICE)"/);
  assert.match(board, /value: "easy", label: "STABLE"/);
  assert.match(board, /value: "difficult", label: "VOLATILE"/);
  assert.match(board, /value: "hard", label: "CRITICAL"/);
  assert.doesNotMatch(board, /entry\.difficulty\.toUpperCase/);
});

test("leaderboard difficulty is sent to the API instead of filtering a mixed Top-N response", () => {
  const fetchArcade = scores.slice(scores.indexOf("export async function fetchLeaderboard"), scores.indexOf("export async function saveScoreToMurph"));
  assert.match(scores, /new URLSearchParams\(\{ limit: String\(limit\) \}\)/);
  assert.match(scores, /if \(difficulty\) query\.set\("difficulty", difficulty\)/);
  assert.match(scores, /`\/api\/arcade\/leaderboard\?\$\{query\}`/);
  assert.doesNotMatch(fetchArcade, /body\.entries[^;]*\.filter/);
  assert.match(game, /fetchLeaderboard\(boardLimit, difficulty \?\? undefined, controller\.signal\)/);
  assert.match(game, /<span className="board-rank">\{entry\.rank\}<\/span>/, "the API's difficulty-relative rank is displayed");
});

test("switching filters reloads safely while focus alone does not select", () => {
  const board = game.slice(game.indexOf("function ArcadeBoard"), game.indexOf("function Leaderboard"));
  assert.match(board, /onClick=\{\(\) => selectDifficulty\(filter\.value\)\}/);
  assert.doesNotMatch(board, /onFocus=\{[^}]*selectDifficulty/);
  assert.match(board, /new AbortController\(\)/);
  assert.match(board, /cancelled = true; controller\.abort\(\)/);
  assert.match(board, /\[boardLimit, difficulty, reloadKey\]/);
  assert.match(board, /if \(cancelled\) return;[\s\S]*if \(rows\) setEntries\(rows\)/);
});

test("API errors leave the filters and retry control available", () => {
  const board = game.slice(game.indexOf("function ArcadeBoard"), game.indexOf("function Leaderboard"));
  assert.match(board, /board-difficulty-filter/);
  assert.match(board, /setFailed\(true\)/);
  assert.match(board, /RETRY BOARD/);
});

test("score submission keeps the original scored difficulty metadata", () => {
  assert.match(scores, /difficulty: run\.difficulty/);
});
