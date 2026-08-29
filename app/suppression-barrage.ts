/** Warden's player-controlled primary-cannon overdrive. */
export const SUPPRESSION_BARRAGE_SPREAD_DEGREES = 7;
export const SUPPRESSION_BARRAGE_DAMAGE_MULTIPLIER = 0.65;

export type BarrageRound = {
  angle: number;
  damage: number;
  /** Side rounds share the trigger's live-shot budget with the center round. */
  supplemental: boolean;
};

/**
 * Resolves one primary-cannon trigger without knowing anything about targets.
 * Angles are radians so the result feeds the ordinary cannon velocity path.
 */
export function suppressionBarrageRounds(aimAngle: number, cannonDamage: number): BarrageRound[] {
  const spread = SUPPRESSION_BARRAGE_SPREAD_DEGREES * Math.PI / 180;
  const damage = cannonDamage * SUPPRESSION_BARRAGE_DAMAGE_MULTIPLIER;
  return [
    { angle: aimAngle - spread, damage, supplemental: true },
    { angle: aimAngle, damage, supplemental: false },
    { angle: aimAngle + spread, damage, supplemental: true },
  ];
}
