/**
 * One object holding every Rift Run danger system.
 *
 * The budget, the pressure meter, the hazard scheduler and the two live
 * retaliation entities all begin and end together — a rift reforming resets
 * three of the four, a run ending resets all of them — so they are created and
 * reset as one thing rather than as four fields the game loop has to remember
 * to keep in step.
 *
 * Deliberately thin. Every rule lives in the module that owns it; this is only
 * the composition, and the one place that knows what "a new rift" means.
 */

import { createRiftHazardScheduler, clearRiftHazards, type RiftHazardScheduler } from "./environmental-hazards.ts";
import { createRiftPupBudget, type RiftPupBudget } from "./pup-budget.ts";
import { RIFT_PHASES, type RiftPhaseId } from "./rift-phases.ts";
import {
  createRiftPressure,
  resetRiftPressure,
  type RiftPressureState,
  type RiftShockwave,
  type RiftSweep,
} from "./rift-pressure.ts";

export type RiftDangerRuntime = {
  /**
   * What this rift has left to shed. Replaced outright when a rift reforms.
   *
   * Null outside Rift Run. PvE's rift pays power-ups per point of damage
   * taken rather than out of a per-rift allocation, so there is nothing to
   * budget -- and its absence is what the loop reads to tell the two apart.
   */
  budget: RiftPupBudget | null;
  pressure: RiftPressureState;
  /**
   * The environmental hazard scheduler. Null outside Rift Run.
   *
   * Hazards are gated on breach depth and pilot level, neither of which
   * exists in an ordinary PvE round.
   */
  hazards: RiftHazardScheduler | null;
  /** Rings in flight. Each is created by a landed shockwave retaliation. */
  shockwaves: RiftShockwave[];
  /** Rotating arms in flight. At most one, but a list keeps the loop uniform. */
  sweeps: RiftSweep[];
  /** The phase last announced, so a change is announced exactly once. */
  phaseId: RiftPhaseId;
};

export function createRiftDanger(): RiftDangerRuntime {
  return {
    budget: createRiftPupBudget(),
    pressure: createRiftPressure(),
    hazards: createRiftHazardScheduler(),
    shockwaves: [],
    sweeps: [],
    phaseId: RIFT_PHASES[0].id,
  };
}

/**
 * The same rift danger, minus the two systems that belong to Rift Run.
 *
 * A PvE rift on VOLATILE or CRITICAL builds pressure and retaliates exactly
 * as a Rift Run's does -- that is the whole point of sharing the runtime
 * rather than growing a second one -- but it sheds power-ups on damage
 * instead of out of a budget, and it schedules no environmental hazards.
 */
export function createPressureZoneDanger(): RiftDangerRuntime {
  return {
    budget: null,
    pressure: createRiftPressure(),
    hazards: null,
    shockwaves: [],
    sweeps: [],
    phaseId: RIFT_PHASES[0].id,
  };
}

/** True when this runtime belongs to a Rift Run rather than a PvE round. */
export function isRiftRunDanger(runtime: RiftDangerRuntime): boolean {
  return runtime.budget !== null;
}

/**
 * A fresh rift has arrived.
 *
 * The budget starts over — that is the whole point of a per-rift allocation —
 * and so does pressure and the phase, because the new rift is at full
 * integrity and has done nothing to the pilot yet. Retaliations already in
 * flight are cancelled: a shockwave from a rift that no longer exists is a
 * hit with nothing on screen to explain it.
 *
 * The hazard scheduler is *not* reset. Environmental hazards belong to the
 * run, not to the rift, and clearing them on every breach would mean the
 * arena went quiet exactly when the run got harder.
 */
export function resetRiftDangerForNewRift(runtime: RiftDangerRuntime): void {
  // A PvE rift has no budget to replace, and giving it one here would turn
  // it into a Rift Run rift on the next breach.
  if (runtime.budget) runtime.budget = createRiftPupBudget();
  resetRiftPressure(runtime.pressure);
  runtime.shockwaves = [];
  runtime.sweeps = [];
  runtime.phaseId = RIFT_PHASES[0].id;
}

/** Wipes everything, including hazards. For a run ending or being abandoned. */
export function clearRiftDanger(runtime: RiftDangerRuntime): void {
  resetRiftDangerForNewRift(runtime);
  if (runtime.hazards) clearRiftHazards(runtime.hazards);
}
