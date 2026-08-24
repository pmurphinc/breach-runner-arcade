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
    for (const key of ["hull", "handling", "speed", "acceleration", "gun", "thrust", "special"]) {
      assert.ok(score[key] > 0, `${ship.name} missing ${key} points`);
    }
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

test("Squid remains a fast scout without exceeding the cap", () => {
  const squid = SHIPS.find((ship) => ship.id === "squid");
  assert.ok(squid);
  assert.equal(squid.maxSpeed, 4);
  assert.equal(squid.turn, 9);
  assert.equal(squid.acceleration, 0.13);
  assert.equal(squid.thrust, 2);
  assert.equal(shipBalanceBreakdown(squid).total, 99.5);
});
