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
export type ShipModelGeometry = Readonly<{
  rotation: number;
  muzzle: ShipModelPoint;
  thrusters: readonly ShipModelPoint[];
  /**
   * Where a Rift Run hull gun physically bolts onto *this* hull.
   *
   * Authored per ship for the same reason `muzzle` and `thrusters` are: a
   * shared generic offset that suits the Ironclad's wide delta hangs in open
   * space beside the Needle's spine. Every entry was read off that ship's own
   * 1254px artwork and converted with `x = (627 - pixelY) / 29.857` and
   * `y = (pixelX - 627) / 29.857`, which inverts the `rotation` the model is
   * drawn with.
   *
   * Ordered the way sockets unlock — index 0 first — so a one-gun run mounts
   * the centreline hardpoint and a full run reads as a symmetric pair flanking
   * it. `SHIP_HARDPOINT_CEILING` is the cap.
   */
  hardpoints: readonly ShipModelPoint[];
}>;

/** Base-42px canvas coordinates after correction: +x is nose, +y is ship-right. Tune attachments here. */
export const SHIP_MODEL_GEOMETRY: Record<ShipId, ShipModelGeometry> = {
  // Ironclad: broad delta. Centre gun on the forward spine, wing guns on the
  // armoured inner plates just inboard of each leading edge.
  tank: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -18, y: -8 }, { x: -18, y: 8 }], hardpoints: [{ x: 9, y: 0 }, { x: 4.5, y: -10 }, { x: 4.5, y: 10 }] },
  // Starling: hard-swept delta, so the wing pair sits back and outboard to stay
  // on the wing rather than floating past its leading edge.
  wing: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: -7 }, { x: -17, y: 7 }], hardpoints: [{ x: 9, y: 0 }, { x: -0.5, y: -7.6 }, { x: -0.5, y: 7.6 }] },
  // Phantom: the ring housings either side of the spine already read as gun
  // bays in the art, so the wing pair lands straight on them.
  squid: { rotation: Math.PI / 2, muzzle: { x: 19, y: 0 }, thrusters: [{ x: -16, y: -9 }, { x: -18, y: 0 }, { x: -16, y: 9 }], hardpoints: [{ x: 8, y: 0 }, { x: -1.5, y: -7.8 }, { x: -1.5, y: 7.8 }] },
  // Needle: barely wider than its own spine. The pair hugs the fuselage instead
  // of reaching for wings that are not there.
  rabbit: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -18, y: -5 }, { x: -18, y: 5 }], hardpoints: [{ x: 10, y: 0 }, { x: -4, y: -3.6 }, { x: -4, y: 3.6 }] },
  // Rampart: a diamond built around three ring bays. One gun per bay.
  turtle: { rotation: Math.PI / 2, muzzle: { x: 19, y: 0 }, thrusters: [{ x: -17, y: -8 }, { x: -17, y: 8 }], hardpoints: [{ x: 12, y: 0 }, { x: -0.5, y: -12.5 }, { x: -0.5, y: 12.5 }] },
  // Switchback: forward-swept wings. The outer pylon hubs are the widest solid
  // metal on the frame, which is where a bolted-on gun belongs.
  flash: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: 0 }], hardpoints: [{ x: 9, y: 0 }, { x: 0, y: -11 }, { x: 0, y: 11 }] },
  // Talon: outrigger ring pods on stub arms, forward of the hull centre.
  hunter: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: -7 }, { x: -17, y: 7 }], hardpoints: [{ x: 10, y: 0 }, { x: 2, y: -12.4 }, { x: 2, y: 12.4 }] },
  // Leviathan: the shoulder turret pods. Scaled by the 0.82 flagship model
  // scale like every other attachment, so they stay on the hull.
  flagship: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -18, y: -10 }, { x: -20, y: 0 }, { x: -18, y: 10 }], hardpoints: [{ x: 9, y: 0 }, { x: 2.5, y: -11.3 }, { x: 2.5, y: 11.3 }] },
  // Kestrel: mid-wing, outboard of the wing-root hubs.
  kestrel: { rotation: Math.PI / 2, muzzle: { x: 20, y: 0 }, thrusters: [{ x: -17, y: -7 }, { x: -17, y: 7 }], hardpoints: [{ x: 9, y: 0 }, { x: 0, y: -9 }, { x: 0, y: 9 }] },
  // Warden: the two ringed side pods, which read as weapon bays already.
  warden: { rotation: Math.PI / 2, muzzle: { x: 19, y: 0 }, thrusters: [{ x: -17, y: -8 }, { x: -17, y: 8 }], hardpoints: [{ x: 10, y: 0 }, { x: -3, y: -11.4 }, { x: -3, y: 11.4 }] },
};

/**
 * The most hull guns any frame can carry.
 *
 * Mirrors Rift Run's `RIFT_RUN_MAX_SOCKETS`, kept here as its own constant so
 * the art layer never has to import the run's rules to know how many mounts it
 * must be able to draw.
 */
export const SHIP_HARDPOINT_CEILING = 3;

export const SHIP_MODEL_BASE_SIZE = 42;
export function shipModelScale(ship: ShipId, presentationScale = 1): number { return (ship === "flagship" ? 0.82 : 1) * presentationScale; }

export function shipAttachmentWorldPoint(ship: ShipId, attachment: ShipModelPoint, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint {
  const scale = shipModelScale(ship, presentationScale), x = attachment.x * scale, y = attachment.y * scale;
  const cosine = Math.cos(heading), sine = Math.sin(heading);
  return { x: position.x + x * cosine - y * sine, y: position.y + x * sine + y * cosine };
}
export function shipMuzzleWorldPoint(ship: ShipId, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint { return shipAttachmentWorldPoint(ship, SHIP_MODEL_GEOMETRY[ship].muzzle, position, heading, presentationScale); }
export function shipThrusterWorldPoints(ship: ShipId, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint[] { return SHIP_MODEL_GEOMETRY[ship].thrusters.map((point) => shipAttachmentWorldPoint(ship, point, position, heading, presentationScale)); }

/**
 * One hull-gun mount in the ship's own unrotated frame, already scaled.
 *
 * This is what both the renderer and the fire path want: the renderer draws
 * inside a transform that is already translated to the hull and rotated to its
 * heading, and the fire path rotates the same offset into world space itself.
 * Returns null for a socket this ship has not authored, which is the signal to
 * fall back to Rift Run's generic offsets.
 */
export function shipHardpointOffset(ship: ShipId, index: number, presentationScale = 1): ShipModelPoint | null {
  const point = SHIP_MODEL_GEOMETRY[ship].hardpoints[index];
  if (!point) return null;
  const scale = shipModelScale(ship, presentationScale);
  return { x: point.x * scale, y: point.y * scale };
}

export function shipHardpointWorldPoints(ship: ShipId, position: ShipModelPoint, heading: number, presentationScale = 1): ShipModelPoint[] { return SHIP_MODEL_GEOMETRY[ship].hardpoints.map((point) => shipAttachmentWorldPoint(ship, point, position, heading, presentationScale)); }

/** A socket-index lookup for one ship, in the shape Rift Run's fire path wants. */
export function shipHardpointResolver(ship: ShipId, presentationScale = 1): (index: number) => ShipModelPoint | null {
  return (index: number) => shipHardpointOffset(ship, index, presentationScale);
}
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
