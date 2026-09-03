/**
 * The deep-space backdrop.
 *
 * The arena used to be a 30px graph-paper grid over a radial gradient, with a
 * single flat sheet of 85 stars pinned to the viewport. It read as a drafting
 * table, not as space, and because the stars never moved relative to the camera
 * there was no sense of flying anywhere.
 *
 * This module owns the *data* for the replacement: three parallax star layers,
 * a baked nebula field, and a sparse drift of dust motes. It is deliberately
 * pure and canvas-free so the layout, the budgets and the parallax wrapping can
 * be asserted without standing up a rendering context — `game.tsx` keeps only
 * the `ctx` calls that consume these.
 *
 * Two rules shape everything here:
 *
 * 1. **Legibility beats prettiness.** Every alpha in this file is capped low
 *    enough that a bullet, a power-up or the rift still wins the pixel. The
 *    backdrop is allowed to be beautiful only in the gaps.
 * 2. **Nothing is unbounded.** Counts come from `starfieldBudget`, which is fed
 *    the same `profile.detail` scalar and particle ceiling the rest of the
 *    renderer already respects, and drops to a static, motionless field under
 *    `prefers-reduced-motion`.
 */

export type BackdropLayerId = "far" | "mid" | "near";

/** A single star. `phase` seeds its twinkle so the layer never pulses in unison. */
export type BackdropStar = {
  x: number;
  y: number;
  size: number;
  /** Index into {@link STAR_TINTS}. */
  tint: number;
  phase: number;
  /** Base opacity before any twinkle is applied. */
  alpha: number;
};

/** One soft blob of a nebula. Several of these overlap into a wispy cloud. */
export type NebulaLobe = { dx: number; dy: number; radius: number; alpha: number };

export type BackdropNebula = {
  x: number;
  y: number;
  radius: number;
  /** 0 = the stage's primary cloud colour, 1 = its secondary. */
  tint: 0 | 1;
  lobes: readonly NebulaLobe[];
};

/** A near-field dust speck. Slow, dim, and the first thing cut on low detail. */
export type BackdropMote = {
  x: number;
  y: number;
  radius: number;
  angle: number;
  speed: number;
  alpha: number;
};

export type StarfieldBudget = {
  far: number;
  mid: number;
  near: number;
  /** Stars clustered along the galactic band. Baked, so effectively free. */
  band: number;
  nebulae: number;
  motes: number;
  /** False under reduced motion: stars hold a constant alpha. */
  twinkle: boolean;
  /** False under reduced motion: motes hold position. */
  drift: boolean;
};

/**
 * Hard ceilings. `starfieldBudget` never exceeds these however generous the
 * quality scalar gets, so a future detail level cannot quietly uncap the field.
 */
export const STARFIELD_MAX = { far: 170, mid: 110, near: 58, nebulae: 7, motes: 34, band: 150 } as const;

/**
 * How fast each layer slides against the camera.
 *
 * Small numbers on purpose. The point is depth, not motion sickness: at 0.3 the
 * nearest layer moves less than a third as far as the world does, which reads
 * as distance without competing with anything the player is aiming at.
 */
export const PARALLAX_DEPTH: Record<BackdropLayerId, number> = { far: 0.05, mid: 0.15, near: 0.32 };

/**
 * Star colours. Mostly white and pale blue with a handful of warm and violet
 * outliers, which is what stops a starfield reading as grey noise.
 */
export const STAR_TINTS: readonly string[] = [
  "255,255,255",
  "255,255,255",
  "198,232,255",
  "150,214,255",
  "255,224,186",
  "214,178,255",
];

/**
 * Cloud colours keyed by the same id the arena palette already uses — the
 * difficulty id for a normal run, the escalation stage id for Survival and Rift
 * Run. The backdrop therefore reddens as a run collapses without anything at
 * the call site knowing which of the two keys it holds.
 */
export const NEBULA_TINTS: Record<string, readonly [string, string]> = {
  practice: ["#1c4f8f", "#123a72"],
  easy: ["#12666e", "#0d3f66"],
  difficult: ["#472a93", "#221a6e"],
  hard: ["#8a2038", "#3c1152"],
  survival: ["#12666e", "#0d3f66"],
  stable: ["#12666e", "#0d3f66"],
  unstable: ["#293f92", "#151b6e"],
  critical: ["#572a92", "#2a1064"],
  enraged: ["#8a2442", "#3c1048"],
  collapse: ["#9e1822", "#420a2e"],
};

/** The cloud colours for an arena key, falling back to the calm blue-green. */
export function nebulaTints(key: string): readonly [string, string] {
  return NEBULA_TINTS[key] ?? NEBULA_TINTS.stable;
}

/**
 * Peak opacity of the nebula field.
 *
 * This is the single most dangerous number in the file: clouds are large, and
 * large translucent shapes are exactly what swallows a bullet. Kept under a
 * fifth so the field is felt more than seen.
 */
export const NEBULA_ALPHA = 0.2;

/**
 * The screen-edge darkening drawn over the backdrop.
 *
 * Combat sits in the middle of the viewport; pushing the corners down buys back
 * the contrast the clouds spend, and keeps offscreen-indicator chevrons legible
 * against a bright patch of nebula.
 */
export const VIGNETTE = { innerRatio: 0.42, outerRatio: 0.78, alpha: 0.55 } as const;

/**
 * `#rrggbb` (or `#rgb`) plus an alpha, as a canvas colour string.
 *
 * The nebula tints are authored as hex because that is how every other palette
 * in the project is written, but they are painted as gradient stops that need a
 * separate opacity per stop.
 */
export function rgba(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? digits.split("").map((digit) => digit + digit).join("") : digits;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || !Number.isFinite(value)) return `rgba(255,255,255,${clamped})`;
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${clamped})`;
}

/** Deterministic value noise. Same seed, same sky, every session and every test. */
function noise(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Per-layer look. Far stars are dim specks; near stars are brighter, larger and
 * allowed to twinkle hardest, which is what sells one layer as being in front
 * of another even before the parallax is noticed.
 */
const LAYER_STYLE: Record<BackdropLayerId, { minSize: number; maxSize: number; minAlpha: number; maxAlpha: number }> = {
  far: { minSize: 1, maxSize: 1, minAlpha: 0.16, maxAlpha: 0.34 },
  mid: { minSize: 1, maxSize: 2, minAlpha: 0.26, maxAlpha: 0.52 },
  near: { minSize: 1.5, maxSize: 2.5, minAlpha: 0.38, maxAlpha: 0.74 },
};

/**
 * Lay out one star layer across a `width * height` tile.
 *
 * The tile is what gets wrapped by {@link wrapSpan} at draw time, so a layer of
 * 90 stars covers an arbitrarily large camera sweep without ever allocating a
 * ninety-first.
 */
export function createStars(count: number, width: number, height: number, layer: BackdropLayerId, seed = 0): BackdropStar[] {
  const style = LAYER_STYLE[layer];
  const total = Math.max(0, Math.min(Math.floor(count), STARFIELD_MAX[layer]));
  return Array.from({ length: total }, (_unused, index) => {
    const base = seed * 977 + index * 13;
    const roll = noise(base + 3);
    return {
      x: noise(base + 1) * width,
      y: noise(base + 2) * height,
      size: style.minSize + roll * (style.maxSize - style.minSize),
      // Weighted toward the front of the table so most stars stay white.
      tint: Math.floor(noise(base + 4) ** 2 * STAR_TINTS.length) % STAR_TINTS.length,
      phase: noise(base + 5) * Math.PI * 2,
      alpha: style.minAlpha + noise(base + 6) * (style.maxAlpha - style.minAlpha),
    };
  });
}

/**
 * The band of denser, dimmer stars a galaxy is seen edge-on as.
 *
 * A uniform scatter of dots reads as noise; a scatter with a *structure*
 * running through it reads as a place. This is the cheapest structure there is:
 * a diagonal band whose stars are pushed toward its centre line by squaring a
 * signed random offset, so the band has soft edges instead of a hard rectangle.
 */
export const STAR_BAND = { angle: -0.28, thickness: 0.3 } as const;

/**
 * Stars clustered along {@link STAR_BAND}. Dimmer and smaller than the loose
 * field, because a band that competes with the foreground stars flattens the
 * depth the layers just bought.
 */
export function createBandStars(count: number, width: number, height: number, seed = 0): BackdropStar[] {
  const total = Math.max(0, Math.min(Math.floor(count), STARFIELD_MAX.band));
  const cos = Math.cos(STAR_BAND.angle), sin = Math.sin(STAR_BAND.angle);
  const halfSpan = Math.hypot(width, height) / 2;
  return Array.from({ length: total }, (_unused, index) => {
    const base = seed * 733 + index * 19;
    const along = (noise(base + 1) - 0.5) * 2 * halfSpan;
    const offsetRoll = (noise(base + 2) - 0.5) * 2;
    // Squaring pulls the distribution toward the centre line without ever
    // leaving the band, which is what gives it soft edges.
    const across = Math.sign(offsetRoll) * offsetRoll * offsetRoll * height * STAR_BAND.thickness;
    return {
      x: wrapSpan(width / 2 + along * cos - across * sin, width),
      y: wrapSpan(height / 2 + along * sin + across * cos, height),
      size: 1,
      tint: Math.floor(noise(base + 3) ** 2 * STAR_TINTS.length) % STAR_TINTS.length,
      phase: noise(base + 4) * Math.PI * 2,
      alpha: 0.1 + noise(base + 5) * 0.22,
    };
  });
}

/** Scatter nebula clouds across a tile, each built from overlapping soft lobes. */
export function createNebulae(count: number, width: number, height: number, seed = 0): BackdropNebula[] {
  const total = Math.max(0, Math.min(Math.floor(count), STARFIELD_MAX.nebulae));
  return Array.from({ length: total }, (_unused, index) => {
    const base = seed * 613 + index * 29;
    // Deliberately smaller than the viewport. Clouds wider than the screen read
    // as a background gradient, not as clouds; several mid-sized ones overlap
    // into something with visible structure.
    const radius = Math.min(width, height) * (0.11 + noise(base + 1) * 0.17);
    const lobeCount = 4 + Math.floor(noise(base + 2) * 4);
    return {
      x: noise(base + 3) * width,
      y: noise(base + 4) * height,
      radius,
      tint: (index % 2) as 0 | 1,
      lobes: Array.from({ length: lobeCount }, (_lobe, lobeIndex) => {
        const lobeBase = base * 7 + lobeIndex * 41;
        const angle = noise(lobeBase + 1) * Math.PI * 2;
        const distance = noise(lobeBase + 2) * radius * 0.85;
        return {
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
          radius: radius * (0.35 + noise(lobeBase + 3) * 0.5),
          alpha: 0.35 + noise(lobeBase + 4) * 0.65,
        };
      }),
    };
  });
}

/** Sparse foreground dust. Positions are a tile; drift wraps them like the stars. */
export function createMotes(count: number, width: number, height: number, seed = 0): BackdropMote[] {
  const total = Math.max(0, Math.min(Math.floor(count), STARFIELD_MAX.motes));
  return Array.from({ length: total }, (_unused, index) => {
    const base = seed * 401 + index * 17;
    return {
      x: noise(base + 1) * width,
      y: noise(base + 2) * height,
      radius: 0.8 + noise(base + 3) * 1.9,
      angle: noise(base + 4) * Math.PI * 2,
      // Genuinely slow: a mote crosses the viewport in roughly a minute.
      speed: 0.004 + noise(base + 5) * 0.011,
      alpha: 0.1 + noise(base + 6) * 0.16,
    };
  });
}

/**
 * How much sky this device can afford.
 *
 * `detail` is `profile.detail`, the same 0..1 quality scalar every other
 * renderer here reads. `maxParticles` is the arena's existing particle ceiling:
 * motes are budgeted as a slice of it rather than as a free-standing number, so
 * a machine that has already been told to draw fewer sparks is not handed a
 * dust storm instead.
 *
 * Reduced motion keeps a full, handsome field but freezes it — no twinkle, no
 * drift. The opt-out is from movement, not from the art.
 */
export function starfieldBudget(detail: number, reducedMotion: boolean, maxParticles: number): StarfieldBudget {
  const quality = Math.max(0, Math.min(1, Number.isFinite(detail) ? detail : 1));
  const scale = 0.4 + quality * 0.6;
  const particles = Number.isFinite(maxParticles) ? Math.max(0, maxParticles) : 0;
  return {
    far: Math.round(STARFIELD_MAX.far * scale),
    mid: Math.round(STARFIELD_MAX.mid * scale),
    // Baked alongside the clouds rather than drawn per frame, so the band is
    // thinned far less aggressively than the live layers.
    band: Math.round(STARFIELD_MAX.band * (0.6 + quality * 0.4)),
    // The nearest layer is the most expensive per star (it twinkles and it is
    // the widest); it is the first thing thinned on a weak device.
    near: quality < 0.35 ? 0 : Math.round(STARFIELD_MAX.near * scale),
    nebulae: quality < 0.35 ? 3 : quality < 0.7 ? 5 : STARFIELD_MAX.nebulae,
    motes: quality < 0.6 || reducedMotion ? 0 : Math.min(STARFIELD_MAX.motes, Math.round(particles * 0.06)),
    twinkle: !reducedMotion && quality >= 0.5,
    drift: !reducedMotion,
  };
}

/** Wrap a coordinate into `[0, span)`. Negative input wraps forward, not to NaN. */
export function wrapSpan(value: number, span: number): number {
  if (!(span > 0) || !Number.isFinite(value)) return 0;
  const remainder = value % span;
  return remainder < 0 ? remainder + span : remainder;
}

/**
 * Where a tile-space point lands on screen for a given camera and depth.
 *
 * The camera offset is *subtracted* scaled by depth, so the field slides the
 * same direction the world does but less far — which is what parallax is.
 */
export function parallaxPoint(x: number, y: number, camX: number, camY: number, depth: number, width: number, height: number): { x: number; y: number } {
  return {
    x: wrapSpan(x + camX * depth, width),
    y: wrapSpan(y + camY * depth, height),
  };
}

/** A star's opacity this frame. Frozen at its base value when twinkle is off. */
export function twinkleAlpha(star: BackdropStar, timeMs: number, twinkle: boolean): number {
  if (!twinkle) return star.alpha;
  return star.alpha * (0.72 + Math.sin(timeMs * 0.0016 + star.phase) * 0.28);
}

/** A mote's drifted tile-space position at `timeMs`, wrapped back into the tile. */
export function moteAt(mote: BackdropMote, timeMs: number, width: number, height: number, drift: boolean): { x: number; y: number } {
  if (!drift) return { x: wrapSpan(mote.x, width), y: wrapSpan(mote.y, height) };
  return {
    x: wrapSpan(mote.x + Math.cos(mote.angle) * mote.speed * timeMs, width),
    y: wrapSpan(mote.y + Math.sin(mote.angle) * mote.speed * timeMs, height),
  };
}

/**
 * Identity of a baked backdrop.
 *
 * The nebula field and the far star layer are painted once into an offscreen
 * canvas and then blitted, because large translucent radial gradients are the
 * one thing in this design that would actually cost frames if redrawn 60 times
 * a second. This key is what tells the renderer the bake is stale — a new
 * escalation stage, a changed quality setting, or a resized viewport.
 */
export function backdropKey(paletteKey: string, nebulae: number, farStars: number, width: number, height: number): string {
  return `${paletteKey}|${nebulae}|${farStars}|${Math.round(width)}x${Math.round(height)}`;
}
