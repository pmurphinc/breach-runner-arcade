import { PUP_RADIUS } from "./pup-world.ts";
import type { ShipId } from "./game-data.ts";

/** Cannon darts use a deliberately tight hit area: the pilot must aim at the PUP. */
export const SALVAGE_LINK_CANNON_RADIUS = 4;

export type SalvageLinkBullet = {
  x: number;
  y: number;
  enemy: boolean;
  special?: boolean;
  salvageLinked?: boolean;
};

/**
 * True only for a Kestrel normal cannon round stamped while its link was live.
 * Stamping at the muzzle means an already-fired ordinary round cannot gain the
 * ability later, and co-op/hostile/special projectiles cannot accidentally use it.
 */
export function isSalvageLinkCannon(ship: ShipId, bullet: SalvageLinkBullet) {
  return ship === "kestrel" && bullet.salvageLinked === true && !bullet.enemy && !bullet.special;
}

export function salvageLinkHitsPup(
  ship: ShipId,
  bullet: SalvageLinkBullet,
  pup: { x: number; y: number },
) {
  return isSalvageLinkCannon(ship, bullet)
    && Math.hypot(pup.x - bullet.x, pup.y - bullet.y) < PUP_RADIUS + SALVAGE_LINK_CANNON_RADIUS;
}
