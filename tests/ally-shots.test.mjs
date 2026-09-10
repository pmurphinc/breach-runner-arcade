/**
 * Seeing your teammate shoot — and the rule that keeps it harmless.
 *
 * The to-do recorded this as blocked on a two-way channel. It was not: the
 * blocked channel is `coop_world_action`, which really is guest-to-host only
 * and only carries "clear" and "emp". The *position* channel has always fanned
 * out to every teammate of whoever sent it, in both directions, so the tracers
 * ride that instead and cost no new round trip.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ALLY_SHOT_LIFE_TICKS,
  ALLY_SHOT_SPEED,
  MAX_ALLY_SHOTS_PER_FRAME,
  advanceAllyShots,
  readAllyShotAngles,
  spawnAllyShots,
} from "../app/ally-shots.ts";
import { canDamagePilot } from "../app/shared-arena.js";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const rooms = readFileSync(new URL("../server/rooms.mjs", import.meta.url), "utf8");

/* --------------------------------------------------------------- geometry */

test("a tracer leaves the muzzle at the cannon's own speed", () => {
  const [east] = spawnAllyShots({ x: 100, y: 50 }, [0]);
  assert.equal(east.x, 100);
  assert.equal(east.y, 50);
  assert.ok(Math.abs(east.vx - ALLY_SHOT_SPEED) < 1e-9);
  assert.ok(Math.abs(east.vy) < 1e-9);

  const [south] = spawnAllyShots({ x: 0, y: 0 }, [90]);
  assert.ok(Math.abs(south.vy - ALLY_SHOT_SPEED) < 1e-9);
});

test("a frame's worth of fire is capped on the way in", () => {
  assert.equal(spawnAllyShots({ x: 0, y: 0 }, [0, 1, 2, 3, 4, 5]).length, MAX_ALLY_SHOTS_PER_FRAME);
  assert.deepEqual(spawnAllyShots({ x: 0, y: 0 }, []), []);
});

test("tracers travel and then expire", () => {
  let shots = spawnAllyShots({ x: 0, y: 0 }, [0]);
  shots = advanceAllyShots(shots);
  assert.ok(Math.abs(shots[0].x - ALLY_SHOT_SPEED) < 1e-9, "moved one tick along its heading");
  assert.equal(shots[0].life, ALLY_SHOT_LIFE_TICKS - 1);

  for (let tick = 0; tick < ALLY_SHOT_LIFE_TICKS; tick += 1) shots = advanceAllyShots(shots);
  assert.deepEqual(shots, [], "and is gone by the end of its life");
});

/**
 * Shorter than a real round's 110 ticks.
 *
 * A tracer is drawn from a position sample that is already a frame stale and
 * carries no collision of its own, so a long-lived one would visibly outlive
 * what it depicts — sailing through a hostile the host already destroyed.
 */
test("a tracer is shorter-lived than the round it depicts", () => {
  assert.ok(ALLY_SHOT_LIFE_TICKS < 110);
  assert.ok(ALLY_SHOT_LIFE_TICKS > 20, "but long enough to read as fire");
});

test("advancing returns a fresh list rather than mutating in place", () => {
  const shots = spawnAllyShots({ x: 0, y: 0 }, [0]);
  const next = advanceAllyShots(shots);
  assert.notEqual(shots, next);
  assert.equal(shots[0].x, 0, "the original is untouched, so no renderer catches a half-advanced list");
});

/* ------------------------------------------------------------ the wire */

test("angles arriving from another client are filtered, not trusted", () => {
  assert.deepEqual(readAllyShotAngles([90, 450, -90]), [90, 90, 270], "normalised like any heading");
  assert.equal(readAllyShotAngles([0, 1, 2, 3, 4, 5]).length, MAX_ALLY_SHOTS_PER_FRAME);
  assert.deepEqual(readAllyShotAngles([90, "spin", null, NaN, 180]), [90, 180], "one bad entry costs that entry");
  assert.deepEqual(readAllyShotAngles("nope"), []);
  assert.deepEqual(readAllyShotAngles(undefined), []);
});

/* --------------------------------------------------- the rule that matters */

/**
 * The reason these are not in `game.bullets`.
 *
 * `shared-arena.js` already refuses to let an ally round damage a pilot, and
 * that rule is necessary but not sufficient. A round in `bullets` with
 * `enemy: false` is a *player* round to the rest of the loop: it would charge
 * the rift, destroy loose power-ups and damage hostiles. In a
 * host-authoritative arena the host has already resolved all of that, so every
 * teammate round rendered locally would be a second, phantom hit.
 */
test("a teammate's fire is paint and touches nothing", () => {
  assert.ok(!canDamagePilot({ ally: true }), "the existing rule still holds");

  // Its own list, advanced and drawn, and never pushed into the real one.
  assert.match(game, /allyShots: AllyShot\[\];/);
  assert.match(game, /game\.allyShots = advanceAllyShots\(game\.allyShots\);/);
  assert.match(game, /for \(const shot of game\.allyShots\)/, "drawn from its own list");
  assert.doesNotMatch(game, /bullets\.push\([^)]*ally: true/, "never enters the damage-carrying array");
});

/* ----------------------------------------------------------- the plumbing */

/**
 * A shot buffered on a throttled tick must not be dropped.
 *
 * Position sends at 30Hz and the loop ticks at ~67Hz, so most ticks send
 * nothing. Clearing the buffer on one of those would silently lose the shot it
 * was holding.
 */
test("the shot buffer is cleared only when a frame actually goes out", () => {
  assert.match(game, /if \(netRef\.current\?\.reportPosition\(player\.x, player\.y, player\.angle, game\.pendingShotAngles\)\) \{/);
  assert.match(game, /game\.pendingShotAngles\.length = 0;/);
});

test("only the aimed round is reported, not each barrel of a spread", () => {
  // A two-barrel shot level is one trigger pull. Reporting both would draw a
  // tracer the shooter never fired.
  assert.match(game, /if \(isSharedArenaKind\(game\.mode\) && !round\.supplemental\) \{/);
});

test("the position channel already reached both pilots", () => {
  // This is what the to-do thought was missing. `updatePosition` fans out to
  // every teammate of whoever sent the frame, whichever of them that is.
  assert.match(rooms, /for \(const teammate of teammatesOf\(room, player\)\) \{/);
  assert.match(rooms, /type: "teammate", id: player\.id/);
  // And the frame it fans out now carries the shots.
  assert.match(rooms, /shots: position\.shots \?\? \[\]/);
});
