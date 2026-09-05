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

/**
 * The touch stick already reports a heading; wrap it in the same shape.
 *
 * `throttle` is how hard the stick is pushed, and it is the whole of Classic's
 * deadzone: an intent that is active, carries a heading, and has a magnitude of
 * zero turns the hull without lighting the engine, because `facingFor` reads
 * the heading while acceleration scales by the magnitude. Twin-stick passes 1
 * and behaves exactly as it always has.
 */
export function intentFromStick(heading: number | null, throttle = 1): MovementIntent {
  if (heading === null) return NO_INTENT;
  return { active: true, heading, magnitude: Math.max(0, Math.min(1, throttle)) };
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
/** Fraction of sideways momentum scrubbed each tick while thrusting. */
export const LATERAL_DRAG = 0.18;
/** Fraction shed each tick from momentum running against the requested heading. */
export const REVERSE_DRAG = 0.35;
/** A coasting ship below this speed is simply parked rather than left crawling. */
export const STOP_SPEED = 0.02;

/* ------------------------------------------------------ engine upgrade -- */

/**
 * ENGINE UPGRADE — go faster, get there sooner.
 *
 * The upgrade used to be two flat bonuses: +0.25 top speed and +0.035
 * acceleration a mark, the same for every hull. On top speed that is six per
 * cent for a Phantom, which is under the threshold a player can feel; the
 * player collected a module and the ship flew the same. Worse, a flat bonus
 * *flattens*: the slowest frame in the fleet gained the most in relative terms
 * and the fleet converged on one number as the marks stacked.
 *
 * Each mark now adds a share of the frame's *own* numbers plus a small flat
 * floor. The share is what makes the upgrade proportional — a fast hull gets a
 * fast hull's worth of it — and the floor is what keeps it meaningful for the
 * two frames tuned with almost no acceleration to take a share of. Both terms
 * are linear in the mark count, so three marks is three times one mark and
 * never a compounding curve.
 */
/** Share of the frame's own top speed added per engine mark. */
export const ENGINE_SPEED_SCALE = 0.1;
/** Flat top-speed bonus per engine mark, on top of the share. */
export const ENGINE_SPEED_FLAT = 0.25;
/** Share of the frame's own acceleration added per engine mark. */
export const ENGINE_ACCEL_SCALE = 0.25;
/** Flat acceleration bonus per engine mark, on top of the share. */
export const ENGINE_ACCEL_FLAT = 0.04;
/** Marks the engine can reach. MK 3 is where the pickup stops helping. */
export const ENGINE_MAX_LEVEL = 3;

export type Handling = { acceleration: number; maxSpeed: number };

function markCount(level: number, max: number) {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(max, Math.floor(level)));
}

/**
 * A frame's handling with `level` engine marks fitted.
 *
 * Takes the base numbers rather than a ship id, so Switchback's two FORM SHIFT
 * profiles run through exactly the same maths as the eight hulls.
 */
export function engineHandling(base: Handling, level: number): Handling {
  const marks = markCount(level, ENGINE_MAX_LEVEL);
  return {
    acceleration: base.acceleration * (1 + marks * ENGINE_ACCEL_SCALE) + marks * ENGINE_ACCEL_FLAT,
    maxSpeed: base.maxSpeed * (1 + marks * ENGINE_SPEED_SCALE) + marks * ENGINE_SPEED_FLAT,
  };
}

/* ------------------------------------------------------ retro thrusters -- */

/**
 * RETRO THRUSTERS — stop, reverse, change direction.
 *
 * The old version was a boolean that doubled idle drag, and it was seeded
 * `true` for every frame that starts with an engine mark. Seven of the eight
 * hulls therefore already had it, so the pickup they flew across did nothing
 * whatsoever, and on the eighth it only affected coasting — the one situation
 * where the pilot has stopped asking for anything.
 *
 * Retros are marks now, seeded at the level the frame already flew with so no
 * hull's baseline handling moves, and each mark buys the three things braking
 * actually means:
 *
 *   - more drift shed while coasting (shorter stopping distance),
 *   - more momentum killed when it runs against the requested heading, and
 *   - more thrust available *while* fighting that momentum, which is what
 *     turns a flick reverse from a slide into a bite.
 *
 * That last term is what keeps this mechanically distinct from ENGINE
 * UPGRADE: it only applies to the part of the burn spent undoing momentum, so
 * retros never raise top speed and engines never shorten a stop.
 */
/** Extra share of drift shed per retro mark while coasting. */
export const RETRO_IDLE_DRAG_PER_LEVEL = 0.12;
/** Extra share of opposing momentum killed per retro mark. */
export const RETRO_REVERSE_DRAG_PER_LEVEL = 0.15;
/** Extra braking thrust per retro mark, applied only against momentum. */
export const RETRO_BRAKE_ASSIST_PER_LEVEL = 0.35;
/** Marks the retro package can reach. */
export const RETRO_MAX_LEVEL = 3;

/**
 * Retro marks from the loop's `retros` field.
 *
 * Accepts the boolean the field used to be so nothing that still passes one
 * silently gets zero: `true` is the single mark it always meant.
 */
export function retroLevel(retros: boolean | number | undefined): number {
  if (retros === true) return 1;
  if (!retros) return 0;
  return markCount(retros as number, RETRO_MAX_LEVEL);
}

/** Fraction of coasting drift shed per tick at `level` retro marks. */
export function retroIdleDrag(level: number) {
  return IDLE_DRAG + markCount(level, RETRO_MAX_LEVEL) * RETRO_IDLE_DRAG_PER_LEVEL;
}

/** Fraction of opposing momentum killed per tick at `level` retro marks. */
export function retroReverseDrag(level: number) {
  return Math.min(0.95, REVERSE_DRAG + markCount(level, RETRO_MAX_LEVEL) * RETRO_REVERSE_DRAG_PER_LEVEL);
}

/** Multiplier on thrust while it is being spent undoing momentum. */
export function retroBrakeAssist(level: number) {
  return 1 + markCount(level, RETRO_MAX_LEVEL) * RETRO_BRAKE_ASSIST_PER_LEVEL;
}

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
  options: { retros?: boolean | number } = {}
): Velocity {
  const retros = retroLevel(options.retros);

  if (!intent.active || intent.heading === null) {
    // Nothing held: bleed the drift off fast and park the hull once what is
    // left would only be a crawl. A couple of ship-lengths of coast remain, so
    // letting go still reads as a glide rather than hitting a wall.
    const drag = retroIdleDrag(retros);
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
  // Retros deepen exactly this term, and lend the burn extra thrust while it
  // is still undoing momentum — never once the ship is already going the way
  // it was asked to, which is what keeps them out of ENGINE UPGRADE's job.
  const reversing = along < 0;
  const carried = reversing ? along * (1 - retroReverseDrag(retros)) : along;
  const assist = reversing ? retroBrakeAssist(retros) : 1;
  const thrust = carried + ship.acceleration * intent.magnitude * assist;

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
