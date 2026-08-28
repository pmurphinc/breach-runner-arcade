export const RIFT_MODIFIER_LIMITS = {
  fireRate: { min: 1, max: 4 }, damage: { min: 1, max: 5 }, projectileCount: { min: 0, max: 3 },
  penetration: { min: 0, max: 6 }, explosionRadius: { min: 0, max: 120 }, flameRange: { min: 0, max: 260 },
  flameConeDegrees: { min: 0, max: 110 }, projectileSpeed: { min: 1, max: 2.5 }, movement: { min: 1, max: 1.7 },
  handling: { min: 1, max: 1.8 }, damageReduction: { min: 0, max: .4 },
} as const;
export const clampModifier = (value: number, bounds: { min: number; max: number }) => Math.max(bounds.min, Math.min(bounds.max, value));
