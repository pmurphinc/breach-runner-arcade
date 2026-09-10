/**
 * Sound that knows where it came from.
 *
 * Every effect in the arena played at the same volume wherever it happened. A
 * hostile dying in the far corner of a 1504×940 arena was exactly as loud as
 * one dying against the hull, so with a dozen bodies on screen the mix was a
 * flat wall — the pilot could hear that *something* happened, never where or
 * whether it mattered to them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUDIO_FAR_RADIUS,
  AUDIO_NEAR_RADIUS,
  AUDIO_PAN_WIDTH,
  distanceBetween,
  spatialGain,
  spatialPan,
  spatialVolume,
} from "../app/spatial-audio.ts";
import { DEFAULT_ARENA } from "../app/arena.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const centre = { x: DEFAULT_ARENA.width / 2, y: DEFAULT_ARENA.height / 2 };

/* ------------------------------------------------------------ the curve */

test("a sound at the listener is untouched", () => {
  assert.equal(spatialGain(0), 1);
  assert.equal(spatialVolume(0.16, centre, centre), 0.16);
  assert.equal(spatialPan(centre, centre), 0);
});

test("volume holds inside the near radius and is gone past the far one", () => {
  assert.equal(spatialGain(AUDIO_NEAR_RADIUS - 1), 1);
  assert.equal(spatialGain(AUDIO_NEAR_RADIUS), 1, "full volume all the way to the edge of it");
  assert.equal(spatialGain(AUDIO_FAR_RADIUS), 0);
  assert.equal(spatialGain(AUDIO_FAR_RADIUS + 500), 0);
});

/**
 * Smoothstepped, not linear.
 *
 * A straight ramp is audible *as a ramp* — a body crossing the threshold
 * sounds like it is being faded by a hand on a dial. The curve has to leave
 * the near edge and arrive at the far one flat.
 */
test("the falloff leaves and arrives flat", () => {
  const slopeAt = (d) => spatialGain(d) - spatialGain(d + 1);
  const band = AUDIO_FAR_RADIUS - AUDIO_NEAR_RADIUS;
  const nearEdge = slopeAt(AUDIO_NEAR_RADIUS + 1);
  const middle = slopeAt(AUDIO_NEAR_RADIUS + band / 2);
  const farEdge = slopeAt(AUDIO_FAR_RADIUS - 2);

  assert.ok(middle > nearEdge * 5, "the steepest part is the middle, not the start");
  assert.ok(middle > farEdge * 5, "and not the end either");
  // Halfway through the band is half the volume, as a straight ramp would be —
  // the curve redistributes the slope without moving the midpoint.
  assert.ok(Math.abs(spatialGain(AUDIO_NEAR_RADIUS + band / 2) - 0.5) < 1e-9);
});

test("gain never leaves 0..1, whatever it is handed", () => {
  for (const d of [-100, 0, 500, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
    const gain = spatialGain(d);
    assert.ok(gain >= 0 && gain <= 1, `${d} produced ${gain}`);
  }
});

/* ----------------------------------------------------- across the arena */

test("the far corner is faint but not silent from the middle", () => {
  // The whole arena stays audible from its centre; it is only the extremes of
  // a corner-to-corner distance that drop out entirely.
  const corner = { x: 0, y: 0 };
  const volume = spatialVolume(0.16, centre, corner);
  assert.ok(volume > 0, "still there");
  assert.ok(volume < 0.16 * 0.35, "but clearly distant");

  // Corner to opposite corner really is beyond earshot.
  assert.ok(distanceBetween({ x: 0, y: 0 }, { x: DEFAULT_ARENA.width, y: DEFAULT_ARENA.height }) > AUDIO_FAR_RADIUS);
});

test("pan follows the horizontal offset and clamps at the extremes", () => {
  assert.ok(spatialPan(centre, { x: centre.x + AUDIO_PAN_WIDTH / 2, y: centre.y }) > 0.49);
  assert.ok(spatialPan(centre, { x: centre.x - AUDIO_PAN_WIDTH / 2, y: centre.y }) < -0.49);
  assert.equal(spatialPan(centre, { x: centre.x + AUDIO_PAN_WIDTH * 4, y: centre.y }), 1);
  assert.equal(spatialPan(centre, { x: centre.x - AUDIO_PAN_WIDTH * 4, y: centre.y }), -1);
});

test("pan ignores the vertical axis", () => {
  // The arena is drawn flat; a vertical component has nowhere to go in a
  // stereo field and would only smear the one axis that carries meaning.
  assert.equal(spatialPan(centre, { x: centre.x, y: 0 }), 0);
  assert.equal(spatialPan(centre, { x: centre.x, y: DEFAULT_ARENA.height }), 0);
});

/* --------------------------------------------------------------- floors */

/**
 * Some sounds are announcements, not events.
 *
 * The rift enraging happens at the rift, which may be the far side of the
 * arena, and a pilot who does not hear it is about to be surprised by it.
 */
test("a floor keeps an announcement audible at any distance", () => {
  const far = { x: DEFAULT_ARENA.width, y: 0 };
  const floored = spatialVolume(0.36, centre, far, 0.7);
  assert.ok(floored >= 0.36 * 0.7, "never falls below its floor");
  assert.ok(floored < 0.36, "but distance still shapes it");

  // A floor of 1 is a sound that ignores distance entirely.
  assert.equal(spatialVolume(0.2, centre, far, 1), 0.2);
  // And no floor is the default.
  assert.ok(spatialVolume(0.2, centre, { x: 5000, y: 5000 }) === 0);
});

/* ------------------------------------------------------------ the wiring */

test("a hostile dying is placed where it died", () => {
  assert.match(game, /play\("explosion", spatialVolume\(0\.16, game\.player, enemy\)\)/);
});

test("damage to the pilot is left alone", () => {
  // It happens at the listener, so it is already at distance zero. Running it
  // through the same helper would be noise for an identical result.
  assert.match(game, /burst\(game, player\.x, player\.y, "#ff5570", 18, 7\);\s*\n\s*play\("explosion", 0\.24\);/);
});

test("waves and drops are placed and panned, with a floor", () => {
  assert.match(game, /playCue\(`spawn:\$\{power\}`, spatialVolume\(0\.15, game\.player, \{ x: originX, y: originY \}, 0\.45\), spatialPan\(/);
  assert.match(game, /playCue\(`spawn:\$\{type\}`, spatialVolume\(0\.17, game\.player, ejection, 0\.45\), spatialPan\(game\.player, ejection\)\)/);
});

test("the rift enraging is floored highest of all", () => {
  assert.match(game, /play\("explosion", spatialVolume\(0\.36, game\.player, \{ x: game\.portalX, y: game\.portalY \}, 0\.7\)\)/);
});

/**
 * Panning is best-effort.
 *
 * StereoPannerNode is absent on older Safari, and a cue heard in the middle is
 * a far better outcome there than a cue not heard at all.
 */
test("a context without a panner still plays the cue", () => {
  assert.match(game, /if \(pan !== 0 && typeof context\.createStereoPanner === "function"\) \{/);
  assert.match(game, /\} else \{\s*\n\s*gain\.connect\(context\.destination\);\s*\n\s*\}/);
});
