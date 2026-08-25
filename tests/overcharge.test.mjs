/**
 * The Normal Power-Up → Enhanced Ship Special pattern.
 *
 * These assertions are what stop the pattern quietly becoming three bespoke
 * abilities again: every overcharge has to name a real power-up, has to beat
 * that power-up on the axis it claims to, and has to be paid for with a
 * cooldown rather than being free.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ENEMY_COUNTS, SHIPS, SHIP_SPECIALS, WEAPONS } from "../app/game-data.ts";
import { TICK_MS } from "../app/difficulty.ts";
import {
  SCRAMBLE_DAMAGE_MULTIPLIER,
  SHIP_OVERCHARGES,
  blastDamageAt,
  blastRadiusAt,
  blastRingRadii,
  cannonShotBudgetUsed,
  countsTowardShotBudget,
  overchargeFor,
  overchargeSource,
  overchargeSourceColor,
  overchargeTicks,
  riderHandling,
  scrambledDamage,
  volleyHeadings,
} from "../app/overcharge.ts";

const specs = Object.values(SHIP_OVERCHARGES);

test("every overcharge is an enhanced build of a power-up that exists", () => {
  assert.equal(specs.length, 3);
  for (const spec of specs) {
    assert.ok(WEAPONS[spec.source], `${spec.id} names a power-up that is not in the catalog`);
    assert.equal(WEAPONS[spec.source].sendable, true, `${spec.id} must derive from a real pickup`);
    assert.equal(overchargeSourceColor(spec), WEAPONS[spec.source].color);
    assert.equal(overchargeSource(spec), `Overcharged ${WEAPONS[spec.source].name}`);
    assert.ok(spec.differences.length >= 4, `${spec.id} must say how it differs from the pickup`);
  }
});

test("each overcharge derives from a different power-up, so no two feel alike", () => {
  assert.equal(new Set(specs.map((spec) => spec.source)).size, specs.length);
  assert.equal(new Set(specs.map((spec) => spec.accent)).size, specs.length);
});

test("the spec table agrees with the shipped ability names and cooldowns", () => {
  for (const spec of specs) {
    assert.equal(spec.name, SHIP_SPECIALS[spec.ship].name, `${spec.id} name drift`);
    assert.equal(spec.cooldownSeconds, SHIP_SPECIALS[spec.ship].cooldownSeconds, `${spec.id} cooldown drift`);
    assert.ok(SHIPS.some((ship) => ship.id === spec.ship));
  }
});

test("a special is never spammable: cooldown always outlasts the effect", () => {
  for (const spec of specs) {
    const ticks = overchargeTicks(spec);
    assert.ok(ticks.cooldown > ticks.rider, `${spec.id} rider outlives its cooldown`);
    assert.ok(ticks.cooldown > ticks.blast, `${spec.id} blast outlives its cooldown`);
    assert.ok(ticks.cooldown > ticks.scramble, `${spec.id} scramble outlives its cooldown`);
    assert.ok(ticks.cooldown > ticks.invuln, `${spec.id} immunity outlives its cooldown`);
    assert.ok(spec.cooldownSeconds >= 10, `${spec.id} cooldown is too short to be a special`);
  }
});

test("seconds convert to ticks through the one simulation clock", () => {
  const core = overchargeFor("hunter");
  assert.equal(overchargeTicks(core).cooldown, Math.round(18 * 1000 / TICK_MS));
});

test("the swarm overcharges the tracker wave rather than copying it", () => {
  const swarm = overchargeFor("wing");
  // Same count as the hostile wave, so the escalation reads as the same
  // weapon: what changed is whose side they are on and how hard they hit.
  assert.equal(swarm.volley.count, ENEMY_COUNTS.heatseeker);
  assert.ok(swarm.volley.damage > 10, "a hostile tracker costs 10 on contact");
  assert.ok(swarm.volley.speed > 7, "a hostile tracker flies at 7");
});

test("the scrambler pulse out-reaches the pickup it is built from", () => {
  const scrambler = overchargeFor("squid");
  // The ordinary PULSE SCRAMBLER dies once its single ring passes 320.
  assert.ok(scrambler.blast.radius > 320);
  assert.ok(scrambler.blast.rings > 1);
});

test("the core blast hits harder than the bomb it is built from", () => {
  const core = overchargeFor("hunter");
  // A CORE BOMB tops out at 40 damage and falls away from there.
  assert.ok(blastDamageAt(0, core.blast) > 40);
  assert.ok(core.blast.guaranteedDrops, "staying in the fight has to pay Talon back");
});

test("volley headings centre on the nose and span the stated arc", () => {
  const headings = volleyHeadings(90, 5, 40);
  assert.equal(headings.length, 5);
  assert.equal(headings[0], 70);
  assert.equal(headings[4], 110);
  assert.equal(headings[2], 90, "the middle missile flies straight ahead");
  // A single missile must not be pushed onto one edge of the arc.
  assert.deepEqual(volleyHeadings(12, 1, 40), [12]);
});

test("a blast band expands from nothing to the rim and stops there", () => {
  const core = overchargeFor("hunter").blast;
  assert.equal(blastRadiusAt(0, core), 0);
  assert.ok(blastRadiusAt(1, core) > 0);
  assert.equal(Math.round(blastRadiusAt(core.expandTicks, core)), core.radius);
  assert.equal(Math.round(blastRadiusAt(core.expandTicks * 4, core)), core.radius, "no runaway ring");

  let previous = -1;
  for (let age = 0; age <= core.expandTicks; age += 1) {
    const radius = blastRadiusAt(age, core);
    assert.ok(radius >= previous, "the band must never travel backwards");
    previous = radius;
  }
});

test("blast damage falls off with distance and stops at the rim", () => {
  const core = overchargeFor("hunter").blast;
  assert.equal(blastDamageAt(0, core), core.damage);
  assert.equal(blastDamageAt(core.radius, core), core.edgeDamage);
  assert.equal(blastDamageAt(core.radius + 1, core), 0);
  assert.ok(blastDamageAt(core.radius / 2, core) < core.damage);
  assert.ok(blastDamageAt(core.radius / 2, core) > core.edgeDamage);

  // A pure control pulse must never leak damage at any distance.
  const scrambler = overchargeFor("squid").blast;
  for (const distance of [0, 50, 200, 430, 900]) {
    assert.equal(blastDamageAt(distance, scrambler), 0);
  }
});

test("ring radii trail the leading edge and never go negative", () => {
  const scrambler = overchargeFor("squid").blast;
  const radii = blastRingRadii(4, scrambler);
  assert.equal(radii.length, scrambler.rings);
  for (let i = 1; i < radii.length; i += 1) assert.ok(radii[i] <= radii[i - 1]);
  for (const radius of blastRingRadii(0, scrambler)) assert.ok(radius >= 0);
});

test("a rider scales handling in either direction and is inert when absent", () => {
  assert.deepEqual(riderHandling(0.13, 3.5, null), { acceleration: 0.13, maxSpeed: 3.5 });

  const boost = riderHandling(0.1, 3, overchargeFor("wing").rider);
  assert.ok(boost.acceleration > 0.1 && boost.maxSpeed > 3);

  const stagger = riderHandling(0.1, 3, overchargeFor("hunter").rider);
  assert.ok(stagger.acceleration < 0.1 && stagger.maxSpeed < 3, "the stagger is the tradeoff");
});

test("scramble converts control into progress without touching normal fire", () => {
  assert.equal(scrambledDamage(20, false), 20);
  assert.equal(scrambledDamage(20, true), 20 * SCRAMBLE_DAMAGE_MULTIPLIER);
  assert.ok(SCRAMBLE_DAMAGE_MULTIPLIER > 1 && SCRAMBLE_DAMAGE_MULTIPLIER <= 2);
});

test("a special that shoves its own ship declares it rather than being special-cased", () => {
  // Talon is the only frame with recoil today; the point of the field is that
  // the game loop never has to know which frame that is.
  const recoiling = specs.filter((spec) => spec.recoil !== undefined);
  assert.deepEqual(recoiling.map((spec) => spec.id), ["core"]);
  for (const spec of recoiling) {
    assert.ok(spec.recoil >= 0 && spec.recoil < 1, `${spec.id} recoil must bleed momentum`);
  }
});

test("ships without an overcharge keep their bespoke specials", () => {
  for (const id of ["tank", "rabbit", "turtle", "flash", "flagship"]) {
    assert.equal(overchargeFor(id), null, `${id} must not be swept into the rework`);
  }
});

test("a special never spends the cannon's on-screen shot budget", () => {
  const cannonRound = { enemy: false };
  const specialRound = { enemy: false, special: true };
  const hostileRound = { enemy: true };

  assert.equal(countsTowardShotBudget(cannonRound), true);
  assert.equal(countsTowardShotBudget(specialRound), false, "this is the Talon lockout bug");
  assert.equal(countsTowardShotBudget(hostileRound), false);

  // Starling's twelve trackers used to be twelve rounds the cannon could no
  // longer fire. Only the two cannon rounds may be charged for here.
  const swarm = Array.from({ length: overchargeFor("wing").volley.count }, () => ({ ...specialRound }));
  const live = [cannonRound, cannonRound, ...swarm, hostileRound];
  assert.equal(cannonShotBudgetUsed(live), 2);
  assert.equal(cannonShotBudgetUsed([]), 0);
});
