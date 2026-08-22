/**
 * Canvas drawing language for every pickup in the game.
 *
 * Each weapon owns one silhouette function so the arena, the projectile layer,
 * the inventory icons, and the weapon codex all draw the same shape. Every
 * silhouette is designed to be identifiable in monochrome: colour is a second
 * cue, never the only one.
 *
 * All glyphs are drawn centred on the origin, facing +X when directional, and
 * scaled from a nominal radius so one function serves a 12px inventory chip and
 * a 30px arena hostile.
 */
import { WEAPONS, type PickupId } from "./game-data";

export type GlyphContext = {
  /** Nominal radius in the current canvas space. */
  r: number;
  /** Monotonic time in milliseconds, for animated details. */
  t: number;
  /** 0 = strip flourishes for performance, 1 = full detail. */
  detail: number;
  /** Extra per-entity state supplied by the arena renderer. */
  phase?: number;
  charge?: number;
};

type GlyphFn = (ctx: CanvasRenderingContext2D, g: GlyphContext) => void;

function poly(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], close = true) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  if (close) ctx.closePath();
}

function fillStroke(ctx: CanvasRenderingContext2D) {
  ctx.fill();
  ctx.stroke();
}

/** A soft core highlight; skipped entirely when detail is stripped back. */
function core(ctx: CanvasRenderingContext2D, radius: number, alpha: number, detail: number) {
  if (detail < 0.35 || radius <= 0) return;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  const previous = ctx.fillStyle;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = previous;
}

const heatseeker: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 6;
  poly(ctx, [[10 * s, 0], [3 * s, -3.1 * s], [-7 * s, -3.1 * s], [-7 * s, 3.1 * s], [3 * s, 3.1 * s]]);
  fillStroke(ctx);
  // Tail fins read as a missile even at icon size.
  poly(ctx, [[-4 * s, -3 * s], [-9.5 * s, -6.5 * s], [-7.5 * s, -2.6 * s]]);
  fillStroke(ctx);
  poly(ctx, [[-4 * s, 3 * s], [-9.5 * s, 6.5 * s], [-7.5 * s, 2.6 * s]]);
  fillStroke(ctx);
  const pulse = 0.55 + Math.sin(t * 0.012) * 0.35;
  ctx.save();
  ctx.globalAlpha = detail < 0.35 ? 1 : pulse;
  ctx.fillStyle = "#fff8f2";
  ctx.beginPath();
  ctx.arc(7.4 * s, 0, 1.7 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const turret: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 13;
  ctx.save();
  // Octagonal armoured base.
  const base: [number, number][] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    base.push([Math.cos(a) * 10 * s, Math.sin(a) * 10 * s]);
  }
  poly(ctx, base);
  fillStroke(ctx);
  if (detail >= 0.35) {
    ctx.beginPath();
    ctx.arc(0, 0, 6.2 * s, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Rotating gun mount: the barrel clears the base so the silhouette reads as
  // a gun platform rather than a disc.
  ctx.rotate(t * 0.0016);
  ctx.fillRect(-5.4 * s, -6 * s, 10.8 * s, 11 * s);
  ctx.strokeRect(-5.4 * s, -6 * s, 10.8 * s, 11 * s);
  ctx.fillRect(-2.5 * s, -20 * s, 5 * s, 15 * s);
  ctx.strokeRect(-2.5 * s, -20 * s, 5 * s, 15 * s);
  ctx.fillRect(-4.2 * s, -22.5 * s, 8.4 * s, 3.5 * s);
  ctx.strokeRect(-4.2 * s, -22.5 * s, 8.4 * s, 3.5 * s);
  ctx.restore();
};

const mines: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 15;
  ctx.save();
  ctx.rotate(t * 0.0009);
  const spikes = detail < 0.35 ? 6 : 10;
  for (let i = 0; i < spikes; i += 1) {
    const a = (i / spikes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6.4 * s, Math.sin(a) * 6.4 * s);
    ctx.lineTo(Math.cos(a) * 14 * s, Math.sin(a) * 14 * s);
    ctx.stroke();
    if (detail >= 0.35) {
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 14 * s, Math.sin(a) * 14 * s, 1.1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Segmented body: two hemispheres split by an equator band.
  ctx.beginPath();
  ctx.arc(0, 0, 6.6 * s, 0, Math.PI * 2);
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(-6.6 * s, 0);
  ctx.lineTo(6.6 * s, 0);
  ctx.stroke();
  ctx.restore();
};

const ufo: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 25;
  // Dome.
  ctx.beginPath();
  ctx.ellipse(0, -4 * s, 11 * s, 9 * s, 0, Math.PI, Math.PI * 2);
  fillStroke(ctx);
  // Saucer disc.
  poly(ctx, [[-24 * s, 0], [-11 * s, -5 * s], [11 * s, -5 * s], [24 * s, 0], [12 * s, 6 * s], [-12 * s, 6 * s]]);
  fillStroke(ctx);
  // Glowing underside bay.
  const lamps = detail < 0.35 ? 3 : 5;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < lamps; i += 1) {
    const x = (-1 + (2 * i) / (lamps - 1)) * 13 * s;
    ctx.globalAlpha = 0.45 + Math.sin(t * 0.006 + i) * 0.4;
    ctx.beginPath();
    ctx.arc(x, 5.4 * s, 1.7 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (detail >= 0.5) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    poly(ctx, [[-9 * s, 6 * s], [9 * s, 6 * s], [16 * s, 20 * s], [-16 * s, 20 * s]]);
    ctx.fill();
    ctx.restore();
  }
};

const inflator: GlyphFn = (ctx, { r, t, detail }) => {
  // Organic swelling sac: lobed blob that breathes.
  const lobes = detail < 0.35 ? 6 : 9;
  ctx.beginPath();
  const steps = lobes * 6;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * lobes + t * 0.003) * 0.11 + Math.sin(t * 0.004) * 0.05;
    const x = Math.cos(a) * r * wobble;
    const y = Math.sin(a) * r * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  fillStroke(ctx);
  core(ctx, r * 0.62, 0.32 + Math.sin(t * 0.004) * 0.18, detail);
  if (detail >= 0.35) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
};

const minelayer: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 18;
  // Carrier hull with a blunt nose and a hollow drop bay slung underneath.
  poly(ctx, [[17 * s, -2 * s], [10 * s, -8 * s], [-13 * s, -8 * s], [-17 * s, -1 * s], [-13 * s, 5 * s], [12 * s, 5 * s]]);
  fillStroke(ctx);
  ctx.strokeRect(-9 * s, 5 * s, 16 * s, 5.5 * s);
  if (detail >= 0.35) {
    // A mine dropping out of the bay.
    const drop = ((t * 0.02) % 22) * s;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - drop / (22 * s));
    ctx.beginPath();
    ctx.arc(-1 * s, 12 * s + drop, 2.6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-13 * s, -8 * s);
    ctx.lineTo(-13 * s, 5 * s);
    ctx.stroke();
  }
};

const gunship: GlyphFn = (ctx, { r, detail }) => {
  const s = r / 25;
  // Heavy central hull.
  poly(ctx, [[22 * s, 0], [8 * s, -7 * s], [-14 * s, -8 * s], [-18 * s, 0], [-14 * s, 8 * s], [8 * s, 7 * s]]);
  fillStroke(ctx);
  // Two outboard engine nacelles — the multi-engine read.
  for (const sign of [-1, 1]) {
    poly(ctx, [[6 * s, sign * 9 * s], [-10 * s, sign * 20 * s], [-19 * s, sign * 18 * s], [-6 * s, sign * 8 * s]]);
    fillStroke(ctx);
    if (detail >= 0.35) {
      ctx.beginPath();
      ctx.moveTo(-12 * s, sign * 17 * s);
      ctx.lineTo(-20 * s, sign * 16 * s);
      ctx.stroke();
    }
  }
  // Twin barrels.
  ctx.fillRect(14 * s, -5 * s, 12 * s, 2.4 * s);
  ctx.fillRect(14 * s, 2.6 * s, 12 * s, 2.4 * s);
};

const scarab: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 15;
  const stride = Math.sin(t * 0.012) * 1.6 * s;
  ctx.save();
  // Short jointed legs tucked under a broad beetle body.
  ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.7);
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const x = (-6 + i * 5.5) * s;
      const kick = i % 2 ? stride : -stride;
      ctx.beginPath();
      ctx.moveTo(x, sign * 6 * s);
      ctx.lineTo(x - 2 * s, sign * 10 * s + kick);
      ctx.lineTo(x - 5 * s, sign * 9.5 * s + kick);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Broad carapace with a hard spine seam.
  poly(ctx, [[9 * s, -3 * s], [4 * s, -8.5 * s], [-7 * s, -8 * s], [-12 * s, 0], [-7 * s, 8 * s], [4 * s, 8.5 * s], [9 * s, 3 * s]]);
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(8 * s, 0);
  ctx.lineTo(-11 * s, 0);
  ctx.stroke();
  // Head plate and mandibles.
  poly(ctx, [[9 * s, -4 * s], [14 * s, -2.5 * s], [14 * s, 2.5 * s], [9 * s, 4 * s]]);
  fillStroke(ctx);
  if (detail >= 0.35) {
    ctx.beginPath();
    ctx.moveTo(14 * s, -2 * s);
    ctx.lineTo(20 * s, -5.5 * s);
    ctx.moveTo(14 * s, 2 * s);
    ctx.lineTo(20 * s, 5.5 * s);
    ctx.stroke();
  }
};

const nuke: GlyphFn = (ctx, { r, t, detail, charge }) => {
  const s = r / 20;
  // Warhead body with a conical nose and tail fins.
  poly(ctx, [[0, -18 * s], [7 * s, -8 * s], [7 * s, 12 * s], [-7 * s, 12 * s], [-7 * s, -8 * s]]);
  fillStroke(ctx);
  poly(ctx, [[-7 * s, 12 * s], [-12 * s, 18 * s], [-3 * s, 15 * s]]);
  fillStroke(ctx);
  poly(ctx, [[7 * s, 12 * s], [12 * s, 18 * s], [3 * s, 15 * s]]);
  fillStroke(ctx);
  // Hazard bands.
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#0a0603";
  for (let i = 0; i < 3; i += 1) ctx.fillRect(-7 * s, (-4 + i * 5) * s, 14 * s, 2 * s);
  ctx.restore();
  // Pulsing core; beats faster as the countdown runs out.
  const urgency = charge === undefined ? 0.5 : 1 - Math.min(1, charge);
  const beat = 0.4 + Math.abs(Math.sin(t * (0.004 + urgency * 0.012))) * 0.6;
  ctx.save();
  ctx.globalAlpha = beat;
  ctx.fillStyle = "#fff4cf";
  ctx.beginPath();
  ctx.arc(0, -11 * s, 2.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  core(ctx, r * 0.9, beat * 0.3, detail);
};

const wallcrawler: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 20;
  // Three armoured segments with visible tread blocks.
  for (let i = 0; i < 3; i += 1) {
    const x = (-11 + i * 11) * s;
    const h = (i === 1 ? 9 : 7.5) * s;
    ctx.beginPath();
    ctx.rect(x - 5 * s, -h, 10 * s, h * 2);
    fillStroke(ctx);
  }
  ctx.beginPath();
  ctx.moveTo(-16 * s, 0);
  ctx.lineTo(16 * s, 0);
  ctx.stroke();
  if (detail >= 0.35) {
    const shift = (t * 0.02) % (4 * s);
    for (const sign of [-1, 1]) {
      for (let i = -4; i <= 4; i += 1) {
        const x = i * 4 * s + shift;
        ctx.beginPath();
        ctx.moveTo(x, sign * 8 * s);
        ctx.lineTo(x, sign * 11 * s);
        ctx.stroke();
      }
    }
  }
  // Forward sensor head.
  poly(ctx, [[16 * s, -4 * s], [21 * s, 0], [16 * s, 4 * s]]);
  fillStroke(ctx);
};

const beam: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 12;
  // Elongated emitter capsule.
  poly(ctx, [[16 * s, 0], [9 * s, -4 * s], [-11 * s, -5 * s], [-15 * s, 0], [-11 * s, 5 * s], [9 * s, 4 * s]]);
  fillStroke(ctx);
  // Focusing rings stepping down toward the muzzle.
  const rings = detail < 0.35 ? 2 : 4;
  for (let i = 0; i < rings; i += 1) {
    const x = (2 + i * 4) * s;
    const h = (5 - i * 0.7) * s;
    ctx.beginPath();
    ctx.ellipse(x, 0, 1.4 * s, h, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Charge flicker at the muzzle.
  ctx.save();
  ctx.globalAlpha = 0.4 + Math.abs(Math.sin(t * 0.01)) * 0.6;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(16 * s, -1.3 * s, 7 * s, 2.6 * s);
  ctx.restore();
};

const emp: GlyphFn = (ctx, { r, t, detail }) => {
  // Orb.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  fillStroke(ctx);
  // Arcing rings on three axes — reads as electrical even in monochrome.
  const rings = detail < 0.35 ? 2 : 3;
  for (let i = 0; i < rings; i += 1) {
    ctx.save();
    ctx.rotate((i / rings) * Math.PI + t * 0.0018);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.33, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (detail >= 0.5) {
    // Lightning tick marks.
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t * 0.02)) * 0.5;
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + t * 0.004;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      ctx.lineTo(Math.cos(a + 0.25) * r * 0.85, Math.sin(a + 0.25) * r * 0.85);
      ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
      ctx.stroke();
    }
    ctx.restore();
  }
};

const ghost: GlyphFn = (ctx, { r, t, detail }) => {
  ctx.save();
  ctx.globalAlpha *= 0.62;
  // Hooded silhouette with a rippling hem.
  ctx.beginPath();
  ctx.arc(0, -r * 0.15, r * 0.8, Math.PI, 0);
  const hem = r * 0.95;
  const waves = detail < 0.35 ? 3 : 5;
  for (let i = 0; i <= waves; i += 1) {
    const x = r * 0.8 - (i / waves) * r * 1.6;
    const y = hem + Math.sin(t * 0.004 + i * 1.7) * r * 0.18;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  fillStroke(ctx);
  ctx.restore();
  // Two voids where eyes would be: unmistakable without colour.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(-r * 0.28, -r * 0.2, r * 0.15, 0, Math.PI * 2);
  ctx.arc(r * 0.28, -r * 0.2, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const artillery: GlyphFn = (ctx, { r, detail }) => {
  const s = r / 20;
  // Heavy shell: ogive nose, driving bands, squat breech.
  poly(ctx, [[20 * s, 0], [11 * s, -7 * s], [-8 * s, -8 * s], [-8 * s, 8 * s], [11 * s, 7 * s]]);
  fillStroke(ctx);
  ctx.strokeRect(-16 * s, -10 * s, 9 * s, 20 * s);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#100307";
  ctx.fillRect(-4 * s, -8 * s, 2.6 * s, 16 * s);
  ctx.fillRect(2 * s, -7.6 * s, 2.6 * s, 15.2 * s);
  ctx.restore();
  if (detail >= 0.35) {
    ctx.beginPath();
    ctx.moveTo(-16 * s, 0);
    ctx.lineTo(-23 * s, 0);
    ctx.stroke();
  }
};

const gunUpgrade: GlyphFn = (ctx, { r }) => {
  const s = r / 15;
  for (let i = 0; i < 3; i += 1) {
    poly(ctx, [[-9 * s + i * 7 * s, -9 * s], [-2 * s + i * 7 * s, 0], [-9 * s + i * 7 * s, 9 * s]], false);
    ctx.stroke();
  }
  ctx.fillRect(-12 * s, -1.6 * s, 4 * s, 3.2 * s);
};

const thrustUpgrade: GlyphFn = (ctx, { r, t, detail }) => {
  const s = r / 15;
  poly(ctx, [[10 * s, 0], [-3 * s, -9 * s], [-3 * s, -3 * s], [-11 * s, -3 * s], [-11 * s, 3 * s], [-3 * s, 3 * s], [-3 * s, 9 * s]]);
  fillStroke(ctx);
  if (detail >= 0.35) {
    ctx.save();
    ctx.globalAlpha = 0.4 + Math.abs(Math.sin(t * 0.008)) * 0.5;
    poly(ctx, [[-11 * s, -3 * s], [-18 * s, 0], [-11 * s, 3 * s]]);
    ctx.fill();
    ctx.restore();
  }
};

const retrosIcon: GlyphFn = (ctx, { r }) => {
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0.5, Math.PI * 1.7);
  ctx.stroke();
  poly(ctx, [[r * 0.63, -r * 0.55], [r * 0.3, -r * 0.2], [r * 0.85, -r * 0.1]]);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  fillStroke(ctx);
};

const shieldIcon: GlyphFn = (ctx, { r, detail }) => {
  poly(ctx, [[0, -r], [r * 0.86, -r * 0.5], [r * 0.86, r * 0.35], [0, r], [-r * 0.86, r * 0.35], [-r * 0.86, -r * 0.5]]);
  fillStroke(ctx);
  if (detail >= 0.35) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    poly(ctx, [[0, -r * 0.62], [r * 0.52, -r * 0.3], [r * 0.52, r * 0.2], [0, r * 0.6], [-r * 0.52, r * 0.2], [-r * 0.52, -r * 0.3]]);
    ctx.stroke();
    ctx.restore();
  }
};

const zapIcon: GlyphFn = (ctx, { r, t, detail }) => {
  const spikes = detail < 0.35 ? 6 : 10;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const a = (i / (spikes * 2)) * Math.PI * 2 + t * 0.002;
    const rad = i % 2 ? r * 0.4 : r;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  fillStroke(ctx);
};

const healthIcon: GlyphFn = (ctx, { r, detail }) => {
  const arm = r * 0.34;
  poly(ctx, [
    [-arm, -r], [arm, -r], [arm, -arm], [r, -arm], [r, arm],
    [arm, arm], [arm, r], [-arm, r], [-arm, arm], [-r, arm], [-r, -arm], [-arm, -arm],
  ]);
  fillStroke(ctx);
  core(ctx, r * 0.8, 0.25, detail);
};

const GLYPHS: Record<PickupId, GlyphFn> = {
  heatseeker, turret, mines, ufo, inflator, minelayer, gunship, scarab, nuke,
  wallcrawler, beam, emp, ghost, artillery,
  gun: gunUpgrade,
  thrust: thrustUpgrade,
  retros: retrosIcon,
  shield: shieldIcon,
  clear: zapIcon,
  health: healthIcon,
};

/** Weapons whose silhouette points along its direction of travel. */
export const DIRECTIONAL: ReadonlySet<PickupId> = new Set<PickupId>([
  "heatseeker", "minelayer", "gunship", "scarab", "wallcrawler", "beam", "artillery", "thrust", "gun",
]);

export type DrawGlyphOptions = {
  color?: string;
  detail?: number;
  phase?: number;
  charge?: number;
  /** Line width in the caller's units; scaled with the glyph by default. */
  lineWidth?: number;
  alpha?: number;
  /** Draw outline only, e.g. for the wormhole "forming" silhouette. */
  outline?: boolean;
};

/**
 * Draw one weapon silhouette centred on the current origin.
 * The caller owns translation, rotation, shadow, and composite mode.
 */
export function drawWeaponGlyph(
  ctx: CanvasRenderingContext2D,
  id: PickupId,
  radius: number,
  time: number,
  options: DrawGlyphOptions = {},
) {
  const color = options.color ?? WEAPONS[id].color;
  const detail = options.detail ?? 1;
  ctx.save();
  if (options.alpha !== undefined) ctx.globalAlpha *= options.alpha;
  ctx.lineWidth = options.lineWidth ?? Math.max(0.9, radius * 0.11);
  ctx.strokeStyle = color;
  ctx.fillStyle = options.outline ? "rgba(0,0,0,0)" : `${color}30`;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  GLYPHS[id](ctx, { r: radius, t: time, detail, phase: options.phase, charge: options.charge });
  ctx.restore();
}

/**
 * Draw a fired power-up in flight: silhouette plus a weapon-specific wake so it
 * never reads as a plain pulse-cannon shot.
 */
export function drawPowerProjectile(
  ctx: CanvasRenderingContext2D,
  id: PickupId,
  x: number,
  y: number,
  vx: number,
  vy: number,
  time: number,
  detail: number,
) {
  const meta = WEAPONS[id];
  const speed = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  ctx.save();
  ctx.translate(x, y);
  if (detail >= 0.35) {
    // Directional wake, drawn before the body so the head stays crisp.
    const length = Math.min(46, 8 + speed * 3);
    const wake = ctx.createLinearGradient(0, 0, -Math.cos(angle) * length, -Math.sin(angle) * length);
    wake.addColorStop(0, `${meta.color}cc`);
    wake.addColorStop(1, `${meta.color}00`);
    ctx.strokeStyle = wake;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-Math.cos(angle) * length, -Math.sin(angle) * length);
    ctx.stroke();
  }
  ctx.rotate(DIRECTIONAL.has(id) ? angle : time * 0.002);
  // A transmitted power-up is carried in an energy cradle so friendly outbound
  // ordnance is distinguishable from hostile incoming hulls at a glance.
  ctx.save();
  ctx.strokeStyle = "rgba(233,251,255,.85)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawWeaponGlyph(ctx, id, 11, time, { detail });
  ctx.restore();
}

/** Compact category chip letter used on canvas badges. */
export function categoryMark(id: PickupId) {
  return WEAPONS[id].category.charAt(0).toUpperCase();
}
