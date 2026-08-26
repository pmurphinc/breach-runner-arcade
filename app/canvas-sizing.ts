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
