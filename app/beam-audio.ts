/** Low-cost, shared Web Audio voices for the two continuous beam weapons. */

export const PHANTOM_BEAM_AUDIO = {
  baseFrequency: 118,
  harmonicRatio: 2.03,
  humGain: 0.055,
  harmonicGain: 0.018,
  ignitionSeconds: 0.13,
  driftHz: 2.7,
  driftRate: 0.72,
} as const;

export const HOSTILE_BEAM_AUDIO = {
  baseFrequency: 73,
  harmonicRatio: 2.91,
  humGain: 0.046,
  harmonicGain: 0.026,
  ignitionSeconds: 0.24,
  driftHz: 5.5,
  driftRate: 0.41,
} as const;

type BeamProfile = typeof PHANTOM_BEAM_AUDIO | typeof HOSTILE_BEAM_AUDIO;
type BeamKind = "phantom" | "hostile";

type Voice = {
  context: AudioContext;
  master: GainNode;
  oscillators: OscillatorNode[];
  lfo: OscillatorNode;
};

export type BeamAudioContextProvider = () => AudioContext | null;

/**
 * Owns at most one player and one hostile voice. `sync` is deliberately
 * idempotent so the fixed-step/render loop can call it freely without making
 * per-frame AudioNodes. A hostile count is collapsed into one danger voice.
 */
export class BeamAudioManager {
  private voices: Partial<Record<BeamKind, Voice>> = {};
  private enabled = true;
  private volume = 1;
  private readonly getContext: BeamAudioContextProvider;

  constructor(getContext: BeamAudioContextProvider) {
    this.getContext = getContext;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopAll();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, volume);
  }

  sync(phantomActive: boolean, hostileBeamCount: number, hostileSweep = 0) {
    const phantom = this.enabled && phantomActive;
    const hostile = this.enabled && hostileBeamCount > 0;
    if (phantom && !this.voices.phantom) this.start("phantom", PHANTOM_BEAM_AUDIO);
    else if (!phantom && this.voices.phantom) this.stop("phantom");
    if (hostile && !this.voices.hostile) this.start("hostile", HOSTILE_BEAM_AUDIO);
    else if (!hostile && this.voices.hostile) this.stop("hostile");

    // Rotation changes an existing parameter; it never creates another node.
    const hostileVoice = this.voices.hostile;
    if (hostileVoice) {
      const now = hostileVoice.context.currentTime;
      hostileVoice.master.gain.setTargetAtTime(
        HOSTILE_BEAM_AUDIO.humGain * this.volume * (0.94 + Math.sin(hostileSweep) * 0.06),
        now,
        0.08,
      );
    }
  }

  stopAll(immediate = false) {
    this.stop("phantom", immediate);
    this.stop("hostile", immediate);
  }

  activeVoiceCount() {
    return Number(Boolean(this.voices.phantom)) + Number(Boolean(this.voices.hostile));
  }

  private start(kind: BeamKind, profile: BeamProfile) {
    const context = this.getContext();
    if (!context) return;
    const now = context.currentTime;
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = kind === "phantom" ? "lowpass" : "bandpass";
    filter.frequency.setValueAtTime(kind === "phantom" ? 1180 : 690, now);
    filter.Q.setValueAtTime(kind === "phantom" ? 1.4 : 3.2, now);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(profile.humGain * this.volume, now + profile.ignitionSeconds);
    filter.connect(master);
    master.connect(context.destination);

    const makeVoice = (type: OscillatorType, frequency: number, level: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(level, now);
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start(now);
      return oscillator;
    };
    const oscillators = [
      makeVoice(kind === "phantom" ? "triangle" : "sawtooth", profile.baseFrequency, 0.72),
      makeVoice(kind === "phantom" ? "sine" : "square", profile.baseFrequency * profile.harmonicRatio, profile.harmonicGain / profile.humGain),
    ];
    const lfo = context.createOscillator();
    const drift = context.createGain();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(profile.driftRate, now);
    drift.gain.setValueAtTime(profile.driftHz, now);
    lfo.connect(drift);
    oscillators.forEach((oscillator) => drift.connect(oscillator.detune));
    lfo.start(now);

    // A separate, self-ending ignition snap supplies the sharp VRRM/SHHNN.
    const ignition = context.createOscillator();
    const ignitionGain = context.createGain();
    ignition.type = kind === "phantom" ? "sawtooth" : "square";
    ignition.frequency.setValueAtTime(kind === "phantom" ? 84 : 48, now);
    ignition.frequency.exponentialRampToValueAtTime(kind === "phantom" ? 610 : 260, now + profile.ignitionSeconds);
    ignitionGain.gain.setValueAtTime(0.0001, now);
    ignitionGain.gain.exponentialRampToValueAtTime((kind === "phantom" ? 0.075 : 0.065) * this.volume, now + 0.018);
    ignitionGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.ignitionSeconds);
    ignition.connect(ignitionGain);
    ignitionGain.connect(context.destination);
    ignition.start(now);
    ignition.stop(now + profile.ignitionSeconds + 0.01);
    oscillators.push(ignition);
    this.voices[kind] = { context, master, oscillators, lfo };
  }

  private stop(kind: BeamKind, immediate = false) {
    const voice = this.voices[kind];
    if (!voice) return;
    delete this.voices[kind];
    const now = voice.context.currentTime;
    const end = now + (immediate ? 0.012 : 0.085);
    voice.master.gain.cancelScheduledValues(now);
    voice.master.gain.setValueAtTime(Math.max(0.0001, voice.master.gain.value), now);
    voice.master.gain.exponentialRampToValueAtTime(0.0001, end);
    [...voice.oscillators, voice.lfo].forEach((oscillator) => oscillator.stop(end + 0.01));
  }
}
