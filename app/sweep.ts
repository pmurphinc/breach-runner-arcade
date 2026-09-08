/**
 * Continuous collision for fast, small bodies.
 *
 * A projectile is tested where it *is*, once a tick. That is fine while the
 * step is short relative to the target, and wrong as soon as it is not: the
 * round is sampled on one side of a body and then the other, and the tick in
 * between — where it was actually inside — is never looked at. The shot passes
 * through and nothing registers.
 *
 * Whether that happens is decided by the closing speed against the size of the
 * hit window, and both sides matter. A cannon round leaves the muzzle at 10 a
 * tick and inherits the hull's velocity on top, so a pilot at full speed fires
 * at up to 17.6; a homing tracker closing head-on adds its own 6.8. That is
 * 24.4 a tick between them, against a tracker whose hit window is 20 across —
 * so roughly one head-on shot in five would sample straight past a target it
 * was aimed dead at. Trackers have one hit point, and shooting them head-on is
 * the whole answer to a swarm.
 *
 * The fix is to stop asking where the round ended up and start asking where it
 * went: the distance from the body to the *segment* the round travelled this
 * tick. A hit is a hit if the path passed within reach at any point along it,
 * which is what a player who aimed correctly already believes happened.
 *
 * This only ever adds hits that geometrically occurred. It cannot invent one:
 * a segment that stays outside `reach` is still a miss, and a round with no
 * velocity degrades exactly to the old point test.
 */

export type Point = { x: number; y: number };

/**
 * Shortest distance from `point` to the segment `from` → `to`.
 *
 * The usual projection onto the segment, clamped to its ends so a body behind
 * the muzzle or beyond the round's stopping place is measured from the nearer
 * end rather than from an imaginary extension of the line.
 */
export function segmentDistance(from: Point, to: Point, point: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  // A stationary round is a point, and projecting onto it would divide by zero.
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

/**
 * Did a body that moved by (vx, vy) into its current position pass within
 * `reach` of `target` on the way?
 *
 * Takes the mover's current position and the step it just took, because that
 * is the shape the game loop already has: bullets advance at the top of the
 * tick and are tested afterwards, so the previous position is the current one
 * less its velocity.
 */
export function sweptHit(
  mover: { x: number; y: number; vx: number; vy: number },
  target: Point,
  reach: number,
): boolean {
  const previous = { x: mover.x - mover.vx, y: mover.y - mover.vy };
  return segmentDistance(previous, mover, target) < reach;
}
