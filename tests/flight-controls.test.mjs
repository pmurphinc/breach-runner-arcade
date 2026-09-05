/**
 * Classic Wormhole's flight controls.
 *
 * The rule these exist to protect is one sentence: **inside the deadzone the
 * ship turns and does not accelerate; outside it does both.** That is the whole
 * feel of the original, and it is easy to break in a way no screenshot shows —
 * a stick that thrusts the instant it is touched still looks completely correct
 * in a still frame, which is exactly how the game shipped before this.
 *
 * So these are about behaviour, not shape: what a stick position means, where
 * the boundary sits, and that crossing it is not a cliff.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CLASSIC_DEADZONE_FRACTION,
  FLIGHT_SCHEMES,
  FLIGHT_SCHEME_HINTS,
  FLIGHT_SCHEME_LABELS,
  STICK_CENTRE_FRACTION,
  classicDeadzone,
  classicStickFlight,
  isFlightScheme,
  rightControlAims,
  stickFlight,
  twinStickFlight,
} from "../app/flight-controls.ts";
import { intentFromStick } from "../app/movement.ts";
import { DEFAULT_SETTINGS } from "../app/view-settings.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

const TRAVEL = 100;
const RING = classicDeadzone(TRAVEL, null); // 34px at the default fraction.

/** A stick pushed `distance` px along `degrees`, as [x, y]. */
function push(distance, degrees = 0) {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians) * distance, Math.sin(radians) * distance];
}

test("inside the deadzone the ship turns and does not accelerate", () => {
  const flight = classicStickFlight(...push(RING - 4, 135), TRAVEL, RING);

  assert.ok(flight.heading !== null, "the hull follows the stick");
  assert.ok(Math.abs(flight.heading - 135) < 0.001, "and follows it exactly");
  assert.equal(flight.throttle, 0, "but the engine stays cold");

  // The intent this produces is the point: active, aimed, and not moving.
  const intent = intentFromStick(flight.heading, flight.throttle);
  assert.equal(intent.active, true, "an active intent is what turns the hull");
  assert.equal(intent.magnitude, 0, "and a zero magnitude is what withholds thrust");
});

test("outside the deadzone the engine lights", () => {
  const flight = classicStickFlight(...push(TRAVEL, 135), TRAVEL, RING);
  assert.ok(Math.abs(flight.heading - 135) < 0.001, "still pointing where it is pushed");
  assert.equal(flight.throttle, 1, "at full travel the throttle is wide open");
});

test("the throttle ramps out of the ring rather than snapping", () => {
  // A step at the boundary would make the boundary itself the thing you aim at.
  const readings = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const distance = RING + (TRAVEL - RING) * t;
    return classicStickFlight(...push(distance), TRAVEL, RING).throttle;
  });
  for (let i = 1; i < readings.length; i += 1) {
    assert.ok(readings[i] > readings[i - 1], `throttle must climb: ${readings.join(", ")}`);
  }
  assert.ok(readings[0] < 0.001, "it starts from nothing at the ring");
  assert.ok(Math.abs(readings.at(-1) - 1) < 0.001, "and reaches full at full travel");
});

test("crossing the ring is continuous, so the boundary cannot be felt as a jolt", () => {
  const justInside = classicStickFlight(...push(RING - 0.5), TRAVEL, RING);
  const justOutside = classicStickFlight(...push(RING + 0.5), TRAVEL, RING);
  assert.equal(justInside.throttle, 0);
  assert.ok(justOutside.throttle < 0.05, "the first step past the ring is a nudge, not a launch");
  // And the heading does not lurch across the boundary.
  assert.ok(Math.abs(justInside.heading - justOutside.heading) < 0.001);
});

test("a resting finger does not steer the ship", () => {
  // A finger held dead centre still jitters a pixel or two; chasing it would
  // read as the ship twitching on its own.
  const centred = classicStickFlight(...push(TRAVEL * STICK_CENTRE_FRACTION * 0.5), TRAVEL, RING);
  assert.equal(centred.heading, null, "the hull holds its heading");
  assert.equal(centred.throttle, 0);
  assert.equal(intentFromStick(centred.heading, centred.throttle).active, false);
});

test("twin-stick is unchanged: any travel is full commitment", () => {
  const flight = twinStickFlight(...push(TRAVEL * 0.2, 90), TRAVEL);
  assert.ok(Math.abs(flight.heading - 90) < 0.001);
  assert.equal(flight.throttle, 1, "the scheme this game shipped with does not gate thrust");
  // Which is exactly what the old code did, expressed as an intent.
  assert.equal(intentFromStick(flight.heading, flight.throttle).magnitude, 1);
});

test("the deadzone follows the layout the pilot authored", () => {
  // Custom authors a ring against its own stick size; that proportion is what
  // transfers to whatever size is actually on screen.
  const authored = { deadzone: 20, size: 132 };
  const scaled = classicDeadzone(TRAVEL, authored);
  assert.ok(Math.abs(scaled - TRAVEL * (20 / 66)) < 0.001, "the share of the stick carries over");

  // A layout that authors nothing still gets a usable ring.
  assert.equal(classicDeadzone(TRAVEL, null), TRAVEL * CLASSIC_DEADZONE_FRACTION);

  // And a ring dragged to the far edge leaves the throttle reachable rather
  // than producing a stick that cannot accelerate at all.
  const enormous = classicDeadzone(TRAVEL, { deadzone: 500, size: 132 });
  assert.ok(enormous < TRAVEL, `a maxed ring must still be reachable, got ${enormous}`);
  assert.equal(classicStickFlight(...push(TRAVEL), TRAVEL, enormous).throttle > 0, true);
});

test("Classic fires ahead; twin-stick aims", () => {
  assert.equal(rightControlAims("classic"), false, "the right control is a trigger");
  assert.equal(rightControlAims("twin-stick"), true, "and a second stick when asked for");
});

test("the scheme vocabulary is complete and guarded", () => {
  for (const id of FLIGHT_SCHEMES) {
    assert.ok(FLIGHT_SCHEME_LABELS[id], `${id} needs a label`);
    assert.ok(FLIGHT_SCHEME_HINTS[id], `${id} needs a hint`);
    assert.ok(isFlightScheme(id));
  }
  assert.ok(!isFlightScheme("twin"), "a near-miss is not a scheme");
  assert.ok(!isFlightScheme(null));
  assert.equal(stickFlight("classic", ...push(RING - 4), TRAVEL, RING).throttle, 0);
  assert.equal(stickFlight("twin-stick", ...push(RING - 4), TRAVEL, RING).throttle, 1);
});

test("Classic is the default, because Classic players are who will arrive", () => {
  assert.equal(DEFAULT_SETTINGS.flightScheme, "classic");
});

test("the loop reads the throttle the stick reported", () => {
  // The whole mechanism is that the stick's magnitude reaches the intent. If
  // this reverts to intentFromStick(heading) the deadzone silently stops
  // existing, and nothing else in the suite would notice.
  assert.ok(game.includes("intentFromStick(moveHeading.current, moveThrottle.current)"));
  assert.ok(game.includes("moveThrottle.current = flight.throttle;"));
  // Releasing restores full commitment, so a stale throttle cannot leak into
  // the next keyboard or controller press.
  assert.ok(game.includes("moveThrottle.current = 1;"));
  // And the right control only aims when the scheme says it should.
  assert.ok(game.includes("if (rightControlAims(scheme) && distance > maxTravel * 0.08)"));
});
