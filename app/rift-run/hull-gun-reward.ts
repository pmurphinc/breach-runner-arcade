import type { RiftRunState, RiftWeaponId } from "./types.ts";
import { applyUpgrade, mountUnlockedWeapon } from "./upgrade-apply.ts";
import { eligibleUpgradeChoices } from "./upgrade-pool.ts";
import type { UpgradeChoice } from "./upgrades.ts";

export function pendingHullGunReward(state: RiftRunState): boolean {
  return state.firstBreachHullGunReward === "select-weapon" || state.firstBreachHullGunReward === "upgrade-weapon";
}

export function hullGunUpgradeChoices(state: RiftRunState): UpgradeChoice[] {
  if (state.firstBreachHullGunReward !== "upgrade-weapon") return [];
  const mounted = state.hardpoints.find(point => point.status === "occupied");
  if (!mounted || mounted.status !== "occupied") return [];
  return eligibleUpgradeChoices(state)
    .filter(choice => choice.targetInstanceId === mounted.weapon.instanceId)
    .slice(0, 3);
}

export function claimHullGunWeapon(state: RiftRunState, hardpointIndex: number, weaponId: RiftWeaponId): RiftRunState {
  if (state.firstBreachHullGunReward !== "select-weapon") return state;
  const mounted = mountUnlockedWeapon(state, hardpointIndex, weaponId);
  return mounted === state ? state : { ...mounted, firstBreachHullGunReward: "claimed" };
}

export function claimHullGunUpgrade(state: RiftRunState, choice: UpgradeChoice): RiftRunState {
  if (!hullGunUpgradeChoices(state).some(eligible => eligible.key === choice.key)) return state;
  const pendingLevels = state.pendingLevels;
  const upgraded = applyUpgrade(state, choice);
  return upgraded === state ? state : { ...upgraded, pendingLevels, firstBreachHullGunReward: "claimed" };
}
