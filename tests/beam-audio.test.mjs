import assert from "node:assert/strict";
import test from "node:test";
import {
  BeamAudioManager,
  HOSTILE_BEAM_AUDIO,
  PHANTOM_BEAM_AUDIO,
} from "../app/beam-audio.ts";

class Param {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}

class Node {
  connect() { return this; }
}

class Oscillator extends Node {
  frequency = new Param();
  detune = new Param();
  stopped = false;
  start() {}
  stop() { this.stopped = true; }
}

class AudioContextStub {
  currentTime = 4;
  destination = new Node();
  oscillators = [];
  gains = [];
  resume() { return Promise.resolve(); }
  createOscillator() {
    const node = new Oscillator();
    this.oscillators.push(node);
    return node;
  }
  createGain() {
    const node = new Node();
    node.gain = new Param();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new Node();
    node.frequency = new Param();
    node.Q = new Param();
    return node;
  }
}

test("Phantom starts once, stays allocated across frames, and stops at beam end", () => {
  const context = new AudioContextStub();
  const audio = new BeamAudioManager(() => context);
  audio.sync(true, 0);
  const created = context.oscillators.length;
  assert.equal(audio.activeVoiceCount(), 1);
  audio.sync(true, 0);
  audio.sync(true, 0);
  assert.equal(context.oscillators.length, created, "a render frame must not make nodes");
  audio.sync(false, 0);
  assert.equal(audio.activeVoiceCount(), 0);
  assert.ok(context.oscillators.every((node) => node.stopped));
});

test("cleanup/death/reset stops voices and repeated activation does not leak live nodes", () => {
  const context = new AudioContextStub();
  const audio = new BeamAudioManager(() => context);
  for (let activation = 0; activation < 4; activation += 1) {
    audio.sync(true, 0);
    assert.equal(audio.activeVoiceCount(), 1);
    audio.stopAll();
    assert.equal(audio.activeVoiceCount(), 0);
  }
  assert.ok(context.oscillators.every((node) => node.stopped));
});

test("hostile profile is distinct and any number of hostile beams shares one voice", () => {
  assert.notEqual(HOSTILE_BEAM_AUDIO.baseFrequency, PHANTOM_BEAM_AUDIO.baseFrequency);
  assert.notEqual(HOSTILE_BEAM_AUDIO.harmonicRatio, PHANTOM_BEAM_AUDIO.harmonicRatio);
  assert.ok(HOSTILE_BEAM_AUDIO.ignitionSeconds > PHANTOM_BEAM_AUDIO.ignitionSeconds);
  const context = new AudioContextStub();
  const audio = new BeamAudioManager(() => context);
  audio.sync(false, 1, 0.2);
  const created = context.oscillators.length;
  audio.sync(false, 2, 0.8);
  audio.sync(false, 30, 1.2);
  assert.equal(audio.activeVoiceCount(), 1);
  assert.equal(context.oscillators.length, created, "beam count must not multiply voices");
  audio.sync(false, 0);
  assert.equal(audio.activeVoiceCount(), 0);
});

test("Sound OFF prevents starts and disabling sound fades active audio", () => {
  const context = new AudioContextStub();
  const audio = new BeamAudioManager(() => context);
  audio.setEnabled(false);
  audio.sync(true, 4);
  assert.equal(context.oscillators.length, 0);
  audio.setEnabled(true);
  audio.sync(true, 1);
  assert.equal(audio.activeVoiceCount(), 2);
  audio.setEnabled(false);
  assert.equal(audio.activeVoiceCount(), 0);
  assert.ok(context.oscillators.every((node) => node.stopped));
  audio.sync(false, 0);
  audio.setEnabled(true);
  assert.equal(audio.activeVoiceCount(), 0, "unmuting must not revive stale beams");
});
