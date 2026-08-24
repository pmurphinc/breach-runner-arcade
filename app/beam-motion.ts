export const BEAM_ROTATION_PER_TICK = 0.006;
export const BEAM_LENGTH = 1200;
export const BEAM_HIT_WIDTH = 14;
export const BEAM_PICKUP_WIDTH = 20;

export type BeamDirection = -1 | 1;

export function randomBeamDirection(random = Math.random): BeamDirection {
  return random() < 0.5 ? -1 : 1;
}

export function advanceBeamAngle(angle: number, direction: BeamDirection) {
  return angle + BEAM_ROTATION_PER_TICK * direction;
}

/**
 * True when a point touches the finite beam ray. Unlike distance-to-line
 * maths, this cannot hit anything behind the wormhole.
 */
export function pointTouchesBeam(
  originX: number,
  originY: number,
  angle: number,
  pointX: number,
  pointY: number,
  width: number,
  length = BEAM_LENGTH,
) {
  const dx = pointX - originX;
  const dy = pointY - originY;
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  if (along < 0 || along > length) return false;
  const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  return across <= width;
}
