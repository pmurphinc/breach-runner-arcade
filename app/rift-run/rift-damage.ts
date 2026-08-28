/** Fraction of nominal hull-weapon damage applied to Rift integrity in Rift Run. */
export const RIFT_RUN_RIFT_DAMAGE_SCALE = 0.10;

export type RiftRunIntegrityTarget = { rivalHealth: number };

/**
 * Applies a Rift Run hull-weapon hit and returns the integrity actually removed.
 * Portal charge is deliberately not handled here: it tracks nominal weapon
 * damage independently of integrity and continues to drive temporary PUP drops.
 */
export function applyRiftRunHullWeaponDamage(
  target: RiftRunIntegrityTarget,
  weaponDamage: number,
): number {
  const currentIntegrity = Math.max(0, target.rivalHealth);
  const scaledDamage = Math.max(0, weaponDamage) * RIFT_RUN_RIFT_DAMAGE_SCALE;
  const integrityDamage = Math.min(currentIntegrity, scaledDamage);
  target.rivalHealth = Math.max(0, currentIntegrity - integrityDamage);
  return integrityDamage;
}
