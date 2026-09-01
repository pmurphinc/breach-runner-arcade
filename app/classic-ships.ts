/**
 * Ship handling for Classic Wormhole.
 *
 * The reference fleet flies very differently from Breach Runner's: its hulls
 * accelerate harder and top out two to four times faster relative to the same
 * 10-units-per-tick bullet, which is most of why the original reads as twitchy
 * and this game reads as weighty. Reproducing that is the point of Classic, so
 * these are its numbers, applied only in that mode.
 *
 * `SHIPS` is deliberately untouched. COMMERCIALIZATION.md commits to an
 * independent balance pass on the commercial fleet, and retuning it toward the
 * reference would be working against that — the two goals genuinely conflict, so
 * they get two tables.
 *
 * Only the statistics are borrowed. Names, roles and ability copy come straight
 * from `SHIPS`, so Classic ships as *Breach Runner's* classic mode rather than a
 * reproduction of another product's fleet.
 */

import { SHIPS, type ShipId, type ShipSpec } from "./game-data.ts";

/**
 * The eight hulls Classic flies.
 *
 * Kestrel and Warden are this project's own and have no counterpart in the
 * reference, so there is no authentic handling to give them. They stay out of
 * Classic rather than being invented for it; every other mode keeps them.
 */
export const CLASSIC_SHIP_IDS = [
  "tank",
  "wing",
  "squid",
  "rabbit",
  "turtle",
  "flash",
  "hunter",
  "flagship",
] as const satisfies readonly ShipId[];

export type ClassicShipId = (typeof CLASSIC_SHIP_IDS)[number];

type ClassicHandling = {
  /** Degrees per tick. Every hull but the flagship turns at the same rate. */
  turn: number;
  /** Thrust ceiling, in world units per tick. */
  maxSpeed: number;
  acceleration: number;
  health: number;
  /** Shot level the hull starts at, 0 to 3. */
  gun: number;
  /** Thrust upgrades the hull starts with. */
  thrust: number;
};

/**
 * Observed handling, hull by hull.
 *
 * The uniform 3 degrees per tick is not an approximation — every hull except
 * the flagship really does turn at the same rate, and the fleet is
 * differentiated by thrust, acceleration and hull instead. The flagship turns at
 * half that, which is the cost of its 300 hull and twin turrets.
 */
export const CLASSIC_SHIP_STATS: Record<ClassicShipId, ClassicHandling> = {
  tank: { turn: 3, maxSpeed: 5.0, acceleration: 0.1, health: 280, gun: 2, thrust: 0 },
  wing: { turn: 3, maxSpeed: 7.0, acceleration: 0.25, health: 240, gun: 1, thrust: 1 },
  squid: { turn: 3, maxSpeed: 10.0, acceleration: 0.48, health: 200, gun: 0, thrust: 3 },
  rabbit: { turn: 3, maxSpeed: 12.0, acceleration: 0.35, health: 180, gun: 0, thrust: 2 },
  turtle: { turn: 3, maxSpeed: 4.5, acceleration: 0.15, health: 250, gun: 1, thrust: 1 },
  flash: { turn: 3, maxSpeed: 1.0, acceleration: 0.1, health: 190, gun: 3, thrust: 3 },
  hunter: { turn: 3, maxSpeed: 4.8, acceleration: 0.3, health: 220, gun: 0, thrust: 1 },
  flagship: { turn: 1.5, maxSpeed: 2.0, acceleration: 0.11, health: 300, gun: 0, thrust: 2 },
};

export function isClassicShip(id: ShipId): id is ClassicShipId {
  return (CLASSIC_SHIP_IDS as readonly string[]).includes(id);
}

/**
 * Classic's fleet: this project's identity, the reference's handling.
 *
 * Built from SHIPS rather than declared standalone, so a rename or a reworded
 * ability in the commercial fleet flows through automatically and Classic can
 * never end up displaying a stale name.
 */
export const CLASSIC_SHIPS: ShipSpec[] = SHIPS.filter((ship) => isClassicShip(ship.id)).map((ship) => ({
  ...ship,
  ...CLASSIC_SHIP_STATS[ship.id as ClassicShipId],
}));

/**
 * The spec a run should fly, for the mode it is in.
 *
 * A pilot who picked Kestrel or Warden and then chose Classic falls back to the
 * nearest available hull rather than being refused a launch: the mode is the
 * deliberate choice, the ship is a preference.
 */
export function shipForMode(spec: ShipSpec, mode: string): ShipSpec {
  if (mode !== "classic") return spec;
  return CLASSIC_SHIPS.find((ship) => ship.id === spec.id) ?? CLASSIC_SHIPS[1];
}
