import { WEAPONS, type PickupId } from "./game-data.ts";
import { pupFrameColor, pupFrameShape } from "./pup-world.ts";

/** Resolve a stored PUP's frame from its canonical class, retaining its glyph id. */
export function inventoryPupVisual(id: PickupId) {
  const pupClass = WEAPONS[id].pupClass;
  return {
    pupClass,
    shape: pupFrameShape(pupClass),
    color: pupFrameColor(pupClass),
    glyphId: id,
  } as const;
}
