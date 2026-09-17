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
  CONTROL_PROFILES,
  CONTROL_PROFILE_HINTS,
  CONTROL_PROFILE_LABELS,
  STICK_CENTRE_FRACTION,
  classicDeadzone,
  classicStickFlight,
  isControlProfile,
  rightControlAims,
  stickFlight,
  twinStickFlight,
} from "../app/flight-controls.ts";
import { intentFromStick } from "../app/movement.ts";
import { classicDeadzoneShare } from "../app/flight-controls.ts";
import {
  CLASSIC_TURN_DEGREES_PER_SECOND,
  MAX_TURN_SPAN_MS,
  classicKeyboardFlight,
  classicTurnDirection,
  classicTurnedHeading,
  pointerAims,
} from "../app/flight-controls.ts";
import {
  customTouchLayoutVariables,
  defaultCustomTouchLayout,
  isTouchStick,
} from "../app/touch-profiles.ts";
import { DEFAULT_SETTINGS } from "../app/view-settings.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../app/touch-layout-editor.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.equal(rightControlAims("twinStick"), true, "and a second stick when asked for");
});

test("the scheme vocabulary is complete and guarded", () => {
  for (const id of CONTROL_PROFILES) {
    assert.ok(CONTROL_PROFILE_LABELS[id], `${id} needs a label`);
    assert.ok(CONTROL_PROFILE_HINTS[id], `${id} needs a hint`);
    assert.ok(isControlProfile(id));
  }
  assert.ok(!isControlProfile("twin"), "a near-miss is not a scheme");
  assert.ok(!isControlProfile(null));
  assert.equal(stickFlight("classic", ...push(RING - 4), TRAVEL, RING).throttle, 0);
  assert.equal(stickFlight("twinStick", ...push(RING - 4), TRAVEL, RING).throttle, 1);
});

test("Classic is the default, because Classic players are who will arrive", () => {
  assert.equal(DEFAULT_SETTINGS.controlProfile, "classic");
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

/* ------------------------------------------- what the profiles look like -- */

test("the ring the pilot sees is the ring the game flies", () => {
  // These disagreed by a factor of two. The authored value is a *radius*, and
  // the loop read it as one, but the editor drew it as a diameter -- so a pilot
  // who set their deadzone against the picture was lighting the engine well
  // inside the ring they could see, with nothing on screen to explain why.
  //
  // One exported share is now the only source, and this is the test that keeps
  // it that way.
  const authored = { deadzone: 20, size: 132 };
  const share = classicDeadzoneShare(authored);

  // The loop: pixels of travel.
  assert.equal(classicDeadzone(200, authored), 200 * share);

  // The stylesheet: a percentage of the stick's width. The ring's diameter is
  // twice its radius and the travel is half the width, so the twos cancel and
  // the share is the width percentage directly.
  const variables = customTouchLayoutVariables({
    ...defaultCustomTouchLayout(),
    elements: { ...defaultCustomTouchLayout().elements, move: { ...authored, x: 0, y: 0 } },
  });
  assert.equal(variables["--touch-move-deadzone-share"], `${(share * 100).toFixed(2)}%`);

  // The editor preview: the same share of the same size.
  assert.ok(editor.includes("width: classicDeadzoneShare(element) * element.size"));
  assert.ok(!editor.includes("style={{ width: element.deadzone, height: element.deadzone }}"),
    "the half-size drawing is gone");
});

test("an unauthored layout still gets the default ring, drawn and flown", () => {
  assert.equal(classicDeadzoneShare(null), CLASSIC_DEADZONE_FRACTION);
  assert.equal(classicDeadzone(200, null), 200 * CLASSIC_DEADZONE_FRACTION);
  // The stylesheet falls back to the same number rather than to nothing.
  assert.ok(css.includes("var(--touch-move-deadzone-share, 34%)"));
});

test("a ring dragged to the far edge cannot be drawn bigger than it is flown", () => {
  // `classicDeadzoneShare` clamps at 0.9, so the drawn ring clamps with it
  // rather than showing a boundary the game will not honour.
  const enormous = classicDeadzoneShare({ deadzone: 5000, size: 132 });
  assert.equal(enormous, 0.9);
  assert.equal(classicDeadzone(200, { deadzone: 5000, size: 132 }), 180);
});

test("Classic's right-hand control is drawn as the button it is", () => {
  // It fires along the hull's own heading, so there is nothing to aim and
  // nothing to drag. Drawing it as a stick -- axes, a knob chasing the thumb,
  // an AIM label -- promised a thing it does not do.
  assert.ok(game.includes("const classicFire = !rightControlAims(settings.controlProfile);"));
  assert.ok(game.includes('${classicFire ? " fire-button" : ""}'), "the control says which it is");
  assert.ok(css.includes(".virtual-stick.fire-button {"), "and is styled as a button");

  // The knob and axes live only in the Twin Stick arm of the branch.
  const aimAt = game.indexOf("knob that chases the thumb");
  assert.ok(aimAt > 0, "the branch is where it says it is");
  const branch = game.slice(aimAt, aimAt + 2200);
  assert.ok(branch.includes("{classicFire ? ("));
  const classicArm = branch.slice(branch.indexOf("{classicFire ? ("), branch.indexOf(") : ("));
  assert.ok(!classicArm.includes("stick-knob"), "no knob to drag");
  assert.ok(!classicArm.includes("stick-axis"), "and no axes to aim along");
  assert.ok(!classicArm.includes("AIM"), "and it does not claim to aim");
});

test("Twin Stick keeps its second stick, untouched", () => {
  // The whole point of two profiles: changing how Classic is drawn must not
  // reach M-Sticks, which still aims and fires directionally with the right
  // stick.
  assert.equal(rightControlAims("twinStick"), true);
  const aimAt = game.indexOf("knob that chases the thumb");
  const branch = game.slice(aimAt, aimAt + 2200);
  const twinArm = branch.slice(branch.indexOf(") : ("));
  assert.ok(twinArm.includes("stick-knob"), "the knob is still there");
  assert.ok(twinArm.includes("stick-axis-x"), "and the axes");
  assert.ok(twinArm.includes(">AIM<"), "and it still says it aims");
});

test("the deadzone ring is drawn on the move stick, and only under Classic", () => {
  // Twin Stick thrusts at any travel, so it has no boundary to show and a ring
  // there would mark a rule it does not have.
  assert.ok(game.includes('{classicFire ? <span className="stick-deadzone" aria-hidden="true" /> : null}'));
  assert.ok(css.includes(".stick-deadzone {"));
});

test("the adjustable layout offers a ring for the stick and nothing else", () => {
  // The layout belongs to Classic, where only the left control is a stick.
  assert.ok(isTouchStick("move"));
  assert.ok(!isTouchStick("aim"));
  const variables = customTouchLayoutVariables(defaultCustomTouchLayout());
  assert.ok(variables["--touch-move-deadzone-share"]);
  assert.equal(variables["--touch-aim-deadzone-share"], undefined);
  assert.equal(variables["--touch-aim-deadzone"], undefined);
});

/* -------------------------------------------- Classic on a keyboard ------ */

/** No keys held. */
const NO_KEYS = { up: false, down: false, left: false, right: false };
const held = (...names) => ({ ...NO_KEYS, ...Object.fromEntries(names.map((n) => [n, true])) });

/** A 60Hz frame, which is the span the turn is normally integrated over. */
const FRAME_MS = 1000 / 60;
const degrees = (ms) => CLASSIC_TURN_DEGREES_PER_SECOND * (ms / 1000);

test("A and D turn the hull without moving the ship", () => {
  // Two halves, deliberately separate. `classicTurnedHeading` owns the turn;
  // `classicKeyboardFlight` owns what the engine is asked to do about it.
  assert.equal(classicTurnedHeading(held("right"), 0, FRAME_MS), degrees(FRAME_MS), "D turns one frame's worth");
  assert.equal(classicTurnedHeading(held("left"), 0, FRAME_MS), -degrees(FRAME_MS), "A turns the other way");

  // The same mechanism the stick's deadzone uses: an active intent carrying a
  // heading and a magnitude of zero. If this ever returns an inactive intent
  // the hull stops following the turn; if it returns magnitude 1 the ship
  // drives off while the pilot is only trying to line up.
  const turning = classicKeyboardFlight(held("right"), 30);
  assert.equal(turning.intent.active, true, "active, so the hull follows");
  assert.equal(turning.intent.magnitude, 0, "but the engine stays cold");
  assert.equal(turning.intent.heading, 30, "and the intent agrees with the hull");
});

/**
 * The regression this change exists for.
 *
 * The turn used to advance a fixed 4.2 degrees per **simulation tick**, and the
 * simulation ticks every 15ms while a 60Hz display draws every 16.7ms. A frame
 * therefore collected one tick, sometimes two, occasionally three, and the hull
 * moved 4.2, 8.4 or 12.6 degrees between consecutive frames -- an instantaneous
 * rate measured in a real browser as swinging between 250 and 506 degrees a
 * second. That unevenness is what a pilot feels as the nose snapping round in
 * chunks instead of sweeping.
 *
 * The property that makes it smooth is that the turn depends only on how much
 * *time* passed, never on how that time was chopped up. So: any partition of a
 * span must produce the same heading as integrating the span whole.
 */
test("the turn depends on elapsed time, not on how it is chopped up", () => {
  const whole = classicTurnedHeading(held("right"), 0, 30);
  for (const parts of [[15, 15], [10, 10, 10], [1, 29], [16.7, 13.3]]) {
    const stepped = parts.reduce((heading, part) => classicTurnedHeading(held("right"), heading, part), 0);
    assert.ok(
      Math.abs(stepped - whole) < 1e-9,
      `${parts.join("+")}ms turned ${stepped}, but 30ms turned ${whole}`,
    );
  }
});

test("the turn rate is constant across every frame length a display can produce", () => {
  // 144Hz, 120Hz, 60Hz, 30Hz. The rate has to read the same at all of them;
  // only the step size may differ, because that is the display's granularity.
  for (const frame of [1000 / 144, 1000 / 120, 1000 / 60, 1000 / 30]) {
    const rate = (classicTurnedHeading(held("right"), 0, frame) / frame) * 1000;
    assert.ok(
      Math.abs(rate - CLASSIC_TURN_DEGREES_PER_SECOND) < 1e-9,
      `a ${frame.toFixed(1)}ms frame turned at ${rate} deg/s`,
    );
  }
});

test("a hitch cannot spin the hull through a turn nobody asked for", () => {
  // A backgrounded tab, a GC pause or a slow first frame all arrive as one
  // enormous delta. The clamp matches the one the frame loop applies to its own
  // accumulator, so the steering and the simulation lose the same time.
  const clamped = classicTurnedHeading(held("right"), 0, 5000);
  assert.equal(clamped, degrees(MAX_TURN_SPAN_MS), "a two-second stall turns one clamped span");
  assert.ok(clamped < 20, `${clamped} degrees is a lurch, not a hitch`);
  assert.equal(classicTurnedHeading(held("right"), 0, -5), 0, "time cannot run backwards");
});

test("W drives the ship along its own nose, wherever that points", () => {
  for (const heading of [0, 90, -90, 137.5, -212]) {
    const flight = classicKeyboardFlight(held("up"), heading);
    assert.equal(flight.heading, heading, "thrust alone does not turn the hull");
    assert.equal(flight.intent.magnitude, 1, "full throttle");
    assert.equal(flight.intent.heading, heading, "along the nose, not up-screen");
  }
});

test("turning and thrusting together is a curve", () => {
  // Holding W and D should come round while still driving -- the single most
  // common thing a pilot does in this scheme. The turn lands first, then the
  // engine burns along whatever heading it produced.
  const turned = classicTurnedHeading(held("up", "right"), 10, FRAME_MS);
  assert.equal(turned, 10 + degrees(FRAME_MS), "thrust does not suppress the turn");

  const flight = classicKeyboardFlight(held("up", "right"), turned);
  assert.equal(flight.heading, turned);
  assert.equal(flight.intent.magnitude, 1);
  assert.equal(flight.intent.heading, flight.heading);
});

test("opposing turn keys cancel, and nothing held holds the heading", () => {
  assert.equal(classicTurnDirection(held("left", "right")), 0);
  assert.equal(classicTurnedHeading(held("left", "right"), 42, FRAME_MS), 42, "A and D together do not drift");
  assert.equal(classicTurnedHeading(NO_KEYS, 42, FRAME_MS), 42, "the hull keeps pointing where it was left");

  const both = classicKeyboardFlight(held("left", "right"), 42);
  assert.equal(both.heading, 42);
  assert.equal(both.intent.active, false);

  const idle = classicKeyboardFlight(NO_KEYS, 42);
  assert.equal(idle.heading, 42);
  assert.equal(idle.intent.active, false, "and coasts rather than braking");
});

test("S does nothing, deliberately", () => {
  // The original had no reverse, and a thrust vector opposite the nose would
  // fight `facingFor` -- the hull turns to whatever the intent points at, so
  // the ship would flip rather than back up. Reverse is the retros upgrade.
  assert.equal(classicTurnedHeading(held("down"), 33, FRAME_MS), 33);
  const flight = classicKeyboardFlight(held("down"), 33);
  assert.equal(flight.heading, 33);
  assert.equal(flight.intent.active, false);
});

test("a turn rate that is steering, not selecting a direction", () => {
  // A full turn should take somewhere around a second and a bit: fast enough to
  // bring the nose onto something shooting at you, slow enough that steering is
  // a thing you do. Pinned as a band so it can be tuned without rewriting the
  // test -- and unchanged by the move off the tick, which was a fix for how the
  // turn reads rather than for how fast it is.
  const secondsPerTurn = 360 / CLASSIC_TURN_DEGREES_PER_SECOND;
  assert.ok(secondsPerTurn > 0.8, `${secondsPerTurn.toFixed(2)}s per turn -- too twitchy`);
  assert.ok(secondsPerTurn < 2.2, `${secondsPerTurn.toFixed(2)}s per turn -- too sluggish`);
});

test("a nonsense heading cannot leave the hull pointing nowhere", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    assert.ok(Number.isFinite(classicTurnedHeading(held("right"), bad, FRAME_MS)), `${bad} survived the turn`);
    assert.ok(Number.isFinite(classicKeyboardFlight(held("right"), bad).heading), `${bad} survived the flight`);
  }
  assert.ok(Number.isFinite(classicTurnedHeading(held("right"), 0, Number.NaN)), "an unmeasurable frame turns nothing");
});

test("the mouse stops steering under Classic, and still steers under Twin Stick", () => {
  // `facingFor` gives an aim heading priority over everything, so a mouse that
  // kept setting one would pin the nose to the cursor and make A and D do
  // nothing at all. The two cannot both own the heading.
  assert.equal(pointerAims("classic"), false);
  assert.equal(pointerAims("twinStick"), true);
  assert.ok(game.includes("if (!pointerAims(settingsRef.current.controlProfile)) return;"));
});

test("the loop reads the keyboard through the profile", () => {
  // If this reverts to calling intentFromKeys unconditionally, Classic silently
  // goes back to absolute-direction WASD and nothing else here would notice.
  assert.ok(game.includes("const flight = classicKeyboardFlight(heldKeys, player.angle);"));
  assert.ok(game.includes("player.angle = flight.heading;"), "the heading reaches the hull");
  assert.ok(game.includes("const classicKeys = !rightControlAims(settingsRef.current.controlProfile);"));
  // Steering is integrated once per frame against the clock, outside the fixed
  // tick. Inside it, a 16.7ms frame would collect one 15ms tick or two, and the
  // hull would lurch through an uneven number of degrees between frames.
  assert.ok(game.includes("const steerClassic = (elapsedMs: number) => {"), "steering has its own per-frame pass");
  assert.ok(
    game.includes("game.player.angle = classicTurnedHeading(keysFrom(keys.current), game.player.angle, elapsedMs);"),
    "and it is the only place the Classic turn is integrated",
  );
  assert.ok(game.includes("steerClassic(span);"), "called once per frame, before the simulation catches up");
  assert.ok(
    game.includes("const span = Math.min(MAX_TURN_SPAN_MS, delta);"),
    "steering and the simulation lose the same time to a hitch",
  );
  assert.ok(
    !game.includes("classicKeyboardFlight(heldKeys, player.angle, "),
    "nothing passes a per-tick turn amount any more",
  );
  // Twin Stick keeps the scheme it always had.
  assert.ok(game.includes("keyboardIntent = intentFromKeys(heldKeys);"));
});

test("the dead zone can be dragged, not only typed", () => {
  // It is the one number in the editor whose right value is a feel rather than
  // a measurement, so it needs the same direct handle every other control has.
  assert.ok(editor.includes('beginDrag(event, "deadzone")'));
  assert.ok(editor.includes('mode: "move" | "resize" | "deadzone"'));
  assert.ok(editor.includes("deadzone: start.deadzone + delta,"));
  // Reachable without a pointer, like the resize handle beside it.
  assert.ok(editor.includes('setField("deadzone", element.deadzone + 2)'));
  assert.ok(editor.includes('role="slider"'));
});
