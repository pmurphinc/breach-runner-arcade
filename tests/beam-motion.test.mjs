import test from "node:test";
import assert from "node:assert/strict";
import {
  BEAM_ROTATION_PER_TICK,
  advanceBeamAngle,
  pointTouchesBeam,
  randomBeamDirection,
} from "../app/beam-motion.ts";

test("beam rotates at a constant slow speed in its chosen direction", () => {
  assert.equal(advanceBeamAngle(1, 1), 1 + BEAM_ROTATION_PER_TICK);
  assert.equal(advanceBeamAngle(1, -1), 1 - BEAM_ROTATION_PER_TICK);
});

test("beam direction is randomized once at spawn", () => {
  assert.equal(randomBeamDirection(() => 0.1), -1);
  assert.equal(randomBeamDirection(() => 0.9), 1);
});

test("beam collision is a finite forward ray, not a player-locked infinite line", () => {
  assert.equal(pointTouchesBeam(100, 100, 0, 500, 110, 14), true);
  assert.equal(pointTouchesBeam(100, 100, 0, 500, 130, 14), false);
  assert.equal(pointTouchesBeam(100, 100, 0, 50, 100, 14), false);
  assert.equal(pointTouchesBeam(100, 100, 0, 1400, 100, 14, 1200), false);
});

test("the same beam geometry can consume pickups with a wider readable lane", () => {
  assert.equal(pointTouchesBeam(0, 0, Math.PI / 2, 12, 400, 20), true);
  assert.equal(pointTouchesBeam(0, 0, Math.PI / 2, 30, 400, 20), false);
});
