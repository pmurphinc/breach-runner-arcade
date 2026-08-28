import type { ShipId } from "./game-data.ts";
import { drawShipShape } from "./weapon-art.ts";

/** The single authoritative fleet-art manifest used by canvas and menus. */
export const SHIP_MODEL_ASSETS: Record<ShipId, string> = {
  tank: "/ships/Ironclad.png", wing: "/ships/Starling.png", squid: "/ships/Phantom.png",
  rabbit: "/ships/Needle.png", turtle: "/ships/Rampart.png", flash: "/ships/Switchback.png",
  hunter: "/ships/Talon.png", flagship: "/ships/Leviathan.png", kestrel: "/ships/Kestrel.png",
  warden: "/ships/Warden.png",
};

const cache = new Map<ShipId, HTMLImageElement>();

export type ShipModelPoint = Readonly<{ x: number; y: number }>;
export type ShipModelGeometry = Readonly<{ rotation: number; muzzle: ShipModelPoint; thrusters: readonly ShipModelPoint[] }>;

/** Base-42px canvas coordinates after correction: +x is nose, +y is ship-right. Tune attachments here. */
export const SHIP_MODEL_GEOMETRY: Record<ShipId, ShipModelGeometry> = {
  tank: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -18, y: -8 }, { x: -18, y: 8 }] },
  wing: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: -7 }, { x: -17, y: 7 }] },
  squid: { rotation: Math.PI / 2, muzzle: { x: 19, y: 0 }, thrusters: [{ x: -16, y: -9 }, { x: -18, y: 0 }, { x: -16, y: 9 }] },
  rabbit: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -18, y: -5 }, { x: -18, y: 5 }] },
  turtle: { rotation: Math.PI / 2, muzzle: { x: 19, y: 0 }, thrusters: [{ x: -17, y: -8 }, { x: -17, y: 8 }] },
  flash: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: 0 }] },
  hunter: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: -7 }, { x: -17, y: 7 }] },
  flagship: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -18, y: -10 }, { x: -20, y: 0 }, { x: -18, y: 10 }] },
  kestrel: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: -7 }, { x: -17, y: 7 }] },
  warden: { rotation: Math.PI / 2, muzzle: { x: 19, y: 0 }, thrusters: [{ x: -17, y: -8 }, { x: -17, y: 8 }] },
};

export const SHIP_MODEL_BASE_SIZE = 42;
export function shipModelScale(ship: ShipId, presentationScale = 1): number { return (ship === "flagship" ? 0.82 : 1) * presentationScale; }

export function shipAttachmentWorldPoint(ship: ShipId, attachment: ShipModelPoint, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint {
  const scale = shipModelScale(ship, presentationScale), x = attachment.x * scale, y = attachment.y * scale;
  const cosine = Math.cos(heading), sine = Math.sin(heading);
  return { x: position.x + x * cosine - y * sine, y: position.y + x * sine + y * cosine };
}
export function shipMuzzleWorldPoint(ship: ShipId, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint { return shipAttachmentWorldPoint(ship, SHIP_MODEL_GEOMETRY[ship].muzzle, position, heading, presentationScale); }
export function shipThrusterWorldPoints(ship: ShipId, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint[] { return SHIP_MODEL_GEOMETRY[ship].thrusters.map((point) => shipAttachmentWorldPoint(ship, point, position, heading, presentationScale)); }
export function shipForwardVelocity(heading: number, speed: number, inherited: ShipModelPoint = { x: 0, y: 0 }): ShipModelPoint { return { x: Math.cos(heading) * speed + inherited.x, y: Math.sin(heading) * speed + inherited.y }; }

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
export function drawShipModel(ctx: CanvasRenderingContext2D, ship: ShipId, presentationScale = 1): boolean {
  preloadShipModels();
  const image = cache.get(ship);
  if (image?.complete && image.naturalWidth > 0) {
    const size = SHIP_MODEL_BASE_SIZE * shipModelScale(ship, presentationScale);
    ctx.save();
    ctx.rotate(SHIP_MODEL_GEOMETRY[ship].rotation);
    ctx.drawImage(image, -size / 2, -size / 2, size, size);
    ctx.restore();
    return true;
  }
  drawShipShape(ctx, ship, shipModelScale(ship, presentationScale));
  ctx.fill();
  ctx.stroke();
  return false;
}
