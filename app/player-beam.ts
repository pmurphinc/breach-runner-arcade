import type { ShipId } from "./game-data.ts";
import { shipMuzzleWorldPoint } from "./ship-models.ts";

export const GAMEPLAY_SHIP_MODEL_SCALE = 1.15;

export type PlayerBeamPose = { x: number; y: number; angle: number };

/** Canonical world-space origin shared by Lance rendering and collision. */
export function playerBeamMuzzle(ship: ShipId, player: PlayerBeamPose) {
  return shipMuzzleWorldPoint(ship, player, player.angle * Math.PI / 180, GAMEPLAY_SHIP_MODEL_SCALE);
}
