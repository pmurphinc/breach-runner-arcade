import { WEAPONS, type PickupId } from "./game-data.ts";
import { pupFrameColor, pupFrameShape } from "./pup-world.ts";

export const INVENTORY_PUP_ROTATION = 0;

export type InventoryIconBounds = Readonly<{ width: number; height: number }>;

/**
 * Size the Payload frame from the icon's actual drawing bounds.  A triangle's
 * inradius is half its circumradius, so the glyph stays below that limit (with
 * padding) instead of using the old, overlapping 37%-of-icon radius.
 */
export function inventoryPayloadIconLayout(bounds: InventoryIconBounds) {
  const extent = Math.max(0, Math.min(bounds.width, bounds.height));
  const strokeWidth = Math.max(1.5, extent * 0.075);
  const frameRadius = Math.max(0, (extent - strokeWidth) / 2);
  return {
    centerX: bounds.width / 2,
    centerY: bounds.height / 2,
    frameRadius,
    glyphRadius: frameRadius * 0.46,
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
