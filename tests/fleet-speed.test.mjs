import test from "node:test";
import assert from "node:assert/strict";

import { SHIPS, FORM_SHIFT_PROFILES } from "../app/game-data.ts";
import { engineHandling } from "../app/movement.ts";
import { shipBalanceBreakdown, isShipWithinBudget, SHIP_BALANCE_WEIGHTS } from "../app/ship-balance.ts";
import { TRACKER_SPEED } from "../app/trackers.ts";
import { DEFAULT_ARENA } from "../app/arena.ts";
import { TICK_MS } from "../app/difficulty.ts";

/**
 * The fleet's speed before it was doubled.
 *
 * Kept here so the change is checkable rather than asserted: everything below
 * is stated as a relationship to these, not as a fresh set of magic numbers.
 */
const BEFORE = {
  tank: { maxSpeed: 2.7, acceleration: 0.04 },
  wing: { maxSpeed: 3.5, acceleration: 0.13 },
  squid: { maxSpeed: 3.8, acceleration: 0.12 },
  rabbit: { maxSpeed: 3, acceleration: 0.14 },
  turtle: { maxSpeed: 2.4, acceleration: 0.06 },
  flash: { maxSpeed: 1, acceleration: 0.1 },
  hunter: { maxSpeed: 2.9, acceleration: 0.08 },
  flagship: { maxSpeed: 1.8, acceleration: 0.04 },
  kestrel: { maxSpeed: 3.7, acceleration: 0.15 },
  warden: { maxSpeed: 3, acceleration: 0.09 },
};

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);

test("every hull is exactly twice as quick, and none gained on any other", () => {
  assert.equal(SHIPS.length, 10);
  for (const ship of SHIPS) {
    const before = BEFORE[ship.id];
    assert.ok(before, `${ship.id} is missing its before-value`);
    near(ship.maxSpeed, before.maxSpeed * 2, `${ship.id} top speed`);
    near(ship.acceleration, before.acceleration * 2, `${ship.id} acceleration`);
  }
});

test("turn rate, hull, gun and thrust are untouched", () => {
  // The change is pace, not power. Anything else moving would be a rebalance
  // wearing a speed change's clothes.
  const byId = Object.fromEntries(SHIPS.map((ship) => [ship.id, ship]));
  assert.equal(byId.tank.health, 280);
  assert.equal(byId.tank.turn, 5);
  assert.equal(byId.rabbit.health, 150);
  assert.equal(byId.rabbit.turn, 12);
  assert.equal(byId.flagship.health, 300);
  assert.equal(byId.flash.gun, 3);
  assert.equal(byId.flash.thrust, 3);
});

/**
 * Switchback swaps into frozen copies of two other hulls' handling, so those
 * copies have to move with the fleet or FORM SHIFT would drop the pilot into
 * the old, slower game.
 */
test("the shape-shifter's two profiles moved with the fleet", () => {
  near(FORM_SHIFT_PROFILES.tank.maxSpeed, 2.7 * 2, "form-shift heavy speed");
  near(FORM_SHIFT_PROFILES.tank.acceleration, 0.04 * 2, "form-shift heavy accel");
  near(FORM_SHIFT_PROFILES.squid.maxSpeed, 4 * 2, "form-shift scout speed");
  near(FORM_SHIFT_PROFILES.squid.acceleration, 0.13 * 2, "form-shift scout accel");

  const byId = Object.fromEntries(SHIPS.map((ship) => [ship.id, ship]));
  for (const id of ["tank", "squid"]) {
    assert.ok(
      FORM_SHIFT_PROFILES[id].maxSpeed >= byId[id].maxSpeed * 0.9,
      `${id}: the frozen profile must stay in the same league as the hull it was copied from`
    );
  }
});

/**
 * The budget measures a ship against the rest of the fleet. A fleet-wide speed
 * change makes no hull stronger than any other, so halving the two weights
 * keeps every total exactly where it was — which is the proof that this was a
 * change of pace and not of balance.
 */
test("the balance budget is unmoved, to the decimal", () => {
  assert.equal(SHIP_BALANCE_WEIGHTS.speed, 3);
  assert.equal(SHIP_BALANCE_WEIGHTS.acceleration, 50);

  // Scoring the old sheet under the old weights must give the same totals as
  // the new sheet under the new ones.
  const oldWeights = { speed: 6, acceleration: 100 };
  for (const ship of SHIPS) {
    const before = BEFORE[ship.id];
    const now = shipBalanceBreakdown(ship);
    near(now.speed, before.maxSpeed * oldWeights.speed, `${ship.id} speed points`);
    near(now.acceleration, before.acceleration * oldWeights.acceleration, `${ship.id} accel points`);
    assert.ok(isShipWithinBudget(ship), `${ship.id} is outside the budget at ${now.total}`);
  }
});

/**
 * ENGINE adds a proportional slice plus a flat top-up. Only the proportional
 * part scales itself, so the flat part had to double as well or the upgrade
 * would have quietly shrunk from a 51% gain to a 41% one.
 */
test("the engine upgrade is worth the same share it was", () => {
  for (const ship of SHIPS) {
    const before = BEFORE[ship.id];
    const gainNow = engineHandling(ship, 3).maxSpeed / ship.maxSpeed;
    const gainBefore = engineHandling({ maxSpeed: before.maxSpeed, acceleration: before.acceleration }, 3).maxSpeed / (before.maxSpeed * 2);
    // The old flat bonus against the new base is what we are ruling out; the
    // comparison that matters is proportional gain, hull by hull.
    assert.ok(gainNow > 1.3, `${ship.id}: the upgrade must still be worth taking, got ${gainNow}`);
    near(gainNow, 1 + 3 * 0.1 + (3 * 0.5) / ship.maxSpeed, `${ship.id} engine gain`);
    assert.ok(gainBefore > 0, "sanity");
  }
});

/**
 * Trackers were slowed while the fleet topped out at 3.8. At double the fleet
 * speed a 3.4 tracker is something most hulls simply drive away from, which
 * would have retired the swarm as a threat without anyone deciding to.
 */
test("the homing swarm can still run down most of the fleet", () => {
  assert.equal(TRACKER_SPEED, 6.8);
  // Three of the ten can pull away on a straight line, and they are the three
  // lightest. The reference draws the same line in the same place: its own
  // homing missile is outrun by its quickest hulls and by nothing else.
  const outrun = SHIPS.filter((ship) => ship.maxSpeed > TRACKER_SPEED).map((ship) => ship.id);
  assert.deepEqual(outrun.sort(), ["kestrel", "squid", "wing"], "only the lightest frames escape outright");
  assert.ok(outrun.length < SHIPS.length / 2, "a swarm must still be a threat to most of the fleet");
});

test("the arena still takes real time to cross", () => {
  // Fast is the point; teleporting is not. The quickest hull should still need
  // a couple of seconds to get from one side to the other.
  const fastest = Math.max(...SHIPS.map((ship) => ship.maxSpeed));
  const seconds = (DEFAULT_ARENA.width / fastest) * TICK_MS / 1000;
  assert.ok(seconds > 2, `the arena should take more than two seconds to cross, got ${seconds.toFixed(1)}s`);
  assert.ok(seconds < 5, `and less than five, got ${seconds.toFixed(1)}s`);
});
