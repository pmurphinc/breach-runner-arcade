import { awardRiftEnergy } from "./progression.ts";
import { RIFT_RUN_BREACH_REWARDS, RIFT_RUN_REFORM_DELAY_MS, riftIntegrityForBreach } from "./rift-damage.ts";
import type { RiftRunState } from "./types.ts";
import { hardpointUnlockForBreach } from "./hardpoint-milestones.ts";

export type RiftBreachRuntime = { integrity: number; maximumIntegrity: number; reformRemainingMs: number; breached: boolean };

/** Starts exactly one breach and pays its serialized rewards exactly once. */
export function breachRiftRun(state: RiftRunState, runtime: RiftBreachRuntime, delayMs = RIFT_RUN_REFORM_DELAY_MS): { state: RiftRunState; runtime: RiftBreachRuntime } {
  if (runtime.breached || runtime.integrity > 0) return { state, runtime };
  const riftBreaches = state.riftBreaches + 1;
  const unlocked = hardpointUnlockForBreach(state.hardpoints, riftBreaches, state.maximumHardpoints);
  const pendingHullGunReward = unlocked.hardpointIndex === null
    ? state.pendingHullGunReward
    : { hardpointIndex: unlocked.hardpointIndex, breach: riftBreaches };
  const rewarded = awardRiftEnergy({ ...state, hardpoints: unlocked.hardpoints, pendingHullGunReward, riftBreaches, score: state.score + RIFT_RUN_BREACH_REWARDS.score }, RIFT_RUN_BREACH_REWARDS.energy);
  return { state: rewarded, runtime: { ...runtime, integrity: 0, reformRemainingMs: delayMs, breached: true } };
}

export function tickRiftReform(runtime: RiftBreachRuntime, elapsedMs: number, baseIntegrity: number, breachCount: number): RiftBreachRuntime {
  if (!runtime.breached) return runtime;
  const remaining = Math.max(0, runtime.reformRemainingMs - Math.max(0, elapsedMs));
  if (remaining > 0) return { ...runtime, reformRemainingMs: remaining };
  const integrity = riftIntegrityForBreach(baseIntegrity, breachCount);
  return { integrity, maximumIntegrity: integrity, reformRemainingMs: 0, breached: false };
}
