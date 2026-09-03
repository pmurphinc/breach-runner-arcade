import { RIFT_RUN_MAX_SOCKETS, createStarterLoadout } from "./loadout.ts";
import type { RiftHardpoint, RiftRunState } from "./types.ts";

export function createStartingHardpoints(maximum: number): RiftHardpoint[] {
  return Array.from({ length: maximum }, (_, index) => ({ index, status: "locked" as const }));
}

/**
 * A fresh run, on the standard starter frame.
 *
 * Takes no ship, because there is no ship to take. Every Rift Run opens on the
 * same stripped loadout — one payload slot, no Special, cannon and thrusters
 * at tier one, every hull-gun socket locked — and the run's identity is
 * created by the upgrades taken during play rather than by a menu choice made
 * before it.
 */
export function createRiftRun(seed: string): RiftRunState {
  return {
    loadout: createStarterLoadout(),
    maximumHardpoints: RIFT_RUN_MAX_SOCKETS,
    hardpoints: createStartingHardpoints(RIFT_RUN_MAX_SOCKETS),
    pendingSpecialChoice: false,
    sector: 1,
    wave: 1,
    riftEnergy: 0,
    level: 1,
    pendingLevels: 0,
    rollIndex: 0,
    riftBreaches: 0,
    pendingHullGunReward: null,
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

/** Sockets the run has opened, whether or not a gun is bolted into one yet. */
export function unlockedHardpointCount(state: RiftRunState): number {
  return state.hardpoints.filter(({ status }) => status !== "locked").length;
}

/** The next socket a socket-unlock upgrade would open, or null when maxed. */
export function nextLockedHardpointIndex(state: RiftRunState): number | null {
  const socket = state.hardpoints.find(({ status }) => status === "locked");
  return socket ? socket.index : null;
}

/** Sockets opened but still empty — the ones a gun can be installed into. */
export function availableHardpointIndexes(state: RiftRunState): number[] {
  return state.hardpoints.flatMap((socket) => (socket.status === "available" || socket.status === "empty" ? [socket.index] : []));
}
