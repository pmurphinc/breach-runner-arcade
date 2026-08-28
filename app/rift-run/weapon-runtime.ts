import type { RiftRunState } from "./types";

export type HardpointRuntime = { cooldown: number; triggerTicks: number; shotsFired: number };
export type WeaponRuntime = Record<string, HardpointRuntime>;

export function createWeaponRuntime(state: RiftRunState): WeaponRuntime {
  return Object.fromEntries(state.hardpoints.flatMap((point) => point.status === "occupied"
    ? [[point.weapon.instanceId, { cooldown: 0, triggerTicks: 0, shotsFired: 0 }]] : []));
}

export function tickWeaponRuntime(runtime: WeaponRuntime): void {
  for (const state of Object.values(runtime)) state.cooldown = Math.max(0, state.cooldown - 1);
}
