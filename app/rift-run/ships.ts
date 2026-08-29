import { SHIPS, SHIP_SPECIALS, type ShipId } from "../game-data.ts";
import { RIFT_SHIP_CLASSES } from "./data.ts";
import type { RiftShipClass } from "./types.ts";

export type RiftRunShip = {
  id: ShipId;
  name: string;
  shipClass: RiftShipClass;
  maximumHardpoints: 1 | 2 | 3;
  abilityName: string;
};

const fleet: ReadonlyArray<[ShipId, RiftShipClass, string?]> = [
  ["tank", "heavy"],
  ["wing", "light"],
  ["squid", "medium", "SCRAMBLER OVERCHARGE"],
  ["rabbit", "light"],
  ["turtle", "heavy"],
  ["flash", "medium"],
  ["hunter", "medium"],
  ["flagship", "heavy"],
  ["kestrel", "light"],
  ["warden", "medium"],
];

export const RIFT_RUN_SHIPS: readonly RiftRunShip[] = fleet.map(([id, shipClass, abilityName]) => {
  const ship = SHIPS.find((candidate) => candidate.id === id);
  if (!ship) throw new Error(`Missing canonical ship data for ${id}`);
  return {
    id,
    name: ship.name,
    shipClass,
    maximumHardpoints: RIFT_SHIP_CLASSES[shipClass].maximumHardpoints,
    abilityName: abilityName ?? SHIP_SPECIALS[id].name,
  };
});

export const RIFT_RUN_SHIP_IDS = RIFT_RUN_SHIPS.map(({ id }) => id);

export function riftRunShip(id: ShipId): RiftRunShip | undefined {
  return RIFT_RUN_SHIPS.find((ship) => ship.id === id);
}
