/**
 * The engine sound.
 *
 * The rule worth protecting is one sentence: **it follows the throttle, not
 * the stick.** Classic is the default control scheme now, and there a pilot
 * holds the stick inside the deadzone to turn without accelerating — lining up
 * a shot. An engine keyed to "is the stick held" would roar through every one
 * of those, and would still look completely correct in a screenshot, because
 * sound is the one thing a screenshot cannot show.
 *
 * The second rule is cheaper to state and just as easy to break: a continuous
 * sound must not build AudioNodes per frame. That is what makes it expensive,
 * and it is invisible until a phone gets hot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  THRUSTER_AUDIO,
  THRUSTER_SILENCE_FLOOR,
  ThrusterAudioManager,
  thrusterAudible,
  thrusterVoiceLevel,
} from "../app/thruster-audio.ts";
import { intentFromStick } from "../app/movement.ts";
import { classicDeadzone, classicStickFlight } from "../app/flight-controls.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("turning inside the deadzone is silent", () => {
  // The whole reason this module keys off magnitude. A Classic stick held at
  // two-thirds of the deadzone is a course correction: the hull turns, the
  // engine does not light, and it must not be heard either.
  const travel = 100;
  const ring = classicDeadzone(travel, null);
  const flight = classicStickFlight(ring * 0.66, 0, travel, ring);
  const intent = intentFromStick(flight.heading, flight.throttle);

  assert.ok(intent.active, "the intent is active -- the ship is turning");
  assert.equal(intent.magnitude, 0);
  assert.equal(thrusterVoiceLevel(intent.magnitude).gain, 0, "and the engine is silent");
  assert.ok(!thrusterAudible(intent.magnitude));
});

test("pushing past the deadzone lights the engine", () => {
  const travel = 100;
  const ring = classicDeadzone(travel, null);
  const flight = classicStickFlight(travel, 0, travel, ring);
  const intent = intentFromStick(flight.heading, flight.throttle);

  assert.equal(intent.magnitude, 1);
  assert.ok(thrusterVoiceLevel(intent.magnitude).gain > 0);
});

test("the engine goes silent rather than very quiet", () => {
  // A voice left running at an inaudible gain is a voice still costing a
  // phone battery, and a floor of exactly zero would flicker on and off around
  // a stick resting near centre.
  assert.equal(thrusterVoiceLevel(0).gain, 0);
  assert.equal(thrusterVoiceLevel(THRUSTER_SILENCE_FLOOR / 2).gain, 0);
  assert.ok(thrusterVoiceLevel(THRUSTER_SILENCE_FLOOR).gain > 0, "and starts at the floor");
});

test("it gets louder, brighter and higher all the way up", () => {
  // Monotonic across the whole travel, so a pilot can hear how hard they are
  // burning rather than only whether they are.
  const readings = [0.1, 0.25, 0.5, 0.75, 1].map((t) => thrusterVoiceLevel(t));
  for (let i = 1; i < readings.length; i += 1) {
    assert.ok(readings[i].gain > readings[i - 1].gain, "gain climbs");
    assert.ok(readings[i].cutoff > readings[i - 1].cutoff, "the filter opens");
    assert.ok(readings[i].pitch > readings[i - 1].pitch, "the body rises");
  }
});

test("half throttle is audibly halfway, not almost silent", () => {
  // Loudness is not linear in amplitude. A linear ramp would leave the first
  // half of the stick nearly silent and then arrive all at once, which is the
  // same cliff the Classic throttle itself was shaped to avoid.
  const half = thrusterVoiceLevel(0.5).gain;
  const full = thrusterVoiceLevel(1).gain;
  assert.ok(half > full * 0.5, `half throttle (${half}) should beat a linear ramp (${full * 0.5})`);
  assert.ok(half < full, "but still be short of full");
});

test("the engine never gets loud enough to sit on top of the game", () => {
  // It plays for as long as the pilot is flying, which is most of a run, so it
  // is a bed rather than an effect. Checked at every engine mark, since the
  // upgrade scales it.
  for (let mark = 0; mark <= 3; mark += 1) {
    assert.ok(thrusterVoiceLevel(1, mark).gain < 0.08, `mark ${mark} is too loud`);
  }
});

test("an upgraded engine sounds upgraded", () => {
  // The exhaust already says so -- more sparks, thrown harder. This is the same
  // statement in sound.
  const stock = thrusterVoiceLevel(1, 0);
  const maxed = thrusterVoiceLevel(1, 3);
  assert.ok(maxed.gain > stock.gain);
  assert.ok(maxed.pitch > stock.pitch);

  // A mark beyond the three the game awards cannot keep scaling it.
  assert.equal(thrusterVoiceLevel(1, 99).gain, maxed.gain);
  assert.equal(thrusterVoiceLevel(1, -5).gain, stock.gain);
});

test("nonsense throttles do not produce nonsense sound", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, undefined, 5]) {
    const level = thrusterVoiceLevel(bad);
    assert.ok(Number.isFinite(level.gain), `${bad} produced ${level.gain}`);
    assert.ok(level.gain >= 0 && level.gain < 0.08);
    assert.ok(Number.isFinite(level.cutoff) && level.cutoff > 0);
  }
});

test("a voice is built once, not every frame", () => {
  // The one thing that makes a continuous sound expensive. `sync` runs on the
  // render loop, so it has to be safe to call sixty times a second.
  let created = 0;
  const stubContext = () => ({
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    createBuffer: (channels, frames) => ({ getChannelData: () => new Float32Array(frames) }),
    createGain: () => { created += 1; return param("gain"); },
    createBiquadFilter: () => { created += 1; return { ...param("frequency"), ...param("Q"), type: "" }; },
    createBufferSource: () => { created += 1; return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; },
    createOscillator: () => { created += 1; return { ...param("frequency"), type: "", connect() {}, start() {}, stop() {} }; },
  });
  const knob = () => ({
    value: 0.01,
    setValueAtTime() {}, setTargetAtTime() {},
    cancelScheduledValues() {}, exponentialRampToValueAtTime() {},
  });
  function param(name) {
    return { [name]: knob(), connect() {}, start() {}, stop() {} };
  }

  const context = stubContext();
  const engine = new ThrusterAudioManager(() => context);

  engine.sync(1);
  const afterFirst = created;
  assert.ok(afterFirst > 0, "the first burn builds the voice");
  assert.ok(engine.running());

  for (let frame = 0; frame < 240; frame += 1) engine.sync(0.3 + (frame % 7) / 10);
  assert.equal(created, afterFirst, "four seconds of flying built nothing more");

  // Closing the throttle releases it, and re-opening builds one again.
  engine.sync(0);
  assert.ok(!engine.running(), "the voice is released when the throttle closes");
  engine.sync(1);
  assert.ok(created > afterFirst);
});

test("muting stops the engine, not just its volume", () => {
  const engine = new ThrusterAudioManager(() => null);
  engine.setEnabled(false);
  engine.sync(1);
  assert.ok(!engine.running(), "a muted engine never opens a voice");
});

test("no audio context means no sound and no crash", () => {
  // Audio is unlocked by a gesture, so the loop can and does call sync before
  // there is a context to build in.
  const engine = new ThrusterAudioManager(() => null);
  engine.sync(1);
  assert.ok(!engine.running());
  engine.stop();
});

// ------------------------------------------------------------- the wiring --

test("the loop feeds it the intent's own magnitude", () => {
  // If this ever reverts to `intent.active`, the deadzone stops existing as far
  // as the ear is concerned and nothing else in the suite would notice.
  assert.ok(game.includes("const burning = intent.active && intent.heading !== null ? intent.magnitude : 0;"));
  assert.ok(game.includes("engineThrottle.current = burning;"));
  assert.ok(game.includes("getThrusterAudio().sync("));
});

test("the exhaust follows the throttle too", () => {
  // The particles were keyed to `intent.active` alone, so a Classic pilot
  // turning inside the deadzone threw exhaust out of a ship that was not
  // accelerating. Sound and picture now say the same thing.
  assert.ok(game.includes("if (burning > 0 && game.cycles % exhaustEvery === 0) {"));
  assert.ok(
    !game.includes("if (intent.active && intent.heading !== null && game.cycles % exhaustEvery === 0)"),
    "the old condition is gone",
  );
});

test("the engine is quiet when there is no run to fly", () => {
  // A paused game, a dead pilot or a menu must not leave an engine droning.
  assert.ok(game.includes("audioGame.running && !audioGame.paused && !audioGame.result && audioGame.player.health > 0"));
  assert.ok(game.includes("getThrusterAudio().stop();"), "and it is stopped when the loop tears down");
  assert.ok(game.includes("thrusterAudio.current?.stop(true);"), "and when the audio context closes");
});

test("it obeys the sound setting like every other effect", () => {
  assert.ok(game.includes("engine.setVolume(SOUND_GAIN[settings.soundLevel]);"));
  assert.ok(game.includes("engine.setEnabled(sound);"));
});

test("the tuning stays where it can be read", () => {
  // The mapping is the part with rules; the Web Audio plumbing is not. Keeping
  // the numbers in one exported table is what lets every test above be about
  // behaviour rather than about node graphs.
  assert.ok(THRUSTER_AUDIO.maxCutoff > THRUSTER_AUDIO.minCutoff);
  assert.ok(THRUSTER_AUDIO.maxPitch > THRUSTER_AUDIO.minPitch);
  assert.ok(THRUSTER_AUDIO.releaseSeconds > 0, "the engine fades rather than clicking off");
  assert.ok(THRUSTER_AUDIO.glideSeconds > 0, "and slides between levels rather than stepping");
});
