/**
 * Shared math for edge-clamped "the thing you care about is off-screen"
 * markers.
 *
 * Deliberately geometry-only: it takes a target position, the rectangle the
 * camera is currently showing, and an inset, and returns where to put a marker
 * and which way to rotate it. It knows nothing about the Rift, the ally, the
 * canvas, or the network, so the Rift and the ally share one implementation
 * and later targets (enemies, PUPs, hazards) can reuse it unchanged.
 *
 * Units are whatever the caller passes in. The game feeds it world units taken
 * from the live camera transform, which is why the marker follows the camera
 * in every view mode without the helper knowing a camera exists.
 */

/** The slice of the world the camera is currently showing, in world units. */
export type CameraBounds = { left: number; top: number; right: number; bottom: number };

/**
 * Something worth pointing at. `radius` is the object's meaningful visual
 * radius — the drawn body, not its collision hull — so a target whose centre
 * is barely inside the frame while its body hangs outside still counts as
 * off-screen.
 */
export type OffscreenTarget = { x: number; y: number; radius?: number };

export type OffscreenIndicator = {
  /** Marker position, clamped inside the camera rectangle by the inset. */
  x: number;
  y: number;
  /** Radians from the camera centre toward the target, for marker rotation. */
  angle: number;
  /** World distance from the camera centre to the target. */
  distance: number;
};

/**
 * How far inside the playfield border a marker sits, in presentation units.
 * One value for every edge and every target so nothing is ever clipped and no
 * side drifts out of alignment with the others.
 */
export const OFFSCREEN_INDICATOR_INSET = 30;

/**
 * How much of a target's body has to be inside the frame before it counts as
 * visible. At 0.5 the marker disappears once the object is more than half on
 * screen, which keeps a marker from sitting on top of a target the pilot can
 * plainly see, and keeps it up while a big object is still mostly outside.
 */
export const OFFSCREEN_VISIBLE_BODY = 0.5;

/**
 * The marker's own footprint, in presentation units — half the width of the
 * drawn chevron and its identity mark. Obstruction is tested against this box
 * rather than the marker's centre point, so a marker whose tip alone slides
 * under a HUD panel still counts as obscured.
 */
export const OFFSCREEN_MARKER_RADIUS = 13;

const clamp = (value: number, low: number, high: number) => (value < low ? low : value > high ? high : value);

/** Centre of the visible rectangle — what every indicator points away from. */
export function cameraBoundsCenter(bounds: CameraBounds) {
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
}

/**
 * The single visibility rule. Every off-screen marker asks this and nothing
 * else, so "is it on screen" cannot drift between targets.
 *
 * `radius` defaults to the target's own, and can be supplied instead for a list
 * of same-sized things — loose PUPs, say — so their shared body size is applied
 * without wrapping every one of them in a new object each frame.
 */
export function isTargetOffscreen(
  target: OffscreenTarget,
  bounds: CameraBounds,
  radius: number = target.radius ?? 0,
): boolean {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0)) return false;
  const margin = Math.max(0, radius) * OFFSCREEN_VISIBLE_BODY;
  const marginX = Math.min(margin, width / 2);
  const marginY = Math.min(margin, height / 2);
  return (
    target.x < bounds.left + marginX
    || target.x > bounds.right - marginX
    || target.y < bounds.top + marginY
    || target.y > bounds.bottom - marginY
  );
}

/**
 * Marker placement for one target, or null while the target is visible enough
 * that a marker would be noise.
 *
 * Position clamps the target into the inset rectangle, so the marker sits on
 * the nearest edge and stays aligned with the target's row or column. Rotation
 * is measured from the camera centre, so a target off the top-left corner
 * points diagonally rather than snapping to an axis.
 */
export function offscreenIndicatorFor(
  target: OffscreenTarget,
  bounds: CameraBounds,
  inset: number = OFFSCREEN_INDICATOR_INSET,
  options: OffscreenIndicatorOptions = {},
): OffscreenIndicator | null {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0)) return null;
  if (!isTargetOffscreen(target, bounds)) return null;
  const padX = clamp(inset, 0, width / 2);
  const padY = clamp(inset, 0, height / 2);
  const center = cameraBoundsCenter(bounds);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const indicator: OffscreenIndicator = {
    x: clamp(target.x, bounds.left + padX, bounds.right - padX),
    y: clamp(target.y, bounds.top + padY, bounds.bottom - padY),
    angle: dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx),
    distance: Math.hypot(dx, dy),
  };
  return slideClearOfBlockedRegions(indicator, bounds, inset, options);
}

// ------------------------------------------------------- blocked regions --

/**
 * A rectangle a marker must not end up underneath, in the same units as the
 * camera bounds.
 *
 * The game feeds it the HUD panels that float over the arena — the rules badge
 * today — because those are painted above the canvas and would simply swallow
 * a marker clamped beneath them. It is a plain list of rectangles rather than
 * anything HUD-aware, so the same mechanism covers whatever overlays arrive
 * next without the marker code learning their names.
 */
export type BlockedRegion = CameraBounds;

export type OffscreenIndicatorOptions = {
  /** Rectangles the marker must stay clear of. Empty or absent means no work. */
  blocked?: readonly BlockedRegion[];
  /** The marker's own half-size, so its footprint clears the region, not just its centre. */
  markerRadius?: number;
};

/** Half-open overlap: touching a region's expanded edge is already clear of it. */
const inside = (value: number, low: number, high: number) => value > low && value < high;

/** Merge overlapping spans so a run of adjacent panels is escaped in one move. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  if (spans.length < 2) return spans;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * The spans of one axis a marker cannot occupy, given where it sits on the
 * other axis. Regions the marker does not cross at all are irrelevant, which
 * is what keeps a badge in one corner from disturbing the other three edges.
 */
function blockedSpans(
  axis: "x" | "y",
  marker: { x: number; y: number },
  blocked: readonly BlockedRegion[],
  radius: number,
): [number, number][] {
  const spans: [number, number][] = [];
  for (const region of blocked) {
    const left = region.left - radius;
    const right = region.right + radius;
    const top = region.top - radius;
    const bottom = region.bottom + radius;
    if (!(right > left) || !(bottom > top)) continue;
    if (axis === "y") {
      if (inside(marker.x, left, right)) spans.push([top, bottom]);
    } else if (inside(marker.y, top, bottom)) {
      spans.push([left, right]);
    }
  }
  return mergeSpans(spans);
}

/** Nearest value to `value` inside [low, high] that no span covers, or null. */
function nearestClearValue(value: number, low: number, high: number, spans: [number, number][]) {
  const covered = (candidate: number) => spans.some(([start, end]) => inside(candidate, start, end));
  if (!covered(value)) return value;
  let best: number | null = null;
  let bestShift = Infinity;
  for (const candidate of [low, high, ...spans.flatMap(([start, end]) => [start, end])]) {
    if (candidate < low || candidate > high || covered(candidate)) continue;
    const shift = Math.abs(candidate - value);
    if (shift < bestShift) {
      bestShift = shift;
      best = candidate;
    }
  }
  return best;
}

/**
 * Which axes the marker may travel along: the ones parallel to the edge it is
 * pinned to. A corner marker is pinned to two edges and gets both, so the
 * shorter escape wins. A marker somehow floating free of every edge falls back
 * to the edge it is nearest, which keeps the answer sane rather than absent.
 */
function slideAxes(
  marker: { x: number; y: number },
  lowX: number, highX: number, lowY: number, highY: number,
): ("x" | "y")[] {
  const edges = [
    { axis: "y" as const, gap: Math.abs(marker.x - lowX) },
    { axis: "y" as const, gap: Math.abs(marker.x - highX) },
    { axis: "x" as const, gap: Math.abs(marker.y - lowY) },
    { axis: "x" as const, gap: Math.abs(marker.y - highY) },
  ];
  const pinned = edges.filter((edge) => edge.gap <= 1e-6);
  const chosen = pinned.length ? pinned : [edges.reduce((a, b) => (b.gap < a.gap ? b : a))];
  return [...new Set(chosen.map((edge) => edge.axis))];
}

/**
 * Slide a marker along the edge it already sits on until its footprint clears
 * every blocked region, taking the shortest move that does it.
 *
 * Only the position moves. The rotation still points at the target's real
 * world position, so a nudged marker keeps telling the truth about direction —
 * it has simply stepped out from under the panel that was hiding it.
 *
 * When a panel covers the whole edge — a status strip spanning the top, say —
 * there is no along-the-edge answer, and the marker steps inward off that edge
 * instead. That is a deliberate second choice: a marker one panel-height inside
 * the border still reads as "off this way", and a marker nobody can see does
 * not. If even that finds nowhere clear, the marker stays where it was rather
 * than being flung somewhere arbitrary or dropped altogether.
 */
export function slideClearOfBlockedRegions(
  indicator: OffscreenIndicator,
  bounds: CameraBounds,
  inset: number = OFFSCREEN_INDICATOR_INSET,
  options: OffscreenIndicatorOptions = {},
): OffscreenIndicator {
  const blocked = options.blocked;
  if (!blocked || blocked.length === 0) return indicator;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0)) return indicator;
  const radius = Math.max(0, options.markerRadius ?? OFFSCREEN_MARKER_RADIUS);
  const obstructed = blocked.some((region) =>
    inside(indicator.x, region.left - radius, region.right + radius)
    && inside(indicator.y, region.top - radius, region.bottom + radius));
  if (!obstructed) return indicator;

  const padX = clamp(inset, 0, width / 2);
  const padY = clamp(inset, 0, height / 2);
  const lowX = bounds.left + padX;
  const highX = bounds.right - padX;
  const lowY = bounds.top + padY;
  const highY = bounds.bottom - padY;

  const shortestEscape = (axes: readonly ("x" | "y")[]) => {
    let best: { x: number; y: number; shift: number } | null = null;
    for (const axis of axes) {
      const spans = blockedSpans(axis, indicator, blocked, radius);
      const from = axis === "x" ? indicator.x : indicator.y;
      const low = axis === "x" ? lowX : lowY;
      const high = axis === "x" ? highX : highY;
      const to = nearestClearValue(from, low, high, spans);
      if (to === null) continue;
      const shift = Math.abs(to - from);
      if (!best || shift < best.shift) {
        best = axis === "x" ? { x: to, y: indicator.y, shift } : { x: indicator.x, y: to, shift };
      }
    }
    return best;
  };

  const along = slideAxes(indicator, lowX, highX, lowY, highY);
  const inward = (["x", "y"] as const).filter((axis) => !along.includes(axis));
  const best = shortestEscape(along) ?? shortestEscape(inward);
  return best ? { ...indicator, x: best.x, y: best.y } : indicator;
}

// --------------------------------------------------- choosing what to mark --

/**
 * How many loose-PUP markers the edge will carry at once.
 *
 * The arena can hold far more loose PUPs than an edge can show without turning
 * into a ring of overlapping badges, so the list is cut here rather than at
 * each call site. Five is enough to point at the cluster worth flying to and
 * few enough that every marker stays separately readable.
 */
export const MAX_OFFSCREEN_PUP_INDICATORS = 5;

/**
 * The `limit` off-screen targets nearest to `origin`, nearest first.
 *
 * Deterministic by construction: distance decides, and ties fall back to the
 * order the caller supplied, so the same world always produces the same
 * markers in the same order. Visibility goes through the one body-aware rule,
 * so a target that is on screen — or that has been collected and is simply no
 * longer in the list — cannot produce a marker.
 *
 * Target-agnostic like everything else here, so enemies and hazards can use it
 * unchanged when their turn comes.
 */
export function nearestOffscreenTargets<T extends OffscreenTarget>(
  targets: readonly T[],
  bounds: CameraBounds,
  limit: number,
  options: {
    /** What "nearest" is measured from. Defaults to the camera centre. */
    origin?: { x: number; y: number };
    /** Shared body radius, for a list of same-sized targets that carry none. */
    radius?: number;
  } = {},
): T[] {
  if (!(limit > 0)) return [];
  const from = options.origin ?? cameraBoundsCenter(bounds);
  const candidates: { target: T; distance: number; index: number }[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!isTargetOffscreen(target, bounds, options.radius ?? target.radius ?? 0)) continue;
    candidates.push({ target, distance: Math.hypot(target.x - from.x, target.y - from.y), index });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
  candidates.length = Math.min(candidates.length, limit);
  return candidates.map((candidate) => candidate.target);
}

/**
 * A placed marker, expressed as something later markers must avoid.
 *
 * Keeping markers off each other is the same problem as keeping them out from
 * under a HUD panel, so it reuses the same machinery instead of growing a
 * clustering system: place a marker, hand its footprint to the next one as a
 * blocked region, and the next one slides along its edge until it clears.
 * Direction is untouched by that slide, so a nudged marker still points at its
 * own target.
 */
export function markerBlockFor(
  marker: { x: number; y: number },
  radius: number = OFFSCREEN_MARKER_RADIUS,
): BlockedRegion {
  return {
    left: marker.x - radius,
    top: marker.y - radius,
    right: marker.x + radius,
    bottom: marker.y + radius,
  };
}
