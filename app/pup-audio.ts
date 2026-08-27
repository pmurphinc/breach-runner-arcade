import type { PupClass } from "./game-data";

/** A compact Web Audio signature used when a loose arena PUP is collected. */
export type PupPickupSoundProfile = Readonly<{
  id: `pup-pickup:${PupClass}`;
  frequencies: readonly number[];
  duration: number;
  gap: number;
  type: OscillatorType;
  volume: number;
}>;

/**
 * The authoritative PupClass-to-pickup-sound mapping.
 *
 * These are deliberately class identities rather than pickup identities: new
 * PUPs automatically inherit the audible language already used by their class.
 */
export const PUP_PICKUP_SOUND_PROFILES: Readonly<Record<PupClass, PupPickupSoundProfile>> = {
  payload: {
    id: "pup-pickup:payload",
    frequencies: [1180, 590],
    duration: 0.18,
    gap: 0.022,
    type: "square",
    volume: 0.13,
  },
  upgrade: {
    id: "pup-pickup:upgrade",
    frequencies: [480, 720, 1080],
    duration: 0.3,
    gap: 0.045,
    type: "triangle",
    volume: 0.14,
  },
  recovery: {
    id: "pup-pickup:recovery",
    frequencies: [440, 660],
    duration: 0.32,
    gap: 0.1,
    type: "sine",
    volume: 0.13,
  },
  rare: {
    id: "pup-pickup:rare",
    frequencies: [330, 825, 550],
    duration: 0.36,
    gap: 0.06,
    type: "sine",
    volume: 0.14,
  },
};

export function pupPickupSoundProfile(pupClass: PupClass): PupPickupSoundProfile {
  return PUP_PICKUP_SOUND_PROFILES[pupClass];
}
