/**
 * Where a sound is coming from.
 *
 * Every effect in the arena played at exactly the same volume no matter where
 * it happened. A hostile dying in the far corner of a 1504×940 arena was as
 * loud as one dying against the hull, and with a dozen bodies on screen the
 * mix was a flat wall with no information in it — the pilot could hear that
 * *something* had happened but never where, or whether it mattered to them.
 *
 * Two rules, and between them they turn the mix back into information.
 *
 * **Near is loud, far is quiet.** A sound at the pilot's own position is at
 * full volume; one across the arena is inaudible. What survives in between is
 * roughly what is on screen, which is also roughly what the pilot can do
 * anything about.
 *
 * **Left is left.** A cue with a known position is panned by how far off-centre
 * it is, so a hostile dying on the pilot's right is heard on the right. This
 * only applies to the procedural cues, which are built on Web Audio and can be
 * routed through a panner; the sampled effects are HTML audio elements and get
 * the volume half only.
 *
 * ## The floor, and why some sounds ignore all of this
 *
 * A few sounds are announcements rather than events — the rift enraging is the
 * clearest one. It happens at the rift, which may be the far side of the
 * arena, but the pilot has to hear it wherever they are. Those pass a floor,
 * so distance still shapes them without ever silencing them.
 *
 * Damage to the pilot is not spatial at all and is deliberately left alone:
 * it happens at the listener, so it is already at distance zero.
 *
 * Pure: no audio context, no game state. Just numbers.
 */

export type Point = { x: number; y: number };

/**
 * Inside this, a sound is at full volume.
 *
 * About a fifth of the arena's width — the space the pilot is actually flying
 * in and reacting to, rather than watching.
 */
export const AUDIO_NEAR_RADIUS = 320;

/**
 * Beyond this, a sound is not heard at all.
 *
 * Two thirds of the arena's diagonal. Far enough that everything on screen
 * still registers, close enough that the opposite corner does not.
 */
export const AUDIO_FAR_RADIUS = 1180;

/**
 * Offset at which a cue is panned fully to one side.
 *
 * Deliberately wider than half the visible width: panning hard at the edge of
 * the screen makes the arena feel like it ends there. This keeps the extremes
 * for things genuinely off to one side.
 */
export const AUDIO_PAN_WIDTH = 620;

/** Distance between two points. */
export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * How much of a sound survives a given distance, 1 down to 0.
 *
 * Smoothstepped rather than linear across the falloff band. A straight ramp
 * is audible *as a ramp* — a body crossing the threshold sounds like it is
 * being faded by a hand on a dial. The curve leaves and arrives flat, so the
 * only thing the ear notices is that far things are quieter.
 */
export function spatialGain(distance: number): number {
  if (!Number.isFinite(distance) || distance <= AUDIO_NEAR_RADIUS) return 1;
  if (distance >= AUDIO_FAR_RADIUS) return 0;
  const travelled = (distance - AUDIO_NEAR_RADIUS) / (AUDIO_FAR_RADIUS - AUDIO_NEAR_RADIUS);
  // smoothstep, inverted: 1 at the near edge, 0 at the far one.
  return 1 - travelled * travelled * (3 - 2 * travelled);
}

/**
 * A base volume, scaled for where the sound happened.
 *
 * `floor` is the share of the volume that distance may never take away, for
 * the handful of sounds that are announcements rather than events.
 */
export function spatialVolume(base: number, listener: Point, source: Point, floor = 0): number {
  const gain = spatialGain(distanceBetween(listener, source));
  return base * (floor + (1 - floor) * gain);
}

/**
 * Where a sound sits between the ears, -1 (left) to 1 (right).
 *
 * Horizontal offset only. The arena is drawn flat and a vertical component
 * would have nowhere to go in a stereo field, so it would only smear the one
 * axis that does carry meaning.
 */
export function spatialPan(listener: Point, source: Point): number {
  const offset = (source.x - listener.x) / AUDIO_PAN_WIDTH;
  return Math.max(-1, Math.min(1, offset));
}
