import type { ShipId } from "./game-data";
import { drawShipShape } from "./weapon-art";

/** The single authoritative fleet-art manifest used by canvas and menus. */
export const SHIP_MODEL_ASSETS: Record<ShipId, string> = {
  tank: "/ships/Ironclad.png", wing: "/ships/Starling.png", squid: "/ships/Phantom.png",
  rabbit: "/ships/Needle.png", turtle: "/ships/Rampart.png", flash: "/ships/Switchback.png",
  hunter: "/ships/Talon.png", flagship: "/ships/Leviathan.png", kestrel: "/ships/Kestrel.png",
  warden: "/ships/Warden.png",
};

const cache = new Map<ShipId, HTMLImageElement>();

export function preloadShipModels(): void {
  if (typeof Image === "undefined") return;
  for (const id of Object.keys(SHIP_MODEL_ASSETS) as ShipId[]) {
    if (cache.has(id)) continue;
    const image = new Image();
    image.decoding = "async";
    image.src = SHIP_MODEL_ASSETS[id];
    cache.set(id, image);
  }
}

/** Draws the PNG normally; the legacy vector is strictly a loading/error fallback. */
export function drawShipModel(ctx: CanvasRenderingContext2D, ship: ShipId, scale = 1): boolean {
  preloadShipModels();
  const image = cache.get(ship);
  if (image?.complete && image.naturalWidth > 0) {
    const size = 42 * scale;
    ctx.drawImage(image, -size / 2, -size / 2, size, size);
    return true;
  }
  drawShipShape(ctx, ship, scale);
  ctx.fill();
  ctx.stroke();
  return false;
}
