import { SHIP_SPECIALS, type ShipId } from "../game-data.ts";
import { RIFT_SHIP_CLASSES } from "./data.ts";
import type { RiftShipClass } from "./types.ts";

export type RiftRunShip = {
  id: ShipId;
  name: string;
  shipClass: RiftShipClass;
  maximumHardpoints: 1 | 2 | 3;
  abilityName: string;
};

const fleet: ReadonlyArray<[ShipId, string, RiftShipClass, string?]> = [
  ["tank", "Ironclad", "heavy"],
  ["wing", "Starling", "light"],
  ["squid", "Phantom", "medium", "SCRAMBLER OVERCHARGE"],
  ["rabbit", "Needle", "light"],
  ["turtle", "Rampart", "heavy"],
  ["flash", "Switchback", "medium"],
  ["hunter", "Talon", "medium"],
  ["flagship", "Leviathan", "heavy"],
];

export const RIFT_RUN_SHIPS: readonly RiftRunShip[] = fleet.map(([id, name, shipClass, abilityName]) => ({
  id,
  name,
  shipClass,
  maximumHardpoints: RIFT_SHIP_CLASSES[shipClass].maximumHardpoints,
  abilityName: abilityName ?? SHIP_SPECIALS[id].name,
}));

export const RIFT_RUN_SHIP_IDS = RIFT_RUN_SHIPS.map(({ id }) => id);

export function riftRunShip(id: ShipId): RiftRunShip | undefined {
  return RIFT_RUN_SHIPS.find((ship) => ship.id === id);
}
