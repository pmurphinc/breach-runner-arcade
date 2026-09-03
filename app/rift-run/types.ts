import type { RiftLoadout } from "./loadout.ts";

/**
 * Ship classes are no longer part of a Rift Run.
 *
 * Every run flies the same classless starter frame, so nothing about the ship
 * pre-decides how many hull guns it can carry or what it is good at. The type
 * survives because `RIFT_SHIP_CLASSES` still describes the finished fleet as
 * build archetypes to aim at — it just no longer constrains a run.
 */
export type RiftShipClass = "light" | "medium" | "heavy";
export type RiftRunStatus = "setup" | "active" | "completed" | "abandoned";
export type PendingHullGunReward = { hardpointIndex: number; breach: number };
export type RiftWeaponId = "pulse-cannon" | "minigun" | "railgun" | "missile-pod" | "flamethrower";
export type RiftEvolutionId = "nova-cannon" | "hellstorm" | "seismic-rail" | "mirv-battery" | "inferno-projector";

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
  /**
   * What the run has earned across the five ship systems.
   *
   * Replaces the old `selectedShip`/`shipClass` pair: there is no ship choice
   * to record, and no class to gate anything on.
   */
  loadout: RiftLoadout;
  maximumHardpoints: number;
  hardpoints: RiftHardpoint[];
  /** Set when an upgrade unlocked a Special and the pilot must now pick one. */
  pendingSpecialChoice: boolean;
  sector: number;
  wave: number;
  riftEnergy: number;
  level: number;
  pendingLevels: number;
  rollIndex: number;
  riftBreaches: number;
  pendingHullGunReward: PendingHullGunReward | null;
  evolutionHistory: RiftEvolutionHistory[];
  upgradeHistory: RiftUpgradeHistory[];
  shipModifiers: { hull: number; shield: number; movement: number; damageReduction: number; handling: number; cannonDamage: number; cannonFireRate: number };
  score: number;
  status: RiftRunStatus;
  seed: string;
};

export type RiftUpgradeHistory = { upgradeId: string; targetInstanceId?: string; hardpointIndex?: number; stack: number; level: number };
export type { RiftLoadout } from "./loadout.ts";
export type RiftEvolutionHistory = { evolutionId: RiftEvolutionId; weaponInstanceId: string; hardpoint: number; level: number };
