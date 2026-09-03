/**
 * Extra lives — earned, never won.
 *
 * A Rift Run that ends on one unlucky collision at depth four throws away
 * twenty minutes of build, and the four systems added alongside this one make
 * the arena considerably more capable of doing that. Extra lives are the
 * counterweight: a small, legible buffer so that pushing deeper is a decision
 * rather than a gamble.
 *
 * The single rule that shapes the whole module is that lives are
 * **milestone-sourced only**. They come from breach depth and from nothing
 * else — not from rift damage, not from a power-up, not from a loot roll, not
 * from damage output, not from luck. That is a deliberate design constraint
 * rather than an implementation detail: a life that can drop from a random
 * table turns every other danger system in the mode into a coin flip, because
 * the correct response to pressure becomes "farm until the dice fix it".
 *
 * The constraint is enforced two ways. There is no function here that awards a
 * life from anything but a depth milestone, and `EXTRA_LIFE_FORBIDDEN_SOURCES`
 * names the tables that must never contain one so a test can assert it rather
 * than trusting review.
 *
 * Pure data and pure functions; the game loop owns none of these numbers.
 */

/** Lives a run opens with, beyond the hull it is currently flying. */
export const RIFT_RUN_STARTING_LIVES = 2;

/** The most a run may ever hold at once. */
export const RIFT_RUN_MAX_LIVES = 3;

/**
 * Breach depths that pay a life.
 *
 * Ascending, and spaced so the cap is reachable but never comfortable: the
 * first is early enough to matter on a run that is still learning, and the
 * later two are deep enough that a pilot holding three lives has genuinely
 * earned the room to spend them.
 */
export const RIFT_LIFE_MILESTONE_DEPTHS: readonly number[] = [2, 5, 9];

/**
 * Sources that must never produce a life, named so a test can prove it.
 *
 * If a future loot table is added, it belongs in this list and in the test
 * that walks it. The point is that "no lives in loot" stays true by
 * construction rather than by memory.
 */
export const EXTRA_LIFE_FORBIDDEN_SOURCES: readonly string[] = [
  "rift-damage",
  "rift-power-up-budget",
  "world-pickups",
  "upgrade-cards",
  "evolution-rewards",
  "hull-gun-rewards",
  "enemy-drops",
];

/** The only source there is. */
export const EXTRA_LIFE_SOURCE = "breach-milestone" as const;

/** Ticks of invulnerability a respawn grants. Long enough to read the arena. */
export const RIFT_RESPAWN_INVULN_TICKS = 150;

/** Fraction of maximum hull a respawn restores. */
export const RIFT_RESPAWN_HULL_FRACTION = 1;

/**
 * True when reaching this depth pays a life.
 *
 * Depth, not "breaches since the last one": a milestone is a fixed point on
 * the ladder, so re-deriving lives from a saved run gives the same answer.
 */
export function isLifeMilestoneDepth(depth: number): boolean {
  const safe = Math.max(0, Math.floor(Number.isFinite(depth) ? depth : 0));
  return RIFT_LIFE_MILESTONE_DEPTHS.includes(safe);
}

/** Lives a run that has reached this depth should have been paid, in total. */
export function lifeMilestonesEarned(depth: number): number {
  const safe = Math.max(0, Math.floor(Number.isFinite(depth) ? depth : 0));
  return RIFT_LIFE_MILESTONE_DEPTHS.filter((milestone) => safe >= milestone).length;
}

export type ExtraLifeAward = {
  /** Lives held after the award. Never above the cap. */
  lives: number;
  /** True when a life was actually paid — false at the cap, or off-milestone. */
  awarded: boolean;
  /** True when the milestone landed but the cap swallowed it. */
  cappedOut: boolean;
};

/**
 * Pays the milestone for a depth, if there is one and there is room.
 *
 * A milestone hit at the cap is reported as `cappedOut` rather than silently
 * discarded, so the HUD can say "LIVES MAX" instead of paying nothing and
 * explaining nothing.
 */
export function awardLifeForDepth(lives: number, depth: number): ExtraLifeAward {
  const held = Math.max(0, Math.floor(Number.isFinite(lives) ? lives : 0));
  if (!isLifeMilestoneDepth(depth)) return { lives: held, awarded: false, cappedOut: false };
  if (held >= RIFT_RUN_MAX_LIVES) return { lives: held, awarded: false, cappedOut: true };
  return { lives: held + 1, awarded: true, cappedOut: false };
}

export type ExtraLifeSpend = {
  lives: number;
  /** True when a life covered the death and the run continues. */
  respawned: boolean;
  /** Hull the pilot comes back on. Zero when the run is over. */
  health: number;
  /** Ticks of invulnerability to grant. Zero when the run is over. */
  invuln: number;
};

/**
 * Spends a life to cover a death, or reports that the run is finished.
 *
 * The one place a life is consumed. Callers hand it the hull the frame carries
 * so respawn health stays tied to the run's own upgrades rather than to a
 * constant that would quietly nerf a heavily-built hull.
 */
export function spendExtraLife(lives: number, maxHealth: number): ExtraLifeSpend {
  const held = Math.max(0, Math.floor(Number.isFinite(lives) ? lives : 0));
  if (held <= 0) return { lives: 0, respawned: false, health: 0, invuln: 0 };
  const hull = Math.max(1, Math.round(Math.max(1, maxHealth) * RIFT_RESPAWN_HULL_FRACTION));
  return { lives: held - 1, respawned: true, health: hull, invuln: RIFT_RESPAWN_INVULN_TICKS };
}

/** The notice for a life paid out at a breach milestone. */
export function extraLifeNotice(award: ExtraLifeAward): string {
  return award.cappedOut ? "EXTRA LIFE // ALREADY AT MAXIMUM" : `EXTRA LIFE EARNED // ${award.lives} HELD`;
}

/** The notice for a life spent. */
export function respawnNotice(spend: ExtraLifeSpend): string {
  return `HULL RESTORED // ${spend.lives} ${spend.lives === 1 ? "LIFE" : "LIVES"} LEFT`;
}
