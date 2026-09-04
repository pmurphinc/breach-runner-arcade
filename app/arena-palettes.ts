/**
 * The colour each difficulty paints its arena in.
 *
 * Lifted out of the game loop so the menu can read it too. The difficulty cards
 * are meant to look like the arena they launch — picking HARD should show you
 * the red you are about to fly in — and the only way that stays true through
 * future balance passes is if the cards and the canvas read the same table.
 * Two copies would drift the first time one of them was tuned.
 *
 * Each entry is dark to darkest: the arena draws them as a radial gradient from
 * the middle out, and the cards as a linear one.
 */

import type { DifficultyId } from "./difficulty.ts";
import { SURVIVAL_PALETTES } from "./survival.ts";

export type ArenaPalette = readonly [string, string, string];

export const ARENA_PALETTES: Record<DifficultyId, ArenaPalette> = {
  practice: ["#102033", "#06101d", "#020409"],
  easy: ["#0b1d22", "#061016", "#020409"],
  difficult: ["#171127", "#090917", "#020409"],
  hard: ["#241014", "#0d080f", "#030305"],
  // Survival repaints itself per stage from SURVIVAL_PALETTES; this is the
  // opening one, and what the idle pre-run arena shows.
  survival: SURVIVAL_PALETTES.stable,
};

/**
 * The accent each difficulty is identified by.
 *
 * Brighter than anything in the arena palette, because a card has to be legible
 * against its own background while the arena deliberately stays dark. Derived
 * by hand from each palette's hue rather than computed: the arena colours are
 * nearly black, and a formula bright enough to be readable would throw away the
 * hue that makes them recognisable in the first place.
 */
export const DIFFICULTY_ACCENTS: Record<DifficultyId, string> = {
  practice: "#4aa3ff",
  easy: "#3fd6a8",
  difficult: "#a98cff",
  hard: "#ff5a6e",
  survival: "#ffa63f",
};

/** The CSS custom properties a difficulty card needs to paint itself. */
export function difficultyCardStyle(id: DifficultyId): Record<string, string> {
  const [near, mid, far] = ARENA_PALETTES[id];
  return {
    "--card-near": near,
    "--card-mid": mid,
    "--card-far": far,
    "--card-accent": DIFFICULTY_ACCENTS[id],
  };
}
