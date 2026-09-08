import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CORE_BOMB_DRIFT_MAX,
  CORE_BOMB_DRIFT_MIN,
  CORE_BOMB_MAX_SPEED,
  CORE_BOMB_RIFT_REACH,
  CORE_BOMB_SHOVE,
  coreBombRift,
  shoveCoreBomb,
} from "../app/core-bomb.ts";
import { ENEMY_STATS, WEAPONS } from "../app/game-data.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("a round gives the bomb a quarter of its own velocity", () => {
  assert.equal(CORE_BOMB_SHOVE, 0.25);
  const bomb = { x: 0, y: 0, vx: 0, vy: 0 };
  const shoved = shoveCoreBomb(bomb, { vx: 8, vy: -4 });
  assert.equal(shoved.vx, 2);
  assert.equal(shoved.vy, -1);
});

test("shoves accumulate, so a stream of fire drives it", () => {
  let bomb = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 3; i += 1) bomb = { ...bomb, ...shoveCoreBomb(bomb, { vx: 4, vy: 0 }) };
  assert.equal(bomb.vx, 3, "three rounds at 4 each add a quarter of each");
});

/**
 * Without a ceiling a sustained stream accelerates the bomb without limit, and
 * a bomb moving faster than the rift's own reach would step clean over the
 * thing it was aimed at.
 */
test("a driven bomb cannot be pushed past the rift it is aimed at", () => {
  let bomb = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 200; i += 1) bomb = { ...bomb, ...shoveCoreBomb(bomb, { vx: 20, vy: 0 }) };
  assert.equal(bomb.vx, CORE_BOMB_MAX_SPEED, "speed is capped, not left to run away");
  assert.ok(
    CORE_BOMB_MAX_SPEED < CORE_BOMB_RIFT_REACH,
    "a single tick of travel must stay well inside the rift's reach"
  );
});

test("the cap is a speed, so a diagonal push is not quietly faster", () => {
  let bomb = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 200; i += 1) bomb = { ...bomb, ...shoveCoreBomb(bomb, { vx: 20, vy: 20 }) };
  assert.ok(Math.abs(Math.hypot(bomb.vx, bomb.vy) - CORE_BOMB_MAX_SPEED) < 1e-9);
});

test("the rift is found by reach, and a bomb short of it is not delivered", () => {
  const rifts = [{ x: 500, y: 300 }];
  assert.equal(coreBombRift({ x: 500, y: 300, vx: 0, vy: 0 }, rifts), rifts[0], "dead on");
  assert.equal(coreBombRift({ x: 500 + CORE_BOMB_RIFT_REACH - 1, y: 300, vx: 0, vy: 0 }, rifts), rifts[0]);
  assert.equal(coreBombRift({ x: 500 + CORE_BOMB_RIFT_REACH + 1, y: 300, vx: 0, vy: 0 }, rifts), null);
  assert.equal(coreBombRift({ x: 0, y: 0, vx: 0, vy: 0 }, []), null, "no rift, no delivery");
});

test("reach clears the bomb's own body, so a near miss is still a hit", () => {
  assert.ok(CORE_BOMB_RIFT_REACH > ENEMY_STATS.nuke.radius * 2);
});

/* ------------------------------------------------------- wiring in the loop */

test("the bomb drifts instead of being pinned where it spawned", () => {
  // It is no longer in the anchored set, and it is given a drift on creation.
  assert.match(
    game,
    /const anchored = enemy\.kind === "turret" \|\| enemy\.kind === "beam" \|\| enemy\.kind === "emp";/,
    "the core bomb must not be anchored any more"
  );
  assert.match(game, /if \(kind === "nuke"\) speed = range\(CORE_BOMB_DRIFT_MIN, CORE_BOMB_DRIFT_MAX\);/);
  assert.ok(CORE_BOMB_DRIFT_MIN > 0, "a drift of zero is the bug this fixes");
  assert.ok(CORE_BOMB_DRIFT_MAX < 2, "and it should be slow enough to aim");
});

/**
 * Steering and destroying are the same button, so the choice between them has
 * to be real: a round that kills the bomb must not also deliver it.
 */
test("only a bomb that survives the round is steered by it", () => {
  assert.match(game, /if \(enemy\.kind === "nuke" && enemy\.hp > 0\) \{/);
  assert.match(game, /const shoved = shoveCoreBomb\(enemy, bullet\);/);
  assert.match(game, /enemy\.shoved = true;/);
});

/**
 * The payoff is gated on the pilot having actually hit it. An untouched bomb
 * drifting onto a rift would be a free strike nobody aimed.
 */
test("only a bomb the pilot has hit goes off on a rift", () => {
  assert.match(game, /if \(enemy\.shoved && \(enemy\.countdown \?\? 0\) > 0\) \{/);
  assert.match(game, /const struck = coreBombRift\(enemy, game\.portals\);/);
  assert.match(game, /detonateOnRift\(game\);/);
});

test("a delivered bomb costs the rift exactly what a launched one does", () => {
  // Same warhead, delivered by hand rather than through the portal, so it is
  // worth neither more nor less.
  assert.match(game, /const damage = rivalDamageFor\("nuke"\);/);
  // The enrage shield gets its say, and only integrity actually removed scores.
  assert.match(game, /const hit = absorbEnrageShield\(game\.enrageRecovery, damage\);/);
  assert.match(game, /awardRiftDamage\(game, game\.lastRivalDamage\);/);
  assert.match(game, /if \(game\.lastRivalDamage > 0\) releaseRiftBudget\(game\);/);
});

test("the catalogue no longer tells the pilot it sits still", () => {
  assert.doesNotMatch(WEAPONS.nuke.behavior, /sits still/i);
  assert.match(WEAPONS.nuke.behavior, /drifts/i);
  assert.match(WEAPONS.nuke.role, /shoot it to shove it/i);
});
