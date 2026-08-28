import type { ShipId } from "../game-data";

export type RiftShipClass = "light" | "medium" | "heavy";
export type RiftRunStatus = "setup" | "active" | "completed" | "abandoned";
export type RiftWeaponId = "standard-cannon";

export type RiftHardpoint =
  | { index: number; status: "locked" }
  | { index: number; status: "available" }
  | { index: number; status: "empty" }
  | { index: number; status: "occupied"; weaponId: RiftWeaponId };

export type RiftRunState = {
  selectedShip: ShipId;
  shipClass: RiftShipClass;
  maximumHardpoints: number;
  hardpoints: RiftHardpoint[];
  mountedStartingWeapon: RiftWeaponId;
  sector: number;
  wave: number;
  riftEnergy: number;
  score: number;
  status: RiftRunStatus;
  seed: string;
};
