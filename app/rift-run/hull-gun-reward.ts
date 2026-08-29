import type { RiftRunState, RiftWeaponId } from "./types.ts";
import { mountUnlockedWeapon } from "./upgrade-apply.ts";

export function pendingHullGunReward(state: RiftRunState): boolean {
  return state.pendingHullGunReward != null;
}

export function claimHullGunWeapon(state: RiftRunState, hardpointIndex: number, weaponId: RiftWeaponId): RiftRunState {
  if (state.pendingHullGunReward?.hardpointIndex !== hardpointIndex) return state;
  const mounted = mountUnlockedWeapon(state, hardpointIndex, weaponId);
  return mounted === state ? state : { ...mounted, pendingHullGunReward: null };
}
