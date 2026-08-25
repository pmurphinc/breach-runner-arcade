import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS } from "../app/game-data.ts";
import {
  SHIP_BALANCE_CAP,
  SHIP_BALANCE_FLOOR,
  isShipWithinBudget,
  shipBalanceBreakdown,
} from "../app/ship-balance.ts";

test("every ship stays inside the fleet balance band", () => {
  for (const ship of SHIPS) {
    const score = shipBalanceBreakdown(ship);
    assert.ok(score.total <= SHIP_BALANCE_CAP, `${ship.name} exceeds budget: ${score.total}`);
    assert.ok(score.total >= SHIP_BALANCE_FLOOR, `${ship.name} is under budget: ${score.total}`);
    assert.equal(isShipWithinBudget(ship), true);
  }
});

test("every displayed statistic and the special contribute points", () => {
  for (const ship of SHIPS) {
    const score = shipBalanceBreakdown(ship);
    // Every frame has hull, handling, speed, acceleration, a cannon and an
    // ability, so all six always cost something.
    for (const key of ["hull", "handling", "speed", "acceleration", "gun", "special"]) {
      assert.ok(score[key] > 0, `${ship.name} missing ${key} points`);
    }
    // Starting thrust is the one axis a frame may legitimately have none of —
    // Ironclad opens at MK0 — so it is scored, but not required to be spent.
    assert.ok(score.thrust >= 0, `${ship.name} thrust points`);
    assert.equal(score.thrust > 0, ship.thrust > 0, `${ship.name} thrust scoring`);
  }
});

test("Viper rebalance is inside budget with MK1 represented by base gun points", () => {
  const viper = SHIPS.find((ship) => ship.id === "rabbit");
  assert.ok(viper);
  const score = shipBalanceBreakdown(viper);
  assert.equal(viper.health, 150);
  assert.equal(viper.maxSpeed, 3);
  assert.equal(viper.gun, 1);
  assert.equal(score.gun, 12);
  assert.equal(score.total, 99);
});

test("Phantom stays the fleet's fastest frame without exceeding the cap", () => {
  const squid = SHIPS.find((ship) => ship.id === "squid");
  assert.ok(squid);
  assert.equal(squid.maxSpeed, 3.8);
  assert.equal(squid.maxSpeed, Math.max(...SHIPS.map((ship) => ship.maxSpeed)));
  assert.equal(squid.turn, 8);
  assert.equal(squid.acceleration, 0.12);
  assert.equal(squid.thrust, 1);
  assert.equal(shipBalanceBreakdown(squid).total, 98.8);
});

test("the overcharge frames paid for their specials out of the same budget", () => {
  // Each of the three got a stronger special. The budget is what proves the
  // increase was traded for rather than simply added.
  const previous = { wing: 15, squid: 15, hunter: 24 };
  for (const [id, before] of Object.entries(previous)) {
    const ship = SHIPS.find((candidate) => candidate.id === id);
    const score = shipBalanceBreakdown(ship);
    assert.notEqual(score.special, before, `${id} special is unchanged`);
    assert.ok(score.total <= SHIP_BALANCE_CAP, `${id} total ${score.total}`);
    assert.ok(score.total >= SHIP_BALANCE_FLOOR, `${id} total ${score.total}`);
  }
});
