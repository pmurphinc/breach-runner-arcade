/**
 * How a tracker swarm flies.
 *
 * A swarm that launches from one point, at one speed, and homes on one point
 * has only one shape available to it: the trackers behind the pilot turn hard,
 * the ones ahead barely turn, and the whole swarm folds into a V that arrives
 * as a single mass. Slowing them down does not fix that — it just makes a
 * slower V. Varying the turn rate does not fix it either, because every
 * tracker is still solving for the same destination.
 *
 * What breaks the formation is giving each tracker its own *destination*. Every
 * tracker aims at a point offset from the pilot, on its own bearing, so it
 * takes its own route across the arena. The offset shrinks as it closes, so the
 * swarm converges only at the end — the routes differ, the kill still lands.
 *
 * On top of that each tracker gets its own speed and its own turn rate, so they
 * string out in time as well as in space and arrive as a sequence of separate
 * threats rather than one wall.
 *
 * Everything here is derived deterministically from a tracker's launch angle,
 * which is fixed for its whole life. Re-rolling per tick would average back out
 * to the uniform swarm this replaces.
 */

/** Base flight speed. Was a flat 7, then a flat 5; both read as too fast. */
export const TRACKER_SPEED = 3.4;

/** Per-tracker speed spread, as a fraction of the base either way. */
export const TRACKER_SPEED_SPREAD = 0.3;

/** Ticks a tracker flies straight before it begins hunting at all. */
export const TRACKER_SCATTER_TICKS = 34;

/** Per-tracker turn rate bounds, in degrees per tick. Was a flat 16. */
export const TRACKER_TURN_MIN_DEG = 3;
export const TRACKER_TURN_MAX_DEG = 7.5;

/**
 * How wide a tracker's approach lane is, as a fraction of its range.
 *
 * A fixed offset does not work. Aiming 150 units to one side of a pilot who is
 * 1400 units away is a six-degree difference -- the trackers still converge and
 * still arrive as a V, just a marginally fatter one. The lane has to scale with
 * how far there is left to go: wide while crossing the arena, narrowing to
 * nothing at the merge. That produces genuinely separate curved routes that
 * funnel in at the end.
 */
export const TRACKER_LANE_FRACTION = 0.95;

/**
 * Range at which a tracker abandons its lane and commits to the pilot.
 *
 * The lane is at full width a commit-range beyond this and closes to nothing at
 * it, so the last stretch of every approach is a true intercept.
 */
export const TRACKER_COMMIT_DISTANCE = 190;

/** Extra launch spread for a swarm, on top of its even distribution. */
export const TRACKER_LAUNCH_JITTER = 0.42;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * A stable pseudo-random 0..1 for one tracker.
 *
 * Keyed on the launch angle so it never changes for a given tracker, and
 * salted so the speed, the turn rate and the aim bearing are independent of
 * each other rather than three views of the same number.
 */
export function trackerNoise(phase: number, salt = 0): number {
  const value = Math.sin(phase * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** This tracker's own flight speed. */
export function trackerSpeed(phase: number): number {
  const spread = trackerNoise(phase, 1) * 2 - 1;
  return TRACKER_SPEED * (1 + spread * TRACKER_SPEED_SPREAD);
}

/** This tracker's own turn rate, in radians per tick. */
export function trackerTurnRadians(phase: number): number {
  const t = trackerNoise(phase, 2);
  return (TRACKER_TURN_MIN_DEG + t * (TRACKER_TURN_MAX_DEG - TRACKER_TURN_MIN_DEG)) * DEG;
}

/**
 * Which lane this tracker takes, from -1 (hard one side) to 1 (hard the other).
 *
 * Derived mostly from the launch angle rather than from noise. A swarm launches
 * at evenly spaced angles, so mapping that angle onto the lane range guarantees
 * the swarm actually *spans* the range: twelve random lanes cluster, leave gaps,
 * and can put most of the swarm on one side, which is a V again. A fifth of the
 * lane is still noise so the fan is not mechanically even.
 */
export function trackerLane(phase: number): number {
  const TAU_LOCAL = Math.PI * 2;
  const wrapped = ((phase % TAU_LOCAL) + TAU_LOCAL) % TAU_LOCAL;
  const even = (wrapped / TAU_LOCAL) * 2 - 1;
  const jitter = trackerNoise(phase, 3) * 2 - 1;
  return Math.max(-1, Math.min(1, even * 0.8 + jitter * 0.2));
}

/**
 * Where this tracker is actually flying, which is not where the pilot is.
 *
 * Each tracker holds its own lane: a waypoint offset *sideways* from the line
 * between it and the pilot, by a share of the distance still to cover. Sideways
 * rather than in a ring around the pilot, because a lateral offset is what
 * bends the route -- a ring offset of any sane size is only a few degrees at
 * arena range and the swarm converges anyway.
 *
 * The lane closes as the tracker arrives, so the routes differ all the way in
 * and the intercept still lands.
 */
export function trackerAimPoint(
  phase: number,
  x: number,
  y: number,
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) return { x: targetX, y: targetY };
  // 0 at the commit range, 1 once a full commit range beyond it.
  const falloff = Math.min(1, Math.max(0, (distance - TRACKER_COMMIT_DISTANCE) / TRACKER_COMMIT_DISTANCE));
  if (falloff <= 0) return { x: targetX, y: targetY };
  const lane = trackerLane(phase);
  const lateral = lane * distance * TRACKER_LANE_FRACTION * falloff;
  // Perpendicular to the approach, so the offset bends the route rather than
  // just moving the finish line.
  const perpendicular = Math.atan2(dy, dx) + Math.PI / 2;
  return {
    x: targetX + Math.cos(perpendicular) * lateral,
    y: targetY + Math.sin(perpendicular) * lateral,
  };
}

/**
 * Steer one tracker for a tick, returning its new velocity.
 *
 * Pure: the caller owns the tracker and writes the result back. Kept whole
 * rather than split so the scatter window, the aim offset and the per-tracker
 * turn rate cannot drift apart at different call sites.
 */
export function steerTracker(
  tracker: { x: number; y: number; vx: number; vy: number; phase: number; age: number },
  targetX: number,
  targetY: number,
): { vx: number; vy: number } {
  const speed = trackerSpeed(tracker.phase);
  const current = Math.atan2(tracker.vy, tracker.vx);

  // Straight first, so the swarm fans across an arc before any of it turns.
  if (tracker.age < TRACKER_SCATTER_TICKS) {
    return { vx: Math.cos(current) * speed, vy: Math.sin(current) * speed };
  }

  const aim = trackerAimPoint(tracker.phase, tracker.x, tracker.y, targetX, targetY);
  const desired = Math.atan2(aim.y - tracker.y, aim.x - tracker.x);
  let delta = desired - current;
  while (delta > Math.PI) delta -= TAU;
  while (delta < -Math.PI) delta += TAU;
  const turn = trackerTurnRadians(tracker.phase);
  const angle = current + Math.max(-turn, Math.min(turn, delta));
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}
