/**
 * Shared movement intent.
 *
 * Desktop keys and the touch stick both resolve to the same thing: a direction
 * the pilot wants to travel, or nothing. The game loop then applies that one
 * intent with the ship's own acceleration and top speed, so keyboard and touch
 * cannot drift apart in feel and neither one gets a handling advantage.
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
 * Applies one tick of movement intent to a velocity.
 *
 * Applies the ship's acceleration as thrust while preserving existing momentum,
 * what keeps the frames feeling different: a Squid reaches speed almost at
 * once, a Flagship takes its time, and neither is changed by this refactor.
 * Returns a new velocity rather than mutating, so it is trivially testable.
 */
export function applyIntent(
  velocity: Velocity,
  intent: MovementIntent,
  ship: { acceleration: number; maxSpeed: number },
  options: { retros?: boolean } = {}
): Velocity {
  if (!intent.active || intent.heading === null) {
    // Retro thrusters bleed off drift when nothing is held. Without them the
    // ship coasts, exactly as it did before.
    if (options.retros) return { vx: velocity.vx * 0.995, vy: velocity.vy * 0.995 };
    return { vx: velocity.vx, vy: velocity.vy };
  }

  const radians = (intent.heading * Math.PI) / 180;
  // Thrusters add force to the ship's existing momentum instead of replacing
  // its velocity with the requested keyboard direction. That makes a WASD turn
  // describe a smooth flight arc rather than a grid-like snap.
  let vx = velocity.vx + Math.cos(radians) * ship.acceleration * intent.magnitude;
  let vy = velocity.vy + Math.sin(radians) * ship.acceleration * intent.magnitude;
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
