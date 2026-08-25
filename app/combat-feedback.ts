export type CombatHaptics = "off" | "gun" | "hull" | "both";
export type CombatHapticEvent = "gun" | "hull";

/** One recognizable cannon voice, pitched brighter as the pulse cannon upgrades. */
export const CANNON_PLAYBACK_RATE = [1, 1.08, 1.17, 1.28, 1.4] as const;

export function hapticsAllow(mode: CombatHaptics, event: CombatHapticEvent) {
  return mode === "both" || mode === event;
}

/** Keeps MK values safe even if a future ship or saved run supplies a wider index. */
export function cannonPlaybackRate(mark: number) {
  const index = Math.max(0, Math.min(CANNON_PLAYBACK_RATE.length - 1, Math.round(mark)));
  return CANNON_PLAYBACK_RATE[index];
}
