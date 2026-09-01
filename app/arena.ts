/**
 * Arena dimensions.
 *
 * The size of the world is world data, not rendering data and not a property of
 * the ruleset that picked it, so it lives in its own pure module rather than in
 * the game component. Everything in the simulation reads the running game's
 * worldWidth and worldHeight; these are only the values a mode starts one with.
 *
 * Pure and dependency-free on purpose — a square arena is the change Classic
 * Wormhole is built on, and the bands below need to be assertable without
 * standing up a canvas.
 */

export type ArenaSize = { width: number; height: number };

/**
 * The arena Breach Runner's own modes play in.
 *
 * 16:10 landscape, chosen for the letterboxed canvas the shell already lays
 * out. It is a default rather than a law.
 */
export const DEFAULT_ARENA: ArenaSize = { width: 1504, height: 940 };

/**
 * Square arenas, sized by how many opponents share them.
 *
 * The reference client scales its board with the player count rather than
 * fixing one size: more pilots need more room, and a square keeps every
 * portal's orbit equidistant from the walls in a way a 16:10 letterbox cannot.
 */
export const ARENA_SIZES = { solo: 873, duel: 1310, melee: 1572 } as const;

export function squareArena(side: number): ArenaSize {
  return { width: side, height: side };
}

/**
 * The arena for a match with this many opponents.
 *
 * Clamped at both ends: a nonsense count still yields a playable board rather
 * than an undefined band, because this is reached from lobby state that a
 * disconnect can leave mid-update.
 */
export function arenaForOpponents(opponents: number): ArenaSize {
  if (!Number.isFinite(opponents) || opponents <= 1) return squareArena(ARENA_SIZES.solo);
  if (opponents <= 3) return squareArena(ARENA_SIZES.duel);
  return squareArena(ARENA_SIZES.melee);
}

/** True when an arena is square, which several Classic-mode rules assume. */
export function isSquareArena(arena: ArenaSize): boolean {
  return arena.width === arena.height;
}
