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
  const board = game.slice(game.indexOf("function Leaderboard"), game.indexOf("function createPreference"));
  assert.match(board, /if \(boardLimit === 10\) setEntries\(null\)/);
  assert.match(board, /if \(rows\) setEntries\(rows\);[\s\S]*else setFailed\(true\)/);
  assert.match(board, /RETRY BOARD/);
});
