import test from "node:test";
import assert from "node:assert/strict";
import {
  BEAM_ROTATION_PER_TICK,
  advanceBeamAngle,
  hostileBeamContact,
  pointTouchesBeam,
  randomBeamDirection,
} from "../app/beam-motion.ts";

test("beam rotates at a constant slow speed in its chosen direction", () => {
  assert.equal(advanceBeamAngle(1, 1), 1 + BEAM_ROTATION_PER_TICK);
  assert.equal(advanceBeamAngle(1, -1), 1 - BEAM_ROTATION_PER_TICK);
});

test("one continuous hostile beam contact consumes only once across simulation ticks", () => {
  let active = false;
  const first = hostileBeamContact(active, true, true);
  active = first.active;
  assert.equal(first.consume, true);

  for (let tick = 0; tick < 20; tick += 1) {
    const overlap = hostileBeamContact(active, true, tick % 4 === 0);
    active = overlap.active;
    assert.equal(overlap.consume, false);
  }
});

test("exiting a hostile beam permits a later legitimate contact to consume again", () => {
  const first = hostileBeamContact(false, true, true);
  const exited = hostileBeamContact(first.active, false, false);
  const reentered = hostileBeamContact(exited.active, true, true);
  assert.equal(exited.active, false);
  assert.equal(reentered.consume, true);
});

test("separate hostile beams keep independent contact guards", () => {
  const beamA = hostileBeamContact(false, true, true);
  const beamB = hostileBeamContact(false, true, true);
  assert.equal(beamA.consume, true);
  assert.equal(beamB.consume, true);
});

test("overlap without a confirmed damage hit does not consume a payload", () => {
  assert.deepEqual(hostileBeamContact(false, true, false), { active: false, consume: false });
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
