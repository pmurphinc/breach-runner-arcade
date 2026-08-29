import type { RiftHardpoint } from "./types.ts";

export const HARDPOINT_BREACH_MILESTONES = [1, 3, 5] as const;

/** Returns the exact zero-based socket awarded by a breach, within the ship's capacity. */
export function hardpointIndexForBreach(breach: number, maximumHardpoints: number): number | null {
  const index = HARDPOINT_BREACH_MILESTONES.indexOf(breach as (typeof HARDPOINT_BREACH_MILESTONES)[number]);
  return index >= 0 && index < maximumHardpoints ? index : null;
}

/** Unlocks only the milestone's exact socket. Existing/legacy state is left untouched. */
export function hardpointUnlockForBreach(
  hardpoints: RiftHardpoint[],
  breach: number,
  maximumHardpoints: number,
): { hardpoints: RiftHardpoint[]; hardpointIndex: number | null } {
  const hardpointIndex = hardpointIndexForBreach(breach, maximumHardpoints);
  if (hardpointIndex === null || hardpoints[hardpointIndex]?.status !== "locked") {
    return { hardpoints, hardpointIndex: null };
  }
  const next = structuredClone(hardpoints);
  next[hardpointIndex] = { index: hardpointIndex, status: "available" };
  return { hardpoints: next, hardpointIndex };
}
