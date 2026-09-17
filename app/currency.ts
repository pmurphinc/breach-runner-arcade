/**
 * Money.
 *
 * A run pays for itself. Every action a pilot takes that the game already
 * notices — damaging the rift, destroying a hostile, collecting a PUP,
 * breaching, surviving another second — pays a few dollars, and the total is
 * banked into the signed-in pilot's account when the run ends. That balance is
 * what the Armory spends: unlocking a payload permanently, and buying loaded
 * copies of it into the inventory before a round starts.
 *
 * Deliberately separate from score. Score ranks a run against other runs and
 * is settled with a time penalty; money is a currency that persists across
 * runs and is spent. Tying the two together would mean either a leaderboard
 * that rewards farming or a shop that a good run cannot stock, so they are
 * paid out side by side from the same events and never derived from each
 * other.
 *
 * Pure arithmetic, no storage and no React: the whole payout table can be
 * checked in milliseconds, which is the only way a balance change stays
 * honest.
 */

import type { PowerId } from "./game-data.ts";

/**
 * The payout table, in dollars.
 *
 * Tuned so an ordinary Survival run funds roughly one mid-tier unlock. The
 * rift is the largest single line because sending payloads back through it is
 * the loop the whole game is built on — a pilot who plays the mode rather than
 * farming hostiles should earn faster.
 */
export const CREDIT_AWARDS = {
  /**
   * Per point of nominal cannon damage put into the rift.
   *
   * The smallest line on the table on purpose. Shooting the rift is what
   * charges it, so it has to pay something or the loop's first step pays
   * nothing — but it is also the one action a pilot can perform indefinitely
   * against a target that cannot die, so it pays a fraction of a dollar a hit
   * rather than a wage.
   */
  riftCharge: 0.2,
  /** Per point of rival-rift integrity actually removed. */
  riftDamage: 1.5,
  /** Collecting any loose PUP, whatever it turns out to be. */
  pupCollected: 12,
  /** Collapsing the rift outright. */
  breach: 350,
  /** Ending a run with the objective destroyed. */
  victory: 600,
} as const;

/**
 * Money for charging the rift.
 *
 * Nominal damage, not integrity: charging is what the cannon does to a rift
 * that is not losing integrity at all, and it is the step the whole loop
 * starts from.
 */
export function creditsForRiftCharge(nominalDamage: number): number {
  if (!Number.isFinite(nominalDamage) || nominalDamage <= 0) return 0;
  return nominalDamage * CREDIT_AWARDS.riftCharge;
}

/**
 * What a hostile is worth.
 *
 * Mirrors the score table's shape — the heavy hostiles that are worth 600 and
 * 300 points are the ones worth the most money — so a pilot never has to hold
 * two different ideas of which target matters.
 */
export const ENEMY_BOUNTY: Record<PowerId, number> = {
  heatseeker: 4,
  turret: 14,
  mines: 6,
  ufo: 22,
  inflator: 12,
  minelayer: 18,
  gunship: 30,
  scarab: 14,
  nuke: 60,
  wallcrawler: 22,
  beam: 18,
  emp: 12,
  ghost: 26,
  artillery: 30,
};

export function enemyBounty(kind: PowerId): number {
  return ENEMY_BOUNTY[kind] ?? 8;
}

/**
 * Money for rift damage.
 *
 * Takes the integrity actually removed, never the nominal damage, so a hit an
 * enrage shield swallowed pays nothing and a hit on a rift already at zero
 * pays nothing. That is the same rule the Survival score uses, for the same
 * reason: otherwise the shield becomes a money printer.
 */
export function creditsForRiftDamage(integrityRemoved: number): number {
  if (!Number.isFinite(integrityRemoved) || integrityRemoved <= 0) return 0;
  return integrityRemoved * CREDIT_AWARDS.riftDamage;
}

/** Fractional cents accumulate during a run; the wallet only ever sees whole dollars. */
export function settleRunCredits(earned: number): number {
  if (!Number.isFinite(earned) || earned <= 0) return 0;
  return Math.floor(earned);
}

/**
 * `$1,250`.
 *
 * One formatter, so a balance never reads one way in the Armory and another on
 * the result card. Negative input is clamped rather than rendered: a wallet
 * cannot go under, and a minus sign on a price would be a bug being displayed.
 */
export function formatCredits(amount: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  return `$${whole.toLocaleString("en-US")}`;
}

/** Compact form for the live HUD, where six digits of score are already competing for room. */
export function formatCreditsCompact(amount: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  if (whole < 10_000) return `$${whole.toLocaleString("en-US")}`;
  return `$${(whole / 1000).toFixed(whole < 100_000 ? 1 : 0)}k`;
}
