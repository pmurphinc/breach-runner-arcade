/**
 * Loose power-ups in the arena — their size, and how they move.
 *
 * A PUP used to be three unrelated numbers scattered across the game loop: a
 * hexagon drawn at radius 19, a glyph drawn at 11, and a pickup test at 25.
 * Nothing tied them together, so making a PUP bigger meant finding all three
 * and hoping. They are one table here, and the pickup radius is *derived* from
 * the body radius rather than written down beside it, so the thing the player
 * flies at can never be a different size from the thing they see.
 *
 * The motion half exists for the same reason: a PUP had no relationship with
 * the arena walls at all. It drifted from wherever it was shed, and a shallow
 * outward velocity carried it off the playfield to expire somewhere the player
 * could never reach. `advancePup` gives it the arcade answer — it bounces, and
 * it bounces off its hull rather than its centre point, so a big PUP does not
 * bury half of itself in the wall first.
 *
 * Pure and dependency-free, so the whole thing is testable without a canvas.
 */

/**
 * Radius of the PUP body — the class-shaped cradle the player actually sees.
 *
 * Was 19. Arena PUPs were easy to lose against a busy Rift Collapse
 * background and fiddly to line up with on a phone, so the body is a little
 * over a third larger. Kept well under a Raider Drone's 25-unit hull plus its
 * glow so a loose power-up still reads as smaller than the things trying to
 * kill you, and so four of them cannot wall off a corner of the arena.
 */
export const PUP_RADIUS = 26;

/**
 * Radius of the icon inside the cradle.
 *
 * Proportional to the body rather than an independent number, so the glyph
 * keeps the same share of the hexagon at any size.
 */
export const PUP_GLYPH_RADIUS = Math.round(PUP_RADIUS * 0.58);

/**
 * Extra reach the pickup test gets beyond the two bodies touching.
 *
 * The old test was a flat 25 against a 19-unit body: six units of grace. That
 * grace is preserved here rather than re-derived, so collecting a PUP feels
 * exactly as forgiving as it did — the radius grew, the slop did not.
 */
export const PUP_PICKUP_GRACE = 6;

/**
 * Distance from PUP centre to ship centre that counts as collected.
 *
 * Derived, so enlarging `PUP_RADIUS` enlarges the pickup radius by exactly as
 * much and the two can never drift apart.
 */
export const PUP_PICKUP_RADIUS = PUP_RADIUS + PUP_PICKUP_GRACE;

/** Fraction of the incoming speed a PUP keeps after hitting a wall. */
export const PUP_WALL_BOUNCE = 0.82;

/** Per-tick drift decay. Unchanged: the float is the PUP's whole character. */
export const PUP_DRIFT_DECAY = 0.995;

/** Radians per tick the badge rotates. Unchanged. */
export const PUP_SPIN = 0.08;

export type PupFrameShape = "triangle" | "octagon" | "circle" | "diamond";

/** The single class-to-silhouette vocabulary for loose arena PUPs. */
export const PUP_FRAME_SHAPES = Object.freeze({
  payload: "triangle",
  upgrade: "octagon",
  recovery: "circle",
  rare: "diamond",
} as const satisfies Record<import("./game-data").PupClass, PupFrameShape>);

/** Resolve frame art from canonical gameplay classification, never a PUP ID. */
export function pupFrameShape(pupClass: import("./game-data").PupClass): PupFrameShape {
  return PUP_FRAME_SHAPES[pupClass];
}

/**
 * Trace the rotating outer body for a loose arena PUP.
 *
 * Rotation is applied to the geometry rather than the canvas, leaving the
 * existing centre glyph upright and unchanged. All vertices sit on `radius`,
 * so every silhouette remains inside the established circular world body.
 */
export function drawPupFrame(
  ctx: Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "arc" | "closePath">,
  pupClass: import("./game-data").PupClass,
  radius: number,
  rotation: number,
) {
  const shape = pupFrameShape(pupClass);
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(0, 0, radius, rotation, rotation + Math.PI * 2);
    ctx.closePath();
    return;
  }

  const sides = shape === "triangle" ? 3 : shape === "octagon" ? 8 : 4;
  // Point triangle/diamond upward at rest; the old frame's phase still spins it.
  const start = rotation - Math.PI / 2;
  for (let i = 0; i < sides; i += 1) {
    const angle = start + (i / sides) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Speed below which a wall bounce parks the axis instead of nudging it.
 *
 * Without this a PUP resting against a wall alternates between a hair of
 * inward velocity and a hair of outward velocity forever, which reads as
 * jitter. Below the threshold the axis is simply zeroed and the PUP sits.
 */
export const PUP_BOUNCE_STOP_SPEED = 0.04;

export type PupBody = { x: number; y: number; vx: number; vy: number };

export type PupArena = { width: number; height: number };

/**
 * Reflects one axis off a pair of walls, in place.
 *
 * Returned as a value rather than mutating so the corner case is the same code
 * twice rather than a special case: a PUP that crosses both a vertical and a
 * horizontal wall on the same tick gets both reflections, in either order,
 * with the same result.
 */
function bounceAxis(position: number, velocity: number, low: number, high: number) {
  if (position < low) {
    // Reflect the overshoot back inside rather than clamping to the wall. A
    // clamp leaves the PUP touching the wall for as long as it is pushed,
    // which is what produces repeated re-entry and jitter.
    const bounced = low + (low - position);
    const speed = -velocity * PUP_WALL_BOUNCE;
    return {
      position: Math.min(bounced, high),
      velocity: Math.abs(speed) < PUP_BOUNCE_STOP_SPEED ? 0 : speed,
      hit: true,
    };
  }
  if (position > high) {
    const bounced = high - (position - high);
    const speed = -velocity * PUP_WALL_BOUNCE;
    return {
      position: Math.max(bounced, low),
      velocity: Math.abs(speed) < PUP_BOUNCE_STOP_SPEED ? 0 : speed,
      hit: true,
    };
  }
  return { position, velocity, hit: false };
}

/**
 * Advances a loose PUP one tick and keeps it inside the arena.
 *
 * Motion first, then containment, so a PUP is never reported at a position it
 * was not actually allowed to occupy. The bounds are inset by the PUP's own
 * radius, so it is the visible hexagon that touches the wall rather than the
 * point at its middle.
 *
 * Returns true when a wall was struck this tick, which the caller can spend on
 * a sound or a spark without having to re-derive the collision.
 */
export function advancePup(pup: PupBody, arena: PupArena, radius = PUP_RADIUS) {
  pup.x += pup.vx;
  pup.y += pup.vy;
  pup.vx *= PUP_DRIFT_DECAY;
  pup.vy *= PUP_DRIFT_DECAY;

  // A radius wider than the arena has no inside to bounce within; park the
  // PUP at the centre of the axis instead of producing NaN bounds.
  const low = radius;
  const highX = Math.max(low, arena.width - radius);
  const highY = Math.max(low, arena.height - radius);

  const horizontal = bounceAxis(pup.x, pup.vx, low, highX);
  pup.x = horizontal.position;
  pup.vx = horizontal.velocity;

  const vertical = bounceAxis(pup.y, pup.vy, low, highY);
  pup.y = vertical.position;
  pup.vy = vertical.velocity;

  return horizontal.hit || vertical.hit;
}

/** True when the ship centre is close enough to collect this PUP. */
export function pupCollected(
  pup: { x: number; y: number },
  ship: { x: number; y: number },
  reach = PUP_PICKUP_RADIUS,
) {
  return Math.hypot(pup.x - ship.x, pup.y - ship.y) < reach;
}
