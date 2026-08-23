/**
 * Pure helpers for Release C's reworked ship specials.
 *
 * Keeping the flight and guidance math outside the render loop makes the
 * abilities testable without a browser and prevents touch/keyboard input from
 * receiving different handling.
 */

export const WING_OVERDRIVE_SECONDS = 3;
export const SQUID_PHASE_SECONDS = 2.5;
export const VIPER_GUIDANCE_SECONDS = 3;

export function overdriveHandling(
  acceleration: number,
  maxSpeed: number,
  active: boolean,
) {
  return active
    ? { acceleration: acceleration * 1.75, maxSpeed: maxSpeed * 1.65 }
    : { acceleration, maxSpeed };
}

export function hostileTrackingVector(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  phaseVeilActive: boolean,
) {
  const direction = phaseVeilActive ? -1 : 1;
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
