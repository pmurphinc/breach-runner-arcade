import type { RiftRunState } from "./types.ts";

export const RIFT_ENERGY_REWARDS = { normalKill: 8, toughKill: 15, majorKill: 28, riftDamageRatio: 0.12 } as const;

export function riftEnergyRequiredForLevel(level: number): number {
  return Math.round(24 + Math.max(0, level - 1) * 14 + Math.max(0, level - 3) ** 2 * 2);
}

export type RiftEnergyProgress = { current: number; required: number; fraction: number; ready: boolean };

/** The current level's normalized Rift Energy readout, shared by HUD tests and canvas rendering. */
export function riftEnergyProgress(state: RiftRunState): RiftEnergyProgress {
  const required = riftEnergyRequiredForLevel(state.level);
  const current = Math.max(0, Math.min(required, Number.isFinite(state.riftEnergy) ? state.riftEnergy : 0));
  const ready = state.pendingLevels > 0;
  return { current, required, fraction: ready ? 1 : current / required, ready };
}

export function enemyKillEnergy(kind: string): number {
  if (kind === "nuke" || kind === "gunship") return RIFT_ENERGY_REWARDS.majorKill;
  if (kind === "turret" || kind === "inflator" || kind === "wallcrawler") return RIFT_ENERGY_REWARDS.toughKill;
  return RIFT_ENERGY_REWARDS.normalKill;
}

/** Applies banked energy and queues every crossed level; choices are consumed sequentially. */
export function awardRiftEnergy(state: RiftRunState, amount: number): RiftRunState {
  let energy = state.riftEnergy + Math.max(0, amount), level = state.level, gained = 0;
  while (energy >= riftEnergyRequiredForLevel(level)) {
    energy -= riftEnergyRequiredForLevel(level++); gained++;
  }
  return { ...state, riftEnergy: energy, level, pendingLevels: state.pendingLevels + gained };
}

export function riftDamaged(state: RiftRunState, amount: number, _weaponInstanceId: string): RiftRunState {
  return awardRiftEnergy(state, amount * RIFT_ENERGY_REWARDS.riftDamageRatio);
}
