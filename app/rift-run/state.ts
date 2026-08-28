import type { ShipId } from "../game-data";
import { riftRunShip } from "./ships";
import type { RiftHardpoint, RiftRunState } from "./types";

export function createStartingHardpoints(maximum: number): RiftHardpoint[] {
  return Array.from({ length: maximum }, (_, index) => ({ index, status: "locked" as const }));
}

export function createRiftRun(shipId: ShipId, seed: string): RiftRunState {
  const ship = riftRunShip(shipId);
  if (!ship) throw new Error(`${shipId} is not selectable in Rift Run`);
  return {
    selectedShip: ship.id,
    shipClass: ship.shipClass,
    maximumHardpoints: ship.maximumHardpoints,
    hardpoints: createStartingHardpoints(ship.maximumHardpoints),
    sector: 1,
    wave: 1,
    riftEnergy: 0,
    level: 1,
    pendingLevels: 0,
    rollIndex: 0,
    riftBreaches: 0,
    evolutionHistory: [],
    upgradeHistory: [],
    shipModifiers: { hull: 0, shield: 0, movement: 1, damageReduction: 0, handling: 1, cannonDamage: 1, cannonFireRate: 1 },
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
