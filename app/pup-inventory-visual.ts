import { WEAPONS, type PickupId } from "./game-data.ts";
import { pupFrameColor, pupFrameShape } from "./pup-world.ts";

export const INVENTORY_PUP_ROTATION = 0;

export type InventoryIconBounds = Readonly<{ width: number; height: number }>;

/**
 * How much of the icon box the glyph fills.
 *
 * The inventory icon used to draw the Payload triangle around the glyph, which
 * capped the glyph at 46% of the frame: a triangle's inradius is half its
 * circumradius, so anything larger poked out of the corners. At the ~22px the
 * HUD actually renders these at, that left a symbol too small to identify at a
 * glance, which is the complaint this replaces.
 *
 * The triangle is gone from the *icon*. Payload class identity is still carried
 * — by the slot's own coloured border and tinted fill, which the CSS draws at
 * full slot size — so nothing is lost by dropping a shape that was only ever
 * shrinking the thing it framed.
 *
 * Loose PUPs in the arena keep their class silhouettes. That is the canonical
 * shape language (triangle payload, octagon upgrade, circle recovery, diamond
 * rare) and it stays untouched; this constant governs the HUD icon only.
 */
export const INVENTORY_GLYPH_SCALE = 0.92;

/**
 * Size the Payload glyph from the icon's actual drawing bounds.
 *
 * `frameRadius` is retained as the icon's usable radius so callers keep a single
 * notion of "how big is this box", even though nothing strokes a frame now.
 */
export function inventoryPayloadIconLayout(bounds: InventoryIconBounds) {
  const extent = Math.max(0, Math.min(bounds.width, bounds.height));
  const strokeWidth = Math.max(1.5, extent * 0.075);
  const frameRadius = Math.max(0, (extent - strokeWidth) / 2);
  return {
    centerX: bounds.width / 2,
    centerY: bounds.height / 2,
    frameRadius,
    glyphRadius: frameRadius * INVENTORY_GLYPH_SCALE,
    strokeWidth,
    rotation: INVENTORY_PUP_ROTATION,
  } as const;
}

/** Resolve a stored PUP's frame from its canonical class, retaining its glyph id. */
export function inventoryPupVisual(id: PickupId) {
  const pupClass = WEAPONS[id].pupClass;
  if (pupClass !== "payload") {
    throw new Error(`Inventory PUP ${id} must resolve to the payload class`);
  }
  return {
    pupClass,
    shape: pupFrameShape(pupClass),
    color: pupFrameColor(pupClass),
    glyphId: id,
  } as const;
}
