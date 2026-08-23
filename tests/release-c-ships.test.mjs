import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS, SHIP_SPECIALS } from "../app/game-data.ts";
import {
  SQUID_PHASE_SECONDS,
  VIPER_GUIDANCE_SECONDS,
  WING_OVERDRIVE_SECONDS,
  hostileTrackingVector,
  overdriveHandling,
  steerHomingVelocity,
} from "../app/ship-specials.ts";

test("Rabbit frame is reworked into the fragile MK1 Viper", () => {
  const viper = SHIPS.find((ship) => ship.id === "rabbit");
  assert.ok(viper);
  assert.equal(viper.name, "The Viper");
  assert.equal(viper.health, 100);
  assert.equal(viper.gun, 0);
  assert.equal(SHIP_SPECIALS.rabbit.name, "VIPER GUIDANCE");
  assert.equal(SHIP_SPECIALS.rabbit.cooldownSeconds, 20);
  assert.equal(VIPER_GUIDANCE_SECONDS, 3);
});

test("Wing overdrive is a controllable multiplier, not a teleport", () => {
  assert.equal(WING_OVERDRIVE_SECONDS, 3);
  assert.deepEqual(overdriveHandling(0.1, 3.2, false), { acceleration: 0.1, maxSpeed: 3.2 });
  assert.deepEqual(overdriveHandling(0.1, 3.2, true), { acceleration: 0.17500000000000002, maxSpeed: 5.28 });
  assert.equal(SHIP_SPECIALS.wing.name, "VECTOR OVERDRIVE");
});

test("Squid phase veil reverses hostile tracking vectors", () => {
  assert.equal(SQUID_PHASE_SECONDS, 2.5);
  assert.deepEqual(hostileTrackingVector(10, 10, 30, 40, false), { dx: 20, dy: 30 });
  assert.deepEqual(hostileTrackingVector(10, 10, 30, 40, true), { dx: -20, dy: -30 });
  assert.equal(SHIP_SPECIALS.squid.name, "PHASE VEIL");
});

test("Viper guidance turns toward a moving wormhole without teleporting", () => {
  const guided = steerHomingVelocity(0, 0, 10, 0, 0, 100);
  assert.ok(guided.vy > 0);
  assert.ok(guided.vx > 0);
  assert.ok(Math.abs(Math.hypot(guided.vx, guided.vy) - 10) < 1e-9);
});
