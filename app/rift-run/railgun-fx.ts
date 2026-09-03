/**
 * The railgun's own identity — how it looks and how it sounds.
 *
 * Before this module the railgun was drawn as a slightly longer white rectangle
 * and played the same `fire.wav` as the pulse cannon at 0.6× rate. Two of the
 * five Rift Run weapons therefore read as the same gun, which is the opposite
 * of what a 55-tick, 42-damage, 3-penetration precision weapon should feel like.
 *
 * A railgun is not a pulse. It is a hypervelocity slug on a rail: a needle of
 * incandescent metal, an ionised channel left hanging in the air behind it, and
 * a hard electromagnetic crack rather than a soft plasma cough. Everything in
 * this file exists to say that in a single frame and a single sample.
 *
 * Pure and canvas-free on purpose: the geometry and the tracer maths are the
 * parts worth asserting, and `game.tsx` is left holding only `ctx` calls.
 */

/**
 * A procedural Web Audio signature.
 *
 * Structurally compatible with the power-up pickup profiles the cue player
 * already accepts, plus `sweep`: the ratio each note's pitch bends down to over
 * its own length. A flat two-note beep is a pickup; a note that falls off a
 * cliff is a discharge.
 */
export type ProceduralCue = {
  id: string;
  frequencies: readonly number[];
  duration: number;
  gap: number;
  type: OscillatorType;
  volume: number;
  /** Target pitch as a fraction of the starting pitch. 0 disables the bend. */
  sweep?: number;
};

/**
 * The shot.
 *
 * Sawtooth, not the cannon's sample: three overlapping voices an octave apart
 * that each collapse to a quarter of their pitch inside a quarter-second. The
 * overlap (gap is shorter than a note) is what fuses them into one crack
 * instead of three beeps.
 */
export const RAILGUN_FIRE_CUE: ProceduralCue = {
  id: "railgun-fire",
  frequencies: [1680, 900, 320],
  duration: 0.27,
  gap: 0.022,
  type: "sawtooth",
  volume: 0.15,
  sweep: 0.26,
};

/**
 * The strike.
 *
 * Very short, very high, square: the metallic tick of something arriving faster
 * than the thing it hit could react to. Deliberately distinct from `cannon-hit`,
 * which is low and dull.
 */
export const RAILGUN_IMPACT_CUE: ProceduralCue = {
  id: "railgun-impact",
  frequencies: [2350, 620],
  duration: 0.11,
  gap: 0.014,
  type: "square",
  volume: 0.11,
  sweep: 0.3,
};

/**
 * The railgun's colours.
 *
 * A white-hot core inside a violet-white sheath. The violet is the important
 * part: every other projectile in the game is cyan, amber or orange, so the
 * railgun owns the one hue nothing else uses and is identifiable at a glance in
 * a crowded arena.
 */
export const RAILGUN_PALETTE = {
  core: "#ffffff",
  plasma: "#dcc4ff",
  edge: "#9a6bff",
  glow: "#c8b0ff",
  /** Impact sparks. Reads hot rather than tinted at the moment of contact. */
  spark: "#e6dcff",
} as const;

export type RailgunSlug = {
  /** How far the point extends ahead of the projectile's own position. */
  noseLength: number;
  /** How far the solid body extends behind it. */
  bodyLength: number;
  /** How far the fading motion streak extends behind the body. */
  tailLength: number;
  halfWidth: number;
  coreHalfWidth: number;
};

/**
 * The slug's silhouette for a given projectile radius.
 *
 * Long and thin is the whole brief — roughly twenty times longer than it is
 * wide, against the pulse cannon's near-square 12×6 block. Scaling on radius
 * rather than on a constant means the Seismic Rail evolution (which multiplies
 * projectile scale by 1.7) grows into a visibly heavier slug for free.
 */
export function railgunSlugGeometry(radius: number): RailgunSlug {
  const size = Math.max(0.5, Number.isFinite(radius) ? radius : 1.5);
  return {
    noseLength: 8 + size * 2.4,
    bodyLength: 26 + size * 6,
    tailLength: 52 + size * 12,
    halfWidth: Math.max(1.1, size * 0.82),
    coreHalfWidth: Math.max(0.45, size * 0.34),
  };
}

/** Ticks the ionised channel keeps growing behind the slug before it stops. */
export const RAIL_TRACE_TICKS = 18;
/** Ticks after firing by which the channel has faded to nothing. */
export const RAIL_TRACE_FADE_TICKS = 42;
/** Peak opacity of the channel. Low: it is a ghost, not a wall. */
export const RAIL_TRACE_ALPHA = 0.5;

export type RailTrace = { fromX: number; fromY: number; alpha: number };

/**
 * The ionised channel hanging behind a rail round.
 *
 * Reconstructed rather than recorded. A rail round flies dead straight at
 * constant velocity, so where it was `n` ticks ago is exactly its position
 * minus `n` times its velocity — which means the signature railgun tracer costs
 * no per-projectile history, no allocation and no new simulation state.
 *
 * Returns null on the frame it was fired (nothing to trace yet) and once the
 * channel has faded out.
 */
export function railTrace(
  x: number, y: number, vx: number, vy: number,
  remainingLifetime: number, lifetimeTicks: number,
): RailTrace | null {
  const age = lifetimeTicks - remainingLifetime;
  if (!Number.isFinite(age) || age <= 0) return null;
  const fade = 1 - Math.min(1, age / RAIL_TRACE_FADE_TICKS);
  if (fade <= 0) return null;
  const span = Math.min(age, RAIL_TRACE_TICKS);
  return { fromX: x - vx * span, fromY: y - vy * span, alpha: RAIL_TRACE_ALPHA * fade };
}

/** Particles thrown at the muzzle when a rail round leaves the barrel. */
export const RAILGUN_MUZZLE_PARTICLES = 9;
/** Particles thrown at the point of impact. Heavier than a pulse-cannon graze. */
export const RAILGUN_IMPACT_PARTICLES = 13;
