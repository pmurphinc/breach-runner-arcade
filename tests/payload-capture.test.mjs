/**
 * The rift drawing a near miss in.
 *
 * Two rules, pulling against each other, and the value of this feature is
 * entirely in where the line between them sits.
 *
 * **A near miss should land.** Payloads are a limited resource spent
 * deliberately, and the rift usually orbits, so a shot that arrives a hair wide
 * is often the rift having moved rather than a mistake the pilot could have
 * avoided.
 *
 * **A bad shot should still miss.** The Rabbit's Viper guidance is homing — it
 * turns at 0.16 rad/tick, from any range, at any angle, and it is that ship's
 * whole special. A funnel strong enough to rescue bad aim would hand that
 * ability to every hull for free, and nothing about the game would look
 * different in a screenshot.
 *
 * So most of these simulate a real launch and ask what actually lands, rather
 * than asserting on the constants — the constants are only interesting through
 * their effect on a flight.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PAYLOAD_CAPTURE_MAX_OFF_BEARING,
  PAYLOAD_CAPTURE_MAX_TURN,
  PAYLOAD_CAPTURE_RADIUS,
  capturePayloadVelocity,
  normalizeAngle,
  payloadCaptureTurn,
} from "../app/payload-capture.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** The landing radius and launch speed the loop uses. */
const LANDING_RADIUS = 48;
const LAUNCH_SPEED = 10;
const PAYLOAD_LIFE = 160;

/**
 * Fire a payload from `range` away with `errorDegrees` of aim error, with the
 * rift at the origin. Returns the closest it ever came.
 */
function closestApproach(range, errorDegrees, { assist = true } = {}) {
  let x = -range;
  let y = 0;
  const heading = (errorDegrees * Math.PI) / 180;
  let vx = Math.cos(heading) * LAUNCH_SPEED;
  let vy = Math.sin(heading) * LAUNCH_SPEED;
  let closest = Infinity;

  for (let tick = 0; tick < PAYLOAD_LIFE; tick += 1) {
    if (assist) {
      const drawn = capturePayloadVelocity(x, y, vx, vy, 0, 0);
      vx = drawn.vx;
      vy = drawn.vy;
    }
    x += vx;
    y += vy;
    closest = Math.min(closest, Math.hypot(x, y));
    if (closest < LANDING_RADIUS) break;
  }
  return closest;
}

const lands = (range, error, options) => closestApproach(range, error, options) < LANDING_RADIUS;

/** The widest aim error that still lands from this range. */
function tolerance(range, options) {
  let widest = 0;
  for (let error = 0; error <= 60; error += 0.25) {
    if (!lands(range, error, options)) break;
    widest = error;
  }
  return widest;
}

test("a near miss is drawn in", () => {
  // At mid-arena range an eight-degree error passed about 55px wide -- just
  // outside the 48px mouth. That is the shot this exists for.
  assert.ok(!lands(400, 8, { assist: false }), "it used to miss");
  assert.ok(lands(400, 8), "and now lands");
});

test("a bad shot still misses, at every range", () => {
  // The line has to hold from close in as well as from across the arena.
  for (const range of [250, 400, 600]) {
    assert.ok(!lands(range, 30), `30 degrees off at ${range}px must not land`);
    assert.ok(!lands(range, 45), `45 degrees off at ${range}px must not land`);
  }
});

test("the assist is worth having but not decisive", () => {
  // Roughly doubling the forgiveness is the target: enough that a near miss
  // stops feeling arbitrary, not so much that aiming stops mattering. Pinned as
  // a band rather than a number, so tuning has somewhere to move.
  for (const range of [250, 400, 600]) {
    const without = tolerance(range, { assist: false });
    const with_ = tolerance(range);
    const gain = with_ / without;
    assert.ok(gain > 1.3, `${range}px: only ${gain.toFixed(2)}x -- too weak to feel`);
    assert.ok(gain < 2.6, `${range}px: ${gain.toFixed(2)}x -- doing the aiming for the player`);
  }
});

test("it stays clearly weaker than the ship special that does this properly", () => {
  // Viper guidance turns at 0.16 rad/tick, from any range and any angle, on a
  // payload that also lives twice as long. This must not approach it, or the
  // Rabbit's special is everyone's.
  const VIPER_TURN = 0.16;
  assert.ok(PAYLOAD_CAPTURE_MAX_TURN < VIPER_TURN * 0.5, "the turn rate must stay well under half");

  // And unlike Viper it is gated twice, so even its best case is unreachable
  // from most of the arena.
  assert.ok(PAYLOAD_CAPTURE_RADIUS > 0 && PAYLOAD_CAPTURE_RADIUS < 400, "range-gated");
  assert.ok(PAYLOAD_CAPTURE_MAX_OFF_BEARING < Math.PI / 2, "angle-gated to less than a right angle");
});

test("the funnel has an edge, and nothing happens outside it", () => {
  assert.equal(payloadCaptureTurn(PAYLOAD_CAPTURE_RADIUS, 0), 0, "at the rim");
  assert.equal(payloadCaptureTurn(PAYLOAD_CAPTURE_RADIUS + 1, 0), 0, "beyond it");
  assert.ok(payloadCaptureTurn(PAYLOAD_CAPTURE_RADIUS - 1, 0) > 0, "just inside it");

  // A payload crossing the funnel sideways or leaving is not making a near
  // miss. Bending one of those in would read as the rift reaching out for a
  // shot that was never aimed at it.
  assert.equal(payloadCaptureTurn(100, PAYLOAD_CAPTURE_MAX_OFF_BEARING), 0, "across the mouth");
  assert.equal(payloadCaptureTurn(100, Math.PI), 0, "flying away");
});

test("the pull is strongest where a near miss actually happens", () => {
  // Close in and well aimed. Both terms have to be doing work, or the funnel
  // is a flat radius that grabs anything entering it.
  const close = payloadCaptureTurn(30, 0);
  const far = payloadCaptureTurn(PAYLOAD_CAPTURE_RADIUS - 20, 0);
  assert.ok(close > far, "closeness matters");

  const straight = payloadCaptureTurn(100, 0);
  const angled = payloadCaptureTurn(100, PAYLOAD_CAPTURE_MAX_OFF_BEARING * 0.8);
  assert.ok(straight > angled, "aim matters");

  // And it never exceeds its own ceiling, whatever it is handed.
  for (const distance of [0.5, 1, 40, 120, 279]) {
    assert.ok(payloadCaptureTurn(distance, 0) <= PAYLOAD_CAPTURE_MAX_TURN + 1e-9);
  }
});

test("a payload aimed dead at the rift is not nudged off it", () => {
  const straight = capturePayloadVelocity(-100, 0, LAUNCH_SPEED, 0, 0, 0);
  assert.ok(Math.abs(straight.vx - LAUNCH_SPEED) < 1e-9);
  assert.ok(Math.abs(straight.vy) < 1e-9);
});

test("the funnel steers and never accelerates", () => {
  // A payload arriving faster than it was launched would be the rift adding
  // damage the pilot did not pay for, and would outrun the landing check.
  for (const [x, y, vx, vy] of [
    [-120, 40, 9, -2],
    [-60, -30, 4, 5],
    [-200, 90, 10, 0],
  ]) {
    const before = Math.hypot(vx, vy);
    const after = capturePayloadVelocity(x, y, vx, vy, 0, 0);
    assert.ok(Math.abs(Math.hypot(after.vx, after.vy) - before) < 1e-9, "speed is preserved exactly");
  }
});

test("nonsense in cannot produce a payload flying nowhere", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    assert.equal(payloadCaptureTurn(bad, 0), 0);
    assert.equal(payloadCaptureTurn(100, bad), 0);
  }
  // A stationary payload has no heading to steer, and must not become one.
  const still = capturePayloadVelocity(-50, 0, 0, 0, 0, 0);
  assert.equal(still.vx, 0);
  assert.equal(still.vy, 0);
});

test("angles wrap the short way", () => {
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(-Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(0)) < 1e-9);
});

// ------------------------------------------------------------- the wiring --

test("the loop funnels an unguided payload, and leaves a guided one alone", () => {
  // Viper already turns harder from further out, so running both would be a
  // no-op at best and would muddy which system is doing what at worst.
  assert.ok(game.includes("const drawn = capturePayloadVelocity(power.x, power.y, power.vx, power.vy, game.portalX, game.portalY);"));
  assert.ok(game.includes("power.vx = drawn.vx;"));

  // It is the else of the homing branch, so the two cannot both run.
  const at = game.indexOf("const guided = steerHomingVelocity(power.x, power.y, power.vx, power.vy");
  assert.ok(at > 0, "the homing branch is where it says it is");
  const block = game.slice(at, at + 900);
  assert.ok(block.includes("} else {"), "capture is the alternative, not an addition");
  assert.ok(block.indexOf("capturePayloadVelocity") > block.indexOf("} else {"));
});
