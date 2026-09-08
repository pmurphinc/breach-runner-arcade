/**
 * Ship silhouettes as SVG, for the parts of the HUD that are not the canvas.
 *
 * The arena draws hulls with `drawShipShape` into a 2D context. The rails and
 * panels around it are DOM, and had no way to show a ship at all — which is
 * why every ship-shaped idea in the HUD had so far been spelled out in words
 * instead ("LIVES 2").
 *
 * Both readings come from the same `SHIP_SHAPES` table, so a hull whose
 * outline is retouched changes everywhere at once and a glyph can never drift
 * from the ship it names.
 *
 * Pure and dependency-free apart from that table: a path string and a viewBox
 * are testable without a canvas or a browser.
 */

import { SHIP_SHAPES } from "./weapon-art.ts";
import type { ShipId } from "./game-data.ts";

/** Blank space left around the hull inside the viewBox, in shape units. */
const GLYPH_PADDING = 2;

/**
 * The hull's outline as an SVG path.
 *
 * Closed, because these are solid silhouettes rather than open strokes, and
 * rounded to two decimals so the markup stays legible in a snapshot.
 */
export function shipGlyphPath(ship: ShipId): string {
  const points = SHIP_SHAPES[ship];
  const round = (value: number) => Math.round(value * 100) / 100;
  const [first, ...rest] = points;
  return [
    `M${round(first[0])} ${round(first[1])}`,
    ...rest.map((point) => `L${round(point[0])} ${round(point[1])}`),
    "Z",
  ].join(" ");
}

/**
 * A viewBox that fits this hull, padded.
 *
 * Per hull rather than one shared box: the frames genuinely differ in size —
 * the command vessel is half as long again as the interceptor — and a shared
 * box would render the small ones as specks. A glyph should read as *a ship*
 * first and as *which* ship second.
 */
export function shipGlyphViewBox(ship: ShipId): string {
  const points = SHIP_SHAPES[ship];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs) - GLYPH_PADDING;
  const minY = Math.min(...ys) - GLYPH_PADDING;
  const width = Math.max(...xs) + GLYPH_PADDING - minX;
  const height = Math.max(...ys) + GLYPH_PADDING - minY;
  return `${minX} ${minY} ${width} ${height}`;
}
