import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS, SHIP_SPECIALS } from "../app/game-data.ts";
import {
  VIPER_GUIDANCE_SECONDS,
  hostileTrackingVector,
  steerHomingVelocity,
} from "../app/ship-specials.ts";
import { PHANTOM_BEAM_SECONDS, overchargeFor } from "../app/overcharge.ts";

test("guided-strike frame keeps its gameplay while using the commercial identity", () => {
  const needle = SHIPS.find((ship) => ship.id === "rabbit");
  assert.ok(needle);
  assert.equal(needle.name, "Needle");
  assert.equal(needle.health, 150);
  assert.equal(needle.maxSpeed, 3);
  assert.equal(needle.gun, 1);
  assert.equal(SHIP_SPECIALS.rabbit.name, "TARGET LINK");
  assert.equal(SHIP_SPECIALS.rabbit.cooldownSeconds, 20);
  assert.equal(VIPER_GUIDANCE_SECONDS, 3);
});

test("Starling trades hull for the handling and volley of a skirmisher", () => {
  const starling = SHIPS.find((ship) => ship.id === "wing");
  assert.ok(starling);
  // The rebalance is a trade, not an upgrade: the old frame was 240 hull.
  assert.equal(starling.health, 175);
  assert.equal(starling.maxSpeed, 3.5);
  assert.equal(starling.acceleration, 0.13);
  assert.equal(starling.turn, 9);
  assert.equal(SHIP_SPECIALS.wing.name, "SWARM OVERCHARGE");

  const swarm = overchargeFor("wing");
  assert.ok(swarm);
  assert.equal(swarm.source, "heatseeker");
  assert.equal(swarm.volley.count, 12);
  // Afterburn survives as the rider, at gentler multipliers than the 1.75 /
  // 1.65 it used to be, because it no longer has to be the whole special.
  assert.equal(swarm.rider.accelerationScale, 1.5);
  assert.equal(swarm.rider.maxSpeedScale, 1.35);
});

test("Phantom fires a beam it keeps aiming rather than a pulse it throws once", () => {
  const phantom = SHIPS.find((ship) => ship.id === "squid");
  assert.ok(phantom);
  assert.equal(phantom.health, 170);
  assert.equal(phantom.gun, 1, "MK0 was the reason it could not fight anything");
  assert.equal(SHIP_SPECIALS.squid.name, "LANCE OVERCHARGE");
  assert.match(phantom.special, /beam/i, "the selection screen has to describe what it now does");

  const lance = overchargeFor("squid");
  assert.ok(lance);
  assert.equal(lance.source, "beam", "an overcharged build of the rift's own SWEEP BEAM");
  assert.equal(lance.beam.seconds, PHANTOM_BEAM_SECONDS);
  assert.equal(lance.beam.annihilates, true, "contact is lethal, not chip damage");
  assert.ok(lance.beam.width > 0 && lance.beam.length > 0);
  assert.ok(
    lance.differences.some((line) => /power-up/i.test(line)),
    "the one thing it must not destroy has to be stated on the card",
  );
});

test("scramble geometry survives the frame that used to carry it", () => {
  // Phantom no longer scrambles anything, but the per-hostile reversal is a
  // shared mechanic and still has to steer a scrambled hostile backwards.
  assert.deepEqual(hostileTrackingVector(10, 10, 30, 40, false), { dx: 20, dy: 30 });
  assert.deepEqual(hostileTrackingVector(10, 10, 30, 40, true), { dx: -20, dy: -30 });
});

test("Talon pays for its detonation with mobility", () => {
  const talon = SHIPS.find((ship) => ship.id === "hunter");
  assert.ok(talon);
  assert.equal(talon.gun, 2, "a brawler needs a cannon between specials");
  assert.equal(talon.maxSpeed, 2.9);
  assert.equal(talon.acceleration, 0.08);
  assert.equal(SHIP_SPECIALS.hunter.name, "CORE OVERCHARGE");

  const core = overchargeFor("hunter");
  assert.ok(core);
  assert.equal(core.source, "nuke");
  assert.ok(core.rider.maxSpeedScale < 1, "the blast must stagger its own pilot");
  assert.ok(core.rider.accelerationScale < 1);
});

test("Target Link turns toward a moving portal without teleporting", () => {
  const guided = steerHomingVelocity(0, 0, 10, 0, 0, 100);
  assert.ok(guided.vy > 0);
  assert.ok(guided.vx > 0);
  assert.ok(Math.abs(Math.hypot(guided.vx, guided.vy) - 10) < 1e-9);
});
