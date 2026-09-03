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
  /** What this rift has left to shed. Replaced outright when a rift reforms. */
  budget: RiftPupBudget;
  pressure: RiftPressureState;
  hazards: RiftHazardScheduler;
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
  runtime.budget = createRiftPupBudget();
  resetRiftPressure(runtime.pressure);
  runtime.shockwaves = [];
  runtime.sweeps = [];
  runtime.phaseId = RIFT_PHASES[0].id;
}

/** Wipes everything, including hazards. For a run ending or being abandoned. */
export function clearRiftDanger(runtime: RiftDangerRuntime): void {
  resetRiftDangerForNewRift(runtime);
  clearRiftHazards(runtime.hazards);
}
