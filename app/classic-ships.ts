/**
 * Ship handling for Classic Wormhole.
 *
 * The reference fleet flies differently from Breach Runner's, and Classic is
 * where those numbers are reproduced exactly rather than adapted.
 *
 * The gap used to be far wider than it is. The commercial fleet has since
 * been doubled to sit in the same range, so Classic is now distinguished by
 * the *spread* of its numbers rather than by their size: turn rates from 1 to
 * 12 and top speeds from 1 to 11, against a commercial fleet deliberately
 * grouped much more tightly for balance.
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
  /** Degrees per tick, 1 to 12 across the fleet. */
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
 * Turn rate and top speed used to be taken one column to the left of where
 * they live, which is why every hull appeared to turn at an identical 3
 * degrees a tick: that column is the ship-select zoom level, not a turn rate,
 * and what was read as top speed was really the turn rate. Both are corrected
 * against the columns' own point of use — the reference assigns its rotation
 * step from one and its thrust ceiling from the next.
 *
 * The fleet is sharply differentiated as a result. Turn rates run from 1 to 12
 * degrees a tick rather than sitting flat, and that spread is most of what
 * makes one reference hull feel unlike another.
 */
export const CLASSIC_SHIP_STATS: Record<ClassicShipId, ClassicHandling> = {
  tank: { turn: 5, maxSpeed: 6, acceleration: 0.1, health: 280, gun: 2, thrust: 0 },
  wing: { turn: 7, maxSpeed: 7, acceleration: 0.25, health: 240, gun: 1, thrust: 1 },
  squid: { turn: 10, maxSpeed: 10, acceleration: 0.48, health: 200, gun: 0, thrust: 3 },
  rabbit: { turn: 12, maxSpeed: 11, acceleration: 0.35, health: 180, gun: 0, thrust: 2 },
  turtle: { turn: 4.5, maxSpeed: 5.2, acceleration: 0.15, health: 250, gun: 1, thrust: 1 },
  flash: { turn: 1, maxSpeed: 1, acceleration: 0.1, health: 190, gun: 3, thrust: 3 },
  hunter: { turn: 4.8, maxSpeed: 7, acceleration: 0.3, health: 220, gun: 0, thrust: 1 },
  flagship: { turn: 2, maxSpeed: 3.9, acceleration: 0.11, health: 300, gun: 0, thrust: 2 },
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
