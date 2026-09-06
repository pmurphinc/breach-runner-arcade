/**
 * The rift draws a near miss in.
 *
 * Landing a payload means putting it inside 48px of a rift that is usually
 * orbiting. A shot that arrives a hair wide is not a misread of the fight — it
 * is the rift having moved while the payload was in the air — and losing a
 * payload to that reads as the game being fiddly rather than as a mistake the
 * pilot could have avoided. Payloads are a limited, deliberately-spent resource,
 * which is exactly why a near miss stings out of proportion to the error.
 *
 * So the rift has a funnel around it. Inside it a payload is bent toward the
 * rift, hardest when it is close and already well aimed, fading to nothing at
 * the rim.
 *
 * ## What this must not become
 *
 * **It is not homing.** The Rabbit's Viper guidance is homing — it turns at
 * 0.16 rad/tick, from any range, at any angle, and it is a ship's whole
 * special. A capture funnel strong enough to rescue a bad shot would take that
 * ability and hand it to every hull for free. So this is deliberately kept to a
 * fraction of that turn rate, and it is gated twice over:
 *
 * - **by range**, so it cannot acquire a payload across the arena, and
 * - **by approach angle**, so a payload already sailing past or away is a miss.
 *   Yanking one through ninety degrees would look like the rift eating a shot
 *   the pilot never aimed at it.
 *
 * The test that matters most here is not any single number but the comparison:
 * a payload thrown wide must still miss.
 */

/** Where the funnel begins. Beyond this a payload is on its own. */
export const PAYLOAD_CAPTURE_RADIUS = 280;

/**
 * The strongest turn the funnel can apply, in radians per tick.
 *
 * Viper guidance turns at 0.16. This is under two fifths of that, and
 * only ever reached by a payload that is both close and already well aimed —
 * so the special stays a special by a wide margin at every range and angle.
 */
export const PAYLOAD_CAPTURE_MAX_TURN = 0.06;

/**
 * How far off the bearing to the rift a payload may be and still be helped.
 *
 * 60 degrees. Past this the payload is not making a near miss, it is going
 * somewhere else, and bending it in would be the rift reaching out for a shot
 * that was never aimed at it.
 */
export const PAYLOAD_CAPTURE_MAX_OFF_BEARING = (60 * Math.PI) / 180;

/** Signed angle in (-π, π]. */
export function normalizeAngle(radians: number): number {
  let value = radians;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value <= -Math.PI) value += Math.PI * 2;
  return value;
}

/**
 * The turn the funnel is willing to apply this tick, in radians.
 *
 * Zero outside the funnel, outside the approach cone, or on anything that is
 * not a real distance. Scales on both closeness and aim, so the assist is
 * largest exactly where a near miss happens — just short of the rift, just off
 * the bearing — and negligible everywhere else.
 */
export function payloadCaptureTurn(distance: number, offBearing: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(offBearing)) return 0;
  if (distance <= 0 || distance >= PAYLOAD_CAPTURE_RADIUS) return 0;

  const off = Math.abs(offBearing);
  if (off >= PAYLOAD_CAPTURE_MAX_OFF_BEARING) return 0;

  const closeness = 1 - distance / PAYLOAD_CAPTURE_RADIUS;
  const aim = 1 - off / PAYLOAD_CAPTURE_MAX_OFF_BEARING;
  return PAYLOAD_CAPTURE_MAX_TURN * closeness * aim;
}

/**
 * One tick of capture, as a new velocity.
 *
 * Speed is preserved exactly: the funnel steers, it never accelerates. A
 * payload that arrives faster than it was launched would be the rift adding
 * damage the pilot did not pay for, and it would also outrun the landing check.
 */
export function capturePayloadVelocity(
  x: number,
  y: number,
  vx: number,
  vy: number,
  riftX: number,
  riftY: number,
): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed <= 0) return { vx, vy };

  const distance = Math.hypot(riftX - x, riftY - y);
  const desired = Math.atan2(riftY - y, riftX - x);
  const current = Math.atan2(vy, vx);
  const delta = normalizeAngle(desired - current);

  const limit = payloadCaptureTurn(distance, delta);
  if (limit <= 0) return { vx, vy };

  const turn = Math.max(-limit, Math.min(limit, delta));
  const heading = current + turn;
  return { vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed };
}
