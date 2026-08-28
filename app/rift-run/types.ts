import type { ShipId } from "../game-data";

export type RiftShipClass = "light" | "medium" | "heavy";
export type RiftRunStatus = "setup" | "active" | "completed" | "abandoned";
export type RiftWeaponId = "pulse-cannon" | "minigun" | "railgun" | "missile-pod" | "flamethrower";

export type RiftWeaponModifiers = {
  fireRate: number;
  damage: number;
  projectileCount: number;
  penetration: number;
  explosionRadius: number;
  projectileSpeed: number;
  range: number;
  coneWidth: number;
};

/** Serializable, independently evolvable equipment. Combat timers do not belong here. */
export type RiftWeaponInstance = {
  instanceId: string;
  weaponId: RiftWeaponId;
  level: number;
  modifiers: RiftWeaponModifiers;
  evolution: Record<string, number | string | boolean>;
};

export type RiftHardpoint =
  | { index: number; status: "locked" }
  | { index: number; status: "available" }
  | { index: number; status: "empty" }
  | { index: number; status: "occupied"; weapon: RiftWeaponInstance };

export type RiftRunState = {
  selectedShip: ShipId;
  shipClass: RiftShipClass;
  maximumHardpoints: number;
  hardpoints: RiftHardpoint[];
  mountedStartingWeapon: RiftWeaponId;
  sector: number;
  wave: number;
  riftEnergy: number;
  level: number;
  pendingLevels: number;
  rollIndex: number;
  upgradeHistory: RiftUpgradeHistory[];
  shipModifiers: { hull: number; shield: number; movement: number };
  score: number;
  status: RiftRunStatus;
  seed: string;
};

export type RiftUpgradeHistory = { upgradeId: string; targetInstanceId?: string; hardpointIndex?: number; stack: number; level: number };
