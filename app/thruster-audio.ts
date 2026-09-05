/**
 * The engine, as a sound.
 *
 * The ship has always thrown exhaust out of its back and made no noise doing
 * it, which left the single most frequent action in the game — flying — as the
 * only one with no audio at all.
 *
 * **It follows the throttle, not the stick.** That distinction is the whole
 * design, and it exists because Classic is now the default control scheme:
 * there, the left stick both aims and drives, separated by a deadzone, so a
 * pilot lines up shots by holding the stick *without* accelerating. An engine
 * keyed to "is the stick held" would roar through every course correction and
 * would flatly contradict the controls. Keyed to the throttle, it says exactly
 * what the ship is doing — silent while turning, rising as the pilot commits.
 *
 * So this takes the same `intent.magnitude` the physics takes, and the exhaust
 * particles are keyed to it too.
 *
 * The sound itself is filtered noise with a low tone under it, which is what a
 * rocket is: broadband rush plus body. Both open up as the throttle climbs, so
 * a quarter-throttle drift and a full burn are distinguishable with the screen
 * covered by a thumb.
 *
 * The mapping from throttle to sound is pure and lives at the top of this file,
 * separately from the Web Audio plumbing below it, because the mapping is the
 * part with rules worth protecting and Web Audio cannot be instantiated in the
 * test runner.
 */

/** Below this throttle the engine is silent rather than very quiet. */
export const THRUSTER_SILENCE_FLOOR = 0.04;

export const THRUSTER_AUDIO = {
  /** Master gain at full throttle on an unupgraded engine. Deliberately low. */
  peakGain: 0.042,
  /** Lowpass cutoff, in Hz, at zero and at full throttle. */
  minCutoff: 220,
  maxCutoff: 1450,
  /** The body tone's frequency at zero and at full throttle. */
  minPitch: 46,
  maxPitch: 88,
  /** Seconds the engine takes to reach a new level. Short, but not a click. */
  glideSeconds: 0.06,
  /** Seconds the engine takes to die away when the throttle closes. */
  releaseSeconds: 0.11,
  /**
   * What each ENGINE UPGRADE mark adds.
   *
   * The exhaust already says an upgraded engine is upgraded — more sparks,
   * thrown harder, more often. This is the same statement in sound: a little
   * more weight and a little more pitch per mark, so the ship a pilot has been
   * feeding upgrades into is audibly the one they are flying.
   */
  gainPerMark: 0.06,
  pitchPerMark: 0.05,
} as const;

export type ThrusterVoiceLevel = {
  /** Master gain. Zero means the engine should be off, not merely quiet. */
  gain: number;
  /** Lowpass cutoff in Hz. */
  cutoff: number;
  /** The body tone's frequency in Hz. */
  pitch: number;
};

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/**
 * What the engine should sound like at this throttle and engine mark.
 *
 * Gain is scaled by the *square root* of throttle rather than by throttle
 * itself. Loudness is not linear in amplitude, so a linear ramp reads as an
 * engine that stays almost silent for the first half of the stick and then
 * arrives all at once — which is exactly the cliff the Classic throttle was
 * built to avoid. The square root spreads the audible change across the
 * travel the pilot's thumb actually covers.
 *
 * Cutoff and pitch stay linear: they are pitch-like, and the ear already hears
 * those logarithmically.
 */
export function thrusterVoiceLevel(throttle: number, mark = 0): ThrusterVoiceLevel {
  const open = clamp01(throttle);
  if (open < THRUSTER_SILENCE_FLOOR) {
    return { gain: 0, cutoff: THRUSTER_AUDIO.minCutoff, pitch: THRUSTER_AUDIO.minPitch };
  }
  const marks = Number.isFinite(mark) ? Math.max(0, Math.min(3, Math.floor(mark))) : 0;
  const span = (low: number, high: number) => low + (high - low) * open;
  return {
    gain: THRUSTER_AUDIO.peakGain * Math.sqrt(open) * (1 + marks * THRUSTER_AUDIO.gainPerMark),
    cutoff: span(THRUSTER_AUDIO.minCutoff, THRUSTER_AUDIO.maxCutoff),
    pitch: span(THRUSTER_AUDIO.minPitch, THRUSTER_AUDIO.maxPitch) * (1 + marks * THRUSTER_AUDIO.pitchPerMark),
  };
}

/** True when this throttle should be producing sound at all. */
export function thrusterAudible(throttle: number): boolean {
  return clamp01(throttle) >= THRUSTER_SILENCE_FLOOR;
}

// ------------------------------------------------------------- the voice --

export type ThrusterAudioContextProvider = () => AudioContext | null;

type Voice = {
  context: AudioContext;
  master: GainNode;
  filter: BiquadFilterNode;
  noise: AudioBufferSourceNode;
  body: OscillatorNode;
};

/** Two seconds of noise, looped. Long enough that the loop is not a pitch. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const frames = Math.floor(context.sampleRate * 2);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  // Brown-ish rather than white: a running integral of white noise has far
  // more low end, which is what makes it read as an engine instead of hiss.
  let last = 0;
  for (let i = 0; i < frames; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + white * 0.02) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

/**
 * Owns at most one engine voice.
 *
 * `sync` is idempotent and safe to call every frame: it creates AudioNodes
 * only when the engine goes from silent to running, and otherwise does nothing
 * but retarget two parameters. Building nodes per frame is the one thing that
 * would make a continuous sound expensive, so it is the thing this class
 * exists to prevent — the same reason `BeamAudioManager` exists.
 */
export class ThrusterAudioManager {
  private voice: Voice | null = null;
  private enabled = true;
  private volume = 1;
  private readonly getContext: ThrusterAudioContextProvider;

  constructor(getContext: ThrusterAudioContextProvider) {
    this.getContext = getContext;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop(true);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, volume);
  }

  /** True while a voice exists. For tests and for the audio-cost budget. */
  running() {
    return this.voice !== null;
  }

  /**
   * Match the engine to this throttle.
   *
   * `mark` is the ENGINE UPGRADE level, 0 to 3.
   */
  sync(throttle: number, mark = 0) {
    const level = this.enabled ? thrusterVoiceLevel(throttle, mark) : { gain: 0, cutoff: 0, pitch: 0 };
    if (level.gain <= 0) {
      this.stop();
      return;
    }
    if (!this.voice) this.start();
    const voice = this.voice;
    if (!voice) return;

    const now = voice.context.currentTime;
    const glide = THRUSTER_AUDIO.glideSeconds;
    voice.master.gain.setTargetAtTime(level.gain * this.volume, now, glide);
    voice.filter.frequency.setTargetAtTime(level.cutoff, now, glide);
    voice.body.frequency.setTargetAtTime(level.pitch, now, glide);
  }

  stop(immediate = false) {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    const now = voice.context.currentTime;
    const end = now + (immediate ? 0.012 : THRUSTER_AUDIO.releaseSeconds);
    voice.master.gain.cancelScheduledValues(now);
    voice.master.gain.setValueAtTime(Math.max(0.0001, voice.master.gain.value), now);
    voice.master.gain.exponentialRampToValueAtTime(0.0001, end);
    voice.noise.stop(end + 0.01);
    voice.body.stop(end + 0.01);
  }

  private start() {
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;

    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(THRUSTER_AUDIO.minCutoff, now);
    filter.Q.setValueAtTime(0.9, now);
    filter.connect(master);

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer(context);
    noise.loop = true;
    noise.connect(filter);
    noise.start(now);

    // The body tone goes through its own quiet gain rather than the filter, so
    // the low end stays present when the cutoff is closed right down at low
    // throttle. Without it, an idling engine vanishes entirely.
    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = "sawtooth";
    body.frequency.setValueAtTime(THRUSTER_AUDIO.minPitch, now);
    bodyGain.gain.setValueAtTime(0.34, now);
    body.connect(bodyGain);
    bodyGain.connect(master);
    body.start(now);

    this.voice = { context, master, filter, noise, body };
  }
}
