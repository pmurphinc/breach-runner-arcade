/** Fixed simulation/presentation width; height follows the visible canvas. */
export const VIEWPORT_WIDTH = 1048;

/** Keep a canvas backing store and logical presentation viewport in lockstep. */
export function canvasBackingSize(cssWidth: number, cssHeight: number, dpr: number, maxWidth: number) {
  const safeWidth = Math.max(1, cssWidth);
  const safeHeight = Math.max(1, cssHeight);
  const pixelRatio = Math.max(1, Math.min(2, dpr || 1));
  const width = Math.max(1, Math.min(maxWidth, Math.round(safeWidth * pixelRatio)));
  const height = Math.max(1, Math.round(width * safeHeight / safeWidth));
  return { width, height, logicalHeight: VIEWPORT_WIDTH * height / width };
}

/**
 * Geometry for the player-hit rim. The pulse is an ellipse locked to the
 * canvas box rather than a circle sized off the width alone, so a portrait
 * phone gets the same rim on every edge instead of a square wash that stops
 * partway down the arena. On a square canvas it matches the original circle.
 */
export function damageVignette(cssWidth: number, cssHeight: number) {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const extent = Math.max(width, height);
  const half = extent / 2;
  return {
    centerX: width / 2,
    centerY: height / 2,
    scaleX: width / extent,
    scaleY: height / extent,
    innerRadius: half * 0.64,
    outerRadius: half * 1.44,
    extent,
  };
}
