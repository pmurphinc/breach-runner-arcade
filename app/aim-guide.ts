import type { AimGuide } from "./view-settings";

/** World-space tuning for the local player's visual-only aiming reference. */
export const AIM_GUIDE_START = 18;
export const AIM_GUIDE_LENGTHS: Readonly<Record<Exclude<AimGuide, "off">, number>> = {
  short: 180,
  long: 420,
};

export type AimGuideSegment = { startX: number; startY: number; endX: number; endY: number };

/**
 * Builds presentation geometry from the cannon's authoritative heading.
 * It neither reads nor mutates simulation entities, projectiles, or collisions.
 */
export function aimGuideSegment(
  guide: AimGuide,
  x: number,
  y: number,
  cannonAngleRadians: number,
): AimGuideSegment | null {
  if (guide === "off") return null;
  const dx = Math.cos(cannonAngleRadians);
  const dy = Math.sin(cannonAngleRadians);
  const length = AIM_GUIDE_LENGTHS[guide];
  return {
    startX: x + dx * AIM_GUIDE_START,
    startY: y + dy * AIM_GUIDE_START,
    endX: x + dx * (AIM_GUIDE_START + length),
    endY: y + dy * (AIM_GUIDE_START + length),
  };
}
