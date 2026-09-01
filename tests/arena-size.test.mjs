/**
 * The arena is a per-game value, not a module constant.
 *
 * This is the refactor Classic Wormhole needs: its board is square and scales
 * with the player count, and nothing downstream may assume 16:10. Source-level
 * because the couplings that break a square arena are in the render and measure
 * paths inside game.tsx, which has no seam to import.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ARENA_SIZES, DEFAULT_ARENA, arenaForOpponents, isSquareArena, squareArena } from "../app/arena.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("Breach Runner's own arena is unchanged", () => {
  assert.deepEqual(DEFAULT_ARENA, { width: 1504, height: 940 });
});

test("square arenas scale with the opponent count", () => {
  assert.deepEqual(ARENA_SIZES, { solo: 873, duel: 1310, melee: 1572 });
  assert.deepEqual(arenaForOpponents(1), { width: 873, height: 873 });
  assert.deepEqual(arenaForOpponents(2), { width: 1310, height: 1310 });
  assert.deepEqual(arenaForOpponents(3), { width: 1310, height: 1310 });
  assert.deepEqual(arenaForOpponents(4), { width: 1572, height: 1572 });
  assert.deepEqual(arenaForOpponents(9), { width: 1572, height: 1572 });
  // A degenerate count still yields a playable board rather than NaN.
  assert.deepEqual(arenaForOpponents(0), { width: 873, height: 873 });
});

test("squareArena is square", () => {
  const arena = squareArena(1310);
  assert.equal(arena.width, arena.height);
  assert.ok(isSquareArena(arena));
  assert.ok(!isSquareArena(DEFAULT_ARENA), "the default board is not square");
});

test("createGame takes the arena rather than assuming one", () => {
  assert.match(game, /import \{ type ArenaSize, DEFAULT_ARENA \} from "\.\/arena"/);
  assert.match(game, /arena: ArenaSize = DEFAULT_ARENA/);
  assert.match(game, /worldWidth: arena\.width,\s*\n\s*worldHeight: arena\.height,/);
});

test("nothing in the simulation reads the module constants any more", () => {
  // The constants survive only as the default arena's own definition. Every
  // other reference was a place a square world would have been letterboxed,
  // scattered wrongly, or aimed from the wrong centre.
  assert.doesNotMatch(game, /WORLD_WIDTH|WORLD_HEIGHT/, "arena size now lives in ./arena");
  assert.doesNotMatch(game, /% \(WORLD_WIDTH - 180\)/, "world landmarks must scatter across the live arena");
  assert.doesNotMatch(game, /spawn\.y - WORLD_HEIGHT \/ 2/, "the launch burst must aim from the live centre");
});

test("the canvas letterbox follows the running arena's aspect", () => {
  assert.match(game, /const arenaWidth = Math\.max\(1, gameRef\.current\.worldWidth\)/);
  assert.match(game, /const arenaHeight = Math\.max\(1, gameRef\.current\.worldHeight\)/);
  assert.match(game, /availableHeight \* arenaWidth \/ arenaHeight/);
  assert.match(game, /canvasWidth \* arenaHeight \/ arenaWidth/);
});

test("both camera fits read the live arena, and they agree", () => {
  // The renderer and the pointer-to-world mapping have to use one fit or a
  // click lands somewhere other than where it looks.
  const fits = [...game.matchAll(/Math\.min\(VIEW_WIDTH \/ game\.worldWidth, \w+ \/ game\.worldHeight\)/g)];
  assert.equal(fits.length, 2, "renderer and pointer camera must share one Full Arena fit");
});

test("world landmarks cannot divide by zero on a degenerate arena", () => {
  assert.match(game, /Math\.max\(1, rockField\.worldWidth - 180\)/);
  assert.match(game, /Math\.max\(1, rockField\.worldHeight - 160\)/);
});
