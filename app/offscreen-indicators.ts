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

const clamp = (value: number, low: number, high: number) => (value < low ? low : value > high ? high : value);

/** Centre of the visible rectangle — what every indicator points away from. */
export function cameraBoundsCenter(bounds: CameraBounds) {
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
}

/**
 * The single visibility rule. Every off-screen marker asks this and nothing
 * else, so "is it on screen" cannot drift between targets.
 */
export function isTargetOffscreen(target: OffscreenTarget, bounds: CameraBounds): boolean {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0)) return false;
  const margin = Math.max(0, target.radius ?? 0) * OFFSCREEN_VISIBLE_BODY;
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
  return {
    x: clamp(target.x, bounds.left + padX, bounds.right - padX),
    y: clamp(target.y, bounds.top + padY, bounds.bottom - padY),
    angle: dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx),
    distance: Math.hypot(dx, dy),
  };
}
