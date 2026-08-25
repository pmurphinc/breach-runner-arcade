/**
 * Shared movement intent and inertia.
 *
 * Desktop keys and the touch stick resolve to the same directional intent and
 * are then flown through the same physics, so Touch, PC and Hybrid all feel
 * identical. Every hull keeps its own acceleration and top speed on top of
 * that shared model.
 *
 * Pure and dependency-free so the whole model is testable without a canvas.
 */

/** Screen-space directions the keyboard can request. */
export type MovementKeys = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export type MovementIntent = {
  /** True when the pilot is asking to move at all. */
  active: boolean;
  /**
   * Desired heading in degrees, screen space: 0 is right, 90 is down, -90 is
   * up. Null when there is no input, or when opposing keys cancel out.
   */
  heading: number | null;
  /**
   * Always 0 or exactly 1. Diagonals are normalized to the same magnitude as
   * the cardinals, so moving up-right is not faster than moving right.
   */
  magnitude: number;
};

export const NO_INTENT: MovementIntent = { active: false, heading: null, magnitude: 0 };

/**
 * Resolves held direction keys into one intent.
 *
 * Opposing keys cancel per axis — holding W and S leaves the vertical axis at
 * zero rather than picking a winner — and holding all four produces no
 * movement at all.
 */
export function intentFromKeys(keys: MovementKeys): MovementIntent {
  // Canvas Y grows downward, so "up" is negative.
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (x === 0 && y === 0) return NO_INTENT;

  const heading = (Math.atan2(y, x) * 180) / Math.PI;
  return { active: true, heading, magnitude: 1 };
}

/** The touch stick already reports a heading; wrap it in the same shape. */
export function intentFromStick(heading: number | null): MovementIntent {
  if (heading === null) return NO_INTENT;
  return { active: true, heading, magnitude: 1 };
}

/**
 * Picks the intent the loop should act on.
 *
 * The stick wins when it is engaged: a player holding a thumbstick has made a
 * continuous analogue commitment, and a stray key should not fight it.
 */
export function resolveIntent(stick: MovementIntent, keyboard: MovementIntent) {
  return stick.active ? stick : keyboard;
}

export type Velocity = { vx: number; vy: number };

/**
 * The shared arcade inertia model.
 *
 * These numbers are the whole feel — light momentum, quick stops, sharp
 * direction changes — and they are deliberately ship-agnostic. They scrub
 * momentum the pilot is not asking for; they never touch the acceleration or
 * top speed a hull was tuned with, so the ships stay as different from one
 * another as they were.
 */
/** Fraction of the remaining drift shed each tick once the input is released. */
export const IDLE_DRAG = 0.12;
/** The same, with retro thrusters fitted: the power-up brakes twice as hard. */
export const RETRO_DRAG = 0.24;
/** Fraction of sideways momentum scrubbed each tick while thrusting. */
export const LATERAL_DRAG = 0.18;
/** Fraction shed each tick from momentum running against the requested heading. */
export const REVERSE_DRAG = 0.35;
/** A coasting ship below this speed is simply parked rather than left crawling. */
export const STOP_SPEED = 0.02;

/**
 * Applies one tick of movement intent to a velocity.
 *
 * One model serves every control mode. Returns a new velocity rather than
 * mutating, so it is trivially testable.
 */
export function applyIntent(
  velocity: Velocity,
  intent: MovementIntent,
  ship: { acceleration: number; maxSpeed: number },
  options: { retros?: boolean } = {}
): Velocity {
  if (!intent.active || intent.heading === null) {
    // Nothing held: bleed the drift off fast and park the hull once what is
    // left would only be a crawl. A couple of ship-lengths of coast remain, so
    // letting go still reads as a glide rather than hitting a wall.
    const drag = options.retros ? RETRO_DRAG : IDLE_DRAG;
    const vx = velocity.vx * (1 - drag);
    const vy = velocity.vy * (1 - drag);
    if (Math.hypot(vx, vy) < STOP_SPEED) return { vx: 0, vy: 0 };
    return { vx, vy };
  }

  const radians = (intent.heading * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);

  // Split momentum into the part already heading where the pilot is pointing
  // and the part that is not. Only the second part is scrubbed, so a straight
  // burn still ramps by the ship's own acceleration to the ship's own top
  // speed, exactly as before.
  const along = velocity.vx * ux + velocity.vy * uy;
  const lateralX = velocity.vx - along * ux;
  const lateralY = velocity.vy - along * uy;

  // Momentum pointing the wrong way is killed hardest: that is what makes a
  // right-to-left flick bite instead of skating onward through the turn.
  const carried = along < 0 ? along * (1 - REVERSE_DRAG) : along;
  const thrust = carried + ship.acceleration * intent.magnitude;

  let vx = lateralX * (1 - LATERAL_DRAG) + thrust * ux;
  let vy = lateralY * (1 - LATERAL_DRAG) + thrust * uy;
  const speed = Math.hypot(vx, vy);
  if (speed > ship.maxSpeed) {
    const scale = ship.maxSpeed / speed;
    vx *= scale;
    vy *= scale;
  }
  return { vx, vy };
}

/**
 * The heading the ship should face.
 *
 * Aim wins when the player is aiming, otherwise the hull points where it is
 * travelling. With no input at all the last meaningful heading is kept, so a
 * drifting ship does not snap back to a default angle.
 */
export function facingFor(
  intent: MovementIntent,
  aimHeading: number | null,
  lastHeading: number
) {
  if (aimHeading !== null) return aimHeading;
  if (intent.active && intent.heading !== null) return intent.heading;
  return lastHeading;
}

/** Key codes that move the ship. Both WASD and the arrow cluster. */
export const MOVEMENT_CODES = [
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
] as const;

/** Reads the held-key map the game loop maintains into a typed direction set. */
export function keysFrom(held: Record<string, boolean>): MovementKeys {
  return {
    up: Boolean(held.KeyW || held.ArrowUp),
    down: Boolean(held.KeyS || held.ArrowDown),
    left: Boolean(held.KeyA || held.ArrowLeft),
    right: Boolean(held.KeyD || held.ArrowRight),
  };
}
