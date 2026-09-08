/**
 * CORE BOMB — the armoured warhead, and the one hostile you are meant to move.
 *
 * It used to be nailed to the spot it spawned on. That made it the only threat
 * in the game a pilot could answer by simply flying away and waiting nine
 * seconds, and it wasted the interesting half of the idea: the reference client
 * lets a bomb *drift*, lets your cannon **push** it, and lets a bomb you have
 * pushed go off on a rift it touches. Shooting the thing is not how you destroy
 * it — shooting it is how you aim it.
 *
 * Three rules, and they only mean anything together:
 *
 *   1. It drifts, slowly. A bomb that cannot move cannot be aimed.
 *   2. A round that hits it gives it a quarter of that round's velocity. Your
 *      shots still damage it, so there is a real choice between breaking it and
 *      steering it — hit it too hard and you lose the delivery.
 *   3. Once it has been hit at all, touching a rift sets it off there.
 *
 * Rule 3 is deliberately gated on having been hit. A bomb nobody has touched
 * drifts past a rift harmlessly, so the arena cannot hand a pilot a free hit
 * that they did not aim — the payoff belongs to whoever did the pushing.
 *
 * Pure and dependency-free so the geometry is testable without a canvas; the
 * loop owns the consequences (damage, scoring, the blast itself).
 *
 * Provenance: mechanics and constants only, observed and reimplemented here.
 */

/** Fraction of a round's velocity a hit transfers into the bomb. */
export const CORE_BOMB_SHOVE = 0.25;

/**
 * How close a shoved bomb must come to a rift to go off on it.
 *
 * Comfortably wider than the bomb's own 20-unit body, because this is a
 * delivery the pilot aimed from across the arena and it should not be lost to
 * a near miss of a few units.
 */
export const CORE_BOMB_RIFT_REACH = 60;

/** Drift a bomb is created with. Slow: it is heavy, and it is meant to be aimed. */
export const CORE_BOMB_DRIFT_MIN = 0.5;
export const CORE_BOMB_DRIFT_MAX = 1.2;

/**
 * Ceiling on how fast a bomb can be driven.
 *
 * Without one, a sustained stream of rounds accelerates it without limit and a
 * bomb crossing the arena in three ticks would step clean over the rift it was
 * aimed at. This keeps it inside the reach above at any tick rate.
 */
export const CORE_BOMB_MAX_SPEED = 6;

export type Bomb = { x: number; y: number; vx: number; vy: number };
export type Round = { vx: number; vy: number };
export type Rift = { x: number; y: number };

/**
 * The velocity a bomb carries away from being hit.
 *
 * Clamped as a speed rather than per axis, so a diagonal push is not quietly
 * allowed to be half again as fast as a straight one.
 */
export function shoveCoreBomb(bomb: Bomb, round: Round): { vx: number; vy: number } {
  let vx = bomb.vx + round.vx * CORE_BOMB_SHOVE;
  let vy = bomb.vy + round.vy * CORE_BOMB_SHOVE;
  const speed = Math.hypot(vx, vy);
  if (speed > CORE_BOMB_MAX_SPEED) {
    vx = (vx / speed) * CORE_BOMB_MAX_SPEED;
    vy = (vy / speed) * CORE_BOMB_MAX_SPEED;
  }
  return { vx, vy };
}

/**
 * The rift this bomb has arrived at, if any.
 *
 * Takes the whole list rather than one rift so that an arena which ever holds
 * more than one needs no change here. Today exactly one rift exists per arena,
 * which `tests/portals.test.mjs` pins.
 */
export function coreBombRift<T extends Rift>(bomb: Bomb, rifts: readonly T[]): T | null {
  for (const rift of rifts) {
    if (Math.hypot(bomb.x - rift.x, bomb.y - rift.y) <= CORE_BOMB_RIFT_REACH) return rift;
  }
  return null;
}
