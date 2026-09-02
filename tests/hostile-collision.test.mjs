/**
 * Player rounds resolve against every hostile-side body, not just enemies.
 *
 * The original resolves one uniform pass — all hostile sprites against all
 * friendly ones — which is why enemy fire, loose power-ups and blooms are all
 * shootable there. This game kept a single bullet array with an `enemy` flag and
 * only ever tested rounds against `game.enemies`. These lock in the wider pass.
 *
 * Source-level: the behaviours live inside the game loop in game.tsx, which has
 * no seam to import. The browser suites that do drive the loop are gated on a
 * dev server and skip on a bare checkout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ENEMY_STATS } from "../app/game-data.ts";
import { PUP_RADIUS } from "../app/pup-world.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** The body of the player-round branch of the bullet loop. */
const playerRound = game.slice(
  game.indexOf("// Additional cannon/PUP contact only"),
  game.indexOf("game.powers.forEach((power)")
);

test("player rounds trade with hostile rounds", () => {
  assert.match(playerRound, /for \(const hostile of game\.bullets\)/);
  assert.match(playerRound, /if \(!hostile\.enemy \|\| hostile\.life <= 0 \|\| bullet\.life <= 0\) continue/);
  // Both die: a round that destroys incoming fire is spent doing it.
  assert.match(playerRound, /hostile\.life = 0;\s*\n\s*bullet\.life = 0;/);
});

test("loose power-ups are shootable, but only after a spawn grace", () => {
  assert.match(game, /const PUP_SHOOT_GRACE_TICKS = 20;/);
  assert.match(game, /const PUP_LIFE_TICKS = 900;/);
  assert.match(game, /return pickup\.life > 0 && pickup\.life <= PUP_LIFE_TICKS - PUP_SHOOT_GRACE_TICKS;/);
  assert.match(playerRound, /if \(!pupIsShootable\(loose\)\) continue/);
  // Hit radius comes from the canonical loose-PUP size, not a second constant.
  assert.match(playerRound, /dist\(bullet, loose\) < PUP_RADIUS \+ 4/);
  assert.ok(PUP_RADIUS > 0);
});

test("Kestrel's salvage link still collects rather than destroys", () => {
  assert.match(playerRound, /if \(bullet\.life > 0 && !bullet\.salvageLinked\) \{/);
  // The collecting branch runs first and consumes the round on contact.
  assert.ok(
    playerRound.indexOf("salvageLinked) {") < playerRound.indexOf("!bullet.salvageLinked"),
    "salvage collection must resolve before the destroy pass"
  );
});

test("a bloom's drawn size is its health, floored at spawn size", () => {
  assert.match(game, /const BLOOM_RADIUS_PER_HP = 0\.35;/);
  assert.match(game, /return base\.radius \+ Math\.max\(0, hp - base\.hp\) \* BLOOM_RADIUS_PER_HP;/);
  assert.match(game, /enemy\.radius = bloomRadiusForHp\(enemy\.hp\)/);
  // Health still climbs on the same cadence; only the coupling is new.
  assert.match(game, /enemy\.kind === "inflator"[\s\S]{0,120}enemy\.hp \+= 1/);
  assert.match(game, /enemy\.maxHp = Math\.max\(enemy\.maxHp, enemy\.hp\)/);
});

test("the bloom floor is the size it spawned at", () => {
  // Reimplements bloomRadiusForHp against the shipped stats: damage holds a
  // bloom back to its spawn size and no further.
  const base = ENEMY_STATS.inflator;
  const radiusFor = (hp) => base.radius + Math.max(0, hp - base.hp) * 0.35;
  assert.equal(radiusFor(base.hp), base.radius, "at spawn health it is spawn size");
  assert.equal(radiusFor(base.hp - 25), base.radius, "damaged below spawn health it stays spawn size");
  assert.ok(radiusFor(base.hp + 40) > base.radius, "left alone it still inflates");
});

test("the screen clear takes loose power-ups with it", () => {
  const clear = game.slice(game.indexOf('else if (type === "clear")'), game.indexOf('else if (type === "health")'));
  assert.match(clear, /for \(const loose of game\.pickups\)/);
  assert.match(clear, /loose\.life = 0/);
  // The power-up being collected is already spent; do not double-handle it.
  assert.match(clear, /if \(loose === pickup \|\| loose\.life <= 0\) continue/);
});

test("a collected power-up is named where it was picked up, and only there", () => {
  assert.match(game, /type PickupLabel = \{/);
  assert.match(game, /const pushPickupLabel = \(game: Game, type: PickupId, x: number, y: number\)/);
  assert.match(game, /pushPickupLabel\(game, type, pickup\.x, pickup\.y\)/);
  assert.match(game, /life: ticksForSeconds\(1\.6\)/, "fades after a second or two");
  // One event, one notification: the shared coach line no longer duplicates it.
  assert.doesNotMatch(game, /COLLECTED`/);
  assert.match(game, /for \(const label of game\.pickupLabels\) drawPickupLabel\(label\)/);
});

test("pickup labels are aged, expired, and cleared with the arena", () => {
  assert.match(game, /game\.pickupLabels\.forEach\(\(label\) => \{ label\.age \+= 1; \}\)/);
  assert.match(game, /compact\(game\.pickupLabels, \(item\) => item\.age < item\.life\)/);
  assert.match(game, /game\.pickupLabels\.length = 0;/, "the singularity sweep must not leave labels behind");
});

test("PvP already delivers sent payloads as real hostiles", () => {
  // Worth pinning: an earlier plan recorded PvP as trading flat integrity
  // damage. It does not — the receiving client spawns the actual wave. Only the
  // PvE branch, which has no opposing pilot to spawn anything at, uses a number.
  const pvpStart = game.indexOf('if (game.mode === "pvp") {');
  const pvp = game.slice(pvpStart, game.indexOf("} else if (", pvpStart));
  assert.match(pvp, /for \(const attack of netRef\.current\?\.drainIncoming\(\) \?\? \[\]\)/);
  assert.match(pvp, /addIncoming\(game, attack\.weapon as PowerId\)/);
  assert.doesNotMatch(pvp, /rivalDamageFor/);
  // rivalDamageFor survives for PvE and the codex readout, and nowhere else.
  assert.equal((game.match(/rivalDamageFor\(/g) ?? []).length, 2);
});

test("hostile hulls match the reference values", () => {
  assert.equal(ENEMY_STATS.turret.hp, 50);
  assert.equal(ENEMY_STATS.minelayer.hp, 50);
  assert.equal(ENEMY_STATS.gunship.hp, 50);
  assert.equal(ENEMY_STATS.scarab.hp, 20);
  // Radii are this project's own and were never part of the drift.
  assert.equal(ENEMY_STATS.gunship.radius, 25);
  assert.equal(ENEMY_STATS.scarab.radius, 15);
});
