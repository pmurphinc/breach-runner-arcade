import type { ShipId } from "../game-data";
import { STARTING_WEAPON } from "./data";
import { riftRunShip } from "./ships";
import type { RiftHardpoint, RiftRunState } from "./types";

export function createStartingHardpoints(maximum: number): RiftHardpoint[] {
  return Array.from({ length: maximum }, (_, index) => index === 0
    ? { index, status: "occupied" as const, weaponId: STARTING_WEAPON }
    : { index, status: "locked" as const });
}

export function createRiftRun(shipId: ShipId, seed: string): RiftRunState {
  const ship = riftRunShip(shipId);
  if (!ship) throw new Error(`${shipId} is not selectable in Rift Run`);
  return {
    selectedShip: ship.id,
    shipClass: ship.shipClass,
    maximumHardpoints: ship.maximumHardpoints,
    hardpoints: createStartingHardpoints(ship.maximumHardpoints),
    mountedStartingWeapon: STARTING_WEAPON,
    sector: 1,
    wave: 1,
    riftEnergy: 0,
    score: 0,
    status: "setup",
    seed,
  };
}

export function activateRiftRun(state: RiftRunState): RiftRunState {
  return { ...state, status: "active" };
}

export function activeHardpointCount(state: RiftRunState): number {
  return state.hardpoints.filter(({ status }) => status === "occupied").length;
}
