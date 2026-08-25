export const RICOCHET_DURATION_SECONDS = 10;
export const RICOCHET_BOUNCES = 2;

export type RicochetState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bouncesLeft: number;
  bounced: boolean;
};

/**
 * Reflect a cannon round that has crossed an arena edge.
 *
 * A corner contact reflects both velocity axes but consumes only one bounce,
 * because it is one collision event. The position is clamped back inside the
 * arena so the normal out-of-bounds compaction cannot delete the reflected
 * shot before the next tick.
 */
export function reflectRicochet(
  x: number,
  y: number,
  vx: number,
  vy: number,
  width: number,
  height: number,
  bouncesLeft: number,
  margin = 2,
): RicochetState {
  if (bouncesLeft <= 0) return { x, y, vx, vy, bouncesLeft: 0, bounced: false };

  const hitX = x <= margin || x >= width - margin;
  const hitY = y <= margin || y >= height - margin;
  if (!hitX && !hitY) return { x, y, vx, vy, bouncesLeft, bounced: false };

  return {
    x: Math.max(margin, Math.min(width - margin, x)),
    y: Math.max(margin, Math.min(height - margin, y)),
    vx: hitX ? -vx : vx,
    vy: hitY ? -vy : vy,
    bouncesLeft: bouncesLeft - 1,
    bounced: true,
  };
}
