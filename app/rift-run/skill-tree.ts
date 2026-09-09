/**
 * The skill tree the five ladders were always most of the way to being.
 *
 * A Rift Run already advanced along five fixed ladders — payload slots, cannon
 * marks, thrusters, the Special, and hull sockets — each with a real top. What
 * it lacked was the two things that make a set of ladders a *tree*: somewhere
 * they lead, and a way to see how far along them you are.
 *
 * Without those, every screen was a local decision. A pilot could take the
 * best-looking card three times running and never once be choosing a build,
 * because nothing was ever downstream of anything. Finishing a ladder was
 * indistinguishable from abandoning it — both simply meant fewer cards.
 *
 * So the branches converge. Completing three of the five unlocks a capstone
 * that no ladder can offer on its own, which turns "which card is best now?"
 * into "which three am I going to finish?" — a question asked on the first
 * screen and answered on the last.
 *
 * ## Why three of five, and not all five
 *
 * All five is a run that never had to choose, and on most runs it is simply
 * unreachable — the capstone would be a thing pilots hear about rather than
 * hold. Three is past half, cannot be reached by drifting, and still leaves
 * two ladders' worth of picks to spend on whatever the run actually needs. It
 * rewards commitment without demanding a perfect run.
 *
 * Which three is free. The tree does not care whether a pilot topped out the
 * cannon or the thrusters, so a gun build and a mobility build reach the same
 * capstone by different routes, which is the point of it being a tree rather
 * than a track.
 *
 * Pure: reads state, returns numbers and one card. The pool decides when to
 * offer it and the loop decides what it does.
 */

import {
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_SOCKETS,
  RIFT_RUN_MAX_SPECIAL_TIER,
  RIFT_RUN_MAX_THRUSTER_TIER,
  type RiftSystemId,
} from "./loadout.ts";
import type { UpgradeChoice } from "./upgrades.ts";
import type { RiftRunState } from "./types.ts";

/** The capstone's id, in `upgradeHistory` like any other pick. */
export const PHASE_ROUNDS_ID = "phase-rounds";

/** Ladders that must be finished before the capstone is offered. */
export const CAPSTONE_REQUIRED_BRANCHES = 3;

export type BranchId = "payload" | "cannon" | "thrusters" | "special" | "sockets";

export type BranchProgress = {
  id: BranchId;
  /** The ship system this branch belongs to, for colour and grouping. */
  system: RiftSystemId;
  label: string;
  current: number;
  max: number;
  complete: boolean;
};

/**
 * How far along each ladder this run is.
 *
 * Read from the loadout rather than counted out of `upgradeHistory`: the
 * loadout is what the rest of the game already treats as the truth, and a
 * history-derived count would drift the moment a card paid out anywhere else.
 */
export function branchProgress(state: RiftRunState): BranchProgress[] {
  const loadout = state.loadout;
  // A locked hardpoint has not been cut yet; every other status has.
  const sockets = state.hardpoints.filter((point) => point.status !== "locked").length;
  const raw: Array<Omit<BranchProgress, "complete">> = [
    { id: "payload", system: "payload", label: "PAYLOAD", current: loadout.payloadSlots, max: RIFT_RUN_MAX_PAYLOAD_SLOTS },
    { id: "cannon", system: "cannon", label: "CANNON", current: loadout.cannonTier, max: RIFT_RUN_MAX_CANNON_TIER },
    { id: "thrusters", system: "thrusters", label: "THRUSTERS", current: loadout.thrusterTier, max: RIFT_RUN_MAX_THRUSTER_TIER },
    // Locked reads as zero, so an untouched Special is visibly a ladder not
    // yet started rather than one already on its first rung.
    { id: "special", system: "special", label: "SPECIAL", current: loadout.special ? loadout.special.tier : 0, max: RIFT_RUN_MAX_SPECIAL_TIER },
    { id: "sockets", system: "hull", label: "SOCKETS", current: sockets, max: RIFT_RUN_MAX_SOCKETS },
  ];
  return raw.map((branch) => ({ ...branch, complete: branch.current >= branch.max }));
}

/** Ladders finished. The tree's only progress number. */
export function completedBranches(state: RiftRunState): number {
  return branchProgress(state).filter((branch) => branch.complete).length;
}

/** Has this run taken the capstone? */
export function hasPhaseRounds(state: RiftRunState): boolean {
  return state.upgradeHistory.some((entry) => entry.upgradeId === PHASE_ROUNDS_ID);
}

/** Is the capstone reachable yet, whether or not it has been taken? */
export function capstoneUnlocked(state: RiftRunState): boolean {
  return completedBranches(state) >= CAPSTONE_REQUIRED_BRANCHES;
}

/**
 * The capstone card, or nothing.
 *
 * Offered once the requirement is met and never again after it is taken. It
 * carries no `system` contention of its own worth speaking of — the pool
 * promotes it the way it promotes an evolution, because a reward for finishing
 * three ladders that a shuffle can hide is not a reward.
 */
export function capstoneChoice(state: RiftRunState): UpgradeChoice | null {
  if (!capstoneUnlocked(state) || hasPhaseRounds(state)) return null;
  return {
    key: PHASE_ROUNDS_ID,
    upgradeId: PHASE_ROUNDS_ID,
    system: "cannon",
    gameplayCategory: "offensive",
    track: PHASE_ROUNDS_ID,
    title: "PHASE ROUNDS",
    target: `${completedBranches(state)} / ${CAPSTONE_REQUIRED_BRANCHES} LADDERS COMPLETE`,
    description: "Your shots pass through loose power-ups instead of destroying them.",
  };
}
