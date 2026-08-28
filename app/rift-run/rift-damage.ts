/** Fraction of nominal hull-weapon damage applied to Rift integrity in Rift Run. */
export const RIFT_RUN_RIFT_DAMAGE_SCALE = 0.05;
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
  if ((target.riftReformTicks ?? 0) > 0) return 0;
  const currentIntegrity = Math.max(0, target.rivalHealth);
  const scaledDamage = Math.max(0, weaponDamage) * RIFT_RUN_RIFT_DAMAGE_SCALE;
  const integrityDamage = Math.min(currentIntegrity, scaledDamage);
  target.rivalHealth = Math.max(0, currentIntegrity - integrityDamage);
  return integrityDamage;
}
