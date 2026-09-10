/**
 * Seeing your teammate shoot.
 *
 * A shared arena already showed the other pilot's ship, their hull and the
 * power-ups they took, but not the one thing they spend most of a fight doing.
 * Two pilots flew past each other in silence.
 *
 * ## Why these are not bullets
 *
 * `app/shared-arena.js` anticipated this with an `ally` flag on a round and a
 * rule that an ally round can never damage a pilot. That rule is necessary and
 * not sufficient: a round in `game.bullets` with `enemy: false` is a *player*
 * round everywhere else in the loop, so it would also charge the rift, destroy
 * loose power-ups and damage hostiles. In a host-authoritative arena the host
 * already simulates all of that, so every teammate round rendered locally
 * would be a second, phantom hit on a world that has already resolved it.
 *
 * So these live in their own list and are touched by nothing but the renderer.
 * They are paint. The `ally` flag stays where it is as the guard for anything
 * that ever does put a teammate's round in the real array.
 *
 * ## Why the angles travel rather than the rounds
 *
 * A round is fully determined by where it started and which way it was
 * pointed, so sending a position and a list of angles is enough for the other
 * client to draw the same tracers without a stream of per-bullet updates. The
 * position channel is already symmetric — every pilot's `position` fans out to
 * their teammates — so this costs one small field on a message that is
 * already in flight, and no new round trip.
 *
 * Pure: no canvas, no network, no game state.
 */

/** Muzzle speed, matching the cannon's own so the tracers read as the same weapon. */
export const ALLY_SHOT_SPEED = 10;

/**
 * How long a tracer lives, in ticks.
 *
 * Shorter than a real round's 110. These are drawn from a position sample that
 * is up to a frame stale and carry no collision, so a long-lived tracer would
 * visibly outlive the thing it is depicting — sailing through a hostile the
 * host already destroyed. Long enough to read as fire, short enough never to
 * be caught lying.
 */
export const ALLY_SHOT_LIFE_TICKS = 42;

/**
 * Most shots carried on one position frame.
 *
 * Position goes out every 33ms and the fastest cannon fires every 6 ticks
 * (90ms), so two is already generous and four is unreachable in normal play.
 * The cap is here because this arrives over a network: it bounds the message
 * whatever a client claims to have done.
 */
export const MAX_ALLY_SHOTS_PER_FRAME = 4;

export type AllyShot = { x: number; y: number; vx: number; vy: number; life: number };

const DEG = Math.PI / 180;

/**
 * Tracers for one frame's worth of a teammate's fire.
 *
 * Angles are degrees, as they travel on the wire. Anything beyond the cap is
 * dropped rather than trusted.
 */
export function spawnAllyShots(origin: { x: number; y: number }, angles: readonly number[]): AllyShot[] {
  return angles.slice(0, MAX_ALLY_SHOTS_PER_FRAME).map((degrees) => {
    const radians = degrees * DEG;
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(radians) * ALLY_SHOT_SPEED,
      vy: Math.sin(radians) * ALLY_SHOT_SPEED,
      life: ALLY_SHOT_LIFE_TICKS,
    };
  });
}

/**
 * Move every tracer one tick and drop the spent ones.
 *
 * Returns a new array rather than mutating, so the caller can assign it in one
 * place and there is no half-advanced list for a renderer to catch.
 */
export function advanceAllyShots(shots: readonly AllyShot[]): AllyShot[] {
  const next: AllyShot[] = [];
  for (const shot of shots) {
    const life = shot.life - 1;
    if (life <= 0) continue;
    next.push({ x: shot.x + shot.vx, y: shot.y + shot.vy, vx: shot.vx, vy: shot.vy, life });
  }
  return next;
}

/**
 * Sanitise a list of angles arriving from another client.
 *
 * Normalised the way the server normalises a heading, and filtered rather than
 * rejected: one bad entry in a frame should cost that entry, not the frame.
 */
export function readAllyShotAngles(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((angle): angle is number => typeof angle === "number" && Number.isFinite(angle))
    .slice(0, MAX_ALLY_SHOTS_PER_FRAME)
    .map((angle) => ((angle % 360) + 360) % 360);
}
