import type { RiftHardpoint } from "./types.ts";

/**
 * The breaches that hand out a socket for free.
 *
 * There used to be three — 1, 3 and 5 — which meant every socket a run would
 * ever have arrived on a timer, and the ship class picked in the menu decided
 * how many of them landed. Sockets are earned upgrade choices now, so the
 * milestone list is down to the first breach only: destroying your first rift
 * still puts a gun on your hull without spending a pick, which is a good early
 * beat, and every socket after that has to be chosen over a cannon mark, a
 * payload slot or a Special. Breaches remain *one* source of unlocks rather
 * than the only one.
 */
export const HARDPOINT_BREACH_MILESTONES = [1] as const;

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
