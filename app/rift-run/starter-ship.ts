/**
 * The one ship every Rift Run begins with.
 *
 * Rift Run used to open on a grid of the ten finished hulls, and the hull you
 * picked decided your special, your handling and how many hull-gun sockets you
 * would ever get. That made the most consequential decision of a run the one
 * taken before it started, with the least information. The mode's premise is
 * the opposite — *start weak, build your ship, survive what comes next* — so
 * every run now issues the same deliberately incomplete frame and the build
 * decisions happen during play.
 *
 * What "stripped" means, precisely:
 *
 * - one payload slot, not the five every other mode grants outright
 * - no Special ability at all until one is unlocked and chosen
 * - the basic cannon at mark zero, and basic thrusters with no reverse thrust
 * - no hull-mounted weapons, every socket locked
 * - no class, so nothing about the frame predetermines the build
 *
 * The primary cannon stays the ship's normal cannon. Hull guns are additional
 * autonomous weapons that sit on top of it and never replace it.
 *
 * Only the *statistics* are new. The silhouette, muzzle geometry and thruster
 * points come from an existing hull, because ship art is keyed by `ShipId`
 * everywhere in the renderer and inventing an eleventh id would mean inventing
 * eleventh art, an eleventh balance row and an eleventh entry in every save
 * and multiplayer payload. `SHIPS` is left completely untouched: this table is
 * Rift Run's, in the same way `CLASSIC_SHIPS` is Classic's.
 */

import { SHIPS, type ShipId, type ShipSpec } from "../game-data.ts";

/**
 * The hull the starter frame wears.
 *
 * Starling is the fleet's plain strike frame and is already the shell's
 * fallback ship, so it carries no archetype baggage. Nothing about Starling's
 * own statistics or special reaches Rift Run — only its model.
 */
export const RIFT_RUN_STARTER_HULL: ShipId = "wing";

/**
 * Deliberately unremarkable handling.
 *
 * Slower than most of the fleet, and — the part that matters — starting at
 * mark zero on both the cannon and the engines, which no shipped hull does.
 * Several frames open with an engine mark of one, two or three, so mark zero
 * plus no reverse thrust is what makes the first THRUSTERS upgrade an obvious,
 * felt improvement rather than a rounding error. Turn rate stays mid so the
 * frame is still pleasant to fly while it is weak, and hull sits between the
 * light and medium frames: a starter that dies to one mistake would spend the
 * run in the menu rather than in the arena.
 */
export const RIFT_RUN_STARTER_SHIP: ShipSpec = {
  id: RIFT_RUN_STARTER_HULL,
  name: "Rift Runner",
  role: "Standard issue",
  turn: 7,
  maxSpeed: 2.4,
  acceleration: 0.07,
  health: 180,
  // Mark zero on both tracks. `createGame` reads these straight into
  // `player.gun` and `player.thrust`, and a zero thrust mark is also what
  // leaves the frame without reverse thrust until a thruster upgrade grants
  // it.
  gun: 0,
  thrust: 0,
  special: "No special ability installed. Unlock one during the run.",
  unlock: "OPEN",
};

/**
 * The spec a Rift Run flies, resolved the way Classic resolves its own.
 *
 * Called from `createGame`, so every read site downstream simply uses
 * `game.ship` as it always has.
 */
export function riftRunStarterSpec(): ShipSpec {
  return { ...RIFT_RUN_STARTER_SHIP };
}

/** Guards the assumption that the starter's art hull is a real fleet entry. */
export function starterHullExists(): boolean {
  return SHIPS.some((ship) => ship.id === RIFT_RUN_STARTER_HULL);
}
