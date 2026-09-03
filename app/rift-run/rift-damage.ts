/** Fraction of nominal hull-weapon damage applied to Rift integrity in Rift Run. */
export const RIFT_RUN_RIFT_DAMAGE_SCALE = 0.05;

/**
 * Fraction of nominal cannon damage applied to Rift integrity in Rift Run.
 *
 * The cannon used to charge the per-hit power-up meter in every mode, but the
 * Rift Run rift moved to a bounded budget paid at integrity thresholds and the
 * cannon fell out of that path entirely. That worked in the middle of a
 * band -- there was still a payload to fire -- and broke at the edges: a pilot
 * out of PUPs and without a hull weapon had no way to advance the fight.
 *
 * Small enough that cannon fire alone is a slow grind, roughly a third as
 * efficient per point as a hull weapon; enough that a run is never fully
 * stalled. Wants a playtest for feel; the number is a first pass.
 */
export const RIFT_RUN_CANNON_RIFT_DAMAGE_SCALE = 0.015;
export const RIFT_RUN_BASE_INTEGRITY = 200;
export const RIFT_RUN_REFORM_DELAY_MS = 1500;
export const RIFT_RUN_BREACH_REWARDS = { energy: 20, score: 500 } as const;
export const RIFT_RUN_BREACH_INTEGRITY_GROWTH = 0.5;

export function riftIntegrityForBreach(baseIntegrity: number, breachCount: number): number {
  return baseIntegrity * (1 + RIFT_RUN_BREACH_INTEGRITY_GROWTH * Math.max(0, breachCount));
}

export type RiftRunIntegrityTarget = { rivalHealth: number; riftReformTicks?: number };

/**
 * Applies a Rift Run hull-weapon hit and returns the integrity actually removed.
 * Portal charge is deliberately not handled here: it tracks nominal weapon
 * damage independently of integrity and continues to drive temporary PUP drops.
 */
export function applyRiftRunHullWeaponDamage(
  target: RiftRunIntegrityTarget,
  weaponDamage: number,
): number {
  return applyRiftRunRiftDamage(target, weaponDamage, RIFT_RUN_RIFT_DAMAGE_SCALE);
}

/**
 * Applies a Rift Run cannon hit to rift integrity, at the cannon's smaller
 * scale. Returns the integrity actually removed, so a caller that pays the
 * pilot for damage cannot overpay when integrity is already exhausted.
 */
export function applyRiftRunCannonDamage(
  target: RiftRunIntegrityTarget,
  cannonDamage: number,
): number {
  return applyRiftRunRiftDamage(target, cannonDamage, RIFT_RUN_CANNON_RIFT_DAMAGE_SCALE);
}

function applyRiftRunRiftDamage(
  target: RiftRunIntegrityTarget,
  nominalDamage: number,
  scale: number,
): number {
  if ((target.riftReformTicks ?? 0) > 0) return 0;
  const currentIntegrity = Math.max(0, target.rivalHealth);
  const scaledDamage = Math.max(0, nominalDamage) * scale;
  const integrityDamage = Math.min(currentIntegrity, scaledDamage);
  target.rivalHealth = Math.max(0, currentIntegrity - integrityDamage);
  return integrityDamage;
}
