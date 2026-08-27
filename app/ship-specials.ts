/**
 * Pure helpers shared by the ship specials.
 *
 * Keeping the flight and guidance math outside the render loop makes the
 * abilities testable without a browser and prevents touch/keyboard input from
 * receiving different handling.
 *
 * Starling, Phantom and Talon now declare their abilities as overcharged
 * power-ups in `app/overcharge.ts`, which owns their durations and handling
 * riders. What is left here is the geometry the whole fleet shares.
 */

export const VIPER_GUIDANCE_SECONDS = 3;

/**
 * Steering vector for a hostile, reversed while it is scrambled.
 *
 * The reversal used to belong to Phantom's old Phase Veil, which flipped every
 * hostile in the arena at once. It is per-hostile state now, so whatever
 * scrambles a hostile only turns around what it actually reached.
 *
 * No shipped ability scrambles a hostile at present — Phantom's special is the
 * LANCE OVERCHARGE beam, and the pulse that used to do it went with the old
 * one. The mechanism is left intact rather than torn out: it is generic, it
 * costs nothing while nothing drives it, and `OverchargeBlast.scrambleSeconds`
 * is the single field a future special would set to use it again.
 */
export function hostileTrackingVector(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  scrambled: boolean,
) {
  const direction = scrambled ? -1 : 1;
  return {
    dx: (playerX - enemyX) * direction,
    dy: (playerY - enemyY) * direction,
  };
}

export function steerHomingVelocity(
  x: number,
  y: number,
  vx: number,
  vy: number,
  targetX: number,
  targetY: number,
  maxTurnRadians = 0.16,
) {
  const speed = Math.max(10, Math.hypot(vx, vy));
  const desired = Math.atan2(targetY - y, targetX - x);
  const current = Math.atan2(vy, vx);
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const turn = Math.max(-maxTurnRadians, Math.min(maxTurnRadians, delta));
  const heading = current + turn;
  return { vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed };
}
