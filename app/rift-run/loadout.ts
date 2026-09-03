/**
 * The five ship systems a Rift Run upgrade choice competes across.
 *
 * The mode's whole decision loop is one question asked over and over: *what
 * part of my ship do I want to improve right now?* That only works if the
 * things being improved are genuinely different from each other, so the pool
 * is organised by system rather than by a flat list of perks, and a single
 * upgrade screen never offers two cards from the same system.
 *
 *   PAYLOAD CAPACITY · MAIN CANNON · THRUSTERS · SPECIAL ABILITY · HULL
 *
 * Where the defensive upgrades went: REINFORCED HULL, SHIELD CAPACITOR and
 * IMPACT PLATING are hull upgrades, so they sit in the hull system beside the
 * sockets and the guns bolted to it. They compete with a new socket the same
 * way a cannon perk competes with a cannon mark, which is the behaviour the
 * design asks for — five systems that compete, not five systems plus a sixth
 * that quietly never does.
 *
 * Pure data and pure functions. Nothing here knows about React, the canvas or
 * the game loop, which is what lets the pool's validity rules be tested
 * directly instead of through a browser.
 */

import { PUP_INVENTORY_CAPACITY } from "../pup-inventory.js";
import type { ShipId } from "../game-data.ts";

export type RiftSystemId = "payload" | "cannon" | "thrusters" | "special" | "hull";

export const RIFT_SYSTEMS: readonly RiftSystemId[] = ["payload", "cannon", "thrusters", "special", "hull"];

export const RIFT_SYSTEM_LABELS: Record<RiftSystemId, string> = {
  payload: "PAYLOAD",
  cannon: "MAIN CANNON",
  thrusters: "THRUSTERS",
  special: "SPECIAL",
  hull: "HULL",
};

/**
 * Payload capacity is the one track Rift Run *earns* rather than being given.
 *
 * Every other mode starts at the shared ceiling. Starting at one and climbing
 * to the same five gives capacity four upgrade steps to compete against the
 * other systems, so "do I finally stop leaving payloads on the floor?" stays a
 * live question deep into a run. The ceiling is imported rather than restated:
 * Rift Run must land exactly where every other mode already sits.
 */
export const RIFT_RUN_STARTING_PAYLOAD_SLOTS = 1;
export const RIFT_RUN_MAX_PAYLOAD_SLOTS = PUP_INVENTORY_CAPACITY;

/** Cannon I through Cannon V: the starting tier plus four upgrade steps. */
export const RIFT_RUN_MAX_CANNON_TIER = 5;
/** Thrusters I through Thrusters V, on the same shape as the cannon. */
export const RIFT_RUN_MAX_THRUSTER_TIER = 5;
/** Special I through III, reachable only after one has been unlocked. */
export const RIFT_RUN_MAX_SPECIAL_TIER = 3;

/**
 * Hull-gun sockets available to a run.
 *
 * Three was the heaviest class's allowance when sockets were handed out by
 * ship class. With classes gone the number stops being a property of the hull
 * you picked and becomes the ceiling on a track anyone can climb — but the
 * ceiling itself is unchanged, so a maxed-out Rift Run fields exactly as many
 * hull guns as a Heavy did before.
 */
export const RIFT_RUN_MAX_SOCKETS = 3;

/**
 * Ceilings on the two marks `createGame` writes into the player.
 *
 * `player.gun` indexes SHOT_LEVELS and `player.thrust` indexes the engine
 * curve; both top out at 3 for every mode. The tier tracks run one step longer
 * than the marks do, so the last step pays out purely as a modifier rather
 * than silently doing nothing.
 */
export const RIFT_RUN_MAX_CANNON_MARK = 3;
export const RIFT_RUN_MAX_THRUSTER_MARK = 3;

/** Per-step stat payouts, applied on top of the mark increase. */
export const RIFT_RUN_TIER_GAINS = {
  cannonDamage: 0.12,
  cannonFireRate: 0.1,
  movement: 0.08,
  handling: 0.06,
} as const;

/**
 * How much a Special tier takes off its own cooldown.
 *
 * Cooldown is the one lever every shipped special shares, so tiering it needs
 * no per-ability branching and is immediately legible in play: the ability the
 * run is built around comes back sooner. Tier I is the ability as the fleet
 * flies it.
 */
export const RIFT_RUN_SPECIAL_COOLDOWN_SCALE: readonly number[] = [1, 1, 0.8, 0.65];

export type RiftSpecialLoadout = { shipId: ShipId; tier: number };

export type RiftLoadout = {
  /** Total payload slots, loaded plus stored. Starts at one. */
  payloadSlots: number;
  cannonTier: number;
  thrusterTier: number;
  /** Null until the run unlocks a Special and picks which one. */
  special: RiftSpecialLoadout | null;
};

export function createStarterLoadout(): RiftLoadout {
  return {
    payloadSlots: RIFT_RUN_STARTING_PAYLOAD_SLOTS,
    cannonTier: 1,
    thrusterTier: 1,
    special: null,
  };
}

/** The cannon mark a tier flies. Tier I is the basic cannon, mark zero. */
export function cannonMarkForTier(tier: number): number {
  return Math.max(0, Math.min(RIFT_RUN_MAX_CANNON_MARK, Math.floor(tier) - 1));
}

/**
 * The engine mark a tier flies.
 *
 * Tier I is mark zero, which is also what leaves the starter without reverse
 * thrust — `createGame` grants retros only to a frame whose thrust mark is
 * above zero, so the first thruster upgrade hands the pilot braking as well as
 * speed. That is deliberate: the step has to be felt.
 */
export function thrusterMarkForTier(tier: number): number {
  return Math.max(0, Math.min(RIFT_RUN_MAX_THRUSTER_MARK, Math.floor(tier) - 1));
}

/** Reverse thrust arrives with the first thruster upgrade, not before. */
export function retrosForTier(tier: number): number {
  return thrusterMarkForTier(tier) > 0 ? 1 : 0;
}

export const ROMAN = ["", "I", "II", "III", "IV", "V"] as const;

/** Tier numbering the upgrade cards show: CANNON II, THRUSTERS IV, SLOT V. */
export function tierNumeral(tier: number): string {
  return ROMAN[Math.max(0, Math.min(ROMAN.length - 1, Math.floor(tier)))] ?? String(tier);
}
