import test from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTIES,
  PVP_RULES,
  absorbCollisionDamage,
  advanceWormholeAngle,
  createCollisionShield,
  createContactHazard,
  pilotSpawn,
  rulesFor,
  tickCollisionShield,
  tickContactHazard,
  ticksForSeconds,
  wormholePosition,
} from "../app/difficulty.ts";

const WORLD = 940;
const EASY = DIFFICULTIES.easy;
const DIFFICULT = DIFFICULTIES.difficult;
const HARD = DIFFICULTIES.hard;

/** Run the shield's per-tick recharge countdown n times. */
function idle(state, rules, ticks) {
  let restored = false;
  for (let i = 0; i < ticks; i += 1) {
    if (tickCollisionShield(state, rules).restored) restored = true;
  }
  return restored;
}

// ------------------------------------------------------------ EASY: wormhole

test("easy wormhole stays exactly centred, whatever the orbit phase", () => {
  const centre = { x: WORLD / 2, y: WORLD / 2 };
  for (const angle of [0, 45, 90, 180, 270, 359.5]) {
    assert.deepEqual(wormholePosition(EASY, WORLD, angle), centre);
  }
});

test("easy wormhole never advances its orbit angle", () => {
  let angle = 0;
  for (let i = 0; i < 500; i += 1) angle = advanceWormholeAngle(EASY, angle);
  assert.equal(angle, 0);
  assert.deepEqual(wormholePosition(EASY, WORLD, angle), { x: WORLD / 2, y: WORLD / 2 });
});

test("easy pilot spawns clear of the centred wormhole", () => {
  const spawn = pilotSpawn(EASY, WORLD);
  const centre = WORLD / 2;
  const separation = Math.hypot(spawn.x - centre, spawn.y - centre);
  assert.ok(
    separation > HARD.contactHazard.radius * 2,
    `spawn only ${separation}px from a wormhole of radius ${HARD.contactHazard.radius}`
  );
});

// -------------------------------------------------------- EASY: shield basics

test("easy pilot begins with a full collision shield", () => {
  const shield = createCollisionShield(EASY);
  assert.ok(shield);
  assert.equal(shield.charge, EASY.collisionShield.capacity);
  assert.equal(shield.charge, shield.capacity);
  assert.equal(shield.rechargeIn, 0);
});

test("shield absorbs 100% of eligible collision damage and hull is untouched", () => {
  const shield = createCollisionShield(EASY);
  const hit = absorbCollisionDamage(shield, 20, EASY);
  assert.equal(hit.toHull, 0, "no damage should reach hull");
  assert.equal(hit.absorbed, 20);
  assert.equal(shield.charge, 20);
});

test("hull stays unchanged while sufficient shield remains", () => {
  const shield = createCollisionShield(EASY);
  let hull = 240;
  for (const amount of [2, 8, 10, 8, 2, 8]) {
    // 38 total, one under the 40 capacity.
    hull -= absorbCollisionDamage(shield, amount, EASY).toHull;
  }
  assert.equal(hull, 240);
  assert.equal(shield.charge, 2);
});

test("overflow reaches hull once the shield is depleted", () => {
  const shield = createCollisionShield(EASY);
  const first = absorbCollisionDamage(shield, 30, EASY);
  assert.equal(first.toHull, 0);

  const overflow = absorbCollisionDamage(shield, 25, EASY);
  assert.equal(overflow.absorbed, 10, "only the last 10 of shield is available");
  assert.equal(overflow.toHull, 15, "the remaining 15 must reach hull");
  assert.equal(shield.charge, 0);
  assert.equal(overflow.broke, true);

  // With the shield empty, further collisions land in full.
  const after = absorbCollisionDamage(shield, 8, EASY);
  assert.equal(after.toHull, 8);
  assert.equal(after.broke, false, "an already-empty shield does not re-break");
});

test("difficult and hard have no collision shield to absorb anything", () => {
  assert.equal(createCollisionShield(DIFFICULT), null);
  assert.equal(createCollisionShield(HARD), null);
});

// ------------------------------------------------------ EASY: shield recharge

test("shield does not restore before four uninterrupted seconds", () => {
  const shield = createCollisionShield(EASY);
  absorbCollisionDamage(shield, 40, EASY);
  assert.equal(shield.charge, 0);

  const oneTickShort = ticksForSeconds(4) - 1;
  assert.equal(idle(shield, EASY, oneTickShort), false);
  assert.equal(shield.charge, 0, "still empty one tick before the delay elapses");
});

test("shield restores fully after four uninterrupted seconds", () => {
  const shield = createCollisionShield(EASY);
  absorbCollisionDamage(shield, 40, EASY);
  assert.equal(idle(shield, EASY, ticksForSeconds(4)), true);
  assert.equal(shield.charge, shield.capacity);
  assert.equal(shield.rechargeIn, 0);
});

test("another collision resets the timer to a full four seconds", () => {
  const shield = createCollisionShield(EASY);
  absorbCollisionDamage(shield, 20, EASY);

  // Wait almost the whole delay, then take one more hit.
  idle(shield, EASY, ticksForSeconds(4) - 10);
  absorbCollisionDamage(shield, 8, EASY);
  assert.equal(shield.rechargeIn, ticksForSeconds(4), "timer restarted at four seconds");

  // The ten ticks that were left over must no longer be enough.
  assert.equal(idle(shield, EASY, 10), false);
  assert.ok(shield.charge < shield.capacity);

  // The full delay from the later hit does restore it.
  assert.equal(idle(shield, EASY, ticksForSeconds(4)), true);
  assert.equal(shield.charge, shield.capacity);
});

test("a collision absorbed with charge to spare still restarts the timer", () => {
  const shield = createCollisionShield(EASY);
  absorbCollisionDamage(shield, 2, EASY);
  assert.equal(shield.rechargeIn, ticksForSeconds(4));
});

test("shield recharge is independent of position and of the wormhole", () => {
  // The recharge API takes no position and no wormhole state at all, so the
  // only way to show independence is that identical tick counts give identical
  // results regardless of where the caller imagines the ship to be.
  const atWormhole = createCollisionShield(EASY);
  const farCorner = createCollisionShield(EASY);
  absorbCollisionDamage(atWormhole, 40, EASY);
  absorbCollisionDamage(farCorner, 40, EASY);

  const delay = ticksForSeconds(4);
  assert.equal(idle(atWormhole, EASY, delay), true);
  assert.equal(idle(farCorner, EASY, delay), true);
  assert.deepEqual(atWormhole, farCorner);
  assert.equal(tickCollisionShield.length, 2, "signature takes only state and rules");
});

// ------------------------------------------------------------ DIFFICULT mode

test("difficult wormhole moves along its orbit", () => {
  let angle = 0;
  const start = wormholePosition(DIFFICULT, WORLD, angle);
  for (let i = 0; i < 60; i += 1) angle = advanceWormholeAngle(DIFFICULT, angle);
  const later = wormholePosition(DIFFICULT, WORLD, angle);
  assert.ok(angle > 0, "orbit angle advanced");
  assert.ok(Math.hypot(later.x - start.x, later.y - start.y) > 1, "wormhole moved");
});

test("difficult wormhole motion is trackable, not teleporting", () => {
  // A step larger than the ship could plausibly follow would read as a jump.
  let angle = 0;
  let previous = wormholePosition(DIFFICULT, WORLD, angle);
  for (let i = 0; i < 720; i += 1) {
    angle = advanceWormholeAngle(DIFFICULT, angle);
    const next = wormholePosition(DIFFICULT, WORLD, angle);
    const step = Math.hypot(next.x - previous.x, next.y - previous.y);
    assert.ok(step < 4, `single-tick step of ${step}px is not trackable`);
    previous = next;
  }
});

test("difficult has neither a collision shield nor a contact hazard", () => {
  assert.equal(DIFFICULT.collisionShield.enabled, false);
  assert.equal(DIFFICULT.contactHazard.enabled, false);

  const state = createContactHazard();
  const result = tickContactHazard(state, DIFFICULT, 0, 240);
  assert.equal(result.damage, 0, "sitting on the wormhole costs nothing in difficult");
  assert.equal(result.overlapping, false);
});

// ------------------------------------------------------------- HARD contact

test("hard wormhole moves and has no collision shield", () => {
  assert.equal(HARD.wormhole.kind, "orbit");
  assert.equal(HARD.collisionShield.enabled, false);
  assert.equal(createCollisionShield(HARD), null);
});

test("hard contact applies damage in discrete visible ticks", () => {
  const state = createContactHazard();
  const maxHealth = 240;
  const hits = [];

  // Hold contact for three whole tick intervals.
  for (let i = 0; i < HARD.contactHazard.tickIntervalTicks * 3; i += 1) {
    const result = tickContactHazard(state, HARD, 0, maxHealth);
    if (result.damage > 0) hits.push(result.damage);
  }

  assert.equal(hits.length, 3, "one hit per interval, first landing immediately");
  for (const hit of hits) {
    assert.equal(hit, maxHealth * HARD.contactHazard.damagePerTickFraction);
  }
});

test("one continuous contact cannot destroy a full-health pilot", () => {
  for (const maxHealth of [180, 240, 320, 500]) {
    const state = createContactHazard();
    let hull = maxHealth;
    // Sit inside the wormhole for a full minute without ever leaving.
    for (let i = 0; i < ticksForSeconds(60); i += 1) {
      hull -= tickContactHazard(state, HARD, 0, maxHealth).damage;
    }
    const lost = maxHealth - hull;
    assert.ok(hull > 0, `hull hit zero on a single episode at maxHealth ${maxHealth}`);
    assert.ok(
      lost <= maxHealth * 0.33 + 1e-9,
      `episode cost ${(lost / maxHealth) * 100}% of hull, over the 33% ceiling`
    );
    assert.ok(
      lost >= maxHealth * 0.3 - 1e-9,
      `episode cost only ${(lost / maxHealth) * 100}% of hull, under the 30% floor`
    );
  }
});

test("once capped, further overlap in the same episode costs nothing", () => {
  const state = createContactHazard();
  const maxHealth = 240;
  let hull = maxHealth;
  for (let i = 0; i < ticksForSeconds(10); i += 1) {
    hull -= tickContactHazard(state, HARD, 0, maxHealth).damage;
  }
  const cappedHull = hull;
  assert.equal(tickContactHazard(state, HARD, 0, maxHealth).capped, true);

  for (let i = 0; i < ticksForSeconds(20); i += 1) {
    hull -= tickContactHazard(state, HARD, 0, maxHealth).damage;
  }
  assert.equal(hull, cappedHull, "capped episode kept dealing damage");
});

test("a new episode requires leaving the radius completely", () => {
  const state = createContactHazard();
  const maxHealth = 240;
  const { radius, reentryGraceTicks } = HARD.contactHazard;
  let hull = maxHealth;

  // Cap out the first episode.
  for (let i = 0; i < ticksForSeconds(10); i += 1) {
    hull -= tickContactHazard(state, HARD, 0, maxHealth).damage;
  }
  const afterFirst = hull;
  assert.ok(afterFirst < maxHealth);

  // Step just outside, but for less than the grace period, then return.
  for (let i = 0; i < reentryGraceTicks - 1; i += 1) {
    hull -= tickContactHazard(state, HARD, radius + 5, maxHealth).damage;
  }
  for (let i = 0; i < ticksForSeconds(5); i += 1) {
    hull -= tickContactHazard(state, HARD, 0, maxHealth).damage;
  }
  assert.equal(hull, afterFirst, "a partial exit must not hand back a fresh episode");

  // Now leave properly and come back.
  for (let i = 0; i < reentryGraceTicks + 1; i += 1) {
    tickContactHazard(state, HARD, radius + 50, maxHealth);
  }
  const reentry = tickContactHazard(state, HARD, 0, maxHealth);
  assert.equal(reentry.entered, true, "a full exit must allow a new episode");
  assert.ok(reentry.damage > 0);
});

test("edge jitter across the boundary cannot create false contacts", () => {
  const state = createContactHazard();
  const maxHealth = 240;
  const { radius } = HARD.contactHazard;
  let hull = maxHealth;

  // Oscillate either side of the contact boundary for ten seconds.
  for (let i = 0; i < ticksForSeconds(10); i += 1) {
    const distance = i % 2 === 0 ? radius - 0.5 : radius + 0.5;
    hull -= tickContactHazard(state, HARD, distance, maxHealth).damage;
  }

  const lost = maxHealth - hull;
  assert.ok(
    lost <= maxHealth * 0.33 + 1e-9,
    `jitter drained ${(lost / maxHealth) * 100}% of hull — it opened extra episodes`
  );
});

test("contact damage alone needs at least three separate contacts to kill", () => {
  const maxHealth = 240;
  const { radius, reentryGraceTicks } = HARD.contactHazard;
  const state = createContactHazard();
  let hull = maxHealth;

  const episode = () => {
    for (let i = 0; i < ticksForSeconds(10); i += 1) {
      hull -= tickContactHazard(state, HARD, 0, maxHealth).damage;
    }
    for (let i = 0; i < reentryGraceTicks + 2; i += 1) {
      tickContactHazard(state, HARD, radius + 100, maxHealth);
    }
  };

  episode();
  assert.ok(hull > 0, "one contact must not kill");
  episode();
  assert.ok(hull > 0, "two contacts must not kill");
  const afterThree = (episode(), hull);
  assert.ok(afterThree > 0, "three contacts must still leave the pilot alive");
});

test("contact damage scales with maximum hull, so light ships are not deleted", () => {
  const light = 180;
  const heavy = 500;
  const share = (maxHealth) => {
    const state = createContactHazard();
    let lost = 0;
    for (let i = 0; i < ticksForSeconds(10); i += 1) {
      lost += tickContactHazard(state, HARD, 0, maxHealth).damage;
    }
    return lost / maxHealth;
  };
  assert.ok(Math.abs(share(light) - share(heavy)) < 1e-9, "same proportion of hull");
});

// ------------------------------------------------------ HARD: wormhole enrage

test("difficulty sets 100, 200, and 350 rival integrity respectively", () => {
  assert.equal(EASY.rivalIntegrity, 100);
  assert.equal(DIFFICULT.rivalIntegrity, 200);
  assert.equal(HARD.rivalIntegrity, 350);
});

test("Difficult enrages at 15 percent and Hard enrages at 30 percent integrity", () => {
  assert.equal(EASY.wormholeEnrage.enabled, false);
  assert.equal(DIFFICULT.wormholeEnrage.enabled, true);
  assert.equal(DIFFICULT.wormholeEnrage.thresholdFraction, 0.15);
  assert.equal(HARD.wormholeEnrage.enabled, true);
  assert.equal(HARD.wormholeEnrage.thresholdFraction, 0.3);
});

test("Difficult and Hard enrage emit a mixed mine, UFO, and Scarab wave every ten seconds", () => {
  const expected = [
    { enemy: "mines", count: 6 },
    { enemy: "ufo", count: 1 },
    { enemy: "scarab", count: 2 },
  ];
  for (const rules of [DIFFICULT, HARD]) {
    assert.equal(rules.wormholeEnrage.waveIntervalTicks, ticksForSeconds(10));
    assert.deepEqual(rules.wormholeEnrage.wave, expected);
  }
});

// ------------------------------------------------------------------- PvP rules

test("pvp always resolves to easy rules regardless of the stored difficulty", () => {
  for (const id of ["easy", "difficult", "hard"]) {
    assert.equal(rulesFor("pvp", id), PVP_RULES);
  }
  assert.equal(PVP_RULES.wormhole.kind, "locked");
  assert.equal(PVP_RULES.collisionShield.enabled, true);
  assert.equal(PVP_RULES.contactHazard.enabled, false);
  assert.equal(PVP_RULES.rivalIntegrity, 100);
  assert.equal(PVP_RULES.wormholeEnrage.enabled, false);
});

test("pve resolves to the requested difficulty", () => {
  assert.equal(rulesFor("pve", "easy"), DIFFICULTIES.easy);
  assert.equal(rulesFor("pve", "difficult"), DIFFICULTIES.difficult);
  assert.equal(rulesFor("pve", "hard"), DIFFICULTIES.hard);
});
